import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.SQLITE_PATH = join(tmpdir(), `usphonebook-source-sessions-${process.pid}.sqlite`);

const db = await import("../src/db/db.mjs");
const sourceSessions = await import("../src/sourceSessions.mjs");

const { deleteDatabaseFileAndReopen, closeDatabase } = db;
const {
  getSourceSession,
  listSourceSessions,
  markSourceSessionChecked,
  markSourceSessionOpened,
  resetSourceSession,
  setSourceSessionPaused,
} = sourceSessions;

test.beforeEach(() => {
  deleteDatabaseFileAndReopen();
});

test.after(() => {
  closeDatabase();
});

test("required-session sources default to session_required", () => {
  const session = getSourceSession("social_public_web");
  assert.equal(session.status, "session_required");
  assert.equal(session.effectiveStatus, "session_required");
  assert.equal(session.paused, false);
});

test("marking and pausing a session preserves prior status for resume", () => {
  const opened = markSourceSessionOpened("social_public_web", {
    status: "ready",
    lastWarning: null,
  });
  assert.equal(opened.status, "ready");
  assert.ok(opened.lastOpenedAt);

  const checked = markSourceSessionChecked("social_public_web", "challenge_required", {
    lastWarning: "captcha",
    lastWarningDetail: "Manual checkpoint detected",
  });
  assert.equal(checked.status, "challenge_required");
  assert.equal(checked.lastWarning, "captcha");
  assert.ok(checked.lastCheckedAt);

  const paused = setSourceSessionPaused("social_public_web", true);
  assert.equal(paused.paused, true);
  assert.equal(paused.effectiveStatus, "inactive");
  assert.equal(paused.meta.priorStatus, "challenge_required");

  const resumed = setSourceSessionPaused("social_public_web", false);
  assert.equal(resumed.paused, false);
  assert.equal(resumed.status, "challenge_required");
  assert.equal(resumed.effectiveStatus, "challenge_required");
});

test("listSourceSessions only returns sources with session UI support", () => {
  const sessions = listSourceSessions();
  assert.ok(sessions.some((entry) => entry.sourceId === "social_public_web"));
  assert.ok(sessions.some((entry) => entry.sourceId === "deep_web_directories"));
  assert.ok(!sessions.some((entry) => entry.sourceId === "census_geocoder"));
});

test("resetSourceSession restores the default state", () => {
  markSourceSessionChecked("social_public_web", "ready", {
    lastWarning: "old-warning",
  });
  const reset = resetSourceSession("social_public_web");
  assert.equal(reset.status, "session_required");
  assert.equal(reset.lastWarning, null);
  assert.equal(reset.lastCheckedAt, null);
});
