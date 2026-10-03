import './styles.css';
import './offline.css';
import './brand-refresh.css';
import { cacheConversation, getCachedConversation, getOfflineActions, localModerationCheck, queueOfflineAction, removeOfflineAction } from './offline-store.js';
import { USERNAME_PATTERN } from '../shared/validation.js';

const ACCOUNT_DATA_VERSION = 'nexa-account-data-v2';
function readLocalValue(key, fallback = null) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function readLocalJson(key, fallback, isValid = () => true) {
  try {
    const value = JSON.parse(readLocalValue(key, 'null'));
    return isValid(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function writeLocalValue(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

function removeLocalValue(key) {
  try {
    localStorage.removeItem(key);
  } catch {}
}


function isUserRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
if (readLocalValue(ACCOUNT_DATA_VERSION) !== 'ready') writeLocalValue(ACCOUNT_DATA_VERSION, 'ready');

const icons = {
  home: '⌂', feed: '◉', messages: '▱', channels: '◫', studio: '✦', communities: '♧',
  search: '⌕', bell: '♧', settings: '⚙', plus: '+', heart: '♡', comment: '◌', share: '↗',
  bookmark: '▱', play: '▶', send: '➤', mic: '♩', image: '▧', more: '•••', shield: '⬢'
};

if ('serviceWorker' in navigator) {
  if (import.meta.env.DEV) {
    navigator.serviceWorker.getRegistrations().then(registrations => Promise.all(registrations.map(registration => registration.unregister())))
      .then(() => caches.keys())
      .then(keys => Promise.all(keys.filter(key => key.startsWith('nexa-cache-')).map(key => caches.delete(key))))
      .catch(() => {});
  } else {
    navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload());
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').then(registration => registration.update()).catch(() => {});
    });
  }
}

const state = {
  authScreen: 'guest',
  authPrompt: '',
  authLoading: false,
  authError: '',
  pendingUser: null,
  users: readLocalJson('nexa-users', [], Array.isArray).filter(user => isUserRecord(user) && user.email !== 'mohd@nexa.app' && user.username !== 'محمد السالم'),
  accounts: readLocalJson('nexa-accounts', [], Array.isArray).filter(user => isUserRecord(user) && user.email !== 'mohd@nexa.app' && user.username !== 'محمد السالم'),
  activeUser: readLocalJson('nexa-active-user', null, value => value === null || (typeof value === 'object' && !Array.isArray(value))),
  deviceTrusted: readLocalValue('nexa-device-trusted') === 'true',
  active: 'feed',
  feedFilter: 'for-you',
  profileTab: 'videos',
  messageFilter: 'all',
  messageQuery: '',
  spaceFilter: 'all',
  studioMode: 'video',
  studioEffect: 0,
  studioFrameRate: 30,
  liked: new Set(),
  saved: new Set(),
  subscribed: new Set(readLocalJson('nexa-following', [], Array.isArray)),
  joinedSpaces: new Set(readLocalJson('nexa-joined-spaces', [], Array.isArray)),
  userCommunities: readLocalJson('nexa-user-communities', [], Array.isArray),
  selectedChat: 0,
  selectedRecipientId: null,
  activeChannelId: null,
  channelMessages: [],
  sentMessages: [],
  userVideos: [],
  remotePosts: [],
  remoteChannels: [],
  remoteMessages: [],
  explore: { trending: [], popularCreators: [], popularTags: [] },
  searchResults: null,
  conversationUsers: [],
  moderationPosts: [],
  notifications: [],
  unreadNotifications: 0,
  serverOwner: false,
  csrfToken: '',
  toast: '',
  offlineActions: [],
  syncingOfflineActions: false,
  online: navigator.onLine,
  mediaRecorder: null,
  cameraStream: null,
  recordedChunks: [],
  recordingTimeout: null
};

const allowedThemes = ['dark', 'light'];
state.uiTheme = allowedThemes.includes(readLocalValue('nexa-theme')) ? readLocalValue('nexa-theme') : 'dark';
state.eyeComfort = readLocalValue('nexa-eye-comfort') === 'true';
state.motionReduced = readLocalValue('nexa-reduced-motion') === 'true';
state.textScale = ['compact', 'normal', 'large'].includes(readLocalValue('nexa-text-scale')) ? readLocalValue('nexa-text-scale') : 'normal';

function applyDisplayPreferences() {
  const root = document.documentElement;
  root.dataset.theme = state.uiTheme;
  root.dataset.eyeComfort = String(state.eyeComfort);
  root.dataset.textScale = state.textScale;
  root.dataset.reduceMotion = String(state.motionReduced);
}

applyDisplayPreferences();

const apiOrigin = '';
const oauthErrorMessages = {
  GOOGLE_OAUTH_NOT_CONFIGURED: 'تسجيل Google غير مفعّل بعد. أضف بيانات OAuth الصحيحة إلى إعدادات الخادم.',
  AUTH_SERVICES_UNAVAILABLE: 'خدمات الحساب غير متاحة الآن. حاول مجددًا بعد قليل.',
  EMAIL_VERIFICATION_INVALID: 'رابط تأكيد البريد غير صالح أو انتهت صلاحيته. اطلب رسالة تأكيد جديدة.',
  GOOGLE_LOGIN_CANCELLED: 'ألغيت تسجيل الدخول عبر Google.',
  GOOGLE_LOGIN_INCOMPLETE: 'لم يكتمل تسجيل الدخول عبر Google، حاول مرة أخرى.',
  GOOGLE_LOGIN_STATE_INVALID: 'تعذر تأكيد جلسة Google. أعد المحاولة.',
  GOOGLE_TOKEN_EXCHANGE_FAILED: 'تعذر تأكيد حساب Google. تحقق من إعدادات OAuth.',
  GOOGLE_PROFILE_FAILED: 'تعذر جلب ملفك من Google. حاول مرة أخرى.',
  GOOGLE_CONNECTION_FAILED: 'تعذر الاتصال بخدمة Google. تحقق من الإنترنت وحاول مجددًا.',
  GOOGLE_EMAIL_MISSING: 'لم يرجع Google بريدًا إلكترونيًا للحساب.',
  GOOGLE_EMAIL_NOT_VERIFIED: 'يجب تأكيد البريد في Google قبل المتابعة.',
  GOOGLE_SUBJECT_MISSING: 'تعذر تحديد حساب Google. حاول مرة أخرى.'
};
const oauthErrorCode = new URLSearchParams(window.location.search).get('auth_error');
if (oauthErrorCode) {
  state.authScreen = 'login';
  state.authError = oauthErrorMessages[oauthErrorCode] || 'تعذر تسجيل الدخول عبر Google. حاول مرة أخرى.';
  window.history.replaceState({}, '', window.location.pathname);
}
if (new URLSearchParams(window.location.search).get('email_verified') === '1') {
  state.authScreen = 'login';
  state.authError = 'تم تأكيد بريدك بنجاح. سجّل الدخول لإكمال الاسم المعروض واليوزر.';
  window.history.replaceState({}, '', window.location.pathname);
}

async function api(path, options = {}) {
  const { skipRefresh = false, ...requestOptions } = options;
  const method = requestOptions.method || 'GET';
  if (method !== 'GET' && method !== 'HEAD' && !state.csrfToken) state.csrfToken = (await api('/api/csrf')).token;
  const response = await fetch(`${apiOrigin}${path}`, { credentials: 'include', ...requestOptions, headers: { ...(requestOptions.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...(method !== 'GET' && method !== 'HEAD' ? { 'X-CSRF-Token': state.csrfToken } : {}), ...(requestOptions.headers || {}) } });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401 && !skipRefresh && !path.startsWith('/auth/')) {
    try {
      const refresh = await fetch(`${apiOrigin}/auth/refresh`, { method: 'POST', credentials: 'include' });
      if (refresh.ok) return api(path, { ...requestOptions, skipRefresh: true });
    } catch {
      // Keep the original authentication failure for the caller.
    }
  }
  if (!response.ok && method === 'GET' && response.status === 401) return payload;
  if (!response.ok) {
    const error = new Error(payload.error || 'API_REQUEST_FAILED');
    error.status = response.status;
    throw error;
  }
  return payload;
}

function updateOfflineIndicator() {
  let indicator = document.querySelector('#offline-indicator');
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.id = 'offline-indicator';
    indicator.className = 'offline-indicator';
    indicator.setAttribute('role', 'status');
    document.body.append(indicator);
  }
  const pending = state.offlineActions.filter(action => action.status !== 'needs-review').length;
  const needsReview = state.offlineActions.filter(action => action.status === 'needs-review').length;
  indicator.hidden = state.online && pending === 0 && needsReview === 0;
  indicator.textContent = !state.online
    ? `أنت بلا اتصال. ${state.offlineActions.length} عنصر محفوظ على هذا الجهاز.`
    : state.syncingOfflineActions
      ? 'جارٍ مزامنة العناصر المحفوظة...'
      : needsReview
        ? `${needsReview} عنصر تعذرت مزامنته ويحتاج إلى مراجعة.`
        : `${pending} عنصر بانتظار المزامنة.`;
}

async function refreshOfflineActions() {
  try {
    state.offlineActions = await getOfflineActions();
  } catch {
    state.offlineActions = [];
    toast('التخزين دون اتصال غير متاح في هذا المتصفح');
  }
  updateOfflineIndicator();
}

async function enqueueAction(action) {
  await queueOfflineAction({ ...action, status: 'queued', createdAt: action.createdAt || new Date().toISOString() });
  await refreshOfflineActions();
}

function transientApiError(error) {
  return !navigator.onLine || error instanceof TypeError || [429, 500, 502, 503, 504].includes(error.status);
}

function authErrorMessage(error) {
  const messages = {
    ACCOUNT_TEMPORARILY_LOCKED: 'تم إيقاف المحاولات مؤقتًا لحماية الحساب. حاول بعد 15 دقيقة.',
    AUTH_REQUIRED: 'انتهت الجلسة. سجّل الدخول مجددًا ثم أكمل ملفك الشخصي.',
    CSRF_INVALID: 'انتهت صلاحية الجلسة. حدّث الصفحة وحاول مجددًا.',
    EMAIL_IN_USE: 'هذا البريد مسجل بالفعل. سجّل الدخول بدلًا من إنشاء حساب جديد.',
    EMAIL_NOT_VERIFIED: 'تحقق من بريدك الإلكتروني أولًا.',
    INVALID_CREDENTIALS: 'أدخل بريدًا صالحًا وكلمة مرور من 8 أحرف على الأقل.',
    INVALID_PROFILE: 'تحقق من الاسم واليوزر. يجب أن يبدأ اليوزر بحرف إنجليزي ويكون طوله من 3 إلى 20 محرفًا.',
    INVALID_LOGIN: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
    ORIGIN_NOT_ALLOWED: 'تعذر إكمال الطلب. حدّث الصفحة وحاول مجددًا.',
    RATE_LIMITED: 'محاولات كثيرة؛ انتظر قليلًا ثم أعد المحاولة.',
    RATE_LIMIT_UNAVAILABLE: 'تعذر التحقق الأمني مؤقتًا. حاول بعد قليل.',
    SMTP_NOT_CONFIGURED: 'التسجيل أو استعادة الحساب بالبريد غير مفعّل على الخادم. استخدم Google أو تواصل مع مسؤول التطبيق.',
    OWNER_EMAIL_NOT_VERIFIED: 'يجب تأكيد بريدك الإلكتروني قبل حجز اسم the_x.',
    OWNER_ALREADY_ASSIGNED: 'تم حجز صلاحية المالك من حساب آخر؛ اسم the_x غير متاح.',
    OWNER_USERNAME_RESERVED: 'لا يمكن تغيير اسم المستخدم المحجوز للمالك.',
    OWNER_USERNAME_REQUIRED: 'اختر اسم المستخدم the_x لإكمال إعداد صلاحية المالك.',
    SERVICES_UNAVAILABLE: 'خدمات التطبيق متوقفة مؤقتًا. أعد المحاولة بعد تشغيل الخادم وقاعدة البيانات.',
    UPLOAD_CAPACITY_REACHED: 'الخادم مشغول الآن. أعد المحاولة بعد قليل.'
  };
  if (messages[error.message]) return messages[error.message];
  if (error.status === 401) return 'البريد الإلكتروني أو كلمة المرور غير صحيحة.';
  if (error.status === 403) return 'تعذر التحقق من الطلب. حدّث الصفحة وحاول مجددًا.';
  if (error.status === 423) return messages.ACCOUNT_TEMPORARILY_LOCKED;
  if (error.status === 429) return messages.RATE_LIMITED;
  if (error.status >= 500 || error instanceof TypeError) return messages.SERVICES_UNAVAILABLE;
  return 'تعذر إكمال الطلب. تحقق من البيانات وحاول مجددًا.';
}

async function syncOfflineActions() {
  if (!navigator.onLine || state.syncingOfflineActions || !isAuthenticated()) return;
  state.syncingOfflineActions = true;
  updateOfflineIndicator();
  try {
    const actions = (await getOfflineActions()).sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    for (const action of actions) {
      if (action.userId !== state.activeUser.id || action.status === 'needs-review') continue;
      try {
        if (action.type === 'message') {
          const { message } = await api('/api/messages', {
            method: 'POST',
            body: JSON.stringify({ recipientId: action.recipientId, body: action.body, clientId: action.id })
          });
          if (state.selectedRecipientId === action.recipientId && !state.remoteMessages.some(item => item.id === message.id)) {
            state.remoteMessages.push({ id: message.id, from: 'me', body: message.body, createdAt: message.createdAt });
          }
          const cached = await getCachedConversation(`${action.userId}:${action.recipientId}`).catch(() => null);
          const messages = state.selectedRecipientId === action.recipientId
            ? state.remoteMessages
            : [...(cached?.messages || []), { id: message.id, from: 'me', body: message.body, createdAt: message.createdAt }];
          await cacheConversation(`${action.userId}:${action.recipientId}`, messages);
        } else if (action.type === 'video') {
          const form = new FormData();
          form.append('file', action.file, action.file.name);
          form.append('uploadId', action.id);
          const uploaded = await api('/api/media', { method: 'POST', body: form });
          const { post } = await api('/api/posts', {
            method: 'POST',
            body: JSON.stringify({ body: action.caption, mediaUrl: uploaded.mediaUrl, moderationJobId: uploaded.moderationJobId, clientId: action.id })
          });
          state.remotePosts.unshift(apiPostToVideo(post));
        }
        await removeOfflineAction(action.id);
      } catch (error) {
        if (error.message === 'CONTENT_REJECTED') {
          await queueOfflineAction({ ...action, status: 'needs-review', lastError: error.message });
          continue;
        }
        if (error.message === 'AUTH_REQUIRED' || transientApiError(error)) break;
        await queueOfflineAction({ ...action, status: 'needs-review', lastError: error.message });
      }
    }
  } catch {
    // Keep the outbox intact if storage or connectivity fails.
  } finally {
    state.syncingOfflineActions = false;
    await refreshOfflineActions();
    if (state.active === 'messages' || state.active === 'feed') render();
  }
}

async function queueVideoForPublishing(file) {
  if (!isAuthenticated()) throw new Error('AUTH_REQUIRED');
  if (!document.querySelector('#media-moderation-consent')?.checked) throw new Error('MEDIA_CONSENT_REQUIRED');
  const caption = 'فيديو جديد من استوديو NEXA';
  if (localModerationCheck(caption)) throw new Error('CONTENT_REJECTED');
  await enqueueAction({ id: crypto.randomUUID(), type: 'video', userId: state.activeUser.id, file, caption });
  await syncOfflineActions();
  state.active = 'feed';
  render();
  toast(navigator.onLine ? 'حُفظ الفيديو محليًا وبدأت مزامنته' : 'حُفظ الفيديو على الجهاز وسيرتفع عند عودة الاتصال');
}

function apiPostToVideo(post) {
  const author = post.author || {};
  return { id: post.id, src: post.mediaUrl || '', author: author.displayName || author.username || 'NEXA', authorEmail: author.id, handle: `@${author.username || ''}`, avatar: (author.displayName || author.username || 'N').slice(0, 1).toUpperCase(), color: 'green', title: post.body || 'منشور NEXA', tags: '#NEXA', views: post.likeCount || 0, liked: post.liked, saved: post.saved, postId: post.id, createdAt: post.createdAt };
}

state.devUnlocked = false;
state.devFingerprint = readLocalValue('nexa-dev-fingerprint') || (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
state.devOwner = false;
writeLocalValue('nexa-dev-fingerprint', state.devFingerprint);
state.logoPresses = 0;
state.logoPressTimer = null;

if (state.activeUser?.email === 'mohd@nexa.app' || state.activeUser?.username === 'محمد السالم') {
  state.activeUser = null;
  state.deviceTrusted = false;
  localStorage.removeItem('nexa-active-user');
  localStorage.removeItem('nexa-device-trusted');
}

function persistAuth() {
  localStorage.setItem('nexa-users', JSON.stringify(state.users));
  localStorage.setItem('nexa-accounts', JSON.stringify(state.accounts));
  localStorage.setItem('nexa-active-user', JSON.stringify(state.activeUser));
  localStorage.setItem('nexa-device-trusted', String(state.deviceTrusted));
}

function clearSessionState() {
  state.activeUser = null;
  state.deviceTrusted = false;
  state.pendingUser = null;
  state.authScreen = 'login';
  state.notifications = [];
  state.unreadNotifications = 0;
  localStorage.removeItem('nexa-active-user');
  localStorage.removeItem('nexa-device-trusted');
  persistAuth();
}

function persistFollowing() {
  localStorage.setItem('nexa-following', JSON.stringify([...state.subscribed]));
}

function persistJoinedSpaces() {
  writeLocalValue('nexa-joined-spaces', JSON.stringify([...state.joinedSpaces]));
}

function persistUserCommunities() {
  writeLocalValue('nexa-user-communities', JSON.stringify(state.userCommunities));
}

function currentUser() {
  return state.activeUser || { username: 'مستخدم جديد', email: '', avatar: 'N', color: 'coral', verification: 'standard', followers: 0 };
}

function normalizeRole(role) {
  return role === 'owner' || role === 'boss' ? 'owner' : role || null;
}

function verificationForAccount(order) {
  if (order === 0) return 'gold';
  if (order === 1 || order === 2) return 'yellow';
  return 'standard';
}

state.users.forEach((user, index) => { user.verification = verificationForAccount(index); });
state.accounts.forEach((user, index) => { user.verification = verificationForAccount(index); });

async function hydrateBackendSession() {
  try {
    const response = await fetch(`${apiOrigin}/api/me`, { credentials: 'include' });
    if (!response.ok) {
      state.activeUser = null;
      state.deviceTrusted = false;
      state.authScreen = 'login';
      return;
    }
    const payload = await response.json();
    const profile = payload.user;
    if (!profile) {
      state.activeUser = null;
      state.deviceTrusted = false;
      state.authScreen = 'login';
      return;
    }
    const email = profile.email || '';
    const existingUser = state.users.find(item => item.email === email);
    const nameSource = profile.displayName || profile.name || email.split('@')[0] || 'NEXA User';
    const usernameSource = (profile.username || email.split('@')[0] || 'nexa_user').replace(/[^A-Za-z0-9_]/g, '_').slice(0, 20) || 'nexa_user';
    const needsProfileSetup = profile.status === 'needs_profile_setup' || !profile.displayName || !profile.username;
    const user = {
      id: profile.id,
      displayName: nameSource,
      username: usernameSource,
      email,
      avatar: (nameSource || 'N').slice(0, 1).toUpperCase(),
      color: 'blue',
      verification: existingUser?.verification || verificationForAccount(state.users.length),
      followers: 0,
      profileSetup: !needsProfileSetup,
      role: normalizeRole(profile.role),
      developerStatus: 'pending',
      provider: profile.provider,
      status: profile.status || 'active',
      notificationsEnabled: profile.notificationsEnabled !== false,
      theme: profile.theme || 'dark'
    };
    const existingIndex = state.users.findIndex(item => item.email === user.email);
    if (existingIndex >= 0) state.users[existingIndex] = { ...state.users[existingIndex], ...user };
    else state.users.push(user);
    state.activeUser = state.users[existingIndex >= 0 ? existingIndex : state.users.length - 1];
    if (allowedThemes.includes(state.activeUser.theme)) state.uiTheme = state.activeUser.theme;
    applyDisplayPreferences();
    state.pendingUser = needsProfileSetup ? state.activeUser : null;
    state.accounts = [...new Map([...state.accounts, state.activeUser].map(item => [item.email, item])).values()];
    state.deviceTrusted = true;
    state.authScreen = needsProfileSetup ? 'forced-profile' : 'guest';
    state.active = 'feed';
    persistAuth();
    render();
    syncOfflineActions();
  } catch {
    state.activeUser = null;
    state.deviceTrusted = false;
    state.authScreen = 'login';
    // The frontend remains usable as a local prototype when the API is offline.
  }
}

async function hydrateBackendContent() {
  try {
    const [feed, channelData, ownerStatus, notificationData, explore] = await Promise.all([
      api('/api/feed'),
      api('/api/channels'),
      api('/api/owner/status'),
      isAuthenticated() ? api('/api/notifications') : { notifications: [], unreadCount: 0 },
      api('/api/explore')
    ]);
    state.remotePosts = feed.posts.map(apiPostToVideo).filter(post => post.src);
    state.remoteChannels = channelData.channels;
    state.serverOwner = ownerStatus.owner === true || normalizeRole(state.activeUser?.role) === 'owner';
    state.liked = new Set(feed.posts.filter(post => post.liked).map(post => post.id));
    state.saved = new Set(feed.posts.filter(post => post.saved).map(post => post.id));
    state.notifications = notificationData.notifications || [];
    state.unreadNotifications = notificationData.unreadCount || 0;
    state.explore = explore || state.explore;
    if (isAuthenticated()) await hydrateBackendMessages();
    render();
  } catch {
    // Guest mode remains available while the API is unavailable.
  }
}

async function hydrateBackendMessages() {
  if (!isAuthenticated()) {
    state.remoteMessages = [];
    state.conversationUsers = [];
    return;
  }

  let contacts;
  try {
    const { users = [] } = await api('/api/users');
    contacts = users.map(user => ({
      id: user.id,
      userId: user.id,
      name: user.displayName || user.username,
      avatar: (user.displayName || user.username || 'N').slice(0, 1).toUpperCase(),
      color: 'blue',
      preview: 'ابدأ محادثة',
      time: '',
      online: false
    }));
    await cacheConversation(`contacts:${state.activeUser.id}`, contacts);
  } catch {
    const cached = await getCachedConversation(`contacts:${state.activeUser.id}`).catch(() => null);
    contacts = cached?.messages || discoverableUsers().slice(0, 8).map(user => ({
      id: user.id,
      userId: user.id,
      name: user.displayName || user.username,
      avatar: user.avatar || (user.displayName || user.username || 'N').slice(0, 1).toUpperCase(),
      color: user.color || 'blue',
      preview: 'ابدأ محادثة',
      time: '',
      online: false
    }));
  }
  state.conversationUsers = contacts;

  if (!state.conversationUsers.length) {
    state.remoteMessages = [];
    state.selectedRecipientId = null;
    return;
  }

  const recipientId = state.selectedRecipientId || state.conversationUsers[0].userId;
  state.selectedRecipientId = recipientId;
  const cacheId = `${state.activeUser.id}:${recipientId}`;

  try {
    const { messages = [] } = await api(`/api/messages?recipientId=${encodeURIComponent(recipientId)}`);
    state.remoteMessages = (messages || []).map(message => ({
      id: message.id,
      from: message.senderId === recipientId ? 'other' : 'me',
      body: message.body,
      createdAt: message.createdAt
    }));
    await cacheConversation(cacheId, state.remoteMessages);
    if (!state.remoteMessages.length) {
      state.remoteMessages = [{ id: `seed-${recipientId}`, from: 'other', body: 'ابدأ المحادثة وأرسل أول رسالة.', createdAt: new Date().toISOString() }];
    }
  } catch {
    const cached = await getCachedConversation(cacheId).catch(() => null);
    state.remoteMessages = cached?.messages || [];
  }
}

function isAuthenticated() { return Boolean(state.activeUser && state.deviceTrusted); }
function isBoss() { return isAuthenticated() && normalizeRole(state.activeUser.role) === 'owner'; }
function claimDeveloperBoss() {
  if (state.devUnlocked && state.devOwner) return true;
  const owner = readLocalValue('nexa-dev-boss-email');
  if (!owner && isAuthenticated()) {
    writeLocalValue('nexa-dev-boss-email', state.activeUser.email);
    state.activeUser.role = 'owner';
    state.activeUser.developerStatus = 'approved';
    const user = state.users.find(item => item.email === state.activeUser.email);
    if (user) Object.assign(user, { role: 'owner', developerStatus: 'approved' });
    persistAuth();
    return true;
  }
  return owner === state.activeUser?.email || normalizeRole(state.activeUser?.role) === 'owner';
}

function hideDeveloperAccess() {
  return !state.devUnlocked;
}

function randomIdentity() {
  const number = Math.floor(100 + Math.random() * 900);
  return { displayName: `NexaUser_${number}`, username: `nx_${number}` };
}

function verificationBadge(user = currentUser()) {
  if (user.verification === 'gold') return '<span class="verification-badge gold" title="توثيق ذهبي">★</span>';
  if (user.verification === 'yellow') return '<span class="verification-badge yellow" title="توثيق أصفر">★</span>';
  return '';
}

async function saveProfileForm(form) {
  const values = new FormData(form);
  const displayName = String(values.get('displayName') || '').trim();
  const username = String(values.get('username') || '').trim();
  const usernameTaken = state.users.some(user => user.username.toLowerCase() === username.toLowerCase() && user.email !== (state.pendingUser?.email || currentUser().email));
  if (!USERNAME_PATTERN.test(username) || usernameTaken) {
    state.authError = usernameTaken ? 'اسم المستخدم مستخدم بالفعل.' : 'يبدأ اليوزر بحرف إنجليزي، ويتكون من 3 إلى 20 حرفًا أو رقمًا أو _.';
    render();
    return;
  }
  if (displayName.length < 2) { state.authError = 'اكتب اسماً معروضاً صالحاً.'; render(); return; }
  const target = state.pendingUser || state.activeUser;
  let savedUsername = username.toLowerCase() === 'the_x' ? 'the_x' : username;
  if (target?.id && !String(target.id).startsWith('usr_')) {
    try {
      const result = await api('/api/me', { method: 'PATCH', body: JSON.stringify({ displayName, username }) });
      savedUsername = result.user.username || savedUsername;
      Object.assign(target, { ...result.user, avatar: displayName.slice(0, 1).toUpperCase(), profileSetup: true });
    } catch (error) {
      state.authError = error.message === 'USERNAME_IN_USE' ? 'اسم المستخدم مستخدم بالفعل، اختر يوزرًا آخر.' : moderationMessage(error) || authErrorMessage(error);
      render();
      return;
    }
  }
  Object.assign(target, { displayName, username: savedUsername, bio: String(values.get('bio') || '').trim(), avatar: displayName.slice(0, 1).toUpperCase(), profileSetup: true });
  const index = state.users.findIndex(user => user.email === target.email);
  if (index >= 0) state.users[index] = target;
  state.pendingUser = null;
  state.authError = '';
  state.activeUser = target;
  state.activeUser.profileSetup = true;
  state.serverOwner = normalizeRole(target.role) === 'owner';
  state.deviceTrusted = true;
  state.active = 'feed';
  state.authScreen = 'guest';
  persistAuth();
  if (window.history.pushState) window.history.replaceState({}, '', '/home');
  render();
  hydrateBackendContent();
  syncOfflineActions();
}

function discoverableUsers() {
  const currentEmail = currentUser().email;
  return state.users.filter(user => user.email && user.email !== currentEmail);
}

const navItems = [
  ['feed', icons.feed, 'الرئيسية'], ['explore', icons.search, 'استكشف'], ['messages', icons.messages, 'الرسائل'],
  ['studio', icons.studio, 'إنشاء'], ['spaces', icons.communities, 'المساحات'], ['profile', '◉', 'حسابي'],
  ['settings', icons.settings, 'الإعدادات']
];

const videos = [];

const chats = [];

const channels = [
  { name: 'NEXA Design', desc: 'أفكار وموارد التصميم الرقمي', members: '38.4K', avatar: 'N', color: 'coral', verified: true },
  { name: 'Future Signals', desc: 'نشرة التقنية والثقافة القادمة', members: '12.8K', avatar: 'F', color: 'blue', verified: true },
  { name: 'رحلات غير مكتملة', desc: 'أماكن، قصص، وطرق جانبية', members: '8.2K', avatar: 'ر', color: 'green', verified: false }
];

function displayChannels() {
  if (!state.remoteChannels.length) return channels;
  return state.remoteChannels.map(channel => ({ name: channel.name, desc: channel.description, members: channel._count?.messages || 0, avatar: (channel.name || 'N').slice(0, 1), color: 'blue', verified: channel.owner?.verification === 'gold', id: channel.id }));
}

function avatar(letter, color, size = '') { return `<span class="avatar ${color} ${size}">${letter}</span>`; }
function nav() {
  const items = [...navItems];
  if (state.serverOwner) items.push(['developers', icons.shield, 'المطورين']);
  if (['owner', 'moderator'].includes(state.activeUser?.role)) items.push(['moderation', icons.shield, 'مراجعة']);
  return items.map(([id, icon, label]) => `<button class="nav-item ${state.active === id ? 'active' : ''}" data-nav="${id}" ${(id !== 'feed' && id !== 'explore' && id !== 'settings') ? 'data-requires-auth' : ''}><span class="nav-icon">${icon}</span><span>${label}</span>${id === 'messages' && state.unreadNotifications ? `<b class="nav-badge">${Math.min(state.unreadNotifications, 9)}</b>` : ''}</button>`).join('');
}

function authShell(content) { return `<div class="auth-shell"><div class="auth-art"><div class="auth-orbit orbit-one"></div><div class="auth-orbit orbit-two"></div><span class="auth-n">N</span><div class="auth-art-copy"><span class="eyebrow">NEXA / SOCIAL OS</span><h1>كل عالمك.<br /><em>في مكان واحد.</em></h1><p>فيديوهات، محادثات، مجتمعات وصوتك الخاص.</p></div></div><main class="auth-panel"><div class="auth-brand"><span class="brand-mark">N</span><strong>NEXA</strong></div>${content}<small class="auth-footer">بالاستمرار، أنت توافق على شروط الاستخدام وسياسة الخصوصية.</small></main></div>`; }

function authError() { return state.authError ? `<div class="auth-error">${icons.shield} ${state.authError}</div>` : ''; }

function loginView() { return authShell(`<div class="auth-heading"><span class="eyebrow">${state.authPrompt || 'مرحباً بعودتك'}</span><h2>ادخل إلى عالمك</h2><p>تابع من حيث توقفت، كل شيء بانتظارك.</p></div>${authError()}<form class="auth-form" data-auth="login"><label>البريد الإلكتروني<input name="email" type="email" placeholder="you@example.com" autocomplete="email" required /></label><label>كلمة المرور<div class="password-field"><input name="password" type="password" placeholder="أدخل كلمة المرور" autocomplete="current-password" required minlength="8" /><button type="button" data-toggle-password>إظهار</button></div></label><div class="auth-options"><label class="check-label"><input type="checkbox" checked /> تذكرني</label><button type="button" class="link-btn" data-request-reset>نسيت كلمة المرور؟</button></div><button class="auth-submit" type="submit">${state.authLoading ? 'جارٍ التحقق...' : 'تسجيل الدخول'} <span>←</span></button></form><div class="auth-divider"><span>أو</span></div><button class="social-login google-login" type="button" data-local-google>الدخول باستخدام Google <span>G</span></button><button class="social-login" type="button" data-auth-screen="register">ابدأ بإنشاء حسابك <span>✦</span></button><p class="auth-switch">ليس لديك حساب؟ <button data-auth-screen="register">إنشاء حساب جديد</button></p>`); }

function registerView() { return authShell(`<div class="auth-heading"><span class="eyebrow">انضم إلى NEXA</span><h2>أنشئ حسابك</h2><p>بعد تأكيد بريدك الإلكتروني، أكمل إعداد ملفك الشخصي.</p></div>${authError()}<form class="auth-form" data-auth="register"><label>البريد الإلكتروني<input name="email" type="email" placeholder="you@example.com" autocomplete="email" required /></label><label>كلمة المرور<div class="password-field"><input name="password" type="password" placeholder="8 أحرف على الأقل" autocomplete="new-password" required minlength="8" /><button type="button" data-toggle-password>إظهار</button></div></label><button class="auth-submit" type="submit">${state.authLoading ? 'جارٍ إنشاء الحساب...' : 'إنشاء الحساب'} <span>←</span></button></form><p class="auth-switch">لديك حساب بالفعل؟ <button data-auth-screen="login">تسجيل الدخول</button></p>`); }

function forcedNameView() { const user = state.pendingUser || state.activeUser || { displayName: '', username: '' }; const needsSetup = user.profileSetup === false || user.status === 'needs_profile_setup'; return authShell(`<div class="auth-heading"><span class="eyebrow">إكمال الحساب</span><h2>اختر اسمك في NEXA</h2><p>البريد محفوظ لحسابك. أدخل الاسم المعروض واليوزر لإكمال التسجيل.</p></div>${authError()}<form class="auth-form" data-profile-setup><label>البريد الإلكتروني<input type="email" value="${escapeHtml(user.email || '')}" readonly /></label><label>الاسم المعروض<input name="displayName" value="${needsSetup ? '' : escapeHtml(user.displayName || '')}" required minlength="2" maxlength="30" autocomplete="name" /></label><label>اسم المستخدم<input name="username" value="${needsSetup ? '' : escapeHtml(user.username || '')}" pattern="${USERNAME_PATTERN.source}" placeholder="nexa_user" required minlength="3" maxlength="20" autocomplete="username" /><small class="field-hint">يبدأ بحرف إنجليزي، ثم أحرف أو أرقام أو _ (من 3 إلى 20 محرفًا)</small></label><button class="auth-submit" type="submit">${state.authLoading ? 'جارٍ الحفظ...' : 'حفظ والدخول'} <span>←</span></button></form>`); }

function deviceBindView() { const user = state.pendingUser || currentUser(); return authShell(`<div class="device-icon">${icons.shield}</div><div class="auth-heading centered"><span class="eyebrow">خطوة أمان أخيرة</span><h2>اربط جهازك</h2><p>نحتاج لتوثيق هذا الجهاز حتى يبقى حسابك آمناً.</p></div><div class="device-card"><div class="device-symbol">⌁</div><div><strong>جهاز Linux الحالي</strong><small>تم اكتشافه الآن · موقع تقريبي محلي</small></div><span class="device-check">✓</span></div>${authError()}<button class="auth-submit" data-bind-device>${state.authLoading ? 'جارٍ التحقق...' : 'توثيق هذا الجهاز'} <span>←</span></button><button class="ghost-btn" data-auth-screen="login">إلغاء والعودة</button><small class="device-note">لن نطلب هذا التحقق مجدداً على هذا الجهاز الموثوق.</small>`); }

function shell(content, title, eyebrow = '') {
  const user = currentUser();
  const guest = !isAuthenticated();
  return `<div class="app-shell"><aside class="sidebar"><div class="brand"><button class="brand-mark" data-logo-trigger aria-label="NEXA">N</button><span>NEXA</span></div><div class="profile-mini">${avatar(user.avatar, user.color)}<div><strong>${guest ? 'زائر NEXA' : `${user.displayName || user.username} ${verificationBadge(user)}`}</strong><small>${guest ? 'شاهد بدون حساب' : `@${user.username}`}</small></div><span class="status-dot"></span></div><nav class="primary-nav" aria-label="التنقل الرئيسي"><small class="nav-label">${guest ? 'تصفح كزائر' : 'المساحة الشخصية'}</small>${nav()}<small class="nav-label space">مكتبتك</small><button class="nav-item ${state.active === 'saved' ? 'active' : ''}" data-nav="saved" data-requires-auth><span class="nav-icon">${icons.bookmark}</span><span>المحفوظات</span></button></nav><div class="sidebar-bottom">${guest ? '<button class="guest-login" data-auth-screen="login">تسجيل الدخول <span>←</span></button>' : `<div class="trust"><span>${icons.shield}</span><div><strong>حسابك على NEXA</strong><small>إدارة تجربتك وخصوصيتك</small></div></div><button class="nav-item" data-add-account><span class="nav-icon">${icons.plus}</span><span>إضافة حساب</span></button><button class="nav-item" data-switch-account><span class="nav-icon">⇄</span><span>تبديل الحساب</span></button>`}</div></aside><main class="main"><header class="topbar"><div><span class="eyebrow">${eyebrow}</span><h1>${title}</h1></div><div class="top-actions"><button class="icon-btn" data-nav="settings" aria-label="الإعدادات" title="الإعدادات">${icons.settings}</button><button class="icon-btn" data-bell-button aria-label="الإشعارات">${icons.bell}${state.unreadNotifications ? `<i class="notification-count">${Math.min(state.unreadNotifications, 9)}</i>` : ''}</button><button class="create-btn" data-nav="studio"><span>${icons.plus}</span> إنشاء</button>${guest ? '<button class="header-login" data-auth-screen="login">دخول</button>' : `<button class="profile-edit-trigger" data-profile-edit aria-label="تعديل الملف الشخصي"><span>تعديل الملف</span></button><button class="logout-btn" data-logout type="button">تسجيل الخروج</button>${avatar(user.avatar, user.color)}`}</div></header>${content}</main><aside class="right-rail"><section class="rail-card profile-card"><div class="cover"></div><div class="profile-card-body">${avatar(user.avatar, user.color, 'large')}<button class="edit-btn" data-profile-edit>${guest ? 'إنشاء ملفك' : 'تعديل الملف'}</button><h3>${guest ? 'زائر NEXA' : `${user.displayName || user.username} ${verificationBadge(user)}`}</h3><p>${guest ? 'سجّل لتخصيص تجربتك' : `@${user.username}`}</p><div class="profile-stats"><span><b>${user.followers || 0}</b>متابع</span><span><b>${state.subscribed.size}</b>يتابع</span><span><b>${state.userVideos.length}</b>منشور</span></div></div></section><section class="rail-section trends"><div class="section-heading"><h3>ابدأ رحلتك</h3></div><p>${guest ? 'شاهد الفيديوهات الآن، وسجّل للحفظ والتعليق والنشر.' : 'أنشئ أول فيديو وشاركه مع مجتمع NEXA.'}</p><button class="text-btn" data-nav="studio">ابدأ الإنشاء ←</button></section></aside></div>`;
}

function feedView() {
  const allStreamVideos = [...state.userVideos, ...state.remotePosts, ...videos];
  const streamVideos = state.feedFilter === 'following'
    ? allStreamVideos.filter(video => state.subscribed.has(video.authorEmail))
    : state.feedFilter === 'latest'
      ? [...allStreamVideos].sort((left, right) => new Date(right.createdAt || 0) - new Date(left.createdAt || 0))
      : allStreamVideos;
  const people = discoverableUsers();
  const streamContent = streamVideos.length ? streamVideos.map(videoCard).join('') : `<div class="stream-empty"><span>${icons.studio}</span><h2>لا توجد فيديوهات بعد</h2><p>أنشئ فيديوك الأول ليظهر هنا للمستخدمين.</p><button class="primary-btn" data-nav="studio">افتح الاستوديو <span>←</span></button></div>`;
  return shell(`<div class="feed-layout"><section class="feed-column"><div class="stories-row"><button class="story add-story" data-nav="studio"><span>${icons.plus}</span><small>قصتك</small></button>${['قصتك'].map(x => `<button class="story" data-nav="studio"><span class="story-ring coral">${currentUser().avatar}</span><small>${x}</small></button>`).join('')}</div><div class="feed-tabs"><button data-feed-filter="for-you" class="${state.feedFilter === 'for-you' ? 'selected' : ''}">لك</button><button data-feed-filter="following" class="${state.feedFilter === 'following' ? 'selected' : ''}">يتابعون</button><button data-feed-filter="latest" class="${state.feedFilter === 'latest' ? 'selected' : ''}">الأحدث</button><span class="feed-filter" aria-hidden="true">⌁</span></div><div class="stream-label"><span class="eyebrow">NEXA STREAM</span><small>${streamVideos.length ? 'اسحب للأعلى للمقطع التالي' : 'ابدأ بالنشر'}</small></div><div class="stream-list">${streamContent}</div></section><aside class="feed-side"><div class="ai-card"><div class="ai-heading"><span class="ai-orb">✦</span><div><small>HyperBrain</small><strong>توصياتك تبدأ منك</strong></div></div><p>ستتغير التوصيات بعد مشاهدة فيديوهات المستخدمين والتفاعل معها.</p><button class="text-btn" data-nav="settings">إدارة التفضيلات <span>←</span></button></div><div class="suggestions"><div class="section-heading"><h3>أشخاص على NEXA</h3><button type="button" data-refresh-content>تحديث</button></div>${people.length ? people.map(user => `<div class="suggestion">${avatar(user.avatar, user.color)}<div><strong>${user.username} ${verificationBadge(user)}</strong><small>${user.followers || 0} متابع</small></div><button class="follow-btn ${state.subscribed.has(user.email) ? 'following' : ''}" data-follow-person="${user.email}">${state.subscribed.has(user.email) ? 'تتابعه' : 'متابعة'}</button></div>`).join('') : '<p class="suggestions-empty">لا يوجد أشخاص آخرون بعد.</p>'}</div></aside></div>`, 'مساحتك اليوم', 'مساحتك على NEXA');
}

function videoCard(video) { const liked = state.liked.has(video.id); const saved = state.saved.has(video.id); const authorIsCurrent = video.authorEmail === currentUser().id || video.authorEmail === currentUser().email; const following = state.subscribed.has(video.authorEmail || video.handle); return `<article class="video-card"><div class="video-visual ${video.color}"><video class="stream-video" data-video="${video.id}" src="${video.src}" muted autoplay loop playsinline preload="auto"></video><div class="visual-grain"></div><div class="video-top"><span class="live-tag">لـك</span><button class="visual-more">${icons.more}</button></div><button class="play-button" data-play="${video.id}" aria-label="تشغيل أو إيقاف الفيديو">${icons.play}</button><div class="video-caption">${avatar(video.avatar, video.color)}<div><strong>${video.author}</strong><small>${video.handle}</small></div>${authorIsCurrent ? '' : `<button class="follow-pill ${following ? 'following' : ''}" data-follow-person="${video.authorEmail || video.handle}">${following ? 'تتابع' : 'متابعة'}</button>`}<p>${video.title}</p><small>${video.tags}</small></div><div class="video-actions"><button class="action ${liked ? 'active' : ''}" data-like="${video.postId || video.id}"><span>${liked ? '♥' : icons.heart}</span><small>${liked ? 'أعجبك' : 'إعجاب'}</small></button><button class="action" data-comment-post="${video.postId || video.id}"><span>${icons.comment}</span><small>تعليق</small></button><button class="action" data-report-post="${video.postId || video.id}"><span>${icons.shield}</span><small>إبلاغ</small></button><button class="action"><span>${icons.share}</span><small>مشاركة</small></button><button class="action ${saved ? 'active' : ''}" data-save="${video.postId || video.id}"><span>${icons.bookmark}</span></button></div></div></article>`; }

function exploreView() {
  const data = state.searchResults || state.explore;
  const posts = data.trending || [];
  const creators = data.popularCreators || [];
  const tags = data.popularTags || [];
  const cards = posts.length ? posts.map(post => `<article class="explore-post"><div class="explore-post-top">${avatar((post.author?.displayName || 'N').slice(0, 1), 'blue')}<div><strong>${post.author?.displayName || post.author?.username || 'NEXA'}</strong><small>@${post.author?.username || 'nexa'}</small></div><b>${post.likeCount || 0} إعجاب</b></div><p>${escapeHtml(post.body || 'منشور بصري')}</p><small class="explore-meta">${post.viewCount || 0} مشاهدة · ${post.commentCount || 0} تعليق</small></article>`).join('') : '<div class="explore-empty">لا توجد نتائج بعد. ابدأ أول منشور في NEXA.</div>';
  return shell(`<div class="explore-page"><section class="explore-hero"><div><span class="eyebrow">NEXA DISCOVERY</span><h2>اكتشف ما يستحق وقتك.</h2><p>ترندات حية، منشئون جدد، ومحتوى مختار من قاعدة بيانات NEXA.</p></div><form class="explore-search" data-explore-search><input name="q" value="${escapeHtml(state.searchResults?.query || '')}" placeholder="ابحث عن مستخدم، منشور، قناة أو هاشتاق" /><button aria-label="بحث">${icons.search}</button></form></section><div class="explore-layout"><section><div class="section-heading"><div><span class="eyebrow">TRENDING NOW</span><h2>${state.searchResults ? 'نتائج البحث' : 'الأكثر تداولاً'}</h2></div><button class="outline-btn" data-clear-search>تحديث</button></div><div class="explore-posts">${cards}</div></section><aside class="explore-rail"><div class="explore-panel"><span class="eyebrow">POPULAR TAGS</span><h3>الهاشتاقات الرائجة</h3><div class="tag-cloud">${tags.length ? tags.map(tag => `<button type="button" data-explore-tag="${escapeHtml(tag.tag)}">#${escapeHtml(tag.tag)} <small>${tag.count}</small></button>`).join('') : '<small>ستظهر الهاشتاقات هنا مع أول منشوراتك.</small>'}</div></div><div class="explore-panel"><span class="eyebrow">CREATORS</span><h3>منشئون يستحقون المتابعة</h3>${creators.map(creator => `<div class="creator-row">${avatar((creator.displayName || 'N').slice(0, 1), 'coral')}<div><strong>${creator.displayName || creator.username}</strong><small>@${creator.username}</small></div></div>`).join('') || '<small>لا يوجد منشئون بعد.</small>'}</div></aside></div></div>`, 'الاستكشاف', 'اكتشف');
}

function messagesView() {
  const chat = state.conversationUsers.find(item => item.userId === state.selectedRecipientId) || state.conversationUsers[0];
  if (!chat) return shell(`<div class="messages-empty"><span>${icons.messages}</span><h2>لا توجد محادثات بعد</h2><p>ستظهر محادثاتك هنا عندما تتواصل مع مستخدمين حقيقيين.</p><button class="primary-btn" data-nav="feed">استكشف الفيديوهات <span>←</span></button></div>`, 'محادثاتك', 'التواصل');

  const remoteMessageIds = new Set(state.remoteMessages.map(message => message.id));
  const queuedMessages = state.offlineActions.filter(action => action.type === 'message' && action.userId === state.activeUser?.id && action.recipientId === chat.userId && !remoteMessageIds.has(action.id)).map(action => ({ id: action.id, from: 'me', body: action.body, createdAt: action.createdAt, queued: true, needsReview: action.status === 'needs-review' }));
  const messages = [...state.remoteMessages, ...queuedMessages].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const messageList = messages.length ? messages.map(message => `<div class="message ${message.from === 'me' ? 'sent' : 'received'} ${message.queued ? 'queued' : ''}">${escapeHtml(message.body)}<small>${message.needsReview ? 'تحتاج مراجعة' : message.queued ? 'محفوظة على الجهاز · بانتظار الإرسال' : new Date(message.createdAt).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}</small>${message.queued ? `<button class="offline-remove" data-remove-offline="${escapeHtml(message.id)}" aria-label="حذف الرسالة المحفوظة">حذف</button>` : ''}</div>`).join('') : '<div class="message received">ابدأ المحادثة وأرسل أول رسالة.</div>';

  return shell(`<div class="messages-layout"><section class="chat-list"><div class="list-header"><div><h2>الرسائل</h2><small>تواصل مع دائرتك</small></div><button class="round-add" data-new-chat aria-label="محادثة جديدة">${icons.plus}</button></div><div class="message-search">${icons.search}<input data-message-search placeholder="البحث في المحادثات" /></div><div class="chat-tabs"><button class="${state.messageFilter === 'all' ? 'selected' : ''}" data-message-filter="all">الكل</button><button class="${state.messageFilter === 'unread' ? 'selected' : ''}" data-message-filter="unread">غير مقروءة</button><button class="${state.messageFilter === 'groups' ? 'selected' : ''}" data-message-filter="groups">مجموعات</button></div><div data-chat-list>${state.conversationUsers.map(c => `<button class="chat-row ${c.userId === state.selectedRecipientId ? 'selected' : ''}" data-chat="${c.userId}">${avatar(c.avatar, c.color)}<div class="chat-info"><strong>${escapeHtml(c.name)}</strong><small>${escapeHtml(c.preview)}</small></div><div class="chat-meta"><small>${escapeHtml(c.time)}</small></div></button>`).join('')}</div><p class="chat-list-empty" data-chat-list-empty hidden></p></section><section class="chat-window"><header class="chat-header">${avatar(chat.avatar, chat.color)}<div><strong>${escapeHtml(chat.name)}</strong><small>${chat.online ? 'متصل الآن' : 'آخر ظهور اليوم'}</small></div><div class="chat-tools"><button type="button" data-chat-action="search" aria-label="البحث في المحادثة">${icons.search}</button><button type="button" data-chat-action="details" aria-label="تفاصيل المحادثة">${icons.more}</button></div></header><div class="chat-messages">${messageList}</div><form class="composer"><input id="message-input" placeholder="اكتب رسالة..." autocomplete="off" /><button type="button" class="emoji-btn" data-insert-emoji aria-label="إضافة رمز تعبيري">☺</button><button class="send-btn" aria-label="إرسال">${icons.send}</button></form></section></div>`, 'محادثاتك', 'التواصل');
}

function channelsView() { return shell(`<div class="channels-page"><div class="channel-hero"><div><span class="eyebrow">مساحتك الصوتية</span><h2>تابع ما يهمك.<br /><em>بصوتك الخاص.</em></h2><p>قنوات مستقلة، مجتمعات حقيقية، ومحتوى يصل إليك في وقته.</p><button class="primary-btn">اكتشف القنوات <span>←</span></button></div><div class="hero-signal"><div class="signal-line"></div><span>● مباشر الآن</span><strong>${displayChannels().length}</strong><small>قناة نشطة</small></div></div><div class="page-heading"><div><h2>القنوات المقترحة</h2><p>مختارة بناءً على اهتماماتك</p></div><button class="outline-btn">عرض الكل</button></div><div class="channel-grid">${displayChannels().map(c => `<article class="channel-card"><div class="channel-cover ${c.color}"><span>${c.avatar}</span><small>● ${c.verified ? 'موثق' : 'نشط الآن'}</small></div><div class="channel-body">${avatar(c.avatar, c.color, 'medium')}<h3>${c.name} ${c.verified ? '<span class="verified">✓</span>' : ''}</h3><p>${c.desc}</p><small>${c.members} رسالة</small><button class="channel-follow ${state.subscribed.has(c.id || c.name) ? 'following' : ''}" data-subscribe="${c.id || c.name}">${state.subscribed.has(c.id || c.name) ? 'تتابعها' : 'متابعة القناة'}</button></div></article>`).join('')}</div></div>`, 'القنوات', 'اكتشف'); }

function channelChatView() {
  const channel = state.remoteChannels.find(item => item.id === state.activeChannelId);
  if (!channel) return shell('<div class="messages-empty"><h2>القناة غير متاحة</h2><button class="primary-btn" data-nav="spaces">العودة للقنوات</button></div>', 'القنوات', 'المساحات');
  const messages = state.channelMessages.map(message => `<div class="message ${message.senderId === state.activeUser?.id ? 'sent' : 'received'}">${escapeHtml(message.body)}<small>${escapeHtml(message.sender?.displayName || message.sender?.username || '')} · ${new Date(message.createdAt).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}</small></div>`).join('') || '<div class="message received">ابدأ الحديث في القناة.</div>';
  return shell(`<div class="channel-chat"><header class="chat-header"><button class="outline-btn" data-nav="spaces">القنوات</button><div><strong>${escapeHtml(channel.name)}</strong><small>${channel._count?.members || 1} عضو</small></div></header><div class="chat-messages">${messages}</div><form class="composer" data-channel-composer><input name="body" placeholder="اكتب رسالة للقناة..." maxlength="2000" autocomplete="off" required /><button class="send-btn" aria-label="إرسال">${icons.send}</button></form></div>`, channel.name, 'محادثة قناة');
}

function studioView() { return shell(`<div class="studio-page"><section class="studio-canvas"><div class="camera-frame"><div class="camera-grid"></div><div class="camera-top"><span class="recording-dot"></span> 00:00:12 <button>×</button></div><div class="camera-center"><span class="face-orbit">✦</span><p>اضغط لالتقاط اللحظة</p></div><div class="camera-bottom"><button class="studio-control">⌁<small>سرعة</small></button><button class="capture"><span></span></button><button class="studio-control">◌<small>فلاتر</small></button></div></div></section><aside class="studio-panel"><div class="panel-head"><div><span class="eyebrow">NEXA STUDIO</span><h2>اصنع لحظتك</h2></div><button class="icon-btn">⚙</button></div><div class="mode-switch"><button class="selected">فيديو</button><button>صورة</button><button>بث مباشر</button></div><div class="effects-title"><h3>تأثيرات اليوم</h3><button>الكل</button></div><div class="effects-grid">${['✦','◒','✺','◉','⌁','◇'].map((x, i) => `<button class="effect ${i === 0 ? 'selected' : ''}"><span>${x}</span><small>${['نقي','Glow','نظرة','عكس','حبيبات','حالم'][i]}</small></button>`).join('')}</div><div class="studio-note"><span>${icons.shield}</span><p><strong>DeepGuard نشط</strong><br />محتواك محمي قبل النشر.</p></div></aside></div>`, 'الاستوديو', 'إنشاء'); }

function communitiesView() { return shell(`<div class="community-page"><div class="page-heading"><div><span class="eyebrow">مجتمعاتك</span><h2>معاً، نصنع أكثر</h2><p>مساحات آمنة للحوار والعمل المشترك.</p></div><button class="primary-btn">${icons.plus} مجتمع جديد</button></div><div class="community-layout"><section><article class="community-feature"><div class="community-banner"><span>◈</span><small>مساحة موصى بها</small></div><div class="community-content">${avatar('ت','purple','large')}<div><h2>تقنية الغد</h2><p>نناقش الأدوات التي ستصنع عالمنا القادم.</p><div class="member-stack">${['م','ر','س','ن'].map((x,i) => avatar(x, ['coral','blue','green','yellow'][i])).join('')}<small>+ 4.2K عضو</small></div></div><button class="join-btn">انضمام</button></div></article></section><aside class="roles-panel"><h3>نشاط المجتمع</h3><div class="activity-item"><span class="activity-icon blue">↗</span><p><strong>سارة</strong> نشرت في <b>#التصميم</b><small>منذ 4 دقائق</small></p></div><div class="activity-item"><span class="activity-icon coral">✦</span><p><strong>ياسر</strong> بدأ موضوعاً جديداً<small>منذ 18 دقيقة</small></p></div><div class="activity-item"><span class="activity-icon green">♧</span><p><strong>ريم</strong> انضمت للمجتمع<small>منذ 42 دقيقة</small></p></div></aside></div></div>`, 'المجتمعات', 'انتمِ'); }
function spacesView() {
  const listedChannels = state.spaceFilter === 'communities' ? [] : displayChannels();
  const showCommunities = state.spaceFilter !== 'channels';
  const communityItems = [{ id: 'future-tech', name: 'تقنية الغد', desc: 'مجتمع للحوار والعمل المشترك.', members: '4.2K عضو' }, ...state.userCommunities];
  return shell(`<div class="spaces-page"><div class="page-heading"><div><span class="eyebrow">مساحة واحدة</span><h2>القنوات والمجتمعات</h2><p>كل مساحاتك في قائمة واحدة.</p></div><button class="primary-btn" data-create-space>${icons.plus} إنشاء قناة</button></div><div class="space-tabs"><button class="${state.spaceFilter === 'all' ? 'selected' : ''}" data-space-filter="all">الكل</button><button class="${state.spaceFilter === 'channels' ? 'selected' : ''}" data-space-filter="channels">القنوات</button><button class="${state.spaceFilter === 'communities' ? 'selected' : ''}" data-space-filter="communities">المجتمعات</button></div><div class="space-grid">${listedChannels.map(channel => `<article class="space-card" data-space-kind="channel"><div class="space-icon ${channel.color}">${escapeHtml(channel.avatar)}</div><div><h3>${escapeHtml(channel.name)}</h3><p>${escapeHtml(channel.desc)}</p><small>${channel.members} رسالة</small></div><button class="follow-btn ${channel.isMember ? 'following' : ''}" data-channel-join="${escapeHtml(channel.id || '')}" ${channel.id ? '' : 'disabled'}>${channel.isMember ? 'مشترك' : 'انضمام'}</button><button class="channel-enter" data-enter-channel="${escapeHtml(channel.id || '')}" ${channel.id && channel.isMember ? '' : 'disabled'}>دخول</button></article>`).join('')}${showCommunities ? communityItems.map(community => `<article class="space-card community-space" data-space-kind="community"><div class="space-icon purple">◈</div><div><h3>${escapeHtml(community.name)}</h3><p>${escapeHtml(community.desc)}</p><small>${escapeHtml(community.members || 'مساحة محلية')}</small></div><button class="follow-btn ${state.joinedSpaces.has(community.id) ? 'following' : ''}" data-join-space="${escapeHtml(community.id)}">${state.joinedSpaces.has(community.id) ? 'انضممت' : 'انضمام'}</button></article>`).join('') : ''}${!listedChannels.length && !showCommunities ? '<p class="explore-empty">لا توجد قنوات بعد.</p>' : ''}</div></div>`, 'المساحات', 'استكشف');
}
function moderationView() {
  const items = state.moderationPosts.map(post => {
    const labels = Array.isArray(post.moderationLabels) ? post.moderationLabels.map(label => label.Name).filter(Boolean) : [];
    const scanResult = labels.length ? `تصنيفات الفحص: ${labels.join('، ')}` : post.moderationJobId ? 'الفحص الآلي جارٍ' : 'بانتظار المراجعة البشرية';
    return `<article class="explore-post"><div class="explore-post-top">${avatar((post.author?.displayName || 'N').slice(0, 1), 'blue')}<div><strong>${escapeHtml(post.author?.displayName || post.author?.username || 'NEXA')}</strong><small>@${escapeHtml(post.author?.username || 'unknown')}</small></div><small>بانتظار المراجعة</small></div><p>${escapeHtml(post.body || 'منشور وسائط بلا نص')}</p><small>${escapeHtml(scanResult)}</small>${post.mediaUrl ? `<a href="${escapeHtml(post.mediaUrl)}" target="_blank" rel="noreferrer">فتح الوسائط للمراجعة</a>` : ''}<div class="moderation-actions"><button class="outline-btn" data-moderation-decision="rejected" data-post-id="${escapeHtml(post.id)}">رفض</button><button class="primary-btn" data-moderation-decision="approved" data-post-id="${escapeHtml(post.id)}">اعتماد</button></div></article>`;
  }).join('');
  return shell(`<div class="explore-page"><div class="section-heading"><div><span class="eyebrow">إشراف المجتمع</span><h2>مراجعة المحتوى</h2><small>${state.moderationPosts.length} منشور بانتظار المراجعة</small></div><button class="outline-btn" data-refresh-moderation>تحديث</button></div><div class="explore-posts">${items || '<div class="explore-empty">لا يوجد محتوى بانتظار المراجعة.</div>'}</div></div>`, 'مراجعة المحتوى', 'الإشراف');
}
function profileEditView() { const user = currentUser(); return shell(`<div class="profile-edit-page"><div class="page-heading"><div><span class="eyebrow">ملفك الشخصي</span><h2>عدّل هويتك</h2><p>غيّر الاسم واليوزر والنبذة في أي وقت.</p></div></div><form class="profile-form" data-profile-edit-form><label>الاسم المعروض<input name="displayName" value="${user.displayName || ''}" required minlength="2" maxlength="30" /></label><label>اسم المستخدم<input name="username" value="${user.username || ''}" pattern="${USERNAME_PATTERN.source}" required minlength="3" maxlength="20" /><small class="field-hint">يبدأ بحرف إنجليزي، ثم أحرف أو أرقام أو _</small></label><label>النبذة<textarea name="bio" maxlength="120" placeholder="اكتب نبذة قصيرة">${user.bio || ''}</textarea></label><button class="auth-submit" type="submit">حفظ التغييرات <span>←</span></button></form></div>`, 'الملف الشخصي', 'حسابك'); }

function settingsView() {
  const themeOptions = [
    ['dark', 'ليلي', 'تباين هادئ للمساء'],
    ['light', 'نهاري', 'واجهة واضحة بإضاءة متوازنة']
  ];
  const textOptions = [['compact', 'صغير'], ['normal', 'متوسط'], ['large', 'كبير']];
  return shell(`<div class="settings-page">
    <section class="settings-intro"><span class="settings-intro-icon">${icons.settings}</span><div><span class="eyebrow">تجربتك على NEXA</span><h2>مساحة تناسبك</h2><p>عدّل العرض والقراءة والحركة لتناسب جهازك وراحتك.</p></div></section>
    <div class="settings-grid">
      <section class="settings-card settings-appearance"><div class="settings-card-heading"><span class="settings-card-icon">◐</span><div><h3>مظهر التطبيق</h3><p>اختر ألوان الواجهة المناسبة لك.</p></div></div><div class="settings-choice-grid" role="group" aria-label="مظهر التطبيق">${themeOptions.map(([value, label, detail]) => `<button type="button" class="settings-choice ${state.uiTheme === value && !state.eyeComfort ? 'selected' : ''}" data-preference="theme" data-value="${value}" aria-pressed="${state.uiTheme === value && !state.eyeComfort}"><span class="theme-preview ${value}"><i></i><i></i><i></i></span><strong>${label}</strong><small>${detail}</small></button>`).join('')}<button type="button" class="settings-choice ${state.eyeComfort ? 'selected' : ''}" data-preference="eye-comfort" data-value="${!state.eyeComfort}" aria-pressed="${state.eyeComfort}"><span class="theme-preview comfort"><i></i><i></i><i></i></span><strong>راحة العين</strong><small>ألوان دافئة وتقليل الوهج</small></button></div><p class="settings-hint">إعدادات العرض تساعد على تحسين الراحة، لكنها لا تغني عن فترات الراحة أو ضبط سطوع الشاشة.</p></section>
      <section class="settings-card"><div class="settings-card-heading"><span class="settings-card-icon">Aa</span><div><h3>حجم النص</h3><p>كبّر النص لتحسين سهولة القراءة.</p></div></div><div class="settings-segmented" role="group" aria-label="حجم النص">${textOptions.map(([value, label]) => `<button type="button" class="${state.textScale === value ? 'selected' : ''}" data-preference="text-scale" data-value="${value}" aria-pressed="${state.textScale === value}">${label}</button>`).join('')}</div><div class="text-preview"><span>معاينة القراءة</span><strong>كل عالمك، في مساحة واحدة.</strong><small>تتغير أحجام النصوص لتلائم تفضيلك.</small></div></section>
      <section class="settings-card settings-motion"><div class="settings-card-heading"><span class="settings-card-icon">↝</span><div><h3>الحركة والتركيز</h3><p>بسّط الحركة لتخفيف المشتتات.</p></div></div><button type="button" class="settings-switch-row" data-preference="reduce-motion" data-value="${!state.motionReduced}" role="switch" aria-checked="${state.motionReduced}"><span><strong>تقليل الحركة</strong><small>إيقاف الانتقالات والحركات غير الضرورية.</small></span><i class="switch-track"><b></b></i></button><div class="focus-note"><span>✦</span><p>يمكنك دائمًا استخدام إعدادات السطوع وراحة الشاشة في جهازك للحصول على تجربة أنسب.</p></div></section>
      <section class="settings-card settings-shortcuts"><div class="settings-card-heading"><span class="settings-card-icon">⌘</span><div><h3>اختصاراتك</h3><p>انتقل مباشرةً إلى أهم أدوات NEXA.</p></div></div><div class="settings-shortcut-list"><button type="button" data-nav="profile"><span>◉</span>ملفي الشخصي<b>←</b></button><button type="button" data-nav="saved" data-requires-auth><span>${icons.bookmark}</span>المحفوظات<b>←</b></button><button type="button" data-nav="messages" data-requires-auth><span>${icons.messages}</span>الرسائل<b>←</b></button></div></section>
    </div>
  </div>`, 'الإعدادات', 'التخصيص');
}

function profileVideoGrid(items, emptyText) {
  if (!items.length) return `<div class="profile-grid-empty"><span>${icons.studio}</span><p>${emptyText}</p><button class="primary-btn" data-nav="studio">افتح الاستوديو <span>←</span></button></div>`;
  return items.map((video, index) => `<button class="profile-video-tile" data-profile-video="${escapeHtml(video.postId || video.id)}" style="--tile-hue:${index % 3}"><video src="${escapeHtml(video.src || '')}" muted preload="metadata"></video><span class="tile-gradient"></span><strong>${escapeHtml(video.title || 'فيديو NEXA')}</strong><small>♡ ${state.liked.has(video.postId || video.id) ? 1 : 0} · ${video.views || 'جديد'}</small></button>`).join('');
}

function profileView() {
  const user = currentUser();
  const allVideos = [...state.userVideos, ...state.remotePosts];
  const ownVideos = allVideos.filter(video => video.authorEmail === user.email || video.authorEmail === user.id);
  const likedVideos = allVideos.filter(video => state.liked.has(video.postId || video.id) || video.liked);
  const savedVideos = allVideos.filter(video => state.saved.has(video.postId || video.id) || video.saved);
  const tabs = { videos: ['الفيديوهات', ownVideos], liked: ['المعجب بها', likedVideos], saved: ['المحفوظة', savedVideos] };
  const [label, selectedVideos] = tabs[state.profileTab] || tabs.videos;
  const emptyText = state.profileTab === 'liked' ? 'لم تعجبك فيديوهات بعد.' : state.profileTab === 'saved' ? 'لا توجد فيديوهات محفوظة.' : 'لم تنشر فيديوهات بعد.';
  const grid = profileVideoGrid(selectedVideos, emptyText);
  return shell(`<div class="profile-page"><section class="profile-hero"><div class="profile-identity">${avatar(user.avatar, user.color, 'profile-avatar')}<div><h2>${user.displayName || user.username} ${verificationBadge(user)}</h2><p>@${user.username}</p><small>${user.bio || 'أهلاً بك في ملفي على NEXA.'}</small></div></div><div class="profile-actions"><button class="profile-edit-trigger" data-profile-edit>${icons.settings}<span>تعديل البروفايل</span></button><button class="share-profile" data-share-profile>${icons.share}<span>مشاركة</span></button></div><div class="profile-stats-row"><button data-profile-stat="followers"><strong>${user.followers || 0}</strong><small>المتابعون</small></button><button data-profile-stat="following"><strong>${state.subscribed.size}</strong><small>يتابع</small></button><button data-profile-stat="liked"><strong>${likedVideos.length}</strong><small>الإعجابات</small></button></div></section><div class="profile-tabs"><button data-profile-tab="videos" class="${state.profileTab === 'videos' ? 'selected' : ''}">الفيديوهات <b>${ownVideos.length}</b></button><button data-profile-tab="liked" class="${state.profileTab === 'liked' ? 'selected' : ''}">المعجب بها <b>${likedVideos.length}</b></button><button data-profile-tab="saved" class="${state.profileTab === 'saved' ? 'selected' : ''}">المحفوظة <b>${savedVideos.length}</b></button></div><section class="profile-grid" aria-label="${label}">${grid}</section></div>`, 'البروفايل', 'حسابك');
}

function savedView() {
  const savedVideos = [...state.userVideos, ...state.remotePosts].filter(video => state.saved.has(video.postId || video.id) || video.saved);
  const content = savedVideos.length ? savedVideos.map(videoCard).join('') : '<div class="stream-empty"><span>▱</span><h2>لا توجد عناصر محفوظة</h2><p>احفظ فيديو من الموجز ليظهر هنا.</p><button class="primary-btn" data-nav="feed">العودة للموجز</button></div>';
  return shell(`<div class="feed-layout"><section class="feed-column"><div class="stream-list">${content}</div></section></div>`, 'المحفوظات', 'مكتبتك');
}

function developerView() {
  const authenticated = isAuthenticated() && state.serverOwner;
  const boss = state.serverOwner;
  return `<div class="developer-shell"><header class="developer-top"><div class="brand"><span class="brand-mark">N</span><span>NEXA / DEV</span></div><span class="dev-status"><i></i> ${boss ? 'Boss access granted' : 'Awaiting boss approval'}</span></header><main class="developer-main">${!authenticated ? `<section class="developer-gate"><span class="dev-lock">${icons.shield}</span><span class="eyebrow">PRIVATE DEVELOPER PORTAL</span><h1>سجّل الدخول<br /><em>للمطالبة بالوصول.</em></h1><p>أول مستخدم مسجل يدخل هذه البوابة يصبح البوس. الزوار لا يحصلون على صلاحيات.</p><button class="dev-primary" data-dev-login>تسجيل الدخول <span>←</span></button>` : boss ? `<section class="developer-hero"><span class="eyebrow">PRIVATE DEVELOPER PORTAL</span><h1>ابنِ NEXA<br /><em>من الداخل.</em></h1><p>أصبحت أول Boss في بوابة NEXA. لديك صلاحية إدارة المطورين وإعدادات النظام.</p><div class="boss-chip">★ Boss / Founder</div></section><section class="developer-grid"><article class="dev-card"><span class="dev-card-icon green">⌁</span><small>CORE SYSTEMS</small><h3>الخدمات الأساسية</h3><p>PostgreSQL · Redis · MinIO</p><strong>متصلة</strong></article><article class="dev-card"><span class="dev-card-icon yellow">✦</span><small>AI LAYER</small><h3>DeepGuard / HyperBrain</h3><p>المراقبة والتوصيات الذكية</p><strong>جاهزة للتهيئة</strong></article><article class="dev-card"><span class="dev-card-icon blue">⬢</span><small>ACCESS MODEL</small><h3>Boss approval</h3><p>أنت تملك قرار الموافقة</p><strong>محمية</strong></article></section>` : `<section class="developer-gate"><span class="dev-lock">⬢</span><span class="eyebrow">REQUEST PENDING</span><h1>البوابة محجوزة<br /><em>بواسطة البوس.</em></h1><p>أول مستخدم دخل الرابط حصل على صلاحية البوس. يمكنك طلب الانضمام من الحساب المصرح.</p><button class="dev-primary" data-dev-action="request">طلب الانضمام <span>←</span></button></section>`}<section class="developer-note"><span>${icons.shield}</span><div><strong>منطقة خاصة</strong><p>لا تضع مفاتيح API أو أسرار البيئة داخل الواجهة.</p></div></section><a href="/" class="dev-back">العودة إلى التطبيق</a></main></div>`;
}

function developerAppView() {
  return shell(`<div class="developer-app-page"><section class="developer-app-hero"><span class="eyebrow">BOSS CONTROL CENTER</span><h2>مركز المطورين</h2><p>تحكم في تكاملات NEXA وتحدث مع مساعد DeepSeek.</p><div class="boss-chip">★ Boss / Founder</div></section><section class="integration-panel"><div class="section-heading"><h3>تفعيل APIs</h3><small>المفاتيح لا تحفظ في المتصفح</small></div><form class="integration-form" data-integration-form><label>DeepSeek API Key<input name="deepseekApiKey" type="password" placeholder="sk-..." autocomplete="off" /></label><label>Google Client ID<input name="googleClientId" placeholder="...apps.googleusercontent.com" autocomplete="off" /></label><label>Google Client Secret<input name="googleClientSecret" type="password" placeholder="GOCSPX-..." autocomplete="off" /></label><button class="dev-primary" type="submit">حفظ وتفعيل فورًا <span>✓</span></button></form><div class="integration-status"><span data-integration-status>جاري قراءة الحالة...</span></div></section><section class="developer-chat"><div class="section-heading"><h3>DeepSeek Dev Assistant</h3><small>اقتراحات آمنة: فحص، بناء، اختبار</small></div><div class="dev-chat-log" data-dev-chat-log><p class="dev-chat-message assistant">أضف مفتاح DeepSeek ثم اكتب مشكلة أو طلب تطوير.</p></div><form class="dev-chat-form" data-dev-chat-form><input name="message" placeholder="مثال: افحص مشكلة البناء واقترح إصلاحًا" required maxlength="2000" /><button class="dev-primary" type="submit">إرسال</button></form></section><section class="developer-audit"><div class="section-heading"><h3>Audit / Telemetry</h3><small>مراقبة النشاط والأنظمة</small></div><div class="audit-grid"><div class="kpi"><strong>24</strong><small>تسجيلات</small></div><div class="kpi"><strong>99.9%</strong><small>جاهزية</small></div><div class="kpi"><strong>8</strong><small>اختبارات</small></div></div></section><section class="developer-lab"><div class="section-heading"><h3>مختبر التجارب</h3><small>Draft ثم معاينة ثم تفعيل أو إلغاء</small></div><form class="experiment-form" data-experiment-form><input name="name" placeholder="اسم التجربة" required maxlength="80" /><input name="description" placeholder="ما الذي ستختبره؟" maxlength="500" /><button class="dev-primary" type="submit">إنشاء تجربة</button></form><div class="experiment-list" data-experiment-list><p>جاري تحميل التجارب...</p></div></section><div class="developer-app-grid"><article class="dev-card"><span class="dev-card-icon green">⌁</span><small>CORE SYSTEMS</small><h3>حالة الخدمات</h3><p>PostgreSQL · Redis · MinIO</p><strong>متصلة</strong></article><article class="dev-card"><span class="dev-card-icon yellow">✦</span><small>AI CONTROLS</small><h3>DeepGuard وHyperBrain</h3><p>التفعيل من الخادم</p><button class="dev-toggle active">مفعّل</button></article><article class="dev-card"><span class="dev-card-icon blue">⬢</span><small>GOOGLE OAUTH</small><h3>تسجيل الدخول</h3><p>يظهر الزر عند ضبط OAuth</p><strong>جاهز</strong></article></div><section class="developer-settings"><div><strong>رابط البوابة الخاصة</strong><small>/dev متاح للفريق التقني</small></div><button class="dev-outline" data-copy-dev-link>نسخ الرابط</button></section></div>`, 'المطورين', 'صلاحيات البوس');
}

function render() {
  const root = document.querySelector('#app');
  if (!root) return;
  try {
  const route = (window.location.pathname || '/').replace(/\/+$/, '') || '/';
  if (route === '/dev' && state.serverOwner) {
    document.querySelector('#app').innerHTML = developerView();
    bindEvents();
    return;
  }
  if (route === '/dev') window.history.replaceState({}, '', '/');
  if (route === '/setup-profile') {
    state.authScreen = 'forced-profile';
    state.active = 'feed';
  }
  if (route === '/home') {
    state.active = 'feed';
    state.authScreen = 'guest';
  }
  if (state.activeUser?.profileSetup === false && state.deviceTrusted) state.authScreen = 'forced-profile';
  if (state.active === 'moderation' && !['owner', 'moderator'].includes(state.activeUser?.role)) state.active = 'feed';
  if (state.authScreen === 'forced-profile') {
    document.querySelector('#app').innerHTML = forcedNameView();
    bindEvents();
    return;
  }
  if ((!state.activeUser && ['login', 'register', 'device'].includes(state.authScreen)) || (state.activeUser && !state.deviceTrusted)) {
    const authViews = { login: loginView, register: registerView, device: deviceBindView };
    document.querySelector('#app').innerHTML = state.authScreen === 'device' ? authViews.device() : authViews[state.authScreen]();
    bindEvents();
    return;
  }
  const views = { feed: feedView, explore: exploreView, saved: savedView, messages: messagesView, channel-chat: channelChatView, studio: studioView, spaces: spacesView, profile: profileView, settings: settingsView, 'profile-edit': profileEditView, developers: developerAppView, moderation: moderationView };
  document.querySelector('#app').innerHTML = views[state.active](); bindEvents();
  } catch (error) {
    console.error('NEXA render failed', error);
    root.innerHTML = `<main dir="rtl" style="min-height:100vh;display:grid;place-items:center;padding:24px;background:#071009;color:#f3fff4;font-family:system-ui,sans-serif;text-align:center"><section style="max-width:420px"><img src="/icon.svg" alt="NEXA" width="64" height="64" style="border-radius:16px"><h1>تعذر عرض الصفحة</h1><p>حدث خطأ أثناء تحميل الواجهة. بياناتك لم تُحذف؛ أعد تحميل الموقع للمحاولة مجددًا.</p><button id="reload-app" style="padding:12px 20px;border:0;border-radius:8px;background:#a8ff35;color:#071009;font-weight:700;cursor:pointer">إعادة تحميل الموقع</button></section></main>`;
    root.querySelector('#reload-app')?.addEventListener('click', () => window.location.reload());
  }
}
function toast(message) { state.toast = message; const el = document.createElement('div'); el.className = 'toast'; el.textContent = message; document.body.appendChild(el); setTimeout(() => el.remove(), 2200); }
function moderationMessage(error) {
  const messages = {
    CONTENT_REJECTED: 'تم رفض المحتوى لمخالفته إرشادات NEXA.',
    CONTENT_REQUIRES_REVIEW: 'تعذر اعتماد المحتوى آليًا؛ أعد صياغته بطريقة أوضح.',
    CONTENT_TOO_LONG: 'المحتوى أطول من الحد المسموح.',
    DEEPSEEK_NOT_CONFIGURED: 'فحص المحتوى غير مفعّل على الخادم حاليًا.',
    AI_MODERATION_UNAVAILABLE: 'فحص المحتوى متوقف مؤقتًا؛ لم يتم نشر المحتوى، حاول لاحقًا.',
    LINK_NOT_ALLOWED: 'هذا الرابط غير مسموح به.'
  };
  return messages[error?.message] || null;
}
function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character])); }
function setupVideoAutoplay() {
  const stream = document.querySelector('.stream-list');
  if (!stream) return;
  const videosOnPage = [...stream.querySelectorAll('[data-video]')];
  const startVideo = video => { video.muted = true; video.defaultMuted = true; video.play().catch(() => {}); };
  const observer = new IntersectionObserver(entries => entries.forEach(entry => {
    const video = entry.target;
    if (entry.isIntersecting && entry.intersectionRatio >= 0.65) {
      videosOnPage.filter(item => item !== video).forEach(item => item.pause());
      startVideo(video);
    } else {
      video.pause();
    }
  }), { root: stream, threshold: [0.2, 0.65, 0.9] });
  videosOnPage.forEach(video => { observer.observe(video); video.addEventListener('loadeddata', () => { if (video.closest('.video-card')?.getBoundingClientRect().top >= stream.getBoundingClientRect().top - 20) startVideo(video); }, { once: true }); });
  if (videosOnPage[0]) startVideo(videosOnPage[0]);
}
function bindEvents() {
  document.querySelectorAll('.dev-toggle.active:not([data-experiment-action])').forEach(button => {
    const status = document.createElement('span');
    status.className = button.className;
    status.setAttribute('role', 'status');
    status.textContent = button.textContent;
    button.replaceWith(status);
  });
  document.querySelectorAll('[data-feed-filter]').forEach(button => {
    button.classList.toggle('selected', button.dataset.feedFilter === state.feedFilter);
    button.addEventListener('click', () => {
      state.feedFilter = button.dataset.feedFilter;
      render();
    });
  });
  document.querySelectorAll('[data-preference]').forEach(button => button.addEventListener('click', async () => {
    const preference = button.dataset.preference;
    if (preference === 'theme') {
      state.uiTheme = button.dataset.value;
      state.eyeComfort = false;
      writeLocalValue('nexa-theme', state.uiTheme);
      writeLocalValue('nexa-eye-comfort', 'false');
    } else if (preference === 'eye-comfort') {
      state.eyeComfort = button.dataset.value === 'true';
      if (state.eyeComfort) state.uiTheme = 'light';
      writeLocalValue('nexa-theme', state.uiTheme);
      writeLocalValue('nexa-eye-comfort', String(state.eyeComfort));
    } else if (preference === 'text-scale') {
      state.textScale = button.dataset.value;
      writeLocalValue('nexa-text-scale', state.textScale);
    } else if (preference === 'reduce-motion') {
      state.motionReduced = button.dataset.value === 'true';
      writeLocalValue('nexa-reduced-motion', String(state.motionReduced));
    }
    applyDisplayPreferences();
    render();
    if (isAuthenticated() && (preference === 'theme' || preference === 'eye-comfort')) {
      try {
        await api('/api/me/settings', { method: 'PATCH', body: JSON.stringify({ theme: state.uiTheme }) });
        state.activeUser.theme = state.uiTheme;
        persistAuth();
      } catch {
        toast('تم تطبيق المظهر على هذا الجهاز، وتعذر حفظه في الحساب.');
      }
    }
  }));
  document.querySelectorAll('[data-refresh-content]').forEach(button => button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      await hydrateBackendContent();
      toast('تم تحديث المحتوى');
    } finally {
      button.disabled = false;
    }
  }));
  document.querySelectorAll('[data-remove-offline]').forEach(button => button.addEventListener('click', async () => {
    await removeOfflineAction(button.dataset.removeOffline);
    await refreshOfflineActions();
    render();
  }));
  document.querySelectorAll('[data-refresh-moderation]').forEach(button => button.addEventListener('click', async () => {
    try {
      state.moderationPosts = (await api('/api/moderation/posts')).posts || [];
      render();
    } catch {
      toast('تعذر تحميل قائمة المراجعة');
    }
  }));
  document.querySelectorAll('[data-moderation-decision]').forEach(button => button.addEventListener('click', async () => {
    try {
      await api(`/api/moderation/posts/${encodeURIComponent(button.dataset.postId)}`, { method: 'PATCH', body: JSON.stringify({ status: button.dataset.moderationDecision }) });
      state.moderationPosts = state.moderationPosts.filter(post => post.id !== button.dataset.postId);
      render();
      toast(button.dataset.moderationDecision === 'approved' ? 'تم اعتماد المنشور' : 'تم رفض المنشور');
    } catch {
      toast('تعذر حفظ قرار المراجعة');
    }
  }));
  const exploreSearch = document.querySelector('[data-explore-search]');
  if (exploreSearch) exploreSearch.addEventListener('submit', async event => {
    event.preventDefault();
    const query = String(new FormData(exploreSearch).get('q') || '').trim();
    if (!query) { state.searchResults = null; render(); return; }
    try {
      state.searchResults = { ...(await api(`/api/search?q=${encodeURIComponent(query)}`)), query };
      render();
    } catch { toast('تعذر تنفيذ البحث الآن'); }
  });
  document.querySelectorAll('[data-explore-tag]').forEach(button => button.addEventListener('click', () => {
    const input = document.querySelector('[data-explore-search] input');
    if (input) { input.value = button.dataset.exploreTag; input.form.requestSubmit(); }
  }));
  document.querySelectorAll('[data-clear-search]').forEach(button => button.addEventListener('click', async () => {
    state.searchResults = null;
    try { state.explore = await api('/api/explore'); } catch { /* keep the current view available */ }
    render();
  }));
  document.querySelectorAll('.channel-hero .primary-btn, .channels-page .page-heading .outline-btn').forEach(button => button.addEventListener('click', () => {
    state.active = 'spaces';
    state.spaceFilter = 'channels';
    render();
  }));
  document.querySelectorAll('.community-page .page-heading .primary-btn').forEach(button => button.addEventListener('click', async () => {
    if (!isAuthenticated()) { state.authScreen = 'login'; state.authPrompt = 'سجّل الدخول لإنشاء مجتمع'; render(); return; }
    const name = window.prompt('اسم المجتمع الجديد');
    if (!name?.trim()) return;
    const description = window.prompt('وصف المجتمع (اختياري)') || '';
    try {
      const { channel } = await api('/api/channels', { method: 'POST', body: JSON.stringify({ name: name.trim(), description: description.trim() }) });
      state.userCommunities.push({ id: channel.id, name: channel.name, desc: channel.description, members: 'أنت المؤسس' });
      persistUserCommunities();
      state.spaceFilter = 'communities';
      state.active = 'spaces';
      render();
      toast('تم إنشاء المجتمع');
    } catch (error) { toast(moderationMessage(error) || 'تعذر إنشاء المجتمع.'); }
  }));
  document.querySelectorAll('.community-feature .join-btn').forEach(button => button.addEventListener('click', () => {
    const id = button.dataset.joinSpace || 'future-tech';
    if (state.joinedSpaces.has(id)) state.joinedSpaces.delete(id);
    else state.joinedSpaces.add(id);
    persistJoinedSpaces();
    render();
    toast(state.joinedSpaces.has(id) ? 'انضممت إلى المجتمع' : 'غادرت المجتمع');
  }));
  document.querySelectorAll('.suggestions .section-heading button').forEach(button => button.addEventListener('click', async () => {
    button.disabled = true;
    try { await hydrateBackendContent(); toast('تم تحديث الاقتراحات'); }
    catch { toast('تعذر تحديث الاقتراحات الآن'); }
    finally { button.disabled = false; }
  }));
  document.querySelectorAll('.visual-more').forEach(button => button.addEventListener('click', async () => {
    const video = button.closest('.video-card');
    try {
      const shareData = { title: 'NEXA', text: video?.querySelector('.video-caption p')?.textContent || 'شاهد هذا الفيديو على NEXA', url: location.href };
      if (navigator.share) await navigator.share(shareData);
      else { await navigator.clipboard.writeText(shareData.url); toast('تم نسخ رابط الفيديو'); }
    } catch (error) { if (error.name !== 'AbortError') toast('تعذرت مشاركة الفيديو'); }
  }));
  document.querySelectorAll('.channel-hero .primary-btn, .channels-page .page-heading .outline-btn').forEach(button => button.addEventListener('click', () => {
    state.active = 'spaces';
    state.spaceFilter = 'channels';
    render();
  }));
  document.querySelectorAll('.community-page .page-heading .primary-btn').forEach(button => button.addEventListener('click', async () => {
    if (!isAuthenticated()) { state.authScreen = 'login'; state.authPrompt = 'سجّل الدخول لإنشاء مجتمع'; render(); return; }
    const name = window.prompt('اسم المجتمع الجديد');
    if (!name?.trim()) return;
    const description = window.prompt('وصف المجتمع (اختياري)') || '';
    try {
      const { channel } = await api('/api/channels', { method: 'POST', body: JSON.stringify({ name: name.trim(), description: description.trim() }) });
      state.userCommunities.push({ id: channel.id, name: channel.name, desc: channel.description, members: 'أنت المؤسس' });
      persistUserCommunities();
      state.spaceFilter = 'communities';
      state.active = 'spaces';
      render();
      toast('تم إنشاء المجتمع');
    } catch (error) { toast(moderationMessage(error) || 'تعذر إنشاء المجتمع.'); }
  }));
  document.querySelectorAll('.community-feature .join-btn').forEach(button => button.addEventListener('click', () => {
    const id = button.dataset.joinSpace || 'future-tech';
    if (state.joinedSpaces.has(id)) state.joinedSpaces.delete(id);
    else state.joinedSpaces.add(id);
    persistJoinedSpaces();
    render();
    toast(state.joinedSpaces.has(id) ? 'انضممت إلى المجتمع' : 'غادرت المجتمع');
  }));
  document.querySelectorAll('.suggestions .section-heading button').forEach(button => button.addEventListener('click', async () => {
    button.disabled = true;
    try { await hydrateBackendContent(); toast('تم تحديث الاقتراحات'); }
    catch { toast('تعذر تحديث الاقتراحات الآن'); }
    finally { button.disabled = false; }
  }));
  document.querySelectorAll('[data-local-google]').forEach(button => button.addEventListener('click', () => {
    window.location.assign(`${apiOrigin}/auth/google`);
  }));
  document.querySelectorAll('[data-logo-trigger]').forEach(button => button.addEventListener('click', async () => {
    if (state.serverOwner) { state.active = 'developers'; render(); return; }
    toast('بوابة المطورين متاحة للحسابات المصرح بها فقط');
  }));
  const integrationForm = document.querySelector('[data-integration-form]');
  if (integrationForm) {
    const integrationPanel = integrationForm.closest('.integration-panel');
    integrationPanel.innerHTML = '<div class="section-heading"><h3>تكاملات الخادم</h3><small>تُدار الأسرار عبر متغيرات بيئة الخادم فقط</small></div><ul class="link-audit-list" data-integration-status><li>جارٍ فحص الإعدادات...</li></ul>';
    api('/api/owner/ai/status').then(status => {
      integrationPanel.querySelector('[data-integration-status]').innerHTML = `<li>DeepSeek: ${status.enabled ? 'مهيأ' : 'غير مهيأ'}</li><li>Google OAuth: ${status.googleOAuthConfigured ? 'مهيأ' : 'غير مهيأ'}</li>`;
    }).catch(() => { integrationPanel.querySelector('[data-integration-status]').innerHTML = '<li>تعذر قراءة حالة التكاملات.</li>'; });
  }
  const developerPage = document.querySelector('.developer-app-page');
  if (developerPage && !developerPage.querySelector('[data-link-host-form]')) {
    const linkPanel = document.createElement('section');
    linkPanel.className = 'integration-panel';
    linkPanel.innerHTML = '<div class="section-heading"><h3>سياسة الروابط</h3><small>كل نطاق محظور افتراضيًا؛ السماح يشمل النطاقات الفرعية</small></div><form class="integration-form" data-link-host-form><label>النطاق المسموح<input name="host" placeholder="example.com" autocomplete="off" required /></label><button class="dev-primary" type="submit">إضافة نطاق</button></form><ul class="link-host-list" data-link-host-list><li>جارٍ تحميل القائمة...</li></ul><div class="section-heading"><h3>محاولات مرفوضة</h3></div><ul class="link-audit-list" data-link-audit-list><li>جارٍ تحميل السجل...</li></ul>';
    developerPage.insertBefore(linkPanel, developerPage.querySelector('.developer-chat'));
    const hostList = linkPanel.querySelector('[data-link-host-list]');
    const auditList = linkPanel.querySelector('[data-link-audit-list]');
    const refreshLinkPolicy = async () => {
      try {
        const data = await api('/api/owner/links');
        hostList.innerHTML = data.hosts.length ? data.hosts.map(host => `<li><code>${escapeHtml(host)}</code><button class="dev-outline" data-remove-link-host="${escapeHtml(host)}" aria-label="حذف ${escapeHtml(host)}">حذف</button></li>`).join('') : '<li>لا توجد نطاقات مسموحة.</li>';
        auditList.innerHTML = data.blockedAttempts.length ? data.blockedAttempts.map(item => `<li>${escapeHtml(new Date(item.createdAt).toLocaleString())} · ${escapeHtml(item.reason)}</li>`).join('') : '<li>لا توجد محاولات مسجلة.</li>';
      } catch {
        hostList.innerHTML = '<li>تعذر تحميل سياسة الروابط.</li>';
        auditList.innerHTML = '<li>تعذر تحميل السجل.</li>';
      }
    };
    linkPanel.querySelector('[data-link-host-form]').addEventListener('submit', async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const host = form.elements.host.value.trim();
      try {
        await api('/api/owner/links', { method: 'POST', body: JSON.stringify({ host }) });
        form.reset();
        await refreshLinkPolicy();
        toast('تم تحديث قائمة الروابط المسموحة');
      } catch (error) {
        toast(error.message === 'INVALID_LINK_HOST' ? 'أدخل اسم نطاق صالحًا مثل example.com.' : 'تعذر تحديث قائمة الروابط.');
      }
    });
    hostList.addEventListener('click', async event => {
      const button = event.target.closest('[data-remove-link-host]');
      if (!button) return;
      try {
        await api(`/api/owner/links/${encodeURIComponent(button.dataset.removeLinkHost)}`, { method: 'DELETE' });
        await refreshLinkPolicy();
        toast('تم حذف النطاق من القائمة');
      } catch { toast('تعذر حذف النطاق.'); }
    });
    refreshLinkPolicy();
  }
  const experimentForm = document.querySelector('[data-experiment-form]');
  const experimentList = document.querySelector('[data-experiment-list]');
  if (experimentForm) experimentForm.addEventListener('submit', event => { event.preventDefault(); const values = Object.fromEntries(new FormData(experimentForm)); experimentList.insertAdjacentHTML('beforeend', `<article class="experiment-row"><div><strong>${escapeHtml(values.name)}</strong><small>${escapeHtml(values.description || '')}</small><b>draft</b></div><div><button class="dev-toggle active" data-experiment-action="activate">تفعيل</button><button class="dev-outline" data-experiment-action="cancel">إلغاء</button></div></article>`); experimentForm.reset(); toast('تم إنشاء تجربة محلية'); });
  const chatForm = document.querySelector('[data-dev-chat-form]');
  if (chatForm) chatForm.addEventListener('submit', async event => { event.preventDefault(); const input = chatForm.elements.message; const message = input.value.trim(); if (!message) return; const log = document.querySelector('[data-dev-chat-log]'); log.insertAdjacentHTML('beforeend', `<p class="dev-chat-message user">${escapeHtml(message)}</p>`); input.value = ''; try { const result = await api('/api/owner/ai/ask', { method: 'POST', body: JSON.stringify({ prompt: message }) }); log.insertAdjacentHTML('beforeend', `<p class="dev-chat-message assistant">${escapeHtml(result.answer || 'لم تصل إجابة.')}</p>`); } catch (error) { log.insertAdjacentHTML('beforeend', `<p class="dev-chat-message assistant">تعذر الاتصال بالمساعد: ${escapeHtml(error.message)}</p>`); } log.scrollTop = log.scrollHeight; });
  document.querySelectorAll('[data-report-post]').forEach(el => el.addEventListener('click', async () => {
    if (!isAuthenticated()) { state.authScreen = 'login'; state.authPrompt = 'سجّل الدخول للإبلاغ عن المحتوى'; render(); return; }
    const reason = window.prompt('اكتب سبب الإبلاغ عن هذا المنشور:', 'محتوى غير مناسب');
    if (!reason || !reason.trim()) return;
    try {
      await api('/api/reports', { method: 'POST', body: JSON.stringify({ targetType: 'post', targetId: el.dataset.reportPost, reason: reason.trim() }) });
      toast('تم إرسال البلاغ إلى فريق المراجعة');
    } catch {
      toast('تعذر إرسال البلاغ');
    }
  }));
  document.querySelectorAll('[data-copy-dev-link]').forEach(button => button.addEventListener('click', async () => { try { await navigator.clipboard.writeText(`${location.origin}/dev`); toast('تم نسخ رابط المطورين'); } catch { toast(`${location.origin}/dev`); } }));
  document.querySelectorAll('[data-dev-action]').forEach(button => button.addEventListener('click', () => { toast('أرسل طلبك إلى البوس من بوابة API الخاصة بالمطورين.'); }));
  document.querySelectorAll('[data-dev-login]').forEach(button => button.addEventListener('click', () => { state.authScreen = 'login'; state.authPrompt = 'سجّل الدخول للمطالبة ببوابة المطورين'; window.history.replaceState({}, '', '/'); render(); }));
  document.querySelectorAll('[data-experiment-action]').forEach(button => button.addEventListener('click', () => {
    const row = button.closest('.experiment-row');
    if (!row) return;
    if (button.dataset.experimentAction === 'cancel') { row.remove(); toast('تم إلغاء التجربة'); return; }
    const status = row.querySelector('b');
    if (status) status.textContent = 'active';
    button.disabled = true;
    toast('تم تفعيل التجربة محليًا');
  }));
  const studioPanel = document.querySelector('.studio-panel');
  const studioNotice = document.querySelector('.studio-note p');
  if (studioNotice) studioNotice.innerHTML = '<strong>فحص محلي أساسي</strong><br />قواعد كلمات تعمل دون اتصال، وليست نموذج ذكاء اصطناعي.';
  if (studioPanel && !document.querySelector('#video-upload')) {
    studioPanel.insertAdjacentHTML('beforeend', '<div class="upload-control"><input id="video-upload" type="file" accept="video/*" hidden /><button type="button" data-upload-video disabled>رفع فيديو من جهازك <span>↑</span></button><label class="media-consent"><input id="media-moderation-consent" type="checkbox" /> أوافق على فحص الفيديو آليًا؛ عند تفعيل التكامل يُرسل إلى AWS، وتظل الوسائط مخفية حتى اجتياز الفحص أو مراجعة المشرف.</label><small>تتطلب الملفات غير المدعومة أو نتيجة الفحص المشكوك فيها مراجعة بشرية.</small></div>');
  }
  document.querySelectorAll('.mode-switch button').forEach(button => button.addEventListener('click', () => {
    const mode = button.textContent.trim();
    if (mode !== 'فيديو') { toast('وضع الصور والبث المباشر غير متاحين بعد؛ تصوير الفيديو يعمل الآن.'); return; }
    document.querySelectorAll('.mode-switch button').forEach(item => item.classList.toggle('selected', item === button));
    state.studioMode = 'video';
  }));
  const studioFilters = ['none', 'contrast(1.15) saturate(1.25)', 'grayscale(.35)', 'sepia(.28)', 'hue-rotate(24deg)', 'brightness(1.08) saturate(.85)'];
  document.querySelectorAll('.effects-grid .effect').forEach((button, index) => button.addEventListener('click', () => {
    state.studioEffect = index;
    document.querySelectorAll('.effects-grid .effect').forEach((item, itemIndex) => item.classList.toggle('selected', itemIndex === index));
    const preview = document.querySelector('.camera-preview');
    if (preview) preview.style.filter = studioFilters[index] || 'none';
    toast(index ? 'طُبق التأثير على معاينة الكاميرا' : 'أزيل التأثير');
  }));
  document.querySelectorAll('.studio-control').forEach((button, index) => button.addEventListener('click', async () => {
    if (index === 0) {
      state.studioFrameRate = state.studioFrameRate === 24 ? 30 : state.studioFrameRate === 30 ? 60 : 24;
      button.querySelector('small').textContent = `${state.studioFrameRate} FPS`;
      const track = state.cameraStream?.getVideoTracks()[0];
      try { if (track) await track.applyConstraints({ frameRate: { ideal: state.studioFrameRate, max: state.studioFrameRate } }); }
      catch { toast('لم يدعم الجهاز معدل الإطارات المختار'); }
      if (!track) toast(`سيبدأ التصوير القادم بمعدل ${state.studioFrameRate} إطارًا/ثانية`);
      return;
    }
    state.studioEffect = (state.studioEffect + 1) % studioFilters.length;
    const preview = document.querySelector('.camera-preview');
    if (preview) preview.style.filter = studioFilters[state.studioEffect];
    document.querySelectorAll('.effects-grid .effect').forEach((item, itemIndex) => item.classList.toggle('selected', itemIndex === state.studioEffect));
    toast('تم تغيير تأثير معاينة الكاميرا');
  }));
  document.querySelector('.studio-panel .panel-head .icon-btn')?.addEventListener('click', () => {
    const consent = document.querySelector('#media-moderation-consent');
    if (consent) { consent.closest('label')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); consent.focus(); }
    else toast('إعدادات التصوير تظهر عند اختيار فيديو في الاستوديو.');
  });
  document.querySelector('.effects-title button')?.addEventListener('click', () => {
    document.querySelector('.effects-grid .effect')?.focus();
    toast('كل التأثيرات المتاحة ظاهرة هنا.');
  });
  const moderationDisclaimer = document.createElement('small');
  moderationDisclaimer.className = 'local-moderation-note';
  moderationDisclaimer.textContent = 'الفحص المحلي يراجع النص فقط، ولا يحلل صورة الفيديو أو صوته. المراجعة السحابية تحتاج اتصالًا.';
  document.querySelector('.upload-control')?.append(moderationDisclaimer);
  const mediaConsent = document.querySelector('#media-moderation-consent');
  const uploadButton = document.querySelector('[data-upload-video]');
  if (mediaConsent && uploadButton) mediaConsent.addEventListener('change', () => { uploadButton.disabled = !mediaConsent.checked; });
  document.querySelectorAll('[data-upload-video]').forEach(button => button.addEventListener('click', () => document.querySelector('#video-upload')?.click()));
  const captureButton = document.querySelector('.capture');
  if (captureButton) captureButton.addEventListener('click', async () => {
    if (state.mediaRecorder?.state === 'recording') {
      state.mediaRecorder.stop();
      return;
    }
    if (!mediaConsent?.checked) { toast('وافق على فحص الفيديو قبل بدء التصوير'); return; }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { toast('التصوير غير مدعوم في هذا المتصفح؛ استخدم رفع فيديو'); return; }
    try {
      state.cameraStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: { facingMode: 'user', frameRate: { ideal: state.studioFrameRate, max: state.studioFrameRate } } });
      const preview = document.createElement('video');
      preview.className = 'camera-preview';
      preview.autoplay = true;
      preview.muted = true;
      preview.playsInline = true;
      preview.style.filter = studioFilters[state.studioEffect] || 'none';
      preview.srcObject = state.cameraStream;
      document.querySelector('.camera-frame')?.prepend(preview);
      const supportedType = ['video/webm;codecs=vp8,opus', 'video/webm'].find(type => MediaRecorder.isTypeSupported(type));
      state.mediaRecorder = new MediaRecorder(state.cameraStream, supportedType ? { mimeType: supportedType } : {});
      state.recordedChunks = [];
      state.mediaRecorder.addEventListener('dataavailable', event => { if (event.data.size) state.recordedChunks.push(event.data); });
      state.mediaRecorder.addEventListener('stop', () => {
        clearTimeout(state.recordingTimeout);
        const videoType = (state.mediaRecorder?.mimeType || 'video/webm').split(';')[0];
        const blob = new Blob(state.recordedChunks, { type: videoType });
        const extension = videoType === 'video/mp4' ? 'mp4' : 'webm';
        const file = new File([blob], `nexa-${Date.now()}.${extension}`, { type: videoType });
        state.cameraStream?.getTracks().forEach(track => track.stop());
        state.cameraStream = null;
        state.mediaRecorder = null;
        state.recordedChunks = [];
        preview.remove();
        captureButton.classList.remove('recording');
        if (file.size) queueVideoForPublishing(file).catch(error => toast(error.message === 'AUTH_REQUIRED' ? 'سجّل الدخول أولًا' : 'تعذر حفظ التسجيل'));
      }, { once: true });
      state.mediaRecorder.start(1000);
      captureButton.classList.add('recording');
      state.recordingTimeout = setTimeout(() => state.mediaRecorder?.stop(), 60000);
    } catch {
      state.cameraStream?.getTracks().forEach(track => track.stop());
      state.cameraStream = null;
      toast('تعذر الوصول إلى الكاميرا أو الميكروفون');
    }
  });
  document.querySelectorAll('.camera-top button').forEach(button => button.addEventListener('click', () => {
    if (state.mediaRecorder?.state === 'recording') state.mediaRecorder.stop();
  }));
  document.querySelectorAll('#video-upload').forEach(input => input.addEventListener('change', event => {
    const file = event.target.files?.[0];
    if (!file || !file.type.startsWith('video/')) return;
    queueVideoForPublishing(file).catch(error => toast(error.message === 'AUTH_REQUIRED' ? 'سجّل الدخول أولًا' : error.message === 'MEDIA_CONSENT_REQUIRED' ? 'وافق على فحص الوسائط قبل الرفع' : 'تعذر حفظ الفيديو على هذا الجهاز'));
  }));
  document.querySelectorAll('[data-auth-screen]').forEach(el => el.addEventListener('click', () => { state.authScreen = el.dataset.authScreen; state.authPrompt = ''; state.authError = ''; render(); }));
  document.querySelectorAll('[data-profile-edit]').forEach(el => el.addEventListener('click', () => { if (!isAuthenticated()) { state.authScreen = 'login'; state.authPrompt = 'سجّل الدخول لتعديل ملفك'; render(); return; } state.active = 'profile-edit'; render(); }));
  document.querySelectorAll('[data-share-profile]').forEach(el => el.addEventListener('click', async () => { const link = `${location.origin}/profile/${currentUser().username}`; try { await navigator.clipboard.writeText(link); toast('تم نسخ رابط البروفايل'); } catch { toast(link); } }));
  document.querySelectorAll('[data-profile-tab]').forEach(button => button.addEventListener('click', () => { state.profileTab = button.dataset.profileTab; render(); }));
  document.querySelectorAll('[data-profile-stat]').forEach(button => button.addEventListener('click', () => {
    if (button.dataset.profileStat === 'liked') { state.profileTab = 'liked'; render(); return; }
    const count = button.dataset.profileStat === 'following' ? state.subscribed.size : Number(currentUser().followers || 0);
    toast(count ? `${count} ${button.dataset.profileStat === 'following' ? 'حساب تتابعه' : 'متابع'}` : 'لا توجد حسابات هنا بعد.');
  }));
  document.querySelectorAll('[data-profile-video]').forEach(el => el.addEventListener('click', () => {
    const id = el.dataset.profileVideo;
    const localVideo = state.userVideos.find(item => (item.postId || item.id) === id);
    const remoteVideo = state.remotePosts.find(item => (item.postId || item.id) === id);
    if (localVideo) state.userVideos = [localVideo, ...state.userVideos.filter(item => item !== localVideo)];
    if (remoteVideo) state.remotePosts = [remoteVideo, ...state.remotePosts.filter(item => item !== remoteVideo)];
    if (!localVideo && !remoteVideo) return;
    state.active = 'feed';
    render();
  }));
  document.querySelectorAll('[data-space-filter]').forEach(button => button.addEventListener('click', () => {
    state.spaceFilter = button.dataset.spaceFilter;
    render();
  }));
  document.querySelectorAll('[data-create-space]').forEach(button => button.addEventListener('click', async () => {
    if (!isAuthenticated()) { state.authScreen = 'login'; state.authPrompt = 'سجّل الدخول لإنشاء قناة'; render(); return; }
    const name = window.prompt('اسم القناة الجديدة');
    if (!name?.trim()) return;
    const description = window.prompt('وصف القناة (اختياري)') || '';
    try {
      await api('/api/channels', { method: 'POST', body: JSON.stringify({ name: name.trim(), description: description.trim() }) });
      state.remoteChannels = (await api('/api/channels')).channels || [];
      state.spaceFilter = 'channels';
      render();
      toast('تم إنشاء القناة');
    } catch (error) { toast(moderationMessage(error) || 'تعذر إنشاء القناة.'); }
  }));
  document.querySelectorAll('[data-join-space]').forEach(button => button.addEventListener('click', () => {
    const id = button.dataset.joinSpace;
    if (state.joinedSpaces.has(id)) state.joinedSpaces.delete(id);
    else state.joinedSpaces.add(id);
    persistJoinedSpaces();
    render();
    toast(state.joinedSpaces.has(id) ? 'انضممت إلى المجتمع على هذا الجهاز' : 'غادرت المجتمع');
  }));
  document.querySelectorAll('[data-subscribe]').forEach(button => button.addEventListener('click', () => {
    if (!isAuthenticated()) { state.authScreen = 'login'; state.authPrompt = 'سجّل الدخول لمتابعة القنوات'; render(); return; }
    const id = button.dataset.subscribe;
    if (state.subscribed.has(id)) state.subscribed.delete(id);
    else state.subscribed.add(id);
    persistFollowing();
    render();
    toast(state.subscribed.has(id) ? 'تمت المتابعة' : 'ألغيت المتابعة');
  }));
  document.querySelectorAll('[data-channel-join]').forEach(button => button.addEventListener('click', async () => {
    if (!isAuthenticated()) { state.authScreen = 'login'; state.authPrompt = 'سجّل الدخول للانضمام إلى القناة'; render(); return; }
    const channel = state.remoteChannels.find(item => item.id === button.dataset.channelJoin);
    if (!channel) { toast('هذه قناة تجريبية؛ أنشئ قناة فعلية أو حدّث القائمة.'); return; }
    const method = channel.isMember ? 'DELETE' : 'POST';
    try {
      await api(`/api/channels/${encodeURIComponent(channel.id)}/${channel.isMember ? 'leave' : 'join'}`, { method, body: JSON.stringify({}) });
      state.remoteChannels = (await api('/api/channels')).channels || [];
      render();
      toast(method === 'POST' ? 'انضممت إلى القناة' : 'غادرت القناة');
    } catch (error) { toast(error.message === 'CHANNEL_PRIVATE' ? 'هذه القناة خاصة.' : 'تعذر تحديث عضوية القناة.'); }
  }));
  document.querySelectorAll('[data-enter-channel]').forEach(button => button.addEventListener('click', async () => {
    if (!isAuthenticated()) { state.authScreen = 'login'; state.authPrompt = 'سجّل الدخول لدخول القناة'; render(); return; }
    const channel = state.remoteChannels.find(item => item.id === button.dataset.enterChannel);
    if (!channel) { toast('القناة غير موجودة. حدّث قائمة المساحات.'); return; }
    try {
      if (!channel.isMember) await api(`/api/channels/${encodeURIComponent(channel.id)}/join`, { method: 'POST', body: JSON.stringify({}) });
      const result = await api(`/api/messages?channelId=${encodeURIComponent(channel.id)}`);
      state.activeChannelId = channel.id;
      state.channelMessages = result.messages || [];
      if (!channel.isMember) state.remoteChannels = (await api('/api/channels')).channels || [];
      state.active = 'channel-chat';
      render();
    } catch (error) { toast(error.message === 'CHANNEL_PRIVATE' ? 'هذه القناة خاصة.' : 'تعذر فتح القناة.'); }
  }));
  const channelComposer = document.querySelector('[data-channel-composer]');
  if (channelComposer) channelComposer.addEventListener('submit', async event => {
    event.preventDefault();
    const input = channelComposer.elements.body;
    const body = input.value.trim();
    if (!body) return;
    try {
      const result = await api('/api/messages', { method: 'POST', body: JSON.stringify({ channelId: state.activeChannelId, body }) });
      state.channelMessages.push({ ...result.message, sender: { id: state.activeUser.id, displayName: state.activeUser.displayName, username: state.activeUser.username } });
      render();
    } catch (error) { toast(moderationMessage(error) || 'تعذر إرسال الرسالة للقناة.'); }
  });
  document.querySelectorAll('[data-toggle-password]').forEach(el => el.addEventListener('click', () => { const input = el.parentElement.querySelector('input'); input.type = input.type === 'password' ? 'text' : 'password'; el.textContent = input.type === 'password' ? 'إظهار' : 'إخفاء'; }));
  document.querySelectorAll('[data-bell-button]').forEach(button => button.addEventListener('click', async () => {
    if (!isAuthenticated()) { state.authScreen = 'login'; state.authPrompt = 'سجّل الدخول لعرض إشعاراتك'; render(); return; }
    if (!state.notifications.length) {
      toast('لا توجد إشعارات جديدة');
      return;
    }
    const latest = state.notifications[0];
    toast(latest.payload?.message || 'لديك إشعار جديد');
    try {
      await api('/api/notifications/read', { method: 'POST', body: JSON.stringify({ ids: state.notifications.filter(item => !item.readAt).map(item => item.id) }) });
      state.unreadNotifications = 0;
      state.notifications = state.notifications.map(notification => ({ ...notification, readAt: notification.readAt || new Date().toISOString() }));
      render();
    } catch {
      // Ignore read-mark failure, keep UI responsive.
    }
  }));
  document.querySelectorAll('[data-logout]').forEach(button => button.addEventListener('click', async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch {
      // Do not block local logout if the API is unavailable.
    }
    clearSessionState();
    state.authScreen = 'login';
    render();
    toast('تم تسجيل الخروج بنجاح');
  }));
  const authForm = document.querySelector('[data-auth]');
  if (authForm) authForm.addEventListener('submit', async event => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(authForm));
    state.authLoading = true;
    state.authError = '';
    render();
    try {
      const result = await api(`/auth/${authForm.dataset.auth}`, { method: 'POST', body: JSON.stringify({ email: values.email, password: values.password }) });
      if (authForm.dataset.auth === 'register') {
        state.authLoading = false;
        state.authError = 'تم إنشاء الحساب. تحقق من بريدك الإلكتروني ثم سجّل الدخول.';
        render();
        return;
      }
      const needsProfileSetup = result.user.profileSetup === false || result.user.status === 'needs_profile_setup';
      state.activeUser = { ...result.user, avatar: (result.user.displayName || result.user.email).slice(0, 1).toUpperCase(), color: 'blue', profileSetup: !needsProfileSetup };
      state.pendingUser = needsProfileSetup ? state.activeUser : null;
      state.deviceTrusted = true;
      state.authLoading = false;
      state.authScreen = needsProfileSetup ? 'forced-profile' : 'guest';
      state.active = 'feed';
      persistAuth();
      if (needsProfileSetup) { render(); return; }
      await hydrateBackendContent();
      await syncOfflineActions();
      render();
    } catch (error) {
      state.authLoading = false;
      state.authError = authErrorMessage(error);
      render();
    }
  });
  document.querySelectorAll('[data-request-reset]').forEach(button => button.addEventListener('click', async () => {
    const email = window.prompt('أدخل البريد الإلكتروني المرتبط بحسابك');
    if (!email?.trim()) return;
    try {
      await api('/auth/request-password-reset', { method: 'POST', body: JSON.stringify({ email: email.trim() }) });
      state.authError = 'إذا كان البريد مرتبطًا بحساب، فستصلك رسالة استعادة قريبًا.';
    } catch (error) {
      state.authError = authErrorMessage(error);
    }
    render();
  }));
  const profileSetupForm = document.querySelector('[data-profile-setup]'); if (profileSetupForm) profileSetupForm.addEventListener('submit', event => { event.preventDefault(); saveProfileForm(profileSetupForm); });
  const profileEditForm = document.querySelector('[data-profile-edit-form]'); if (profileEditForm) profileEditForm.addEventListener('submit', event => { event.preventDefault(); saveProfileForm(profileEditForm); });
  const profilePage = document.querySelector('.profile-page');
  if (profilePage && isAuthenticated()) {
    const preferences = document.createElement('section');
    preferences.className = 'integration-panel email-notification-preference';
    preferences.innerHTML = `<label class="check-label"><input type="checkbox" data-email-notifications ${state.activeUser.notificationsEnabled !== false ? 'checked' : ''} /> إرسال تنبيهات NEXA إلى بريدي</label><small>نرسل إشعارًا عند الرسائل الجديدة وبعض أنشطة الحساب، ولا نضع نص الرسائل الخاصة في البريد.</small>`;
    profilePage.append(preferences);
    preferences.querySelector('[data-email-notifications]').addEventListener('change', async event => {
      const enabled = event.currentTarget.checked;
      try {
        await api('/api/me/settings', { method: 'PATCH', body: JSON.stringify({ notificationsEnabled: enabled }) });
        state.activeUser.notificationsEnabled = enabled;
        persistAuth();
        toast(enabled ? 'تم تفعيل تنبيهات البريد' : 'تم إيقاف تنبيهات البريد');
      } catch {
        event.currentTarget.checked = !enabled;
        toast('تعذر تحديث إعداد البريد.');
      }
    });
  }
  document.querySelectorAll('[data-bind-device]').forEach(el => el.addEventListener('click', () => { state.authLoading = true; render(); setTimeout(() => { state.activeUser = state.pendingUser; state.accounts = [...new Map([...state.accounts, state.activeUser].map(user => [user.email, user])).values()]; state.deviceTrusted = true; state.authLoading = false; state.authScreen = state.activeUser.profileSetup === false ? 'forced-profile' : 'guest'; persistAuth(); render(); toast('تم توثيق الجهاز وفتح NEXA'); }, 450); }));
  document.querySelectorAll('[data-add-account]').forEach(el => el.addEventListener('click', () => { state.authScreen = 'login'; state.activeUser = null; state.deviceTrusted = false; state.pendingUser = null; render(); }));
  document.querySelectorAll('[data-switch-account]').forEach(el => el.addEventListener('click', () => { if (state.accounts.length < 2) { toast('أضف حساباً آخر أولاً'); return; } const index = state.accounts.findIndex(user => user.email === state.activeUser.email); state.activeUser = state.accounts[(index + 1) % state.accounts.length]; persistAuth(); render(); toast(`تم التبديل إلى ${state.activeUser.username}`); }));
  document.querySelectorAll('[data-nav]').forEach(el => el.addEventListener('click', async () => { const destination = el.dataset.nav; if ((el.dataset.requiresAuth !== undefined || ['studio', 'messages', 'communities'].includes(destination)) && !isAuthenticated()) { state.authScreen = 'login'; state.authPrompt = 'سجّل الدخول لاستخدام هذه الميزة'; render(); return; } if (destination === 'developers' && !state.serverOwner) { try { const result = await api('/api/owner/claim', { method: 'POST', body: JSON.stringify({}) }); state.serverOwner = result.owner === true; if (result.user) state.activeUser = { ...state.activeUser, ...result.user }; } catch (error) { toast(error.message === 'DEVELOPER_AREA_LOCKED' ? 'واجهة المطورين محجوزة لأول مالك تم تسجيله' : 'تعذر فتح واجهة المطورين'); return; } } if (destination === 'moderation') { try { state.moderationPosts = (await api('/api/moderation/posts')).posts || []; } catch { toast('تعذر تحميل قائمة المراجعة'); return; } } state.active = destination; render(); }));
  document.querySelectorAll('[data-like]').forEach(el => el.addEventListener('click', async () => { const id = el.dataset.like; if (!isAuthenticated()) { state.authScreen = 'login'; render(); return; } try { const { active } = await api(`/api/posts/${id}/like`, { method: 'POST' }); active ? state.liked.add(id) : state.liked.delete(id); render(); } catch { toast('تعذر تحديث الإعجاب'); } }));
  document.querySelectorAll('[data-save]').forEach(el => el.addEventListener('click', async () => { const id = el.dataset.save; if (!isAuthenticated()) { state.authScreen = 'login'; render(); return; } try { const { active } = await api(`/api/posts/${id}/save`, { method: 'POST' }); active ? state.saved.add(id) : state.saved.delete(id); toast(active ? 'تم حفظ المنشور' : 'أزيل من المحفوظات'); render(); } catch { toast('تعذر تحديث المحفوظات'); } }));
  document.querySelectorAll('[data-comment-post]').forEach(el => el.addEventListener('click', async () => { if (!isAuthenticated()) { state.authScreen = 'login'; state.authPrompt = 'سجّل الدخول للتعليق'; render(); return; } const body = window.prompt('اكتب تعليقك'); if (!body?.trim()) return; try { await api(`/api/posts/${el.dataset.commentPost}/comments`, { method: 'POST', body: JSON.stringify({ body }) }); toast('تم نشر التعليق'); } catch (error) { toast(moderationMessage(error) || 'تعذر نشر التعليق'); } }));
  document.querySelectorAll('.video-actions .action:not([data-like]):not([data-save]):not([data-comment-post]):not([data-report-post])').forEach(button => button.addEventListener('click', async () => {
    const video = button.closest('.video-card')?.querySelector('[data-video]');
    const shareData = { title: 'NEXA', text: video?.closest('.video-card')?.querySelector('.video-caption p')?.textContent || 'شاهد هذا الفيديو على NEXA', url: location.href };
    try {
      if (navigator.share) await navigator.share(shareData);
      else if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(shareData.url); toast('تم نسخ رابط NEXA'); }
      else toast(shareData.url);
    } catch (error) {
      if (error.name !== 'AbortError') toast('تعذرت مشاركة الرابط');
    }
  }));
  document.querySelectorAll('[data-follow-person]').forEach(el => el.addEventListener('click', async () => { if (!isAuthenticated()) { state.authScreen = 'login'; render(); return; } try { const { following } = await api(`/api/users/${el.dataset.followPerson}/follow`, { method: 'POST' }); following ? state.subscribed.add(el.dataset.followPerson) : state.subscribed.delete(el.dataset.followPerson); persistFollowing(); toast(following ? 'تمت متابعة الشخص' : 'تم إلغاء المتابعة'); render(); } catch { toast('تعذر تحديث المتابعة'); } }));
  document.querySelectorAll('[data-play]').forEach(el => el.addEventListener('click', event => { event.stopPropagation(); const video = document.querySelector(`[data-video="${el.dataset.play}"]`); if (!video) return; if (video.paused) video.play().catch(() => {}); else video.pause(); }));
  document.querySelectorAll('[data-auth-action]').forEach(el => el.addEventListener('click', () => { if (!isAuthenticated()) { state.authScreen = 'login'; state.authPrompt = 'سجّل الدخول للتفاعل مع الفيديو'; render(); } }));
  document.querySelectorAll('[data-chat]').forEach(el => {
    el.addEventListener('click', async () => {
      state.selectedRecipientId = el.dataset.chat;
      await hydrateBackendMessages();
      render();
    });
  });
  const messageSearch = document.querySelector('[data-message-search]');
  const applyMessageFilters = () => {
    const query = String(messageSearch?.value || '').trim().toLocaleLowerCase();
    const unreadSenders = new Set(state.notifications.filter(item => item.type === 'message' && !item.readAt).map(item => item.payload?.actorId));
    const rows = [...document.querySelectorAll('.chat-row')];
    rows.forEach(row => {
      const matchesQuery = row.textContent.toLocaleLowerCase().includes(query);
      const matchesFilter = state.messageFilter === 'all' || (state.messageFilter === 'unread' && unreadSenders.has(row.dataset.chat));
      row.hidden = !matchesQuery || !matchesFilter;
    });
    const empty = document.querySelector('[data-chat-list-empty]');
    if (empty) {
      const visible = rows.some(row => !row.hidden);
      empty.hidden = visible;
      empty.textContent = state.messageFilter === 'groups' ? 'لا توجد مجموعات في حسابك بعد.' : query ? 'لا توجد محادثات تطابق بحثك.' : 'لا توجد محادثات في هذا التبويب.';
    }
  };
  messageSearch?.addEventListener('input', applyMessageFilters);
  applyMessageFilters();
  document.querySelectorAll('[data-message-filter]').forEach(button => button.addEventListener('click', () => {
    state.messageFilter = button.dataset.messageFilter;
    document.querySelectorAll('[data-message-filter]').forEach(tab => tab.classList.toggle('selected', tab === button));
    applyMessageFilters();
  }));
  document.querySelector('[data-new-chat]')?.addEventListener('click', async () => {
    if (!state.conversationUsers.length) await hydrateBackendMessages();
    messageSearch?.focus();
    toast(state.conversationUsers.length ? 'ابحث عن شخص ثم اختره لبدء المحادثة.' : 'لا يوجد مستخدمون آخرون لبدء محادثة معهم بعد.');
  });
  document.querySelectorAll('[data-chat-action="search"]').forEach(button => button.addEventListener('click', () => document.querySelector('#message-input')?.focus()));
  document.querySelectorAll('[data-chat-action="details"]').forEach(button => button.addEventListener('click', () => toast(`محادثة مع ${state.conversationUsers.find(item => item.userId === state.selectedRecipientId)?.name || 'المستخدم'}`)));
  document.querySelector('[data-insert-emoji]')?.addEventListener('click', () => {
    const input = document.querySelector('#message-input');
    if (!input) return;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    input.setRangeText('🙂', start, end, 'end');
    input.focus();
  });
  const pendingStreamList = document.querySelector('.stream-list');
  if (pendingStreamList) {
    const pendingVideos = state.offlineActions.filter(action => action.type === 'video' && action.userId === state.activeUser?.id);
    if (pendingVideos.length) {
      pendingStreamList.insertAdjacentHTML('afterbegin', pendingVideos.map(action => `<article class="offline-video-item"><strong>فيديو محفوظ على هذا الجهاز</strong><small>${escapeHtml(action.file.name)}</small><small>${action.status === 'needs-review' ? 'تعذرت المزامنة؛ احذف العنصر أو أعد المحاولة لاحقًا.' : 'سينشر بعد عودة الاتصال.'}</small><button class="offline-remove" data-remove-offline="${escapeHtml(action.id)}">حذف</button></article>`).join(''));
    }
  }
  const form = document.querySelector('.composer:not([data-channel-composer])'); if (form) form.addEventListener('submit', async event => {
    event.preventDefault();
    const input = document.querySelector('#message-input');
    const text = input.value.trim();
    const recipientId = state.selectedRecipientId || state.conversationUsers[0]?.userId;
    if (!text) return;
    if (!recipientId) { toast('افتح محادثة متاحة قبل إرسال الرسالة'); return; }
    if (localModerationCheck(text)) { toast('لم تُرسل الرسالة: رفضها الفحص المحلي'); return; }
    const action = { id: crypto.randomUUID(), type: 'message', userId: state.activeUser?.id, recipientId, body: text };
    input.value = '';
    try {
      await enqueueAction(action);
      await syncOfflineActions();
      render();
      toast(navigator.onLine ? 'حُفظت الرسالة وبدأ إرسالها' : 'حُفظت الرسالة على الجهاز وستُرسل عند عودة الاتصال');
    } catch {
      input.value = text;
      toast('تعذر حفظ الرسالة على هذا الجهاز');
    }
  });
  const streamList = document.querySelector('.stream-list'); if (streamList) { let startY = 0; streamList.addEventListener('touchstart', event => { startY = event.touches[0].clientY; }, { passive: true }); streamList.addEventListener('touchend', event => { const delta = startY - event.changedTouches[0].clientY; if (Math.abs(delta) > 60) { const cards = [...streamList.querySelectorAll('.video-card')]; const current = Math.max(0, cards.findIndex(card => card.getBoundingClientRect().top >= streamList.getBoundingClientRect().top)); const next = delta > 0 ? cards[Math.min(current + 1, cards.length - 1)] : cards[Math.max(current - 1, 0)]; next?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } }, { passive: true }); }
  setupVideoAutoplay();
}

render();
hydrateBackendSession();
hydrateBackendContent();
refreshOfflineActions().then(() => syncOfflineActions());
window.addEventListener('online', () => {
  state.online = true;
  updateOfflineIndicator();
  syncOfflineActions();
});
window.addEventListener('offline', () => {
  state.online = false;
  updateOfflineIndicator();
});