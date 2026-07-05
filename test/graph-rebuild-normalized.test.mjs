import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const sqlitePath = join(tmpdir(), `osint-graph-normalized-${process.pid}-${Date.now()}.sqlite`);
process.env.SQLITE_PATH = sqlitePath;
process.env.RUVECTOR_ENABLE = "0";

const { closeDatabase, deleteDatabaseFileAndReopen, getDb } = await import("../src/db/db.mjs");
const { rebuildGraphFromQueueItems, mergeGraphItems } = await import("../src/graphRebuild.mjs");
const {
  normalizeAddressDocumentPayload,
  normalizePhoneSearchPayload,
  normalizeProfileLookupPayload,
  stampNormalizedEnriched,
} = await import("../src/normalizedResult.mjs");

test.beforeEach(() => {
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

test("rebuildGraphFromQueueItems ingests phone, profile, and address normalized items", async () => {
  const phoneNormalized = normalizePhoneSearchPayload(
    {
      url: "https://www.usphonebook.com/phone-search/207-242-0526",
      parsed: {
        currentOwner: { displayName: "Marci Mccutcheon" },
        linePhone: "(207) 242-0526",
        profilePath: "/marci-mccutcheon/abc",
        relatives: [],
      },
      phoneMetadata: { e164: "+12072420526", type: "fixed_line" },
    },
    "207-242-0526"
  );
  const profileNormalized = stampNormalizedEnriched(
    normalizeProfileLookupPayload({
      url: "https://www.usphonebook.com/marci-mccutcheon/abc",
      profile: {
        displayName: "Marci Mccutcheon",
        profilePath: "/marci-mccutcheon/abc",
        phones: [{ dashed: "207-242-0526", display: "(207) 242-0526", isCurrent: true }],
        addresses: [],
        relatives: [],
        aliases: [],
        emails: [],
      },
      contextPhone: "207-242-0526",
    })
  );
  const addressNormalized = normalizeAddressDocumentPayload({
    url: "https://www.usphonebook.com/address/123-main-st",
    document: {
      sourceId: "usphonebook_address",
      documentPath: "/address/123-main-st",
      address: {
        formattedFull: "123 Main St",
        path: "/address/123-main-st",
        normalizedKey: "123 main st",
      },
      residents: [{ name: "Marci Mccutcheon", path: "/marci-mccutcheon/abc", isCurrent: true }],
      businesses: [],
    },
  });

  const { itemResults } = await rebuildGraphFromQueueItems([
    { normalized: phoneNormalized, runId: "job-phone" },
    { normalized: profileNormalized, runId: "job-profile" },
    { normalized: addressNormalized, runId: "job-address" },
  ]);

  assert.equal(itemResults.length, 3);
  const db = getDb();
  assert.ok(db.prepare("SELECT COUNT(*) as c FROM entities").get().c >= 3);
  assert.ok(db.prepare("SELECT id FROM entities WHERE type = 'person' AND label = ?").get("Marci Mccutcheon"));
  assert.ok(db.prepare("SELECT id FROM entities WHERE type = 'address'").get());
});

test("mergeGraphItems adds to an existing graph without clearing prior entities", async () => {
  const first = normalizePhoneSearchPayload(
    {
      parsed: {
        currentOwner: { displayName: "Alpha One" },
        linePhone: "(207) 111-1111",
        profilePath: "/alpha-one/abc",
        relatives: [],
      },
    },
    "207-111-1111"
  );
  const second = normalizePhoneSearchPayload(
    {
      parsed: {
        currentOwner: { displayName: "Beta Two" },
        linePhone: "(207) 222-2222",
        profilePath: "/beta-two/abc",
        relatives: [],
      },
    },
    "207-222-2222"
  );

  await mergeGraphItems([{ normalized: first, runId: "job-1" }]);
  await mergeGraphItems([{ normalized: second, runId: "job-2" }]);

  const db = getDb();
  assert.equal(db.prepare("SELECT COUNT(*) as c FROM entities WHERE type = 'person'").get().c, 2);
});
