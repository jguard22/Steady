// Sign in with a BrilliantWear account — OAuth 2 authorization code + PKCE
// (public client, no secret).
//
// Two ways in:
//  - Standalone browser: a normal redirect to the BrilliantWear consent page.
//  - Inside the BrilliantWear phone app: Steady runs in a sandboxed frame that
//    can't open pages, so it asks the phone app to approve the same request
//    (`brilliantwear:authorize` message). The phone app shows its own
//    consent, then hands back only a one-time code; Steady exchanges it with
//    its PKCE verifier. The phone app's own login never reaches Steady.

import { kv, prefs } from "../store/kv.js";

export const CLIENT_ID = "steady-web";
export const SCOPES = ["CARE_READ", "CARE_WRITE", "PROFILE_READ"];

export function apiBase() {
  const o = prefs.get("apiBase");
  return o || "https://api.brilliantwear.com";
}
export function setApiBase(url) {
  if (url) prefs.set("apiBase", url.replace(/\/$/, ""));
  else prefs.del("apiBase");
}
export function redirectUri() {
  return `${location.origin}${location.pathname.replace(/index\.html$/, "")}`;
}
export const inHub = () => {
  try { return window.parent !== window; } catch { return true; }
};

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function randomString(n = 48) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return b64url(a).slice(0, n);
}
async function challengeFor(verifier) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return b64url(d);
}

let tokens = null; // {access, refresh, expiresAt}
let user = null;
const listeners = new Set();

async function save() {
  await kv.set("auth", tokens ? { ...tokens, user } : null);
}

async function exchange(body) {
  const r = await fetch(`${apiBase()}/v1/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: CLIENT_ID, ...body }),
  });
  if (!r.ok) throw new Error(`Sign-in failed (${r.status})`);
  const j = await r.json();
  tokens = {
    access: j.access_token,
    refresh: j.refresh_token ?? tokens?.refresh,
    expiresAt: Date.now() + (j.expires_in ?? 900) * 1000 - 30000,
  };
  await save();
  return tokens;
}

async function fetchUser() {
  try {
    const r = await fetch(`${apiBase()}/v1/oauth/userinfo`, { headers: { Authorization: `Bearer ${tokens.access}` } });
    if (r.ok) user = await r.json();
  } catch { /* offline: keep what we had */ }
  await save();
  listeners.forEach((f) => f(user));
}

function hubAuthorize({ challenge, stateValue }) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { window.removeEventListener("message", onMsg); reject(new Error("hub-timeout")); }, 120000);
    function onMsg(e) {
      if (e.source !== window.parent) return;
      const m = e.data;
      if (!m || m.type !== "brilliantwear:authorized" || m.state !== stateValue) return;
      clearTimeout(timer);
      window.removeEventListener("message", onMsg);
      if (m.code) resolve(m.code);
      else reject(new Error(m.error || "declined"));
    }
    window.addEventListener("message", onMsg);
    window.parent.postMessage({
      type: "brilliantwear:authorize",
      clientId: CLIENT_ID,
      scope: SCOPES.join(" "),
      redirectUri: redirectUri(),
      codeChallenge: challenge,
      codeChallengeMethod: "S256",
      state: stateValue,
    }, "*");
  });
}

export const auth = {
  get user() { return user; },
  get signedIn() { return !!tokens?.access; },
  onUser(f) { listeners.add(f); return () => listeners.delete(f); },

  async restore() {
    const t = await kv.get("auth");
    if (!t?.refresh && !t?.access) return false;
    tokens = { access: t.access, refresh: t.refresh, expiresAt: t.expiresAt };
    user = t.user ?? null;
    try {
      await this.token();
      return true;
    } catch {
      return !!tokens?.access;
    }
  },

  /** Start sign-in. Standalone: navigates away. In the phone app: resolves when done. */
  async signIn() {
    const verifier = randomString(64);
    const stateValue = randomString(24);
    const challenge = await challengeFor(verifier);
    if (inHub()) {
      const code = await hubAuthorize({ challenge, stateValue });
      await exchange({ grant_type: "authorization_code", code, redirect_uri: redirectUri(), code_verifier: verifier });
      await fetchUser();
      return true;
    }
    sessionStorage.setItem("steady.pkce", JSON.stringify({ verifier, state: stateValue }));
    const u = new URL(`${apiBase()}/v1/oauth/authorize`);
    u.search = new URLSearchParams({
      response_type: "code", client_id: CLIENT_ID, redirect_uri: redirectUri(), scope: SCOPES.join(" "),
      state: stateValue, code_challenge: challenge, code_challenge_method: "S256",
    }).toString();
    location.assign(u.toString());
    return new Promise(() => {}); // navigating away
  },

  async finishRedirect(q) {
    const saved = JSON.parse(sessionStorage.getItem("steady.pkce") || "null");
    sessionStorage.removeItem("steady.pkce");
    if (!saved || saved.state !== q.get("state")) return false;
    await exchange({ grant_type: "authorization_code", code: q.get("code"), redirect_uri: redirectUri(), code_verifier: saved.verifier });
    await fetchUser();
    return true;
  },

  async token() {
    if (tokens?.access && Date.now() < tokens.expiresAt) return tokens.access;
    if (!tokens?.refresh) throw Object.assign(new Error("Signed out"), { status: 401 });
    await exchange({ grant_type: "refresh_token", refresh_token: tokens.refresh });
    return tokens.access;
  },

  async signOut() {
    const t = tokens;
    tokens = null; user = null;
    await save();
    if (t?.refresh) {
      fetch(`${apiBase()}/v1/oauth/revoke`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: t.refresh, client_id: CLIENT_ID }) }).catch(() => {});
    }
  },
};
