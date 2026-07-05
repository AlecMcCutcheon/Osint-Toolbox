import { mergeGraphItems } from "./graphRebuild.mjs";
import { upsertSourceDocument } from "./sourceDocuments.mjs";
import { isNormalizedEnriched, stampNormalizedEnriched } from "./normalizedResult.mjs";

/**
 * @param {object | null | undefined} profile
 * @param {number} [cap]
 * @returns {string[]}
 */
export function selectAddressPathsFromProfile(profile, cap = 3) {
  const addresses = Array.isArray(profile?.addresses) ? profile.addresses : [];
  const withPath = addresses
    .filter((address) => {
      const path = String(address?.path || "").trim();
      return path.startsWith("/");
    })
    .sort((a, b) => Number(b?.isCurrent === true) - Number(a?.isCurrent === true));
  const seen = new Set();
  const out = [];
  for (const address of withPath) {
    const path = String(address.path).split("?")[0].trim();
    if (!path || seen.has(path)) {
      continue;
    }
    seen.add(path);
    out.push(path);
    if (out.length >= cap) {
      break;
    }
  }
  return out;
}

/**
 * @param {{
 *   normalized: object;
 *   url?: string | null;
 *   query?: object;
 *   fetchMeta?: object;
 *   runId?: string | null;
 *   doIngest?: boolean;
 * }} input
 * @returns {Promise<{ graphIngest: object | null; sourceDocumentId: string }>}
 */
export async function ingestAndPersistNormalized(input) {
  const normalized = input.normalized;
  if (!normalized || typeof normalized !== "object") {
    throw new Error("normalized document is required");
  }
  const sourceId = String(normalized.source || "unknown");
  const kind = String(normalized.kind || "unknown");
  let graphIngest = null;
  if (input.doIngest === true && normalized.meta?.graphEligible === true) {
    const stamped = isNormalizedEnriched(normalized) ? normalized : stampNormalizedEnriched(normalized);
    const { itemResults } = await mergeGraphItems([{ normalized: stamped, runId: input.runId || null }]);
    graphIngest = itemResults[0]?.graphIngest || null;
  }
  const storedNormalized =
    input.doIngest === true && normalized.meta?.graphEligible === true
      ? isNormalizedEnriched(normalized)
        ? normalized
        : stampNormalizedEnriched(normalized)
      : normalized;
  const sourceDocumentId = upsertSourceDocument({
    sourceId,
    kind,
    url: input.url || normalized.meta?.url || null,
    query: input.query || normalized.query || {},
    normalized: storedNormalized,
    fetchMeta: input.fetchMeta || {},
    graphIngest,
  });
  return { graphIngest, sourceDocumentId };
}
