import "./env.mjs";
import { setTimeout as delay } from "node:timers/promises";
import { addressPresentation } from "./addressFormat.mjs";
import { withEnrichmentCache } from "./enrichmentCache.mjs";
import { enrichAddressWithAssessor } from "./assessorEnrichment.mjs";
import { enrichProfilePhones } from "./phoneEnrichment.mjs";

const CENSUS_TTL_MS = Math.max(3_600_000, Number(process.env.CENSUS_CACHE_TTL_MS || 30 * 24 * 60 * 60 * 1000));
const OVERPASS_TTL_MS = Math.max(3_600_000, Number(process.env.OVERPASS_CACHE_TTL_MS || 30 * 24 * 60 * 60 * 1000));
const OVERPASS_RADIUS_METERS = Math.max(100, Number(process.env.OVERPASS_RADIUS_METERS || 500));
const OVERPASS_MAX_PLACES = Math.max(1, Number(process.env.OVERPASS_MAX_PLACES || 8));
const OVERPASS_MIN_INTERVAL_MS = Math.max(0, Number(process.env.OVERPASS_MIN_INTERVAL_MS || 1100));
const HTTP_TIMEOUT_MS = Math.max(5_000, Number(process.env.ENRICHMENT_HTTP_TIMEOUT_MS || 20_000));
const CENSUS_BENCHMARK = process.env.CENSUS_BENCHMARK || "Public_AR_Current";
const CENSUS_VINTAGE = process.env.CENSUS_VINTAGE || "Current_Current";
const OVERPASS_ENDPOINT = (process.env.OVERPASS_ENDPOINT || "https://overpass-api.de/api/interpreter").trim();
const APP_CONTACT = process.env.OSINT_CONTACT_EMAIL || process.env.OVERPASS_CONTACT_EMAIL || "";
const HTTP_USER_AGENT = process.env.ENRICHMENT_USER_AGENT || `usphonebook-flare-app/1.0${APP_CONTACT ? ` (${APP_CONTACT})` : ""}`;

let overpassQueue = Promise.resolve();
let overpassLastStart = 0;

/**
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @returns {number}
 */
function haversineMeters(lat1, lon1, lat2, lon2) {
  const r = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(r * c);
}

/**
 * @param {string} text
 * @returns {string}
 */
function titleize(text) {
  return String(text || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

/**
 * @param {string} url
 * @param {RequestInit} [init]
 * @returns {Promise<any>}
 */
async function fetchJson(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const headers = new Headers(init.headers || {});
    if (!headers.has("Accept")) {
      headers.set("Accept", "application/json");
    }
    if (!headers.has("User-Agent")) {
      headers.set("User-Agent", HTTP_USER_AGENT);
    }
    const res = await fetch(url, { ...init, headers, signal: controller.signal });
    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText}`.trim());
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {string} text
 * @returns {boolean}
 */
function looksLikeUsAddress(text) {
  const t = String(text || "").trim();
  return /\b[A-Z]{2}\b/i.test(t) && /\b\d{5}(?:-\d{4})?\b/.test(t);
}

/**
 * @param {Record<string, any>} geographies
 * @param {string} token
 * @returns {Record<string, any> | null}
 */
function firstGeo(geographies, token) {
  const want = String(token || "").toLowerCase();
  for (const [key, value] of Object.entries(geographies || {})) {
    if (!Array.isArray(value) || !value.length) {
      continue;
    }
    if (key.toLowerCase().includes(want)) {
      return value[0];
    }
  }
  return null;
}

/**
 * @param {any} responseJson
 * @returns {object | null}
 */
export function extractCensusMatch(responseJson) {
  const matches = responseJson?.result?.addressMatches;
  if (!Array.isArray(matches) || !matches.length) {
    return null;
  }
  const match = matches[0];
  const coords = match?.coordinates;
  const geographies = match?.geographies || {};
  const state = firstGeo(geographies, "states");
  const county = firstGeo(geographies, "counties");
  const tract = firstGeo(geographies, "tract");
  const block = firstGeo(geographies, "block");
  const congressionalDistrict = firstGeo(geographies, "congressional");
  const blockGeoId = String(block?.GEOID || "");
  const blockGroup = blockGeoId.length >= 12 ? blockGeoId.slice(11, 12) : null;
  return {
    matchedAddress: match?.matchedAddress || null,
    coordinates:
      coords && Number.isFinite(Number(coords.y)) && Number.isFinite(Number(coords.x))
        ? {
            lat: Number(Number(coords.y).toFixed(6)),
            lon: Number(Number(coords.x).toFixed(6)),
          }
        : null,
    tigerLineId: match?.tigerLine?.tigerLineId || null,
    tigerLineSide: match?.tigerLine?.side || null,
    censusGeography: {
      state: state
        ? {
            name: state.NAME || null,
            stusab: state.STUSAB || null,
            geoid: state.GEOID || null,
          }
        : null,
      county: county
        ? {
            name: county.NAME || null,
            geoid: county.GEOID || null,
          }
        : null,
      tract: tract
        ? {
            name: tract.NAME || null,
            geoid: tract.GEOID || null,
          }
        : null,
      block: block
        ? {
            name: block.NAME || null,
            geoid: block.GEOID || null,
            blockGroup,
          }
        : null,
      congressionalDistrict: congressionalDistrict
        ? {
            name: congressionalDistrict.NAME || null,
            geoid: congressionalDistrict.GEOID || null,
          }
        : null,
    },
  };
}

/**
 * @param {{ lat: number; lon: number }} coords
 * @returns {string}
 */
function overpassQuery(coords) {
  return `[out:json][timeout:25];\n(\n  nwr(around:${OVERPASS_RADIUS_METERS},${coords.lat},${coords.lon})[amenity];\n  nwr(around:${OVERPASS_RADIUS_METERS},${coords.lat},${coords.lon})[shop];\n  nwr(around:${OVERPASS_RADIUS_METERS},${coords.lat},${coords.lon})[office];\n  nwr(around:${OVERPASS_RADIUS_METERS},${coords.lat},${coords.lon})[tourism];\n  nwr(around:${OVERPASS_RADIUS_METERS},${coords.lat},${coords.lon})[leisure];\n  nwr(around:${OVERPASS_RADIUS_METERS},${coords.lat},${coords.lon})[public_transport];\n  nwr(around:${OVERPASS_RADIUS_METERS},${coords.lat},${coords.lon})[railway~"station|halt|tram_stop|subway_entrance"];\n  nwr(around:${OVERPASS_RADIUS_METERS},${coords.lat},${coords.lon})[highway="bus_stop"];\n);\nout center tags;`;
}

/**
 * @param {Record<string, string>} tags
 * @returns {{ category: string; subcategory: string | null }}
 */
function categoryFromTags(tags) {
  const entries = [
    ["amenity", tags.amenity],
    ["shop", tags.shop],
    ["office", tags.office],
    ["tourism", tags.tourism],
    ["leisure", tags.leisure],
    ["public_transport", tags.public_transport],
    ["railway", tags.railway],
    ["highway", tags.highway],
  ].filter(([, value]) => value);
  if (!entries.length) {
    return { category: "place", subcategory: null };
  }
  const [kind, value] = entries[0];
  return {
    category: titleize(kind),
    subcategory: value ? titleize(String(value)) : null,
  };
}

/**
 * @param {{ lat: number; lon: number }} coords
 * @param {any[]} elements
 * @param {number} limit
 * @returns {object}
 */
export function summarizeOverpassElements(coords, elements, limit = OVERPASS_MAX_PLACES) {
  const items = [];
  const seen = new Set();
  for (const el of Array.isArray(elements) ? elements : []) {
    const lat = Number(el?.lat ?? el?.center?.lat);
    const lon = Number(el?.lon ?? el?.center?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      continue;
    }
    const tags = el?.tags && typeof el.tags === "object" ? el.tags : {};
    const cat = categoryFromTags(tags);
    const name = String(tags.name || tags.brand || "").trim();
    const dedupe = `${name}|${cat.category}|${cat.subcategory || ""}|${lat.toFixed(5)}|${lon.toFixed(5)}`;
    if (seen.has(dedupe)) {
      continue;
    }
    seen.add(dedupe);
    items.push({
      name: name || (cat.subcategory ? `${cat.category}: ${cat.subcategory}` : cat.category),
      category: cat.category,
      subcategory: cat.subcategory,
      distanceMeters: haversineMeters(coords.lat, coords.lon, lat, lon),
      coordinates: {
        lat: Number(lat.toFixed(6)),
        lon: Number(lon.toFixed(6)),
      },
      osmType: el.type || null,
      osmId: el.id != null ? String(el.id) : null,
    });
  }
  items.sort((a, b) => a.distanceMeters - b.distanceMeters || a.name.localeCompare(b.name));
  return {
    radiusMeters: OVERPASS_RADIUS_METERS,
    count: items.length,
    places: items.slice(0, limit),
  };
}

/**
 * @param {{ lat: number; lon: number }} coords
 * @returns {Promise<object | null>}
 */
async function fetchNearbyPlaces(coords) {
  const rounded = `${coords.lat.toFixed(5)},${coords.lon.toFixed(5)}:${OVERPASS_RADIUS_METERS}`;
  try {
    return await withEnrichmentCache("overpass-nearby", rounded, OVERPASS_TTL_MS, async () => {
      const run = async () => {
        const waitMs = OVERPASS_MIN_INTERVAL_MS - (Date.now() - overpassLastStart);
        if (waitMs > 0) {
          await delay(waitMs);
        }
        overpassLastStart = Date.now();
        const json = await fetchJson(OVERPASS_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "text/plain;charset=UTF-8",
          },
          body: overpassQuery(coords),
        });
        const nearby = summarizeOverpassElements(coords, json?.elements || [], OVERPASS_MAX_PLACES);
        return {
          source: "overpass",
          fetchedAt: new Date().toISOString(),
          ...nearby,
        };
      };
      const task = overpassQueue.then(run, run);
      overpassQueue = task.catch(() => {});
      return task;
    });
  } catch (e) {
    return {
      source: "overpass",
      fetchedAt: new Date().toISOString(),
      radiusMeters: OVERPASS_RADIUS_METERS,
      count: 0,
      places: [],
      error: String(e?.message || e),
    };
  }
}

/**
 * @param {object} addr
 * @returns {string}
 */
function addressQuery(addr) {
  const pres = addressPresentation(addr);
  return String(pres.formattedFull || addr?.label || addr?.normalizedKey || "").trim();
}

/**
 * @param {object} addr
 * @returns {Promise<object | null>}
 */
async function fetchCensusGeocode(addr) {
  const query = addressQuery(addr);
  if (!query || !looksLikeUsAddress(query)) {
    return null;
  }
  try {
    return await withEnrichmentCache("census-geocode", query, CENSUS_TTL_MS, async () => {
      const url = new URL("https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress");
      url.searchParams.set("address", query);
      url.searchParams.set("benchmark", CENSUS_BENCHMARK);
      url.searchParams.set("vintage", CENSUS_VINTAGE);
      url.searchParams.set("format", "json");
      const json = await fetchJson(String(url));
      const match = extractCensusMatch(json);
      if (!match) {
        return {
          matchedAddress: null,
          coordinates: null,
          tigerLineId: null,
          tigerLineSide: null,
          censusGeography: null,
        };
      }
      return match;
    });
  } catch (e) {
    return {
      matchedAddress: null,
      coordinates: null,
      tigerLineId: null,
      tigerLineSide: null,
      censusGeography: null,
      error: String(e?.message || e),
    };
  }
}

/**
 * @param {object} addr
 * @returns {Promise<object>}
 */
export async function enrichAddress(addr, options = {}) {
  const base = {
    ...addr,
    ...addressPresentation(addr),
  };
  const censusGeocode = base?.censusGeocode || (await fetchCensusGeocode(base));
  let nearbyPlaces = base?.nearbyPlaces || null;
  if (!nearbyPlaces && censusGeocode?.coordinates) {
    nearbyPlaces = await fetchNearbyPlaces(censusGeocode.coordinates);
  }
  const assessorRecords = Array.isArray(base?.assessorRecords)
    ? base.assessorRecords
    : typeof options.fetchHtml === "function"
      ? await enrichAddressWithAssessor({ ...base, censusGeocode }, options.fetchHtml)
      : [];
  return {
    ...base,
    censusGeocode,
    nearbyPlaces,
    assessorRecords,
  };
}

/**
 * @param {object} profilePayload
 * @returns {Promise<object>}
 */
export async function enrichProfilePayload(profilePayload, options = {}) {
  const withPhones = enrichProfilePhones(profilePayload);
  const addresses = Array.isArray(withPhones?.addresses)
    ? await Promise.all(withPhones.addresses.map((addr) => enrichAddress(addr, options)))
    : [];
  return {
    ...withPhones,
    addresses,
  };
}
