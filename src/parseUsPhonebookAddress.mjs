import * as cheerio from "cheerio";
import { addressPresentation } from "./addressFormat.mjs";
import { isUsPhonebookPersonProfilePath, profilePathnameOnly, uniqueProfilePaths } from "./personKey.mjs";

function collapseText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeAddressKey(value) {
  return collapseText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractDashed(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length !== 10) {
    return null;
  }
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function dedupeResidents(residents) {
  const byKey = new Map();
  for (const resident of Array.isArray(residents) ? residents : []) {
    const name = collapseText(resident?.name);
    const path = profilePathnameOnly(resident?.path || "");
    if (!name && !path) {
      continue;
    }
    const key = `${name.toLowerCase()}|${path}`;
    const prev = byKey.get(key);
    const alternateProfilePaths = uniqueProfilePaths([
      ...(Array.isArray(prev?.alternateProfilePaths) ? prev.alternateProfilePaths : []),
      ...(Array.isArray(resident?.alternateProfilePaths) ? resident.alternateProfilePaths : []),
    ]);
    byKey.set(key, {
      name,
      path: path || null,
      role: prev?.role || collapseText(resident?.role) || null,
      isCurrent: Boolean(prev?.isCurrent || resident?.isCurrent),
      ...(alternateProfilePaths.length ? { alternateProfilePaths } : {}),
    });
  }
  return Array.from(byKey.values());
}

function dedupeBusinesses(businesses) {
  const byKey = new Map();
  for (const business of Array.isArray(businesses) ? businesses : []) {
    const name = collapseText(business?.name);
    if (!name) {
      continue;
    }
    const key = name.toLowerCase();
    const prev = byKey.get(key);
    const phones = [];
    const seen = new Set();
    for (const phone of [...(prev?.phones || []), ...(business?.phones || [])]) {
      const dashed = collapseText(phone?.dashed);
      if (!dashed || seen.has(dashed)) {
        continue;
      }
      seen.add(dashed);
      phones.push({
        dashed,
        display: collapseText(phone?.display) || dashed,
        isCurrent: phone?.isCurrent === true,
      });
    }
    byKey.set(key, {
      name,
      path: prev?.path || profilePathnameOnly(business?.path || "") || null,
      category: prev?.category || collapseText(business?.category) || null,
      website: prev?.website || collapseText(business?.website) || null,
      phones,
    });
  }
  return Array.from(byKey.values());
}

function collectResidents($, scope, role) {
  const residents = [];
  scope.find("a[href]").each((_, el) => {
    const $el = $(el);
    const href = profilePathnameOnly($el.attr("href") || "");
    if (!isUsPhonebookPersonProfilePath(href) || /^\/business\//i.test(href)) {
      return;
    }
    const name = collapseText($el.text());
    if (!name) {
      return;
    }
    residents.push({
      name,
      path: href,
      role,
      isCurrent: /current/i.test(collapseText($el.closest("li, div, tr").text())),
    });
  });
  return residents;
}

function collectBusinesses($, scope) {
  const businesses = [];
  scope.find("li, .business, .card, .row, tr, div").each((_, el) => {
    const $el = $(el);
    const text = collapseText($el.text());
    if (!text) {
      return;
    }
    const anchors = $el.find("a[href]").toArray();
    const businessAnchor = anchors.find((anchor) => {
      const href = String($(anchor).attr("href") || "").trim();
      return href
        && !href.includes("/address/")
        && !href.includes("/phone-search/")
        && (!isUsPhonebookPersonProfilePath(href) || /^\/business\//i.test(href));
    });
    if (!businessAnchor && anchors.some((anchor) => isUsPhonebookPersonProfilePath($(anchor).attr("href") || ""))) {
      return;
    }
    const name = businessAnchor ? collapseText($(businessAnchor).text()) : collapseText(text.split(/\(|\-|\u2022/)[0]);
    if (!name || /residents|household|phone numbers?/i.test(name)) {
      return;
    }
    const phones = [];
    for (const match of text.match(/\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/g) || []) {
      const dashed = extractDashed(match);
      if (!dashed) {
        continue;
      }
      phones.push({ dashed, display: collapseText(match), isCurrent: true });
    }
    if (!businessAnchor && !phones.length) {
      return;
    }
    businesses.push({
      name,
      path: businessAnchor ? profilePathnameOnly($(businessAnchor).attr("href") || "") || null : null,
      phones,
    });
  });
  return businesses;
}

/**
 * @param {string} html
 * @param {string | null | undefined} documentUrl
 * @returns {object}
 */
export function parseUsPhonebookAddressHtml(html, documentUrl) {
  const $ = cheerio.load(html);
  const scope = $(".phase2-section, .success-wrapper-block, body").first();

  let addressLabel = collapseText(scope.find("h1, h2, h3, .address, .address-title, .main-address").first().text());
  if (!addressLabel) {
    addressLabel = collapseText(scope.find('a[href*="/address/"]').first().text());
  }
  const documentPath = profilePathnameOnly(documentUrl || "") || null;
  const addressBase = {
    label: addressLabel || documentPath || null,
    path: documentPath,
    normalizedKey: normalizeAddressKey(addressLabel || documentPath || ""),
  };
  const address = addressBase.label && addressBase.normalizedKey
    ? { ...addressBase, ...addressPresentation(addressBase) }
    : null;

  const residents = [];
  const businesses = [];

  scope.find("h2, h3, .ls_contacts__title, .section-title").each((_, heading) => {
    const $heading = $(heading);
    const headingText = collapseText($heading.text()).toLowerCase();
    const sectionRoot = $heading.parent();
    const section = sectionRoot.nextUntil("h2, h3, .ls_contacts__title, .section-title").addBack();
    const searchScope = section.length ? section : sectionRoot;
    if (headingText.includes("resident") || headingText.includes("household")) {
      residents.push(...collectResidents($, searchScope, headingText.includes("household") ? "household_member" : "resident"));
    }
    if (headingText.includes("business")) {
      businesses.push(...collectBusinesses($, searchScope));
    }
  });

  if (!residents.length) {
    residents.push(...collectResidents($, scope, "resident"));
  }

  return {
    source: "usphonebook",
    sourceId: "usphonebook_profile",
    documentType: "address_document",
    documentPath,
    address,
    residents: dedupeResidents(residents),
    businesses: dedupeBusinesses(businesses),
  };
}