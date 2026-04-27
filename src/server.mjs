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
  listAllCacheRows,
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
import { isUsPhonebookPersonProfilePath, profilePathnameOnly, personKeyFromNameOnly } from "./personKey.mjs";
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
import { parseThatsThemPhoneHtml, parseThatsThemNameHtml, buildThatsThemPhoneCandidateUrls, buildThatsThemNameUrl } from "./thatsThem.mjs";
// FastPeopleSearch removed — hard rate-limited; see osint-sources/16-fastpeoplesearch.md to re-enable
import { enrichTelecomNumber, enrichTelecomNumberAsync } from "./telecomEnrichment.mjs";
import { parseTruePeopleSearchPhoneHtml, parseTruePeopleSearchNameHtml, parseTruePeopleSearchProfileHtml, buildTruePeopleSearchPhoneUrl, buildTruePeopleSearchNameUrl } from "./truePeopleSearch.mjs";
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
import { listCandidateLeads, reviewCandidateLead, upsertCandidateLead, getCandidateLeadById } from "./candidateLeads.mjs";
import {
  annotateSourceResult,
  getThatsThemCandidatePattern,
  isSourceTrustFailure,
  loadThatsThemPatternStats,
  persistThatsThemPatternStats,
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
const TRUEPEOPLESEARCH = "https://www.truepeoplesearch.com";
// const FASTPEOPLESEARCH = "https://www.fastpeoplesearch.com"; // removed — see osint-sources/16-fastpeoplesearch.md
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
const thatsThemCandidatePatternStats = loadThatsThemPatternStats();

function stateSlugToAbbrev(slug) {
  for (const [abbrev, s] of US_STATES.entries()) {
    if (s === slug) return abbrev;
  }
  return null;
}

function stateSlugToDisplayName(slug) {
  for (const s of US_STATES.values()) {
    if (s === slug) {
      return s
        .split("-")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
    }
  }
  return null;
}

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

function shouldUseHeadedPlaywrightForSource(sourceId, explicitHeaded = false) {
  if (explicitHeaded === true) {
    return true;
  }
  const key = String(sourceId || "").trim();
  if (!key) {
    return false;
  }
  try {
    return getSourceDefinition(key).sessionMode === "required";
  } catch {
    return false;
  }
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
  if (source.sessionMode !== "required") {
    return false;
  }
  const urlStr = String(url || "").toLowerCase();
  // URL redirected to a login/auth page
  if (/\/(login|sign-in|signin|auth\/login)(\?|$|\/)/.test(urlStr)) {
    return true;
  }
  const htmlStr = String(html || "");
  // Full-page login wall: password input present alongside login-gating text
  if (/type=["']password["']/i.test(htmlStr) && /log\s*in|sign\s*in/i.test(htmlStr)) {
    return true;
  }
  // Explicit login-required messaging (not just a nav link)
  if (/you (must|need to) (log|sign) in|login required|please (log|sign) in|authentication required/i.test(htmlStr)) {
    return true;
  }
  return false;
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

/**
 * @param {string} sourceId
 * @param {string | null} [overrideUrl]
 * @returns {Promise<{ session: object; interactionUsed: boolean }>} 
 */
async function ensureSourceSessionReadyForExplicitFetch(sourceId, overrideUrl = null) {
  const source = getSourceDefinition(sourceId);
  if (source.sessionMode !== "required") {
    return { session: getSourceSession(sourceId), interactionUsed: false };
  }
  const current = getSourceSession(sourceId);
  if (current?.effectiveStatus === "ready") {
    return { session: current, interactionUsed: false };
  }
  const targetUrl = sourceUrlForInteractiveSession(sourceId, overrideUrl);
  const browserResult = await fetchPageWithPlaywright(targetUrl, {
    sourceId: sourceContextKey(sourceId),
    maxTimeout: 45_000,
  });
  const escalated = {
    browserResult,
    evaluated: evaluateSourceSessionResult(sourceId, browserResult),
    interactionUsed: false,
  };
  propagateSourceSessionUpdate(sourceId, (memberSourceId) =>
    markSourceSessionChecked(memberSourceId, escalated.evaluated.status, {
      lastWarning: escalated.evaluated.lastWarning,
      lastWarningDetail: escalated.evaluated.lastWarningDetail,
    })
  );
  return {
    session: getSourceSession(sourceId),
    interactionUsed: escalated.interactionUsed === true,
  };
}

/**
 * @param {string} sourceId
 * @param {{ name: string; nameSlug: string; city: string; citySlug: string | null; stateSlug: string | null }} normalized
 * @returns {Promise<object>}
 */
async function fetchSingleExternalNameSource(sourceId, normalized) {
  const key = String(sourceId || "").trim().toLowerCase();
  if (key === "truepeoplesearch") {
    return fetchTruePeopleSearchNameSearch(
      normalized.name,
      normalized.nameSlug,
      normalized.city,
      normalized.citySlug,
      normalized.stateSlug
    );
  }
  throw new Error(`Unsupported name-search source retry: ${sourceId}`);
}

/**
 * @param {string} sourceId
 * @param {string} targetUrl
 * @param {object} browserResult
 * @returns {Promise<{ browserResult: object; evaluated: { status: string; lastWarning: string | null; lastWarningDetail: string | null }; interactionUsed: boolean }>}
 */
async function maybeEscalateSourceSessionCheck(sourceId, targetUrl, browserResult) {
  const source = getSourceDefinition(sourceId);
  let evaluated = evaluateSourceSessionResult(sourceId, browserResult);
  let interactionUsed = false;
  if (source.sessionMode !== "required" || evaluated.status === "ready") {
    return { browserResult, evaluated, interactionUsed };
  }
  const interactiveResult = await openInteractivePageWithPlaywright(targetUrl, {
    sourceId: sourceContextKey(sourceId),
    maxTimeout: 75_000,
  });
  interactionUsed = true;
  evaluated = evaluateSourceSessionResult(sourceId, interactiveResult);
  return {
    browserResult: interactiveResult,
    evaluated,
    interactionUsed,
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
  if (/checking your browser|just a moment\.\.\.|attention required/i.test(m)) {
    return "cloudflare_challenge";
  }
  if (/ray id[:\s]+[0-9a-f]{16}/i.test(m)) {
    return "cloudflare_challenge";
  }
  if (/captcha|recaptcha|hcaptcha|quick humanity check|verify you are human/i.test(m)) {
    return "captcha_challenge";
  }
  if (/datadome|dd-content|ddcaptcha|dd_cookie|blockid["\s]*:/i.test(m)) {
    return "datadome_challenge";
  }
  if (/imperva|incapsula|_incap_session/i.test(m)) {
    return "imperva_challenge";
  }
  if (/\baccess denied\b/i.test(m) && m.length < 4000) {
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
      // Add random jitter (0–100% of base cooldown) so successive requests don't
      // arrive at a metronomic interval that bot detectors can fingerprint.
      const jitter = Math.floor(Math.random() * PROTECTED_FETCH_COOLDOWN_MS);
      await delay(PROTECTED_FETCH_COOLDOWN_MS + jitter);
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
  const headedPlaywright =
    engine === "playwright-local"
      ? shouldUseHeadedPlaywrightForSource(options.sourceId, options.headed === true)
      : null;
  const stopHeartbeat = startScrapeHeartbeat(trace, `${engine} fetch`, {
    engine,
    headed: headedPlaywright,
    timeoutMs: Number(options.maxTimeout || 0) || null,
  });
  logScrape(trace, `${engine} fetch started`, {
    engine,
    headed: headedPlaywright,
    timeoutMs: Number(options.maxTimeout || 0) || null,
    disableMedia: options.disableMedia === true,
    target: summarizeTargetUrl(targetUrl),
  });
  try {
    if (engine === "playwright-local") {
      const pw = await fetchPageWithPlaywright(targetUrl, {
        maxTimeout: options.maxTimeout,
        headed: headedPlaywright === true,
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
        headed: headedPlaywright,
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
      headed: headedPlaywright,
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
  const session = getSourceSession("thatsthem");
  if (session?.effectiveStatus !== "ready") {
    return {
      source: "thatsthem",
      status: "session_required",
      failureKind: "source_trust",
      searchUrl: buildThatsThemPhoneCandidateUrls(dashed)[0],
      people: [],
      note: session?.paused
        ? "That's Them source is paused in Settings. Resume the source and re-check the session before retrying."
        : "Open That's Them in Settings, complete the humanity check, then click Check session before retrying.",
    };
  }
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
          engine: "playwright-local",
          sourceId: "thatsthem",
          trace,
        });
        const parsed = annotateSourceResult(parseThatsThemPhoneHtml(html, finalUrl || searchUrl), {
          engine: engine || "playwright-local",
          finalUrl: finalUrl || searchUrl,
          candidatePattern,
        });
        recordThatsThemCandidateOutcome(thatsThemCandidatePatternStats, searchUrl, parsed);
        try { persistThatsThemPatternStats(thatsThemCandidatePatternStats); } catch { /* non-fatal */ }
        recordSourceTrustFailure(searchUrl, engine || "playwright-local", "thatsthem", parsed, {
          maxTimeout: EXTERNAL_SOURCE_TIMEOUT_MS,
          sourceId: "thatsthem",
        });
        logSourceParseOutcome(trace, "thatsthem", parsed, {
          engine: parsed.engine || "playwright-local",
          finalUrl: summarizeTargetUrl(parsed.finalUrl || searchUrl),
          candidatePattern,
        });
        if (parsed.status === "ok" || parsed.status === "no_match") {
          markSourceSessionChecked("thatsthem", "ready", {
            lastWarning: null,
            lastWarningDetail: null,
          });
        } else if (parsed.status === "blocked") {
          markSourceSessionChecked("thatsthem", "challenge_required", {
            lastWarning: parsed.reason || parsed.note || "blocked",
            lastWarningDetail: finalUrl || searchUrl,
          });
        }
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
        try { persistThatsThemPatternStats(thatsThemCandidatePatternStats); } catch { /* non-fatal */ }
        if (e?.challengeReason || /challenge|captcha|humanity|attention required/i.test(String(e?.message || e))) {
          markSourceSessionChecked("thatsthem", "challenge_required", {
            lastWarning: e?.challengeReason || String(e?.message || e),
            lastWarningDetail: searchUrl,
          });
        }
        logScrape(trace, "source parse error", {
          sourceId: "thatsthem",
          candidatePattern,
          engine: e?.fetchEngine || e?.protectedFetchEngine || e?.requestedEngine || null,
          reason: String(e?.message || e),
        });
      }
    }
    if (lastBlockedResult) {
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
  }, (value) => value?.status === "ok" || value?.status === "no_match");
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
  ]);
  return {
    peopleFinders,
    mergedFacts: mergePeopleFinderFacts(peopleFinders),
    telecom,
  };
}

/**
 * @param {string} name
 * @param {string} nameSlug
 * @param {string} city
 * @param {string | null} citySlug
 * @param {string | null} stateSlug
 * @returns {Promise<object>}
 */
async function fetchTruePeopleSearchNameSearch(name, nameSlug, city, citySlug, stateSlug) {
  const stateAbbrev = stateSlugToAbbrev(stateSlug);
  const stateDisplayName = stateSlugToDisplayName(stateSlug);
  const searchUrl = buildTruePeopleSearchNameUrl(name, city, city ? stateAbbrev : (stateDisplayName || stateAbbrev));
  const session = getSourceSession("truepeoplesearch");
  if (session?.effectiveStatus !== "ready") {
    return { source: "truepeoplesearch", status: "session_required", searchUrl, people: [], searchType: "name" };
  }
  const cacheKey = `name:${nameSlug}:${stateSlug || ""}:${citySlug || ""}`;
  return withEnrichmentCache("source:truepeoplesearch:name", cacheKey, EXTERNAL_SOURCE_CACHE_TTL_MS, async () => {
    const trace = createScrapeTrace("truepeoplesearch", searchUrl, { sourceId: "truepeoplesearch", target: summarizeTargetUrl(searchUrl) });
    try {
      const { html, finalUrl, engine } = await fetchHtmlForSource(searchUrl, {
        maxTimeout: EXTERNAL_SOURCE_TIMEOUT_MS, disableMedia: true, useFlare: true,
        engine: "playwright-local", sourceId: "truepeoplesearch", trace,
      });
      const result = annotateSourceResult(parseTruePeopleSearchNameHtml(html, finalUrl || searchUrl), { engine: engine || null, finalUrl: finalUrl || searchUrl });
      if (result.status === "ok" || result.status === "no_match") {
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
      logSourceParseOutcome(trace, "truepeoplesearch", result, { engine: result.engine || null, finalUrl: summarizeTargetUrl(result.finalUrl || searchUrl) });
      return result;
    } catch (e) {
      if (e?.challengeReason || /challenge|captcha|cloudflare|attention required/i.test(String(e?.message || e))) {
        markSourceSessionChecked("truepeoplesearch", "challenge_required", {
          lastWarning: e?.challengeReason || String(e?.message || e),
          lastWarningDetail: searchUrl,
        });
      }
      return { source: "truepeoplesearch", status: "error", searchUrl, people: [], searchType: "name", note: String(e?.message || e) };
    }
  }, (v) => v?.status === "ok" || v?.status === "no_match");
}

/**
 * @param {string} nameSlug
 * @param {string} city
 * @param {string | null} citySlug
 * @param {string | null} stateSlug
 * @returns {Promise<object>}
 */
async function fetchThatsThemNameSearch(nameSlug, city, citySlug, stateSlug) {
  const stateAbbrev = stateSlugToAbbrev(stateSlug);
  const searchUrl = buildThatsThemNameUrl(nameSlug, city, stateAbbrev);
  const session = getSourceSession("thatsthem");
  if (session?.effectiveStatus !== "ready") {
    return { source: "thatsthem", status: "session_required", searchUrl, people: [], searchType: "name" };
  }
  const cacheKey = `name:${nameSlug}:${stateSlug || ""}:${citySlug || ""}`;
  return withEnrichmentCache("source:thatsthem:name", cacheKey, EXTERNAL_SOURCE_CACHE_TTL_MS, async () => {
    const trace = createScrapeTrace("thatsthem", searchUrl, { sourceId: "thatsthem", target: summarizeTargetUrl(searchUrl) });
    try {
      const { html, finalUrl, engine } = await fetchHtmlForSource(searchUrl, {
        maxTimeout: EXTERNAL_SOURCE_TIMEOUT_MS, disableMedia: true, useFlare: true,
        engine: "playwright-local", sourceId: "thatsthem", trace,
      });
      const result = annotateSourceResult(parseThatsThemNameHtml(html, finalUrl || searchUrl), { engine: engine || null, finalUrl: finalUrl || searchUrl });
      if (result.status === "ok" || result.status === "no_match") {
        markSourceSessionChecked("thatsthem", "ready", {
          lastWarning: null,
          lastWarningDetail: null,
        });
      } else if (result.status === "blocked") {
        markSourceSessionChecked("thatsthem", "challenge_required", {
          lastWarning: result.reason || result.note || "blocked",
          lastWarningDetail: finalUrl || searchUrl,
        });
      }
      recordSourceTrustFailure(searchUrl, engine, "thatsthem", result, {
        maxTimeout: EXTERNAL_SOURCE_TIMEOUT_MS,
        sourceId: "thatsthem",
      });
      logSourceParseOutcome(trace, "thatsthem", result, { engine: result.engine || null, finalUrl: summarizeTargetUrl(result.finalUrl || searchUrl) });
      return result;
    } catch (e) {
      if (e?.challengeReason || /challenge|captcha|humanity|attention required/i.test(String(e?.message || e))) {
        markSourceSessionChecked("thatsthem", "challenge_required", {
          lastWarning: e?.challengeReason || String(e?.message || e),
          lastWarningDetail: searchUrl,
        });
      }
      return { source: "thatsthem", status: "error", searchUrl, people: [], searchType: "name", note: String(e?.message || e) };
    }
  }, (v) => v?.status === "ok" || v?.status === "no_match");
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
  if (fetchResult.status === "challenge_required" || fetchResult.challengeDetected) {
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
  const parsed = parseUsPhonebookNameSearchHtml(html);
  if (parsed.likelyChallenged) {
    throw new HttpReplyError(502, {
      error: `Name search: suspected challenge page (no USPhonebook page structure detected)`,
      engine: fetchResult.engine,
      challengeRequired: true,
      challengeReason: "page_structure_missing",
      url: fetchResult.finalUrl || ctx.url,
    });
  }
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
    parsed,
  };
  payload.normalized = normalizeNameSearchPayload(payload);

  // Fan out to external people-finder sources in parallel (non-blocking for cache storage)
  if (ENABLE_EXTERNAL_PEOPLE_SOURCES) {
    const tps = await fetchTruePeopleSearchNameSearch(ctx.name, ctx.nameSlug, ctx.city, ctx.citySlug, ctx.stateSlug);
    payload.externalNameSources = [tps];
  }

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

/**
 * @param {string[] | undefined} values
 * @returns {string[]}
 */
function mergeUniqueStrings(values) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )
  );
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizedProfileMergePath(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  if (/^https?:\/\//i.test(text)) {
    try {
      return new URL(text).pathname.replace(/\/+$/, "");
    } catch {
      return text.replace(/\/+$/, "");
    }
  }
  return text.replace(/\/+$/, "");
}

/**
 * @param {Record<string, any> | undefined | null} profile
 * @returns {Record<string, { profilePath: string | null; sourceUrl: string | null; displayName: string | null }>}
 */
function buildMergedSourceProfiles(profile) {
  const existing = profile && typeof profile.mergedSourceProfiles === "object" && profile.mergedSourceProfiles
    ? { ...profile.mergedSourceProfiles }
    : {};
  const sourceId = String(profile?.sourceId || "").trim();
  if (sourceId) {
    existing[sourceId] = {
      profilePath: profile?.profilePath || null,
      sourceUrl: profile?.sourceUrl || null,
      displayName: profile?.displayName || null,
    };
  }
  return existing;
}

/**
 * @param {Array<any> | undefined} primary
 * @param {Array<any> | undefined} secondary
 * @returns {Array<any>}
 */
function mergeProfilePhones(primary, secondary) {
  const byKey = new Map();
  for (const phone of [...(Array.isArray(secondary) ? secondary : []), ...(Array.isArray(primary) ? primary : [])]) {
    const key = String(phone?.dashed || phone?.display || "").trim();
    if (!key) {
      continue;
    }
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, { ...phone });
      continue;
    }
    byKey.set(key, {
      ...prev,
      ...phone,
      isCurrent: Boolean(prev.isCurrent || phone.isCurrent),
      phoneMetadata: phone.phoneMetadata || prev.phoneMetadata || null,
      telecomData: phone.telecomData || prev.telecomData || null,
    });
  }
  return Array.from(byKey.values());
}

/**
 * @param {Array<any> | undefined} primary
 * @param {Array<any> | undefined} secondary
 * @returns {Array<any>}
 */
function mergeProfileAddresses(primary, secondary) {
  const byKey = new Map();
  for (const address of [...(Array.isArray(secondary) ? secondary : []), ...(Array.isArray(primary) ? primary : [])]) {
    const key = [
      String(address?.formattedFull || address?.label || "").trim().toLowerCase(),
      normalizedProfileMergePath(address?.path),
    ].join("|");
    if (!key.replace(/\|/g, "")) {
      continue;
    }
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, { ...address });
      continue;
    }
    byKey.set(key, {
      ...prev,
      ...address,
      isCurrent: Boolean(prev.isCurrent || address.isCurrent),
      periods: Array.from(
        new Map(
          [...(Array.isArray(prev.periods) ? prev.periods : []), ...(Array.isArray(address.periods) ? address.periods : [])]
            .map((period) => {
              const periodKey = [
                String(period?.label || "").trim(),
                String(period?.path || "").trim(),
                String(period?.timeRange || "").trim(),
              ].join("|");
              return [periodKey, period];
            })
        ).values()
      ),
      censusGeocode: address.censusGeocode || prev.censusGeocode || null,
      nearbyPlaces: address.nearbyPlaces || prev.nearbyPlaces || null,
      assessorRecords: Array.isArray(address.assessorRecords) && address.assessorRecords.length
        ? address.assessorRecords
        : prev.assessorRecords || [],
    });
  }
  return Array.from(byKey.values());
}

/**
 * @param {Array<any> | undefined} primary
 * @param {Array<any> | undefined} secondary
 * @returns {Array<any>}
 */
function mergeProfileLinks(primary, secondary) {
  const byKey = new Map();
  for (const item of [...(Array.isArray(secondary) ? secondary : []), ...(Array.isArray(primary) ? primary : [])]) {
    const name = String(item?.name || item?.displayName || item?.text || "").trim();
    const path = normalizedProfileMergePath(item?.path);
    const key = `${name.toLowerCase()}|${path}`;
    if (!key.replace(/\|/g, "")) {
      continue;
    }
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, { ...item });
      continue;
    }
    byKey.set(key, {
      ...prev,
      ...item,
      name: String(item?.name || "").trim().length >= String(prev?.name || "").trim().length ? item.name : prev.name,
      path: item?.path || prev?.path || null,
      alternateProfilePaths: mergeUniqueStrings([
        ...(Array.isArray(prev?.alternateProfilePaths) ? prev.alternateProfilePaths : []),
        ...(Array.isArray(item?.alternateProfilePaths) ? item.alternateProfilePaths : []),
      ]),
      sourceId: item?.sourceId || prev?.sourceId || null,
    });
  }
  return Array.from(byKey.values()).map((item) => {
    if (!Array.isArray(item.alternateProfilePaths) || !item.alternateProfilePaths.length) {
      const { alternateProfilePaths, ...rest } = item;
      return rest;
    }
    return item;
  });
}

/**
 * @param {Array<any> | undefined} primary
 * @param {Array<any> | undefined} secondary
 * @returns {Array<any>}
 */
function mergeProfileGenericObjects(primary, secondary) {
  return Array.from(
    new Map(
      [...(Array.isArray(secondary) ? secondary : []), ...(Array.isArray(primary) ? primary : [])].map((item) => [JSON.stringify(item || null), item])
    ).values()
  );
}

/**
 * @param {Record<string, any>} primary
 * @param {Record<string, any> | null | undefined} secondary
 * @returns {Record<string, any>}
 */
function mergeProfilePayloads(primary, secondary) {
  if (!secondary || typeof secondary !== "object") {
    return primary;
  }
  const mergedSourceProfiles = {
    ...buildMergedSourceProfiles(secondary),
    ...buildMergedSourceProfiles(primary),
  };
  return {
    ...secondary,
    ...primary,
    displayName: primary.displayName || secondary.displayName || null,
    age: primary.age ?? secondary.age ?? null,
    profilePath: primary.profilePath || secondary.profilePath || null,
    sourceId: primary.sourceId || secondary.sourceId || null,
    sourceUrl: primary.sourceUrl || secondary.sourceUrl || null,
    mergedSourceIds: mergeUniqueStrings([
      secondary.sourceId,
      ...(Array.isArray(secondary.mergedSourceIds) ? secondary.mergedSourceIds : []),
      primary.sourceId,
      ...(Array.isArray(primary.mergedSourceIds) ? primary.mergedSourceIds : []),
    ]),
    mergedSourceProfiles,
    aliases: mergeUniqueStrings([...(Array.isArray(secondary.aliases) ? secondary.aliases : []), ...(Array.isArray(primary.aliases) ? primary.aliases : [])]),
    emails: mergeUniqueStrings([...(Array.isArray(secondary.emails) ? secondary.emails : []), ...(Array.isArray(primary.emails) ? primary.emails : [])]),
    addresses: mergeProfileAddresses(primary.addresses, secondary.addresses),
    phones: mergeProfilePhones(primary.phones, secondary.phones),
    relatives: mergeProfileLinks(primary.relatives, secondary.relatives),
    associates: mergeProfileLinks(primary.associates, secondary.associates),
    workplaces: mergeProfileGenericObjects(primary.workplaces, secondary.workplaces),
    education: mergeProfileGenericObjects(primary.education, secondary.education),
    marital: mergeProfileLinks(primary.marital, secondary.marital),
    profileExternalSources: {
      ...(secondary.profileExternalSources && typeof secondary.profileExternalSources === "object" ? secondary.profileExternalSources : {}),
      ...(primary.profileExternalSources && typeof primary.profileExternalSources === "object" ? primary.profileExternalSources : {}),
    },
  };
}

/**
 * Pick the best-matching USPhonebook candidate profile path for a known display name + state.
 * @param {Array<{ displayName: string; currentCityState: string | null; profilePath: string | null }>} candidates
 * @param {string} displayName
 * @param {string | null} stateSlug
 * @returns {string | null}
 */
function pickBestUsPhonebookCandidatePath(candidates, displayName, stateSlug) {
  if (!Array.isArray(candidates) || !candidates.length) {
    return null;
  }
  const targetKey = personKeyFromNameOnly(displayName);
  const targetState = stateSlug ? stateSlug.toLowerCase() : null;

  // Name + state match
  for (const c of candidates) {
    if (!c.profilePath) {
      continue;
    }
    const cKey = personKeyFromNameOnly(c.displayName || "");
    if (cKey !== targetKey) {
      continue;
    }
    if (targetState && c.currentCityState) {
      if (c.currentCityState.toLowerCase().includes(targetState)) {
        return c.profilePath;
      }
    } else if (!targetState) {
      return c.profilePath;
    }
  }

  // Name match only (no state filter)
  for (const c of candidates) {
    if (!c.profilePath) {
      continue;
    }
    const cKey = personKeyFromNameOnly(c.displayName || "");
    if (cKey === targetKey) {
      return c.profilePath;
    }
  }

  // Single candidate fallback
  if (candidates.length === 1 && candidates[0].profilePath) {
    return candidates[0].profilePath;
  }

  return null;
}

/**
 * Attempt a cache-first USPhonebook name search and return the best-matching profile,
 * used to enrich multi-source (TPS/FPS) merges that have no phone context.
 * @param {object} mergedProfile
 * @param {{ maxTimeout: number; waitInSeconds: number; proxy?: {url:string}; disableMedia?: boolean }} opts
 * @returns {Promise<object | null>}
 */
async function tryFetchUsPhonebookNameCompanion(mergedProfile, opts) {
  const displayName = String(mergedProfile?.displayName || "").trim();
  if (!displayName) {
    return null;
  }
  const nameSlug = slugifySearchSegment(displayName);
  if (!nameSlug || !nameSlug.includes("-")) {
    return null;
  }

  // Extract state abbreviation from a current address label (e.g. "Corinna, ME 04928" → "me")
  const addresses = Array.isArray(mergedProfile?.addresses) ? mergedProfile.addresses : [];
  let stateSlug = null;
  for (const addr of addresses) {
    if (!addr.isCurrent) {
      continue;
    }
    const label = String(addr.formattedFull || addr.label || "").trim();
    const stateMatch = label.match(/,\s*([A-Z]{2})\s*(?:\d{5})?(?:\s*[-–]\s*\d{4})?$/i);
    if (stateMatch) {
      const candidate = normalizeStateSlug(stateMatch[1]);
      if (candidate) {
        stateSlug = candidate;
        break;
      }
    }
  }

  const segments = [nameSlug];
  if (stateSlug) {
    segments.push(stateSlug);
  }
  const cacheKey = segments.join("|");

  // Cache-first: if the name search was already run, reuse the result
  let nameSearchResult = getNameSearchCache(cacheKey);

  if (!nameSearchResult) {
    // Fresh USPhonebook-only name search (no TPS/FPS fan-out)
    try {
      const uspUrl = `${USPHONEBOOK}/${segments.join("/")}`;
      const fetchResult = await getProtectedPage(uspUrl, {
        engine: PROTECTED_FETCH_ENGINE,
        maxTimeout: opts.maxTimeout,
        waitInSeconds: opts.waitInSeconds,
        proxy: opts.proxy,
        disableMedia: opts.disableMedia,
        sourceId: "usphonebook_name_search",
      });
      if (fetchResult.status === "ok" && !fetchResult.challengeDetected && fetchResult.html) {
        const parsed = parseUsPhonebookNameSearchHtml(fetchResult.html);
        if (!parsed.likelyChallenged) {
          nameSearchResult = {
            url: fetchResult.finalUrl || uspUrl,
            parsed,
            rawHtmlLength: fetchResult.html.length,
            search: { name: displayName, city: "", state: stateSlug, path: `/${segments.join("/")}` },
          };
          setNameSearchCache(cacheKey, nameSearchResult);
        }
      }
    } catch {
      return null;
    }
  }

  const candidates = nameSearchResult?.parsed?.candidates || [];
  const profilePath = pickBestUsPhonebookCandidatePath(candidates, displayName, stateSlug);
  if (!profilePath || !isUsPhonebookPersonProfilePath(profilePath)) {
    return null;
  }

  try {
    return await fetchProfileData(profilePath, {
      sourceId: "usphonebook_profile",
      engine: PROTECTED_FETCH_ENGINE,
      maxTimeout: opts.maxTimeout,
      waitInSeconds: opts.waitInSeconds,
      proxy: opts.proxy,
      disableMedia: opts.disableMedia,
      doIngest: false,
      mergeUsPhonebookCompanion: false,
    });
  } catch {
    return null;
  }
}

/**
 * @param {string | null | undefined} contextDashed
 * @param {{ maxTimeout: number; waitInSeconds: number; proxy?: {url:string}; disableMedia?: boolean }} opts
 * @returns {Promise<object | null>}
 */
async function fetchUsPhonebookCompanionProfile(contextDashed, opts) {
  const dashed = String(contextDashed || "").trim();
  if (!dashed) {
    return null;
  }
  let phonePayload = getPhoneCache(dashed);
  if (!phonePayload?.parsed?.profilePath) {
    try {
      phonePayload = await fetchPhoneSearchOnCacheMiss({
        dashed,
        url: `${USPHONEBOOK}/phone-search/${dashed}`,
        maxTimeout: opts.maxTimeout,
        waitInSeconds: opts.waitInSeconds,
        proxy: opts.proxy,
        disableMedia: opts.disableMedia,
        doIngest: false,
        cacheBypass: false,
        engine: PROTECTED_FETCH_ENGINE,
      });
    } catch {
      return null;
    }
  }
  const profilePath = phonePayload?.parsed?.profilePath || null;
  if (!profilePath || !isUsPhonebookPersonProfilePath(profilePath)) {
    return null;
  }
  try {
    return await fetchProfileData(profilePath, {
      sourceId: "usphonebook_profile",
      engine: PROTECTED_FETCH_ENGINE,
      maxTimeout: opts.maxTimeout,
      waitInSeconds: opts.waitInSeconds,
      proxy: opts.proxy,
      disableMedia: opts.disableMedia,
      doIngest: false,
      contextDashed: dashed,
      mergeUsPhonebookCompanion: false,
    });
  } catch {
    return null;
  }
}

/**
 * @param {string | null | undefined} dashed
 * @param {{ maxTimeout: number; waitInSeconds: number; proxy?: {url:string}; disableMedia?: boolean }} opts
 * @returns {Promise<object | null>}
 */
async function fetchKnownPhoneRecordSummary(dashed, opts) {
  const normalizedDashed = String(dashed || "").trim();
  if (!normalizedDashed) {
    return null;
  }
  let payload = getPhoneCache(normalizedDashed);
  if (!payload?.parsed) {
    try {
      payload = await fetchPhoneSearchOnCacheMiss({
        dashed: normalizedDashed,
        url: `${USPHONEBOOK}/phone-search/${normalizedDashed}`,
        maxTimeout: opts.maxTimeout,
        waitInSeconds: opts.waitInSeconds,
        proxy: opts.proxy,
        disableMedia: opts.disableMedia,
        doIngest: false,
        cacheBypass: false,
        engine: PROTECTED_FETCH_ENGINE,
      });
    } catch {
      return null;
    }
  }
  const parsed = enrichPhoneSearchParsedResult(payload?.parsed || {}, normalizedDashed);
  const owner = parsed?.currentOwner && typeof parsed.currentOwner === "object" ? parsed.currentOwner : null;
  const ownerName = String(
    owner?.displayName || [owner?.givenName, owner?.familyName].filter(Boolean).join(" ") || ""
  ).trim();
  const relatives = Array.isArray(parsed?.relatives)
    ? parsed.relatives
        .map((relative) => String(relative?.name || "").trim())
        .filter(Boolean)
    : [];
  const profilePath = parsed?.profilePath || null;
  if (!ownerName && !profilePath && !relatives.length) {
    return null;
  }
  return {
    sourceId: "usphonebook_phone_search",
    displayName: ownerName || null,
    profilePath,
    relativeCount: relatives.length,
    relatives: relatives.slice(0, 6),
    sourceUrl: payload?.url || `${USPHONEBOOK}/phone-search/${normalizedDashed}`,
  };
}

function normalizeProfileRequestEntries(entries, fallbackPath, fallbackSourceId) {
  const seen = new Set();
  const list = [];
  const rawEntries = Array.isArray(entries) && entries.length
    ? entries
    : fallbackPath
      ? [{ path: fallbackPath, sourceId: fallbackSourceId || "usphonebook_profile" }]
      : [];
  for (const entry of rawEntries) {
    const rawPath = String(entry?.path || "").trim();
    if (!rawPath) {
      continue;
    }
    const path = rawPath.startsWith("/") ? rawPath.split("?")[0] : `/${rawPath.split("?")[0]}`;
    const sourceId = String(entry?.sourceId || fallbackSourceId || "usphonebook_profile").trim() || "usphonebook_profile";
    const key = `${sourceId}|${path}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    list.push({ path, sourceId, name: String(entry?.name || "").trim() || null });
  }
  list.sort((a, b) => {
    const order = (sourceId) => sourceId === "usphonebook_profile" ? 0 : sourceId === "truepeoplesearch" ? 1 : sourceId === "fastpeoplesearch" ? 2 : 9;
    const bySource = order(a.sourceId) - order(b.sourceId);
    if (bySource !== 0) {
      return bySource;
    }
    return String(a.path).localeCompare(String(b.path));
  });
  return list;
}

async function fetchMergedProfileData(entries, opts = {}) {
  const requestEntries = normalizeProfileRequestEntries(entries, opts.path, opts.sourceId);
  if (!requestEntries.length) {
    throw new Error("path required");
  }
  const hasExplicitUsPhonebook = requestEntries.some((entry) => entry.sourceId === "usphonebook_profile");
  const successful = [];
  const issues = [];

  for (const entry of requestEntries) {
    try {
      const result = await fetchProfileData(entry.path, {
        ...opts,
        path: entry.path,
        sourceId: entry.sourceId,
        doIngest: false,
        mergeUsPhonebookCompanion: hasExplicitUsPhonebook ? false : opts.mergeUsPhonebookCompanion,
      });
      successful.push(result);
    } catch (error) {
      issues.push({
        path: entry.path,
        sourceId: entry.sourceId,
        error: String(error?.message || error),
        challengeRequired: error?.protectedFetchStatus === "challenge_required",
        sessionRequired: Boolean(error?.sessionRequired),
        challengeReason: error?.challengeReason || null,
      });
    }
  }

  if (!successful.length) {
    const first = issues[0];
    const err = new Error(first?.error || "Profile enrich failed for all requested sources.");
    if (first?.challengeRequired) {
      err.protectedFetchStatus = "challenge_required";
      err.challengeReason = first.challengeReason || null;
    }
    if (first?.sessionRequired) {
      err.sessionRequired = true;
    }
    throw err;
  }

  let merged = successful[0];
  for (const result of successful.slice(1)) {
    merged = {
      ...merged,
      httpStatus: merged.httpStatus || result.httpStatus || null,
      userAgent: merged.userAgent || result.userAgent || null,
      rawHtmlLength: Number(merged.rawHtmlLength || 0) + Number(result.rawHtmlLength || 0),
      profile: mergeProfilePayloads(merged.profile, result.profile),
      fetchEngine: merged.fetchEngine === result.fetchEngine ? merged.fetchEngine : "multi-source",
      sourceId: merged.sourceId || result.sourceId,
      rawHtml: merged.rawHtml || result.rawHtml,
    };
  }

  // If no USPhonebook profile was explicitly in the request (TPS/FPS-only enrich from name search),
  // try a cache-first name lookup to find and merge a USPhonebook companion profile.
  if (!hasExplicitUsPhonebook) {
    try {
      const uspCompanion = await tryFetchUsPhonebookNameCompanion(merged.profile, {
        maxTimeout: opts.maxTimeout,
        waitInSeconds: opts.waitInSeconds,
        proxy: opts.proxy,
        disableMedia: opts.disableMedia,
      });
      if (uspCompanion?.profile) {
        merged = {
          ...merged,
          rawHtmlLength: Number(merged.rawHtmlLength || 0) + Number(uspCompanion.rawHtmlLength || 0),
          profile: mergeProfilePayloads(merged.profile, uspCompanion.profile),
          fetchEngine: merged.fetchEngine === uspCompanion.fetchEngine ? merged.fetchEngine : "multi-source",
        };
      }
    } catch {
      // Non-fatal: USPhonebook companion is best-effort
    }
  }

  const dashed = opts.contextDashed || null;
  const doIngest = opts.doIngest !== false;
  const graphIngestRaw = doIngest ? ingestProfileParsed(merged.profile, dashed, null) : null;
  const graphIngest = graphIngestRaw
    ? {
        newFieldsByEntity: graphIngestRaw.newFieldsByEntity,
        personId: graphIngestRaw.personId,
        runId: graphIngestRaw.runId,
      }
    : null;
  const normalized = normalizeProfileLookupPayload({
    url: merged.url,
    httpStatus: merged.httpStatus || null,
    userAgent: merged.userAgent || null,
    rawHtmlLength: merged.rawHtmlLength,
    profile: merged.profile,
    contextPhone: dashed,
  });
  return {
    ...merged,
    contextPhone: dashed,
    normalized,
    graphIngest,
    sourceId: merged.profile?.sourceId || merged.sourceId,
    requestedEntries: requestEntries,
    sourceIssues: issues,
  };
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

app.post("/api/graph/rebuild-from-cache", async (_req, res) => {
  try {
    const rows = listAllCacheRows();
    const items = [];
    for (const { phone, body } of rows) {
      if (body?.normalized?.meta?.graphEligible === true) {
        items.push({ normalized: body.normalized, runId: phone });
      }
    }
    const { itemResults } = await rebuildGraphFromQueueItems(items);
    res.json({ ok: true, phonesRestored: items.length, itemResults });
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
    const escalated = body.autoOpenOnFailure === true
      ? await maybeEscalateSourceSessionCheck(sourceId, targetUrl, browserResult)
      : {
          browserResult,
          evaluated: evaluateSourceSessionResult(sourceId, browserResult),
          interactionUsed: false,
        };
    browserResult = escalated.browserResult;
    const evaluated = escalated.evaluated;
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
      interactionUsed: escalated.interactionUsed === true,
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

app.post("/api/candidate-leads/:id/promote", async (req, res) => {
  const lead = getCandidateLeadById(req.params.id);
  if (!lead) {
    return res.status(404).json({ ok: false, error: "lead not found" });
  }
  let path;
  try {
    path = new URL(lead.url).pathname;
  } catch {
    return res.status(400).json({ ok: false, error: "invalid lead URL" });
  }
  if (!isUsPhonebookPersonProfilePath(path)) {
    return res.status(400).json({ ok: false, error: "promote only supports USPhonebook profile URLs" });
  }
  reviewCandidateLead(lead.id, "confirmed", null);
  try {
    const result = await fetchProfileData(path, { doIngest: true });
    return res.json({ ok: true, confirmed: true, graphIngest: result.graphIngest || null });
  } catch (e) {
    return res.status(500).json({ ok: false, confirmed: true, error: String(e?.message || e) });
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
 * @param {{ engine?: string; maxTimeout?: number; waitInSeconds?: number; proxy?: {url:string}; disableMedia?: boolean; doIngest?: boolean; contextDashed?: string | null; sourceId?: string | null }} opts
 * @returns {Promise<object>}
 */
async function fetchProfileData(path, opts = {}) {
  const requestedSourceId = String(opts.sourceId || "usphonebook_profile").trim() || "usphonebook_profile";
  const profileSourceId = requestedSourceId === "usphonebook_phone_search" || requestedSourceId === "usphonebook_name_search"
    ? "usphonebook_profile"
    : requestedSourceId;
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  const cleanPath = path.split("?")[0];
  const sourceBaseUrl = profileSourceId === "fastpeoplesearch"
    ? FASTPEOPLESEARCH
    : profileSourceId === "truepeoplesearch"
      ? TRUEPEOPLESEARCH
      : USPHONEBOOK;
  const url = `${sourceBaseUrl}${cleanPath}`;
  const maxTimeout = Number(opts.maxTimeout || DEFAULT_FLARE_MAX_TIMEOUT_MS);
  const waitInSeconds = opts.waitInSeconds != null ? opts.waitInSeconds : DEFAULT_FLARE_WAIT_AFTER_SECONDS;
  const fetchSourceId = profileSourceId;
  const fetchEngine = opts.engine || (profileSourceId === "usphonebook_profile" ? PROTECTED_FETCH_ENGINE : "playwright-local");
  const sourceDef = getSourceDefinition(profileSourceId);
  if (sourceDef.sessionMode === "required") {
    const session = getSourceSession(profileSourceId);
    if (session?.effectiveStatus !== "ready") {
      const err = new Error(
        session?.paused
          ? `${sourceDef.name} source is paused in Settings. Resume the source and re-check the session before retrying.`
          : `Open ${sourceDef.name} in Settings, complete any challenge, then click Check session before retrying.`
      );
      err.sessionRequired = true;
      err.protectedFetchEngine = fetchEngine;
      throw err;
    }
  }
  const trace = createScrapeTrace("usphonebook_profile", url, {
    profilePath: path,
    sourceId: profileSourceId,
    contextDashed: opts.contextDashed || null,
  });
  logScrape(trace, "profile fetch started", {
    requestedEngine: fetchEngine,
    maxTimeout,
    waitInSeconds,
  });
  const fetchResult = await getProtectedPage(url, {
    engine: fetchEngine,
    maxTimeout,
    waitInSeconds,
    proxy: opts.proxy,
    disableMedia: opts.disableMedia,
    sourceId: fetchSourceId,
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
  let profile;
  if (profileSourceId === "truepeoplesearch") {
    profile = parseTruePeopleSearchProfileHtml(html, fetchResult.finalUrl || url);
  } else if (profileSourceId === "usphonebook_profile") {
    profile = parseUsPhonebookProfileHtml(html);
  } else {
    throw new Error(`Profile enrich is not implemented for source: ${profileSourceId}`);
  }
  profile.sourceId = profileSourceId;
  profile.sourceUrl = fetchResult.finalUrl || url;
  const fetchedPath = profilePathnameOnly(path);
  if (profileSourceId === "usphonebook_profile" && isUsPhonebookPersonProfilePath(fetchedPath)) {
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
    sourceId: profileSourceId,
    phoneCount: profilePhones.length,
    profilePath: profile.profilePath || fetchedPath || null,
  });

  // --- TPS + FPS cross-reference for current/context phones (capped at 3) ---
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
        // so profileExternalSources stays empty and the UI shows "not_run" for TPS/FPS.
        return;
      }
      const telecom = p.telecomData || (p.dashed ? await enrichTelecomNumberAsync(p.dashed).catch(() => null) : null);
      const knownPhoneRecord = p.dashed
        ? await fetchKnownPhoneRecordSummary(p.dashed, {
            maxTimeout,
            waitInSeconds,
            proxy: opts.proxy,
            disableMedia: opts.disableMedia,
          }).catch(() => null)
        : null;
      try {
        const tps = await fetchTruePeopleSearchSource(p.dashed);
        const pf = [tps];
        profileExternalSources[p.dashed] = {
          peopleFinders: pf,
          mergedFacts: mergePeopleFinderFacts(pf),
          telecom,
          knownPhoneRecord,
        };
      } catch {
        profileExternalSources[p.dashed] = {
          peopleFinders: [],
          mergedFacts: mergePeopleFinderFacts([]),
          telecom,
          knownPhoneRecord,
        };
      }
    })
  );
  if (Object.keys(profileExternalSources).length) {
    profile.profileExternalSources = profileExternalSources;
  }

  if (profileSourceId !== "usphonebook_profile" && opts.mergeUsPhonebookCompanion !== false && contextDashedPhone) {
    const companion = await fetchUsPhonebookCompanionProfile(contextDashedPhone, {
      maxTimeout,
      waitInSeconds,
      proxy: opts.proxy,
      disableMedia: opts.disableMedia,
    });
    if (companion?.profile) {
      profile = mergeProfilePayloads(profile, companion.profile);
      logScrape(trace, "profile companion merged", {
        sourceId: profileSourceId,
        companionSourceId: "usphonebook_profile",
        mergedSourceIds: profile.mergedSourceIds || [],
      });
    }
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
    sourceId: profileSourceId,
    rawHtml: html,
  };
}

app.post("/api/profile", async (req, res) => {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  let path = String(body.path || "").trim();
  const requestEntries = normalizeProfileRequestEntries(body.entries, path, body.sourceId);
  if (!path && !requestEntries.length) {
    return res.status(400).json({ error: "path required" });
  }
  if (path && !path.startsWith("/")) {
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
  const sourceId = String(body.sourceId || "usphonebook_profile").trim() || "usphonebook_profile";
  try {
    const requestOpts = {
      sourceId,
      engine: body.engine,
      maxTimeout,
      waitInSeconds,
      proxy: body.proxy?.url ? { url: String(body.proxy.url) } : undefined,
      disableMedia: body.disableMedia === true ? true : undefined,
      doIngest: wantIngest(body.ingest),
      contextDashed: dashed,
    };
    const result = requestEntries.length > 1
      ? await fetchMergedProfileData(requestEntries, { ...requestOpts, path })
      : await fetchProfileData(path || requestEntries[0].path, requestOpts);
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
    const status = e?.protectedFetchStatus === "challenge_required" || e?.sessionRequired ? 409 : 500;
    res.status(status).json({
      error: String(e?.message || e),
      engine: e?.protectedFetchEngine || null,
      challengeRequired: e?.protectedFetchStatus === "challenge_required",
      sessionRequired: Boolean(e?.sessionRequired),
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

app.post("/api/name-search/source", async (req, res) => {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const sourceId = String(body.sourceId || "").trim().toLowerCase();
  const normalized = normalizeNameSearchRequest(body);
  if (!normalized.ok) {
    return res.status(400).json({ ok: false, error: normalized.error });
  }
  if (sourceId !== "truepeoplesearch" && sourceId !== "fastpeoplesearch") {
    return res.status(400).json({ ok: false, error: "Unsupported sourceId for source retry" });
  }
  try {
    const sessionPrep = await ensureSourceSessionReadyForExplicitFetch(sourceId);
    const result = await fetchSingleExternalNameSource(sourceId, normalized);
    const hit = getNameSearchCache(normalized.cacheKey);
    if (hit) {
      const nextExternalSources = Array.isArray(hit.externalNameSources)
        ? hit.externalNameSources.filter((entry) => String(entry?.source || "").trim().toLowerCase() !== sourceId)
        : [];
      nextExternalSources.push(result);
      nextExternalSources.sort((a, b) => String(a?.source || "").localeCompare(String(b?.source || "")));
      setNameSearchCache(normalized.cacheKey, {
        ...hit,
        externalNameSources: nextExternalSources,
      });
    }
    return res.json({
      ok: true,
      sourceId,
      sourceResult: result,
      interactionUsed: sessionPrep.interactionUsed === true,
      session: getSourceSession(sourceId),
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      sourceId,
      error: String(e?.message || e),
      challengeRequired: e?.protectedFetchStatus === "challenge_required",
      sessionRequired: Boolean(e?.sessionRequired),
      challengeReason: e?.challengeReason || null,
    });
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
