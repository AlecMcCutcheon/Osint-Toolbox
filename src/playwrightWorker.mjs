import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROFILE_DIR = resolve(__dirname, "..", "data", "playwright-profile");
const DEFAULT_VIEWPORT = { width: 1440, height: 900 };

let playwrightModulePromise = null;
let contextPromise = null;

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

async function getContext(headed = false) {
  if (!contextPromise) {
    contextPromise = (async () => {
      await mkdir(PROFILE_DIR, { recursive: true });
      const { chromium } = await loadPlaywright();
      return chromium.launchPersistentContext(PROFILE_DIR, {
        headless: !headed,
        viewport: DEFAULT_VIEWPORT,
        args: ["--disable-blink-features=AutomationControlled"],
      });
    })().catch((error) => {
      contextPromise = null;
      throw error;
    });
  }
  const context = await contextPromise;
  if (headed && context.browser()?.isConnected() === false) {
    contextPromise = null;
    return getContext(headed);
  }
  return context;
}

export async function closePlaywrightContext() {
  if (!contextPromise) {
    return false;
  }
  const pendingContext = contextPromise;
  contextPromise = null;
  try {
    const context = await pendingContext;
    await context.close().catch(() => {});
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} targetUrl
 * @param {{ maxTimeout?: number; headed?: boolean }} [options]
 */
export async function fetchPageWithPlaywright(targetUrl, options = {}) {
  const context = await getContext(options.headed === true);
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
    await page.close().catch(() => {});
  }
}

export function getPlaywrightProfileDir() {
  return PROFILE_DIR;
}