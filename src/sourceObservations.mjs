import { normalizeUsPhoneDigits } from "./phoneEnrichment.mjs";
import { addressPresentation } from "./addressFormat.mjs";

/**
 * @param {string | null | undefined} value
 * @returns {string}
 */
export function normalizeNameKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * @param {string | null | undefined} value
 * @returns {string}
 */
export function normalizeEmailKey(value) {
  return String(value || "").trim().toLowerCase();
}

/**
 * @param {string | null | undefined} value
 * @returns {string}
 */
export function normalizeAddressKey(value) {
  const addr = { label: String(value || "").trim() };
  const pres = addressPresentation(addr);
  return String(pres.formattedFull || addr.label || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * @param {Array<{ key: string; label: string; source: string; extras?: object }>} items
 * @returns {Array<{ key: string; label: string; sources: string[]; extras?: object[] }>}
 */
function mergeSimpleItems(items) {
  const byKey = new Map();
  for (const item of items) {
    if (!item.key) {
      continue;
    }
    const prev = byKey.get(item.key);
    if (!prev) {
      byKey.set(item.key, {
        key: item.key,
        label: item.label,
        sources: [item.source],
        extras: item.extras ? [item.extras] : [],
      });
      continue;
    }
    if (!prev.sources.includes(item.source)) {
      prev.sources.push(item.source);
    }
    if ((!prev.label || prev.label.length < item.label.length) && item.label) {
      prev.label = item.label;
    }
    if (item.extras) {
      prev.extras.push(item.extras);
    }
  }
  return Array.from(byKey.values()).sort((a, b) => b.sources.length - a.sources.length || a.label.localeCompare(b.label));
}

/**
 * @param {Array<object>} sourceResults
 * @returns {object}
 */
export function mergePeopleFinderFacts(sourceResults) {
  const names = [];
  const phones = [];
  const addresses = [];
  const emails = [];
  const relatives = [];
  for (const result of Array.isArray(sourceResults) ? sourceResults : []) {
    if (!result || result.status !== "ok" || !Array.isArray(result.people)) {
      continue;
    }
    for (const person of result.people) {
      const source = result.source || "unknown";
      const displayName = String(person.displayName || "").trim();
      const nameKey = normalizeNameKey(displayName);
      if (nameKey) {
        names.push({ key: nameKey, label: displayName, source, extras: { age: person.age ?? null } });
      }
      for (const phone of Array.isArray(person.phones) ? person.phones : []) {
        const norm = normalizeUsPhoneDigits(phone.dashed || phone.display || "");
        if (norm.dashed) {
          phones.push({
            key: norm.dashed,
            label: norm.dashed,
            source,
            extras: {
              lineType: phone.lineType || null,
              serviceProvider: phone.serviceProvider || null,
              belongsTo: displayName || null,
            },
          });
        }
      }
      for (const address of Array.isArray(person.addresses) ? person.addresses : []) {
        const label = String(address.formattedFull || address.label || "").trim();
        const key = normalizeAddressKey(label);
        if (key) {
          addresses.push({ key, label, source, extras: { belongsTo: displayName || null } });
        }
      }
      for (const email of Array.isArray(person.emails) ? person.emails : []) {
        const key = normalizeEmailKey(email);
        if (key) {
          emails.push({ key, label: key, source, extras: { belongsTo: displayName || null } });
        }
      }
      for (const relative of Array.isArray(person.relatives) ? person.relatives : []) {
        const label = String(relative.name || relative.displayName || "").trim();
        const key = normalizeNameKey(label);
        if (key) {
          relatives.push({ key, label, source, extras: { belongsTo: displayName || null } });
        }
      }
    }
  }
  return {
    names: mergeSimpleItems(names),
    phones: mergeSimpleItems(phones),
    addresses: mergeSimpleItems(addresses),
    emails: mergeSimpleItems(emails),
    relatives: mergeSimpleItems(relatives),
  };
}
