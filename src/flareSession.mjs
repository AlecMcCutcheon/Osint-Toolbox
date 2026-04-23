import "./env.mjs";
import { flareV1 } from "./flareClient.mjs";

let sessionId = null;
/** @type {Promise<string> | null} */
let inflightCreate = null;

export function isFlareSessionReuseEnabled() {
  // Default off: reusing one Flare `session` across many `request.get` calls can leave
  // one long-lived headless browser; combined with other issues that can stress Docker
  // hosts. Opt in with FLARE_REUSE_SESSION=1 if you want one warm session.
  const v = String(process.env.FLARE_REUSE_SESSION ?? "0").toLowerCase();
  return v !== "0" && v !== "false" && v !== "no" && v !== "off";
}

export function getFlareSessionTtlMinutes() {
  const n = Number(process.env.FLARE_SESSION_TTL_MINUTES);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * @param {string} baseUrl
 * @returns {Promise<string | null>} session id or null if reuse disabled
 */
export async function ensureFlareSession(baseUrl) {
  if (!isFlareSessionReuseEnabled()) {
    return null;
  }
  if (sessionId) {
    return sessionId;
  }
  if (inflightCreate) {
    return inflightCreate;
  }
  inflightCreate = (async () => {
    const r = await flareV1({ cmd: "sessions.create" }, { baseUrl });
    if (!r.session) {
      throw new Error("Flare sessions.create: missing 'session' in response");
    }
    sessionId = r.session;
    return sessionId;
  })();
  try {
    return await inflightCreate;
  } finally {
    inflightCreate = null;
  }
}

export function getFlareSessionId() {
  return sessionId;
}

/**
 * @param {string} baseUrl
 */
export async function replaceFlareSessionAfterFailure(baseUrl) {
  const old = sessionId;
  sessionId = null;
  inflightCreate = null;
  if (old) {
    try {
      await flareV1({ cmd: "sessions.destroy", session: old }, { baseUrl });
    } catch {
      // already gone
    }
  }
  if (!isFlareSessionReuseEnabled()) {
    return null;
  }
  return ensureFlareSession(baseUrl);
}

/**
 * @param {string} baseUrl
 */
export async function destroyFlareSessionOnExit(baseUrl) {
  if (inflightCreate) {
    try {
      await inflightCreate;
    } catch {
      // ignore
    }
    inflightCreate = null;
  }
  if (!sessionId) {
    return;
  }
  const toKill = sessionId;
  sessionId = null;
  try {
    await flareV1({ cmd: "sessions.destroy", session: toKill }, { baseUrl });
  } catch {
    // ignore
  }
}

/**
 * @param {unknown} e
 */
export function isFlareSessionLikelyInvalidError(e) {
  const m = String(e?.message || e);
  if (/session doesn't exist|session does not exist|doesn't exist\.$/i.test(m)) {
    return true;
  }
  if (/The session doesn/i.test(m)) {
    return true;
  }
  if (/Error solving the challenge. timeout/i.test(m)) {
    return false;
  }
  if (/Error solving the challenge\./i.test(m) && /session/i.test(m)) {
    return true;
  }
  return false;
}

/**
 * Drop the in-memory Flare session after this error so the *next* request
 * does not keep using a browser that may be wedged, without retrying the
 * current 120s Flare run (unlike `isFlareSessionLikelyInvalidError` retry path).
 * @param {unknown} e
 * @returns {boolean}
 */
export function shouldDropFlareSessionAfterError(e) {
  if (isFlareSessionLikelyInvalidError(e)) {
    return false;
  }
  const m = String(e?.message || e);
  if (/Error solving the challenge/i.test(m)) {
    return true;
  }
  if (/FlareSolverr HTTP 5\d\d/i.test(m)) {
    return true;
  }
  if (/FunctionTimedOut|func_timeout|timed out after 120|timed out after/i.test(m)) {
    return true;
  }
  return false;
}
