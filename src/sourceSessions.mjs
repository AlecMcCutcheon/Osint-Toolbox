import { getDb, nowIso } from "./db/db.mjs";
import { getSourceDefinition, listSourceDefinitions } from "./sourceCatalog.mjs";
import { extractTruePeopleSearchVerificationUrl, isTruePeopleSearchLookupUrl } from "./truePeopleSearch.mjs";

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

/**
 * @param {object} meta
 * @returns {{ homepage?: string; lookup?: string }}
 */
export function hydrateVerifiedScopes(meta) {
  const existing = meta?.verifiedScopes && typeof meta.verifiedScopes === "object" ? { ...meta.verifiedScopes } : {};
  if (!existing.homepage && meta?.checkedUrlScope === "homepage" && meta?.lastCheckedUrl) {
    existing.homepage = meta.lastCheckedAt || nowIso();
  }
  if (!existing.lookup && meta?.checkedUrlScope === "lookup" && meta?.lastCheckedUrl) {
    existing.lookup = meta.lastCheckedAt || nowIso();
  }
  return existing;
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

function hydrateSessionState(row, source) {
  const base = defaultStateForSource(source);
  if (!row) {
    return base;
  }
  const meta = parseJson(row.meta_json, {});
  if (!meta.verifiedScopes) {
    meta.verifiedScopes = hydrateVerifiedScopes({ ...meta, lastCheckedAt: row.last_checked_at });
  }
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

function sourceScopeMembers(sourceId) {
  const source = getSourceDefinition(sourceId);
  const scope = source.sessionScope || source.id;
  return listSourceDefinitions().filter((candidate) => (candidate.sessionScope || candidate.id) === scope);
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

/**
 * @param {string} sourceId
 * @param {string} checkedUrl
 * @returns {"homepage" | "lookup"}
 */
export function sessionCheckUrlScope(sourceId, checkedUrl) {
  if (sourceId === "truepeoplesearch" && isTruePeopleSearchLookupUrl(checkedUrl)) {
    return "lookup";
  }
  return "homepage";
}

/**
 * @param {string} sourceId
 * @param {string} checkedUrl
 * @param {string | null | undefined} [finalUrl]
 * @param {string} status
 * @param {{ verificationUrl?: string | null; lastFailedUrl?: string | null; priorMeta?: object }} [extra]
 * @returns {object}
 */
export function buildSessionMeta(sourceId, checkedUrl, status, extra = {}) {
  const priorMeta = extra.priorMeta && typeof extra.priorMeta === "object" ? extra.priorMeta : {};
  const verifiedScopes = hydrateVerifiedScopes(priorMeta);
  const finalUrl = String(extra.finalUrl || "").trim();
  const resolvedUrl = finalUrl || String(checkedUrl || "").trim();
  const scope = sessionCheckUrlScope(sourceId, resolvedUrl);
  const timestamp = nowIso();

  const meta = {
    ...priorMeta,
    lastCheckedUrl: resolvedUrl || String(checkedUrl || "").trim() || null,
    checkedUrlScope: scope,
    verifiedScopes: { ...verifiedScopes },
  };

  if (status === "ready") {
    if (scope === "lookup") {
      meta.verifiedScopes.lookup = timestamp;
    } else {
      meta.verifiedScopes.homepage = timestamp;
    }
    meta.pendingVerificationUrl = null;
    meta.lastFailedUrl = null;
  } else if (status === "challenge_required") {
    const verificationUrl =
      String(extra.verificationUrl || "").trim() ||
      extractTruePeopleSearchVerificationUrl(checkedUrl, finalUrl || extra.lastWarningDetail);
    meta.pendingVerificationUrl = verificationUrl || null;
    meta.lastFailedUrl = String(extra.lastFailedUrl || checkedUrl || "").trim() || null;
  }

  return meta;
}

/**
 * @param {string} sourceId
 * @param {string} checkedUrl
 * @param {string} status
 * @param {{ pendingVerificationUrl?: string | null; lastFailedUrl?: string | null; finalUrl?: string | null }} [extra]
 * @returns {object}
 */
export function sessionMetaForCheck(sourceId, checkedUrl, status, extra = {}) {
  return buildSessionMeta(sourceId, checkedUrl, status, {
    verificationUrl: extra.pendingVerificationUrl,
    lastFailedUrl: extra.lastFailedUrl,
    finalUrl: extra.finalUrl,
  });
}

/**
 * @param {string} sourceId
 * @param {{
 *   checkedUrl: string;
 *   finalUrl?: string | null;
 *   status: string;
 *   lastWarning?: string | null;
 *   lastWarningDetail?: string | null;
 *   verificationUrl?: string | null;
 *   lastFailedUrl?: string | null;
 *   opened?: boolean;
 * }} outcome
 * @returns {object}
 */
export function applySourceSessionOutcome(sourceId, outcome) {
  const current = getSourceSession(sourceId);
  const meta = buildSessionMeta(sourceId, outcome.checkedUrl, outcome.status, {
    finalUrl: outcome.finalUrl,
    verificationUrl: outcome.verificationUrl,
    lastFailedUrl: outcome.lastFailedUrl,
    lastWarningDetail: outcome.lastWarningDetail,
    priorMeta: current.meta,
  });
  const timestamp = nowIso();
  const patch = {
    status: outcome.status,
    lastCheckedAt: timestamp,
    lastWarning: outcome.lastWarning === undefined ? null : outcome.lastWarning,
    lastWarningDetail: outcome.lastWarningDetail === undefined ? null : outcome.lastWarningDetail,
    meta,
    ...(outcome.opened ? { lastOpenedAt: timestamp } : {}),
  };

  for (const member of sourceScopeMembers(sourceId)) {
    upsertSourceSession(member.id, patch);
  }
  return getSourceSession(sourceId);
}

/**
 * @param {string} sourceId
 * @returns {boolean}
 */
export function isSessionReadyForFetch(sourceId) {
  const session = getSourceSession(sourceId);
  return !session.paused && session.effectiveStatus === "ready";
}

/**
 * @param {string} sourceId
 * @param {string | null | undefined} targetUrl
 * @returns {{ ready: boolean; status: string; note: string | null; verificationUrl: string | null; reason?: string }}
 */
export function assessSourceSessionReadiness(sourceId, targetUrl) {
  const source = getSourceDefinition(sourceId);
  const session = getSourceSession(sourceId);
  const lookupUrl = String(targetUrl || "").trim();
  const entryUrl = String(source.browserCheckUrl || source.browserEntryUrl || "").trim() || null;

  if (session.paused || session.effectiveStatus === "inactive") {
    return {
      ready: false,
      status: "session_required",
      note: `${source.name} is paused in Settings. Resume the source before retrying.`,
      verificationUrl: entryUrl,
    };
  }

  if (session.effectiveStatus === "challenge_required") {
    const verificationUrl =
      String(session.meta?.pendingVerificationUrl || "").trim() ||
      String(session.meta?.lastFailedUrl || "").trim() ||
      String(session.lastWarningDetail || "").trim() ||
      lookupUrl ||
      entryUrl;
    return {
      ready: false,
      status: "challenge_required",
      note: "Complete the captcha in the local browser, then check session on the verification URL before retrying.",
      verificationUrl: verificationUrl || null,
      reason: "challenge_pending",
    };
  }

  if (session.effectiveStatus !== "ready") {
    return {
      ready: false,
      status: "session_required",
      note: `Open ${source.name} in Settings, complete any challenge, then click Check session before retrying.`,
      verificationUrl: entryUrl,
    };
  }

  return {
    ready: true,
    status: "ready",
    note: null,
    verificationUrl: null,
  };
}
