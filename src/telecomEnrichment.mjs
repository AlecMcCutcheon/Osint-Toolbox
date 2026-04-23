import { enrichPhoneNumber, normalizeUsPhoneDigits } from "./phoneEnrichment.mjs";

const NANP_SPECIAL = new Map([
  ["800", { category: "toll_free", label: "Toll-free" }],
  ["833", { category: "toll_free", label: "Toll-free" }],
  ["844", { category: "toll_free", label: "Toll-free" }],
  ["855", { category: "toll_free", label: "Toll-free" }],
  ["866", { category: "toll_free", label: "Toll-free" }],
  ["877", { category: "toll_free", label: "Toll-free" }],
  ["888", { category: "toll_free", label: "Toll-free" }],
  ["900", { category: "premium", label: "Premium-rate" }],
  ["700", { category: "carrier_services", label: "Carrier services" }],
  ["500", { category: "personal_number", label: "Personal communications" }],
  ["600", { category: "canadian_services", label: "Canadian non-geographic" }],
  ["710", { category: "telecommunications_relay", label: "Telecommunications Relay Service" }],
]);

const N11 = new Map([
  ["211", "Community services"],
  ["311", "Local government"],
  ["411", "Directory assistance"],
  ["511", "Traffic / traveler information"],
  ["611", "Carrier customer care"],
  ["711", "Relay services"],
  ["811", "Call before you dig"],
  ["911", "Emergency services"],
]);

/**
 * @param {string} digits
 * @returns {object | null}
 */
function classifyNanp(digits) {
  if (!/^\d{10}$/.test(digits)) {
    return null;
  }
  const areaCode = digits.slice(0, 3);
  const exchange = digits.slice(3, 6);
  const lineNumber = digits.slice(6);
  const special = NANP_SPECIAL.get(areaCode) || null;
  const n11 = N11.get(areaCode) || null;
  const easilyRecognizable = /^(\d)\1\1$/.test(exchange) || /^(\d)\1\1\1$/.test(lineNumber);
  return {
    numberingPlan: "NANP",
    areaCode,
    centralOfficeCode: exchange,
    lineNumber,
    category: special?.category || (n11 ? "n11_service" : "geographic"),
    categoryLabel: special?.label || n11 || "Geographic / standard NANP",
    specialUse: Boolean(special || n11),
    easilyRecognizable,
  };
}

/**
 * @param {string | null | undefined} raw
 * @returns {object | null}
 */
export function enrichTelecomNumber(raw) {
  const phoneMeta = enrichPhoneNumber(raw);
  const normalized = normalizeUsPhoneDigits(raw);
  if (!phoneMeta && !normalized.dashed) {
    return null;
  }
  const nanp = normalized.digits ? classifyNanp(normalized.digits) : null;
  return {
    source: "telecom_numbering",
    phoneMetadata: phoneMeta,
    nanp,
    isUsLike: Boolean(normalized.dashed),
  };
}
