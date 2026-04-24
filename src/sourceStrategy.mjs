const SOURCE_TRUST_FAILURE_REASONS = new Set([
  "attention_required",
  "cloudflare",
  "javascript_required",
  "access_denied",
  "forbidden",
  "humanity_check",
  "recaptcha",
  "captcha",
  "odd_traffic",
]);

const THATSTHEM_PATTERN_DEFAULT_PRIORITY = new Map([
  ["query_phone", 2],
  ["query_Phone", 1],
  ["path_digits", 0],
  ["path_dashed", -1],
  ["unknown", -2],
]);

/**
 * @param {object | null | undefined} result
 * @returns {boolean}
 */
export function isSourceTrustFailure(result) {
  if (!result || result.status !== "blocked") {
    return false;
  }
  return SOURCE_TRUST_FAILURE_REASONS.has(String(result.reason || "").trim().toLowerCase());
}

/**
 * @param {object | null | undefined} result
 * @param {object} [extras]
 * @returns {object | null | undefined}
 */
export function annotateSourceResult(result, extras = {}) {
  if (!result || typeof result !== "object") {
    return result;
  }
  const trustFailure = isSourceTrustFailure(result);
  return {
    ...result,
    ...extras,
    trustFailure,
    failureKind: trustFailure ? "source_trust" : result.status === "error" ? "fetch_or_parse" : null,
    trustReason: trustFailure ? String(result.reason || "").trim() || null : null,
  };
}

/**
 * @param {string} searchUrl
 * @returns {string}
 */
export function getThatsThemCandidatePattern(searchUrl) {
  try {
    const url = new URL(searchUrl);
    if (/^\/reverse-phone-lookup\/\d{10}$/.test(url.pathname)) {
      return "path_digits";
    }
    if (/^\/reverse-phone-lookup\/\d{3}-\d{3}-\d{4}$/.test(url.pathname)) {
      return "path_dashed";
    }
    if (url.pathname === "/reverse-phone-lookup" && url.searchParams.has("phone")) {
      return "query_phone";
    }
    if (url.pathname === "/reverse-phone-lookup" && url.searchParams.has("Phone")) {
      return "query_Phone";
    }
  } catch {
    // fall through
  }
  return "unknown";
}

/**
 * @param {Map<string, any>} statsByPattern
 * @param {string} searchUrl
 * @param {object | null | undefined} result
 * @returns {object}
 */
export function recordThatsThemCandidateOutcome(statsByPattern, searchUrl, result) {
  const pattern = getThatsThemCandidatePattern(searchUrl);
  const current = statsByPattern.get(pattern) || {
    attempts: 0,
    ok: 0,
    parseableNoMatch: 0,
    notFound: 0,
    blocked: 0,
    errors: 0,
  };
  current.attempts += 1;
  if (result?.status === "ok") {
    current.ok += 1;
  } else if (result?.status === "no_match") {
    if (result.reason === "not_found_page") {
      current.notFound += 1;
    } else {
      current.parseableNoMatch += 1;
    }
  } else if (result?.status === "blocked") {
    current.blocked += 1;
  } else {
    current.errors += 1;
  }
  statsByPattern.set(pattern, current);
  return current;
}

/**
 * @param {object | undefined} stats
 * @returns {boolean}
 */
export function shouldSkipThatsThemCandidatePattern(stats) {
  if (!stats) {
    return false;
  }
  return stats.attempts >= 3 && stats.notFound >= 3 && stats.ok === 0 && stats.parseableNoMatch === 0;
}

/**
 * @param {string} searchUrl
 * @param {Map<string, any>} statsByPattern
 * @returns {number}
 */
function thatsThemCandidateScore(searchUrl, statsByPattern) {
  const pattern = getThatsThemCandidatePattern(searchUrl);
  const stats = statsByPattern.get(pattern);
  const base = THATSTHEM_PATTERN_DEFAULT_PRIORITY.get(pattern) || 0;
  if (!stats) {
    return base;
  }
  return (
    base +
    stats.ok * 8 +
    stats.parseableNoMatch * 4 -
    stats.blocked * 2 -
    stats.errors * 3 -
    stats.notFound * 6
  );
}

/**
 * @param {string[]} candidates
 * @param {Map<string, any>} statsByPattern
 * @returns {string[]}
 */
export function rankThatsThemCandidateUrls(candidates, statsByPattern) {
  return [...candidates].sort((left, right) => thatsThemCandidateScore(right, statsByPattern) - thatsThemCandidateScore(left, statsByPattern));
}