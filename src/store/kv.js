// Tiny key-value store on IndexedDB with an in-memory fallback (private
// windows, blocked storage, test environments). Values are structured-cloned.

const DB = "steady";
const STORE = "kv";
let dbp = null;
const mem = new Map();

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    try {
      if (!globalThis.indexedDB) return resolve(null);
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbp;
}

async function tx(mode, fn) {
  const db = await open();
  if (!db) return fn(null);
  return new Promise((resolve) => {
    try {
      const t = db.transaction(STORE, mode);
      const s = t.objectStore(STORE);
      const r = fn(s);
      t.oncomplete = () => resolve(r?.result ?? r);
      t.onerror = () => resolve(undefined);
      t.onabort = () => resolve(undefined);
    } catch {
      resolve(fn(null));
    }
  });
}

export const kv = {
  async get(key) {
    const db = await open();
    if (!db) return mem.get(key);
    return new Promise((resolve) => {
      try {
        const r = db.transaction(STORE).objectStore(STORE).get(key);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => resolve(mem.get(key));
      } catch {
        resolve(mem.get(key));
      }
    });
  },
  async set(key, value) {
    mem.set(key, value);
    await tx("readwrite", (s) => s?.put(value, key));
  },
  async del(key) {
    mem.delete(key);
    await tx("readwrite", (s) => s?.delete(key));
  },
};

/** Synchronous per-viewer preferences (theme, text size, last role). */
export const prefs = {
  get(key, fallback = null) {
    try {
      const v = localStorage.getItem(`steady.${key}`);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`steady.${key}`, JSON.stringify(value));
    } catch {
      /* storage blocked: preference lasts this session only */
    }
  },
  del(key) {
    try { localStorage.removeItem(`steady.${key}`); } catch { /* ignore */ }
  },
};
