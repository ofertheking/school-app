// Persistence: IndexedDB (state JSON + attached files as Blobs).
// Falls back to localStorage / memory where IndexedDB is unavailable.

const DB_NAME = 'school-app';
const LS_KEY = 'school-app-state';
let dbPromise = null;
let mode = 'idb'; // 'idb' | 'ls' | 'mem'
const memFiles = new Map();
let memState = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('blocked'));
    } catch (e) {
      reject(e);
    }
  });
  return dbPromise;
}

function run(store, txMode, fn) {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(store, txMode);
        const req = fn(tx.objectStore(store));
        tx.oncomplete = () => resolve(req ? req.result : undefined);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      })
  );
}

export async function initStore() {
  try {
    await openDB();
    mode = 'idb';
  } catch {
    try {
      localStorage.setItem('__t', '1');
      localStorage.removeItem('__t');
      mode = 'ls';
    } catch {
      mode = 'mem';
    }
  }
  // Ask iOS/Chrome not to evict our data under storage pressure.
  try { await navigator.storage?.persist?.(); } catch { /* ignore */ }
  return mode;
}

export const storageMode = () => mode;

export async function loadState() {
  if (mode === 'idb') {
    try {
      return await run('kv', 'readonly', (s) => s.get('state'));
    } catch {
      mode = 'ls';
    }
  }
  if (mode === 'ls') {
    try {
      const raw = localStorage.getItem(LS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      mode = 'mem';
    }
  }
  return memState;
}

export async function saveState(state) {
  // Store a plain clone so IndexedDB never sees non-cloneable values.
  const plain = JSON.parse(JSON.stringify(state));
  if (mode === 'idb') {
    try {
      await run('kv', 'readwrite', (s) => s.put(plain, 'state'));
      return;
    } catch {
      mode = 'ls';
    }
  }
  if (mode === 'ls') {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(plain));
      return;
    } catch {
      mode = 'mem';
    }
  }
  memState = plain;
}

export async function putFile(id, blob) {
  if (mode === 'idb') {
    try {
      await run('files', 'readwrite', (s) => s.put(blob, id));
      return;
    } catch { /* fall through to memory */ }
  }
  memFiles.set(id, blob);
}

export async function getFile(id) {
  if (memFiles.has(id)) return memFiles.get(id);
  if (mode === 'idb') {
    try {
      return await run('files', 'readonly', (s) => s.get(id));
    } catch { /* ignore */ }
  }
  return undefined;
}

export async function deleteFile(id) {
  memFiles.delete(id);
  if (mode === 'idb') {
    try {
      await run('files', 'readwrite', (s) => s.delete(id));
    } catch { /* ignore */ }
  }
}

export async function listFileIds() {
  const ids = new Set(memFiles.keys());
  if (mode === 'idb') {
    try {
      const keys = await run('files', 'readonly', (s) => s.getAllKeys());
      (keys || []).forEach((k) => ids.add(k));
    } catch { /* ignore */ }
  }
  return [...ids];
}

export async function clearAll() {
  memFiles.clear();
  memState = null;
  if (mode === 'idb') {
    try {
      await run('files', 'readwrite', (s) => s.clear());
      await run('kv', 'readwrite', (s) => s.clear());
    } catch { /* ignore */ }
  }
  try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
}
