import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.SQLITE_PATH = join(tmpdir(), `usphonebook-source-docs-${process.pid}.sqlite`);

const db = await import("../src/db/db.mjs");
const sourceDocuments = await import("../src/sourceDocuments.mjs");

const { deleteDatabaseFileAndReopen, closeDatabase } = db;
const {
  getSourceDocument,
  hashNormalizedDocument,
  updateSourceDocumentGraphIngest,
  upsertSourceDocument,
} = sourceDocuments;

const sampleNormalized = {
  schemaVersion: 1,
  source: "usphonebook",
  kind: "phone_search",
  query: { phoneDashed: "207-242-0526" },
  meta: { graphEligible: true, url: "https://www.usphonebook.com/phone-search/207-242-0526" },
  summary: {},
  records: [{ recordId: "phone:207-242-0526", recordType: "phone_listing", displayName: "Test Person" }],
};

test.beforeEach(() => {
  deleteDatabaseFileAndReopen();
});

test.after(() => {
  closeDatabase();
});

test("hashNormalizedDocument is stable for identical payloads", () => {
  const a = hashNormalizedDocument(sampleNormalized);
  const b = hashNormalizedDocument({ ...sampleNormalized });
  assert.equal(a, b);
  assert.match(a, /^[a-f0-9]{64}$/);
});

test("upsertSourceDocument is idempotent by source, kind, and content hash", () => {
  const firstId = upsertSourceDocument({
    sourceId: "usphonebook",
    kind: "phone_search",
    url: sampleNormalized.meta.url,
    query: sampleNormalized.query,
    normalized: sampleNormalized,
    fetchMeta: { engine: "flare" },
    graphIngest: null,
  });
  const secondId = upsertSourceDocument({
    sourceId: "usphonebook",
    kind: "phone_search",
    url: sampleNormalized.meta.url,
    query: sampleNormalized.query,
    normalized: sampleNormalized,
    fetchMeta: { engine: "playwright-local" },
    graphIngest: { linkedIds: { primaryPerson: "person-1" } },
  });
  assert.equal(secondId, firstId);
  const stored = getSourceDocument(firstId);
  assert.ok(stored);
  assert.equal(stored.fetchMeta.engine, "playwright-local");
  assert.equal(stored.graphIngest.linkedIds.primaryPerson, "person-1");
});

test("updateSourceDocumentGraphIngest updates graph metadata", () => {
  const id = upsertSourceDocument({
    sourceId: "usphonebook",
    kind: "phone_search",
    normalized: sampleNormalized,
    fetchMeta: {},
    graphIngest: null,
  });
  const updated = updateSourceDocumentGraphIngest(id, {
    personId: "person-abc",
    runId: "run-1",
  });
  assert.equal(updated.id, id);
  assert.equal(updated.graphIngest.personId, "person-abc");
});
