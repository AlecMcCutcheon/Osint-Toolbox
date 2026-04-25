import * as cheerio from "cheerio";
import { normalizeUsPhoneDigits } from "./phoneEnrichment.mjs";

const BASE = "https://www.fastpeoplesearch.com";

function collapseText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanBulletSeparatedValues(value, exclude = new Set()) {
  const seen = new Set();
  return collapseText(value)
    .split(/\s*[•·]\s*/)
    .map((part) => collapseText(part))
    .filter((part) => {
      if (!part || exclude.has(part)) {
        return false;
      }
      const key = part.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function uniqueStrings(values) {
  const seen = new Set();
  const out = [];
  for (const value of Array.isArray(values) ? values : []) {
    const text = collapseText(value);
    if (!text) {
      continue;
    }
    const key = text.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(text);
  }
  return out;
}

function normalizeFastPeopleSearchAddressLabel(value) {
  return collapseText(value)
    .replace(/\s*,\s*/g, ", ")
    .replace(/\b([A-Za-z .'-]+)\s+([A-Z]{2})\s+(\d{5}(?:-\d{4})?)\b/g, "$1, $2 $3")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeFastPeopleSearchMultilineAddress($el) {
  const html = String($el.html() || "").replace(/<br\s*\/?>/gi, ", ");
  const $tmp = cheerio.load(`<div>${html}</div>`);
  return normalizeFastPeopleSearchAddressLabel($tmp("div").text());
}

function titleMetadataFromFastPeopleSearch($) {
  const titleText = collapseText($("title").first().text());
  if (!titleText) {
    return { displayName: null, age: null, location: null };
  }
  const explicit = titleText.match(/^(.+?)\((\d{1,3})\)\s+(.+?)\s*\|\s*public records profile/i);
  if (explicit) {
    return {
      displayName: collapseText(explicit[1]) || null,
      age: Number(explicit[2]),
      location: collapseText(explicit[3]) || null,
    };
  }
  const fallback = titleText.match(/^(.+?)\s+in\s+(.+?)\s*\|/i);
  if (fallback) {
    return {
      displayName: collapseText(fallback[1]) || null,
      age: null,
      location: collapseText(fallback[2]) || null,
    };
  }
  return { displayName: null, age: null, location: null };
}

function looksLikeFastPeopleSearchDetailPath(href) {
  return /^\/[^/?#]+_id_[A-Za-z0-9-]+(?:[?#].*)?$/i.test(String(href || "").trim());
}

function parseFastPeopleSearchHeading($root) {
  const headingLink = $root.find("h1 a[href], h2 a[href], h3 a[href], .card-title a[href]").first();
  const detailButton = $root.find("a.link-to-details[href]").first();
  const rawHref =
    detailButton.attr("href") ||
    headingLink.attr("href") ||
    $root.find("a[href]")
      .toArray()
      .map((el) => $root.find(el).attr("href"))
      .find((href) => looksLikeFastPeopleSearchDetailPath(href)) ||
    null;
  const headingName = collapseText(
    headingLink.find(".larger").first().text() || headingLink.clone().find("br, .grey").remove().end().text()
  );
  const metaText = collapseText(
    headingLink.find(".grey").first().text() || $root.find(".grey").first().text()
  );
  const ageMatch = metaText.match(/\bAge\s+(\d{1,3})\b/i) || headingLink.text().match(/\bAge\s+(\d{1,3})\b/i);
  const locationMatch = metaText.match(/(?:Age\s+\d{1,3}\s*[•·]\s*)?(.+)$/i);
  const location = locationMatch ? collapseText(locationMatch[1]) : "";
  return {
    displayName: headingName || null,
    age: ageMatch ? Number(ageMatch[1]) : null,
    location: location || null,
    profilePath: rawHref && looksLikeFastPeopleSearchDetailPath(rawHref) ? rawHref.split("#")[0].trim() : null,
  };
}

function parseLabeledCardSection($root, label) {
  const candidates = $root
    .find("div, p, section, li")
    .toArray()
    .filter((el) => {
      const text = collapseText($root.find(el).text());
      return new RegExp(`^${label}:`, "i").test(text);
    });
  const el = candidates[0];
  if (!el) {
    return [];
  }
  const raw = collapseText($root.find(el).text()).replace(new RegExp(`^${label}:\s*`, "i"), "");
  return cleanBulletSeparatedValues(raw);
}

function normalizeChallengeText(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * @param {string} rawPhone
 * @returns {string}
 */
export function buildFastPeopleSearchPhoneUrl(rawPhone) {
  const norm = normalizeUsPhoneDigits(rawPhone);
  const dashed = norm.dashed || String(rawPhone || "").replace(/\D/g, "").replace(/^(\d{3})(\d{3})(\d{4})$/, "$1-$2-$3");
  return `${BASE}/phone/${encodeURIComponent(dashed)}`;
}

/**
 * @param {string} html
 * @returns {boolean}
 */
export function isFastPeopleSearchBlocked(html) {
  return detectFastPeopleSearchBlockReason(html) != null;
}

/**
 * @param {string} html
 * @returns {string | null}
 */
function detectFastPeopleSearchBlockReason(html) {
  // If known result-page markers are present, this is not a challenge page
  if (/link-to-details|view free details|href=["']\/[^"']+_id_[A-Za-z0-9-]+["']|past addresses:|relatives:/i.test(html)) {
    return null;
  }
  const text = normalizeChallengeText(html);
  if (!text) {
    return null;
  }
  // Use raw HTML byte count so heavily-scripted pages don't falsely pass the size gate
  const isShortOrEmpty = html.length < 15000;
  if (/checking your browser|just a moment\.\.\.|attention required/i.test(text) && isShortOrEmpty) {
    return "attention_required";
  }
  if (/ray id[:\s]+[0-9a-f]{16}/i.test(text)) {
    return "cloudflare";
  }
  if (/enable javascript|please enable cookies/i.test(text) && isShortOrEmpty) {
    return "javascript_required";
  }
  if (/captcha|recaptcha|hcaptcha|verify you are human|quick humanity check/i.test(text)) {
    return "captcha_challenge";
  }
  if (/\baccess denied\b/i.test(text) && isShortOrEmpty) {
    return "access_denied";
  }
  return null;
}

/**
 * Parse a single result card into a person object.
 * Fast People Search uses Bootstrap-style cards. The name is in an h2/h3/h4 heading with an
 * /name/ link; ages, addresses, phones, and relatives are in .content-value divs.
 * @param {import('cheerio').CheerioAPI} $
 * @param {import('cheerio').Element} root
 * @returns {object}
 */
function parseResultCard($, root) {
  const $root = $(root);
  const text = collapseText($root.text());
  const heading = parseFastPeopleSearchHeading($root);

  // Phones from text (regex) — also look in .content-value spans
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

  // Addresses: links to /address/, plain-text result sections, or heading location
  const addresses = [];
  const seenAddresses = new Set();
  $root.find("a[href*='/address/']").each((_, el) => {
    const label = collapseText($(el).text());
    if (!label || seenAddresses.has(label)) {
      return;
    }
    seenAddresses.add(label);
    addresses.push({ label, formattedFull: label });
  });
  if (heading.location && !seenAddresses.has(heading.location)) {
    seenAddresses.add(heading.location);
    addresses.push({ label: heading.location, formattedFull: heading.location });
  }
  for (const label of parseLabeledCardSection($root, "Past Addresses")) {
    if (!seenAddresses.has(label)) {
      seenAddresses.add(label);
      addresses.push({ label, formattedFull: label });
    }
  }
  // Fallback: look for address-shaped text in content blocks
  if (!addresses.length) {
    $root.find(".content-value, .detail-box, [class*='address']").each((_, el) => {
      const label = collapseText($(el).text());
      if (!label || !/[A-Z]{2}\s+\d{5}/i.test(label) || seenAddresses.has(label)) {
        return;
      }
      seenAddresses.add(label);
      addresses.push({ label, formattedFull: label });
    });
  }

  // Relatives: links or plain-text bullet list sections
  const relatives = [];
  const seenRelatives = new Set();
  $root.find("a[href]").each((_, el) => {
    if ($(el).is(".link-to-details") || $(el).closest(".card-title, h1, h2, h3, h4").length) {
      return;
    }
    const name = collapseText($(el).text());
    if (!name || name === heading.displayName || seenRelatives.has(name)) {
      return;
    }
    const href = $(el).attr("href") || null;
    if (!/\/name\//i.test(String(href || "")) && !looksLikeFastPeopleSearchDetailPath(href)) {
      return;
    }
    seenRelatives.add(name);
    relatives.push({ name, path: href });
  });
  for (const name of parseLabeledCardSection($root, "Relatives")) {
    if (!name || name === heading.displayName || seenRelatives.has(name)) {
      continue;
    }
    seenRelatives.add(name);
    relatives.push({ name, path: null });
  }

  return {
    displayName: heading.displayName || null,
    age: heading.age,
    profilePath: heading.profilePath || null,
    addresses,
    phones,
    emails: [],
    relatives,
  };
}

/**
 * Deduplicate persons by name + phones + addresses.
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
 * @param {string} nameSlug - e.g. "kory-drake"
 * @param {string | null} citySlug - e.g. "waterville"
 * @param {string | null} stateSlug - e.g. "maine"
 * @returns {string}
 */
export function buildFastPeopleSearchNameUrl(nameSlug, citySlug, stateSlug) {
  const location = citySlug || stateSlug;
  if (location) {
    return `${BASE}/name/${encodeURIComponent(nameSlug)}_${encodeURIComponent(location)}`;
  }
  return `${BASE}/name/${encodeURIComponent(nameSlug)}`;
}

/**
 * Parse a Fast People Search name result page (same card format as phone result pages).
 * @param {string} html
 * @param {string} searchUrl
 * @returns {object}
 */
export function parseFastPeopleSearchNameHtml(html, searchUrl) {
  const result = parseFastPeopleSearchPhoneHtml(html, searchUrl);
  result.searchType = "name";
  return result;
}

/**
 * Parse a Fast People Search phone result page.
 * @param {string} html
 * @param {string} searchUrl
 * @returns {object}
 */
export function parseFastPeopleSearchPhoneHtml(html, searchUrl) {
  const $ = cheerio.load(html);

  // Card selectors: try specific first, fallback to generic
  const cardEls = $(
    ".card-block, .card.shadow, .card.border, [id*='result'] .card, #search-results .card, .listing-item"
  ).toArray();

  // Fallback: any .card that has a /name/ link inside
  const fallbackEls = cardEls.length
    ? []
    : $(".card").filter((_, el) => $(el).find("a[href*='/name/'], a.link-to-details[href], a[href*='_id_']").length > 0).toArray();

  const allEls = cardEls.length ? cardEls : fallbackEls;

  const cards = allEls
    .map((el) => parseResultCard($, el))
    .filter((p) => p.displayName || p.phones.length || p.addresses.length);

  const people = dedupePeople(cards);

  if (people.length) {
    return {
      source: "fastpeoplesearch",
      status: "ok",
      reason: null,
      searchUrl,
      people,
    };
  }

  const bodyText = $.text().replace(/\s+/g, " ");
  const noResults = /no results found|we could not find|no records found|we did not find/i.test(bodyText);
  if (noResults) {
    return {
      source: "fastpeoplesearch",
      status: "no_match",
      reason: "no_results_text",
      searchUrl,
      people: [],
    };
  }

  const blockedReason = detectFastPeopleSearchBlockReason(html);
  if (blockedReason) {
    return {
      source: "fastpeoplesearch",
      status: "blocked",
      reason: blockedReason,
      searchUrl,
      people: [],
      note: "Blocked by Cloudflare or anti-bot challenge. Open the browser session in Settings to complete the challenge.",
    };
  }

  return {
    source: "fastpeoplesearch",
    status: "no_match",
    reason: "no_parseable_people",
    searchUrl,
    people,
  };
}

/**
 * Parse a Fast People Search profile/detail page.
 * @param {string} html
 * @param {string} profileUrl
 * @returns {object}
 */
export function parseFastPeopleSearchProfileHtml(html, profileUrl) {
  const $ = cheerio.load(html);
  const titleMeta = titleMetadataFromFastPeopleSearch($);
  const headingText = collapseText(
    $("h1").first().text() || $(".page-details h2").first().text() || $("h2").first().text()
  );
  const ageMatch = headingText.match(/\bAge\s+(\d{1,3})\b/i) || titleMeta.age != null ? { 1: titleMeta.age } : null;
  let displayName = titleMeta.displayName;
  if (!displayName) {
    const headerName = headingText
      .replace(/\bcurrent address\b.*$/i, "")
      .replace(/\bage\s+\d{1,3}\b.*$/i, "")
      .replace(/\s+in\s+.+$/i, "")
      .trim();
    displayName = headerName || null;
  }

  const aliases = uniqueStrings(
    $("#aka-links h3, #aka-links li, #aka-links .detail-box-content > div").toArray().map((el) => $(el).text())
  ).filter((alias) => alias !== displayName);

  const emails = uniqueStrings(
    [
      ...$("#email_section h3, #email_section a[href^='mailto:']").toArray().map((el) => $(el).text()),
      ...$("a[href^='mailto:']").toArray().map((el) => $(el).attr("href")?.replace(/^mailto:/i, "") || ""),
    ]
  ).filter((email) => /@/.test(email));

  const addresses = [];
  const seenAddresses = new Set();
  $(".detail-box[id*='address']").each((_, box) => {
    const $box = $(box);
    const header = collapseText($box.find("h2").first().text());
    const isCurrent = /current address/i.test(header);
    const timeRangeMatch = header.match(/\(([^)]+)\)/);
    const timeRange = timeRangeMatch ? collapseText(timeRangeMatch[1]) : null;
    const links = $box.find("a[href*='/address/']").toArray();
    for (const link of links) {
      const $link = $(link);
      const label = normalizeFastPeopleSearchMultilineAddress($link);
      const path = String($link.attr("href") || "").split("#")[0] || null;
      if (!label) {
        continue;
      }
      const key = `${label.toLowerCase()}|${timeRange || ""}`;
      if (seenAddresses.has(key)) {
        continue;
      }
      seenAddresses.add(key);
      addresses.push({
        label,
        formattedFull: label,
        path,
        timeRange,
        recordedRange: timeRange,
        isCurrent,
      });
    }
  });
  if (titleMeta.location && !addresses.some((addr) => addr.label === titleMeta.location)) {
    addresses.unshift({
      label: titleMeta.location,
      formattedFull: titleMeta.location,
      path: null,
      timeRange: null,
      recordedRange: "",
      isCurrent: true,
    });
  }

  const phones = [];
  const seenPhones = new Set();
  $(".detail-box").each((_, box) => {
    const $box = $(box);
    const header = collapseText($box.find("h2").first().text());
    if (!/phone/i.test(header)) {
      return;
    }
    const texts = $box.find("h3, a, li, p, div").toArray().map((el) => collapseText($(el).text()));
    for (const text of texts) {
      const matches = text.match(/\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/g) || [];
      for (const raw of matches) {
        const norm = normalizeUsPhoneDigits(raw);
        if (!norm.dashed || seenPhones.has(norm.dashed)) {
          continue;
        }
        seenPhones.add(norm.dashed);
        phones.push({ display: raw, dashed: norm.dashed, isCurrent: /current/i.test(header) });
      }
    }
  });

  const relatives = [];
  const associates = [];
  const seenRelatives = new Set();
  const seenAssociates = new Set();
  $(".detail-box").each((_, box) => {
    const $box = $(box);
    const header = collapseText($box.find("h2").first().text());
    const isRelativeSection = /relative/i.test(header);
    const isAssociateSection = /associate/i.test(header);
    if (!isRelativeSection && !isAssociateSection) {
      return;
    }
    $box.find("a[href]").each((__, link) => {
      const href = String($(link).attr("href") || "").split("#")[0];
      const name = collapseText($(link).text());
      if (!name || name === displayName || !looksLikeFastPeopleSearchDetailPath(href)) {
        return;
      }
      const key = `${name.toLowerCase()}|${href}`;
      if (isAssociateSection) {
        if (seenAssociates.has(key)) {
          return;
        }
        seenAssociates.add(key);
        associates.push({ name, path: href, sourceId: "fastpeoplesearch" });
        return;
      }
      if (seenRelatives.has(key)) {
        return;
      }
      seenRelatives.add(key);
      relatives.push({ name, path: href, sourceId: "fastpeoplesearch" });
    });
  });

  let profilePath = null;
  try {
    const url = new URL(profileUrl);
    profilePath = url.pathname || null;
  } catch {
    profilePath = String(profileUrl || "").replace(/^https?:\/\/[^/]+/i, "") || null;
  }

  return {
    source: "fastpeoplesearch",
    displayName: displayName || null,
    profilePath: profilePath || null,
    aliases,
    age: ageMatch && ageMatch[1] != null ? Number(ageMatch[1]) : null,
    addresses,
    phones,
    relatives,
    associates,
    emails,
    workplaces: [],
    education: [],
    marital: [],
  };
}
