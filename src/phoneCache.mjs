import "./env.mjs";
import { getDb, nowIso } from "./db/db.mjs";

const TTL_MS = Number(process.env.PHONE_CACHE_TTL_MS || 86_400_000);
const MAX_ENTRIES = Math.max(1, Number(process.env.PHONE_CACHE_MAX || 500));
const BYPASS = new Set(
  (process.env.PHONE_CACHE_BYPASS || "bypass,nocache,skipCache")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
);

export function isBypassQuery(q) {
  if (!q || typeof q !== "object") {
    return false;
  }
  for (const [k, v] of Object.entries(q)) {
    if (!BYPASS.has(k)) {
      continue;
    }
    if (v === true || v === 1) {
      return true;
    }
    if (typeof v === "string" && v !== "" && v !== "0" && v.toLowerCase() !== "false") {
      return true;
    }
  }
  return false;
}

function pruneExpired() {
  if (TTL_MS <= 0) {
    return;
  }
  const db = getDb();
  const now = Date.now();
  db.prepare("DELETE FROM response_cache WHERE expires_at < ?").run(now);
}

/**
 * @param {string} dashed
 * @returns {object | null}
 */
export function getPhoneCache(dashed) {
  if (TTL_MS <= 0) {
    return null;
  }
  pruneExpired();
  const row = getDb()
    .prepare("SELECT body_json, expires_at FROM response_cache WHERE cache_key = ?")
    .get(dashed);
  if (!row) {
    return null;
  }
  if (Date.now() > row.expires_at) {
    getDb()
      .prepare("DELETE FROM response_cache WHERE cache_key = ?")
      .run(dashed);
    return null;
  }
  try {
    return JSON.parse(row.body_json);
  } catch {
    return null;
  }
}

/**
 * @param {string} dashed
 * @param {object} body
 */
export function setPhoneCache(dashed, body) {
  if (TTL_MS <= 0) {
    return;
  }
  const db = getDb();
  const count = db.prepare("SELECT COUNT(*) as c FROM response_cache").get().c;
  if (count >= MAX_ENTRIES) {
    const oldest = db
      .prepare(
        "SELECT cache_key FROM response_cache ORDER BY created_at ASC LIMIT ?"
      )
      .all(Math.max(1, count - MAX_ENTRIES + 1));
    const del = db.prepare("DELETE FROM response_cache WHERE cache_key = ?");
    for (const r of oldest) {
      del.run(r.cache_key);
    }
  }
  const expiresAt = Date.now() + TTL_MS;
  const s = nowIso();
  db.prepare(
    `INSERT INTO response_cache (cache_key, body_json, expires_at, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(cache_key) DO UPDATE SET
       body_json = excluded.body_json,
       expires_at = excluded.expires_at,
       created_at = excluded.created_at`
  ).run(dashed, JSON.stringify(body), expiresAt, s);
}

export function cacheStats() {
  const c = getDb()
    .prepare("SELECT COUNT(*) as c FROM response_cache")
    .get();
  return {
    enabled: TTL_MS > 0,
    size: c?.c ?? 0,
    ttlMs: TTL_MS,
    maxEntries: MAX_ENTRIES,
    backend: "sqlite",
  };
}

/**
 * @param {number} limit
 * @returns {Array<{ phone: string; body: object; createdAt: string; expiresAt: number }>}
 */
/**
 * @param {string} dashed
 * @returns {boolean} true if a row was removed
 */
export function deletePhoneCache(dashed) {
  if (TTL_MS <= 0) {
    return false;
  }
  pruneExpired();
  const r = getDb()
    .prepare("DELETE FROM response_cache WHERE cache_key = ?")
    .run(dashed);
  return r.changes > 0;
}

export function listRecentCacheRows(limit) {
  pruneExpired();
  const n = Math.min(200, Math.max(1, Number(limit) || 30));
  const rows = getDb()
    .prepare(
      "SELECT cache_key, body_json, created_at, expires_at FROM response_cache ORDER BY created_at DESC LIMIT ?"
    )
    .all(n);
  return rows
    .map((r) => {
      let body;
      try {
        body = JSON.parse(r.body_json);
      } catch {
        body = null;
      }
      if (!body) {
        return null;
      }
      return {
        phone: r.cache_key,
        body: { ...body, cached: true, cachedAt: r.created_at },
        createdAt: r.created_at,
        expiresAt: r.expires_at,
      };
    })
    .filter(Boolean);
}

export function listAllCacheRows() {
  pruneExpired();
  const rows = getDb()
    .prepare("SELECT cache_key, body_json FROM response_cache")
    .all();
  return rows
    .map((r) => {
      try {
        return { phone: r.cache_key, body: JSON.parse(r.body_json) };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}
