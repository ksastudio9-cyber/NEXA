const DATABASE_NAME = 'nexa-offline';
const DATABASE_VERSION = 2;
const OUTBOX_STORE = 'outbox';
const CONVERSATION_STORE = 'conversations';

function openDatabase() {
  if (!globalThis.indexedDB) return Promise.reject(new Error('OFFLINE_STORAGE_UNAVAILABLE'));

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(OUTBOX_STORE)) {
        request.result.createObjectStore(OUTBOX_STORE, { keyPath: 'id' });
      }
      if (!request.result.objectStoreNames.contains(CONVERSATION_STORE)) {
        request.result.createObjectStore(CONVERSATION_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('OFFLINE_STORAGE_FAILED'));
  });
}

async function runTransaction(storeName, mode, operation) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    let result;

    try {
      result = operation(store);
    } catch (error) {
      database.close();
      reject(error);
      return;
    }

    transaction.oncomplete = () => {
      database.close();
      resolve(result?.result);
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error || new Error('OFFLINE_STORAGE_FAILED'));
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error || new Error('OFFLINE_STORAGE_ABORTED'));
    };
  });
}

export function queueOfflineAction(action) {
  return runTransaction(OUTBOX_STORE, 'readwrite', store => store.put(action));
}

export function getOfflineActions() {
  return runTransaction(OUTBOX_STORE, 'readonly', store => store.getAll());
}

export function removeOfflineAction(id) {
  return runTransaction(OUTBOX_STORE, 'readwrite', store => store.delete(id));
}

export function cacheConversation(id, messages) {
  return runTransaction(CONVERSATION_STORE, 'readwrite', store => store.put({ id, messages }));
}

export function getCachedConversation(id) {
  return runTransaction(CONVERSATION_STORE, 'readonly', store => store.get(id));
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/gu, '')
    .replace(/[أإآٱ]/gu, 'ا')
    .replace(/ى/gu, 'ي')
    .replace(/([^\p{L}\p{N}\s])(?=[\p{L}\p{N}])/gu, '')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/(\p{L})\1{2,}/gu, '$1$1')
    .trim();
}

const locallyBlockedTerms = ['كسم', 'زب', 'قحبة', 'fuck', 'shit'];

export function localModerationCheck(value) {
  const text = ` ${normalizeText(value)} `;
  return locallyBlockedTerms.some(term => text.includes(` ${normalizeText(term)} `))
    ? 'CONTENT_REJECTED'
    : null;
}