import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import "./env.mjs";
import { flareV1 } from "./flareClient.mjs";
import {
  destroyFlareSessionOnExit,
  ensureFlareSession,
  getFlareSessionId,
  getFlareSessionTtlMinutes,
  isFlareSessionLikelyInvalidError,
  isFlareSessionReuseEnabled,
  replaceFlareSessionAfterFailure,
  shouldDropFlareSessionAfterError,
} from "./flareSession.mjs";
import {
  getPhoneCache,
  isBypassQuery,
  setPhoneCache,
  deletePhoneCache,
  cacheStats,
  listRecentCacheRows,
} from "./phoneCache.mjs";
import { parseUsPhonebookHtml } from "./parseUsPhonebook.mjs";
import { parseUsPhonebookNameSearchHtml } from "./parseUsPhonebookNameSearch.mjs";
import { getDb, dbPath, deleteDatabaseFileAndReopen } from "./db/db.mjs";
import { rebuildGraphFromQueueItems } from "./graphRebuild.mjs";
import { enrichProfilePayload } from "./addressEnrichment.mjs";
import { withEnrichmentCache } from "./enrichmentCache.mjs";
import {
  getFullGraph,
  getNeighborhood,
  getUnifiedRelativesForPhoneDashed,
  searchEntitiesByLabel,
} from "./graphQuery.mjs";
import { ingestPhoneSearchParsed, ingestProfileParsed } from "./entityIngest.mjs";
import { parseUsPhonebookProfileHtml } from "./parseUsPhonebookProfile.mjs";
import { getNameSearchCache, setNameSearchCache } from "./nameSearchCache.mjs";
import {
  normalizeNameSearchPayload,
  normalizePhoneSearchPayload,
  normalizeProfileLookupPayload,
} from "./normalizedResult.mjs";
import { isUsPhonebookPersonProfilePath, profilePathnameOnly } from "./personKey.mjs";
import { getVectorStatus } from "./vectorStore.mjs";
import { dedupeInflight } from "./inflightDedupe.mjs";
import {
  getGraphDataStats,
  runGraphStartupMaintenance,
  wipeAllPersistedGraphAndCache,
} from "./graphMaintenance.mjs";
import { enrichPhoneNumber, enrichPhoneSearchParsedResult } from "./phoneEnrichment.mjs";
import { mergePeopleFinderFacts } from "./sourceObservations.mjs";
import { getSourceAuditSnapshot, getSourceDefinition, listSourceDefinitions } from "./sourceCatalog.mjs";
import { parseThatsThemPhoneHtml, buildThatsThemPhoneCandidateUrls } from "./thatsThem.mjs";
import { enrichTelecomNumber, enrichTelecomNumberAsync } from "./telecomEnrichment.mjs";
import { parseTruePeopleSearchPhoneHtml, buildTruePeopleSearchPhoneUrl } from "./truePeopleSearch.mjs";
import {
  getProtectedFetchHealth,
  listProtectedFetchEvents,
  recordProtectedFetchEvent,
} from "./protectedFetchMetrics.mjs";
import {
  clearPlaywrightProfile,
  closePlaywrightContext,
  fetchPageWithPlaywright,
  getPlaywrightProfileDir,
  openInteractivePageWithPlaywright,
} from "./playwrightWorker.mjs";
import {
  getSourceSession,
  listSourceSessions,
  markSourceSessionChecked,
  markSourceSessionOpened,
  resetSourceSession,
  setSourceSessionPaused,
} from "./sourceSessions.mjs";
import { listCandidateLeads, reviewCandidateLead, upsertCandidateLead } from "./candidateLeads.mjs";
import {
  annotateSourceResult,
  getThatsThemCandidatePattern,
  isSourceTrustFailure,
  rankThatsThemCandidateUrls,
  recordThatsThemCandidateOutcome,
  shouldSkipThatsThemCandidatePattern,
} from "./sourceStrategy.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
getDb();
runGraphStartupMaintenance();

const publicDir = join(__dirname, "..", "public");
const app = express();
const PORT = Number(process.env.APP_PORT || 3040);
const USPHONEBOOK = "https://www.usphonebook.com";
const FLARE_BASE_URL = (process.env.FLARE_BASE_URL || "http://127.0.0.1:8191").replace(/\/$/, "");
const DEFAULT_FLARE_PROXY_URL = String(process.env.FLARE_PROXY_URL || "").trim();
const PROTECTED_FETCH_ENGINE = String(process.env.PROTECTED_FETCH_ENGINE || "flare").trim().toLowerCase();
const PROTECTED_FETCH_COOLDOWN_MS = Math.max(0, Number(process.env.PROTECTED_FETCH_COOLDOWN_MS || 1500));
const PROTECTED_FETCH_FALLBACK_ON_FLARE_ERROR = !/^(0|false|no|off)$/i.test(
  String(process.env.PROTECTED_FETCH_FALLBACK_ON_FLARE_ERROR ?? "1")
);
const PROTECTED_FETCH_FALLBACK_ENGINE = String(
  process.env.PROTECTED_FETCH_FALLBACK_ENGINE || "playwright-local"
)
  .trim()
  .toLowerCase();
const DEFAULT_FLARE_MAX_TIMEOUT_MS = Number(
  process.env.FLARE_MAX_TIMEOUT_MS || 240000
);
const DEFAULT_FLARE_WAIT_AFTER_SECONDS = Number(
  process.env.FLARE_WAIT_AFTER_SECONDS || 0
);
const SCRAPE_LOGGING_ENABLED = !/^(0|false|no|off)$/i.test(
  String(process.env.SCRAPE_LOGGING ?? "1")
);
const SCRAPE_PROGRESS_INTERVAL_MS = Math.max(
  0,
  Number(process.env.SCRAPE_PROGRESS_INTERVAL_MS || 15000)
);
const EXTERNAL_SOURCE_TIMEOUT_MS = Number(process.env.EXTERNAL_SOURCE_TIMEOUT_MS || 45000);
const EXTERNAL_SOURCE_CACHE_TTL_MS = Math.max(
  3_600_000,
  Number(process.env.EXTERNAL_SOURCE_CACHE_TTL_MS || 7 * 24 * 60 * 60 * 1000)
);
const ENABLE_EXTERNAL_PEOPLE_SOURCES = process.env.ENABLE_EXTERNAL_PEOPLE_SOURCES !== "0";
const EXTERNAL_SOURCE_USER_AGENT =
  process.env.EXTERNAL_SOURCE_USER_AGENT ||
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const EXTERNAL_SOURCE_ACCEPT_LANGUAGE = process.env.EXTERNAL_SOURCE_ACCEPT_LANGUAGE || "en-US,en;q=0.9";
const US_STATES = new Map([
  ["AL", "alabama"], ["AK", "alaska"], ["AZ", "arizona"], ["AR", "arkansas"], ["CA", "california"],
  ["CO", "colorado"], ["CT", "connecticut"], ["DC", "district-of-columbia"], ["DE", "delaware"], ["FL", "florida"],
  ["GA", "georgia"], ["HI", "hawaii"], ["ID", "idaho"], ["IL", "illinois"], ["IN", "indiana"],
  ["IA", "iowa"], ["KS", "kansas"], ["KY", "kentucky"], ["LA", "louisiana"], ["ME", "maine"],
  ["MD", "maryland"], ["MA", "massachusetts"], ["MI", "michigan"], ["MN", "minnesota"], ["MS", "mississippi"],
  ["MO", "missouri"], ["MT", "montana"], ["NE", "nebraska"], ["NV", "nevada"], ["NH", "new-hampshire"],
  ["NJ", "new-jersey"], ["NM", "new-mexico"], ["NY", "new-york"], ["NC", "north-carolina"], ["ND", "north-dakota"],
  ["OH", "ohio"], ["OK", "oklahoma"], ["OR", "oregon"], ["PA", "pennsylvania"], ["RI", "rhode-island"],
  ["SC", "south-carolina"], ["SD", "south-dakota"], ["TN", "tennessee"], ["TX", "texas"], ["UT", "utah"],
  ["VT", "vermont"], ["VA", "virginia"], ["WA", "washington"], ["WV", "west-virginia"], ["WI", "wisconsin"],
  ["WY", "wyoming"],
]);

let protectedFetchCooldown = Promise.resolve();
let scrapeTraceCounter = 0;
const thatsThemCandidatePatternStats = new Map();

function sourceSessionStateMap() {
  return Object.fromEntries(listSourceSessions().map(({ sourceId, session }) => [sourceId, session]));
}

function sourceScopeMembers(sourceId) {
  const source = getSourceDefinition(sourceId);
  const scope = source.sessionScope || source.id;
  return listSourceDefinitions().filter((candidate) => (candidate.sessionScope || candidate.id) === scope);
}

function sourceContextKey(sourceId) {
  const source = getSourceDefinition(sourceId);
  return source.sessionScope || source.id;
}

function propagateSourceSessionUpdate(sourceId, updater) {
  return sourceScopeMembers(sourceId).map((source) => updater(source.id));
}

function sourceUrlForInteractiveSession(sourceId, overrideUrl = null) {
  const source = getSourceDefinition(sourceId);
  const url = String(overrideUrl || source.browserCheckUrl || source.browserEntryUrl || "").trim();
  if (!url) {
    throw new Error(`Source ${sourceId} does not define a browser entry URL yet.`);
  }
  return url;
}

function detectSourceLoginRequired(source, url, html) {
  const combined = `${String(url || "")}\n${String(html || "")}`.toLowerCase();
  if (source.sessionMode !== "required") {
    return false;
  }
  return /log in|login|sign in|sign-in|create new account|join facebook|continue with email|continue with phone/i.test(combined);
}

function detectSourceWarning(source, url, html) {
  const combined = `${String(url || "")}\n${String(html || "")}`.toLowerCase();
  if (!source.stopOnWarning) {
    return null;
  }
  if (/suspicious activity|checkpoint|account disabled|temporarily blocked|try again later|unusual activity/i.test(combined)) {
    return "warning_detected";
  }
  return null;
}

function evaluateSourceSessionResult(sourceId, browserResult) {
  const source = getSourceDefinition(sourceId);
  if (browserResult.challengeReason) {
    return {
      status: "challenge_required",
      lastWarning: browserResult.challengeReason,
      lastWarningDetail: browserResult.finalUrl || null,
    };
  }
  const warning = detectSourceWarning(source, browserResult.finalUrl, browserResult.html);
  if (warning) {
    return {
      status: "blocked",
      lastWarning: warning,
      lastWarningDetail: browserResult.finalUrl || null,
    };
  }
  if (detectSourceLoginRequired(source, browserResult.finalUrl, browserResult.html)) {
    return {
      status: "session_required",
      lastWarning: null,
      lastWarningDetail: null,
    };
  }
  return {
    status: "ready",
    lastWarning: null,
    lastWarningDetail: null,
  };
}

function defaultFlareProxy() {
  return DEFAULT_FLARE_PROXY_URL ? { url: DEFAULT_FLARE_PROXY_URL } : undefined;
}

/**
 * @param {{ url?: string } | undefined} proxy
 * @returns {{ url: string } | undefined}
 */
function resolveFlareProxy(proxy) {
  const url = String(proxy?.url || "").trim();
  if (url) {
    return { url };
  }
  return defaultFlareProxy();
}

/**
 * @param {string} targetUrl
 * @returns {Record<string, string>}
 */
function buildExternalSourceHeaders(targetUrl) {
  /** @type {Record<string, string>} */
  const headers = {
    "User-Agent": EXTERNAL_SOURCE_USER_AGENT,
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": EXTERNAL_SOURCE_ACCEPT_LANGUAGE,
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    "Upgrade-Insecure-Requests": "1",
  };
  try {
    const url = new URL(targetUrl);
    headers.Referer = `${url.origin}/`;
  } catch {
    // ignore invalid URLs here; fetch will fail later if needed.
  }
  return headers;
}

function normalizeProtectedFetchEngine(value) {
  const v = String(value || PROTECTED_FETCH_ENGINE || "flare").trim().toLowerCase();
  if (v === "auto") {
    return "auto";
  }
  if (v === "playwright" || v === "playwright-local") {
    return "playwright-local";
  }
  return "flare";
}

function nextScrapeTraceId() {
  scrapeTraceCounter += 1;
  return `${Date.now().toString(36)}-${scrapeTraceCounter.toString(36)}`;
}

function summarizeTargetUrl(targetUrl) {
  try {
    const url = new URL(targetUrl);
    return `${url.hostname}${url.pathname}${url.search}`;
  } catch {
    return String(targetUrl || "");
  }
}

function formatScrapeLogValue(value) {
  if (value == null) {
    return null;
  }
  if (typeof value === "string") {
    return /\s/.test(value) ? JSON.stringify(value) : value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function formatElapsedMs(ms) {
  if (!Number.isFinite(ms)) {
    return "n/a";
  }
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  const seconds = ms / 1000;
  return `${seconds >= 10 ? seconds.toFixed(0) : seconds.toFixed(1)}s`;
}

function createScrapeTrace(scope, targetUrl, meta = {}) {
  return {
    id: nextScrapeTraceId(),
    scope: String(scope || "scrape"),
    targetUrl,
    startedAt: Date.now(),
    meta,
  };
}

function logScrape(trace, message, details = {}) {
  if (!SCRAPE_LOGGING_ENABLED || !trace) {
    return;
  }
  const merged = { ...trace.meta, ...details };
  const suffix = Object.entries(merged)
    .filter(([, value]) => value != null && value !== "")
    .map(([key, value]) => `${key}=${formatScrapeLogValue(value)}`)
    .join(" ");
  const line = `[scrape ${trace.scope}:${trace.id}] ${message}${suffix ? ` ${suffix}` : ""}`;
  console.log(line);
}

function startScrapeHeartbeat(trace, stage, details = {}) {
  if (!SCRAPE_LOGGING_ENABLED || SCRAPE_PROGRESS_INTERVAL_MS <= 0 || !trace) {
    return () => {};
  }
  const startedAt = Date.now();
  const timer = setInterval(() => {
    logScrape(trace, `${stage}: still running`, {
      ...details,
      elapsed: formatElapsedMs(Date.now() - startedAt),
    });
  }, SCRAPE_PROGRESS_INTERVAL_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}

function logSourceParseOutcome(trace, sourceId, parsed, details = {}) {
  if (!trace || !parsed) {
    return;
  }
  const peopleCount = Array.isArray(parsed.people) ? parsed.people.length : null;
  const note = String(parsed.note || "").trim() || null;
  const reason = String(parsed.reason || "").trim() || null;
  const status = String(parsed.status || "unknown");
  const failureKind = String(parsed.failureKind || "").trim() || null;
  const message = status === "ok" ? "source parse ok" : `source parse ${status}`;
  logScrape(trace, message, {
    sourceId: sourceId || parsed.source || null,
    peopleCount,
    failureKind,
    reason,
    note,
    ...details,
  });
}

function recordSourceTrustFailure(targetUrl, engine, sourceId, parsed, options = {}) {
  if (!isSourceTrustFailure(parsed)) {
    return null;
  }
  return recordProtectedFetchEvent({
    ...trustEventBase(targetUrl, engine || "unknown", options),
    sourceId: sourceId || parsed.source || null,
    status: "source_trust_failure",
    challengeDetected: true,
    challengeReason: parsed.reason || null,
    parserStatus: parsed.status || null,
    failureKind: "source_trust",
  });
}

function resolveProtectedFetchFallbackEngine(primaryEngine) {
  if (!PROTECTED_FETCH_FALLBACK_ON_FLARE_ERROR) {
    return null;
  }
  const fallback = normalizeProtectedFetchEngine(PROTECTED_FETCH_FALLBACK_ENGINE);
  if (fallback === "auto" || fallback === primaryEngine) {
    return null;
  }
  return fallback;
}

function shouldFallbackAfterFlareError(error) {
  const message = String(error?.message || error);
  if (/FlareSolverr HTTP 5\d\d/i.test(message)) {
    return true;
  }
  if (/Error solving the challenge/i.test(message)) {
    return true;
  }
  if (/timed out|timeout/i.test(message)) {
    return true;
  }
  return false;
}

function shouldFallbackAfterFlareResult(result) {
  return result?.challengeDetected === true || result?.status === "challenge_required";
}

function maybeChallengeReason(text) {
  const m = String(text || "");
  if (/cloudflare|checking your browser|just a moment/i.test(m)) {
    return "cloudflare_challenge";
  }
  if (/captcha|recaptcha|hcaptcha|quick humanity check|verify you are human/i.test(m)) {
    return "captcha_challenge";
  }
  if (/access denied|forbidden|blocked/i.test(m)) {
    return "access_denied";
  }
  return null;
}

async function scheduleProtectedFetchCooldown() {
  if (PROTECTED_FETCH_COOLDOWN_MS <= 0) {
    return;
  }
  const prior = protectedFetchCooldown;
  protectedFetchCooldown = (async () => {
    try {
      await prior;
    } finally {
      await delay(PROTECTED_FETCH_COOLDOWN_MS);
    }
  })();
  await prior;
}

function trustEventBase(targetUrl, engine, options) {
  let hostname = null;
  try {
    hostname = new URL(targetUrl).hostname;
  } catch {
    hostname = null;
  }
  return {
    engine,
    hostname,
    url: targetUrl,
    maxTimeout: Number(options?.maxTimeout || 0) || null,
    sessionReuse: engine === "flare" ? isFlareSessionReuseEnabled() : null,
    defaultProxyConfigured: engine === "flare" ? Boolean(DEFAULT_FLARE_PROXY_URL) : null,
  };
}

function buildFlareGet(url, options) {
  const {
    maxTimeout,
    waitInSeconds,
    proxy,
    disableMedia,
    session,
    sessionTtlMinutes,
  } = options;
  const payload = {
    cmd: "request.get",
    url,
    maxTimeout,
  };
  const resolvedProxy = resolveFlareProxy(proxy);
  if (resolvedProxy) {
    payload.proxy = resolvedProxy;
  }
  if (session) {
    payload.session = session;
  }
  const sttl = sessionTtlMinutes;
  if (
    sttl != null &&
    !Number.isNaN(Number(sttl)) &&
    Number(sttl) > 0
  ) {
    payload.session_ttl_minutes = Number(sttl);
  }
  const wait =
    waitInSeconds != null && !Number.isNaN(Number(waitInSeconds))
      ? Number(waitInSeconds)
      : 0;
  if (wait > 0) {
    payload.waitInSeconds = wait;
  }
  if (disableMedia === true || (disableMedia == null && process.env.FLARE_DISABLE_MEDIA === "1")) {
    payload.disableMedia = true;
  }
  return payload;
}

/**
 * @param {string} targetUrl
 * @param {Omit<Parameters<typeof buildFlareGet>[1], "session" | "sessionTtlMinutes">} flareGetOptions
 * @returns {Promise<object>} Flare v1 success body
 */
async function flareGetPhonePage(targetUrl, flareGetOptions) {
  const base = FLARE_BASE_URL;
  const ttlM = isFlareSessionReuseEnabled() ? getFlareSessionTtlMinutes() : null;
  const sid0 = isFlareSessionReuseEnabled() ? await ensureFlareSession(base) : null;
  const run = (sid) =>
    flareV1(
      buildFlareGet(targetUrl, {
        ...flareGetOptions,
        session: sid || undefined,
        sessionTtlMinutes: sid && ttlM != null ? ttlM : undefined,
      }),
      { baseUrl: base }
    );
  try {
    return await run(sid0);
  } catch (e) {
    if (!isFlareSessionReuseEnabled()) {
      throw e;
    }
    if (isFlareSessionLikelyInvalidError(e)) {
      const sid1 = await replaceFlareSessionAfterFailure(base);
      return await run(sid1);
    }
    if (shouldDropFlareSessionAfterError(e)) {
      try {
        await replaceFlareSessionAfterFailure(base);
      } catch {
        // still surface the original Flare error
      }
    }
    throw e;
  }
}

async function runProtectedPageWithEngine(engine, targetUrl, options = {}) {
  const startedAt = Date.now();
  const trace =
    options.trace ||
    createScrapeTrace(options.sourceId || "protected_fetch", targetUrl, {
      sourceId: options.sourceId || null,
      target: summarizeTargetUrl(targetUrl),
    });
  const base = trustEventBase(targetUrl, engine, options);
  const stopHeartbeat = startScrapeHeartbeat(trace, `${engine} fetch`, {
    engine,
    timeoutMs: Number(options.maxTimeout || 0) || null,
  });
  logScrape(trace, `${engine} fetch started`, {
    engine,
    timeoutMs: Number(options.maxTimeout || 0) || null,
    disableMedia: options.disableMedia === true,
    target: summarizeTargetUrl(targetUrl),
  });
  try {
    if (engine === "playwright-local") {
      const pw = await fetchPageWithPlaywright(targetUrl, {
        maxTimeout: options.maxTimeout,
        headed: options.headed === true,
        sourceId: options.sourceId ? sourceContextKey(options.sourceId) : "default",
      });
      const event = recordProtectedFetchEvent({
        ...base,
        durationMs: Date.now() - startedAt,
        status: pw.status,
        challengeDetected: pw.challengeDetected === true,
        challengeReason: pw.challengeReason || null,
      });
      logScrape(trace, `${engine} fetch completed`, {
        engine,
        status: pw.status,
        elapsed: formatElapsedMs(Date.now() - startedAt),
        challengeReason: pw.challengeReason || null,
        finalUrl: summarizeTargetUrl(pw.finalUrl || targetUrl),
        htmlBytes: String(pw.html || "").length,
      });
      return {
        engine,
        trustEvent: event,
        status: pw.status,
        challengeDetected: pw.challengeDetected === true,
        challengeReason: pw.challengeReason || null,
        finalUrl: pw.finalUrl || targetUrl,
        html: String(pw.html || ""),
      };
    }
    const flareRes = await flareGetPhonePage(targetUrl, {
      maxTimeout: options.maxTimeout,
      waitInSeconds: options.waitInSeconds,
      proxy: options.proxy,
      disableMedia: options.disableMedia,
    });
    const html = String(flareRes.solution?.response || "");
    const challengeReason = maybeChallengeReason(flareRes.message || html);
    const event = recordProtectedFetchEvent({
      ...base,
      durationMs: Date.now() - startedAt,
      status: flareRes.status === "ok" ? "ok" : "error",
      httpStatus: flareRes.solution?.status || null,
      challengeDetected: Boolean(challengeReason),
      challengeReason,
    });
    logScrape(trace, `${engine} fetch completed`, {
      engine,
      status: flareRes.status === "ok" ? "ok" : "error",
      elapsed: formatElapsedMs(Date.now() - startedAt),
      httpStatus: flareRes.solution?.status || null,
      challengeReason,
      finalUrl: summarizeTargetUrl(flareRes.solution?.url || targetUrl),
      htmlBytes: html.length,
    });
    return {
      engine,
      trustEvent: event,
      status: flareRes.status === "ok" ? "ok" : "error",
      challengeDetected: Boolean(challengeReason),
      challengeReason,
      flare: flareRes,
      finalUrl: flareRes.solution?.url || targetUrl,
      html,
    };
  } catch (error) {
    const message = String(error?.message || error);
    const timedOut = /timed out|timeout/i.test(message);
    const challengeReason = maybeChallengeReason(message);
    const event = recordProtectedFetchEvent({
      ...base,
      durationMs: Date.now() - startedAt,
      status: timedOut ? "timeout" : challengeReason ? "challenge_required" : "error",
      challengeDetected: Boolean(challengeReason),
      challengeReason,
      error: message,
    });
    logScrape(trace, `${engine} fetch failed`, {
      engine,
      status: event.status,
      elapsed: formatElapsedMs(Date.now() - startedAt),
      challengeReason,
      error: message,
    });
    throw Object.assign(new Error(message), {
      protectedFetchEngine: engine,
      protectedFetchStatus: event.status,
      challengeDetected: Boolean(challengeReason),
      challengeReason,
      trustEvent: event,
    });
  } finally {
    stopHeartbeat();
  }
}

async function getProtectedPage(targetUrl, options = {}) {
  const engine = normalizeProtectedFetchEngine(options.engine);
  const trace =
    options.trace ||
    createScrapeTrace(options.sourceId || "protected_fetch", targetUrl, {
      sourceId: options.sourceId || null,
      requestedEngine: engine,
      target: summarizeTargetUrl(targetUrl),
    });
  logScrape(trace, "protected fetch queued", {
    requestedEngine: engine,
    cooldownMs: PROTECTED_FETCH_COOLDOWN_MS || null,
    maxTimeout: Number(options.maxTimeout || 0) || null,
  });
  await scheduleProtectedFetchCooldown();
  if (engine !== "auto") {
    if (engine !== "flare") {
      return runProtectedPageWithEngine(engine, targetUrl, { ...options, trace });
    }
    try {
      const flareResult = await runProtectedPageWithEngine("flare", targetUrl, { ...options, trace });
      const fallbackEngine = resolveProtectedFetchFallbackEngine("flare");
      if (!fallbackEngine || !shouldFallbackAfterFlareResult(flareResult)) {
        return flareResult;
      }
      logScrape(trace, "flare result requires fallback", {
        fallbackEngine,
        challengeReason: flareResult.challengeReason || null,
      });
      const fallbackResult = await runProtectedPageWithEngine(fallbackEngine, targetUrl, {
        ...options,
        trace,
      });
      return {
        ...fallbackResult,
        requestedEngine: "flare",
        fallbackFromEngine: "flare",
        initialProtectedFetchStatus: flareResult.status,
        initialChallengeReason: flareResult.challengeReason || null,
      };
    } catch (flareError) {
      const fallbackEngine = resolveProtectedFetchFallbackEngine("flare");
      if (!fallbackEngine || !shouldFallbackAfterFlareError(flareError)) {
        throw flareError;
      }
      logScrape(trace, "flare failed; trying fallback engine", {
        fallbackEngine,
        error: String(flareError?.message || flareError),
      });
      try {
        const fallbackResult = await runProtectedPageWithEngine(fallbackEngine, targetUrl, {
          ...options,
          trace,
        });
        return {
          ...fallbackResult,
          requestedEngine: "flare",
          fallbackFromEngine: "flare",
          initialProtectedFetchError: String(flareError?.message || flareError),
        };
      } catch (fallbackError) {
        throw Object.assign(fallbackError, {
          requestedEngine: "flare",
          fallbackFromEngine: "flare",
          initialProtectedFetchError: String(flareError?.message || flareError),
        });
      }
    }
  }
  try {
    const primary = await runProtectedPageWithEngine("playwright-local", targetUrl, {
      ...options,
      trace,
    });
    if (primary.status === "ok") {
      return {
        ...primary,
        requestedEngine: "auto",
      };
    }
    logScrape(trace, "playwright-local returned non-ok result; trying flare", {
      status: primary.status,
      challengeReason: primary.challengeReason || null,
    });
    const flareFallback = await runProtectedPageWithEngine("flare", targetUrl, {
      ...options,
      trace,
    });
    return {
      ...flareFallback,
      requestedEngine: "auto",
      fallbackFromEngine: "playwright-local",
      initialProtectedFetchStatus: primary.status,
      initialChallengeReason: primary.challengeReason || null,
    };
  } catch (playwrightError) {
    const fallbackAllowed =
      playwrightError?.protectedFetchStatus === "challenge_required" ||
      playwrightError?.protectedFetchStatus === "timeout" ||
      playwrightError?.protectedFetchStatus === "error";
    if (!fallbackAllowed) {
      throw playwrightError;
    }
    try {
      logScrape(trace, "playwright-local failed; trying flare", {
        error: String(playwrightError?.message || playwrightError),
      });
      const flareFallback = await runProtectedPageWithEngine("flare", targetUrl, {
        ...options,
        trace,
      });
      return {
        ...flareFallback,
        requestedEngine: "auto",
        fallbackFromEngine: "playwright-local",
      };
    } catch (flareError) {
      throw Object.assign(flareError, {
        requestedEngine: "auto",
        fallbackFromEngine: "playwright-local",
        initialProtectedFetchError: String(playwrightError?.message || playwrightError),
      });
    }
  }
}

/**
 * @param {string} targetUrl
 * @param {{ maxTimeout?: number; disableMedia?: boolean; useFlare?: boolean; engine?: string; headed?: boolean; sourceId?: string }} [options]
 * @returns {Promise<{ html: string; finalUrl?: string; engine?: string; requestedEngine?: string }>}
 */
async function fetchHtmlForSource(targetUrl, options = {}) {
  const useFlare = options.useFlare !== false;
  const trace =
    options.trace ||
    createScrapeTrace(options.sourceId || "source_fetch", targetUrl, {
      sourceId: options.sourceId || null,
      target: summarizeTargetUrl(targetUrl),
    });
  logScrape(trace, "source fetch started", {
    sourceId: options.sourceId || null,
    requestedEngine: options.engine || (useFlare ? "flare" : "direct"),
    maxTimeout: Number(options.maxTimeout || 0) || null,
  });
  if (useFlare) {
    const result = await getProtectedPage(targetUrl, {
      engine: options.engine,
      maxTimeout: Number(options.maxTimeout || EXTERNAL_SOURCE_TIMEOUT_MS),
      waitInSeconds: 0,
      disableMedia: options.disableMedia !== false,
      sourceId: options.sourceId,
      trace,
    });
    if (result.status !== "ok" || !result.html) {
      if (result.status === "challenge_required") {
        throw new Error(`Protected fetch challenge required (${result.challengeReason || result.engine})`);
      }
      throw new Error(`${result.engine}: protected fetch did not return HTML`);
    }
    logScrape(trace, "source fetch completed", {
      sourceId: options.sourceId || null,
      engine: result.engine,
      elapsed: formatElapsedMs(Date.now() - trace.startedAt),
      htmlBytes: result.html.length,
      finalUrl: summarizeTargetUrl(result.finalUrl || targetUrl),
    });
    return {
      html: result.html,
      finalUrl: result.finalUrl || targetUrl,
      engine: result.engine,
      requestedEngine: options.engine || (useFlare ? "flare" : "direct"),
    };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(options.maxTimeout || EXTERNAL_SOURCE_TIMEOUT_MS));
  try {
    const res = await fetch(targetUrl, {
      signal: controller.signal,
      headers: buildExternalSourceHeaders(targetUrl),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const html = await res.text();
    logScrape(trace, "direct source fetch completed", {
      sourceId: options.sourceId || null,
      elapsed: formatElapsedMs(Date.now() - trace.startedAt),
      httpStatus: res.status,
      htmlBytes: html.length,
      finalUrl: summarizeTargetUrl(res.url || targetUrl),
    });
    return {
      html,
      finalUrl: res.url,
      engine: "direct",
      requestedEngine: "direct",
    };
  } catch (error) {
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
      fetchEngine:
        error?.fetchEngine ||
        error?.protectedFetchEngine ||
        error?.engine ||
        options.engine ||
        (useFlare ? "flare" : "direct"),
      requestedEngine: options.engine || (useFlare ? "flare" : "direct"),
      targetUrl,
      sourceId: options.sourceId || null,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {string} dashed
 * @returns {Promise<object>}
 */
async function fetchTruePeopleSearchSource(dashed) {
  const searchUrl = buildTruePeopleSearchPhoneUrl(dashed);
  const session = getSourceSession("truepeoplesearch");
  if (session?.effectiveStatus !== "ready") {
    return {
      source: "truepeoplesearch",
      status: "session_required",
      failureKind: "source_trust",
      searchUrl,
      people: [],
      note: session?.paused
        ? "TruePeopleSearch source is paused in Settings. Resume the source and re-check the session before retrying."
        : "Open TruePeopleSearch in Settings, complete any challenge, then click Check session before retrying.",
    };
  }
  return withEnrichmentCache(
    "source:truepeoplesearch",
    dashed,
    EXTERNAL_SOURCE_CACHE_TTL_MS,
    async () => {
    const trace = createScrapeTrace("truepeoplesearch", searchUrl, {
      sourceId: "truepeoplesearch",
      target: summarizeTargetUrl(searchUrl),
    });
    try {
      const { html, finalUrl, engine } = await fetchHtmlForSource(searchUrl, {
        maxTimeout: EXTERNAL_SOURCE_TIMEOUT_MS,
        disableMedia: true,
        useFlare: true,
        engine: "playwright-local",
        sourceId: "truepeoplesearch",
        trace,
      });
      const result = annotateSourceResult(parseTruePeopleSearchPhoneHtml(html, finalUrl || searchUrl), {
        engine: engine || null,
        finalUrl: finalUrl || searchUrl,
      });
      if (result.status === "ok") {
        markSourceSessionChecked("truepeoplesearch", "ready", {
          lastWarning: null,
          lastWarningDetail: null,
        });
      } else if (result.status === "blocked") {
        markSourceSessionChecked("truepeoplesearch", "challenge_required", {
          lastWarning: result.reason || result.note || "blocked",
          lastWarningDetail: finalUrl || searchUrl,
        });
      }
      recordSourceTrustFailure(searchUrl, engine, "truepeoplesearch", result, {
        maxTimeout: EXTERNAL_SOURCE_TIMEOUT_MS,
        sourceId: "truepeoplesearch",
      });
      logSourceParseOutcome(trace, "truepeoplesearch", result, {
        engine: result.engine || null,
        finalUrl: summarizeTargetUrl(result.finalUrl || searchUrl),
      });
      return result;
    } catch (e) {
      if (e?.challengeReason || /challenge|captcha|cloudflare|attention required/i.test(String(e?.message || e))) {
        markSourceSessionChecked("truepeoplesearch", "challenge_required", {
          lastWarning: e?.challengeReason || String(e?.message || e),
          lastWarningDetail: searchUrl,
        });
      }
      logScrape(trace, "source parse error", {
        sourceId: "truepeoplesearch",
        engine: e?.fetchEngine || e?.protectedFetchEngine || e?.requestedEngine || null,
        reason: String(e?.message || e),
      });
      return {
        source: "truepeoplesearch",
        status: "error",
        failureKind: "fetch_or_parse",
        searchUrl,
        people: [],
        note: String(e?.message || e),
      };
    }
    },
    (value) => value?.status === "ok" || value?.status === "no_match"
  );
}

/**
 * @param {string} dashed
 * @returns {Promise<object>}
 */
async function fetchThatsThemSource(dashed) {
  return withEnrichmentCache("source:thatsthem", dashed, EXTERNAL_SOURCE_CACHE_TTL_MS, async () => {
    const candidates = rankThatsThemCandidateUrls(buildThatsThemPhoneCandidateUrls(dashed), thatsThemCandidatePatternStats);
    let firstNoMatch = null;
    let lastBlockedResult = null;
    for (const searchUrl of candidates) {
      const trace = createScrapeTrace("thatsthem", searchUrl, {
        sourceId: "thatsthem",
        target: summarizeTargetUrl(searchUrl),
      });
      const candidatePattern = getThatsThemCandidatePattern(searchUrl);
      const patternStats = thatsThemCandidatePatternStats.get(candidatePattern);
      if (shouldSkipThatsThemCandidatePattern(patternStats)) {
        const skipped = annotateSourceResult(
          {
            source: "thatsthem",
            status: "no_match",
            reason: "candidate_pattern_demoted",
            searchUrl,
            people: [],
            note: `Skipped ${candidatePattern} candidate after repeated not-found responses.`,
          },
          {
            candidatePattern,
          }
        );
        if (!firstNoMatch) {
          firstNoMatch = skipped;
        }
        logScrape(trace, "source candidate skipped", {
          sourceId: "thatsthem",
          candidatePattern,
          reason: skipped.reason,
        });
        continue;
      }
      try {
        const { html, finalUrl, engine } = await fetchHtmlForSource(searchUrl, {
          maxTimeout: EXTERNAL_SOURCE_TIMEOUT_MS,
          disableMedia: true,
          useFlare: true,
          sourceId: "thatsthem",
          trace,
        });
        const parsed = annotateSourceResult(parseThatsThemPhoneHtml(html, finalUrl || searchUrl), {
          engine: engine || null,
          finalUrl: finalUrl || searchUrl,
          candidatePattern,
        });
        recordThatsThemCandidateOutcome(thatsThemCandidatePatternStats, searchUrl, parsed);
        recordSourceTrustFailure(searchUrl, engine, "thatsthem", parsed, {
          maxTimeout: EXTERNAL_SOURCE_TIMEOUT_MS,
          sourceId: "thatsthem",
        });
        logSourceParseOutcome(trace, "thatsthem", parsed, {
          engine: parsed.engine || null,
          finalUrl: summarizeTargetUrl(parsed.finalUrl || searchUrl),
          candidatePattern,
        });
        if (parsed.status === "ok") {
          return parsed;
        }
        if (parsed.status === "blocked") {
          lastBlockedResult = parsed;
          continue;
        }
        if (!firstNoMatch && parsed.status === "no_match") {
          firstNoMatch = parsed;
        }
      } catch (e) {
        recordThatsThemCandidateOutcome(thatsThemCandidatePatternStats, searchUrl, null);
        logScrape(trace, "source parse error", {
          sourceId: "thatsthem",
          candidatePattern,
          engine: e?.fetchEngine || e?.protectedFetchEngine || e?.requestedEngine || null,
          reason: String(e?.message || e),
        });
        // try the next candidate
      }
    }
    // Playwright session fallback if all candidates were blocked
    if (lastBlockedResult) {
      const sess = getSourceSession("thatsthem");
      if (sess?.session?.status === "ready") {
        for (const searchUrl of candidates) {
          const candidatePattern = getThatsThemCandidatePattern(searchUrl);
          const patternStats = thatsThemCandidatePatternStats.get(candidatePattern);
          const trace = createScrapeTrace("thatsthem", searchUrl, {
            sourceId: "thatsthem",
            target: summarizeTargetUrl(searchUrl),
          });
          if (shouldSkipThatsThemCandidatePattern(patternStats)) {
            logScrape(trace, "source candidate skipped", {
              sourceId: "thatsthem",
              candidatePattern,
              reason: "candidate_pattern_demoted",
            });
            continue;
          }
          try {
            const { html: pwHtml, finalUrl: pwFinalUrl, engine: pwEngine } = await fetchHtmlForSource(searchUrl, {
              maxTimeout: EXTERNAL_SOURCE_TIMEOUT_MS,
              disableMedia: true,
              useFlare: true,
              engine: "playwright-local",
              sourceId: "thatsthem",
              trace,
            });
            const parsed = annotateSourceResult(parseThatsThemPhoneHtml(pwHtml, pwFinalUrl || searchUrl), {
              engine: pwEngine || "playwright-local",
              finalUrl: pwFinalUrl || searchUrl,
              candidatePattern,
            });
            recordThatsThemCandidateOutcome(thatsThemCandidatePatternStats, searchUrl, parsed);
            recordSourceTrustFailure(searchUrl, pwEngine || "playwright-local", "thatsthem", parsed, {
              maxTimeout: EXTERNAL_SOURCE_TIMEOUT_MS,
              sourceId: "thatsthem",
            });
            logSourceParseOutcome(trace, "thatsthem", parsed, {
              engine: parsed.engine || "playwright-local",
              finalUrl: summarizeTargetUrl(parsed.finalUrl || searchUrl),
              candidatePattern,
            });
            if (parsed.status === "ok" || parsed.status === "no_match") {
              return parsed;
            }
          } catch (e) {
            recordThatsThemCandidateOutcome(thatsThemCandidatePatternStats, searchUrl, null);
            logScrape(trace, "source parse error", {
              sourceId: "thatsthem",
              candidatePattern,
              engine: e?.fetchEngine || e?.protectedFetchEngine || e?.requestedEngine || null,
              reason: String(e?.message || e),
            });
            // try next
          }
        }
      }
      return lastBlockedResult;
    }
    if (firstNoMatch) {
      return firstNoMatch;
    }
    return {
      source: "thatsthem",
      status: "error",
      failureKind: "fetch_or_parse",
      searchUrl: candidates[0],
      people: [],
      note: "No candidate ThatsThem URL returned a parseable result.",
    };
  });
}

/**
 * @param {string} dashed
 * @returns {Promise<object>}
 */
async function enrichPhoneWithExternalSources(dashed) {
  const telecom = await enrichTelecomNumberAsync(dashed);
  if (!ENABLE_EXTERNAL_PEOPLE_SOURCES) {
    return {
      peopleFinders: [],
      mergedFacts: mergePeopleFinderFacts([]),
      telecom,
    };
  }
  const peopleFinders = await Promise.all([
    fetchTruePeopleSearchSource(dashed),
    fetchThatsThemSource(dashed),
  ]);
  return {
    peopleFinders,
    mergedFacts: mergePeopleFinderFacts(peopleFinders),
    telecom,
  };
}

class HttpReplyError extends Error {
  /**
   * @param {number} status
   * @param {object} body
   */
  constructor(status, body) {
    super(`HTTP ${status}`);
    this.name = "HttpReplyError";
    this.status = status;
    this.body = body;
  }
}

/**
 * @param {string} dashed
 * @param {{ cacheBypass: boolean; doIngest: boolean; maxTimeout: number; waitInSeconds: number; disableMedia: boolean | undefined; proxyUrl: string | undefined; engine?: string; }} p
 * @returns {string}
 */
function phoneSearchMissDedupKey(dashed, p) {
  return [
    "psm",
    dashed,
    p.cacheBypass ? 1 : 0,
    p.doIngest ? 1 : 0,
    p.maxTimeout,
    p.waitInSeconds,
    p.disableMedia === true ? 1 : p.disableMedia === false ? 0 : "u",
    p.engine || "",
    p.proxyUrl || "",
  ].join("|");
}

/**
 * @param {object} ctx
 * @param {string} ctx.dashed
 * @param {string} ctx.url
 * @param {number} ctx.maxTimeout
 * @param {number} ctx.waitInSeconds
 * @param {{ url: string } | undefined} ctx.proxy
 * @param {boolean | undefined} ctx.disableMedia
 * @param {boolean} ctx.doIngest
 * @param {boolean} ctx.cacheBypass
 * @param {string | undefined} [ctx.engine]
 * @returns {Promise<object>}
 */
async function fetchPhoneSearchOnCacheMiss(ctx) {
  const {
    dashed,
    url,
    maxTimeout,
    waitInSeconds,
    proxy,
    disableMedia,
    cacheBypass,
  } = ctx;
  const trace = createScrapeTrace("usphonebook_phone_search", url, {
    phone: dashed,
    cacheBypass: cacheBypass === true,
  });
  logScrape(trace, "phone search started", {
    phone: dashed,
    requestedEngine: ctx.engine || PROTECTED_FETCH_ENGINE,
    maxTimeout,
  });
  const fetchResult = await getProtectedPage(url, {
    engine: ctx.engine,
    maxTimeout,
    waitInSeconds,
    proxy,
    disableMedia,
    sourceId: "usphonebook_phone_search",
    trace,
  });
  if (fetchResult.status === "challenge_required") {
    throw new HttpReplyError(502, {
      error: `Challenge required (${fetchResult.challengeReason || fetchResult.engine})`,
      engine: fetchResult.engine,
      challengeRequired: true,
      challengeReason: fetchResult.challengeReason || null,
      url: fetchResult.finalUrl || url,
    });
  }
  if (fetchResult.status !== "ok" || !fetchResult.html) {
    throw new HttpReplyError(502, {
      error: `${fetchResult.engine}: protected fetch did not return HTML`,
      engine: fetchResult.engine,
    });
  }
  const html = fetchResult.html;
  const status = fetchResult.flare?.solution?.status || null;
  logScrape(trace, "phone search HTML received; parsing", {
    engine: fetchResult.engine,
    httpStatus: status,
    htmlBytes: html.length,
    finalUrl: summarizeTargetUrl(fetchResult.finalUrl || url),
  });
  const parsed = enrichPhoneSearchParsedResult(parseUsPhonebookHtml(html), dashed);
  const payload = {
    url,
    httpStatus: status,
    userAgent: fetchResult.flare?.solution?.userAgent || null,
    fetchEngine: fetchResult.engine,
    parsed,
    phoneMetadata: enrichPhoneNumber(dashed),
    rawHtmlLength: html.length,
  };
  payload.normalized = normalizePhoneSearchPayload(payload, dashed);
  if (!cacheBypass) {
    setPhoneCache(dashed, payload);
  }
  logScrape(trace, "phone search completed", {
    engine: fetchResult.engine,
    elapsed: formatElapsedMs(Date.now() - trace.startedAt),
    profilePath: parsed?.profilePath || null,
    rawHtmlLength: html.length,
  });
  return payload;
}

/**
 * @param {string} key
 * @param {{ cacheBypass: boolean; maxTimeout: number; waitInSeconds: number; disableMedia: boolean | undefined; proxyUrl: string | undefined; engine?: string; }} p
 * @returns {string}
 */
function nameSearchMissDedupKey(key, p) {
  return [
    "nsm",
    key,
    p.cacheBypass ? 1 : 0,
    p.maxTimeout,
    p.waitInSeconds,
    p.disableMedia === true ? 1 : p.disableMedia === false ? 0 : "u",
    p.engine || "",
    p.proxyUrl || "",
  ].join("|");
}

/**
 * @param {{ cacheKey: string; path: string; url: string; name: string; city: string; stateSlug: string | null; maxTimeout: number; waitInSeconds: number; proxy: { url: string } | undefined; disableMedia: boolean | undefined; cacheBypass: boolean; engine?: string; }} ctx
 * @returns {Promise<object>}
 */
async function fetchNameSearchOnCacheMiss(ctx) {
  const trace = createScrapeTrace("usphonebook_name_search", ctx.url, {
    query: `${ctx.name}${ctx.city ? `, ${ctx.city}` : ""}${ctx.stateSlug ? `, ${ctx.stateSlug}` : ""}`,
    cacheBypass: ctx.cacheBypass === true,
  });
  logScrape(trace, "name search started", {
    requestedEngine: ctx.engine || PROTECTED_FETCH_ENGINE,
    maxTimeout: ctx.maxTimeout,
    path: ctx.path,
  });
  const fetchResult = await getProtectedPage(ctx.url, {
    engine: ctx.engine,
    maxTimeout: ctx.maxTimeout,
    waitInSeconds: ctx.waitInSeconds,
    proxy: ctx.proxy,
    disableMedia: ctx.disableMedia,
    sourceId: "usphonebook_name_search",
    trace,
  });
  if (fetchResult.status === "challenge_required") {
    throw new HttpReplyError(502, {
      error: `Challenge required (${fetchResult.challengeReason || fetchResult.engine})`,
      engine: fetchResult.engine,
      challengeRequired: true,
      challengeReason: fetchResult.challengeReason || null,
      url: fetchResult.finalUrl || ctx.url,
    });
  }
  if (fetchResult.status !== "ok" || !fetchResult.html) {
    throw new HttpReplyError(502, {
      error: `${fetchResult.engine}: protected fetch did not return HTML`,
      engine: fetchResult.engine,
    });
  }
  const html = String(fetchResult.html);
  logScrape(trace, "name search HTML received; parsing", {
    engine: fetchResult.engine,
    htmlBytes: html.length,
    finalUrl: summarizeTargetUrl(fetchResult.finalUrl || ctx.url),
  });
  const payload = {
    url: fetchResult.finalUrl || ctx.url,
    httpStatus: fetchResult.flare?.solution?.status || null,
    userAgent: fetchResult.flare?.solution?.userAgent || null,
    fetchEngine: fetchResult.engine,
    rawHtmlLength: html.length,
    search: {
      name: ctx.name,
      city: ctx.city,
      state: ctx.stateSlug,
      path: ctx.path,
    },
    parsed: parseUsPhonebookNameSearchHtml(html),
  };
  payload.normalized = normalizeNameSearchPayload(payload);
  if (!ctx.cacheBypass) {
    setNameSearchCache(ctx.cacheKey, payload);
  }
  logScrape(trace, "name search completed", {
    engine: fetchResult.engine,
    elapsed: formatElapsedMs(Date.now() - trace.startedAt),
    resultCount: Array.isArray(payload.parsed?.rows)
      ? payload.parsed.rows.length
      : Array.isArray(payload.parsed?.people)
        ? payload.parsed.people.length
        : null,
  });
  return payload;
}

app.use(express.json({ limit: "8mb" }));
app.use(express.static(publicDir));

function normalizePhone(phone) {
  if (phone == null) return "";
  return String(phone).replace(/[^\d-]/g, "");
}

function toDashed(phone) {
  const p = normalizePhone(phone);
  if (/^\d{3}-\d{3}-\d{4}$/.test(p)) {
    return p;
  }
  if (/^\d{10}$/.test(p)) {
    return `${p.slice(0, 3)}-${p.slice(3, 6)}-${p.slice(6)}`;
  }
  return null;
}

/**
 * @param {string} s
 * @returns {string}
 */
function cleanSearchText(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

/**
 * @param {string} value
 * @returns {string}
 */
function slugifySearchSegment(value) {
  return cleanSearchText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * @param {string} value
 * @returns {string | null}
 */
function normalizeStateSlug(value) {
  const raw = cleanSearchText(value);
  if (!raw) {
    return null;
  }
  const upper = raw.toUpperCase();
  if (US_STATES.has(upper)) {
    return US_STATES.get(upper) || null;
  }
  const slug = slugifySearchSegment(raw);
  for (const candidate of US_STATES.values()) {
    if (candidate === slug) {
      return candidate;
    }
  }
  return null;
}

/**
 * @param {unknown} raw
 * @returns {{ ok: true; name: string; nameSlug: string; city: string; citySlug: string | null; stateSlug: string | null; cacheKey: string; path: string; } | { ok: false; error: string }}
 */
function normalizeNameSearchRequest(raw) {
  const body = raw && typeof raw === "object" ? raw : {};
  const name = cleanSearchText(body.name ?? "");
  if (!name) {
    return { ok: false, error: "Name is required" };
  }
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length < 2) {
    return { ok: false, error: "Please include at least first and last name" };
  }
  const nameSlug = slugifySearchSegment(name);
  if (!nameSlug || !nameSlug.includes("-")) {
    return { ok: false, error: "Please include at least first and last name" };
  }
  const city = cleanSearchText(body.city ?? "");
  const citySlug = city ? slugifySearchSegment(city) : null;
  const stateSlug = normalizeStateSlug(body.state ?? body.stateCode ?? "");
  if (city && !stateSlug) {
    return { ok: false, error: "State is required when city is provided" };
  }
  const segments = [nameSlug];
  if (stateSlug) {
    segments.push(stateSlug);
  }
  if (citySlug) {
    segments.push(citySlug);
  }
  return {
    ok: true,
    name,
    nameSlug,
    city,
    citySlug,
    stateSlug,
    cacheKey: segments.join("|"),
    path: `/${segments.join("/")}`,
  };
}

/**
 * @param {unknown} v
 * @returns {boolean}
 */
function wantIngest(v) {
  if (v === "0" || v === 0 || v === false || v === "false" || v === "no") {
    return false;
  }
  return true;
}

/**
 * @param {object} payload
 * @param {string} dashed
 * @param {boolean} doIngest
 * @returns {object}
 */
async function finalizePhoneSearchPayload(payload, dashed, doIngest, opts = {}) {
  const parsed = enrichPhoneSearchParsedResult(payload?.parsed || {}, dashed);
  const externalSources = payload?.externalSources || (await enrichPhoneWithExternalSources(dashed));
  parsed.externalSources = externalSources;
  parsed.mergedPeopleFinderFacts = externalSources.mergedFacts;
  const graphIngestRaw = doIngest ? ingestPhoneSearchParsed(parsed, dashed, null) : null;
  const result = {
    ...payload,
    parsed,
    phoneMetadata: enrichPhoneNumber(dashed),
    externalSources,
    normalized: normalizePhoneSearchPayload(
      {
        ...payload,
        parsed,
        phoneMetadata: enrichPhoneNumber(dashed),
        externalSources,
      },
      dashed
    ),
    graphIngest: graphIngestRaw
      ? {
          newFieldsByEntity: graphIngestRaw.newFieldsByEntity,
          linkedIds: graphIngestRaw.linkedIds,
          runId: graphIngestRaw.runId,
        }
      : null,
  };
  if (opts.autoFollowProfile) {
    const profilePath = parsed?.profilePath || null;
    if (profilePath) {
      try {
        const profileResult = await fetchProfileData(profilePath, {
          engine: opts.engine,
          maxTimeout: opts.maxTimeout,
          doIngest,
          contextDashed: dashed,
        });
        // Don't expose raw HTML in the auto-follow result
        const { rawHtml: _rawHtml, ...profileResultClean } = profileResult;
        result.autoProfile = profileResultClean;
      } catch (e) {
        result.autoProfile = { error: String(e?.message || e), profilePath };
      }
    } else {
      result.autoProfile = null;
    }
  }
  return result;
}

app.post("/api/graph/rebuild", async (req, res) => {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const items = body.items;
  if (!Array.isArray(items)) {
    return res.status(400).json({ ok: false, error: "body.items: array required" });
  }
  if (items.length > 2000) {
    return res.status(400).json({ ok: false, error: "body.items: too many entries" });
  }
  try {
    const { itemResults } = await rebuildGraphFromQueueItems(items);
    res.json({ ok: true, itemResults });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.get("/api/phone/relatives", (req, res) => {
  const dashed = toDashed(req.query.phone || req.query.dashed || "");
  if (!dashed) {
    return res.status(400).json({ ok: false, error: "phone (or dashed) with 10 US digits is required" });
  }
  try {
    const { primaryPersonId, relatives } = getUnifiedRelativesForPhoneDashed(dashed);
    res.json({
      ok: true,
      phoneDashed: dashed,
      primaryPersonId: primaryPersonId || null,
      relatives,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.get("/api/lookups/recent", (req, res) => {
  try {
    const limit = Number(req.query.limit || 30);
    const rows = listRecentCacheRows(limit);
    res.json({ ok: true, rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

/**
 * Best-effort: delete cached phone HTML for one number. Graph is aligned via POST /api/graph/rebuild.
 */
app.post("/api/lookups/purge", (req, res) => {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const phone = toDashed(normalizePhone(body.phone ?? "")) || toDashed(body.dashed) || null;
  if (!phone) {
    return res.status(400).json({ ok: false, error: "body.phone: dashed 10-digit number required" });
  }
  const removeCache = body.removeCache === true;
  if (!removeCache) {
    return res.json({ ok: true, removed: { cache: false } });
  }
  try {
    const cache = deletePhoneCache(phone);
    res.json({ ok: true, removed: { cache } });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

/**
 * Soft: clear graph tables + response_cache. Hard: delete SQLite file and WAL, reopen (schema re-applied).
 * Body: { hard?: boolean } — default false.
 */
app.post("/api/db/wipe", (req, res) => {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const hard = body.hard === true;
  try {
    if (hard) {
      deleteDatabaseFileAndReopen();
      return res.json({
        ok: true,
        mode: "hard",
        path: dbPath(),
        graph: getGraphDataStats(),
      });
    }
    const wr = wipeAllPersistedGraphAndCache();
    return res.json({
      ok: true,
      mode: "soft",
      path: dbPath(),
      responseCacheRowsRemoved: wr.responseCacheRowsRemoved,
      graph: getGraphDataStats(),
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.get("/api/health", async (_req, res) => {
  const vector = await getVectorStatus();
  const trustHealth = getProtectedFetchHealth();
  try {
    const data = await flareV1({ cmd: "sessions.list" }, { baseUrl: FLARE_BASE_URL });
    res.json({
      ok: true,
      sqlite: dbPath(),
      cache: cacheStats(),
      graph: getGraphDataStats(),
      vector,
      flareBase: FLARE_BASE_URL,
      protectedFetchEngine: PROTECTED_FETCH_ENGINE,
      protectedFetchCooldownMs: PROTECTED_FETCH_COOLDOWN_MS,
      protectedFetchTrust: trustHealth,
      flareDefaultProxyConfigured: Boolean(DEFAULT_FLARE_PROXY_URL),
      flareSessionReuse: isFlareSessionReuseEnabled(),
      flareSessionId: getFlareSessionId() || null,
      playwrightProfileDir: getPlaywrightProfileDir(),
      flare: data,
    });
  } catch (e) {
    res.status(503).json({
      ok: false,
      sqlite: dbPath(),
      cache: cacheStats(),
      graph: getGraphDataStats(),
      vector,
      flareBase: FLARE_BASE_URL,
      protectedFetchEngine: PROTECTED_FETCH_ENGINE,
      protectedFetchCooldownMs: PROTECTED_FETCH_COOLDOWN_MS,
      protectedFetchTrust: trustHealth,
      flareDefaultProxyConfigured: Boolean(DEFAULT_FLARE_PROXY_URL),
      playwrightProfileDir: getPlaywrightProfileDir(),
      error: String(e?.message || e),
    });
  }
});

app.get("/api/trust-health", (_req, res) => {
  res.json({
    ok: true,
    protectedFetchEngine: PROTECTED_FETCH_ENGINE,
    protectedFetchCooldownMs: PROTECTED_FETCH_COOLDOWN_MS,
    flareDefaultProxyConfigured: Boolean(DEFAULT_FLARE_PROXY_URL),
    playwrightProfileDir: getPlaywrightProfileDir(),
    metrics: getProtectedFetchHealth(),
    recentEvents: listProtectedFetchEvents(25),
  });
});

app.get("/api/graph", (req, res) => {
  const center = req.query.center;
  const depth = Number(req.query.depth || 1);
  try {
    if (center && String(center)) {
      return res.json(getNeighborhood(String(center), Math.min(3, Math.max(1, depth || 1))));
    }
    res.json(getFullGraph());
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.get("/api/graph/stats", (_req, res) => {
  try {
    res.json({ ok: true, ...getGraphDataStats() });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.get("/api/source-audit", (_req, res) => {
  try {
    res.json({ ok: true, audit: getSourceAuditSnapshot(sourceSessionStateMap()) });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.get("/api/source-sessions", (_req, res) => {
  try {
    res.json({
      ok: true,
      sessions: listSourceSessions().map(({ sourceId, session }) => ({ sourceId, session })),
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.post("/api/source-sessions/:sourceId/open", async (req, res) => {
  const sourceId = String(req.params.sourceId || "").trim();
  const body = req.body && typeof req.body === "object" ? req.body : {};
  try {
    const targetUrl = sourceUrlForInteractiveSession(sourceId, body.url);
    const browserResult = await openInteractivePageWithPlaywright(targetUrl, {
      sourceId: sourceContextKey(sourceId),
      maxTimeout: 45000,
    });
    const evaluated = evaluateSourceSessionResult(sourceId, browserResult);
    propagateSourceSessionUpdate(sourceId, (memberSourceId) =>
      markSourceSessionOpened(memberSourceId, {
        status: evaluated.status,
        lastWarning: evaluated.lastWarning,
        lastWarningDetail: evaluated.lastWarningDetail,
      })
    );
    return res.json({
      ok: true,
      sourceId,
      targetUrl,
      browser: {
        finalUrl: browserResult.finalUrl,
        challengeDetected: browserResult.challengeDetected === true,
        challengeReason: browserResult.challengeReason || null,
      },
      session: getSourceSession(sourceId),
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.post("/api/source-sessions/:sourceId/check", async (req, res) => {
  const sourceId = String(req.params.sourceId || "").trim();
  const body = req.body && typeof req.body === "object" ? req.body : {};
  try {
    const source = getSourceDefinition(sourceId);
    const targetUrl = sourceUrlForInteractiveSession(sourceId, body.url);
    // For session-optional sources, check via the configured fetch engine (e.g. Flare) rather than
    // headless Playwright — headless Chromium is more likely to be fingerprinted and challenged even
    // when the site is perfectly reachable, producing misleading "challenge_required" status.
    // For session-required sources we still need Playwright to verify the browser session state.
    let browserResult;
    if (source.sessionMode !== "required" && PROTECTED_FETCH_ENGINE !== "playwright-local") {
      const pageResult = await getProtectedPage(targetUrl, { maxTimeout: 45000, sourceId });
      browserResult = {
        status: pageResult.status,
        finalUrl: pageResult.finalUrl || targetUrl,
        html: pageResult.html || "",
        challengeDetected: pageResult.challengeDetected === true,
        challengeReason: pageResult.challengeReason || null,
      };
    } else {
      browserResult = await fetchPageWithPlaywright(targetUrl, {
        sourceId: sourceContextKey(sourceId),
        maxTimeout: 45000,
      });
    }
    const evaluated = evaluateSourceSessionResult(sourceId, browserResult);
    propagateSourceSessionUpdate(sourceId, (memberSourceId) =>
      markSourceSessionChecked(memberSourceId, evaluated.status, {
        lastWarning: evaluated.lastWarning,
        lastWarningDetail: evaluated.lastWarningDetail,
      })
    );
    return res.json({
      ok: true,
      sourceId,
      checkedUrl: targetUrl,
      browser: {
        finalUrl: browserResult.finalUrl,
        challengeDetected: browserResult.challengeDetected === true,
        challengeReason: browserResult.challengeReason || null,
      },
      session: getSourceSession(sourceId),
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.post("/api/source-sessions/:sourceId/clear", async (req, res) => {
  const sourceId = String(req.params.sourceId || "").trim();
  try {
    await clearPlaywrightProfile(sourceContextKey(sourceId));
    propagateSourceSessionUpdate(sourceId, (memberSourceId) => resetSourceSession(memberSourceId));
    return res.json({
      ok: true,
      sourceId,
      profileDir: getPlaywrightProfileDir(sourceContextKey(sourceId)),
      session: getSourceSession(sourceId),
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.post("/api/source-sessions/:sourceId/pause", (req, res) => {
  const sourceId = String(req.params.sourceId || "").trim();
  const body = req.body && typeof req.body === "object" ? req.body : {};
  try {
    const paused = body.paused !== false;
    const sessions = propagateSourceSessionUpdate(sourceId, (memberSourceId) => setSourceSessionPaused(memberSourceId, paused));
    return res.json({ ok: true, sourceId, paused, sessions });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.get("/api/candidate-leads", (req, res) => {
  try {
    const leads = listCandidateLeads({
      reviewStatus: req.query.reviewStatus ? String(req.query.reviewStatus) : undefined,
      sourceId: req.query.sourceId ? String(req.query.sourceId) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    return res.json({ ok: true, leads });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.post("/api/candidate-leads", (req, res) => {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  try {
    const lead = upsertCandidateLead({
      sourceId: body.sourceId,
      url: body.url,
      label: body.label,
      accessMode: body.accessMode,
      confidence: body.confidence,
      evidence: body.evidence,
      context: body.context,
      reviewStatus: body.reviewStatus,
    });
    return res.json({ ok: true, lead });
  } catch (e) {
    return res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

app.post("/api/candidate-leads/:id/review", (req, res) => {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  try {
    const lead = reviewCandidateLead(req.params.id, body.reviewStatus || "pending", body.reviewNote || null);
    return res.json({ ok: true, lead });
  } catch (e) {
    return res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

app.get("/api/entity-search", (req, res) => {
  const q = String(req.query.q || "").trim();
  if (!q) {
    return res.status(400).json({ error: "q required" });
  }
  res.json({ rows: searchEntitiesByLabel(q, Number(req.query.limit || 30)) });
});

app.get("/api/entity/:id", (req, res) => {
  const row = getDb()
    .prepare("SELECT * FROM entities WHERE id = ?")
    .get(req.params.id);
  if (!row) {
    return res.status(404).json({ error: "not found" });
  }
  res.json(row);
});

/**
 * Internal helper: fetch, parse, enrich, and optionally ingest a USPhonebook profile page.
 * Returns a plain object (not an HTTP response).
 *
 * @param {string} path  USPhonebook pathname, e.g. "/john-doe/UXXXXX"
 * @param {{ engine?: string; maxTimeout?: number; waitInSeconds?: number; proxy?: {url:string}; disableMedia?: boolean; doIngest?: boolean; contextDashed?: string | null }} opts
 * @returns {Promise<object>}
 */
async function fetchProfileData(path, opts = {}) {
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  const url = `${USPHONEBOOK}${path.split("?")[0]}`;
  const maxTimeout = Number(opts.maxTimeout || DEFAULT_FLARE_MAX_TIMEOUT_MS);
  const waitInSeconds = opts.waitInSeconds != null ? opts.waitInSeconds : DEFAULT_FLARE_WAIT_AFTER_SECONDS;
  const trace = createScrapeTrace("usphonebook_profile", url, {
    profilePath: path,
    contextDashed: opts.contextDashed || null,
  });
  logScrape(trace, "profile fetch started", {
    requestedEngine: opts.engine || PROTECTED_FETCH_ENGINE,
    maxTimeout,
    waitInSeconds,
  });
  const fetchResult = await getProtectedPage(url, {
    engine: opts.engine,
    maxTimeout,
    waitInSeconds,
    proxy: opts.proxy,
    disableMedia: opts.disableMedia,
    sourceId: "usphonebook_profile",
    trace,
  });
  if (fetchResult.status === "challenge_required") {
    const err = new Error(`Challenge required (${fetchResult.challengeReason || fetchResult.engine})`);
    err.protectedFetchStatus = "challenge_required";
    err.protectedFetchEngine = fetchResult.engine;
    err.challengeReason = fetchResult.challengeReason || null;
    throw err;
  }
  if (fetchResult.status !== "ok" || !fetchResult.html) {
    const err = new Error(`${fetchResult.engine}: protected fetch did not return HTML`);
    err.protectedFetchEngine = fetchResult.engine;
    throw err;
  }
  const html = fetchResult.html;
  logScrape(trace, "profile HTML received; parsing/enriching", {
    engine: fetchResult.engine,
    htmlBytes: html.length,
    finalUrl: summarizeTargetUrl(fetchResult.finalUrl || url),
  });
  let profile = parseUsPhonebookProfileHtml(html);
  const fetchedPath = profilePathnameOnly(path);
  if (isUsPhonebookPersonProfilePath(fetchedPath)) {
    profile.profilePath = fetchedPath;
  } else if (!profile.profilePath) {
    profile.profilePath = fetchedPath || null;
  }
  profile = await enrichProfilePayload(profile, { fetchHtml: fetchHtmlForSource });

  // --- Per-phone telecom enrichment (carrier/rate-center) for all profile phones ---
  const profilePhones = Array.isArray(profile.phones) ? profile.phones : [];
  await Promise.all(
    profilePhones.map(async (p) => {
      if (!p.dashed) return;
      try {
        const t = await enrichTelecomNumberAsync(p.dashed);
        if (t) {
          // Attach full telecom data; backfill phoneMetadata only if not already set
          p.telecomData = t;
          if (!p.phoneMetadata && t.phoneMetadata) {
            p.phoneMetadata = t.phoneMetadata;
          }
        }
      } catch {
        // non-fatal — best-effort
      }
    })
  );
  logScrape(trace, "profile fetch completed", {
    engine: fetchResult.engine,
    elapsed: formatElapsedMs(Date.now() - trace.startedAt),
    phoneCount: profilePhones.length,
    profilePath: profile.profilePath || fetchedPath || null,
  });

  // --- TPS + ThatsThem cross-reference for current/context phones (capped at 3) ---
  const contextDashedPhone = opts.contextDashed || null;
  const phonesToCrossRef = profilePhones
    .filter((p) => p.dashed && (p.isCurrent || p.dashed === contextDashedPhone))
    .slice(0, 3);
  if (!phonesToCrossRef.length && contextDashedPhone) {
    phonesToCrossRef.push({
      kind: "phone",
      dashed: contextDashedPhone,
      display: contextDashedPhone,
      isCurrent: true,
      isContextFallback: true,
    });
    logScrape(trace, "profile cross-reference using fallback phone", {
      contextPhone: contextDashedPhone,
    });
  }
  const profileExternalSources = {};
  await Promise.all(
    phonesToCrossRef.map(async (p) => {
      if (!ENABLE_EXTERNAL_PEOPLE_SOURCES) {
        // Telecom data is already on p.telecomData; skip adding an empty external-sources entry
        // so profileExternalSources stays empty and the UI shows "not_run" for TPS/ThatsThem.
        return;
      }
      const telecom = p.telecomData || (p.dashed ? await enrichTelecomNumberAsync(p.dashed).catch(() => null) : null);
      try {
        const [tps, tt] = await Promise.all([
          fetchTruePeopleSearchSource(p.dashed),
          fetchThatsThemSource(p.dashed),
        ]);
        const pf = [tps, tt];
        profileExternalSources[p.dashed] = { peopleFinders: pf, mergedFacts: mergePeopleFinderFacts(pf), telecom };
      } catch {
        profileExternalSources[p.dashed] = { peopleFinders: [], mergedFacts: mergePeopleFinderFacts([]), telecom };
      }
    })
  );
  if (Object.keys(profileExternalSources).length) {
    profile.profileExternalSources = profileExternalSources;
  }

  const dashed = opts.contextDashed || null;
  const doIngest = opts.doIngest !== false;
  const graphIngestRaw = doIngest ? ingestProfileParsed(profile, dashed, null) : null;
  const graphIngest = graphIngestRaw
    ? {
        newFieldsByEntity: graphIngestRaw.newFieldsByEntity,
        personId: graphIngestRaw.personId,
        runId: graphIngestRaw.runId,
      }
    : null;
  const normalized = normalizeProfileLookupPayload({
    url,
    httpStatus: fetchResult.flare?.solution?.status || null,
    userAgent: fetchResult.flare?.solution?.userAgent || null,
    rawHtmlLength: html.length,
    profile,
    contextPhone: dashed,
  });
  return {
    url,
    httpStatus: fetchResult.flare?.solution?.status || null,
    userAgent: fetchResult.flare?.solution?.userAgent || null,
    rawHtmlLength: html.length,
    profile,
    contextPhone: dashed,
    normalized,
    graphIngest,
    fetchEngine: fetchResult.engine,
    rawHtml: html,
  };
}

app.post("/api/profile", async (req, res) => {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  let path = String(body.path || "").trim();
  if (!path) {
    return res.status(400).json({ error: "path required" });
  }
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  const maxTimeout = Number(
    body.maxTimeout != null ? body.maxTimeout : DEFAULT_FLARE_MAX_TIMEOUT_MS
  );
  const waitInSeconds =
    body.waitInSeconds != null && body.waitInSeconds !== ""
      ? body.waitInSeconds
      : DEFAULT_FLARE_WAIT_AFTER_SECONDS;
  const dashed = toDashed(body.contextPhone || body.phone || "");
  try {
    const result = await fetchProfileData(path, {
      engine: body.engine,
      maxTimeout,
      waitInSeconds,
      proxy: body.proxy?.url ? { url: String(body.proxy.url) } : undefined,
      disableMedia: body.disableMedia === true ? true : undefined,
      doIngest: wantIngest(body.ingest),
      contextDashed: dashed,
    });
    const wantRaw = body.includeRawHtml === true || body.debug === true;
    const RAW_CAP = 120_000;
    const rawHtml =
      wantRaw && result.rawHtml && result.rawHtml.length > RAW_CAP
        ? `${result.rawHtml.slice(0, RAW_CAP)}\n\n… [truncated: ${result.rawHtml.length} bytes total]`
        : wantRaw
          ? result.rawHtml
          : undefined;
    res.json({ ...result, rawHtml });
  } catch (e) {
    const status = e?.protectedFetchStatus === "challenge_required" ? 409 : 500;
    res.status(status).json({
      error: String(e?.message || e),
      engine: e?.protectedFetchEngine || null,
      challengeRequired: e?.protectedFetchStatus === "challenge_required",
      challengeReason: e?.challengeReason || null,
    });
  }
});

app.get("/api/name-search", async (req, res) => {
  const normalized = normalizeNameSearchRequest(req.query || {});
  if (!normalized.ok) {
    return res.status(400).json({ error: normalized.error });
  }
  const maxTimeout = Number(
    req.query.maxTimeout != null && req.query.maxTimeout !== ""
      ? req.query.maxTimeout
      : DEFAULT_FLARE_MAX_TIMEOUT_MS
  );
  const engine = req.query.engine != null ? String(req.query.engine) : undefined;
  const proxy = req.query.proxy ? { url: String(req.query.proxy) } : undefined;
  const qDm = req.query.disableMedia;
  let disableMedia;
  if (qDm == null || qDm === "") {
    disableMedia = undefined;
  } else {
    disableMedia = /^(1|true|yes)$/i.test(String(qDm));
  }
  const cacheBypass = isBypassQuery(req.query);
  if (!cacheBypass) {
    const hit = getNameSearchCache(normalized.cacheKey);
    if (hit) {
      return res.json({ ...hit, cached: true, cachedAt: new Date().toISOString() });
    }
  }
  const waitInSeconds = Number(
    req.query.wait != null && req.query.wait !== "" ? req.query.wait : DEFAULT_FLARE_WAIT_AFTER_SECONDS
  );
  const missKey = nameSearchMissDedupKey(normalized.cacheKey, {
    cacheBypass,
    maxTimeout,
    waitInSeconds,
    disableMedia,
    engine,
    proxyUrl: proxy?.url,
  });
  try {
    const payload = await dedupeInflight(missKey, () =>
      fetchNameSearchOnCacheMiss({
        ...normalized,
        url: `${USPHONEBOOK}${normalized.path}`,
        maxTimeout,
        waitInSeconds,
        proxy,
        disableMedia,
        engine,
        cacheBypass,
      })
    );
    return res.json(payload);
  } catch (e) {
    if (e instanceof HttpReplyError) {
      return res.status(e.status).json(e.body);
    }
    return res.status(500).json({ error: String(e?.message || e) });
  }
});

app.post("/api/name-search", async (req, res) => {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const normalized = normalizeNameSearchRequest(body);
  if (!normalized.ok) {
    return res.status(400).json({ error: normalized.error });
  }
  const maxTimeout = Number(body.maxTimeout != null ? body.maxTimeout : DEFAULT_FLARE_MAX_TIMEOUT_MS);
  const engine = body.engine != null ? String(body.engine) : undefined;
  const proxy = body.proxy?.url ? { url: String(body.proxy.url) } : undefined;
  const disableMedia = body.disableMedia === true ? true : undefined;
  const cacheBypass = isBypassQuery({ ...body, ...req.query });
  if (!cacheBypass) {
    const hit = getNameSearchCache(normalized.cacheKey);
    if (hit) {
      return res.json({ ...hit, cached: true, cachedAt: new Date().toISOString() });
    }
  }
  const waitInSeconds = Number(
    body.waitInSeconds != null && body.waitInSeconds !== ""
      ? body.waitInSeconds
      : DEFAULT_FLARE_WAIT_AFTER_SECONDS
  );
  const missKey = nameSearchMissDedupKey(normalized.cacheKey, {
    cacheBypass,
    maxTimeout,
    waitInSeconds,
    disableMedia,
    engine,
    proxyUrl: proxy?.url,
  });
  try {
    const payload = await dedupeInflight(missKey, () =>
      fetchNameSearchOnCacheMiss({
        ...normalized,
        url: `${USPHONEBOOK}${normalized.path}`,
        maxTimeout,
        waitInSeconds,
        proxy,
        disableMedia,
        engine,
        cacheBypass,
      })
    );
    return res.json(payload);
  } catch (e) {
    if (e instanceof HttpReplyError) {
      return res.status(e.status).json(e.body);
    }
    return res.status(500).json({ error: String(e?.message || e) });
  }
});

app.get("/api/phone-search", async (req, res) => {
  const phone = normalizePhone(req.query.phone);
  if (!/^\d{3}-\d{3}-\d{4}$/.test(phone) && !/^\d{10}$/.test(phone)) {
    return res.status(400).json({ error: "Invalid phone. Use 10 digits or 207-242-0526" });
  }
  const dashed =
    phone.length === 10
      ? `${phone.slice(0, 3)}-${phone.slice(3, 6)}-${phone.slice(6)}`
      : phone;
  const url = `${USPHONEBOOK}/phone-search/${dashed}`;
  const maxTimeout = Number(
    req.query.maxTimeout != null && req.query.maxTimeout !== ""
      ? req.query.maxTimeout
      : DEFAULT_FLARE_MAX_TIMEOUT_MS
  );
  const engine = req.query.engine != null ? String(req.query.engine) : undefined;
  const proxy = req.query.proxy
    ? { url: String(req.query.proxy) }
    : undefined;
  const qDm = req.query.disableMedia;
  let disableMedia;
  if (qDm == null || qDm === "") {
    disableMedia = undefined;
  } else {
    disableMedia = /^(1|true|yes)$/i.test(String(qDm));
  }

  const doIngest = wantIngest(req.query.ingest);
  const autoFollowProfile = /^(1|true|yes)$/i.test(String(req.query.autoFollowProfile || ""));
  const cacheBypass = isBypassQuery(req.query);
  if (!cacheBypass) {
    const hit = getPhoneCache(dashed);
    if (hit) {
      const j = await finalizePhoneSearchPayload(
        { ...hit, cached: true, cachedAt: new Date().toISOString() },
        dashed,
        doIngest,
        { autoFollowProfile, engine, maxTimeout }
      );
      return res.json(j);
    }
  }

  const waitInSeconds = Number(
    req.query.wait != null && req.query.wait !== "" ? req.query.wait : DEFAULT_FLARE_WAIT_AFTER_SECONDS
  );
  const missKey = phoneSearchMissDedupKey(dashed, {
    cacheBypass,
    doIngest,
    maxTimeout,
    waitInSeconds,
    disableMedia,
    engine,
    proxyUrl: proxy?.url,
  });
  try {
    const payload = await dedupeInflight(missKey, () =>
      fetchPhoneSearchOnCacheMiss({
        dashed,
        url,
        maxTimeout,
        waitInSeconds,
        proxy,
        disableMedia,
        engine,
        doIngest,
        cacheBypass,
      })
    );
    return res.json(await finalizePhoneSearchPayload(payload, dashed, doIngest, { autoFollowProfile, engine, maxTimeout }));
  } catch (e) {
    if (e instanceof HttpReplyError) {
      return res.status(e.status).json(e.body);
    }
    return res.status(500).json({ error: String(e?.message || e) });
  }
});

app.post("/api/phone-search", async (req, res) => {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const phone = normalizePhone(body.phone ?? req.query?.phone);
  if (!/^\d{3}-\d{3}-\d{4}$/.test(phone) && !/^\d{10}$/.test(phone)) {
    return res.status(400).json({ error: "Body.phone required: 10 digits or dashed format" });
  }
  const dashed =
    phone.length === 10
      ? `${phone.slice(0, 3)}-${phone.slice(3, 6)}-${phone.slice(6)}`
      : phone;
  const url = `${USPHONEBOOK}/phone-search/${dashed}`;
  const maxTimeout = Number(
    body.maxTimeout != null ? body.maxTimeout : DEFAULT_FLARE_MAX_TIMEOUT_MS
  );
  const engine = body.engine != null ? String(body.engine) : undefined;
  const doIngest = wantIngest(body.ingest);
  const autoFollowProfile = /^(1|true|yes)$/i.test(String(body.autoFollowProfile || ""));
  const cacheBypass = isBypassQuery({ ...body, ...req.query });
  if (!cacheBypass) {
    const hit = getPhoneCache(dashed);
    if (hit) {
      const j = await finalizePhoneSearchPayload(
        { ...hit, cached: true, cachedAt: new Date().toISOString() },
        dashed,
        doIngest,
        { autoFollowProfile, engine, maxTimeout }
      );
      return res.json(j);
    }
  }
  const proxy = body.proxy?.url ? { url: String(body.proxy.url) } : undefined;
  const postDisableMedia = body.disableMedia === true ? true : undefined;
  const waitN = Number(
    body.waitInSeconds != null && body.waitInSeconds !== ""
      ? body.waitInSeconds
      : DEFAULT_FLARE_WAIT_AFTER_SECONDS
  );
  const missKey = phoneSearchMissDedupKey(dashed, {
    cacheBypass,
    doIngest,
    maxTimeout,
    waitInSeconds: waitN,
    disableMedia: postDisableMedia,
    engine,
    proxyUrl: proxy?.url,
  });
  try {
    const payload = await dedupeInflight(missKey, () =>
      fetchPhoneSearchOnCacheMiss({
        dashed,
        url,
        maxTimeout,
        waitInSeconds: waitN,
        proxy,
        disableMedia: postDisableMedia,
        engine,
        doIngest,
        cacheBypass,
      })
    );
    return res.json(await finalizePhoneSearchPayload(payload, dashed, doIngest, { autoFollowProfile, engine, maxTimeout }));
  } catch (e) {
    if (e instanceof HttpReplyError) {
      return res.status(e.status).json(e.body);
    }
    return res.status(500).json({ error: String(e?.message || e) });
  }
});

const server = app.listen(PORT, "0.0.0.0", () => {
  const c = cacheStats();
  const cacheInfo = c.enabled
    ? `phone cache ${c.ttlMs}ms TTL, max ${c.maxEntries} entries`
    : "phone cache off (PHONE_CACHE_TTL_MS<=0)";
  const sessionInfo = isFlareSessionReuseEnabled()
    ? "Flare session reuse on"
    : "Flare session reuse off (per-request browser)";
  console.log(
    `[app] http://127.0.0.1:${PORT}  ${FLARE_BASE_URL}  |  ${sessionInfo}  |  ${cacheInfo}`
  );
});

const shutdown = () => {
  server.close(async () => {
    await Promise.allSettled([
      destroyFlareSessionOnExit(FLARE_BASE_URL),
      closePlaywrightContext(),
    ]);
    process.exit(0);
  });
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
