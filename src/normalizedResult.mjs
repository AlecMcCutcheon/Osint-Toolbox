const NORMALIZED_SCHEMA_VERSION = 1;

/**
 * @param {Record<string, any>} obj
 * @returns {Record<string, any>}
 */
function compactObject(obj) {
  const out = {};
  for (const [key, value] of Object.entries(obj || {})) {
    if (value == null) {
      continue;
    }
    if (Array.isArray(value)) {
      if (!value.length) {
        continue;
      }
      out[key] = value;
      continue;
    }
    if (typeof value === "object") {
      const nested = compactObject(value);
      if (!Object.keys(nested).length) {
        continue;
      }
      out[key] = nested;
      continue;
    }
    if (value === "") {
      continue;
    }
    out[key] = value;
  }
  return out;
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function cleanText(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text || null;
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function cleanStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => cleanText(item)).filter(Boolean);
}

/**
 * @param {string | null | undefined} path
 * @returns {string | null}
 */
function normalizePath(path) {
  const text = cleanText(path);
  if (!text) {
    return null;
  }
  return text.split("?")[0].replace(/\/+$/, "") || null;
}

/**
 * @param {object | null | undefined} relative
 * @returns {{ name: string; path: string | null; alternateProfilePaths: string[] }} | null
 */
function normalizeRelative(relative) {
  if (!relative || typeof relative !== "object") {
    return null;
  }
  const name = cleanText(relative.name);
  const path = normalizePath(relative.path);
  if (!name) {
    return null;
  }
  return compactObject({
    name,
    path,
    alternateProfilePaths: cleanStringArray(relative.alternateProfilePaths).map((item) => normalizePath(item)).filter(Boolean),
  });
}

/**
 * @param {object | null | undefined} phone
 * @returns {object | null}
 */
function normalizePhoneRecord(phone) {
  if (!phone || typeof phone !== "object") {
    return null;
  }
  const dashed = cleanText(phone.dashed);
  const display = cleanText(phone.display) || dashed;
  const phoneMetadata = phone.phoneMetadata && typeof phone.phoneMetadata === "object" ? phone.phoneMetadata : null;
  return compactObject({
    dashed,
    display,
    e164: cleanText(phoneMetadata?.e164),
    type: cleanText(phone.lineType) || cleanText(phoneMetadata?.type),
    isCurrent: phone.isCurrent === true,
    isPrimary: phone.isPrimary === true,
    country: cleanText(phoneMetadata?.country),
    phoneMetadata,
  });
}

/**
 * @param {object | null | undefined} address
 * @returns {object | null}
 */
function normalizeAddressRecord(address) {
  if (!address || typeof address !== "object") {
    return null;
  }
  const periods = Array.isArray(address.periods)
    ? address.periods
        .map((period) => ({
          label: cleanText(period?.label),
          path: normalizePath(period?.path),
          timeRange: cleanText(period?.timeRange),
          recordedRange: cleanText(period?.recordedRange),
          isCurrentObserved: period?.isCurrentObserved === true,
        }))
        .filter((period) => period.label || period.path || period.timeRange || period.recordedRange)
    : [];
  return compactObject({
    label: cleanText(address.label) || cleanText(address.formattedFull),
    formatted: cleanText(address.formattedFull) || cleanText(address.label),
    path: normalizePath(address.path),
    normalizedKey: cleanText(address.normalizedKey),
    timeRange: cleanText(address.timeRange),
    recordedRange: cleanText(address.recordedRange),
    isCurrent: address.isCurrent === true,
    isTeaser: address.isTeaser === true,
    periods,
    censusGeocode: address.censusGeocode && typeof address.censusGeocode === "object" ? address.censusGeocode : null,
    nearbyPlaces: address.nearbyPlaces && typeof address.nearbyPlaces === "object" ? address.nearbyPlaces : null,
    assessorRecords: Array.isArray(address.assessorRecords) ? address.assessorRecords : [],
  });
}

/**
 * @param {object | null | undefined} resident
 * @returns {object | null}
 */
function normalizeAddressResident(resident) {
  if (!resident || typeof resident !== "object") {
    return null;
  }
  const name = cleanText(resident.name);
  const path = normalizePath(resident.path);
  if (!name && !path) {
    return null;
  }
  return compactObject({
    name,
    path,
    alternateProfilePaths: cleanStringArray(resident.alternateProfilePaths).map((item) => normalizePath(item)).filter(Boolean),
    isCurrent: resident.isCurrent === true,
    role: cleanText(resident.role),
  });
}

/**
 * @param {object | null | undefined} business
 * @returns {object | null}
 */
function normalizeAddressBusiness(business) {
  if (!business || typeof business !== "object") {
    return null;
  }
  const name = cleanText(business.name) || cleanText(business.displayName);
  if (!name) {
    return null;
  }
  const phones = Array.isArray(business.phones)
    ? business.phones.map(normalizePhoneRecord).filter(Boolean)
    : business.phone
      ? [normalizePhoneRecord(business.phone)].filter(Boolean)
      : [];
  return compactObject({
    name,
    category: cleanText(business.category),
    path: normalizePath(business.path),
    phones,
    website: cleanText(business.website),
  });
}

/**
 * @param {object} normalized
 * @returns {object}
 */
function freezeEnvelope(normalized) {
  return compactObject({
    schemaVersion: NORMALIZED_SCHEMA_VERSION,
    source: normalized.source || "usphonebook",
    kind: normalized.kind,
    query: normalized.query || {},
    meta: normalized.meta || {},
    summary: normalized.summary || {},
    records: Array.isArray(normalized.records) ? normalized.records : [],
  });
}

/**
 * @param {object} payload
 * @param {string} dashed
 * @returns {object}
 */
export function normalizePhoneSearchPayload(payload, dashed) {
  const parsed = payload?.parsed && typeof payload.parsed === "object" ? payload.parsed : {};
  const owner = parsed.currentOwner && typeof parsed.currentOwner === "object" ? parsed.currentOwner : null;
  const ownerName = cleanText(owner?.displayName) || cleanText([owner?.givenName, owner?.familyName].filter(Boolean).join(" "));
  const profilePath = normalizePath(parsed.profilePath);
  const linePhone = cleanText(parsed.linePhone) || cleanText(dashed);
  const primaryPhone = normalizePhoneRecord({
    dashed: cleanText(dashed),
    display: linePhone,
    isCurrent: true,
    isPrimary: true,
    phoneMetadata: payload?.phoneMetadata || parsed.lookupPhoneMetadata || null,
  });
  const relatives = Array.isArray(parsed.relatives) ? parsed.relatives.map(normalizeRelative).filter(Boolean) : [];
  const records = ownerName || profilePath || linePhone
    ? [
        compactObject({
          recordId: profilePath || (linePhone ? `phone:${linePhone}` : `phone:${cleanText(dashed) || "unknown"}`),
          recordType: "phone_listing",
          displayName: ownerName,
          profilePath,
          age: null,
          aliases: [],
          emails: [],
          phones: primaryPhone ? [primaryPhone] : [],
          addresses: parsed.fullAddressTeaser
            ? [
                {
                  label: "Full address available on source page",
                  formatted: "Full address available on source page",
                  path: null,
                  normalizedKey: null,
                  timeRange: null,
                  recordedRange: null,
                  isCurrent: true,
                  isTeaser: true,
                  periods: [],
                  censusGeocode: null,
                  nearbyPlaces: null,
                  assessorRecords: [],
                },
              ]
            : [],
          relatives,
          sourceFields: {
            currentOwner: owner,
            linePhone,
            fullAddressTeaser: parsed.fullAddressTeaser === true,
            externalSources: payload?.externalSources || parsed.externalSources || null,
          },
        }),
      ]
    : [];
  return freezeEnvelope({
    kind: "phone_search",
    source: "usphonebook",
    query: {
      phoneDashed: cleanText(dashed),
      phoneDisplay: linePhone,
    },
    meta: {
      url: cleanText(payload?.url),
      httpStatus: payload?.httpStatus ?? null,
      userAgent: cleanText(payload?.userAgent),
      rawHtmlLength: payload?.rawHtmlLength ?? null,
      cached: payload?.cached === true,
      cachedAt: cleanText(payload?.cachedAt),
      graphEligible: true,
      recordCount: records.length,
    },
    summary: {
      primaryDisplayName: ownerName,
      relativeCount: relatives.length,
      hasProfile: Boolean(profilePath),
    },
    records,
  });
}

/**
 * @param {object} payload
 * @returns {object}
 */
export function normalizeNameSearchPayload(payload) {
  const parsed = payload?.parsed && typeof payload.parsed === "object" ? payload.parsed : {};
  const candidates = Array.isArray(parsed.candidates) ? parsed.candidates : [];
  const records = candidates.map((candidate, index) => {
    const profilePath = normalizePath(candidate?.profilePath);
    const currentCityState = cleanText(candidate?.currentCityState);
    const addresses = [];
    if (currentCityState) {
      addresses.push({
        label: currentCityState,
        formatted: currentCityState,
        path: null,
        normalizedKey: null,
        timeRange: null,
        recordedRange: null,
        isCurrent: true,
        isTeaser: false,
        periods: [],
        censusGeocode: null,
        nearbyPlaces: null,
        assessorRecords: [],
      });
    }
    for (const prior of cleanStringArray(candidate?.priorAddresses)) {
      addresses.push({
        label: prior,
        formatted: prior,
        path: null,
        normalizedKey: null,
        timeRange: null,
        recordedRange: null,
        isCurrent: false,
        isTeaser: false,
        periods: [],
        censusGeocode: null,
        nearbyPlaces: null,
        assessorRecords: [],
      });
    }
    return compactObject({
      recordId: profilePath || `candidate:${index + 1}`,
      recordType: "person_candidate",
      displayName: cleanText(candidate?.displayName),
      profilePath,
      age: candidate?.age ?? null,
      aliases: [],
      emails: [],
      phones: [],
      addresses,
      relatives: Array.isArray(candidate?.relatives) ? candidate.relatives.map(normalizeRelative).filter(Boolean) : [],
      sourceFields: {
        currentCityState,
      },
    });
  });
  return freezeEnvelope({
    kind: "name_search",
    source: "usphonebook",
    query: {
      name: cleanText(payload?.search?.name) || cleanText(parsed.queryName),
      city: cleanText(payload?.search?.city),
      state: cleanText(payload?.search?.state),
      path: normalizePath(payload?.search?.path),
    },
    meta: {
      url: cleanText(payload?.url),
      httpStatus: payload?.httpStatus ?? null,
      userAgent: cleanText(payload?.userAgent),
      rawHtmlLength: payload?.rawHtmlLength ?? null,
      cached: payload?.cached === true,
      cachedAt: cleanText(payload?.cachedAt),
      graphEligible: false,
      recordCount: records.length,
    },
    summary: {
      totalRecords: parsed.totalRecords ?? records.length,
      totalPages: parsed.totalPages ?? null,
      summaryText: cleanText(parsed.summaryText),
    },
    records,
  });
}

/**
 * @param {object} payload
 * @returns {object}
 */
export function normalizeProfileLookupPayload(payload) {
  const profile = payload?.profile && typeof payload.profile === "object" ? payload.profile : {};
  const profilePath = normalizePath(profile.profilePath) || normalizePath(payload?.url);
  const record = compactObject({
    recordId: profilePath || "profile:unknown",
    recordType: "person_profile",
    displayName: cleanText(profile.displayName),
    profilePath,
    age: profile.age ?? null,
    aliases: cleanStringArray(profile.aliases),
    emails: cleanStringArray(profile.emails),
    phones: Array.isArray(profile.phones) ? profile.phones.map(normalizePhoneRecord).filter(Boolean) : [],
    addresses: Array.isArray(profile.addresses) ? profile.addresses.map(normalizeAddressRecord).filter(Boolean) : [],
    relatives: Array.isArray(profile.relatives) ? profile.relatives.map(normalizeRelative).filter(Boolean) : [],
    sourceFields: {
      workplaces: Array.isArray(profile.workplaces) ? profile.workplaces : [],
      education: Array.isArray(profile.education) ? profile.education : [],
      marital: Array.isArray(profile.marital) ? profile.marital : [],
    },
  });
  return freezeEnvelope({
    kind: "profile_lookup",
    source: profile.sourceId || profile.source || "usphonebook",
    query: {
      profilePath,
      contextPhone: cleanText(payload?.contextPhone),
    },
    meta: {
      url: cleanText(payload?.url),
      httpStatus: payload?.httpStatus ?? null,
      userAgent: cleanText(payload?.userAgent),
      rawHtmlLength: payload?.rawHtmlLength ?? null,
      cached: payload?.cached === true,
      cachedAt: cleanText(payload?.cachedAt),
      graphEligible: true,
      recordCount: record.recordId === "profile:unknown" && !record.displayName ? 0 : 1,
    },
    summary: {
      addressCount: Array.isArray(record.addresses) ? record.addresses.length : 0,
      phoneCount: Array.isArray(record.phones) ? record.phones.length : 0,
      relativeCount: Array.isArray(record.relatives) ? record.relatives.length : 0,
    },
    records: record.recordId === "profile:unknown" && !record.displayName ? [] : [record],
  });
}

/**
 * @param {object} payload
 * @returns {object}
 */
export function normalizeAddressDocumentPayload(payload) {
  const document = payload?.document && typeof payload.document === "object" ? payload.document : {};
  const address = normalizeAddressRecord(document.address || document);
  const documentPath = normalizePath(document.documentPath) || normalizePath(address?.path) || normalizePath(payload?.url);
  const residents = Array.isArray(document.residents)
    ? document.residents.map(normalizeAddressResident).filter(Boolean)
    : [];
  const businesses = Array.isArray(document.businesses)
    ? document.businesses.map(normalizeAddressBusiness).filter(Boolean)
    : [];
  const record = compactObject({
    recordId: documentPath || cleanText(address?.normalizedKey) || "address:unknown",
    recordType: "address_document",
    address,
    residents,
    businesses,
    sourceFields: {
      sourceId: cleanText(document.sourceId) || cleanText(payload?.sourceId),
    },
  });
  return freezeEnvelope({
    kind: "address_document",
    source: cleanText(document.sourceId) || cleanText(payload?.sourceId) || "usphonebook",
    query: {
      documentPath,
      normalizedKey: cleanText(address?.normalizedKey),
    },
    meta: {
      url: cleanText(payload?.url),
      httpStatus: payload?.httpStatus ?? null,
      userAgent: cleanText(payload?.userAgent),
      rawHtmlLength: payload?.rawHtmlLength ?? null,
      cached: payload?.cached === true,
      cachedAt: cleanText(payload?.cachedAt),
      graphEligible: true,
      recordCount: address ? 1 : 0,
    },
    summary: {
      residentCount: residents.length,
      businessCount: businesses.length,
      hasAddress: Boolean(address),
    },
    records: address ? [record] : [],
  });
}

/**
 * @param {object | null | undefined} normalized
 * @param {string | undefined} runId
 * @returns {({ kind: "phone"; dashed: string; parsed: object; runId?: string } | { kind: "enrich"; contextPhone: string; profile: object; runId?: string } | { kind: "address_document"; document: object; runId?: string }) | null}
 */
export function graphRebuildItemFromNormalized(normalized, runId) {
  if (!normalized || typeof normalized !== "object") {
    return null;
  }
  if (normalized.kind === "phone_search") {
    const record = Array.isArray(normalized.records) ? normalized.records[0] : null;
    if (!record || typeof record !== "object") {
      return null;
    }
    const dashed = cleanText(record?.phones?.[0]?.dashed) || cleanText(normalized?.query?.phoneDashed);
    if (!dashed) {
      return null;
    }
    const displayName = cleanText(record.displayName);
    const currentOwner = record?.sourceFields?.currentOwner && typeof record.sourceFields.currentOwner === "object"
      ? record.sourceFields.currentOwner
      : displayName
        ? { givenName: "", familyName: "", displayName }
        : null;
    return {
      kind: "phone",
      dashed,
      runId,
      parsed: {
        currentOwner,
        linePhone: cleanText(record?.sourceFields?.linePhone) || cleanText(record?.phones?.[0]?.display) || dashed,
        profilePath: normalizePath(record.profilePath),
        fullAddressTeaser: record?.sourceFields?.fullAddressTeaser === true,
        relatives: Array.isArray(record.relatives)
          ? record.relatives
              .map((rel) => normalizeRelative(rel))
              .filter((rel) => rel && rel.path)
              .map((rel) => ({
                name: rel.name,
                path: rel.path,
                ...(Array.isArray(rel.alternateProfilePaths) && rel.alternateProfilePaths.length
                  ? { alternateProfilePaths: rel.alternateProfilePaths }
                  : {}),
              }))
          : [],
        externalSources: record?.sourceFields?.externalSources || null,
        lookupPhoneMetadata: record?.phones?.[0]?.phoneMetadata || null,
      },
    };
  }
  if (normalized.kind === "profile_lookup") {
    const record = Array.isArray(normalized.records) ? normalized.records[0] : null;
    if (!record || typeof record !== "object") {
      return null;
    }
    const profilePath = normalizePath(record.profilePath) || cleanText(normalized?.query?.profilePath);
    if (!profilePath) {
      return null;
    }
    return {
      kind: "enrich",
      contextPhone: cleanText(normalized?.query?.contextPhone) || "",
      runId,
      profile: {
        displayName: cleanText(record.displayName) || "Unknown",
        profilePath,
        age: record.age ?? null,
        aliases: cleanStringArray(record.aliases),
        emails: cleanStringArray(record.emails),
        addresses: Array.isArray(record.addresses)
          ? record.addresses.map((addr) => ({
              label: cleanText(addr?.label),
              formattedFull: cleanText(addr?.formatted),
              path: normalizePath(addr?.path),
              normalizedKey: cleanText(addr?.normalizedKey),
              timeRange: cleanText(addr?.timeRange),
              recordedRange: cleanText(addr?.recordedRange),
              isCurrent: addr?.isCurrent === true,
              periods: Array.isArray(addr?.periods)
                ? addr.periods
                    .map((period) => ({
                      label: cleanText(period?.label),
                      path: normalizePath(period?.path),
                      timeRange: cleanText(period?.timeRange),
                      recordedRange: cleanText(period?.recordedRange),
                      isCurrentObserved: period?.isCurrentObserved === true,
                    }))
                    .filter((period) => period.label || period.path || period.timeRange || period.recordedRange)
                : [],
              censusGeocode: addr?.censusGeocode && typeof addr.censusGeocode === "object" ? addr.censusGeocode : null,
              nearbyPlaces: addr?.nearbyPlaces && typeof addr.nearbyPlaces === "object" ? addr.nearbyPlaces : null,
              assessorRecords: Array.isArray(addr?.assessorRecords) ? addr.assessorRecords : [],
            }))
          : [],
        phones: Array.isArray(record.phones)
          ? record.phones.map((phone) => ({
              dashed: cleanText(phone?.dashed),
              display: cleanText(phone?.display) || cleanText(phone?.dashed),
              isCurrent: phone?.isCurrent === true,
              lineType: cleanText(phone?.type),
              phoneMetadata: phone?.phoneMetadata && typeof phone.phoneMetadata === "object" ? phone.phoneMetadata : null,
            }))
          : [],
        relatives: Array.isArray(record.relatives)
          ? record.relatives
              .map((rel) => normalizeRelative(rel))
              .filter((rel) => rel && rel.path)
              .map((rel) => ({
                name: rel.name,
                path: rel.path,
                ...(Array.isArray(rel.alternateProfilePaths) && rel.alternateProfilePaths.length
                  ? { alternateProfilePaths: rel.alternateProfilePaths }
                  : {}),
              }))
          : [],
        workplaces: Array.isArray(record?.sourceFields?.workplaces) ? record.sourceFields.workplaces : [],
        education: Array.isArray(record?.sourceFields?.education) ? record.sourceFields.education : [],
        marital: Array.isArray(record?.sourceFields?.marital) ? record.sourceFields.marital : [],
      },
    };
  }
  if (normalized.kind === "address_document") {
    const record = Array.isArray(normalized.records) ? normalized.records[0] : null;
    if (!record || typeof record !== "object") {
      return null;
    }
    const address = normalizeAddressRecord(record.address);
    if (!address?.normalizedKey) {
      return null;
    }
    return {
      kind: "address_document",
      runId,
      document: {
        sourceId: cleanText(record?.sourceFields?.sourceId) || cleanText(normalized.source),
        documentPath: cleanText(normalized?.query?.documentPath) || normalizePath(address.path),
        address,
        residents: Array.isArray(record.residents)
          ? record.residents.map(normalizeAddressResident).filter(Boolean)
          : [],
        businesses: Array.isArray(record.businesses)
          ? record.businesses.map(normalizeAddressBusiness).filter(Boolean)
          : [],
      },
    };
  }
  return null;
}
