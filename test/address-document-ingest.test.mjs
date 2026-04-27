import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const sqlitePath = join(tmpdir(), `osint-address-doc-${process.pid}-${Date.now()}.sqlite`);

process.env.SQLITE_PATH = sqlitePath;
process.env.RUVECTOR_ENABLE = "0";

const { closeDatabase, deleteDatabaseFileAndReopen, getDb } = await import("../src/db/db.mjs");
const { mergeGraphItems } = await import("../src/graphRebuild.mjs");
const { normalizeAddressDocumentPayload } = await import("../src/normalizedResult.mjs");

test.before(() => {
  deleteDatabaseFileAndReopen();
});

test.after(() => {
  closeDatabase();
  for (const suffix of ["", "-wal", "-shm"]) {
    const filePath = `${sqlitePath}${suffix}`;
    if (existsSync(filePath)) {
      rmSync(filePath, { force: true });
    }
  }
});

test("mergeGraphItems ingests address documents into resident, co-resident, and business facts", async () => {
  deleteDatabaseFileAndReopen();

  const normalized = normalizeAddressDocumentPayload({
    url: "https://www.usphonebook.com/address/123-main-st-portland-me",
    document: {
      sourceId: "usphonebook_address",
      documentPath: "/address/123-main-st-portland-me",
      address: {
        formattedFull: "123 Main St, Portland, ME 04101",
        path: "/address/123-main-st-portland-me",
        normalizedKey: "123 main st portland me 04101",
      },
      residents: [
        { name: "John Doe", path: "/john-doe/maine/portland", isCurrent: true },
        { name: "Jane Doe", path: "/jane-doe/maine/portland", isCurrent: true },
      ],
      businesses: [
        {
          name: "Acme Plumbing",
          category: "Contractor",
          phones: [{ dashed: "207-555-0101", display: "(207) 555-0101", isCurrent: true }],
        },
      ],
    },
  });

  const result = await mergeGraphItems([{ normalized, runId: "RUN-ADDR-1" }]);
  assert.equal(result.itemResults.length, 1);
  assert.equal(result.itemResults[0].kind, "address_document");
  assert.equal(result.itemResults[0].graphIngest.residentIds.length, 2);
  assert.equal(result.itemResults[0].graphIngest.businessIds.length, 1);

  const db = getDb();
  const address = db.prepare("SELECT id, label, data_json FROM entities WHERE type = 'address'").get();
  assert.ok(address);
  assert.equal(address.label, "123 Main St, Portland, ME 04101");

  const people = db.prepare("SELECT label FROM entities WHERE type = 'person' ORDER BY label").all();
  assert.deepEqual(people.map((row) => row.label), ["Jane Doe", "John Doe"]);

  const businesses = db.prepare("SELECT label FROM entities WHERE type = 'organization'").all();
  assert.deepEqual(businesses.map((row) => row.label), ["Acme Plumbing"]);

  const edgeKinds = db.prepare("SELECT kind FROM edges ORDER BY kind, from_id, to_id").all().map((row) => row.kind);
  assert.deepEqual(edgeKinds, ["at_address", "at_address", "at_address", "co_resident", "co_resident", "has_phone"]);
});