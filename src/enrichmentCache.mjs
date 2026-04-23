import "./env.mjs";
import { createHash } from "node:crypto";
import { getDb, nowIso } from "./db/db.mjs";
import { dedupeInflight } from "./inflightDedupe.mjs";

const DEFAULT_MAX_ENTRIES = Math.max(50, Number(process.env.ENRICHMENT_CACHE_MAX || 5000));

/**
 * @param {string} namespace
 * @param {string} rawKey
 * @returns {string}
 */
function cacheKey(namespace, rawKey) {
  return `${namespace}:${createHash("sha256").update(String(rawKey)).digest("hex")}`;
}

/**
 * @returns {void}
 */
function pruneExpired() {
  const now = Date.now();
  getDb().prepare("DELETE FROM enrichment_cache WHERE expires_at < ?").run(now);
}

/**
 * @returns {void}
 */
function enforceMaxEntries() {
  const db = getDb();
  const count = db.prepare("SELECT COUNT(*) AS c FROM enrichment_cache").get()?.c || 0;
  if (count < DEFAULT_MAX_ENTRIES) {
    return;
  }
  const oldest = db
    .prepare("SELECT cache_key FROM enrichment_cache ORDER BY created_at ASC LIMIT ?")
    .all(Math.max(1, count - DEFAULT_MAX_ENTRIES + 1));
  const del = db.prepare("DELETE FROM enrichment_cache WHERE cache_key = ?");
  for (const row of oldest) {
    del.run(row.cache_key);
  }
}

/**
 * @param {string} namespace
 * @param {string} rawKey
 * @returns {any | null}
 */
export function getEnrichmentCache(namespace, rawKey) {
  pruneExpired();
  const row = getDb()
    .prepare("SELECT body_json, expires_at FROM enrichment_cache WHERE cache_key = ?")
    .get(cacheKey(namespace, rawKey));
  if (!row) {
    return null;
  }
  if (Date.now() > row.expires_at) {
    getDb()
      .prepare("DELETE FROM enrichment_cache WHERE cache_key = ?")
      .run(cacheKey(namespace, rawKey));
    return null;
  }
  try {
    return JSON.parse(row.body_json);
  } catch {
    return null;
  }
}

/**
 * @param {string} namespace
 * @param {string} rawKey
 * @param {any} body
 * @param {number} ttlMs
 * @returns {void}
 */
export function setEnrichmentCache(namespace, rawKey, body, ttlMs) {
  const expiresAt = Date.now() + Math.max(1, Number(ttlMs) || 1);
  enforceMaxEntries();
  getDb()
    .prepare(
      `INSERT INTO enrichment_cache (cache_key, body_json, expires_at, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(cache_key) DO UPDATE SET
         body_json = excluded.body_json,
         expires_at = excluded.expires_at,
         created_at = excluded.created_at`
    )
    .run(cacheKey(namespace, rawKey), JSON.stringify(body), expiresAt, nowIso());
}

/**
 * @param {string} namespace
 * @param {string} rawKey
 * @param {number} ttlMs
 * @param {() => Promise<any>} producer
 * @returns {Promise<any>}
 */
export async function withEnrichmentCache(namespace, rawKey, ttlMs, producer) {
  const cached = getEnrichmentCache(namespace, rawKey);
  if (cached != null) {
    return cached;
  }
  const key = cacheKey(namespace, rawKey);
  return dedupeInflight(`enrichment:${key}`, async () => {
    const cachedAgain = getEnrichmentCache(namespace, rawKey);
    if (cachedAgain != null) {
      return cachedAgain;
    }
    const value = await producer();
    if (value != null) {
      setEnrichmentCache(namespace, rawKey, value, ttlMs);
    }
    return value;
  });
}
