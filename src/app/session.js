// Session: which perspective (role) and which back end (demo, on-device,
// cloud) the app is running with.
import { state, set, go } from "./state.js";
import { prefs } from "../store/kv.js";
import { createDemoApi, resetDemo } from "../cloud/demo-api.js";
import { createLocalApi } from "../cloud/local-api.js";
import { createCloudApi } from "../cloud/cloud-api.js";
import { auth } from "../cloud/auth.js";
import { senseService } from "./sense-service.js";

export const ROLE_HOME = { wearer: "#/today", family: "#/people", clinician: "#/panel" };

export function startSession({ role, mode }, { navigate = true } = {}) {
  prefs.set("session", { role, mode });
  let api;
  if (mode === "demo") api = createDemoApi({ viewer: role });
  else if (mode === "cloud") api = createCloudApi({ auth });
  else api = createLocalApi();
  set({ role, mode, api, user: mode === "cloud" ? auth.user : null });
  if (role === "wearer") senseService.start({ demo: mode === "demo", api });
  else senseService.stop();
  if (navigate) go(ROLE_HOME[role], { replace: true });
}

export function endSession() {
  prefs.del("session");
  senseService.stop();
  resetDemo();
  set({ role: null, mode: null, api: null, sheet: null, overlay: null, user: null, topAlerts: 0 });
  go("#/welcome");
}

export async function signOut() {
  await auth.signOut().catch(() => {});
  endSession();
}

export function isDemo() { return state.mode === "demo"; }
