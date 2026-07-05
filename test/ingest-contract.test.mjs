import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.SQLITE_PATH = join(tmpdir(), `usphonebook-ingest-contract-${process.pid}.sqlite`);
process.env.RUVECTOR_ENABLE = "0";

const db = await import("../src/db/db.mjs");
const { ingestAndPersistNormalized } = await import("../src/graphIngestPipeline.mjs");
const { normalizePhoneSearchPayload } = await import("../src/normalizedResult.mjs");
const { getSourceDocument } = await import("../src/sourceDocuments.mjs");

const { deleteDatabaseFileAndReopen, closeDatabase, getDb } = db;

test.beforeEach(() => {
  deleteDatabaseFileAndReopen();
});

test.after(() => {
  closeDatabase();
});

test("ingestAndPersistNormalized writes graph and source document when ingest is enabled", async () => {
  const normalized = normalizePhoneSearchPayload(
    {
      parsed: {
        currentOwner: { displayName: "Casey Example" },
        linePhone: "(207) 333-4444",
        profilePath: "/casey-example/abc",
        relatives: [],
      },
    },
    "207-333-4444"
  );

  const result = await ingestAndPersistNormalized({
    normalized,
    url: "https://www.usphonebook.com/phone-search/207-333-4444",
    fetchMeta: { engine: "flare" },
    runId: "run-1",
    doIngest: true,
  });

  assert.ok(result.sourceDocumentId);
  assert.ok(result.graphIngest?.linkedIds?.primaryPerson);
  const stored = getSourceDocument(result.sourceDocumentId);
  assert.ok(stored?.normalized?.meta?.enrichedAt);
  assert.equal(getDb().prepare("SELECT COUNT(*) as c FROM entities").get().c, 2);
});

test("ingestAndPersistNormalized persists source document without graph mutation when ingest is disabled", async () => {
  const normalized = normalizePhoneSearchPayload(
    {
      parsed: {
        currentOwner: { displayName: "Dana Example" },
        linePhone: "(207) 444-5555",
        profilePath: "/dana-example/abc",
        relatives: [],
      },
    },
    "207-444-5555"
  );

  const result = await ingestAndPersistNormalized({
    normalized,
    fetchMeta: { engine: "flare" },
    doIngest: false,
  });

  assert.ok(result.sourceDocumentId);
  assert.equal(result.graphIngest, null);
  assert.equal(getDb().prepare("SELECT COUNT(*) as c FROM entities").get().c, 0);
});
