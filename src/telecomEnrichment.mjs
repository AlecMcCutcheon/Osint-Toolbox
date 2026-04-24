import { enrichPhoneNumber, normalizeUsPhoneDigits } from "./phoneEnrichment.mjs";
import { withEnrichmentCache } from "./enrichmentCache.mjs";

const LCG_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — NXX assignments change rarely

/**
 * Fetch NXX carrier + rate-center data from localcallingguide.com's public XML API.
 * Returns null on any network/parse failure so the caller can treat it as optional enrichment.
 * @param {string} npa 3-digit area code
 * @param {string} nxx 3-digit exchange
 * @returns {Promise<object | null>}
 */
async function fetchLcgNxxData(npa, nxx) {
  const url = `https://localcallingguide.com/xmlprefix.php?npa=${encodeURIComponent(npa)}&nxx=${encodeURIComponent(nxx)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "osint-toolbox/1.0 (research; admin@localhost)",
        Accept: "application/xml, text/xml, */*",
      },
    });
    if (!res.ok) {
      return null;
    }
    const text = await res.text();
    if (!text || /<error>/i.test(text)) {
      return null;
    }
    const tag = (name) => {
      const m = text.match(new RegExp(`<${name}>([^<]*)</${name}>`, "i"));
      return m ? m[1].trim() : null;
    };
    const companyName = tag("company-name");
    const companyType = tag("company-type");
    const ocn = tag("ocn");
    const rc = tag("rc"); // rate center city
    const region = tag("region"); // state abbreviation
    const lata = tag("lata");
    const switchCode = tag("switch");
    const ilecOcn = tag("ilec-ocn");
    const ilecName = tag("ilec-name");
    const rcLat = tag("rc-lat");
    const rcLon = tag("rc-lon");
    if (!companyName && !ocn) {
      return null;
    }
    return {
      source: "localcallingguide",
      npa,
      nxx,
      ocn: ocn || null,
      companyName: companyName || null,
      companyType: companyType || null,
      rateCenter: rc || null,
      region: region || null,
      lata: lata || null,
      switch: switchCode || null,
      ilecOcn: ilecOcn || null,
      ilecName: ilecName || null,
      rcLat: rcLat ? Number(rcLat) : null,
      rcLon: rcLon ? Number(rcLon) : null,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Cached wrapper around fetchLcgNxxData.
 * @param {string} npa
 * @param {string} nxx
 * @returns {Promise<object | null>}
 */
export async function enrichNxxCarrier(npa, nxx) {
  if (!/^\d{3}$/.test(npa) || !/^\d{3}$/.test(nxx)) {
    return null;
  }
  return withEnrichmentCache("lcg_nxx", `${npa}-${nxx}`, LCG_CACHE_TTL_MS, () =>
    fetchLcgNxxData(npa, nxx)
  );
}

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
 * Synchronous baseline telecom enrichment (NANP classification only).
 * Use enrichTelecomNumberAsync for full carrier/rate-center data.
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

/**
 * Full async telecom enrichment: NANP classification + localcallingguide carrier/rate-center lookup.
 * @param {string | null | undefined} raw
 * @returns {Promise<object | null>}
 */
export async function enrichTelecomNumberAsync(raw) {
  const base = enrichTelecomNumber(raw);
  if (!base) {
    return null;
  }
  const npa = base.nanp?.areaCode || null;
  const nxx = base.nanp?.centralOfficeCode || null;
  const nxxData = npa && nxx && !base.nanp?.specialUse ? await enrichNxxCarrier(npa, nxx) : null;
  return {
    ...base,
    nxxCarrier: nxxData || null,
  };
}
