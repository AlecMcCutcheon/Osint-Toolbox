import * as cheerio from "cheerio";
import { addressPresentation } from "./addressFormat.mjs";
import { profilePathnameOnly, relativeListDedupeKey, uniqueProfilePaths } from "./personKey.mjs";

const MONTH_INDEX = new Map([
  ["jan", 0],
  ["feb", 1],
  ["mar", 2],
  ["apr", 3],
  ["may", 4],
  ["jun", 5],
  ["jul", 6],
  ["aug", 7],
  ["sep", 8],
  ["oct", 9],
  ["nov", 10],
  ["dec", 11],
]);

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
 * @param {string | null | undefined} value
 * @returns {string}
 */
function normalizePersonNameKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * @param {string | null | undefined} text
 * @returns {string | null}
 */
function cleanField(text) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  return value && /[a-z0-9]/i.test(value) ? value : null;
}

/**
 * @param {string | null | undefined} text
 * @returns {number | null}
 */
function parseMonthYear(text) {
  const m = String(text || "").trim().match(/^([A-Za-z]{3,9})\s+(\d{4})$/);
  if (!m) {
    return null;
  }
  const month = MONTH_INDEX.get(m[1].slice(0, 3).toLowerCase());
  if (month == null) {
    return null;
  }
  return Date.UTC(Number(m[2]), month, 1);
}

/**
 * @param {string | null | undefined} rangeText
 * @returns {{ start: number | null; end: number | null; isOpenEnded: boolean }}
 */
function parseTimeRange(rangeText) {
  const text = String(rangeText || "")
    .replace(/^\(|\)$/g, "")
    .trim();
  if (!text || !text.includes("-")) {
    return { start: null, end: null, isOpenEnded: false };
  }
  const [rawStart, rawEnd] = text.split(/\s+-\s+/, 2);
  const endText = String(rawEnd || "").trim();
  return {
    start: parseMonthYear(rawStart),
    end: /present|current|now/i.test(endText) ? null : parseMonthYear(endText),
    isOpenEnded: /present|current|now/i.test(endText),
  };
}

/**
 * @param {object} addr
 * @returns {number}
 */
function addressRecencyScore(addr) {
  const parsed = parseTimeRange(addr?.timeRange);
  if (parsed.isOpenEnded) {
    return Number.POSITIVE_INFINITY;
  }
  if (parsed.end != null) {
    return parsed.end;
  }
  if (parsed.start != null) {
    return parsed.start;
  }
  return Number.NEGATIVE_INFINITY;
}

/**
 * @param {object} prev
 * @param {object} next
 * @returns {object}
 */
function choosePreferredAddress(prev, next) {
  const prevScore = addressRecencyScore(prev);
  const nextScore = addressRecencyScore(next);
  if (next.isCurrent && !prev.isCurrent) {
    return next;
  }
  if (prev.isCurrent && !next.isCurrent) {
    return prev;
  }
  if (nextScore > prevScore) {
    return next;
  }
  if (prevScore > nextScore) {
    return prev;
  }
  if (String(next.label || "").length > String(prev.label || "").length) {
    return next;
  }
  return prev;
}

/**
 * @param {object} addr
 * @returns {object}
 */
function buildAddressPeriod(addr) {
  return {
    label: addr?.formattedFull || addr?.label || "",
    path: addr?.path || null,
    timeRange: addr?.timeRange || null,
    recordedRange: addr?.recordedRange || addr?.timeRange || "",
    isCurrentObserved: Boolean(addr?.isCurrent),
  };
}

/**
 * @param {object[] | undefined} periods
 * @returns {object[]}
 */
function sortAddressPeriods(periods) {
  return [...(Array.isArray(periods) ? periods : [])].sort((a, b) => {
    const scoreDiff = addressRecencyScore(b) - addressRecencyScore(a);
    if (scoreDiff !== 0) {
      return scoreDiff;
    }
    return String(b?.recordedRange || "").localeCompare(String(a?.recordedRange || ""));
  });
}

/**
 * @param {object[] | undefined} existing
 * @param {object} nextPeriod
 * @returns {object[]}
 */
function mergeAddressPeriods(existing, nextPeriod) {
  const byKey = new Map();
  for (const period of [...(Array.isArray(existing) ? existing : []), nextPeriod]) {
    const key = [
      String(period?.path || ""),
      String(period?.timeRange || ""),
      String(period?.label || ""),
    ].join("|");
    if (!byKey.has(key)) {
      byKey.set(key, period);
    }
  }
  return sortAddressPeriods(Array.from(byKey.values()));
}

/**
 * @param {object[]} addresses
 * @returns {object[]}
 */
function normalizeAddressCurrentFlags(addresses) {
  if (!Array.isArray(addresses) || !addresses.length) {
    return [];
  }
  const maxScore = Math.max(...addresses.map((addr) => addressRecencyScore(addr)));
  if (maxScore > Number.NEGATIVE_INFINITY) {
    return addresses.map((addr) => ({
      ...addr,
      isCurrent: addressRecencyScore(addr) === maxScore,
    }));
  }
  const firstCurrentIndex = addresses.findIndex((addr) => addr.isCurrent);
  const currentIndex = firstCurrentIndex >= 0 ? firstCurrentIndex : 0;
  return addresses.map((addr, index) => ({ ...addr, isCurrent: index === currentIndex }));
}

/**
 * @param {string} labelText
 * @param {string | null} timeSpan
 * @returns {string}
 */
function canonicalAddressKey(labelText, timeSpan) {
  const pres = addressPresentation({ label: labelText, timeRange: timeSpan, normalizedKey: "" });
  return normAddrKey(pres.formattedFull || labelText);
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

  /** @type {Map<string, object>} */
  const addressByKey = new Map();
  const addAddr = (label, isCurrent) => {
    const section = scope
      .find(".ls_contacts__title")
      .filter((_, el) => $(el).text().toLowerCase().includes(label))
      .first();
    if (!section.length) {
      return;
    }
    const blocks = section.parent().nextUntil(".ls_contacts__title").addBack();
    const searchScope = blocks.length ? blocks : section.parent();
    searchScope.find('a[href*="/address/"]').each((_, a) => {
      if (isJunkLink($, a)) {
        return;
      }
      const text = $(a).text().replace(/\s+/g, " ").trim();
      const path = String($(a).attr("href") || "").split("#")[0];
      if (!text || !path) {
        return;
      }
      const timeSpan = $(a).find(".minor-lapse, span.minor-lapse").text().trim() || null;
      const normalizedKey = canonicalAddressKey(text, timeSpan);
      const base = {
        kind: "address",
        label: text,
        path,
        timeRange: timeSpan,
        isCurrent: Boolean(isCurrent),
        normalizedKey,
      };
      const full = { ...base, ...addressPresentation(base) };
      const nextPeriod = buildAddressPeriod(full);
      const prev = addressByKey.get(normalizedKey);
      if (!prev) {
        addressByKey.set(normalizedKey, {
          ...full,
          periods: [nextPeriod],
        });
        return;
      }
      const preferred = choosePreferredAddress(prev, full);
      addressByKey.set(normalizedKey, {
        ...preferred,
        periods: mergeAddressPeriods(prev.periods, nextPeriod),
      });
    });
  };
  addAddr("current address", true);
  addAddr("previous addresses", false);
  const addresses = normalizeAddressCurrentFlags(Array.from(addressByKey.values()));

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
        relativeByKey.set(k, { name, path, sourceId: "usphonebook_profile" });
      } else {
        const allRaw = [cur.path, path, ...(Array.isArray(cur.alternateProfilePaths) ? cur.alternateProfilePaths : [])]
          .filter((x) => x != null && String(x).trim() !== "");
        const u = uniqueProfilePaths(allRaw);
        if (!u.length) {
          relativeByKey.set(k, {
            name: name.length > cur.name.length ? name : cur.name,
            path: cur.path,
            sourceId: "usphonebook_profile",
          });
        } else {
          const [primary, ...alts] = u;
          const nName = name.length > cur.name.length ? name : cur.name;
          const next = { name: nName, path: primary, sourceId: "usphonebook_profile" };
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

  const workplaces = [];
  const seenWorkKey = new Set();
  const education = [];
  const seenEduKey = new Set();
  scope.find(".workplace-expandable-list").each((_, listRoot) => {
    const $listRoot = $(listRoot);
    const sectionTitle = $listRoot.find(".ls_contacts__title h3").first().text().toLowerCase();
    const isWorkplace = sectionTitle.includes("workplace");
    const isEducation = sectionTitle.includes("education");
    if (!isWorkplace && !isEducation) {
      return;
    }
    $listRoot.find(".relative-card.workplace").each((_, card) => {
      const $c = $(card);
      if (isEducation) {
        const institution =
          $c.find("> p.current").first().text().replace(/\s+/g, " ").trim() || null;
        const field =
          $c.find("> p").not(".current").not(".companyName").first().text().replace(/\s+/g, " ").trim() ||
          null;
        const years = $c.find("> p.companyName").first().text().replace(/\s+/g, " ").trim() || null;
        if (!institution && !field && !years) {
          return;
        }
        const e = { institution, field, years };
        const dedupeE = [e.institution, e.field, e.years].join("|");
        if (seenEduKey.has(dedupeE)) {
          return;
        }
        seenEduKey.add(dedupeE);
        education.push(e);
        return;
      }
      const isCurrent = $c.find("> p.current").length > 0;
      const $titleP = $c.find("> p:not(.current):not(.companyName)").first();
      const $compP = $c.find("> p.companyName");
      const title = $titleP.length ? cleanField($titleP.text()) : null;
      const company = $compP.length ? cleanField($compP.text()) : null;
      const $afterCo = $compP.length ? $compP.nextAll("p") : $();
      const location = $afterCo.length > 0 ? cleanField($afterCo.eq(0).text()) : null;
      const industry = $afterCo.length > 1 ? cleanField($afterCo.eq(1).text()) : null;
      if (!title && !company) {
        return;
      }
      const w = { isCurrent: Boolean(isCurrent), title, company, location, industry };
      const dedupe = [w.isCurrent, w.title, w.company, w.location, w.industry].join("|");
      if (seenWorkKey.has(dedupe)) {
        return;
      }
      seenWorkKey.add(dedupe);
      workplaces.push(w);
    });
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

  const marital = [];
  const seenMarital = new Set();
  scope.find("ul.marital-section li").each((_, li) => {
    const $li = $(li);
    let $a = null;
    for (const el of $li.find("a[href^='/']").toArray()) {
      if (!isJunkLink($, el)) {
        $a = $(el);
        break;
      }
    }
    const $labelPart = $li.clone();
    $labelPart.find("a").remove();
    const role = $labelPart.text().replace(/\s+/g, " ").replace(/:\s*$/, "").trim() || null;
    if ($a && $a.length) {
      const path = String($a.attr("href") || "").split("?")[0].split("#")[0];
      const name = $a.text().replace(/\s+/g, " ").trim();
      if (!name || !path || !path.startsWith("/") || !looksLikeProfilePath(path)) {
        return;
      }
      const key = `${role || ""}|${name}|${path}`;
      if (seenMarital.has(key)) {
        return;
      }
      seenMarital.add(key);
      marital.push({ role, name, path, sourceId: "usphonebook_profile" });
    } else {
      const full = $li.text().replace(/\s+/g, " ").trim();
      if (full) {
        const key = `text|${full}`;
        if (!seenMarital.has(key)) {
          seenMarital.add(key);
          marital.push({ text: full });
        }
      }
    }
  });

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

  const subjectNameKey = normalizePersonNameKey(displayName);
  const subjectPathKey = profilePath ? profilePathnameOnly(profilePath) : "";
  const isSelfReference = (name, path) => {
    const candidateNameKey = normalizePersonNameKey(name);
    const candidatePathKey = path ? profilePathnameOnly(path) : "";
    if (subjectPathKey && candidatePathKey && subjectPathKey === candidatePathKey) {
      return true;
    }
    if (subjectNameKey && candidateNameKey && subjectNameKey === candidateNameKey) {
      return true;
    }
    return false;
  };

  const filteredRelatives = relatives.filter((rel) => !isSelfReference(rel.name, rel.path));
  const filteredMarital = marital.filter((rel) => !isSelfReference(rel.name, rel.path));

  return {
    displayName: displayName || null,
    profilePath: profilePath || null,
    aliases: [...new Set(aliases)],
    age,
    addresses,
    phones: phones.filter(
      (p, i, arr) => i === arr.findIndex((o) => o.dashed === p.dashed)
    ),
    relatives: filteredRelatives,
    associates: [],
    emails: [...new Set(emails)],
    workplaces,
    education,
    marital: filteredMarital,
  };
}
