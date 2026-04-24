import { randomUUID } from "node:crypto";
import { getDb, nowIso } from "./db/db.mjs";

function parseJson(text, fallback) {
  try {
    return text ? JSON.parse(text) : fallback;
  } catch {
    return fallback;
  }
}

function rowToLead(row) {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    sourceId: row.source_id,
    url: row.url,
    label: row.label || null,
    accessMode: row.access_mode,
    confidence: row.confidence == null ? null : Number(row.confidence),
    evidence: parseJson(row.evidence_json, {}),
    context: parseJson(row.context_json, {}),
    reviewStatus: row.review_status,
    reviewNote: row.review_note || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function upsertCandidateLead(input) {
  const sourceId = String(input?.sourceId || "").trim();
  const url = String(input?.url || "").trim();
  if (!sourceId) {
    throw new Error("sourceId is required");
  }
  if (!url) {
    throw new Error("url is required");
  }
  const existing = getDb()
    .prepare(`SELECT * FROM candidate_leads WHERE source_id = ? AND url = ?`)
    .get(sourceId, url);
  const id = existing?.id || randomUUID();
  const createdAt = existing?.created_at || nowIso();
  const updatedAt = nowIso();
  const evidence = input?.evidence && typeof input.evidence === "object" ? input.evidence : {};
  const context = input?.context && typeof input.context === "object" ? input.context : {};
  const reviewStatus = String(existing?.review_status || input?.reviewStatus || "pending");
  getDb()
    .prepare(
      `INSERT INTO candidate_leads (
         id, source_id, url, label, access_mode, confidence, evidence_json, context_json, review_status, review_note, created_at, updated_at
       ) VALUES (
         @id, @source_id, @url, @label, @access_mode, @confidence, @evidence_json, @context_json, @review_status, @review_note, @created_at, @updated_at
       )
       ON CONFLICT(source_id, url) DO UPDATE SET
         label = excluded.label,
         access_mode = excluded.access_mode,
         confidence = excluded.confidence,
         evidence_json = excluded.evidence_json,
         context_json = excluded.context_json,
         updated_at = excluded.updated_at`
    )
    .run({
      id,
      source_id: sourceId,
      url,
      label: input?.label ? String(input.label) : existing?.label || null,
      access_mode: String(input?.accessMode || existing?.access_mode || "lead_only"),
      confidence: input?.confidence == null ? existing?.confidence || null : Number(input.confidence),
      evidence_json: JSON.stringify({ ...(parseJson(existing?.evidence_json, {})), ...evidence }),
      context_json: JSON.stringify({ ...(parseJson(existing?.context_json, {})), ...context }),
      review_status: reviewStatus,
      review_note: existing?.review_note || null,
      created_at: createdAt,
      updated_at: updatedAt,
    });
  return getCandidateLeadBySourceAndUrl(sourceId, url);
}

export function getCandidateLeadBySourceAndUrl(sourceId, url) {
  return rowToLead(
    getDb().prepare(`SELECT * FROM candidate_leads WHERE source_id = ? AND url = ?`).get(sourceId, url)
  );
}

export function listCandidateLeads(options = {}) {
  const limit = Math.max(1, Math.min(500, Number(options.limit || 100)));
  const clauses = [];
  const params = {};
  if (options.reviewStatus) {
    clauses.push(`review_status = @review_status`);
    params.review_status = String(options.reviewStatus);
  }
  if (options.sourceId) {
    clauses.push(`source_id = @source_id`);
    params.source_id = String(options.sourceId);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = getDb()
    .prepare(`SELECT * FROM candidate_leads ${where} ORDER BY updated_at DESC LIMIT ${limit}`)
    .all(params);
  return rows.map(rowToLead);
}

export function reviewCandidateLead(id, reviewStatus, reviewNote = null) {
  const updatedAt = nowIso();
  getDb()
    .prepare(
      `UPDATE candidate_leads
       SET review_status = ?, review_note = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(String(reviewStatus), reviewNote == null ? null : String(reviewNote), updatedAt, String(id));
  return rowToLead(getDb().prepare(`SELECT * FROM candidate_leads WHERE id = ?`).get(String(id)));
}
