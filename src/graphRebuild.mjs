import {
  clearAllGraphRows,
  mergeDuplicatePersonEntitiesByName,
  pruneIsolatedEntityNodes,
} from "./graphMaintenance.mjs";
import {
  clearPersonPathKeyIndex,
  ingestPhoneSearchParsed,
  ingestProfileParsed,
} from "./entityIngest.mjs";
import { enrichProfilePayload } from "./addressEnrichment.mjs";
import { enrichPhoneSearchParsedResult } from "./phoneEnrichment.mjs";
import { graphRebuildItemFromNormalized } from "./normalizedResult.mjs";

/**
 * Replace the graph with a full re-ingest of completed jobs (queue order).
 * The client is the source of truth for which runs exist; this keeps SQLite aligned.
 * @param {Array<
 *   | { kind: "phone"; dashed: string; parsed: object; runId?: string | null }
 *   | { kind: "enrich"; contextPhone: string; profile: object; runId?: string | null }
 *   | { normalized: object; runId?: string | null }
 * >} items
 * @returns {{ itemResults: Array<{ runId: string | null; kind: string; graphIngest: object }> }}
 */
export async function rebuildGraphFromQueueItems(items) {
  clearPersonPathKeyIndex();
  clearAllGraphRows();
  const itemResults = [];
  const list = Array.isArray(items) ? items : [];
  for (const it of list) {
    if (!it || typeof it !== "object") {
      continue;
    }
    const normalizedConverted = it.normalized ? graphRebuildItemFromNormalized(it.normalized, it.runId || undefined) : null;
    if (normalizedConverted) {
      if (normalizedConverted.kind === "phone") {
        const parsed = enrichPhoneSearchParsedResult(normalizedConverted.parsed, String(normalizedConverted.dashed));
        const r = ingestPhoneSearchParsed(parsed, String(normalizedConverted.dashed), normalizedConverted.runId || undefined);
        itemResults.push({
          runId: normalizedConverted.runId != null ? String(normalizedConverted.runId) : null,
          kind: "phone",
          graphIngest: {
            newFieldsByEntity: r.newFieldsByEntity,
            linkedIds: r.linkedIds,
            runId: r.runId,
          },
        });
        continue;
      }
      if (normalizedConverted.kind === "enrich") {
        const ctx = normalizedConverted.contextPhone != null ? String(normalizedConverted.contextPhone) : "";
        const profile = await enrichProfilePayload(normalizedConverted.profile);
        const r = ingestProfileParsed(profile, ctx || null, normalizedConverted.runId || undefined);
        itemResults.push({
          runId: normalizedConverted.runId != null ? String(normalizedConverted.runId) : null,
          kind: "enrich",
          graphIngest: {
            newFieldsByEntity: r.newFieldsByEntity,
            personId: r.personId,
            runId: r.runId,
          },
        });
        continue;
      }
    }
    if (it.kind === "phone" && it.parsed && typeof it.parsed === "object" && it.dashed) {
      const parsed = enrichPhoneSearchParsedResult(it.parsed, String(it.dashed));
      const r = ingestPhoneSearchParsed(parsed, String(it.dashed), it.runId || undefined);
      itemResults.push({
        runId: it.runId != null ? String(it.runId) : null,
        kind: "phone",
        graphIngest: {
          newFieldsByEntity: r.newFieldsByEntity,
          linkedIds: r.linkedIds,
          runId: r.runId,
        },
      });
    } else if (it.kind === "enrich" && it.profile && typeof it.profile === "object") {
      const ctx = it.contextPhone != null ? String(it.contextPhone) : "";
      const profile = await enrichProfilePayload(it.profile);
      const r = ingestProfileParsed(profile, ctx || null, it.runId || undefined);
      itemResults.push({
        runId: it.runId != null ? String(it.runId) : null,
        kind: "enrich",
        graphIngest: {
          newFieldsByEntity: r.newFieldsByEntity,
          personId: r.personId,
          runId: r.runId,
        },
      });
    }
  }
  mergeDuplicatePersonEntitiesByName();
  pruneIsolatedEntityNodes();
  return { itemResults };
}
