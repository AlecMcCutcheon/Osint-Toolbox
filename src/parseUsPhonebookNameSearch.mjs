import * as cheerio from "cheerio";
import { profilePathnameOnly } from "./personKey.mjs";

/**
 * @param {string} s
 * @returns {string}
 */
function cleanText(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

/**
 * @param {string} line
 * @param {string} label
 * @returns {string}
 */
function stripLabel(line, label) {
  return cleanText(String(line || "").replace(new RegExp(`^${label}:?`, "i"), ""));
}

/**
 * @param {string} input
 * @returns {string[]}
 */
function splitCsvish(input) {
  return cleanText(input)
    .split(/\s*,\s*/)
    .map((part) => cleanText(part))
    .filter(Boolean);
}

/**
 * @param {string} html
 * @returns {{
 *   queryName: string | null;
 *   totalRecords: number;
 *   totalPages: number | null;
 *   summaryText: string | null;
 *   likelyChallenged: boolean;
 *   candidates: Array<{
 *     displayName: string;
 *     age: number | null;
 *     currentCityState: string | null;
 *     priorAddresses: string[];
 *     relatives: { name: string; path: string }[];
 *     profilePath: string | null;
 *   }>;
 * }}
 */
export function parseUsPhonebookNameSearchHtml(html) {
  const $ = cheerio.load(html);
  const queryName = cleanText($(".search-header h1.ls_header-5").first().text()) || null;
  const summaryHeading = cleanText($(".search-header h2").first().text());
  const summaryText = cleanText($(".search-header .info-text-description").first().text()) || null;
  const totalRecordsMatch = summaryHeading.match(/found\s+(\d+)\s+records?/i);
  const totalPagesText = cleanText($(".result-block > .content-success").nextAll("p").first().text());
  const totalPagesMatch = totalPagesText.match(/We have\s+(\d+)\s+pages?\s+of\s+results/i);

  const candidates = [];
  // Use a flat selector — the ancestor .success-wrapper.result-by-name can be
  // restructured by Ezoic/ad injection after Flare renders the page, so we find
  // blocks directly and rely on the heading guard below to skip ad placeholders.
  $(".success-wrapper-block").each((_, el) => {
    const card = $(el);
    const heading = cleanText(card.find("h3.ls_number-text").first().text());
    if (!heading) {
      return;
    }
    const displayName =
      cleanText(card.find('h3.ls_number-text [itemprop="name"]').first().text()) ||
      heading.replace(/,\s*Age\s+\d+\s*$/i, "");
    const ageMatch = heading.match(/Age\s+(\d+)/i);
    const lines = card.find(".ls_success-content-extra-info");
    const currentCityState = stripLabel(cleanText(lines.eq(0).text()), "Lives in") || null;
    const priorAddressEls = lines.eq(1).find('[itemprop="address"]');
    const priorAddresses = priorAddressEls.length
      ? priorAddressEls
          .toArray()
          .map((node) => cleanText($(node).text()))
          .filter(Boolean)
      : lines.length > 1
        ? splitCsvish(stripLabel(cleanText(lines.eq(1).text()), "Prior addresses"))
        : [];
    const relatives = card
      .find("a.ls_success-blue-link")
      .toArray()
      .map((a) => {
        const name = cleanText($(a).text()).replace(/,\s*$/, "");
        const path = profilePathnameOnly($(a).attr("href") || "");
        return name && path ? { name, path } : null;
      })
      .filter(Boolean);
    const explicitProfilePath = profilePathnameOnly(card.find("a.ls_contacts-btn").first().attr("href") || "");
    const itemIdPath = profilePathnameOnly(card.attr("itemid") || "");
    candidates.push({
      displayName,
      age: ageMatch ? Number(ageMatch[1]) : null,
      currentCityState,
      priorAddresses,
      relatives,
      profilePath: explicitProfilePath || itemIdPath || null,
    });
  });

  return {
    queryName,
    totalRecords: totalRecordsMatch ? Number(totalRecordsMatch[1]) : candidates.length,
    totalPages: totalPagesMatch ? Number(totalPagesMatch[1]) : null,
    summaryText,
    // A real USPhonebook name-search page always has a .search-header with an h1.
    // If both are absent the response is almost certainly a challenge/bot page.
    likelyChallenged: !queryName && $(".search-header").length === 0,
    candidates,
  };
}
