import "./env.mjs";
import { getDb, nowIso } from "./db/db.mjs";

const TTL_MS = Number(process.env.NAME_SEARCH_CACHE_TTL_MS || process.env.PHONE_CACHE_TTL_MS || 86_400_000);
const MAX_ENTRIES = Math.max(1, Number(process.env.NAME_SEARCH_CACHE_MAX || 250));
const PREFIX = "name-search:";

/**
 * @param {string} key
 * @returns {string}
 */
function cacheKey(key) {
  return `${PREFIX}${key}`;
}

function pruneExpired() {
  if (TTL_MS <= 0) {
    return;
  }
  getDb().prepare("DELETE FROM response_cache WHERE cache_key LIKE ? AND expires_at < ?").run(`${PREFIX}%`, Date.now());
}

/**
 * @param {string} key
 * @returns {object | null}
 */
export function getNameSearchCache(key) {
  if (TTL_MS <= 0) {
    return null;
  }
  pruneExpired();
  const row = getDb()
    .prepare("SELECT body_json, expires_at FROM response_cache WHERE cache_key = ?")
    .get(cacheKey(key));
  if (!row) {
    return null;
  }
  if (Date.now() > row.expires_at) {
    getDb().prepare("DELETE FROM response_cache WHERE cache_key = ?").run(cacheKey(key));
    return null;
  }
  try {
    return JSON.parse(row.body_json);
  } catch {
    return null;
  }
}

/**
 * @param {string} key
 * @param {object} body
 */
export function setNameSearchCache(key, body) {
  if (TTL_MS <= 0) {
    return;
  }
  const db = getDb();
  const count = db
    .prepare("SELECT COUNT(*) as c FROM response_cache WHERE cache_key LIKE ?")
    .get(`${PREFIX}%`).c;
  if (count >= MAX_ENTRIES) {
    const oldest = db
      .prepare("SELECT cache_key FROM response_cache WHERE cache_key LIKE ? ORDER BY created_at ASC LIMIT ?")
      .all(`${PREFIX}%`, Math.max(1, count - MAX_ENTRIES + 1));
    const del = db.prepare("DELETE FROM response_cache WHERE cache_key = ?");
    for (const row of oldest) {
      del.run(row.cache_key);
    }
  }
  db.prepare(
    `INSERT INTO response_cache (cache_key, body_json, expires_at, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(cache_key) DO UPDATE SET
       body_json = excluded.body_json,
       expires_at = excluded.expires_at,
       created_at = excluded.created_at`
  ).run(cacheKey(key), JSON.stringify(body), Date.now() + TTL_MS, nowIso());
}
