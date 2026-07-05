import {
  clearAllGraphRows,
  mergeDuplicatePersonEntitiesByName,
  pruneIsolatedEntityNodes,
} from "./graphMaintenance.mjs";
import {
  clearPersonPathKeyIndex,
  ingestAddressDocumentParsed,
  ingestPhoneSearchParsed,
  ingestProfileParsed,
} from "./entityIngest.mjs";
import { enrichProfilePayload } from "./addressEnrichment.mjs";
import { enrichPhoneSearchParsedResult } from "./phoneEnrichment.mjs";
import { graphRebuildItemFromNormalized, isNormalizedEnriched, stampNormalizedEnriched } from "./normalizedResult.mjs";

/**
 * @param {string | null | undefined} id
 * @param {Record<string, string>} idRemap
 * @returns {string | null}
 */
function remapEntityId(id, idRemap) {
  if (id == null || id === "") {
    return id == null ? null : "";
  }
  let current = String(id);
  const seen = new Set();
  while (idRemap[current] && !seen.has(current)) {
    seen.add(current);
    current = idRemap[current];
  }
  return current;
}

/**
 * @param {object | null | undefined} graphIngest
 * @param {Record<string, string>} idRemap
 * @returns {object | null | undefined}
 */
function remapGraphIngestPersonIds(graphIngest, idRemap) {
  if (!graphIngest || typeof graphIngest !== "object" || !Object.keys(idRemap).length) {
    return graphIngest;
  }
  const next = { ...graphIngest };
  if (next.personId) {
    next.personId = remapEntityId(next.personId, idRemap);
  }
  if (next.linkedIds && typeof next.linkedIds === "object") {
    const linked = { ...next.linkedIds };
    if (linked.primaryPerson) {
      linked.primaryPerson = remapEntityId(linked.primaryPerson, idRemap);
    }
    if (Array.isArray(linked.relatives)) {
      linked.relatives = linked.relatives.map((relId) => remapEntityId(relId, idRemap));
    }
    next.linkedIds = linked;
  }
  if (Array.isArray(next.residentIds)) {
    next.residentIds = next.residentIds.map((relId) => remapEntityId(relId, idRemap));
  }
  return next;
}

/**
 * @param {Array<{ runId: string | null; kind: string; graphIngest: object }>} itemResults
 * @returns {Array<{ runId: string | null; kind: string; graphIngest: object }>}
 */
function finalizeGraphItemResults(itemResults) {
  const { idRemap } = mergeDuplicatePersonEntitiesByName();
  pruneIsolatedEntityNodes();
  if (!Object.keys(idRemap).length) {
    return itemResults;
  }
  return itemResults.map((item) => {
    if (!item?.graphIngest) {
      return item;
    }
    return {
      ...item,
      graphIngest: remapGraphIngestPersonIds(item.graphIngest, idRemap),
    };
  });
}

/**
 * @param {object} it
 * @returns {Promise<{ runId: string | null; kind: string; graphIngest: object } | null>}
 */
async function ingestGraphItem(it) {
  if (!it || typeof it !== "object") {
    return null;
  }
  const normalizedConverted = it.normalized ? graphRebuildItemFromNormalized(it.normalized, it.runId || undefined) : null;
  if (normalizedConverted) {
    if (normalizedConverted.kind === "phone") {
      const parsed = isNormalizedEnriched(it.normalized)
        ? normalizedConverted.parsed
        : enrichPhoneSearchParsedResult(normalizedConverted.parsed, String(normalizedConverted.dashed));
      const r = ingestPhoneSearchParsed(parsed, String(normalizedConverted.dashed), normalizedConverted.runId || undefined);
      return {
        runId: normalizedConverted.runId != null ? String(normalizedConverted.runId) : null,
        kind: "phone",
        graphIngest: {
          newFieldsByEntity: r.newFieldsByEntity,
          linkedIds: r.linkedIds,
          runId: r.runId,
        },
      };
    }
    if (normalizedConverted.kind === "enrich") {
      const ctx = normalizedConverted.contextPhone != null ? String(normalizedConverted.contextPhone) : "";
      const profile = isNormalizedEnriched(it.normalized)
        ? normalizedConverted.profile
        : await enrichProfilePayload(normalizedConverted.profile);
      const r = ingestProfileParsed(profile, ctx || null, normalizedConverted.runId || undefined);
      return {
        runId: normalizedConverted.runId != null ? String(normalizedConverted.runId) : null,
        kind: "enrich",
        graphIngest: {
          newFieldsByEntity: r.newFieldsByEntity,
          personId: r.personId,
          runId: r.runId,
        },
      };
    }
    if (normalizedConverted.kind === "address_document") {
      const r = ingestAddressDocumentParsed(normalizedConverted.document, normalizedConverted.runId || undefined);
      return {
        runId: normalizedConverted.runId != null ? String(normalizedConverted.runId) : null,
        kind: "address_document",
        graphIngest: {
          newFieldsByEntity: r.newFieldsByEntity,
          addressId: r.addressId,
          residentIds: r.residentIds,
          businessIds: r.businessIds,
          runId: r.runId,
        },
      };
    }
  }
  if (it.kind === "phone" && it.parsed && typeof it.parsed === "object" && it.dashed) {
    const parsed = enrichPhoneSearchParsedResult(it.parsed, String(it.dashed));
    const r = ingestPhoneSearchParsed(parsed, String(it.dashed), it.runId || undefined);
    return {
      runId: it.runId != null ? String(it.runId) : null,
      kind: "phone",
      graphIngest: {
        newFieldsByEntity: r.newFieldsByEntity,
        linkedIds: r.linkedIds,
        runId: r.runId,
      },
    };
  }
  if (it.kind === "enrich" && it.profile && typeof it.profile === "object") {
    const ctx = it.contextPhone != null ? String(it.contextPhone) : "";
    const profile = await enrichProfilePayload(it.profile);
    const r = ingestProfileParsed(profile, ctx || null, it.runId || undefined);
    return {
      runId: it.runId != null ? String(it.runId) : null,
      kind: "enrich",
      graphIngest: {
        newFieldsByEntity: r.newFieldsByEntity,
        personId: r.personId,
        runId: r.runId,
      },
    };
  }
  if (it.kind === "address_document" && it.document && typeof it.document === "object") {
    const r = ingestAddressDocumentParsed(it.document, it.runId || undefined);
    return {
      runId: it.runId != null ? String(it.runId) : null,
      kind: "address_document",
      graphIngest: {
        newFieldsByEntity: r.newFieldsByEntity,
        addressId: r.addressId,
        residentIds: r.residentIds,
        businessIds: r.businessIds,
        runId: r.runId,
      },
    };
  }
  return null;
}

/**
 * Replace the graph with a full re-ingest of completed jobs (queue order).
 * @param {Array<object>} items
 * @returns {{ itemResults: Array<{ runId: string | null; kind: string; graphIngest: object }> }}
 */
export async function rebuildGraphFromQueueItems(items) {
  clearPersonPathKeyIndex();
  clearAllGraphRows();
  const itemResults = [];
  const list = Array.isArray(items) ? items : [];
  for (const it of list) {
    const result = await ingestGraphItem(it);
    if (result) {
      itemResults.push(result);
    }
  }
  return { itemResults: finalizeGraphItemResults(itemResults) };
}

/**
 * Non-destructive ingest: add items to the existing graph without clearing first.
 * @param {Array<object>} items
 * @returns {{ itemResults: Array<{ runId: string | null; kind: string; graphIngest: object }> }}
 */
export async function mergeGraphItems(items) {
  const itemResults = [];
  const list = Array.isArray(items) ? items : [];
  for (const it of list) {
    const result = await ingestGraphItem(it);
    if (result) {
      itemResults.push(result);
    }
  }
  return { itemResults: finalizeGraphItemResults(itemResults) };
}
