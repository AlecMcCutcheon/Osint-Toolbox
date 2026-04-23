import "./env.mjs";
import * as cheerio from "cheerio";
import { withEnrichmentCache } from "./enrichmentCache.mjs";
import { addressPresentation } from "./addressFormat.mjs";

const ASSESSOR_TTL_MS = Math.max(3_600_000, Number(process.env.ASSESSOR_CACHE_TTL_MS || 14 * 24 * 60 * 60 * 1000));
const ASSESSOR_TIMEOUT_MS = Math.max(5_000, Number(process.env.ASSESSOR_TIMEOUT_MS || 25_000));
const MAINE_ASSESSOR_PAGE = "https://www.maine.gov/revenue/taxes/property-tax/assessor";
const MAINE_LOCAL_GOV_PAGE = "https://www1.maine.gov/portal/online_services/categories/cities.html";

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
  const raw = process.env.ASSESSOR_SOURCES_JSON || "[]";
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => x && x.key && x.searchUrlTemplate) : [];
  } catch {
    return [];
  }
}

/**
 * @param {string} template
 * @param {object} addr
 * @returns {string}
 */
function fillTemplate(template, addr) {
  const pres = addressPresentation(addr);
  const state = addr?.censusGeocode?.censusGeography?.state?.stusab || "";
  const county = addr?.censusGeocode?.censusGeography?.county?.name || "";
  const cityStateZip = String(addr?.label || pres.formattedFull || "").split(",").slice(1).join(",").trim();
  const values = {
    encodedAddress: encodeURIComponent(String(pres.formattedFull || addr?.label || "")),
    address: String(pres.formattedFull || addr?.label || ""),
    street: String(pres.streetLine || ""),
    cityStateZip,
    state,
    county,
  };
  return String(template).replace(/\{(\w+)\}/g, (_, key) => values[key] ?? "");
}

/**
 * @param {object} config
 * @param {object} addr
 * @returns {boolean}
 */
function configMatchesAddress(config, addr) {
  const state = String(addr?.censusGeocode?.censusGeography?.state?.stusab || "").toLowerCase();
  const county = String(addr?.censusGeocode?.censusGeography?.county?.name || "").toLowerCase();
  if (config.state && String(config.state).toLowerCase() !== state) {
    return false;
  }
  if (Array.isArray(config.countyIncludes) && config.countyIncludes.length) {
    return config.countyIncludes.some((token) => county.includes(String(token).toLowerCase()));
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
      const url = fillTemplate(config.searchUrlTemplate, addr);
      const cacheKey = `${config.key}:${url}`;
      return withEnrichmentCache("assessor-record", cacheKey, ASSESSOR_TTL_MS, async () => {
        const res = await fetchHtml(url, {
          maxTimeout: Number(config.maxTimeout || ASSESSOR_TIMEOUT_MS),
          disableMedia: true,
          useFlare: config.useFlare === true,
        });
        return parseGenericAssessorHtml(res.html, res.finalUrl || url, config);
      });
    })
  );
  return [...builtin, ...fetched];
}
