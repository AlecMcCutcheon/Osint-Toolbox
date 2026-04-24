import * as cheerio from "cheerio";
import { normalizeUsPhoneDigits } from "./phoneEnrichment.mjs";

const BASE = "https://www.truepeoplesearch.com";

/**
 * @param {string} rawPhone
 * @returns {string}
 */
export function buildTruePeopleSearchPhoneUrl(rawPhone) {
  const norm = normalizeUsPhoneDigits(rawPhone);
  const digits = norm.digits || String(rawPhone || "").replace(/\D/g, "");
  return `${BASE}/results?PhoneNo=${encodeURIComponent(digits)}`;
}

/**
 * @param {string} html
 * @returns {boolean}
 */
export function isTruePeopleSearchBlocked(html) {
  const t = String(html || "");
  return /attention required|cloudflare|enable javascript|access denied|forbidden/i.test(t);
}

/**
 * @param {string} html
 * @returns {string | null}
 */
function detectTruePeopleSearchBlockReason(html) {
  const text = String(html || "");
  if (/attention required/i.test(text)) {
    return "attention_required";
  }
  if (/cloudflare/i.test(text)) {
    return "cloudflare";
  }
  if (/enable javascript/i.test(text)) {
    return "javascript_required";
  }
  if (/access denied/i.test(text)) {
    return "access_denied";
  }
  if (/forbidden/i.test(text)) {
    return "forbidden";
  }
  return null;
}

/**
 * @param {import('cheerio').CheerioAPI} $
 * @param {import('cheerio').Element} root
 * @returns {object}
 */
function parseResultCard($, root) {
  const text = $(root).text().replace(/\s+/g, " ").trim();
  const displayName = $(root)
    .find("a[href*='/find/person/'], a[href*='/details'], [itemprop='name'], h2, h3, h4")
    .first()
    .text()
    .replace(/\s+/g, " ")
    .trim();
  const ageMatch = text.match(/Age\s+(\d{1,3})/i);
  const phones = [];
  const seenPhones = new Set();
  const phoneMatches = text.match(/\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/g) || [];
  for (const raw of phoneMatches) {
    const norm = normalizeUsPhoneDigits(raw);
    if (!norm.dashed || seenPhones.has(norm.dashed)) {
      continue;
    }
    seenPhones.add(norm.dashed);
    phones.push({ display: raw, dashed: norm.dashed });
  }
  const addresses = [];
  $(root)
    .find("a[href*='/address-lookup'], .content-value")
    .each((_, el) => {
      const line = $(el).text().replace(/\s+/g, " ").trim();
      if (!line || !/\d/.test(line) || !/[A-Z]{2}\s+\d{5}/i.test(line)) {
        return;
      }
      if (!addresses.some((x) => x.label === line)) {
        addresses.push({ label: line, formattedFull: line });
      }
    });
  const relatives = [];
  $(root)
    .find("a[href*='/find/person/']")
    .each((_, el) => {
      const name = $(el).text().replace(/\s+/g, " ").trim();
      if (!name || name === displayName) {
        return;
      }
      if (!relatives.some((x) => x.name === name)) {
        relatives.push({ name, path: $(el).attr("href") || null });
      }
    });
  return {
    displayName: displayName || null,
    age: ageMatch ? Number(ageMatch[1]) : null,
    addresses,
    phones,
    emails: [],
    relatives,
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
 * @param {string} html
 * @param {string} searchUrl
 * @returns {object}
 */
export function parseTruePeopleSearchPhoneHtml(html, searchUrl) {
  const blockedReason = detectTruePeopleSearchBlockReason(html);
  if (blockedReason) {
    return {
      source: "truepeoplesearch",
      status: "blocked",
      reason: blockedReason,
      searchUrl,
      people: [],
      note: "Blocked by anti-bot or Cloudflare challenge.",
    };
  }
  const $ = cheerio.load(html);
  const noResults = /no results found|we could not find/i.test($.text());
  if (noResults) {
    return {
      source: "truepeoplesearch",
      status: "no_match",
      reason: "no_results_text",
      searchUrl,
      people: [],
    };
  }
  const cards = $(".card, .card-block, .detail-box, .shadow-form, [class*='result']")
    .toArray()
    .map((el) => parseResultCard($, el))
    .filter((person) => person.displayName || person.phones.length || person.addresses.length);
  const people = dedupePeople(cards);
  return {
    source: "truepeoplesearch",
    status: people.length ? "ok" : "no_match",
    reason: people.length ? null : "no_parseable_people",
    searchUrl,
    people,
  };
}
