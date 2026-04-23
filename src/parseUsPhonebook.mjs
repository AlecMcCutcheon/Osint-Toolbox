import * as cheerio from "cheerio";
import { relativeListDedupeKey, uniqueProfilePaths } from "./personKey.mjs";

/**
 * @param {string} html
 * @returns {{
 *   currentOwner: { givenName: string; familyName: string; displayName: string } | null;
 *   linePhone: string | null;
 *   profilePath: string | null;
 *   fullAddressTeaser: boolean;
 *   relatives: { name: string; path: string; alternateProfilePaths?: string[] }[];
 * }}
 */
export function parseUsPhonebookHtml(html) {
  const $ = cheerio.load(html);
  const block = $(".success-wrapper-block .ls_contacts-people-finder-wrapper").first();
  if (!block.length) {
    return {
      currentOwner: null,
      linePhone: null,
      profilePath: null,
      fullAddressTeaser: false,
      relatives: [],
    };
  }

  const given = block.find('span[itemprop="name"] [itemprop="givenName"]').first().text().trim();
  const family = block
    .find('span[itemprop="name"] [itemprop="familyName"]')
    .first()
    .text()
    .trim();
  const numberHeading = block.find("h3.ls_number-text").first();
  const linePhone =
    numberHeading
      .clone()
      .children()
      .remove()
      .end()
      .text()
      .replace(/\s+/g, " ")
      .trim() || null;

  const nameCardLink = block.find('span[itemprop="name"]').first().closest("a[href^='/']");
  const firstProfile = nameCardLink.length
    ? nameCardLink
    : block
        .find("a[href*='/'][itemprop], a.ls_contacts-full-address, a.ls_contacts-btn")
        .filter((_, el) => {
          const h = $(el).attr("href") || "";
          return h.startsWith("/") && h.length > 1;
        })
        .first();
  const profilePath = firstProfile.length ? (firstProfile.attr("href") || "").split("#")[0] : null;

  const fullAddressTeaser = block.find("a.ls_contacts-full-address").length > 0;

  const relativeByKey = new Map();
  block.find("a.ls_success-blue-link[itemprop='relatedTo'] span[itemprop='name']").each(
    (_, el) => {
      const name = $(el).text().replace(/\s*,\s*$/, "").trim();
      const a = $(el).closest("a");
      const path = (a.attr("href") || "").split("#")[0];
      if (name && path) {
        const k = relativeListDedupeKey(name, path);
        const cur = relativeByKey.get(k);
        if (!cur) {
          relativeByKey.set(k, { name, path });
        } else {
          const allRaw = [cur.path, path, ...(Array.isArray(cur.alternateProfilePaths) ? cur.alternateProfilePaths : [])]
            .filter((x) => x != null && String(x).trim() !== "");
          const u = uniqueProfilePaths(allRaw);
          if (!u.length) {
            relativeByKey.set(k, { name: name.length > cur.name.length ? name : cur.name, path: cur.path });
          } else {
            const [primary, ...alts] = u;
            const nName = name.length > cur.name.length ? name : cur.name;
            const next = { name: nName, path: primary };
            if (alts.length) {
              next.alternateProfilePaths = alts;
            }
            relativeByKey.set(k, next);
          }
        }
      }
    }
  );
  const relatives = Array.from(relativeByKey.values());

  const displayName = [given, family].filter(Boolean).join(" ").trim() || null;

  return {
    currentOwner:
      given || family
        ? { givenName: given || "", familyName: family || "", displayName: displayName || "" }
        : null,
    linePhone,
    profilePath,
    fullAddressTeaser,
    relatives,
  };
}
