import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { dirname, join, posix, resolve, win32 } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROFILE_ROOT_DIR = resolve(__dirname, "..", "data", "playwright-profile");
const DEFAULT_VIEWPORT = { width: 1440, height: 900 };
const CHALLENGE_SETTLE_WAIT_MS = 15_000;
const PEOPLE_SEARCH_CHALLENGE_SETTLE_WAIT_MS = 35_000;
const PLAYWRIGHT_HEADLESS_DEFAULT = /^(1|true|yes|on)$/i.test(
  String(process.env.PLAYWRIGHT_HEADLESS || "").trim()
);
const PLAYWRIGHT_MINIMIZE_BACKGROUND = !/^(0|false|no|off)$/i.test(
  String(process.env.PLAYWRIGHT_MINIMIZE_BACKGROUND ?? "1").trim()
);
const CHROME_EXECUTABLE_PATH_OVERRIDE = String(process.env.CHROME_EXECUTABLE_PATH || "").trim() || null;

/**
 * @param {{ platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv }} [options]
 */
export function listChromeCandidatePaths(options = {}) {
  const platformName = options.platform || process.platform;
  const env = options.env || process.env;
  const pathApi = platformName === "win32" ? win32 : posix;
  const programFiles = String(env.PROGRAMFILES || "C:\\Program Files").trim();
  const programFilesX86 = String(env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)").trim();
  const localAppData = String(env.LOCALAPPDATA || "").trim();
  const homeDir = String(env.HOME || env.USERPROFILE || "").trim();

  /** @type {string[]} */
  let candidates = [];
  if (platformName === "win32") {
    candidates = [
      pathApi.join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
      pathApi.join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
      localAppData ? pathApi.join(localAppData, "Google", "Chrome", "Application", "chrome.exe") : null,
    ];
  } else if (platformName === "linux") {
    candidates = [
      "/usr/bin/google-chrome-stable",
      "/usr/bin/google-chrome",
      "/opt/google/chrome/chrome",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/snap/bin/chromium",
      homeDir ? pathApi.join(homeDir, ".local", "bin", "google-chrome") : null,
    ];
  } else if (platformName === "darwin") {
    candidates = [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      homeDir ? pathApi.join(homeDir, "Applications", "Google Chrome.app", "Contents", "MacOS", "Google Chrome") : null,
    ];
  }

  return [...new Set(candidates.filter(Boolean))];
}

function resolveChromePath() {
  if (CHROME_EXECUTABLE_PATH_OVERRIDE) {
    return CHROME_EXECUTABLE_PATH_OVERRIDE;
  }
  for (const candidate of listChromeCandidatePaths()) {
    if (candidate && existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}
const guardedContexts = new WeakSet();

let playwrightModulePromise = null;
/** @type {Map<string, { promise: Promise<any>; headed: boolean; profileDir: string }>} */
const contextEntries = new Map();
/** @type {Map<string, any>} */
const interactivePages = new Map();

function isClosedContextError(error) {
  const message = String(error?.message || error || "");
  return /target page, context or browser has been closed|browser has been closed|context has been closed|page has been closed|target closed/i.test(message);
}

function sanitizeNavigationUrl(targetUrl) {
  const raw = String(targetUrl || "").trim();
  if (!raw) {
    return raw;
  }
  try {
    const url = new URL(raw);
    if (url.hash === "#google_vignette") {
      url.hash = "";
    }
    return url.toString();
  } catch {
    return raw.replace(/#google_vignette$/i, "");
  }
}

async function installContextGuards(context) {
  if (!context || guardedContexts.has(context)) {
    return;
  }
  guardedContexts.add(context);

  await context.addInitScript(() => {
    const noopOpen = () => null;
    try {
      Object.defineProperty(window, "open", {
        configurable: true,
        writable: true,
        value: noopOpen,
      });
    } catch {
      window.open = noopOpen;
    }
    // Ensure window.chrome is present — DataDome and similar detectors flag its absence
    // in non-Google Chromium builds as an automation signal.
    if (!window.chrome) {
      try {
        Object.defineProperty(window, "chrome", {
          configurable: true,
          writable: true,
          value: { runtime: {} },
        });
      } catch {
        // best-effort; real Chrome already has this
      }
    }
  });

  const attachPageGuards = (page) => {
    if (!page) {
      return;
    }
    page.on("dialog", (dialog) => {
      dialog.dismiss().catch(() => {});
    });
    closePopupPageIfNeeded(page).catch(() => {});
  };

  for (const page of context.pages()) {
    attachPageGuards(page);
  }
  context.on("page", attachPageGuards);
}

export async function closePopupPageIfNeeded(page) {
  if (!page || typeof page.opener !== "function") {
    return false;
  }
  try {
    const opener = await page.opener();
    if (!opener || page.isClosed?.()) {
      return false;
    }
    await page.close().catch(() => {});
    return true;
  } catch {
    return false;
  }
}

function challengeReasonFromText(text) {
  const normalized = String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!normalized) {
    return null;
  }
  // Must be the dominant page purpose — short pages with these as main content indicate a challenge.
  // Avoid matching normal pages that merely mention these words in content.
  const isShortOrEmpty = normalized.length < 4000;
  if (/checking your browser|just a moment\.\.\.|attention required/i.test(normalized) && isShortOrEmpty) {
    return "cloudflare_challenge";
  }
  // Ray ID footer is a reliable Cloudflare challenge indicator regardless of page length
  if (/ray id[:\s]+[0-9a-f]{16}/i.test(normalized)) {
    return "cloudflare_challenge";
  }
  if (/captcha|recaptcha|hcaptcha|verify you are human|quick humanity check/i.test(normalized)) {
    return "captcha_challenge";
  }
  // DataDome bot management block page
  if (/pardon our interruption|datadome|are you a robot\?|automated access detected/i.test(normalized) && isShortOrEmpty) {
    return "datadome_challenge";
  }
  // "Access Denied" as page title/heading is reliable; bare "blocked" or "forbidden" alone is not
  if (/\baccess denied\b/i.test(normalized) && isShortOrEmpty) {
    return "access_denied";
  }
  return null;
}

function looksLikeSolvedFastPeopleSearchContent(html, finalUrl) {
  const url = String(finalUrl || "").toLowerCase();
  if (!/fastpeoplesearch\.com/.test(url)) {
    return false;
  }
  const text = String(html || "");
  return (
    /class=["'][^"']*link-to-details[^"']*["']/i.test(text) ||
    /free public record details for /i.test(text) ||
    /href=["']\/[^"']+_id_[A-Za-z0-9-]+["']/i.test(text) ||
    /past addresses:/i.test(text) ||
    /relatives:/i.test(text)
  );
}

function challengeReasonFromHtml(html) {
  const raw = String(html || "");
  // DataDome CAPTCHA pages embed the challenge host in an inline <script> as `dd.host`.
  // That script block is stripped before text analysis, so check the raw HTML first.
  // captcha-delivery.com and datado.me are the two DataDome CAPTCHA delivery domains.
  if (/captcha-delivery\.com|datado\.me/i.test(raw)) {
    return "datadome_challenge";
  }
  const text = raw
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  return challengeReasonFromText(text);
}

function challengeSettleBudgetForUrl(url, timeoutMs) {
  const normalizedUrl = String(url || "").toLowerCase();
  const preferredBudget =
    /fastpeoplesearch\.com|truepeoplesearch\.com/.test(normalizedUrl)
      ? PEOPLE_SEARCH_CHALLENGE_SETTLE_WAIT_MS
      : CHALLENGE_SETTLE_WAIT_MS;
  return Math.max(0, Math.min(Number(timeoutMs || 0), preferredBudget));
}

async function waitForChallengeToSettle(page, timeoutMs) {
  const waitMs = Math.max(0, Number(timeoutMs || 0));
  if (!page || typeof page.waitForFunction !== "function" || waitMs <= 0) {
    return false;
  }
  try {
    await page.waitForFunction(() => {
      const text = `${document.title || ""} ${document.body?.innerText || ""}`
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
      if (!text) {
        return false;
      }
      const isShortOrEmpty = text.length < 4000;
      if (/ray id[:\s]+[0-9a-f]{16}/i.test(text)) {
        return false;
      }
      if (/checking your browser|just a moment\.\.\.|attention required/i.test(text) && isShortOrEmpty) {
        return false;
      }
      if (/captcha|recaptcha|hcaptcha|verify you are human|quick humanity check/i.test(text)) {
        return false;
      }
      if (/pardon our interruption|datadome|are you a robot\?|automated access detected/i.test(text) && isShortOrEmpty) {
        return false;
      }
      if (/\baccess denied\b/i.test(text) && isShortOrEmpty) {
        return false;
      }
      // DataDome CAPTCHA renders an iframe whose src contains captcha-delivery.com.
      // The URL doesn't appear in innerText so we query the DOM directly.
      if (document.querySelector('iframe[src*="captcha-delivery.com"], iframe[src*="datado.me"]')) {
        return false;
      }
      return true;
    }, { timeout: waitMs });
    return true;
  } catch {
    return false;
  }
}

export async function captureSettledPageSnapshot(page, timeoutMs = 0) {
  let html = await page.content();
  let finalUrl = page.url();
  let reason = challengeReasonFromHtml(html);
  if (reason) {
    const settleWaitMs = challengeSettleBudgetForUrl(finalUrl, timeoutMs);
    if (settleWaitMs > 0) {
      await waitForChallengeToSettle(page, settleWaitMs);
      await page.waitForLoadState?.("networkidle", { timeout: Math.min(settleWaitMs, 5_000) }).catch(() => {});
      html = await page.content();
      finalUrl = page.url();
      reason = challengeReasonFromHtml(html);
    }
  }
  if (reason && looksLikeSolvedFastPeopleSearchContent(html, finalUrl)) {
    reason = null;
  }
  return {
    html,
    finalUrl,
    challengeReason: reason,
  };
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

function resolveHeadedOption(options = {}) {
  if (options.headed === true) {
    return true;
  }
  if (options.headed === false) {
    return false;
  }
  return !PLAYWRIGHT_HEADLESS_DEFAULT;
}

async function setPageWindowState(page, windowState) {
  if (!page || !windowState || typeof page.context !== "function") {
    return false;
  }
  try {
    const context = page.context();
    if (!context || typeof context.newCDPSession !== "function") {
      return false;
    }
    const session = await context.newCDPSession(page);
    try {
      const { windowId } = await session.send("Browser.getWindowForTarget");
      if (!windowId) {
        return false;
      }
      await session.send("Browser.setWindowBounds", {
        windowId,
        bounds: { windowState },
      });
      return true;
    } finally {
      await session.detach().catch(() => {});
    }
  } catch {
    return false;
  }
}

async function createContextEntry(key, headed = false) {
  const profileDir = profileDirForSource(key);
  let promise;
  promise = (async () => {
    await mkdir(profileDir, { recursive: true });
    const { chromium } = await loadPlaywright();
    const chromePath = resolveChromePath();
    const context = await chromium.launchPersistentContext(profileDir, {
      headless: !headed,
      executablePath: chromePath || undefined,
      viewport: DEFAULT_VIEWPORT,
      args: [
        "--disable-blink-features=AutomationControlled",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-default-apps",
      ],
    });
    context.on?.("close", () => {
      const existing = contextEntries.get(key);
      if (existing?.promise === promise) {
        contextEntries.delete(key);
      }
      interactivePages.delete(key);
    });
    await installContextGuards(context);
    return context;
  })().catch((error) => {
    contextEntries.delete(key);
    throw error;
  });
  contextEntries.set(key, { promise, headed: headed === true, profileDir });
  return promise;
}

export async function getPlaywrightContext(sourceId = "default", options = {}) {
  const key = normalizeSourceKey(sourceId);
  const headed = resolveHeadedOption(options);
  const existing = contextEntries.get(key);
  if (!existing) {
    return createContextEntry(key, headed);
  }
  if (headed !== existing.headed) {
    if (!headed && existing.headed) {
      return existing.promise;
    }
    await closePlaywrightContext(key);
    return createContextEntry(key, headed);
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
  const safeTargetUrl = sanitizeNavigationUrl(targetUrl);
  const timeoutMs = Math.max(5_000, Number(options.maxTimeout || 45_000));
  const headed = resolveHeadedOption(options);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const context = await getPlaywrightContext(sourceKey, { headed });
    let page;
    try {
      page = await context.newPage();
      if (headed && PLAYWRIGHT_MINIMIZE_BACKGROUND) {
        await setPageWindowState(page, "minimized");
      }
      await page.goto(safeTargetUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
      await page.waitForLoadState("networkidle", { timeout: Math.min(timeoutMs, 15_000) }).catch(() => {});
      const { html, finalUrl, challengeReason: reason } = await captureSettledPageSnapshot(page, timeoutMs);
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
    } catch (error) {
      if (attempt === 0 && isClosedContextError(error)) {
        await closePlaywrightContext(sourceKey).catch(() => {});
        continue;
      }
      throw error;
    } finally {
      if (page && options.keepOpen !== true) {
        await page.close().catch(() => {});
      }
    }
  }
  throw new Error(`Failed to fetch ${safeTargetUrl} with Playwright.`);
}

/**
 * @param {string} targetUrl
 * @param {{ sourceId?: string; maxTimeout?: number }} [options]
 */
export async function openInteractivePageWithPlaywright(targetUrl, options = {}) {
  const sourceKey = normalizeSourceKey(options.sourceId || "default");
  const safeTargetUrl = sanitizeNavigationUrl(targetUrl);
  const timeoutMs = Math.max(5_000, Number(options.maxTimeout || 45_000));
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const context = await getPlaywrightContext(sourceKey, { headed: true });
      let page = interactivePages.get(sourceKey) || null;
      if (!page || page.isClosed()) {
        page = await context.newPage();
        interactivePages.set(sourceKey, page);
      }
      await setPageWindowState(page, "normal").catch(() => {});
      await page.goto(safeTargetUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
      await setPageWindowState(page, "normal").catch(() => {});
      await page.bringToFront().catch(() => {});
      await page.waitForLoadState("networkidle", { timeout: Math.min(timeoutMs, 15_000) }).catch(() => {});
      const { html, finalUrl, challengeReason: reason } = await captureSettledPageSnapshot(page, timeoutMs);
      return {
        status: reason ? "challenge_required" : "ok",
        finalUrl,
        html,
        challengeDetected: Boolean(reason),
        challengeReason: reason,
      };
    } catch (error) {
      if (attempt === 0 && isClosedContextError(error)) {
        interactivePages.delete(sourceKey);
        await closePlaywrightContext(sourceKey).catch(() => {});
        continue;
      }
      throw error;
    }
  }
  throw new Error(`Failed to open interactive Playwright page for ${safeTargetUrl}.`);
}

export function getPlaywrightProfileDir(sourceId) {
  if (sourceId == null) {
    return PROFILE_ROOT_DIR;
  }
  return profileDirForSource(normalizeSourceKey(sourceId));
}
