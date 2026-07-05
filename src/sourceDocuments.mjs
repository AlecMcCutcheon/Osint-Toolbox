import { createHash, randomUUID } from "node:crypto";
import { getDb, nowIso } from "./db/db.mjs";

/**
 * @param {object} normalized
 * @returns {string}
 */
export function hashNormalizedDocument(normalized) {
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

function parseJson(text, fallback) {
  try {
    return text ? JSON.parse(text) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * @param {import("better-sqlite3").Statement} row
 * @returns {object | null}
 */
function rowToDocument(row) {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    sourceId: row.source_id,
    kind: row.kind,
    url: row.url || null,
    query: parseJson(row.query_json, {}),
    normalized: parseJson(row.normalized_json, {}),
    contentHash: row.content_hash,
    fetchMeta: parseJson(row.fetch_meta_json, {}),
    graphIngest: row.graph_ingest_json ? parseJson(row.graph_ingest_json, null) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * @param {{
 *   sourceId: string;
 *   kind: string;
 *   url?: string | null;
 *   query?: object;
 *   normalized: object;
 *   fetchMeta?: object;
 *   graphIngest?: object | null;
 * }} input
 * @returns {string}
 */
export function upsertSourceDocument(input) {
  const sourceId = String(input.sourceId || "").trim();
  const kind = String(input.kind || "").trim();
  if (!sourceId || !kind) {
    throw new Error("sourceId and kind are required");
  }
  if (!input.normalized || typeof input.normalized !== "object") {
    throw new Error("normalized document is required");
  }
  const contentHash = hashNormalizedDocument(input.normalized);
  const db = getDb();
  const existing = db
    .prepare(`SELECT id, created_at FROM source_documents WHERE source_id = ? AND kind = ? AND content_hash = ?`)
    .get(sourceId, kind, contentHash);
  const id = existing?.id || randomUUID();
  const createdAt = existing?.created_at || nowIso();
  const updatedAt = nowIso();
  db.prepare(
    `INSERT INTO source_documents (
       id, source_id, kind, url, query_json, normalized_json, content_hash, fetch_meta_json, graph_ingest_json, created_at, updated_at
     ) VALUES (
       @id, @source_id, @kind, @url, @query_json, @normalized_json, @content_hash, @fetch_meta_json, @graph_ingest_json, @created_at, @updated_at
     )
     ON CONFLICT(source_id, kind, content_hash) DO UPDATE SET
       url = excluded.url,
       query_json = excluded.query_json,
       normalized_json = excluded.normalized_json,
       fetch_meta_json = excluded.fetch_meta_json,
       graph_ingest_json = excluded.graph_ingest_json,
       updated_at = excluded.updated_at`
  ).run({
    id,
    source_id: sourceId,
    kind,
    url: input.url ? String(input.url) : null,
    query_json: JSON.stringify(input.query && typeof input.query === "object" ? input.query : {}),
    normalized_json: JSON.stringify(input.normalized),
    content_hash: contentHash,
    fetch_meta_json: JSON.stringify(input.fetchMeta && typeof input.fetchMeta === "object" ? input.fetchMeta : {}),
    graph_ingest_json: input.graphIngest ? JSON.stringify(input.graphIngest) : null,
    created_at: createdAt,
    updated_at: updatedAt,
  });
  return id;
}

/**
 * @param {string} id
 * @param {object | null} graphIngest
 * @returns {object | null}
 */
export function updateSourceDocumentGraphIngest(id, graphIngest) {
  const updatedAt = nowIso();
  getDb()
    .prepare(`UPDATE source_documents SET graph_ingest_json = ?, updated_at = ? WHERE id = ?`)
    .run(graphIngest ? JSON.stringify(graphIngest) : null, updatedAt, String(id));
  return getSourceDocument(id);
}

/**
 * @param {string} id
 * @returns {object | null}
 */
export function getSourceDocument(id) {
  return rowToDocument(getDb().prepare(`SELECT * FROM source_documents WHERE id = ?`).get(String(id)));
}
