import "./env.mjs";
import { readFileSync } from "node:fs";
import * as cheerio from "cheerio";
import { getEnrichmentCache, withEnrichmentCache } from "./enrichmentCache.mjs";
import { addressPresentation } from "./addressFormat.mjs";

const ASSESSOR_TTL_MS = Math.max(3_600_000, Number(process.env.ASSESSOR_CACHE_TTL_MS || 14 * 24 * 60 * 60 * 1000));
const ASSESSOR_TIMEOUT_MS = Math.max(5_000, Number(process.env.ASSESSOR_TIMEOUT_MS || 25_000));
const ASSESSOR_LOG_LEVEL = String(process.env.ASSESSOR_LOG_LEVEL || "signal").trim().toLowerCase();
const ASSESSOR_LOGGING_ENABLED =
  !/^(0|false|no|off)$/i.test(String(process.env.ASSESSOR_LOGGING ?? "1")) && ASSESSOR_LOG_LEVEL !== "off";
const ASSESSOR_VERBOSE_LOGGING = ASSESSOR_LOG_LEVEL === "verbose";
const VISION_CACHE_SCHEMA_VERSION = "v2";
const MAINE_ASSESSOR_PAGE = "https://www.maine.gov/revenue/taxes/property-tax/assessor";
const MAINE_LOCAL_GOV_PAGE = "https://www1.maine.gov/portal/online_services/categories/cities.html";
let cachedAssessorSourceFilePath = null;
let cachedAssessorSourceFileConfigs = null;
let assessorTraceCounter = 0;

const MAINE_COUNTY_RESOURCES = [
  { county: "Androscoggin", urls: ["https://publicrecords.netronline.com/state/ME/county/androscoggin"] },
  {
    county: "Aroostook",
    urls: [
      "https://publicrecords.netronline.com/state/ME/county/aroostook_northern_district",
      "https://publicrecords.netronline.com/state/ME/county/aroostook_southern_district",
    ],
  },
  { county: "Cumberland", urls: ["https://publicrecords.netronline.com/state/ME/county/cumberland"] },
  { county: "Franklin", urls: ["https://publicrecords.netronline.com/state/ME/county/franklin"] },
  { county: "Hancock", urls: ["https://publicrecords.netronline.com/state/ME/county/hancock"] },
  { county: "Kennebec", urls: ["https://publicrecords.netronline.com/state/ME/county/kennebec"] },
  { county: "Knox", urls: ["https://publicrecords.netronline.com/state/ME/county/knox"] },
  { county: "Lincoln", urls: ["https://publicrecords.netronline.com/state/ME/county/lincoln"] },
  {
    county: "Oxford",
    urls: [
      "https://publicrecords.netronline.com/state/ME/county/oxford_eastern",
      "https://publicrecords.netronline.com/state/ME/county/oxford_western",
    ],
  },
  { county: "Penobscot", urls: ["https://publicrecords.netronline.com/state/ME/county/penobscot"] },
  { county: "Piscataquis", urls: ["https://publicrecords.netronline.com/state/ME/county/piscataquis"] },
  { county: "Sagadahoc", urls: ["https://publicrecords.netronline.com/state/ME/county/sagadahoc"] },
  { county: "Somerset", urls: ["https://publicrecords.netronline.com/state/ME/county/somerset"] },
  { county: "Waldo", urls: ["https://publicrecords.netronline.com/state/ME/county/waldo"] },
  { county: "Washington", urls: ["https://publicrecords.netronline.com/state/ME/county/washington"] },
  { county: "York", urls: ["https://publicrecords.netronline.com/state/ME/county/york"] },
];

/**
 * @param {string} countyName
 * @returns {string}
 */
function normalizeCountyName(countyName) {
  return String(countyName || "")
    .toLowerCase()
    .replace(/\bcounty\b/g, " ")
    .replace(/[^a-z]+/g, " ")
    .trim();
}

/**
 * @param {object} addr
 * @returns {object[]}
 */
export function getBuiltinAssessorReferences(addr) {
  const state = String(addr?.censusGeocode?.censusGeography?.state?.stusab || "").toUpperCase();
  if (state !== "ME") {
    return [];
  }
  const countyRaw = String(addr?.censusGeocode?.censusGeography?.county?.name || "");
  const county = normalizeCountyName(countyRaw);
  if (!county) {
    return [];
  }
  const hit = MAINE_COUNTY_RESOURCES.find((x) => normalizeCountyName(x.county) === county);
  if (!hit) {
    return [];
  }
  const resourceLinks = [
    ...hit.urls.map((url, index) => ({
      label:
        hit.urls.length > 1
          ? `${hit.county} County NETR directory ${index + 1}`
          : `${hit.county} County NETR directory`,
      url,
      kind: "county_directory",
    })),
    {
      label: "Maine Assessor's Page",
      url: MAINE_ASSESSOR_PAGE,
      kind: "state_assessor_reference",
    },
    {
      label: "Maine cities & counties directory",
      url: MAINE_LOCAL_GOV_PAGE,
      kind: "municipal_directory",
    },
  ];
  return [
    {
      source: `maine-county-reference:${normalizeCountyName(hit.county).replace(/\s+/g, "-")}`,
      name: `${hit.county} County Maine property resources`,
      status: "reference",
      state: "ME",
      county: `${hit.county} County`,
      url: hit.urls[0],
      ownerNames: [],
      resourceLinks,
      note:
        "Maine property tax assessment records are typically maintained by municipalities; county pages are strongest for recorded documents, registry, and GIS entry points.",
    },
  ];
}

/**
 * @returns {Array<object>}
 */
function getAssessorConfigs() {
  const fromEnv = parseAssessorConfigJson(process.env.ASSESSOR_SOURCES_JSON || "[]");
  const filePath = String(process.env.ASSESSOR_SOURCES_FILE || "").trim();
  const fromFile = filePath ? loadAssessorConfigsFromFile(filePath) : [];
  return [...fromFile, ...fromEnv];
}

/**
 * @param {string} raw
 * @returns {Array<object>}
 */
function parseAssessorConfigJson(raw) {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter(
          (x) =>
            x &&
            x.key &&
            ((x.platform === "vision" && (x.baseUrl || x.visionBaseUrl)) || x.searchUrlTemplate)
        )
      : [];
  } catch {
    return [];
  }
}

/**
 * @param {string} filePath
 * @returns {Array<object>}
 */
function loadAssessorConfigsFromFile(filePath) {
  if (cachedAssessorSourceFilePath === filePath && cachedAssessorSourceFileConfigs) {
    return cachedAssessorSourceFileConfigs;
  }
  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed = parseAssessorConfigJson(raw);
    cachedAssessorSourceFilePath = filePath;
    cachedAssessorSourceFileConfigs = parsed;
    return parsed;
  } catch {
    cachedAssessorSourceFilePath = filePath;
    cachedAssessorSourceFileConfigs = [];
    return [];
  }
}

/**
 * @param {object} addr
 * @returns {{ formattedFull: string; street: string; city: string; citySlug: string; state: string; county: string; zip: string }}
 */
function addressTemplateValues(addr) {
  const pres = addressPresentation(addr);
  const formattedFull = String(pres.formattedFull || addr?.label || "").trim();
  const parts = formattedFull.split(",").map((part) => part.trim()).filter(Boolean);
  const street = String(pres.streetLine || "").trim();
  const city = parts.length >= 2 ? parts[1] : "";
  const stateZip = parts.length >= 3 ? parts[2] : "";
  const stateZipMatch = stateZip.match(/\b([A-Z]{2})\b\s*(\d{5}(?:-\d{4})?)?/i);
  const state = String(addr?.censusGeocode?.censusGeography?.state?.stusab || stateZipMatch?.[1] || "").trim();
  const county = String(addr?.censusGeocode?.censusGeography?.county?.name || "").trim();
  const zip = String(stateZipMatch?.[2] || "").trim();
  const citySlug = city.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return {
    formattedFull,
    street,
    city,
    citySlug,
    state,
    county,
    zip,
  };
}

/**
 * @param {string} template
 * @param {object} addr
 * @returns {string}
 */
function fillTemplate(template, addr) {
  const pres = addressPresentation(addr);
  const hints = addressTemplateValues(addr);
  const cityStateZip = hints.formattedFull.split(",").slice(1).join(",").trim();
  const values = {
    encodedAddress: encodeURIComponent(String(hints.formattedFull || addr?.label || "")),
    address: String(hints.formattedFull || addr?.label || ""),
    street: String(hints.street || pres.streetLine || ""),
    encodedStreet: encodeURIComponent(String(hints.street || pres.streetLine || "")),
    city: hints.city,
    citySlug: hints.citySlug,
    encodedCity: encodeURIComponent(String(hints.city || "")),
    cityStateZip,
    state: hints.state,
    county: hints.county,
    zip: hints.zip,
  };
  return String(template).replace(/\{(\w+)\}/g, (_, key) => values[key] ?? "");
}

/**
 * @param {object} config
 * @param {object} addr
 * @returns {boolean}
 */
function configMatchesAddress(config, addr) {
  const hints = addressTemplateValues(addr);
  const state = String(hints.state || "").toLowerCase();
  const county = String(hints.county || "").toLowerCase();
  const city = String(hints.city || "").toLowerCase();
  if (config.state && String(config.state).toLowerCase() !== state) {
    return false;
  }
  if (Array.isArray(config.countyIncludes) && config.countyIncludes.length) {
    if (!config.countyIncludes.some((token) => county.includes(String(token).toLowerCase()))) {
      return false;
    }
  }
  const cityTokens = [
    ...(Array.isArray(config.cityIncludes) ? config.cityIncludes : []),
    ...(Array.isArray(config.townIncludes) ? config.townIncludes : []),
  ];
  if (cityTokens.length) {
    if (!cityTokens.some((token) => city.includes(String(token).toLowerCase()))) {
      return false;
    }
  }
  return true;
}

/**
 * @param {string} label
 * @returns {string}
 */
function normalizeLabel(label) {
  return String(label || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * @param {string} text
 * @returns {string}
 */
function normalizeAddressMatchText(text) {
  return String(text || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\bSTREET\b/g, "ST")
    .replace(/\bAVENUE\b/g, "AVE")
    .replace(/\bROAD\b/g, "RD")
    .replace(/\bBOULEVARD\b/g, "BLVD")
    .replace(/\bDRIVE\b/g, "DR")
    .replace(/\bLANE\b/g, "LN")
    .replace(/\bCOURT\b/g, "CT")
    .replace(/\bPLACE\b/g, "PL")
    .replace(/\bTERRACE\b/g, "TER")
    .replace(/\s+/g, " ")
    .trim();
}

function nextAssessorTraceId() {
  assessorTraceCounter += 1;
  return `${Date.now().toString(36)}-${assessorTraceCounter.toString(36)}`;
}

function summarizeAssessorUrl(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}${parsed.search}`;
  } catch {
    return String(url || "");
  }
}

function formatAssessorLogValue(value) {
  if (value == null) {
    return null;
  }
  if (typeof value === "string") {
    return /\s/.test(value) ? JSON.stringify(value) : value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function createAssessorTrace(config, addr) {
  const hints = addressTemplateValues(addr);
  return {
    id: nextAssessorTraceId(),
    source: String(config?.key || "assessor"),
    city: hints.city || null,
    street: hints.street || hints.formattedFull || String(addr?.label || "") || null,
  };
}

function requestedAssessorRecord(addr) {
  const hints = addressTemplateValues(addr);
  return String(hints.street || hints.formattedFull || addr?.label || "").trim() || null;
}

function logAssessor(trace, message, details = {}) {
  if (!ASSESSOR_LOGGING_ENABLED || !trace) {
    return;
  }
  const merged = {
    city: trace.city,
    street: trace.street,
    ...details,
  };
  const suffix = Object.entries(merged)
    .filter(([, value]) => value != null && value !== "")
    .map(([key, value]) => `${key}=${formatAssessorLogValue(value)}`)
    .join(" ");
  console.log(`[assessor ${trace.source}:${trace.id}] ${message}${suffix ? ` ${suffix}` : ""}`);
}

function logAssessorVerbose(trace, message, details = {}) {
  if (!ASSESSOR_VERBOSE_LOGGING) {
    return;
  }
  logAssessor(trace, message, details);
}

function stripVisionHeadingActionText(text) {
  return String(text || "")
    .replace(/\bSales\b\s*\bPrint\b\s*\bMap It\b$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function requestedAddressConfidence(addr, parcel) {
  const hints = addressTemplateValues(addr);
  const requestedStreet = normalizeAddressMatchText(hints.street || hints.formattedFull || addr?.label || "");
  const requestedCity = normalizeAddressMatchText(hints.city || "");
  const candidates = [parcel?.matchedAddress, parcel?.mailingAddress]
    .filter(Boolean)
    .map((value) => normalizeAddressMatchText(value));
  const streetMatched = candidates.some(
    (value) => value === requestedStreet || value.startsWith(requestedStreet)
  );
  const cityMatched = !requestedCity || candidates.some((value) => value.includes(requestedCity));
  return {
    requestedStreet,
    requestedCity,
    streetMatched,
    cityMatched,
    accepted: streetMatched && cityMatched,
  };
}

/**
 * @param {string} html
 * @param {string} searchUrl
 * @param {string} targetStreet
 * @returns {{ parcelUrl: string | null; matchedAddress: string | null; resultCount: number; matchType: string | null }}
 */
function parseVisionSearchResults(html, searchUrl, targetStreet) {
  const $ = cheerio.load(html);
  const rows = [];
  $("table a[href*='Parcel.aspx?pid=']").each((_, el) => {
    const href = $(el).attr("href");
    const address = $(el).text().replace(/\s+/g, " ").trim();
    if (!href || !address) {
      return;
    }
    rows.push({
      address,
      parcelUrl: new URL(href, searchUrl).toString(),
    });
  });
  if (!rows.length) {
    return { parcelUrl: null, matchedAddress: null, resultCount: 0, matchType: null };
  }
  const want = normalizeAddressMatchText(targetStreet);
  const exact = rows.find((row) => normalizeAddressMatchText(row.address) === want);
  if (exact) {
    return { parcelUrl: exact.parcelUrl, matchedAddress: exact.address, resultCount: rows.length, matchType: "exact" };
  }
  const prefix = rows.find((row) => normalizeAddressMatchText(row.address).startsWith(want));
  if (prefix) {
    return { parcelUrl: prefix.parcelUrl, matchedAddress: prefix.address, resultCount: rows.length, matchType: "prefix" };
  }
  return { parcelUrl: null, matchedAddress: null, resultCount: rows.length, matchType: null };
}

/**
 * @param {import('cheerio').CheerioAPI} $
 * @param {string} captionText
 * @returns {import('cheerio').Cheerio<any>}
 */
function visionTableAfterCaption($, captionText) {
  return $("caption, .sub-header, h3, h4")
    .filter((_, el) => $(el).text().replace(/\s+/g, " ").trim().toLowerCase() === captionText.toLowerCase())
    .first()
    .closest("table, div");
}

/**
 * @param {import('cheerio').CheerioAPI} $
 * @param {string} label
 * @returns {string | null}
 */
function findVisionLabeledValue($, label) {
  const want = normalizeLabel(label);
  let match = null;
  $("tr, dt, td, th, div").each((_, el) => {
    if (match) {
      return;
    }
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (!text) {
      return;
    }
    const cells = $(el).find("th, td");
    if (cells.length >= 2) {
      const left = normalizeLabel($(cells[0]).text());
      if (left === want) {
        const value = $(cells[1]).text().replace(/\s+/g, " ").trim();
        if (value) {
          match = value;
        }
      }
      return;
    }
    if (text.includes(":")) {
      const [left, ...rest] = text.split(":");
      if (normalizeLabel(left) === want) {
        const value = rest.join(":").trim();
        if (value) {
          match = value;
        }
      }
    }
  });
  return match;
}

/**
 * @param {string} html
 * @param {string} url
 * @param {object} config
 * @returns {object}
 */
function parseVisionParcelHtml(html, url, config) {
  const $ = cheerio.load(html);
  const title = stripVisionHeadingActionText($("h2").first().text());
  const owner = findVisionLabeledValue($, "owner") || findVisionLabeledValue($, "owner of record") || null;
  const acct = findVisionLabeledValue($, "acct#") || null;
  const pid = findVisionLabeledValue($, "pid") || new URL(url).searchParams.get("pid") || null;
  const mailingAddress = findVisionLabeledValue($, "address") || null;
  const parcelId = findVisionLabeledValue($, "mblu") || acct || pid;
  const marketValue = findVisionLabeledValue($, "total market value") || null;
  const currentValueTable = visionTableAfterCaption($, "Assessment");
  const currentValueRow = currentValueTable.find("tr").filter((_, el) => $(el).find("td").length >= 4).first();
  const currentValueCells = currentValueRow.find("td");
  const assessedValue =
    currentValueCells.length >= 4
      ? $(currentValueCells[currentValueCells.length - 1]).text().replace(/\s+/g, " ").trim() || marketValue
      : marketValue;
  const yearBuilt = findVisionLabeledValue($, "year built") || null;
  const squareFeet = findVisionLabeledValue($, "living area") || findVisionLabeledValue($, "building area") || null;
  const bedrooms = findVisionLabeledValue($, "total bedrms") || null;
  const bathrooms = findVisionLabeledValue($, "total baths") || null;
  const propertyType =
    findVisionLabeledValue($, "style") ||
    findVisionLabeledValue($, "bldg use") ||
    findVisionLabeledValue($, "model") ||
    null;
  const blocked = /captcha|access denied|forbidden/i.test($.text());
  const hasStructuredData = Boolean(owner || parcelId || assessedValue || marketValue || propertyType || yearBuilt);
  return {
    source: config.key,
    name: config.name || config.key,
    status: blocked ? "blocked" : hasStructuredData ? "ok" : "no_match",
    url,
    matchedAddress: title || null,
    ownerNames: owner ? [owner] : [],
    parcelId,
    mailingAddress,
    assessedValue,
    marketValue,
    propertyType,
    yearBuilt,
    squareFeet,
    bedrooms,
    bathrooms,
  };
}

/**
 * @param {string} url
 * @param {number} timeoutMs
 * @returns {Promise<string>}
 */
async function fetchAssessorPage(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {string} url
 * @param {URLSearchParams} body
 * @param {number} timeoutMs
 * @returns {Promise<string>}
 */
async function postAssessorForm(url, body, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {string} html
 * @returns {URLSearchParams}
 */
function extractAspNetHiddenFields(html) {
  const $ = cheerio.load(html);
  const params = new URLSearchParams();
  $("input[type='hidden'][name]").each((_, el) => {
    const name = $(el).attr("name");
    if (!name) {
      return;
    }
    params.set(name, $(el).attr("value") || "");
  });
  return params;
}

/**
 * @param {object} config
 * @param {object} addr
 * @returns {Promise<object>}
 */
async function fetchVisionAssessorRecord(config, addr) {
  const trace = createAssessorTrace(config, addr);
  const hints = addressTemplateValues(addr);
  const baseUrl = String(config.baseUrl || config.visionBaseUrl || "").trim();
  if (!baseUrl) {
    throw new Error(`Vision assessor config ${config.key} is missing baseUrl`);
  }
  const searchUrl = new URL("Search.aspx", baseUrl).toString();
  logAssessorVerbose(trace, "vision search started", {
    searchUrl: summarizeAssessorUrl(searchUrl),
    timeoutMs: Number(config.maxTimeout || ASSESSOR_TIMEOUT_MS),
  });
  const searchText = String(hints.street || hints.formattedFull || addr?.label || "").trim();
  try {
    const searchPageHtml = await fetchAssessorPage(searchUrl, Number(config.maxTimeout || ASSESSOR_TIMEOUT_MS));
    const formData = extractAspNetHiddenFields(searchPageHtml);
    formData.set("ctl00$MainContent$txtSearch", searchText);
    formData.set("ctl00$MainContent$ddlSearchSource", String(config.searchSource ?? 0));
    formData.set("ctl00$MainContent$btnSubmit", "Search");
    formData.set("ctl00$MainContent$txtSearchAddress", "");
    const resultHtml = await postAssessorForm(
      searchUrl,
      formData,
      Number(config.maxTimeout || ASSESSOR_TIMEOUT_MS)
    );
    const { parcelUrl, matchedAddress, resultCount, matchType } = parseVisionSearchResults(
      resultHtml,
      searchUrl,
      searchText
    );
    logAssessorVerbose(trace, "vision search completed", {
      searchUrl: summarizeAssessorUrl(searchUrl),
      resultCount,
      matchType,
      matchedAddress,
      parcelUrl: parcelUrl ? summarizeAssessorUrl(parcelUrl) : null,
    });
    if (!parcelUrl) {
      logAssessor(trace, "vision no_match", {
        reason: "no_confident_search_match",
        searchUrl: summarizeAssessorUrl(searchUrl),
        resultCount,
      });
      return {
        source: config.key,
        name: config.name || config.key,
        status: "no_match",
        url: searchUrl,
        ownerNames: [],
        note: `No Vision parcel results for ${searchText}`,
      };
    }
    const parcelHtml = await fetchAssessorPage(parcelUrl, Number(config.maxTimeout || ASSESSOR_TIMEOUT_MS));
    const parsed = parseVisionParcelHtml(parcelHtml, parcelUrl, config);
    if (matchedAddress && !parsed.matchedAddress) {
      parsed.matchedAddress = matchedAddress;
    }
    const confidence = requestedAddressConfidence(addr, parsed);
    logAssessorVerbose(trace, "vision parcel fetched", {
      parcelUrl: summarizeAssessorUrl(parcelUrl),
      parcelMatchedAddress: parsed.matchedAddress || null,
      mailingAddress: parsed.mailingAddress || null,
      owner: parsed.ownerNames?.[0] || null,
      parcelId: parsed.parcelId || null,
      accepted: confidence.accepted,
    });
    if (!confidence.accepted) {
      logAssessor(trace, "vision no_match", {
        reason: "address_confidence_failed",
        searchUrl: summarizeAssessorUrl(searchUrl),
        resultCount,
        candidateAddress: parsed.matchedAddress || null,
        candidateMailingAddress: parsed.mailingAddress || null,
      });
      return {
        source: config.key,
        name: config.name || config.key,
        status: "no_match",
        url: searchUrl,
        ownerNames: [],
        note: `Vision parcel candidate did not confidently match ${searchText}`,
      };
    }
    logAssessor(trace, "vision ok", {
      parcelUrl: summarizeAssessorUrl(parcelUrl),
      matchedAddress: parsed.matchedAddress || null,
      owner: parsed.ownerNames?.[0] || null,
      assessedValue: parsed.assessedValue || null,
    });
    return parsed;
  } catch (error) {
    logAssessor(trace, "vision error", {
      searchUrl: summarizeAssessorUrl(searchUrl),
      error: String(error?.message || error),
    });
    throw error;
  }
}

/**
 * @param {import('cheerio').CheerioAPI} $
 * @returns {Record<string, string>}
 */
function extractLabeledFields($) {
  const fields = {};
  $("table tr, dl div, dl dt, dl dd, .property-details li, .details li").each((_, el) => {
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (!text || text.length < 4) {
      return;
    }
    if (text.includes(":")) {
      const [label, ...rest] = text.split(":");
      const value = rest.join(":").trim();
      if (label && value) {
        fields[normalizeLabel(label)] = value;
      }
    }
    const cells = $(el).find("th, td");
    if (cells.length >= 2) {
      const label = $(cells[0]).text().replace(/\s+/g, " ").trim();
      const value = $(cells[1]).text().replace(/\s+/g, " ").trim();
      if (label && value) {
        fields[normalizeLabel(label)] = value;
      }
    }
  });
  return fields;
}

/**
 * @param {string} html
 * @param {string} url
 * @param {object} config
 * @returns {object}
 */
export function parseGenericAssessorHtml(html, url, config) {
  const $ = cheerio.load(html);
  const fields = extractLabeledFields($);
  const jsonLd = [];
  $("script[type='application/ld+json']").each((_, el) => {
    try {
      const parsed = JSON.parse($(el).text());
      jsonLd.push(parsed);
    } catch {
      // ignore
    }
  });
  const findField = (...candidates) => {
    for (const key of candidates) {
      if (fields[normalizeLabel(key)]) {
        return fields[normalizeLabel(key)];
      }
    }
    return null;
  };
  const blocked = /captcha|access denied|forbidden/i.test($.text());
  const hasStructuredData = Object.keys(fields).length > 0 || jsonLd.length > 0;
  return {
    source: config.key,
    name: config.name || config.key,
    status: blocked ? "blocked" : hasStructuredData ? "ok" : "no_match",
    url,
    ownerNames: [findField("owner", "owner name", "property owner", "taxpayer")].filter(Boolean),
    parcelId: findField("parcel id", "parcel number", "apn", "parcel"),
    mailingAddress: findField("mailing address", "owner address", "tax mailing address"),
    assessedValue: findField("assessed value", "total value", "appraised value"),
    marketValue: findField("market value", "just value"),
    propertyType: findField("property type", "use code", "land use"),
    yearBuilt: findField("year built"),
    squareFeet: findField("square feet", "living area", "building area"),
    bedrooms: findField("bedrooms"),
    bathrooms: findField("bathrooms", "baths"),
    jsonLd,
  };
}

/**
 * @param {object} addr
 * @param {(url: string, options?: { maxTimeout?: number; disableMedia?: boolean; useFlare?: boolean }) => Promise<{ html: string; finalUrl?: string }>} fetchHtml
 * @returns {Promise<object[]>}
 */
export async function enrichAddressWithAssessor(addr, fetchHtml) {
  const builtin = getBuiltinAssessorReferences(addr);
  const configs = getAssessorConfigs().filter((config) => configMatchesAddress(config, addr));
  if (!configs.length) {
    return builtin;
  }
  const fetched = await Promise.all(
    configs.map(async (config) => {
      const platform = String(config.platform || "").trim().toLowerCase();
      const trace = createAssessorTrace(config, addr);
      const attemptedRecord = requestedAssessorRecord(addr);
      const cacheTarget =
        platform === "vision"
          ? `${VISION_CACHE_SCHEMA_VERSION}:${config.key}:${String(config.baseUrl || config.visionBaseUrl || "")}:${addressTemplateValues(addr).street}`
          : fillTemplate(config.searchUrlTemplate, addr);
      const cacheKey = `${config.key}:${cacheTarget}`;
      const cached = getEnrichmentCache("assessor-record", cacheKey);
      logAssessor(trace, cached != null ? "assessor cache hit" : "assessor cache miss", {
        status: cached?.status || null,
      });
      return withEnrichmentCache("assessor-record", cacheKey, ASSESSOR_TTL_MS, async () => {
        if (platform === "vision") {
          return fetchVisionAssessorRecord(config, addr);
        }
        const url = fillTemplate(config.searchUrlTemplate, addr);
        logAssessor(trace, "assessor attempt", {
          site: summarizeAssessorUrl(url),
          record: attemptedRecord,
          requestedEngine: config.useFlare === true ? "flare" : "direct",
        });
        try {
          const res = await fetchHtml(url, {
            maxTimeout: Number(config.maxTimeout || ASSESSOR_TIMEOUT_MS),
            disableMedia: true,
            useFlare: config.useFlare === true,
            sourceId: config.key,
          });
          const parsed = parseGenericAssessorHtml(res.html, res.finalUrl || url, config);
          if (parsed.status === "ok") {
            logAssessor(trace, "assessor ok", {
              site: summarizeAssessorUrl(res.finalUrl || url),
              engine: res.engine || null,
              parcelId: parsed.parcelId || null,
              owner: parsed.ownerNames?.[0] || null,
            });
          } else if (parsed.status !== "reference") {
            logAssessor(trace, "assessor no_match", {
              site: summarizeAssessorUrl(res.finalUrl || url),
              engine: res.engine || null,
              reason: parsed.status,
            });
          }
          return parsed;
        } catch (error) {
          logAssessor(trace, "assessor error", {
            site: summarizeAssessorUrl(url),
            engine: error?.fetchEngine || error?.protectedFetchEngine || error?.requestedEngine || null,
            reason: String(error?.message || error),
          });
          throw error;
        }
      });
    })
  );
  return [...builtin, ...fetched];
}
