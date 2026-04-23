import { createHash } from "node:crypto";
import { getDb, nowIso } from "./db/db.mjs";
import { mergePersonRecord } from "./entityIngest.mjs";
import { normalizePersonNameForDedupe, personKeyFromNameOnly } from "./personKey.mjs";
import { indexEntityText } from "./vectorStore.mjs";

const TRUTHY = /^(1|true|yes|on)$/i;

function envOn(name) {
  return TRUTHY.test(String(process.env[name] || "").trim());
}

/**
 * @returns {{ entities: number; edges: number; mergeSnapshots: number; responseCacheRows: number }}
 */
export function getGraphDataStats() {
  const db = getDb();
  return {
    entities: db.prepare("SELECT COUNT(*) as c FROM entities").get().c,
    edges: db.prepare("SELECT COUNT(*) as c FROM edges").get().c,
    mergeSnapshots: db.prepare("SELECT COUNT(*) as c FROM merge_snapshots").get().c,
    responseCacheRows: db.prepare("SELECT COUNT(*) as c FROM response_cache").get().c,
  };
}

/**
 * Removes all graph rows (merge history, edges, entities). Does not touch response_cache.
 * @returns {void}
 */
export function clearAllGraphRows() {
  const db = getDb();
  db.transaction(() => {
    db.prepare("DELETE FROM merge_snapshots").run();
    db.prepare("DELETE FROM edges").run();
    db.prepare("DELETE FROM entities").run();
  })();
}

/**
 * Clears all graph tables and the phone HTML cache (same DB). Does not delete the file;
 * use `deleteDatabaseFileAndReopen` from db.mjs for a filesystem reset.
 * @returns {{ responseCacheRowsRemoved: number }}
 */
export function wipeAllPersistedGraphAndCache() {
  const n = clearResponseCacheAll();
  clearAllGraphRows();
  return { responseCacheRowsRemoved: n };
}

/**
 * Clears SQLite phone HTML cache (not the graph). Optional companion to a graph reset.
 * @returns {number} rows removed
 */
export function clearResponseCacheAll() {
  return getDb().prepare("DELETE FROM response_cache").run().changes;
}

/**
 * Deletes entities with no incident edges, repeatedly until no rows removed.
 * @returns {number} total entities deleted
 */
export function pruneIsolatedEntityNodes() {
  const db = getDb();
  const del = db.prepare(`
    DELETE FROM entities WHERE id IN (
      SELECT e.id FROM entities e
      WHERE NOT EXISTS (SELECT 1 FROM edges WHERE from_id = e.id OR to_id = e.id)
    )
  `);
  let total = 0;
  for (let i = 0; i < 200; i++) {
    const r = del.run();
    const n = r.changes;
    if (!n) {
      break;
    }
    total += n;
  }
  return total;
}

/**
 * Collapses multiple `person` rows that share the same normalized display name
 * (e.g. two graph-ingest keys for the same real person). Merges JSON, rewires
 * edges, deletes duplicate rows, dedupes parallel edges. Safe when a name is unique
 * in the dataset; if two different people share a full name, they would merge
 * (rare in a single investigation tree).
 * @returns {number} how many person entity rows removed
 */
export function mergeDuplicatePersonEntitiesByName() {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM entities WHERE type = 'person'").all();
  if (rows.length < 2) {
    return 0;
  }
  const n = rows.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  /**
   * @param {number} i
   * @returns {number}
   */
  const find = (i) => {
    if (parent[i] !== i) {
      parent[i] = find(parent[i]);
    }
    return parent[i];
  };
  /**
   * @param {number} i
   * @param {number} j
   * @returns {void}
   */
  const union = (i, j) => {
    const pi = find(i);
    const pj = find(j);
    if (pi !== pj) {
      parent[pi] = pj;
    }
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (shouldMergePersonRows(rows[i], rows[j])) {
        union(i, j);
      }
    }
  }
  /** @type {Map<number, object[]>} */
  const byRoot = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!byRoot.has(r)) {
      byRoot.set(r, []);
    }
    byRoot.get(r).push(rows[i]);
  }
  const lists = Array.from(byRoot.values()).filter((g) => g.length >= 2);
  if (!lists.length) {
    return 0;
  }
  let removed = 0;
  const work = () => {
    for (const list of lists) {
      list.sort(compareAsCanonicalPersonRow);
      const keep = list[0];
      const others = list.slice(1);
      let merged = parsePersonJson(keep.data_json);
      for (const o of others) {
        merged = mergePersonRecord(merged, parsePersonJson(o.data_json));
      }
      const t = nowIso();
      const nextHash = createHash("sha256").update(JSON.stringify(merged)).digest("hex");
      const label =
        (merged.displayName && String(merged.displayName).trim()) ||
        (keep.label && String(keep.label).trim()) ||
        null;
      db.prepare(
        `UPDATE entities SET label = COALESCE(?, label), data_json = ?, data_hash = ?, updated_at = ? WHERE id = ?`
      ).run(label, JSON.stringify(merged), nextHash, t, keep.id);
      for (const o of others) {
        rewireEntityIdInEdges(db, keep.id, o.id);
        db.prepare("DELETE FROM entities WHERE id = ?").run(o.id);
        removed += 1;
      }
      removeDuplicateGraphEdges(db);
      void indexEntityText(
        keep.id,
        `${label || ""} ${JSON.stringify(merged).slice(0, 400)}`
      );
    }
  };
  if (typeof db.transaction === "function") {
    db.transaction(work)();
  } else {
    work();
  }
  return removed;
}

/**
 * @param {string} dataJson
 * @returns {object}
 */
function parsePersonJson(dataJson) {
  try {
    const d = JSON.parse(dataJson);
    if (d && typeof d === "object") {
      return d;
    }
  } catch {
    // ignore
  }
  return {};
}

/**
 * @param {{ id: string; label: string | null; data_json: string }} row
 * @returns {string}
 */
function nameKeyForPersonEntityRow(row) {
  const candidates = [];
  const lb = (row.label && String(row.label).replace(/\s*,\s*$/g, "").trim()) || "";
  if (lb) {
    candidates.push(normalizePersonNameForDedupe(lb));
  }
  try {
    const d = JSON.parse(row.data_json);
    if (d && d.displayName) {
      candidates.push(
        normalizePersonNameForDedupe(String(d.displayName).replace(/\s*,\s*$/g, "").trim())
      );
    }
    if (d && Array.isArray(d.aliases)) {
      for (const a of d.aliases) {
        if (a) {
          candidates.push(
            normalizePersonNameForDedupe(String(a).replace(/\s*,\s*$/g, "").trim())
          );
        }
      }
    }
  } catch {
    // ignore
  }
  const best = candidates.filter(Boolean).sort((a, b) => b.length - a.length)[0] || "";
  if (!best) {
    return "";
  }
  const m = personKeyFromNameOnly(best);
  return m && m !== "unknown" ? m : "";
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function oneTokenKeyPrefixOfLongerName(a, b) {
  if (a === b) {
    return true;
  }
  const s = a.length <= b.length ? a : b;
  const t = a.length <= b.length ? b : a;
  if (s.length === 0) {
    return false;
  }
  if (s.indexOf(" ") === -1 && t.startsWith(s + " ")) {
    return true;
  }
  return false;
}

/**
 * @param {object} row
 * @returns {string}
 */
function lowerNormalizedLabelKey(row) {
  const l = (row.label && String(row.label).replace(/\s*,\s*$/g, "")) || "";
  if (!l) {
    return "";
  }
  return normalizePersonNameForDedupe(l).toLowerCase();
}

/**
 * Upper label used like graphQuery `title: label || dedupe` (we only have label + JSON here).
 * @param {object} row
 * @returns {string}
 */
function lowerVisibleNameForGraphRow(row) {
  const l = (row.label && String(row.label).replace(/\s*,\s*$/g, "").trim()) || "";
  if (l) {
    return normalizePersonNameForDedupe(l).toLowerCase();
  }
  try {
    const d = JSON.parse(/** @type {{ data_json: string }} */ (row).data_json);
    if (d && d.displayName) {
      return normalizePersonNameForDedupe(String(d.displayName).replace(/\s*,\s*$/g, "").trim()).toLowerCase();
    }
  } catch {
    // ignore
  }
  return "";
}

/**
 * @param {object} ra
 * @param {object} rb
 * @returns {boolean}
 */
function shouldMergePersonRows(ra, rb) {
  const a = nameKeyForPersonEntityRow(/** @type {object} */ (ra));
  const b = nameKeyForPersonEntityRow(/** @type {object} */ (rb));
  if (a && b) {
    if (a === b) {
      return true;
    }
    if (oneTokenKeyPrefixOfLongerName(a, b)) {
      return true;
    }
  }
  const l1 = lowerNormalizedLabelKey(ra);
  const l2 = lowerNormalizedLabelKey(rb);
  if (l1 && l1 === l2) {
    return true;
  }
  const v1 = lowerVisibleNameForGraphRow(ra);
  const v2 = lowerVisibleNameForGraphRow(rb);
  if (v1 && v1 === v2) {
    return true;
  }
  return false;
}

/**
 * @param {object} a
 * @param {object} b
 * @returns {number}
 */
function compareAsCanonicalPersonRow(a, b) {
  const sc = (row) => {
    const d = parsePersonJson(String(row.data_json));
    let s = 0;
    if (d.profilePath) {
      s += 1000;
    }
    s += (Array.isArray(d.alternateProfilePaths) ? d.alternateProfilePaths.length : 0) * 10;
    s += (Array.isArray(d.aliases) ? d.aliases.length : 0) * 2;
    s += (row.label && String(row.label).length) || 0;
    return s;
  };
  return sc(b) - sc(a) || String(a.id).localeCompare(String(b.id));
}

/**
 * @param {import("better-sqlite3").Database} db
 * @param {string} keepId
 * @param {string} removeId
 * @returns {void}
 */
function rewireEntityIdInEdges(db, keepId, removeId) {
  if (removeId === keepId) {
    return;
  }
  db.prepare("UPDATE edges SET from_id = ? WHERE from_id = ?").run(keepId, removeId);
  db.prepare("UPDATE edges SET to_id = ? WHERE to_id = ?").run(keepId, removeId);
  removeDuplicateGraphEdges(db);
  db.prepare("DELETE FROM edges WHERE from_id = ? AND to_id = ?").run(keepId, keepId);
}

/**
 * @param {import("better-sqlite3").Database} db
 * @returns {void}
 */
function removeDuplicateGraphEdges(db) {
  try {
    db.exec(`
      DELETE FROM edges
      WHERE rowid NOT IN (
        SELECT MIN(rowid) FROM edges GROUP BY from_id, to_id, kind
      )
    `);
  } catch {
    // if rowid not available, skip
  }
}

/**
 * Call once after DB init. Controlled by .env; logs what ran.
 * @returns {void}
 */
export function runGraphStartupMaintenance() {
  if (envOn("OSINT_GRAPH_RESET_ON_START")) {
    clearAllGraphRows();
    console.log("[graph] OSINT_GRAPH_RESET_ON_START: all entities, edges, and merge_snapshots removed");
    if (envOn("OSINT_PHONE_CACHE_CLEAR_ON_START")) {
      const n = clearResponseCacheAll();
      console.log(`[graph] OSINT_PHONE_CACHE_CLEAR_ON_START: response_cache removed ${n} row(s)`);
    }
    return;
  }
  if (envOn("OSINT_PHONE_CACHE_CLEAR_ON_START") && !envOn("OSINT_GRAPH_RESET_ON_START")) {
    const n = clearResponseCacheAll();
    console.log(`[graph] OSINT_PHONE_CACHE_CLEAR_ON_START: response_cache removed ${n} row(s)`);
  }
  if (envOn("OSINT_GRAPH_PRUNE_ISOLATED_ON_START")) {
    const removed = pruneIsolatedEntityNodes();
    if (removed > 0) {
      console.log(
        `[graph] OSINT_GRAPH_PRUNE_ISOLATED_ON_START: removed ${removed} isolated entity row(s)`
      );
    } else {
      console.log("[graph] OSINT_GRAPH_PRUNE_ISOLATED_ON_START: no isolated entities to remove");
    }
  }
}
