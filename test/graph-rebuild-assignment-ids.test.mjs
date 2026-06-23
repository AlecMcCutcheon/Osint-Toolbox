import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const sqlitePath = join(tmpdir(), `osint-graph-assign-${process.pid}-${Date.now()}.sqlite`);

process.env.SQLITE_PATH = sqlitePath;
process.env.RUVECTOR_ENABLE = "0";

const { closeDatabase, deleteDatabaseFileAndReopen, getDb } = await import("../src/db/db.mjs");
const { assignFactToPerson, ingestProfileParsed } = await import("../src/entityIngest.mjs");
const { rebuildGraphFromQueueItems } = await import("../src/graphRebuild.mjs");

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

test("graph rebuild remaps stale person ids after duplicate-person merge", async () => {
  deleteDatabaseFileAndReopen();

  const sharedPath = "/jane-example/portland-me/abc123";
  const phoneItem = {
    kind: "phone",
    dashed: "207-555-0100",
    runId: "RUN-PHONE-1",
    parsed: {
      profilePath: sharedPath,
      currentOwner: {
        displayName: "Jane Example",
        givenName: "Jane",
        familyName: "Example",
      },
      relatives: [],
    },
  };
  const enrichItem = {
    kind: "enrich",
    contextPhone: "207-555-0100",
    runId: "RUN-ENRICH-1",
    profile: {
      displayName: "Jane Example",
      givenName: "Jane",
      familyName: "Example",
      profilePath: sharedPath,
      addresses: [],
      phones: [{ dashed: "207-555-0100", display: "(207) 555-0100", isCurrent: true }],
      emails: [],
      relatives: [],
      aliases: [],
    },
  };

  const { itemResults } = await rebuildGraphFromQueueItems([phoneItem, enrichItem]);
  assert.equal(itemResults.length, 2);

  const phoneResult = itemResults.find((entry) => entry.kind === "phone");
  const enrichResult = itemResults.find((entry) => entry.kind === "enrich");
  assert.ok(phoneResult?.graphIngest?.linkedIds?.primaryPerson);
  assert.ok(enrichResult?.graphIngest?.personId);

  const canonicalPersonId = enrichResult.graphIngest.personId;
  assert.equal(phoneResult.graphIngest.linkedIds.primaryPerson, canonicalPersonId);

  const db = getDb();
  const person = db.prepare("SELECT id, type FROM entities WHERE id = ?").get(canonicalPersonId);
  assert.ok(person);
  assert.equal(person.type, "person");
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM entities WHERE type = 'person'").get().c, 1);

  const assignment = assignFactToPerson({
    personId: phoneResult.graphIngest.linkedIds.primaryPerson,
    factType: "email",
    email: "jane@example.com",
    personProfilePath: sharedPath,
    personDisplayName: "Jane Example",
  });
  assert.equal(assignment.edgeKind, "has_email");
  assert.equal(assignment.personId, canonicalPersonId);
});

test("assignFactToPerson resolves stale person id via profile path hint", () => {
  deleteDatabaseFileAndReopen();

  const profilePath = "/john-doe/portland-me/xyz789";
  const seeded = ingestProfileParsed(
    {
      displayName: "John Doe",
      givenName: "John",
      familyName: "Doe",
      profilePath,
      addresses: [],
      phones: [],
      emails: [],
      relatives: [],
      aliases: [],
    },
    null,
    "RUN-SEED-1"
  );
  assert.ok(seeded.personId);

  const assignment = assignFactToPerson({
    personId: "00000000-0000-4000-8000-000000000099",
    personProfilePath: profilePath,
    personDisplayName: "John Doe",
    factType: "email",
    email: "john@example.com",
  });

  assert.equal(assignment.personId, seeded.personId);
  assert.equal(assignment.edgeKind, "has_email");
});
