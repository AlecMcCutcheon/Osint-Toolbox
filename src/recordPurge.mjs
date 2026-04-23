import { getDb } from "./db/db.mjs";

const DASHED = /^\d{3}-\d{3}-\d{4}$/;

/**
 * Deletes only the phone_number row for this lookup; all edges to/from that node are removed;
 * other entities (e.g. person) remain and stay linked to other data.
 * @param {string} dashed
 * @returns {{ removed: boolean; entityId: string | null }}
 */
export function deleteGraphPhoneNode(dashed) {
  if (!DASHED.test(String(dashed || ""))) {
    return { removed: false, entityId: null };
  }
  const db = getDb();
  const key = `phone_number:${dashed}`;
  const row = db
    .prepare("SELECT id FROM entities WHERE dedupe_key = ?")
    .get(key);
  if (!row) {
    return { removed: false, entityId: null };
  }
  db.prepare("DELETE FROM entities WHERE id = ?").run(row.id);
  return { removed: true, entityId: row.id };
}
