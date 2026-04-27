import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const sqlitePath = join(tmpdir(), `osint-manual-assign-${process.pid}-${Date.now()}.sqlite`);

process.env.SQLITE_PATH = sqlitePath;
process.env.RUVECTOR_ENABLE = "0";

const { closeDatabase, deleteDatabaseFileAndReopen, getDb } = await import("../src/db/db.mjs");
const { assignFactToPerson, ingestProfileParsed } = await import("../src/entityIngest.mjs");

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

test("assignFactToPerson links manual phones, addresses, and emails to an existing person", () => {
  deleteDatabaseFileAndReopen();

  const seeded = ingestProfileParsed(
    {
      displayName: "Jane Example",
      givenName: "Jane",
      familyName: "Example",
      profilePath: "/jane-example/123",
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

  const phoneAssignment = assignFactToPerson({
    personId: seeded.personId,
    factType: "phone",
    phone: {
      dashed: "207-555-0101",
      display: "(207) 555-0101",
      isCurrent: true,
    },
  });
  assert.equal(phoneAssignment.edgeKind, "has_phone");
  assert.equal(phoneAssignment.created, true);
  assert.equal(phoneAssignment.alreadyAssigned, false);

  const addressAssignment = assignFactToPerson({
    personId: seeded.personId,
    factType: "address",
    address: {
      normalizedKey: "123 main st portland me 04101",
      formattedFull: "123 Main St, Portland, ME 04101",
      label: "123 Main St, Portland, ME 04101",
      isCurrent: true,
    },
  });
  assert.equal(addressAssignment.edgeKind, "at_address");
  assert.equal(addressAssignment.created, true);
  assert.equal(addressAssignment.alreadyAssigned, false);

  const emailAssignment = assignFactToPerson({
    personId: seeded.personId,
    factType: "email",
    email: "jane@example.com",
  });
  assert.equal(emailAssignment.edgeKind, "has_email");
  assert.equal(emailAssignment.created, true);
  assert.equal(emailAssignment.alreadyAssigned, false);

  const repeatPhoneAssignment = assignFactToPerson({
    personId: seeded.personId,
    factType: "phone",
    phone: {
      dashed: "207-555-0101",
      display: "(207) 555-0101",
      isCurrent: true,
    },
  });
  assert.equal(repeatPhoneAssignment.edgeKind, "has_phone");
  assert.equal(repeatPhoneAssignment.created, false);
  assert.equal(repeatPhoneAssignment.alreadyAssigned, true);

  const db = getDb();
  const person = db.prepare("SELECT id FROM entities WHERE type = 'person' AND id = ?").get(seeded.personId);
  assert.ok(person);

  const phone = db.prepare("SELECT id, label FROM entities WHERE type = 'phone_number' AND dedupe_key = ?").get("phone_number:207-555-0101");
  assert.ok(phone);
  assert.equal(phone.label, "Phone 207-555-0101");

  const address = db.prepare("SELECT id, label FROM entities WHERE type = 'address' AND dedupe_key = ?").get("address:123 main st portland me 04101");
  assert.ok(address);
  assert.equal(address.label, "123 Main St, Portland, ME 04101");

  const email = db.prepare("SELECT id, label FROM entities WHERE type = 'email' AND dedupe_key = ?").get("email:jane@example.com");
  assert.ok(email);
  assert.equal(email.label, "jane@example.com");

  const edges = db.prepare("SELECT kind FROM edges WHERE from_id = ? ORDER BY kind").all(seeded.personId).map((row) => row.kind);
  assert.deepEqual(edges, ["at_address", "has_email", "has_phone"]);
});
