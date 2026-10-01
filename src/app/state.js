// App state + a minimal async data cache. Views read `state` and call
// `load(key, fn)`; anything that changes calls `update()` to re-render.

export const state = {
  role: null,          // 'wearer' | 'family' | 'clinician'
  mode: null,          // 'demo' | 'local' | 'cloud'
  api: null,
  route: { path: "/", parts: [], query: {} },
  sheet: null,         // () => TemplateResult
  toast: null,
  overlay: null,       // e.g. {kind:'fall', ...}
  sense: { status: "off", devices: [], battery: {}, live: null, env: "standalone" },
  user: null,          // signed-in BrilliantWear user {id, email?, name?}
};

let renderFn = () => {};
let queued = false;
export function setRenderer(fn) { renderFn = fn; }
export function update() {
  if (queued) return;
  queued = true;
  queueMicrotask(() => { queued = false; renderFn(); });
}
export function set(patch) {
  Object.assign(state, patch);
  update();
}

const cache = new Map();
/**
 * @template T
 * @param {string} key
 * @param {() => Promise<T>} fn
 * @param {{ttl?: number}} [o]
 * @returns {{status:'loading'|'ok'|'error', data?:T, error?:any}}
 */
export function load(key, fn, { ttl = 60000 } = {}) {
  const c = cache.get(key);
  if (c && (c.status === "loading" || Date.now() - c.at < ttl)) return c;
  const entry = { status: c?.data !== undefined ? "ok" : "loading", data: c?.data, at: Date.now(), refreshing: true };
  if (c?.data === undefined) entry.status = "loading";
  cache.set(key, entry);
  Promise.resolve()
    .then(fn)
    .then(
      (data) => { cache.set(key, { status: "ok", data, at: Date.now() }); update(); },
      (error) => { cache.set(key, { status: "error", error, data: c?.data, at: Date.now() }); update(); },
    );
  return entry;
}
export function invalidate(prefix = "") {
  for (const k of [...cache.keys()]) if (k.startsWith(prefix)) cache.delete(k);
  update();
}

let toastTimer = null;
export function toast(msg, ms = 2600) {
  clearTimeout(toastTimer);
  set({ toast: msg });
  toastTimer = setTimeout(() => set({ toast: null }), ms);
}
export function openSheet(fn) { set({ sheet: fn }); }
export function closeSheet() { set({ sheet: null }); }

export function parseRoute(raw = location.hash) {
  const h = raw.replace(/^#/, "") || "/";
  const [path, qs = ""] = h.split("?");
  const parts = path.split("/").filter(Boolean);
  return { path: "/" + parts.join("/"), parts, query: Object.fromEntries(new URLSearchParams(qs)) };
}

/** Navigate. The route updates synchronously so a render never sees a stale one. */
export function go(hash, { replace = false } = {}) {
  if (location.hash !== hash) {
    if (replace) history.replaceState(null, "", hash);
    else location.hash = hash;
  }
  const next = parseRoute(hash);
  if (next.path !== state.route.path) { state.sheet = null; try { window.scrollTo({ top: 0 }); } catch { /* no window */ } }
  state.route = next;
  update();
}

const memos = new WeakMap();
/** Derive once per source object (stable across re-renders until reloaded). */
export function memo(source, key, fn) {
  if (!source || typeof source !== "object") return fn();
  let m = memos.get(source);
  if (!m) { m = new Map(); memos.set(source, m); }
  if (!m.has(key)) m.set(key, fn());
  return m.get(key);
}
