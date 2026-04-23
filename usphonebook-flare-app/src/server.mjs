import { config } from "dotenv";
import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
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
import { getDb, dbPath, deleteDatabaseFileAndReopen } from "./db/db.mjs";
import { rebuildGraphFromQueueItems } from "./graphRebuild.mjs";
import {
  getFullGraph,
  getNeighborhood,
  getUnifiedRelativesForPhoneDashed,
  searchEntitiesByLabel,
} from "./graphQuery.mjs";
import { parseUsPhonebookProfileHtml } from "./parseUsPhonebookProfile.mjs";
import { isUsPhonebookPersonProfilePath, profilePathnameOnly } from "./personKey.mjs";
import { getVectorStatus } from "./vectorStore.mjs";
import { dedupeInflight } from "./inflightDedupe.mjs";
import {
  getGraphDataStats,
  runGraphStartupMaintenance,
  wipeAllPersistedGraphAndCache,
} from "./graphMaintenance.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
// DOTENV_PATH=/path/.env if cwd is not the app root
config({ path: process.env.DOTENV_PATH || resolve(__dirname, "..", ".env") });
getDb();
runGraphStartupMaintenance();

const publicDir = join(__dirname, "..", "public");
const app = express();
const PORT = Number(process.env.APP_PORT || 3040);
const USPHONEBOOK = "https://www.usphonebook.com";
const FLARE_BASE_URL = (process.env.FLARE_BASE_URL || "http://127.0.0.1:8191").replace(/\/$/, "");
const DEFAULT_FLARE_MAX_TIMEOUT_MS = Number(
  process.env.FLARE_MAX_TIMEOUT_MS || 240000
);
const DEFAULT_FLARE_WAIT_AFTER_SECONDS = Number(
  process.env.FLARE_WAIT_AFTER_SECONDS || 0
);

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
  if (proxy) {
    payload.proxy = proxy;
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
 * @param {{ cacheBypass: boolean; doIngest: boolean; maxTimeout: number; waitInSeconds: number; disableMedia: boolean | undefined; proxyUrl: string | undefined; }} p
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
    doIngest,
    cacheBypass,
  } = ctx;
  const flareRes = await flareGetPhonePage(url, {
    maxTimeout,
    waitInSeconds,
    proxy,
    disableMedia,
  });
  if (flareRes.status !== "ok" || !flareRes.solution?.response) {
    throw new HttpReplyError(502, {
      error: flareRes.message || "FlareSolverr did not return HTML",
      flare: flareRes,
    });
  }
  const html = flareRes.solution.response;
  const status = flareRes.solution.status;
  const parsed = parseUsPhonebookHtml(html);
  const payload = {
    url,
    httpStatus: status,
    userAgent: flareRes.solution.userAgent,
    parsed,
    rawHtmlLength: html.length,
  };
  if (!cacheBypass) {
    setPhoneCache(dashed, payload);
  }
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
 * @param {unknown} v
 * @returns {boolean}
 */
function wantIngest(v) {
  if (v === "0" || v === 0 || v === false || v === "false" || v === "no") {
    return false;
  }
  return true;
}

app.post("/api/graph/rebuild", (req, res) => {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const items = body.items;
  if (!Array.isArray(items)) {
    return res.status(400).json({ ok: false, error: "body.items: array required" });
  }
  if (items.length > 2000) {
    return res.status(400).json({ ok: false, error: "body.items: too many entries" });
  }
  try {
    const { itemResults } = rebuildGraphFromQueueItems(items);
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
  try {
    const data = await flareV1({ cmd: "sessions.list" }, { baseUrl: FLARE_BASE_URL });
    res.json({
      ok: true,
      sqlite: dbPath(),
      cache: cacheStats(),
      graph: getGraphDataStats(),
      vector,
      flareBase: FLARE_BASE_URL,
      flareSessionReuse: isFlareSessionReuseEnabled(),
      flareSessionId: getFlareSessionId() || null,
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
      error: String(e?.message || e),
    });
  }
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
  const url = `${USPHONEBOOK}${path.split("?")[0]}`;
  const dashed = toDashed(body.contextPhone || body.phone || "");
  try {
    const flareRes = await flareGetPhonePage(url, {
      maxTimeout,
      waitInSeconds,
      proxy: body.proxy?.url ? { url: String(body.proxy.url) } : undefined,
      disableMedia: body.disableMedia === true ? true : undefined,
    });
    if (flareRes.status !== "ok" || !flareRes.solution?.response) {
      return res.status(502).json({
        error: flareRes.message || "FlareSolverr did not return HTML",
        flare: flareRes,
      });
    }
    const html = String(flareRes.solution.response);
    const profile = parseUsPhonebookProfileHtml(html);
    const fetchedPath = profilePathnameOnly(path);
    if (isUsPhonebookPersonProfilePath(fetchedPath)) {
      profile.profilePath = fetchedPath;
    } else if (!profile.profilePath) {
      profile.profilePath = fetchedPath || null;
    }
    const graphIngest = null;
    const wantRaw = body.includeRawHtml === true || body.debug === true;
    const RAW_CAP = 120_000;
    const rawHtml =
      wantRaw && html.length > RAW_CAP
        ? `${html.slice(0, RAW_CAP)}\n\n… [truncated: ${html.length} bytes total]`
        : wantRaw
          ? html
          : undefined;
    res.json({
      url,
      httpStatus: flareRes.solution.status,
      userAgent: flareRes.solution.userAgent,
      rawHtmlLength: html.length,
      profile,
      contextPhone: dashed,
      graphIngest,
      rawHtml,
    });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
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
  const cacheBypass = isBypassQuery(req.query);
  if (!cacheBypass) {
    const hit = getPhoneCache(dashed);
    if (hit) {
      const j = { ...hit, cached: true, cachedAt: new Date().toISOString() };
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
        doIngest,
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
  const doIngest = wantIngest(body.ingest);
  const cacheBypass = isBypassQuery({ ...body, ...req.query });
  if (!cacheBypass) {
    const hit = getPhoneCache(dashed);
    if (hit) {
      const j = { ...hit, cached: true, cachedAt: new Date().toISOString() };
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
        doIngest,
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
    try {
      await destroyFlareSessionOnExit(FLARE_BASE_URL);
    } catch {
      // ignore
    }
    process.exit(0);
  });
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
