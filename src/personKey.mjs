/**
 * Stable keys for person entity deduplication (paths, name-only fallbacks, aliases).
 */

/**
 * USPhoneBook hrefs may be a path (`/people/...`) or a full `https://.../people/...` URL.
 * Reducing the latter to a pathname keeps one profile from splitting into two entities.
 * @param {string} path
 * @returns {string} path only, with leading `/`, or ""
 */
export function profilePathnameOnly(path) {
  if (path == null || typeof path !== "string") {
    return "";
  }
  let raw = path.split("#")[0].trim();
  if (!raw) {
    return "";
  }
  if (!/^https?:\/\//i.test(raw)) {
    raw = raw.split("?")[0].trim();
  }
  let p = raw;
  if (/^https?:\/\//i.test(p)) {
    try {
      p = new URL(p).pathname;
    } catch {
      return "";
    }
  }
  if (!p.startsWith("/")) {
    p = `/${p}`.replace(/\/+/g, "/");
  }
  p = p.replace(/\/+/g, "/");
  if (p.length > 1) {
    p = p.replace(/\/+$/, "");
  }
  return p;
}

/**
 * True for `/name-slug/record-id` person detail paths (not phone-search or /address/…).
 * Uses path segments only so random base64 substrings cannot trip a broad "address" substring check.
 * @param {string} path
 * @returns {boolean}
 */
export function isUsPhonebookPersonProfilePath(path) {
  const p = profilePathnameOnly(path);
  if (!p || !/^\/[^/]+\/[^/]+$/.test(p)) {
    return false;
  }
  const segs = p.split("/").filter(Boolean);
  if (segs.length !== 2) {
    return false;
  }
  const [a0] = segs;
  if (a0 === "phone-search" || a0 === "address") {
    return false;
  }
  return true;
}

/**
 * @param {string} path
 * @returns {string} canonical key segment for dedupe_key (no "person:" prefix)
 */
export function personKeyFromPath(path) {
  const p = profilePathnameOnly(path);
  if (!p) {
    return "";
  }
  let k = p;
  try {
    k = decodeURIComponent(p);
  } catch {
    k = p;
  }
  return k.toLowerCase();
}

/**
 * The segment under `/people/…` is often stable when full `personKeyFromPath` values
 * differ (e.g. two href shapes for the same profile). Used as a second merge key only.
 * @param {string} path
 * @returns {string} lowercased slug, or ""
 */
export function peopleProfileSlugKey(path) {
  const p = profilePathnameOnly(path);
  if (!p) {
    return "";
  }
  const m = p.match(/\/people\/(.+)/i);
  if (!m) {
    return "";
  }
  let s = m[1].replace(/\/+$/, "");
  try {
    s = decodeURIComponent(s);
  } catch {
    // keep raw segment
  }
  s = s.toLowerCase();
  return s.length >= 2 ? s : "";
}

/**
 * Punctuation-agnostic form of the /people/… segment for when strict slug keys differ
 * (e.g. "todd_m_x" vs "todd-m-x").
 * @param {string} path
 * @returns {string}
 */
export function peopleProfileSlugKeyLoose(path) {
  const s = peopleProfileSlugKey(path);
  if (!s) {
    return "";
  }
  return s
    .replace(/[._+]+/g, "-")
    .replace(/[\s-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Deduplication key for a related-person row in HTML: prefer {@link peopleProfileSlugKey}
 * so two href variants for the same profile collapse to one, then full path, then name-only.
 * @param {string} name
 * @param {string} [path]
 * @returns {string}
 */
export function relativeListDedupeKey(name, path) {
  const p0 = String(path || "")
    .split("#")[0]
    .trim();
  if (p0) {
    const s = peopleProfileSlugKeyLoose(p0);
    if (s) {
      return `s:${s}`;
    }
  }
  const pk = personKeyFromPath(p0);
  if (pk) {
    return `p:${pk}`;
  }
  return `n:${personKeyFromNameOnly(name || "")}`;
}

/**
 * Unicode + whitespace cleanup before name-only keys (merging / display).
 * @param {string} s
 * @returns {string}
 */
export function normalizePersonNameForDedupe(s) {
  let t = String(s || "");
  if (typeof t.normalize === "function") {
    t = t.normalize("NFKC");
  }
  t = t.replace(/[\u00A0\u200B-\u200D\uFEFF\u2060]/g, " ");
  t = t.replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]+/g, "-");
  return t
    .replace(/\s*,\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * @param {string} name
 * @returns {string}
 */
export function personKeyFromNameOnly(name) {
  const t = String(name || "")
    .toLowerCase()
    .replace(/[.,#]/g, " ")
    .replace(/[^a-z0-9\u00C0-\u024F\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t || "unknown";
}

/**
 * Deduplicate display + alias strings.
 * @param {string[]} parts
 * @returns {string[]}
 */
export function uniqueNames(parts) {
  const s = new Set();
  const out = [];
  for (const p of parts) {
    const t = String(p || "").replace(/\s+/g, " ").trim();
    if (!t) {
      continue;
    }
    const k = t.toLowerCase();
    if (s.has(k)) {
      continue;
    }
    s.add(k);
    out.push(t);
  }
  return out;
}

/**
 * @param {string[]} paths
 * @returns {string[]}
 */
export function uniqueProfilePaths(paths) {
  const seen = new Set();
  const out = [];
  for (const p of paths) {
    if (!p) {
      continue;
    }
    const k = personKeyFromPath(p);
    if (!k || seen.has(k)) {
      continue;
    }
    seen.add(k);
    out.push(profilePathnameOnly(p));
  }
  return out;
}

/**
 * Path, strict slug, and loose slug sets from stored profile URLs for cross-row matching.
 * @param {object} data
 * @returns {{ pathKeys: Set<string>; slugStrict: Set<string>; slugLoose: Set<string> }}
 */
export function personPathKeySetsForMatch(data) {
  const pathKeys = new Set();
  const slugStrict = new Set();
  const slugLoose = new Set();
  if (!data || typeof data !== "object") {
    return { pathKeys, slugStrict, slugLoose };
  }
  const paths = uniqueProfilePaths([
    data.profilePath,
    ...(Array.isArray(data.alternateProfilePaths) ? data.alternateProfilePaths : []),
  ]);
  for (const raw of paths) {
    if (!raw) {
      continue;
    }
    const pk = personKeyFromPath(raw);
    if (pk) {
      pathKeys.add(pk);
    }
    const s = peopleProfileSlugKey(raw);
    if (s) {
      slugStrict.add(s);
    }
    const sl = peopleProfileSlugKeyLoose(raw);
    if (sl) {
      slugLoose.add(sl);
    }
  }
  return { pathKeys, slugStrict, slugLoose };
}
