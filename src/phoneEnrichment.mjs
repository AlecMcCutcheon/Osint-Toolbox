import { parsePhoneNumberFromString } from "libphonenumber-js/max";

/**
 * @param {string | null | undefined} raw
 * @returns {{ digits: string; dashed: string | null }}
 */
export function normalizeUsPhoneDigits(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    const ten = digits.slice(1);
    return {
      digits: ten,
      dashed: `${ten.slice(0, 3)}-${ten.slice(3, 6)}-${ten.slice(6)}`,
    };
  }
  if (digits.length === 10) {
    return {
      digits,
      dashed: `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`,
    };
  }
  return { digits, dashed: null };
}

/**
 * @param {string | null | undefined} raw
 * @returns {object | null}
 */
export function enrichPhoneNumber(raw) {
  const source = String(raw || "").trim();
  if (!source) {
    return null;
  }
  const normalized = normalizeUsPhoneDigits(source);
  let parsed = null;
  try {
    parsed = parsePhoneNumberFromString(source, "US") || null;
    if (!parsed && normalized.dashed) {
      parsed = parsePhoneNumberFromString(normalized.dashed, "US") || null;
    }
  } catch {
    parsed = null;
  }
  if (!parsed && !normalized.dashed) {
    return {
      input: source,
      digits: normalized.digits || null,
      dashed: null,
      e164: null,
      international: null,
      national: null,
      country: null,
      countryCallingCode: null,
      nationalNumber: null,
      isPossible: false,
      isValid: false,
      type: null,
    };
  }
  if (!parsed) {
    return {
      input: source,
      digits: normalized.digits || null,
      dashed: normalized.dashed,
      e164: normalized.dashed ? `+1${normalized.digits}` : null,
      international: normalized.dashed ? `+1 ${normalized.dashed}` : null,
      national: normalized.dashed,
      country: "US",
      countryCallingCode: "1",
      nationalNumber: normalized.digits || null,
      isPossible: true,
      isValid: false,
      type: null,
    };
  }
  let type = null;
  try {
    type = parsed.getType() || null;
  } catch {
    type = null;
  }
  return {
    input: source,
    digits: normalized.digits || String(parsed.nationalNumber || "") || null,
    dashed: normalized.dashed,
    e164: parsed.number || null,
    international: parsed.formatInternational() || null,
    national: parsed.formatNational() || normalized.dashed || null,
    country: parsed.country || null,
    countryCallingCode: parsed.countryCallingCode || null,
    nationalNumber: String(parsed.nationalNumber || "") || null,
    isPossible: parsed.isPossible(),
    isValid: parsed.isValid(),
    type: type ? String(type).toLowerCase() : null,
  };
}

/**
 * @param {object} parsed
 * @param {string} dashed
 * @returns {object}
 */
export function enrichPhoneSearchParsedResult(parsed, dashed) {
  return {
    ...parsed,
    lookupPhoneMetadata: enrichPhoneNumber(dashed),
  };
}

/**
 * @param {object} profilePayload
 * @returns {object}
 */
export function enrichProfilePhones(profilePayload) {
  const phones = Array.isArray(profilePayload?.phones)
    ? profilePayload.phones.map((phone) => ({
        ...phone,
        phoneMetadata: phone?.phoneMetadata || enrichPhoneNumber(phone?.dashed || phone?.display || ""),
      }))
    : [];
  return {
    ...profilePayload,
    phones,
  };
}
