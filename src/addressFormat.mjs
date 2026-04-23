/** US state abbreviations (lowercase) for parsing normalized keys. */
const US_STATE = new Set(
  "al ak az ar ca co ct de dc fl ga hi id il in ia ks ky la me md ma mi mn ms mo mt ne nv nh nj nm ny nc nd oh ok or pa ri sc sd tn tx ut vt va wa wv wi wy"
    .split(/\s+/)
);

/**
 * @param {string} s
 * @returns {string}
 */
export function fixZipPlusFourSpacing(s) {
  return String(s).replace(/\b(\d{5})\s+(\d{4})\b/g, "$1-$2");
}

/**
 * @param {string} line
 * @returns {string}
 */
export function streetLineFromAddressLabel(line) {
  const t = String(line || "").trim();
  if (!t) {
    return "";
  }
  let head = t.split(",")[0].trim();
  head = head.replace(/\s*\([^)]*\)\s*$/, "").trim();
  return head;
}

/**
 * Best-effort street line from normAddrKey-style string (lowercase, few commas).
 * @param {string} key
 * @returns {string}
 */
export function streetLineFromNormalizedKey(key) {
  const raw = String(key || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  if (!raw) {
    return "";
  }
  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length < 2) {
    return raw;
  }
  let zi = -1;
  for (let i = parts.length - 1; i >= 0; i--) {
    if (/^\d{5}(-\d{4})?$/.test(parts[i])) {
      zi = i;
      break;
    }
  }
  if (zi >= 2 && US_STATE.has(parts[zi - 1])) {
    return parts.slice(0, zi - 2).join(" ");
  }
  if (zi >= 1) {
    return parts.slice(0, zi - 1).join(" ");
  }
  return parts.slice(0, Math.min(6, parts.length)).join(" ");
}

/**
 * @param {string} s
 * @returns {string}
 */
function titleCaseWords(s) {
  const small = new Set(["and", "or", "of", "the", "in", "at", "to"]);
  return String(s)
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) => {
      if (/^\d/.test(w) || /^\d{5}(-\d{4})?$/.test(w)) {
        return w;
      }
      const low = w.toLowerCase();
      if (i > 0 && small.has(low)) {
        return low;
      }
      if (low.length === 2 && US_STATE.has(low)) {
        return low.toUpperCase();
      }
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(" ");
}

/**
 * Strip duplicate date ranges from label when timeRange is set separately.
 * @param {string} label
 * @param {string | null | undefined} timeRange
 * @returns {string}
 */
function labelWithoutDuplicateDates(label, timeRange) {
  let t = String(label || "").trim();
  const tr = timeRange != null ? String(timeRange).trim() : "";
  if (!tr || !t) {
    return t;
  }
  const inner = tr.replace(/^\s*\(|\)\s*$/g, "").trim();
  if (inner) {
    t = t.replace(new RegExp(`\\s*\\(${escapeReg(inner)}\\)`, "gi"), "").trim();
  }
  return t;
}

/**
 * @param {string} re
 * @returns {string}
 */
function escapeReg(re) {
  return re.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * @param {{ label?: string; normalizedKey?: string; timeRange?: string | null }} addr
 * @returns {{
 *   streetLine: string;
 *   formattedFull: string;
 *   recordedRange: string;
 *   graphPopupText: string;
 * }}
 */
export function addressPresentation(addr) {
  const label0 = String(addr?.label || "").trim();
  const nk = String(addr?.normalizedKey || "").trim();
  const tr = addr?.timeRange != null ? String(addr.timeRange).trim() : "";

  const label = fixZipPlusFourSpacing(labelWithoutDuplicateDates(label0, tr));
  const nkClean = nk.replace(/,/g, " ").replace(/\s+/g, " ").trim();
  const baseLabel = label || nkClean;

  const streetRaw = streetLineFromAddressLabel(label0) || streetLineFromNormalizedKey(nk);
  const streetLine = streetRaw ? titleCaseWords(fixZipPlusFourSpacing(streetRaw)) : "";

  const formattedFull = baseLabel
    ? fixZipPlusFourSpacing(baseLabel)
        .split(",")
        .map((p) => titleCaseWords(p.trim()))
        .filter(Boolean)
        .join(", ")
    : streetLine;

  const recordedRange = tr || "";
  const graphPopupText = recordedRange
    ? `${formattedFull}\n\nOn record: ${recordedRange}`
    : formattedFull;

  return {
    streetLine,
    formattedFull,
    recordedRange,
    graphPopupText,
  };
}
