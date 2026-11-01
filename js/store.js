// Persistence: IndexedDB (state JSON + attached files as Blobs).
// Falls back to localStorage / memory where IndexedDB is unavailable.

const DB_NAME = 'school-app';
const LS_KEY = 'school-app-state';
let dbPromise = null;
let mode = 'idb'; // 'idb' | 'ls' | 'mem'
const memFiles = new Map();
let memState = null;

const RESCUE_KEY = 'school-app-rescue';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function openDB() {
  if (dbPromise) return dbPromise;
  const p = new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
      };
      req.onsuccess = () => {
        const db = req.result;
        // iOS drops the connection when the app sits in the background:
        // forget it so the next call opens a fresh one.
        db.onclose = () => { if (dbPromise === p) dbPromise = null; };
        db.onversionchange = () => { db.close(); if (dbPromise === p) dbPromise = null; };
        resolve(db);
      };
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('blocked'));
    } catch (e) {
      reject(e);
    }
  });
  p.catch(() => { if (dbPromise === p) dbPromise = null; });
  dbPromise = p;
  return p;
}

function runOnce(store, txMode, fn) {
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

/** A transaction, retried on a fresh connection — iOS IndexedDB fails transiently. */
async function run(store, txMode, fn, tries = 4) {
  for (let i = 0; ; i++) {
    try {
      return await runOnce(store, txMode, fn);
    } catch (e) {
      if (i >= tries - 1) throw e;
      dbPromise = null;
      await wait(120 * (i + 1));
    }
  }
}

export async function initStore() {
  let ok = false;
  for (let i = 0; i < 4 && !ok; i++) {
    try {
      await openDB();
      ok = true;
    } catch {
      dbPromise = null;
      await wait(150 * (i + 1));
    }
  }
  if (ok) {
    mode = 'idb';
  } else {
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

const memKV = new Map(); // key -> state, for the mem fallback (key !== 'state')

const stamp = (x) => (x && typeof x === 'object' && +x._savedAt) || 0;

/**
 * Read a saved record. In IndexedDB mode a read that keeps failing THROWS —
 * it never pretends there is no data (that used to start the app empty).
 * The main state also considers the emergency copy in localStorage, if newer.
 */
export async function loadState(key = 'state') {
  if (mode === 'idb') {
    const v = await run('kv', 'readonly', (s) => s.get(key));
    if (key !== 'state') return v;
    const rescue = readRescue();
    return rescue && stamp(rescue) > stamp(v) ? rescue : v;
  }
  if (mode === 'ls') {
    try {
      const raw = localStorage.getItem(key === 'state' ? LS_KEY : `${LS_KEY}:${key}`);
      return raw ? JSON.parse(raw) : null;
    } catch {
      mode = 'mem';
    }
  }
  return key === 'state' ? memState : memKV.get(key) || null;
}

function readRescue() {
  try {
    const raw = localStorage.getItem(RESCUE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function saveState(state, key = 'state') {
  // Store a plain clone so IndexedDB never sees non-cloneable values.
  const plain = JSON.parse(JSON.stringify(state));
  if (key === 'state') plain._savedAt = Date.now();
  if (mode === 'idb') {
    try {
      await run('kv', 'readwrite', (s) => s.put(plain, key));
      if (key === 'state') try { localStorage.removeItem(RESCUE_KEY); } catch { /* ignore */ }
      return;
    } catch (e) {
      // Keep using IndexedDB next time; park this save where loadState() will find it.
      if (key === 'state') try { localStorage.setItem(RESCUE_KEY, JSON.stringify(plain)); } catch { /* full */ }
      throw e;
    }
  }
  if (mode === 'ls') {
    try {
      localStorage.setItem(key === 'state' ? LS_KEY : `${LS_KEY}:${key}`, JSON.stringify(plain));
      return;
    } catch {
      mode = 'mem';
    }
  }
  if (key === 'state') memState = plain;
  else memKV.set(key, plain);
}

/** Keys of every saved record (state, year archives, automatic snapshots). */
export async function listStateKeys() {
  if (mode === 'idb') {
    try {
      return (await run('kv', 'readonly', (s) => s.getAllKeys())).map(String);
    } catch {
      return [];
    }
  }
  if (mode === 'ls') {
    const out = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k === LS_KEY) out.push('state');
        else if (k.startsWith(`${LS_KEY}:`)) out.push(k.slice(LS_KEY.length + 1));
      }
    } catch { /* ignore */ }
    return out;
  }
  return [...(memState ? ['state'] : []), ...memKV.keys()];
}

export async function deleteState(key) {
  if (key === 'state') return;
  if (mode === 'idb') {
    try { await run('kv', 'readwrite', (s) => s.delete(key)); } catch { /* ignore */ }
  } else if (mode === 'ls') {
    try { localStorage.removeItem(`${LS_KEY}:${key}`); } catch { /* ignore */ }
  } else memKV.delete(key);
}

/** Copies of the data left in localStorage (from an old fallback or a failed save). */
export function localCopies() {
  const out = [];
  if (mode === 'ls') return out; // in ls mode these ARE the live data
  for (const [key, label] of [[LS_KEY, 'ls'], [RESCUE_KEY, 'rescue']]) {
    try {
      const raw = localStorage.getItem(key);
      if (raw) out.push({ key: label, data: JSON.parse(raw) });
    } catch { /* ignore */ }
  }
  return out;
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
  try { localStorage.removeItem(LS_KEY); localStorage.removeItem(RESCUE_KEY); } catch { /* ignore */ }
}
