import { mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROFILE_ROOT_DIR = resolve(__dirname, "..", "data", "playwright-profile");
const DEFAULT_VIEWPORT = { width: 1440, height: 900 };

let playwrightModulePromise = null;
/** @type {Map<string, { promise: Promise<any>; headed: boolean; profileDir: string }>} */
const contextEntries = new Map();
/** @type {Map<string, any>} */
const interactivePages = new Map();

function challengeReasonFromHtml(html) {
  const text = String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!text) {
    return null;
  }
  if (/cloudflare|checking your browser|just a moment|attention required/i.test(text)) {
    return "cloudflare_challenge";
  }
  if (/captcha|recaptcha|hcaptcha|verify you are human|quick humanity check/i.test(text)) {
    return "captcha_challenge";
  }
  if (/access denied|forbidden|blocked/i.test(text)) {
    return "access_denied";
  }
  return null;
}

async function loadPlaywright() {
  if (!playwrightModulePromise) {
    playwrightModulePromise = import("playwright").catch((error) => {
      playwrightModulePromise = null;
      throw new Error(
        `Playwright is not installed. Run \`npm install playwright\` and \`npx playwright install chromium\`. ${error?.message || error}`
      );
    });
  }
  return playwrightModulePromise;
}

function normalizeSourceKey(sourceId) {
  const key = String(sourceId || "default")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return key || "default";
}

function profileDirForSource(key) {
  return join(PROFILE_ROOT_DIR, key);
}

async function createContextEntry(key, headed = false) {
  const profileDir = profileDirForSource(key);
  const promise = (async () => {
    await mkdir(profileDir, { recursive: true });
    const { chromium } = await loadPlaywright();
    return chromium.launchPersistentContext(profileDir, {
      headless: !headed,
      viewport: DEFAULT_VIEWPORT,
      args: ["--disable-blink-features=AutomationControlled"],
    });
  })().catch((error) => {
    contextEntries.delete(key);
    throw error;
  });
  contextEntries.set(key, { promise, headed: headed === true, profileDir });
  return promise;
}

export async function getPlaywrightContext(sourceId = "default", options = {}) {
  const key = normalizeSourceKey(sourceId);
  const headed = options.headed === true;
  const existing = contextEntries.get(key);
  if (!existing) {
    return createContextEntry(key, headed);
  }
  if (headed && !existing.headed) {
    await closePlaywrightContext(key);
    return createContextEntry(key, true);
  }
  return existing.promise;
}

export async function closePlaywrightContext(sourceId) {
  const targets = sourceId == null ? Array.from(contextEntries.keys()) : [normalizeSourceKey(sourceId)];
  if (!targets.length) {
    return false;
  }
  let closedAny = false;
  for (const key of targets) {
    const entry = contextEntries.get(key);
    const page = interactivePages.get(key);
    interactivePages.delete(key);
    if (page) {
      try {
        if (!page.isClosed()) {
          await page.close().catch(() => {});
        }
      } catch {
        // ignore
      }
    }
    if (!entry) {
      continue;
    }
    contextEntries.delete(key);
    try {
      const context = await entry.promise;
      await context.close().catch(() => {});
      closedAny = true;
    } catch {
      // ignore close errors; context failed to open or already died.
    }
  }
  return closedAny;
}

export async function clearPlaywrightProfile(sourceId = "default") {
  const key = normalizeSourceKey(sourceId);
  await closePlaywrightContext(key);
  await rm(profileDirForSource(key), { recursive: true, force: true }).catch(() => {});
  return true;
}

/**
 * @param {string} targetUrl
 * @param {{ maxTimeout?: number; headed?: boolean; sourceId?: string; keepOpen?: boolean }} [options]
 */
export async function fetchPageWithPlaywright(targetUrl, options = {}) {
  const sourceKey = normalizeSourceKey(options.sourceId || "default");
  const context = await getPlaywrightContext(sourceKey, { headed: options.headed === true });
  const page = await context.newPage();
  const timeoutMs = Math.max(5_000, Number(options.maxTimeout || 45_000));
  try {
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await page.waitForLoadState("networkidle", { timeout: Math.min(timeoutMs, 15_000) }).catch(() => {});
    const html = await page.content();
    const finalUrl = page.url();
    const reason = challengeReasonFromHtml(html);
    if (reason) {
      return {
        status: "challenge_required",
        finalUrl,
        html,
        challengeDetected: true,
        challengeReason: reason,
      };
    }
    return {
      status: "ok",
      finalUrl,
      html,
      challengeDetected: false,
      challengeReason: null,
    };
  } finally {
    if (options.keepOpen !== true) {
      await page.close().catch(() => {});
    }
  }
}

/**
 * @param {string} targetUrl
 * @param {{ sourceId?: string; maxTimeout?: number }} [options]
 */
export async function openInteractivePageWithPlaywright(targetUrl, options = {}) {
  const sourceKey = normalizeSourceKey(options.sourceId || "default");
  const context = await getPlaywrightContext(sourceKey, { headed: true });
  let page = interactivePages.get(sourceKey) || null;
  if (!page || page.isClosed()) {
    page = await context.newPage();
    interactivePages.set(sourceKey, page);
  }
  const timeoutMs = Math.max(5_000, Number(options.maxTimeout || 45_000));
  await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  await page.bringToFront().catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: Math.min(timeoutMs, 15_000) }).catch(() => {});
  const html = await page.content();
  const finalUrl = page.url();
  const reason = challengeReasonFromHtml(html);
  return {
    status: reason ? "challenge_required" : "ok",
    finalUrl,
    html,
    challengeDetected: Boolean(reason),
    challengeReason: reason,
  };
}

export function getPlaywrightProfileDir(sourceId) {
  if (sourceId == null) {
    return PROFILE_ROOT_DIR;
  }
  return profileDirForSource(normalizeSourceKey(sourceId));
}
