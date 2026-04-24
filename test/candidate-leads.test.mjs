import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.SQLITE_PATH = join(tmpdir(), `usphonebook-candidate-leads-${process.pid}.sqlite`);

const db = await import("../src/db/db.mjs");
const candidateLeads = await import("../src/candidateLeads.mjs");

const { deleteDatabaseFileAndReopen, closeDatabase } = db;
const { getCandidateLeadBySourceAndUrl, listCandidateLeads, reviewCandidateLead, upsertCandidateLead } = candidateLeads;

test.beforeEach(() => {
  deleteDatabaseFileAndReopen();
});

test.after(() => {
  closeDatabase();
});

test("upsertCandidateLead stores and merges evidence/context by source+url", () => {
  const first = upsertCandidateLead({
    sourceId: "usphonebook_name_search",
    url: "https://www.usphonebook.com/person/jane-doe",
    label: "Jane Doe",
    accessMode: "public_profile",
    confidence: 0.45,
    evidence: { summary: "Initial candidate from name search" },
    context: { query: "Jane Doe TX" },
  });
  assert.ok(first.id);
  assert.equal(first.reviewStatus, "pending");
  assert.equal(first.evidence.summary, "Initial candidate from name search");

  const second = upsertCandidateLead({
    sourceId: "usphonebook_name_search",
    url: "https://www.usphonebook.com/person/jane-doe",
    confidence: 0.72,
    evidence: { relatives: 3 },
    context: { selectedJobId: "N-3" },
  });
  assert.equal(second.id, first.id);
  assert.equal(second.confidence, 0.72);
  assert.equal(second.evidence.summary, "Initial candidate from name search");
  assert.equal(second.evidence.relatives, 3);
  assert.equal(second.context.query, "Jane Doe TX");
  assert.equal(second.context.selectedJobId, "N-3");

  const fetched = getCandidateLeadBySourceAndUrl("usphonebook_name_search", "https://www.usphonebook.com/person/jane-doe");
  assert.equal(fetched.id, first.id);
});

test("listCandidateLeads supports filtering and newest-first ordering", () => {
  const a = upsertCandidateLead({
    sourceId: "usphonebook_name_search",
    url: "https://example.test/a",
    label: "A",
  });
  const b = upsertCandidateLead({
    sourceId: "social_public_web",
    url: "https://example.test/b",
    label: "B",
    reviewStatus: "confirmed",
  });
  reviewCandidateLead(a.id, "ambiguous", "Need more corroboration");

  const ambiguous = listCandidateLeads({ reviewStatus: "ambiguous" });
  assert.equal(ambiguous.length, 1);
  assert.equal(ambiguous[0].id, a.id);

  const social = listCandidateLeads({ sourceId: "social_public_web" });
  assert.equal(social.length, 1);
  assert.equal(social[0].id, b.id);

  const all = listCandidateLeads({ limit: 10 });
  assert.equal(all.length, 2);
  assert.deepEqual(new Set(all.map((lead) => lead.id)), new Set([a.id, b.id]));
});

test("reviewCandidateLead updates review state and note", () => {
  const lead = upsertCandidateLead({
    sourceId: "usphonebook_name_search",
    url: "https://example.test/c",
  });
  const reviewed = reviewCandidateLead(lead.id, "confirmed", "Matched known address");
  assert.equal(reviewed.reviewStatus, "confirmed");
  assert.equal(reviewed.reviewNote, "Matched known address");
});
