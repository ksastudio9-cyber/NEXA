import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const serviceWorker = fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
const schema = fs.readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
const sql = fs.readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');

test('social API exposes persistent content operations', () => {
  for (const route of ['/api/feed', '/api/posts', '/api/messages', '/api/channels', '/api/media']) {
    assert.match(server, new RegExp(route.replaceAll('/', '\\/')));
  }
  assert.match(server, /postAction = url\.pathname\.match/);
  assert.match(server, /like\|save/);
});

test('channel membership is persistent and protects channel message access', () => {
  assert.match(schema, /model ChannelMember[\s\S]*?@@map\("channel_members"\)/);
  assert.match(server, /channelMembershipRoute = url\.pathname\.match/);
  assert.match(server, /channelMember\.upsert/);
  assert.match(server, /CHANNEL_MEMBERSHIP_REQUIRED/);
  assert.match(server, /channel\.members\?\.length/);
  const app = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(app, /data-enter-channel/);
  assert.match(app, /data-channel-composer/);
  assert.match(app, /channelId: state\.activeChannelId/);
  assert.match(app, /'channel-chat': channelChatView/);
});

test('authenticated users can discover chat recipients with public profile fields only', () => {
  assert.match(server, /url\.pathname === '\/api\/users'[\s\S]*?authenticatedUser\(request\)/);
  assert.match(server, /select: \{ id: true, username: true, displayName: true, avatarUrl: true, verification: true \}/);
  const app = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(app, /api\('\/api\/users'\)/);
  assert.match(app, /cacheConversation\(`contacts:\$\{state\.activeUser\.id\}`/);
});

test('database schema contains persistent interactions and auth tokens', () => {
  for (const model of ['model PostLike', 'model PostSave', 'model EmailToken']) assert.match(schema, new RegExp(model));
  for (const table of ['post_likes', 'post_saves', 'email_tokens']) assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
});

test('developer access is checked by the server owner role', () => {
  assert.match(server, /url\.pathname === '\/api\/owner\/status'/);
  assert.match(server, /user\?\.role === 'owner'/);
  assert.doesNotMatch(server, /localStorage/);
});

test('the first verified the_x username can claim owner privileges only once', () => {
  assert.match(server, /username\?\.toLowerCase\(\) !== 'the_x'/);
  assert.match(server, /wantsOwner/);
  assert.match(server, /user\.emailVerified !== true/);
  assert.match(server, /redis\.set\(INITIAL_OWNER_CLAIM_KEY, user\.id, 'EX', 300, 'NX'\)/);
  assert.match(server, /OWNER_ALREADY_ASSIGNED/);
  assert.doesNotMatch(server, /OWNER_BOOTSTRAP_NOT_ALLOWED/);
  assert.doesNotMatch(server, /role:\s*firstUser\s*===\s*0\s*\?\s*'owner'/);
});

test('state-changing API requests require CSRF protection', () => {
  assert.match(server, /url\.pathname === '\/api\/csrf'/);
  assert.match(server, /CSRF_INVALID/);
  assert.match(server, /X-CSRF-Token/);
});

test('frontend hydrates real conversations and accepts the server owner role', () => {
  const app = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(app, /hydrate.*Messages|load.*Conversation|selected.*recipient/i);
  assert.match(app, /role === 'owner'|role === 'boss'/i);
});

test('login UI matches backend password rules, explains service failures, and wires password reset', () => {
  const app = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(app, /function authErrorMessage\(error\)/);
  assert.match(app, /SERVICES_UNAVAILABLE/);
  assert.match(app, /data-request-reset/);
  assert.match(app, /minlength="8"/);
  assert.match(app, /auth\/request-password-reset/);
});

test('corrupt browser storage and render exceptions cannot leave an empty app root', () => {
  const app = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(app, /function readLocalJson\([\s\S]*?JSON\.parse\(readLocalValue\([\s\S]*?return fallback/);
  assert.match(app, /isUserRecord\(user\)/);
  assert.doesNotMatch(app, /nexa-users.*removeLocalValue|removeLocalValue\).*nexa-accounts/);
  assert.match(app, /NEXA render failed/);
  assert.match(app, /تعذر عرض الصفحة/);
  assert.match(app, /id="reload-app"/);
  assert.match(app, /controllerchange'[\s\S]*?window\.location\.reload/);
  assert.match(app, /registration\.update\(\)/);
});

test('Google profile setup hydrates its pending user and persists completed status', () => {
  const app = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(app, /state\.pendingUser = needsProfileSetup \? state\.activeUser : null/);
  assert.match(app, /state\.authScreen = needsProfileSetup \? 'forced-profile' : 'guest'/);
  assert.match(server, /saveAccountProfile\(user, \{ \.\.\.parsed\.data, status: 'active' \}\)/);
  assert.match(server, /JSON\.stringify\(buildSessionUser\(updated\)\)/);
  assert.match(server, /needsProfileSetup \? '\/setup-profile' : '\/home'/);
  const saveProfile = app.match(/async function saveProfileForm\(form\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(saveProfile, /state\.active = 'feed'/);
  assert.match(saveProfile, /state\.authScreen = 'guest'/);
  assert.doesNotMatch(saveProfile, /authScreen = 'device'/);
  assert.match(saveProfile, /authErrorMessage\(error\)/);
  assert.match(server, /error\.code === 'P2002'[\s\S]*?USERNAME_IN_USE/);
});

test('Google and email signup persist addresses and require profile completion', () => {
  assert.match(server, /const email = String\(profile\.email \|\| ''\)\.trim\(\)\.toLowerCase\(\)/);
  assert.match(server, /emailVerified: true, status: 'needs_profile_setup'/);
  assert.match(server, /provider: 'google', providerSubject/);
  assert.match(server, /email, displayName: usernameBase, username: generatedUsername[\s\S]*?status: 'needs_profile_setup'/);
  assert.match(server, /status: 'needs_profile_setup'[\s\S]*?identities: \{ create: \{ provider: 'email'/);
  assert.match(server, /profile\.email_verified !== true/);
});

test('new direct messages trigger email notifications without exposing message text', () => {
  assert.match(server, /async function pushNotification[\s\S]*?recipient\?\.notificationsEnabled && recipient\.emailVerified === true/);
  assert.match(server, /sendAccountNotification\(\{ to: recipient\.email, subject: 'إشعار جديد من NEXA', text: body \}\)/);
  assert.match(server, /pushNotification\(recipientId, 'message', \{ actorId: user\.id, actorName: user\.username \|\| user\.displayName, message: `أرسل لك @\$\{user\.username \|\| user\.displayName\} رسالة جديدة\. افتح NEXA لقراءتها\.` \}\)/);
  const mailer = fs.readFileSync(new URL('../server/mailer.js', import.meta.url), 'utf8');
  assert.match(mailer, /Boolean\(process\.env\.SMTP_HOST && process\.env\.SMTP_USER && process\.env\.SMTP_PASS\)/);
});

test('username rules are shared by the browser and API', () => {
  const app = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const validation = fs.readFileSync(new URL('../shared/validation.js', import.meta.url), 'utf8');
  assert.match(validation, /\^\[A-Za-z\]\[A-Za-z0-9_\]\{2,19\}\$/);
  assert.match(app, /USERNAME_PATTERN\.test\(username\)/);
  assert.match(server, /z\.string\(\)\.regex\(USERNAME_PATTERN\)/);
  assert.match(server, /mode: 'insensitive'/);
});

test('authenticated users can fetch and clear notifications from the backend', () => {
  assert.match(server, /\/api\/notifications/);
  assert.match(server, /mark.*read|readAt|read_at/i);
});

test('authenticated users can sign out cleanly from the UI and API', () => {
  const app = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(server, /\/auth\/logout/);
  assert.match(app, /data-logout|logout/i);
});

test('moderation and report workflows exist for owner and moderator controls', () => {
  assert.match(server, /\/api\/reports/);
  assert.match(server, /\/api\/moderation\/reports/);
  assert.match(server, /ReportStatus|moderationLogs|reporterId/i);
});

test('text moderation runs before user-generated content is stored', () => {
  for (const route of [
    /request\.method === 'POST' && url\.pathname === '\/api\/posts'[\s\S]*?submittedContentCheck\([\s\S]*?prisma\.post\.create/,
    /postRoute[\s\S]*?submittedContentCheck\(text\)[\s\S]*?prisma\.post\.update/,
    /request\.method === 'POST' && commentsRoute[\s\S]*?submittedContentCheck\(text\)[\s\S]*?prisma\.comment\.create/,
    /request\.method === 'POST' && url\.pathname === '\/api\/messages'[\s\S]*?submittedContentCheck\(text\)[\s\S]*?prisma\.message\.create/,
    /request\.method === 'PATCH' && url\.pathname === '\/api\/me'[\s\S]*?submittedContentCheck\([\s\S]*?prisma\.user\.update/,
    /request\.method === 'POST' && url\.pathname === '\/api\/channels'[\s\S]*?submittedContentCheck\([\s\S]*?transaction\.channel\.create/,
    /channelRoute[\s\S]*?submittedContentCheck\([\s\S]*?prisma\.channel\.update/
  ]) assert.match(server, route);
});

test('DeepSeek moderation runs server-side before storing text and caches low-cost decisions', () => {
  const moderation = fs.readFileSync(new URL('../server/deepseek-moderation.js', import.meta.url), 'utf8');
  assert.match(server, /inspectTextWithDeepSeek\(aiText, \{ cache: redis \}\)/);
  assert.match(server, /DEEPSEEK_NOT_CONFIGURED/);
  assert.match(server, /AI_MODERATION_UNAVAILABLE/);
  assert.match(moderation, /https:\/\/api\.deepseek\.com\/chat\/completions/);
  assert.match(moderation, /max_tokens: 80/);
  assert.match(moderation, /CACHE_TTL_SECONDS = 24 \* 60 \* 60/);
  assert.match(moderation, /defamation[\s\S]*incitement[\s\S]*sexual_content/);
});

test('owner link policies are server-authorized and applied to submitted text', () => {
  assert.match(server, /url\.pathname === '\/api\/owner\/links'[\s\S]*?user\.role !== 'owner'/);
  assert.match(server, /ownerLinkRoute[\s\S]*?user\.role !== 'owner'[\s\S]*?redis\.srem/);
  assert.match(server, /redis\.sadd\(LINK_ALLOWLIST_KEY/);
  assert.match(server, /linkCheck\(value, allowedHosts\)/);
  assert.match(server, /action: 'link_blocked'/);
  const app = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(app, /api\('\/api\/owner\/links'\)/);
  assert.match(app, /data-remove-link-host/);
});

test('new posts stay hidden from public feeds until moderator approval', () => {
  assert.match(schema, /moderationStatus String\s+@default\("approved"\)/);
  assert.match(sql, /moderation_status TEXT NOT NULL DEFAULT 'approved'/);
  assert.match(server, /moderationStatus: 'pending'/);
  assert.match(server, /moderationStatus: 'approved', visibility: 'public'/);
  assert.match(server, /url\.pathname === '\/api\/moderation\/posts'/);
  assert.match(server, /moderationStatus !== 'approved'/);
  assert.match(server, /action: `content_\$\{status\}`/);
});

test('video moderation jobs are started, associated with posts, and polled', () => {
  const app = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const compose = fs.readFileSync(new URL('../docker-compose.yml', import.meta.url), 'utf8');
  assert.match(server, /StartContentModerationCommand/);
  assert.match(server, /redis\.set\(`media_moderation:/);
  assert.match(server, /processPendingMediaModeration/);
  assert.match(server, /MEDIA_MODERATION_UNAVAILABLE/);
  assert.match(server, /mediaModerationEnabled\(\)/);
  assert.match(app, /moderationJobId/);
  assert.match(app, /media-moderation-consent/);
  assert.match(app, /عند تفعيل التكامل يُرسل إلى AWS/);
  assert.match(schema, /moderationJobId\s+String\?/);
  assert.match(compose, /AWS_REKOGNITION_SNS_TOPIC_ARN/);
});

test('video uploads enforce request-size and in-process concurrency limits', () => {
  assert.match(server, /MAX_MEDIA_UPLOAD_BYTES = 100 \* 1024 \* 1024/);
  assert.match(server, /MAX_CONCURRENT_MEDIA_UPLOADS = 2/);
  assert.match(server, /MEDIA_TOO_LARGE/);
  assert.match(server, /UPLOAD_CAPACITY_REACHED/);
});

test('text moderation preview uses the same central blocklist', () => {
  assert.match(server, /url\.pathname === '\/api\/moderation\/check'[\s\S]*?contentCheck\(body\.text\)/);
});

test('service worker never caches authenticated API or auth responses', () => {
  assert.match(serviceWorker, /CACHE_NAME = 'nexa-cache-v6'/);
  assert.match(serviceWorker, /pathname\.startsWith\('\/api\/'\)/);
  assert.match(serviceWorker, /pathname\.startsWith\('\/auth\/'\)/);
  assert.match(serviceWorker, /if \(pathname === '\/api'[\s\S]*?return;/);
});

test('Codespaces previews unregister stale service workers and bypass cache-first app assets', () => {
  const app = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(serviceWorker, /isCodespacesPreview = \/\^\[a-z0-9-\]\+\-5173\\\.app\\\.github\\\.dev\$\/i/);
  assert.match(serviceWorker, /self\.registration\.unregister\(\)/);
  assert.match(serviceWorker, /event\.respondWith\(fetch\(event\.request\)\)/);
  assert.match(app, /if \(import\.meta\.env\.DEV\)[\s\S]*?registration\.unregister\(\)/);
});

test('offline outbox persists messages and media and uses stable retry identifiers', () => {
  const app = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const offlineStore = fs.readFileSync(new URL('../src/offline-store.js', import.meta.url), 'utf8');
  assert.match(app, /queueOfflineAction\(/);
  assert.match(app, /window\.addEventListener\('online'/);
  assert.match(app, /clientId: action\.id/);
  assert.match(app, /form\.append\('uploadId', action\.id\)/);
  assert.match(app, /navigator\.mediaDevices\?\.getUserMedia/);
  assert.match(app, /new MediaRecorder\(/);
  assert.match(offlineStore, /indexedDB\.open/);
  assert.match(server, /media_upload:\$\{user\.id\}:\$\{uploadId\}/);
  assert.match(server, /existingMessage = await prisma\.message\.findUnique/);
  assert.match(server, /existingPost = await prisma\.post\.findUnique/);
});

test('owner telemetry and audit access exist for production-grade governance', () => {
  const app = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(server, /\/api\/audit/);
  assert.match(app, /audit|telemetry|metrics/i);
});

test('production deployment config exists for web hosting and container runtime', () => {
  const dockerfile = fs.existsSync(new URL('../Dockerfile', import.meta.url)) ? fs.readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8') : '';
  const compose = fs.readFileSync(new URL('../docker-compose.yml', import.meta.url), 'utf8');
  assert.match(server, /server\.listen\(port, process\.env\.HOST \|\| '0\.0\.0\.0'/);
  assert.match(dockerfile, /FROM node:22-alpine/);
  assert.match(dockerfile, /EXPOSE 5173/);
  assert.match(dockerfile, /npm ci/);
  assert.match(dockerfile, /USER node/);
  assert.match(compose, /image:.*nexa|build:/i);
});

test('PWA install metadata references generated Android and Apple icons', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'));
  const appHtml = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const logo = fs.readFileSync(new URL('../public/icon.svg', import.meta.url), 'utf8');
  const brandStyles = fs.readFileSync(new URL('../src/brand-refresh.css', import.meta.url), 'utf8');
  for (const path of ['/icon-192.png', '/icon-512.png', '/icon-maskable-512.png', '/apple-touch-icon.png']) {
    assert.ok(fs.existsSync(new URL(`../public${path}`, import.meta.url)), `${path} should exist`);
  }
  assert.match(appHtml, /apple-touch-icon\.png/);
  assert.match(logo, /fill="#071009"/);
  assert.match(logo, /fill="#a8ff35"/);
  assert.match(brandStyles, /background: #071009 url\('\/icon\.svg'\)/);
  assert.equal(manifest.icons.length, 3);
  assert.match(server, /'\.webmanifest': 'application\/manifest\+json; charset=utf-8'/);
  assert.match(server, /'\.png': 'image\/png'/);
});

test('database baseline stays in sync and production applies migrations before startup', () => {
  const migration = fs.readFileSync(new URL('../prisma/migrations/20261001000000_initial_schema/migration.sql', import.meta.url), 'utf8');
  const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const dockerfile = fs.readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
  assert.equal(migration.trimEnd(), sql.trimEnd());
  assert.match(schema, /@@map\("users"\)/);
  assert.match(packageJson.scripts['db:migrate'], /prisma migrate deploy/);
  assert.match(packageJson.scripts['db:baseline'], /prisma migrate resolve --applied/);
  assert.match(packageJson.scripts['db:migrate:local'], /--env-file=\.env\.local/);
  assert.match(packageJson.scripts['dev:all'], /db:migrate:local && concurrently/);
  assert.match(dockerfile, /npm run db:migrate && node server\/index\.js/);
});

test('legacy Prisma migration renames User without dropping the table', () => {
  const migration = fs.readFileSync(new URL('../prisma/migrations/20261002000000_upgrade_legacy_prisma_schema/migration.sql', import.meta.url), 'utf8');
  assert.match(migration, /ALTER TABLE public\."User" RENAME TO users/);
  assert.match(migration, /ALTER COLUMN %I TYPE TEXT USING %I::text/);
  assert.doesNotMatch(migration, /DROP TABLE.*User/i);
});

test('object storage supports managed AWS S3 and keeps local MinIO optional', () => {
  const services = fs.readFileSync(new URL('../server/services.js', import.meta.url), 'utf8');
  const compose = fs.readFileSync(new URL('../docker-compose.yml', import.meta.url), 'utf8');
  assert.match(services, /storageProvider === 'aws'/);
  assert.match(services, /process\.env\.AWS_ACCESS_KEY_ID/);
  assert.match(services, /!process\.env\[key\]\.trim\(\)/);
  assert.match(services, /must be configured together/);
  assert.match(compose, /S3_PROVIDER: \$\{S3_PROVIDER:-minio\}/);
  assert.match(compose, /profiles: \[local-storage\]/);
  assert.match(compose, /bitnamilegacy\/minio:2025\.5\.24-debian-12-r5/);
});

test('the app has one public origin and keeps the development backend private', () => {
  const vite = fs.readFileSync(new URL('../vite.config.js', import.meta.url), 'utf8');
  const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const envExample = fs.readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
  assert.match(vite, /port:\s*5173/);
  assert.match(vite, /http:\/\/127\.0\.0\.1:4001/);
  assert.match(vite, /proxy\.on\('proxyReq',[\s\S]*?removeHeader\('origin'\)/);
  assert.match(packageJson.scripts['dev:all'], /npm run server.*npm run dev/);
  assert.match(packageJson.scripts.server, /HOST=127\.0\.0\.1 PORT=4001/);
  assert.match(envExample, /APP_ORIGIN=http:\/\/localhost:5173/);
  assert.match(envExample, /GOOGLE_REDIRECT_URI=/);
  assert.match(server, /function googleRedirectUri\(\)/);
  assert.match(server, /const codespaceOrigin = \/\^\[a-z0-9-\]\+\$\/i\.test\(codespaceName\)/);
  assert.match(server, /const appOrigin = codespaceOrigin \|\| process\.env\.APP_ORIGIN/);
  assert.match(server, /if \(origin === appOrigin \|\| origin === codespaceOrigin\) return true/);
  assert.match(server, /const codespaceRedirectUri = codespaceOrigin\s*\?/);
  assert.match(server, /codespaceRedirectUri \|\| process\.env\.GOOGLE_REDIRECT_URI/);
  assert.match(server, /\/auth\/google\/callback`/);
  assert.match(server, /'http:\/\/localhost:5173'/);
  assert.doesNotMatch(server, /localhost:4000/);
});

test('the development proxy removes forwarded Origin while state-changing APIs retain CSRF validation', () => {
  const vite = fs.readFileSync(new URL('../vite.config.js', import.meta.url), 'utf8');
  assert.match(vite, /proxyRequest\.removeHeader\('origin'\)/);
  assert.match(server, /CSRF_INVALID/);
});

test('development accepts only HTTPS Codespaces origins forwarding port 5173', () => {
  assert.match(server, /function isCodespacesOrigin\(origin\)/);
  assert.match(server, /url\.protocol === 'https:'/);
  assert.match(server, /\[a-z0-9-\]\+-5173\\\.app\\\.github\\\.dev/);
  assert.match(server, /process\.env\.NODE_ENV !== 'production' && \(origin === 'http:\/\/localhost:5173' \|\| isCodespacesOrigin\(origin\)\)/);
});

test('compose requires secrets, gates startup on healthy services, and keeps data ports private', () => {
  const compose = fs.readFileSync(new URL('../docker-compose.yml', import.meta.url), 'utf8');
  assert.match(compose, /PORT: 5173/);
  assert.match(compose, /CODESPACE_NAME: \$\{CODESPACE_NAME:-\}/);
  assert.match(compose, /"5173:5173"/);
  assert.match(compose, /127\.0\.0\.1:5173\/api\/health/);
  assert.match(compose, /POSTGRES_PASSWORD:\s*\$\{POSTGRES_PASSWORD:\?/);
  assert.match(compose, /SESSION_SECRET:\s*\$\{SESSION_SECRET:\?/);
  assert.doesNotMatch(compose, /OWNER_EMAIL/);
  assert.match(compose, /SMTP_USER: \$\{SMTP_USER:-\}/);
  assert.match(compose, /SMTP_PASS: \$\{SMTP_PASS:-\}/);
  assert.match(compose, /MINIO_SECRET_KEY: \$\{MINIO_SECRET_KEY:-local-storage-dev-only\}/);
  assert.match(compose, /profiles: \[local-storage\]/);
  assert.match(compose, /condition: service_healthy/);
  assert.match(compose, /internal: \$\{BACKEND_NETWORK_INTERNAL:-true\}/);
  assert.match(fs.readFileSync(new URL('../.env.example', import.meta.url), 'utf8'), /BACKEND_NETWORK_INTERNAL=true/);
  assert.match(compose, /127\.0\.0\.1:5432:5432/);
  assert.match(compose, /127\.0\.0\.1:6379:6379/);
  assert.match(compose, /127\.0\.0\.1:9000:9000/);
  assert.doesNotMatch(compose, /"(?:5432|6379|9000|9001):/);
  assert.doesNotMatch(compose, /change-me(?:-now)?/);
});

test('production fails closed when infrastructure or rate limiting is unavailable', () => {
  assert.match(server, /process\.env\.NODE_ENV === 'production' \? null : true/);
  assert.match(server, /RATE_LIMIT_UNAVAILABLE/);
  assert.match(server, /await disconnectServices\(\);[\s\S]*?process\.exitCode = 1/);
});

test('development server stays alive in degraded mode when infrastructure is unavailable', () => {
  assert.match(server, /degraded mode|servicesReady = false|servicesReady\s*=\s*false/i);
  assert.match(server, /if \(process\.env\.NODE_ENV === 'production'\)[\s\S]*?process\.exitCode = 1[\s\S]*?server\.listen/);
});

test('guest users get a safe unauthenticated response instead of a fatal 401 page issue', () => {
  assert.match(server, /url\.pathname === '\/api\/me'/);
  assert.match(server, /guest:\s*true|user:\s*null/i);
});

test('Google OAuth accepts a dev-safe callback and reuses the correct app redirect', () => {
  assert.match(server, /resolveRedirectTarget|typeof state === 'string'/i);
  assert.match(server, /providerSubject: String\(profile\.sub\)/i);
  assert.match(server, /nexa_oauth_session/i);
  assert.match(server, /oauth_state:/i);
  assert.match(server, /SameSite=\s*None|usesSecureCookies\(\)/i);
});

test('OAuth state is generated only by the backend and stored in Redis, not in memory', () => {
  assert.doesNotMatch(server, /pendingOAuth\s*=\s*new Map\(|new Map\(\)/i);
  assert.match(server, /redis\.set\(`oauth_state:/i);
  assert.match(server, /redis\.get\(`oauth_state:/i);
});

test('Google login uses a backend-generated state and redirects to the profile setup flow', () => {
  assert.match(server, /randomBytes\(64\)/i);
  assert.match(server, /\/setup-profile|setup-profile/i);
  assert.match(server, /nexa_oauth_session/i);
  assert.match(server, /Set-Cookie[\s\S]*nexa_oauth_session/i);
  assert.match(server, /identities: \{ some: \{ provider: 'google'/);
  assert.doesNotMatch(server, /authIdentities/);
});

test('Google and email verification return to the app with actionable status', () => {
  assert.match(server, /GOOGLE_OAUTH_NOT_CONFIGURED/);
  assert.match(server, /AUTH_SERVICES_UNAVAILABLE/);
  assert.match(server, /EMAIL_VERIFICATION_INVALID/);
  assert.match(server, /email_verified=1/);
  const app = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(app, /GOOGLE_OAUTH_NOT_CONFIGURED:/);
  assert.match(app, /EMAIL_VERIFICATION_INVALID:/);
  assert.match(app, /email_verified.*=== '1'/);
});

test('account setup does not expose the stale origin error text', () => {
  const app = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /رابط الموقع غير معتمد للخادم/);
  assert.match(app, /ORIGIN_NOT_ALLOWED: 'تعذر إكمال الطلب\. حدّث الصفحة وحاول مجددًا\.'/);
});

test('OAuth and email verification redirects bypass browser Origin checks but still validate one-time tokens', () => {
  assert.match(server, /isTrustedRedirect = request\.method === 'GET' && \['\/auth\/google\/callback', '\/auth\/verify-email'\]\.includes\(url\.pathname\)/);
  assert.match(server, /if \(!isTrustedRedirect && !allowedOrigin\(request\.headers\.origin\)\)/);
  assert.match(server, /receivedState !== storedState/);
  assert.match(server, /tokenHash: hashToken\(token\), type: 'verify'/);
});
