import * as cheerio from "cheerio";
import { normalizeUsPhoneDigits } from "./phoneEnrichment.mjs";

const BASE = "https://www.truepeoplesearch.com";

function collapseText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
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

function normalizeCityStateLabel(value) {
  return collapseText(value)
    .replace(/\b([A-Za-z .'-]+)\s+([A-Z]{2})(?:\b|$)/g, "$1, $2")
    .replace(/\s+,/g, ",")
    .replace(/\s+/g, " ")
    .trim();
}

function splitTpsListText(value) {
  return uniqueStrings(
    collapseText(value)
      .split(/\s*,\s*|\s*[•·]\s*/)
      .map((part) => normalizeCityStateLabel(part))
  );
}

function looksLikeTruePeopleSearchPersonPath(href) {
  return /^\/find\/person\/[^/?#]+(?:[?#].*)?$/i.test(String(href || "").trim());
}

function looksLikeTruePeopleSearchAddressPath(href) {
  return /^\/(?:find\/)?(?:address|address-lookup)\/[^/?#]+(?:[?#].*)?$/i.test(String(href || "").trim());
}

function looksLikeNonPersonLabel(value) {
  const text = collapseText(value).toLowerCase();
  if (!text) {
    return true;
  }
  return /^view\s+(details|free details)$/.test(text) || /^(details|free details|profile)$/.test(text);
}

function createLinkedPeople($, $scope, selector, sourceId) {
  const rows = [];
  const seen = new Set();
  $scope.find(selector).each((_, el) => {
    const $el = $(el);
    const href = String($el.attr("href") || "").split("#")[0];
    const name = collapseText($el.text());
    if (!name || !looksLikeTruePeopleSearchPersonPath(href)) {
      return;
    }
    const key = `${name.toLowerCase()}|${href}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    rows.push({ name, path: href, sourceId });
  });
  return rows;
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
  return detectTruePeopleSearchBlockReason(html) != null;
}

/**
 * @param {string} html
 * @returns {string | null}
 */
function detectTruePeopleSearchBlockReason(html) {
  // If known result-page markers are present, this is not a challenge page
  if (/href=["'][^"']*\/find\/person\/[^"']*["']|href=["'][^"']*\/address-lookup\/[^"']*["']|class=["'][^"']*card-summary[^"']*["']|data-birthdate|possible relatives|current home address/i.test(html)) {
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

function extractPhonesFromText(text) {
  const phones = [];
  const seenPhones = new Set();
  const phoneMatches = String(text || "").match(/\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/g) || [];
  for (const raw of phoneMatches) {
    const norm = normalizeUsPhoneDigits(raw);
    if (!norm.dashed || seenPhones.has(norm.dashed)) {
      continue;
    }
    seenPhones.add(norm.dashed);
    phones.push({ display: collapseText(raw), dashed: norm.dashed });
  }
  return phones;
}

function extractAddressesFromText(value) {
  const text = collapseText(value);
  if (!text) {
    return [];
  }
  return splitTpsListText(text)
    .filter((part) => /,\s*[A-Z]{2}(?:\b|\s+\d{5})/.test(part) || /[A-Za-z].+\s+[A-Z]{2}$/.test(part))
    .map((label) => ({ label, formattedFull: label }));
}

function extractAddressesFromLinks($, $root) {
  const rows = [];
  const seen = new Set();
  $root.find("a[href]").each((_, el) => {
    const $el = $(el);
    const href = String($el.attr("href") || "").split("#")[0];
    if (!looksLikeTruePeopleSearchAddressPath(href)) {
      return;
    }
    const label = normalizeCityStateLabel(collapseText($el.text()));
    if (!label || seen.has(label.toLowerCase())) {
      return;
    }
    seen.add(label.toLowerCase());
    rows.push({ label, formattedFull: label, path: href });
  });
  return rows;
}

function parseTruePeopleSearchResultCard($, root) {
  const $root = $(root);
  const text = collapseText($root.text());
  const displayName = $root
    .find(".content-header, h2, h3, h4, [itemprop='name'], a[href*='/find/person/']")
    .toArray()
    .map((el) => collapseText($(el).text()))
    .find((candidate) => !looksLikeNonPersonLabel(candidate)) || null;
  const profilePath = String(
    $root.attr("data-detail-link") || $root.find("a.detail-link[href], a[href*='/find/person/']").first().attr("href") || ""
  )
    .split("#")[0]
    .trim();
  const ageMatch = text.match(/Age\s+(\d{1,3})/i);
  const currentLocation = normalizeCityStateLabel(
    $root.find(".content-value").eq(1).text() || text.match(/Age\s+\d{1,3}\s*[•·]\s*([^•]+)/i)?.[1] || ""
  );
  const usedToLiveInText = collapseText(
    $root.find(".content-label")
      .filter((_, el) => /used to live in/i.test($(el).text()))
      .parent()
      .find(".content-value")
      .first()
      .text()
  );
  const relatedToText = collapseText(
    $root.find(".content-label")
      .filter((_, el) => /related to/i.test($(el).text()))
      .parent()
      .find(".content-value")
      .first()
      .text()
  );
  const addresses = [
    ...(currentLocation ? [{ label: currentLocation, formattedFull: currentLocation }] : []),
    ...extractAddressesFromText(usedToLiveInText),
    ...extractAddressesFromLinks($, $root),
  ];
  const linkedRelatives = createLinkedPeople($, $root, "a[href*='/find/person/']", "truepeoplesearch")
    .filter((relative) => {
      const lower = relative.name.toLowerCase();
      if (/^view\s+(details|free details)$/i.test(relative.name)) {
        return false;
      }
      return !displayName || lower !== displayName.toLowerCase();
    });
  const relatives = [
    ...splitTpsListText(relatedToText)
      .map((name) => name.replace(/\s*\.\.\.$/, "").trim())
      .filter(Boolean)
      .map((name) => ({ name, path: null, sourceId: "truepeoplesearch" })),
    ...linkedRelatives,
  ].filter((relative, index, all) => index === all.findIndex((candidate) => candidate.name === relative.name));
  return {
    displayName: displayName || null,
    age: ageMatch ? Number(ageMatch[1]) : null,
    profilePath: looksLikeTruePeopleSearchPersonPath(profilePath) ? profilePath : null,
    addresses: addresses.filter(
      (address, index, all) => index === all.findIndex((candidate) => candidate.label === address.label)
    ),
    phones: extractPhonesFromText(text),
    emails: [],
    relatives,
    associates: [],
  };
}

/**
 * @param {import('cheerio').CheerioAPI} $
 * @param {import('cheerio').Element} root
 * @returns {object}
 */
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
        associates: [...(person.associates || [])],
      });
      continue;
    }
    for (const field of ["phones", "addresses", "emails", "relatives", "associates"]) {
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
 * @param {string} name - e.g. "Kory Drake"
 * @param {string | null} city - e.g. "Waterville"
 * @param {string | null} stateQuery - e.g. "ME" or "Maine"
 * @returns {string}
 */
export function buildTruePeopleSearchNameUrl(name, city, stateQuery) {
  const params = new URLSearchParams();
  params.set("name", String(name || "").trim());
  const normalizedState = String(stateQuery || "").trim();
  if (city && normalizedState) {
    params.set("citystatezip", `${city.trim()}, ${normalizedState}`);
  } else if (normalizedState) {
    params.set("citystatezip", normalizedState);
  } else if (city) {
    params.set("citystatezip", city.trim());
  }
  return `${BASE}/results?${params.toString()}`;
}

/**
 * @param {string} streetAddress
 * @param {string | null} city
 * @param {string | null} stateQuery
 * @param {string | null} zip
 * @returns {string}
 */
export function buildTruePeopleSearchAddressUrl(streetAddress, city, stateQuery, zip) {
  const params = new URLSearchParams();
  params.set("StreetAddress", String(streetAddress || "").trim());
  const cityStateZip = [String(city || "").trim(), String(stateQuery || "").trim(), String(zip || "").trim()]
    .filter(Boolean)
    .join(", ");
  if (cityStateZip) {
    params.set("CityStateZip", cityStateZip);
  }
  return `${BASE}/results?${params.toString()}`;
}

/**
 * Parse a TruePeopleSearch name result page (same card format as phone result pages).
 * @param {string} html
 * @param {string} searchUrl
 * @returns {object}
 */
export function parseTruePeopleSearchNameHtml(html, searchUrl) {
  const result = parseTruePeopleSearchPhoneHtml(html, searchUrl);
  result.searchType = "name";
  return result;
}

/**
 * @param {string} html
 * @param {string} searchUrl
 * @returns {object}
 */
export function parseTruePeopleSearchAddressSearchHtml(html, searchUrl) {
  const result = parseTruePeopleSearchPhoneHtml(html, searchUrl);
  result.searchType = "address";
  return result;
}

/**
 * @param {string} html
 * @param {string} searchUrl
 * @returns {object}
 */
export function parseTruePeopleSearchPhoneHtml(html, searchUrl) {
  const $ = cheerio.load(html);
  const personSignals = ".content-header, a[href*='/find/person/'], a.detail-link[href], [itemprop='name'], h2, h3, h4";
  const specificCardEls = $(".card.card-summary, .card, .card-block, .detail-box")
    .filter((_, el) => $(el).find(personSignals).length > 0 || looksLikeTruePeopleSearchPersonPath($(el).attr("data-detail-link")))
    .toArray();
  const fallbackEls = specificCardEls.length
    ? []
    : $("[class*='result']")
        .filter((_, el) => {
          const $el = $(el);
          return $el.find(personSignals).length > 0 && $el.find(".card, .card-block, .detail-box, [class*='result']").length === 0;
        })
        .toArray();
  const cards = (specificCardEls.length ? specificCardEls : fallbackEls)
    .map((el) => parseTruePeopleSearchResultCard($, el))
    .filter((person) => person.displayName || person.phones.length || person.addresses.length);
  const people = dedupePeople(cards);
  if (people.length) {
    return {
      source: "truepeoplesearch",
      status: "ok",
      reason: null,
      searchUrl,
      people,
    };
  }

  const bodyText = $.text();
  const noResults = /no results found|we could not find/i.test(bodyText);
  if (noResults) {
    return {
      source: "truepeoplesearch",
      status: "no_match",
      reason: "no_results_text",
      searchUrl,
      people: [],
    };
  }

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

  return {
    source: "truepeoplesearch",
    status: "no_match",
    reason: "no_parseable_people",
    searchUrl,
    people,
  };
}

/**
 * @param {string} html
 * @param {string} profileUrl
 * @returns {object}
 */
export function parseTruePeopleSearchProfileHtml(html, profileUrl) {
  const $ = cheerio.load(html);
  const root = $("#personDetails").first();
  const scope = root.length ? root : $("body");
  const displayName = collapseText(scope.find("h1.oh1, h1").first().text()) || null;
  const heroText = collapseText(scope.find("h1.oh1, h1").first().parent().text());
  const ageMatch = heroText.match(/Age\s+(\d{1,3})/i);
  const headerPhone = extractPhonesFromText(heroText)[0] || null;

  let profilePath = null;
  try {
    profilePath = new URL(profileUrl).pathname || null;
  } catch {
    profilePath = String(profileUrl || "").replace(/^https?:\/\/[^/]+/i, "") || null;
  }

  const aliases = uniqueStrings(
    scope
      .find("#toc-akas")
      .nextUntil("#toc-current-address")
      .find("span, .content-value, .col div")
      .toArray()
      .map((el) => collapseText($(el).text()))
      .flatMap((text) => splitTpsListText(text))
      .filter((alias) => alias && alias !== displayName && !/^also seen as$/i.test(alias))
  );

  const emails = uniqueStrings(
    scope
      .find("#toc-emails")
      .nextUntil("#toc-previous-addresses")
      .find(".col div")
      .toArray()
      .map((el) => collapseText($(el).text()))
      .filter((text) => /@/.test(text))
  );

  const addresses = [];
  const seenAddresses = new Set();
  const currentAddressSection = scope.find("#toc-current-address").first();
  if (currentAddressSection.length) {
    currentAddressSection
      .nextUntil("#toc-phones")
      .find("a[href]")
      .each((_, el) => {
        const href = String($(el).attr("href") || "").split("#")[0];
        if (!looksLikeTruePeopleSearchAddressPath(href)) {
          return;
        }
        const label = normalizeCityStateLabel(String($(el).html() || "").replace(/<br\s*\/?>/gi, ", ").replace(/<[^>]+>/g, " "));
        const metaText = collapseText($(el).closest("div").find(".dt-ln").text());
        const periodMatch = metaText.match(/\(([^)]+)\)/);
        const key = `${label.toLowerCase()}|current`;
        if (!label || seenAddresses.has(key)) {
          return;
        }
        seenAddresses.add(key);
        addresses.push({
          label,
          formattedFull: label,
          path: href,
          timeRange: periodMatch ? collapseText(periodMatch[1]) : null,
          recordedRange: periodMatch ? collapseText(periodMatch[1]) : "",
          isCurrent: true,
        });
      });
  }

  const previousAddressSection = scope.find("#toc-previous-addresses").first();
  if (previousAddressSection.length) {
    previousAddressSection
      .nextUntil("#toc-relatives")
      .find("a[href]")
      .each((_, el) => {
        const href = String($(el).attr("href") || "").split("#")[0];
        if (!looksLikeTruePeopleSearchAddressPath(href)) {
          return;
        }
        const label = normalizeCityStateLabel(String($(el).html() || "").replace(/<br\s*\/?>/gi, ", ").replace(/<[^>]+>/g, " "));
        const metaText = collapseText($(el).closest("div").find(".dt-ln").text());
        const periodMatch = metaText.match(/\(([^)]+)\)/);
        const key = `${label.toLowerCase()}|${periodMatch ? periodMatch[1] : "prev"}`;
        if (!label || seenAddresses.has(key)) {
          return;
        }
        seenAddresses.add(key);
        addresses.push({
          label,
          formattedFull: label,
          path: href,
          timeRange: periodMatch ? collapseText(periodMatch[1]) : null,
          recordedRange: periodMatch ? collapseText(periodMatch[1]) : "",
          isCurrent: false,
        });
      });
  }

  const phones = [];
  const seenPhones = new Set();
  scope.find("#toc-phones").nextUntil("#toc-emails").find("a[href*='/find/phone/']").each((_, el) => {
    const $el = $(el);
    const text = collapseText($el.text());
    const norm = normalizeUsPhoneDigits(text);
    if (!norm.dashed || seenPhones.has(norm.dashed)) {
      return;
    }
    seenPhones.add(norm.dashed);
    const containerText = collapseText($el.closest("div").text());
    const lineTypeMatch = containerText.match(/-\s*(Landline|Wireless|Voip)\b/i);
    phones.push({
      display: text,
      dashed: norm.dashed,
      isCurrent: /possible primary phone/i.test(containerText) || (!phones.length && headerPhone?.dashed === norm.dashed),
      lineType: lineTypeMatch ? lineTypeMatch[1].toLowerCase() : null,
    });
  });
  if (headerPhone && !seenPhones.has(headerPhone.dashed)) {
    phones.unshift({ ...headerPhone, isCurrent: true, lineType: null });
  }

  const relatives = createLinkedPeople($, scope.find("#toc-relatives").nextUntil("#toc-associates"), "a[href*='/find/person/']", "truepeoplesearch");
  const associates = createLinkedPeople($, scope.find("#toc-associates").nextAll(), "a[href*='/find/person/']", "truepeoplesearch");

  return {
    source: "truepeoplesearch",
    displayName,
    profilePath: profilePath || null,
    aliases,
    age: ageMatch ? Number(ageMatch[1]) : null,
    addresses,
    phones,
    relatives: relatives.filter((item) => item.name !== displayName),
    associates: associates.filter((item) => item.name !== displayName),
    emails,
    workplaces: [],
    education: [],
    marital: [],
  };
}

/**
 * @param {string} html
 * @param {string} documentUrl
 * @returns {object}
 */
export function parseTruePeopleSearchAddressHtml(html, documentUrl) {
  const $ = cheerio.load(html);
  const root = $("#personDetails, .card.card-body.shadow-form, body").first();

  let documentPath = null;
  try {
    documentPath = new URL(documentUrl).pathname || null;
  } catch {
    documentPath = String(documentUrl || "").replace(/^https?:\/\/[^/]+/i, "") || null;
  }

  const addressLabel = normalizeCityStateLabel(
    String(root.find("h1.oh1, h1, a[href*='/find/address/'], a[href*='/address-lookup/']").first().html() || "")
      .replace(/<br\s*\/?>/gi, ", ")
      .replace(/<[^>]+>/g, " ")
  ) || null;

  const address = addressLabel
    ? {
        label: addressLabel,
        formattedFull: addressLabel,
        path: documentPath,
        normalizedKey: addressLabel.toLowerCase().replace(/[^a-z0-9\s,]/g, " ").replace(/\s+/g, " ").trim(),
      }
    : null;

  const residents = [];
  root.find("h2, h3, .h5").filter((_, el) => /residents?/i.test(collapseText($(el).text()))).each((_, heading) => {
    const section = $(heading).closest("div").parent().nextAll().addBack();
    const links = createLinkedPeople($, section.length ? section : root, "a[href*='/find/person/']", "truepeoplesearch");
    for (const person of links) {
      residents.push({ name: person.name, path: person.path, isCurrent: true, role: "resident" });
    }
  });

  const businesses = [];
  root.find("h2, h3, .h5").filter((_, el) => /business/i.test(collapseText($(el).text()))).each((_, heading) => {
    const section = $(heading).closest("div").parent().nextAll().addBack();
    section.find("a[href], .content-value, .col div").each((_, el) => {
      const $el = $(el);
      const href = String($el.attr("href") || "").split("#")[0];
      const text = collapseText($el.text());
      if (!text || looksLikeTruePeopleSearchPersonPath(href) || looksLikeTruePeopleSearchAddressPath(href)) {
        return;
      }
      const name = text.replace(/\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}.*/, "").trim();
      if (!name) {
        return;
      }
      businesses.push({
        name,
        path: href || null,
        phones: extractPhonesFromText(text),
      });
    });
  });

  return {
    source: "truepeoplesearch",
    sourceId: "truepeoplesearch",
    documentType: "address_document",
    documentPath,
    address,
    residents: residents.filter((resident, index, all) => index === all.findIndex((candidate) => candidate.name === resident.name && candidate.path === resident.path)),
    businesses: businesses.filter((business, index, all) => index === all.findIndex((candidate) => candidate.name === business.name)),
  };
}
