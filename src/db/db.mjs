import { mkdirSync, existsSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolve, join } from "node:path";
import Database from "better-sqlite3";

const __dirname = dirname(fileURLToPath(import.meta.url));

let _db = null;

/**
 * @returns {string}
 */
function resolveSqliteAbsolutePath() {
  const fromEnv = process.env.SQLITE_PATH;
  const defaultPath = join(__dirname, "..", "..", "data", "osint.sqlite");
  return fromEnv ? resolve(fromEnv) : resolve(defaultPath);
}

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  label TEXT,
  data_json TEXT NOT NULL DEFAULT '{}',
  data_hash TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_entities_dedupe ON entities(dedupe_key);
CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);
CREATE INDEX IF NOT EXISTS idx_entities_label ON entities(label);

CREATE TABLE IF NOT EXISTS edges (
  id TEXT PRIMARY KEY,
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  meta_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (from_id) REFERENCES entities(id) ON DELETE CASCADE,
  FOREIGN KEY (to_id) REFERENCES entities(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_edges_from ON edges(from_id);
CREATE INDEX IF NOT EXISTS idx_edges_to ON edges(to_id);
CREATE INDEX IF NOT EXISTS idx_edges_kind ON edges(kind);

CREATE TABLE IF NOT EXISTS response_cache (
  cache_key TEXT PRIMARY KEY,
  body_json TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_response_cache_expires ON response_cache(expires_at);

CREATE TABLE IF NOT EXISTS merge_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_id TEXT NOT NULL,
  data_json TEXT NOT NULL,
  source_run_id TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_merge_snapshots_entity ON merge_snapshots(entity_id, created_at);
`;

/**
 * @returns {import("better-sqlite3").Database}
 */
export function getDb() {
  if (_db) {
    return _db;
  }
  const abs = resolveSqliteAbsolutePath();
  const dir = dirname(abs);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  _db = new Database(abs);
  _db.exec(SCHEMA);
  return _db;
}

export function dbPath() {
  const d = getDb();
  return d.name;
}

/**
 * @returns {void}
 */
export function closeDatabase() {
  if (_db) {
    try {
      _db.close();
    } catch {
      // ignore
    }
    _db = null;
  }
}

/**
 * Delete the main SQLite file and WAL sidecars, then open a new empty database (schema re-run).
 * @returns {import("better-sqlite3").Database}
 */
export function deleteDatabaseFileAndReopen() {
  const abs = resolveSqliteAbsolutePath();
  closeDatabase();
  for (const suffix of ["-wal", "-shm", ""]) {
    const p = suffix ? abs + suffix : abs;
    if (existsSync(p)) {
      try {
        unlinkSync(p);
      } catch {
        // ignore; file may be busy on some systems
      }
    }
  }
  return getDb();
}

/**
 * @param {string} s
 * @returns {string}
 */
export function nowIso() {
  return new Date().toISOString();
}
