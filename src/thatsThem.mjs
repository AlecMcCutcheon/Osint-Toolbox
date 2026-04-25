import * as cheerio from "cheerio";
import { normalizeUsPhoneDigits } from "./phoneEnrichment.mjs";

const BASE = "https://thatsthem.com";

/**
 * @param {string} rawPhone
 * @returns {string[]}
 */
export function buildThatsThemPhoneCandidateUrls(rawPhone) {
  const norm = normalizeUsPhoneDigits(rawPhone);
  const digits = norm.digits || String(rawPhone || "").replace(/\D/g, "");
  const dashed = norm.dashed || rawPhone;
  return [
    `${BASE}/reverse-phone-lookup/${encodeURIComponent(digits)}`,
    `${BASE}/reverse-phone-lookup/${encodeURIComponent(dashed)}`,
    `${BASE}/reverse-phone-lookup?phone=${encodeURIComponent(digits)}`,
    `${BASE}/reverse-phone-lookup?Phone=${encodeURIComponent(digits)}`,
  ];
}

/**
 * @param {string} html
 * @returns {boolean}
 */
export function isThatsThemBlocked(html) {
  const t = String(html || "");
  return /quick humanity check|captcha|recaptcha|odd traffic/i.test(t);
}

/**
 * @param {string} html
 * @returns {string | null}
 */
function detectThatsThemBlockReason(html) {
  const text = String(html || "");
  if (/quick humanity check/i.test(text)) {
    return "humanity_check";
  }
  if (/recaptcha/i.test(text)) {
    return "recaptcha";
  }
  if (/captcha/i.test(text)) {
    return "captcha";
  }
  if (/odd traffic/i.test(text)) {
    return "odd_traffic";
  }
  return null;
}

/**
 * @param {string} html
 * @returns {boolean}
 */
export function isThatsThemNotFound(html) {
  const t = String(html || "").replace(/\s+/g, " ").trim();
  return /404\s*-\s*page not found|page not found\s*:'\(|page you requested (?:could not|cannot) be found|sorry, that page (?:does not exist|could not be found)/i.test(
    t
  );
}

/**
 * @param {import('cheerio').CheerioAPI} $
 * @param {import('cheerio').Element} root
 * @returns {object}
 */
function parsePersonCard($, root) {
  const text = $(root).text().replace(/\s+/g, " ").trim();
  const displayName = $(root)
    .find("h1, h2, h3, [itemprop='name'], .name, .fullname")
    .first()
    .text()
    .replace(/\s+/g, " ")
    .trim();
  const ageMatch = text.match(/\bAge\b[:\s]+(\d{1,3}|\d{2}-\d{2}|\d{2}\+)/i);
  const phones = [];
  const phoneMatches = text.match(/\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/g) || [];
  for (const raw of phoneMatches) {
    const norm = normalizeUsPhoneDigits(raw);
    if (!norm.dashed || phones.some((x) => x.dashed === norm.dashed)) {
      continue;
    }
    phones.push({
      display: raw,
      dashed: norm.dashed,
      lineType: /mobile/i.test(text) ? "mobile" : /landline/i.test(text) ? "landline" : null,
      serviceProvider: text.match(/(?:AT&T|Verizon|T-Mobile|Sprint|Comcast|Spectrum|CenturyLink|Cox)/i)?.[0] || null,
    });
  }
  const emails = Array.from(new Set(text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []));
  const addresses = [];
  $(root)
    .find("address, .address, [class*='address']")
    .each((_, el) => {
      const line = $(el).text().replace(/\s+/g, " ").trim();
      if (!line || !/\d/.test(line)) {
        return;
      }
      if (!addresses.some((x) => x.label === line)) {
        addresses.push({ label: line, formattedFull: line });
      }
    });
  return {
    displayName: displayName || null,
    age: ageMatch ? String(ageMatch[1]) : null,
    addresses,
    phones,
    emails,
    relatives: [],
  };
}

/**
 * @param {object[]} people
 * @returns {object[]}
 */
function dedupePeople(people) {
  const byKey = new Map();
  for (const person of Array.isArray(people) ? people : []) {
    const key = [
      String(person.displayName || "").trim().toLowerCase(),
      (person.phones || []).map((x) => x.dashed || x.display || "").sort().join("|"),
      (person.addresses || []).map((x) => x.label || x.formattedFull || "").sort().join("|"),
      (person.emails || []).slice().sort().join("|"),
    ].join("::");
    if (!key.replace(/[:|]/g, "")) {
      continue;
    }
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        ...person,
        phones: [...(person.phones || [])],
        addresses: [...(person.addresses || [])],
        emails: [...(person.emails || [])],
        relatives: [...(person.relatives || [])],
      });
      continue;
    }
    for (const field of ["phones", "addresses", "emails", "relatives"]) {
      for (const item of person[field] || []) {
        const exists = existing[field].some((x) => JSON.stringify(x) === JSON.stringify(item));
        if (!exists) {
          existing[field].push(item);
        }
      }
    }
    if (!existing.displayName && person.displayName) {
      existing.displayName = person.displayName;
    }
    if (existing.age == null && person.age != null) {
      existing.age = person.age;
    }
  }
  return Array.from(byKey.values());
}

/**
 * @param {string} nameSlug - e.g. "kory-drake"
 * @param {string | null} city - e.g. "Waterville"
 * @param {string | null} stateAbbrev - e.g. "ME"
 * @returns {string}
 */
export function buildThatsThemNameUrl(nameSlug, city, stateAbbrev) {
  const params = new URLSearchParams();
  if (city) params.set("city", city.trim());
  if (stateAbbrev) params.set("state", stateAbbrev);
  const qs = params.toString();
  return `${BASE}/name/${encodeURIComponent(nameSlug)}${qs ? `?${qs}` : ""}`;
}

/**
 * Parse a ThatsThem name result page (same card format as phone result pages).
 * @param {string} html
 * @param {string} searchUrl
 * @returns {object}
 */
export function parseThatsThemNameHtml(html, searchUrl) {
  const result = parseThatsThemPhoneHtml(html, searchUrl);
  result.searchType = "name";
  return result;
}

/**
 * @param {string} html
 * @param {string} searchUrl
 * @returns {object}
 */
export function parseThatsThemPhoneHtml(html, searchUrl) {
  const blockedReason = detectThatsThemBlockReason(html);
  if (blockedReason) {
    return {
      source: "thatsthem",
      status: "blocked",
      reason: blockedReason,
      searchUrl,
      people: [],
      note: "Blocked by humanity/captcha challenge.",
    };
  }
  if (isThatsThemNotFound(html)) {
    return {
      source: "thatsthem",
      status: "no_match",
      reason: "not_found_page",
      searchUrl,
      people: [],
      note: "That’s Them returned a not-found page for this lookup candidate.",
    };
  }
  const $ = cheerio.load(html);
  const noResults = /no results found|sorry, nothing matched|0 results/i.test($.text());
  if (noResults) {
    return {
      source: "thatsthem",
      status: "no_match",
      reason: "no_results_text",
      searchUrl,
      people: [],
    };
  }
  const specificCardEls = $(".record, .person, .card, .contact-card, .result")
    .filter((_, el) => $(el).find("h1, h2, h3, [itemprop='name'], .name, .fullname").length > 0)
    .toArray();
  const fallbackEls = specificCardEls.length
    ? []
    : $("main")
        .filter((_, el) => $(el).find(".record, .person, .card, .contact-card, .result").length === 0)
        .toArray();
  const cards = (specificCardEls.length ? specificCardEls : fallbackEls)
    .map((el) => parsePersonCard($, el))
    .filter((person) => person.displayName || person.phones.length || person.addresses.length || person.emails.length);
  const people = dedupePeople(cards);
  return {
    source: "thatsthem",
    status: people.length ? "ok" : "no_match",
    reason: people.length ? null : "no_parseable_people",
    searchUrl,
    people,
  };
}
