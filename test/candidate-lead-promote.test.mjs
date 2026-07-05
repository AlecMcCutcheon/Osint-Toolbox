import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.SQLITE_PATH = join(tmpdir(), `usphonebook-candidate-promote-${process.pid}.sqlite`);
process.env.RUVECTOR_ENABLE = "0";

const db = await import("../src/db/db.mjs");
const candidateLeads = await import("../src/candidateLeads.mjs");
const { mergeGraphItems } = await import("../src/graphRebuild.mjs");
const { normalizeProfileLookupPayload } = await import("../src/normalizedResult.mjs");
const { upsertSourceDocument } = await import("../src/sourceDocuments.mjs");

const { deleteDatabaseFileAndReopen, closeDatabase, getDb } = db;
const { markCandidateLeadPromoted, upsertCandidateLead } = candidateLeads;

test.beforeEach(() => {
  deleteDatabaseFileAndReopen();
});

test.after(() => {
  closeDatabase();
});

test("markCandidateLeadPromoted stores promotion metadata and mergeGraphItems creates graph facts", async () => {
  const lead = upsertCandidateLead({
    sourceId: "usphonebook_name_search",
    url: "https://www.usphonebook.com/jane-doe/abc",
    label: "Jane Doe",
  });
  const normalized = normalizeProfileLookupPayload({
    url: "https://www.usphonebook.com/jane-doe/abc",
    profile: {
      displayName: "Jane Doe",
      profilePath: "/jane-doe/abc",
      phones: [{ dashed: "207-555-1212", display: "(207) 555-1212", isCurrent: true }],
      addresses: [],
      relatives: [],
      aliases: [],
      emails: [],
    },
  });
  const { itemResults } = await mergeGraphItems([{ normalized, runId: lead.id }]);
  const graphIngest = itemResults[0]?.graphIngest || null;
  const sourceDocumentId = upsertSourceDocument({
    sourceId: "usphonebook",
    kind: "profile_lookup",
    normalized,
    fetchMeta: { engine: "flare" },
    graphIngest,
  });
  const promoted = markCandidateLeadPromoted(lead.id, {
    entityId: graphIngest?.personId || null,
    sourceDocumentId,
    graphIngest,
  });

  assert.equal(promoted.reviewStatus, "promoted");
  assert.equal(promoted.context.promotedSourceDocumentId, sourceDocumentId);
  assert.ok(promoted.context.promotedGraphIngest?.personId);
  assert.equal(getDb().prepare("SELECT COUNT(*) as c FROM entities WHERE type = 'person'").get().c, 1);
});
