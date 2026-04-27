import { getDb, nowIso } from "./db/db.mjs";
import { getSourceDefinition, listSourceDefinitions } from "./sourceCatalog.mjs";

function parseJson(text, fallback) {
  try {
    return text ? JSON.parse(text) : fallback;
  } catch {
    return fallback;
  }
}

function supportsSessionUi(source) {
  if (source?.status === "inactive") return false;
  return Boolean(source?.sessionMode && source.sessionMode !== "none") || source?.supportsInteractiveSession === true;
}

function defaultStatusForSource(source) {
  if (!supportsSessionUi(source)) {
    return "ready";
  }
  return source.sessionMode === "required" ? "session_required" : "ready";
}

function defaultStateForSource(source) {
  const status = defaultStatusForSource(source);
  return {
    sourceId: source.id,
    status,
    effectiveStatus: status,
    paused: false,
    lastCheckedAt: null,
    lastOpenedAt: null,
    lastWarning: null,
    lastWarningDetail: null,
    meta: {},
    createdAt: null,
    updatedAt: null,
  };
}

function hydrateSessionState(row, source) {
  const base = defaultStateForSource(source);
  if (!row) {
    return base;
  }
  const meta = parseJson(row.meta_json, {});
  const paused = row.paused === 1;
  const status = row.status || base.status;
  return {
    sourceId: row.source_id,
    status,
    effectiveStatus: paused ? "inactive" : status,
    paused,
    lastCheckedAt: row.last_checked_at || null,
    lastOpenedAt: row.last_opened_at || null,
    lastWarning: row.last_warning || null,
    lastWarningDetail: row.last_warning_detail || null,
    meta,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function getRow(sourceId) {
  return getDb()
    .prepare(
      `SELECT source_id, status, paused, last_checked_at, last_opened_at, last_warning, last_warning_detail, meta_json, created_at, updated_at
       FROM source_sessions
       WHERE source_id = ?`
    )
    .get(sourceId);
}

export function getSourceSession(sourceId) {
  const source = getSourceDefinition(sourceId);
  const row = getRow(sourceId);
  return hydrateSessionState(row, source);
}

export function listSourceSessions() {
  return listSourceDefinitions()
    .filter((source) => supportsSessionUi(source))
    .map((source) => ({
      sourceId: source.id,
      session: getSourceSession(source.id),
    }));
}

export function upsertSourceSession(sourceId, patch = {}) {
  const source = getSourceDefinition(sourceId);
  const current = getSourceSession(sourceId);
  const nextMeta = {
    ...(current.meta || {}),
    ...(patch.meta && typeof patch.meta === "object" ? patch.meta : {}),
  };
  const paused = patch.paused != null ? Boolean(patch.paused) : current.paused;
  const status = String(patch.status || current.status || defaultStatusForSource(source));
  const updatedAt = nowIso();
  const createdAt = current.createdAt || updatedAt;
  getDb()
    .prepare(
      `INSERT INTO source_sessions (
         source_id, status, paused, last_checked_at, last_opened_at, last_warning, last_warning_detail, meta_json, created_at, updated_at
       ) VALUES (
         @source_id, @status, @paused, @last_checked_at, @last_opened_at, @last_warning, @last_warning_detail, @meta_json, @created_at, @updated_at
       )
       ON CONFLICT(source_id) DO UPDATE SET
         status = excluded.status,
         paused = excluded.paused,
         last_checked_at = excluded.last_checked_at,
         last_opened_at = excluded.last_opened_at,
         last_warning = excluded.last_warning,
         last_warning_detail = excluded.last_warning_detail,
         meta_json = excluded.meta_json,
         updated_at = excluded.updated_at`
    )
    .run({
      source_id: sourceId,
      status,
      paused: paused ? 1 : 0,
      last_checked_at: patch.lastCheckedAt === undefined ? current.lastCheckedAt : patch.lastCheckedAt,
      last_opened_at: patch.lastOpenedAt === undefined ? current.lastOpenedAt : patch.lastOpenedAt,
      last_warning: patch.lastWarning === undefined ? current.lastWarning : patch.lastWarning,
      last_warning_detail:
        patch.lastWarningDetail === undefined ? current.lastWarningDetail : patch.lastWarningDetail,
      meta_json: JSON.stringify(nextMeta),
      created_at: createdAt,
      updated_at: updatedAt,
    });
  return getSourceSession(sourceId);
}

export function markSourceSessionOpened(sourceId, extra = {}) {
  return upsertSourceSession(sourceId, {
    lastOpenedAt: nowIso(),
    ...(extra || {}),
  });
}

export function markSourceSessionChecked(sourceId, status, extra = {}) {
  return upsertSourceSession(sourceId, {
    status,
    lastCheckedAt: nowIso(),
    ...(extra || {}),
  });
}

export function setSourceSessionPaused(sourceId, paused) {
  const current = getSourceSession(sourceId);
  const nextMeta = { ...(current.meta || {}) };
  if (paused) {
    nextMeta.priorStatus = current.status;
    return upsertSourceSession(sourceId, {
      paused: true,
      status: "inactive",
      meta: nextMeta,
    });
  }
  const source = getSourceDefinition(sourceId);
  const restoredStatus = String(nextMeta.priorStatus || defaultStatusForSource(source));
  delete nextMeta.priorStatus;
  return upsertSourceSession(sourceId, {
    paused: false,
    status: restoredStatus,
    meta: nextMeta,
  });
}

export function resetSourceSession(sourceId) {
  getDb().prepare(`DELETE FROM source_sessions WHERE source_id = ?`).run(sourceId);
  return getSourceSession(sourceId);
}
