import * as cheerio from "cheerio";
import { addressPresentation } from "./addressFormat.mjs";
import { relativeListDedupeKey, uniqueProfilePaths } from "./personKey.mjs";

/**
 * @param {import("cheerio").CheerioAPI} $
 * @param {import("cheerio").Element} a
 * @returns {boolean}
 */
function isJunkLink($, a) {
  const h = $(a).attr("href") || "";
  if (!h) {
    return true;
  }
  if ($(a).attr("rel") === "sponsored" || /nofollow/.test(String($(a).attr("rel") || ""))) {
    if (/http/i.test(h) && !h.includes("usphonebook.com")) {
      return true;
    }
  }
  if (
    /peoplefinders|background-check|ezoic|sponsor|mailto:|#Details|checkout/i.test(h)
  ) {
    return true;
  }
  if (h.startsWith("http") && !h.includes("usphonebook.com")) {
    return true;
  }
  return false;
}

/**
 * @param {string} phoneText
 * @returns {string | null} dashed 203-123-4567
 */
function extractDashed(phoneText) {
  const d = String(phoneText).replace(/[^\d]/g, "");
  if (d.length === 10) {
    return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  }
  return null;
}

/**
 * @param {string} line
 * @returns {string}
 */
function normAddrKey(line) {
  return line
    .toLowerCase()
    .replace(/[^a-z0-9\s,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * @param {string} html
 * @returns {object} Normalized profile (no off-site or paywall links in arrays)
 */
export function parseUsPhonebookProfileHtml(html) {
  const $ = cheerio.load(html);
  const root = $(".phase2-section, .success-wrapper-block").first().parent();
  const scope = root.length ? root : $("body");

  let displayName = scope.find("h3 span, .ls_contacts-people-finder-wrapper h3").first().text().replace(/\s+/g, " ").trim();
  if (!displayName) {
    displayName = scope.find("h3").first().clone().children().remove().end().text().trim();
  }
  const akaLine = scope.find("p.ls_contacts__sub").first().text();
  const aliases = [];
  if (akaLine) {
    const m = akaLine.replace(/^[^:]*:\s*/i, "").split(/,|\./);
    for (const s of m) {
      const t = s.replace(/\s+/g, " ").trim();
      if (t) {
        aliases.push(t);
      }
    }
  }
  const ageM = scope.find("p.ls_contacts__age").text().match(/(\d+)\s*year/i);
  const age = ageM ? Number(ageM[1]) : null;

  const addresses = [];
  const seenAddr = new Set();
  const addAddr = (label, isCurrent) => {
    const section = scope
      .find(".ls_contacts__title")
      .filter((_, el) => $(el).text().toLowerCase().includes(label))
      .first();
    if (!section.length) {
      return;
    }
    const block = section.closest("div").parent();
    block.find('a[href*="/address/"]').each((_, a) => {
      if (isJunkLink($, a)) {
        return;
      }
      const text = $(a).text().replace(/\s+/g, " ").trim();
      const path = String($(a).attr("href") || "").split("#")[0];
      if (!text || !path) {
        return;
      }
      const timeSpan = $(a).find(".minor-lapse, span.minor-lapse").text().trim() || null;
      const normalizedKey = normAddrKey(text);
      if (seenAddr.has(normalizedKey)) {
        return;
      }
      seenAddr.add(normalizedKey);
      const base = {
        kind: "address",
        label: text,
        path,
        timeRange: timeSpan,
        isCurrent: Boolean(isCurrent),
        normalizedKey,
      };
      addresses.push({ ...base, ...addressPresentation(base) });
    });
  };
  addAddr("current address", true);
  addAddr("previous addresses", false);

  const phones = [];
  scope.find('a[href*="/phone-search/"]').each((_, a) => {
    if (isJunkLink($, a)) {
      return;
    }
    const ptext = $(a).text().replace(/\s+/g, " ").trim();
    const d = extractDashed(ptext);
    if (!d) {
      return;
    }
    const li = $(a).closest("li, div, .ls_contacts__text");
    const isPrev = /previous/i.test(li.closest("ul").prev().text() + li.text());
    const kindT = (li.find(".phone-sub-category, span").text() || "").toLowerCase();
    phones.push({
      kind: "phone",
      dashed: d,
      display: ptext,
      isCurrent: !isPrev,
      lineType: kindT.includes("wireless") ? "wireless" : kindT.includes("land") ? "landline" : null,
    });
  });

  const relativeByKey = new Map();
  scope.find(".section-relative a.ls_success-link, a[itemprop=relatedTo] span[itemprop=name]").each((_, el) => {
    const a = el.tagName === "a" ? el : $(el).closest("a").get(0);
    if (!a) {
      return;
    }
    if (isJunkLink($, a)) {
      return;
    }
    const $a = $(a);
    const name = ($a.find("span[itemprop=name]").text() || $a.text()).replace(/\s+/g, " ").trim();
    const path = String($a.attr("href") || "").split("#")[0];
    if (name && path && path.startsWith("/") && !path.includes("peoplefinders")) {
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
  });
  const relatives = Array.from(relativeByKey.values());

  const emails = [];
  scope.find(".emailslist a, ul.emailslist a[href^=mailto:]").each((_, a) => {
    const href = $(a).attr("href") || "";
    const m = href.replace(/^mailto:/i, "").split("?")[0];
    if (m && m.includes("@")) {
      emails.push(m.trim());
    }
  });

  const nameSlugForPath = (name) => {
    const s = name != null ? String(name).trim() : "";
    if (!s) {
      return "";
    }
    return s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  };
  const firstPathSegment = (p) => {
    const t = String(p).split("?")[0].replace(/^\//, "");
    return (t.split("/")[0] || "").toLowerCase();
  };
  const looksLikeProfilePath = (p) => {
    const t = String(p);
    return /^\/[^/]+\/[^/]+\/?$/.test(t) && !t.includes("phone-search") && !t.includes("address");
  };
  const canonical = $('link[rel="canonical"]').attr("href");
  let profilePath = null;
  if (canonical) {
    try {
      const u = new URL(String(canonical), "https://www.usphonebook.com");
      if (/usphonebook\.com$/i.test(String(u.hostname).replace(/^www\./, "")) && u.pathname) {
        const p = u.pathname.split("?")[0].replace(/\/$/, "");
        if (looksLikeProfilePath(p)) {
          profilePath = p;
        }
      }
    } catch {
      // ignore
    }
  }
  const nameSlug = nameSlugForPath(displayName);
  if (!profilePath && nameSlug) {
    const spanNodes = scope.find('span[itemprop="url"], span[style*="display:none"][itemprop="url"]');
    for (const el of spanNodes.toArray()) {
      const raw = String($(el).text() || "")
        .trim()
        .split("?")[0];
      if (raw && looksLikeProfilePath(raw) && firstPathSegment(raw) === nameSlug) {
        profilePath = raw;
        break;
      }
    }
  }
  if (!profilePath) {
    const headerSpan = scope
      .find(".info-wrapper span[itemprop=url], .search-header span[itemprop=url], .phase1-section span[itemprop=url]")
      .first();
    if (headerSpan.length) {
      const raw = String(headerSpan.text() || "")
        .trim()
        .split("?")[0];
      if (raw && looksLikeProfilePath(raw)) {
        profilePath = raw;
      }
    }
  }
  if (!profilePath) {
    const fromSpan = scope.find('span[itemprop="url"], span[style*="display:none"][itemprop="url"]');
    const raw0 = fromSpan
      .first()
      .text()
      .trim()
      .split("?")[0] || null;
    if (raw0 && looksLikeProfilePath(raw0)) {
      profilePath = raw0;
    }
  }
  if (!profilePath) {
    const pathLink = scope
      .find("a[href^='/']")
      .filter((_, a) => {
        const t = String($(a).attr("href") || "");
        return (
          looksLikeProfilePath(t) &&
          !/peoplefinders|background|sponsored/i.test(String($(a).attr("rel") || ""))
        );
      })
      .first();
    if (pathLink.length) {
      const t = String(pathLink.attr("href") || "").split("?")[0] || null;
      if (t) {
        profilePath = t;
      }
    }
  }

  return {
    displayName: displayName || null,
    profilePath: profilePath || null,
    aliases: [...new Set(aliases)],
    age,
    addresses,
    phones: phones.filter(
      (p, i, arr) => i === arr.findIndex((o) => o.dashed === p.dashed)
    ),
    relatives,
    emails: [...new Set(emails)],
  };
}
