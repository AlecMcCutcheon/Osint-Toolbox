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

  assessSourceSessionReadiness,

  sessionMetaForCheck,

  sessionCheckUrlScope,

  applySourceSessionOutcome,

  isSessionReadyForFetch,

  hydrateVerifiedScopes,

} = sourceSessions;



test.beforeEach(() => {

  deleteDatabaseFileAndReopen();

});



test.after(() => {

  closeDatabase();

});



test("required-session sources default to session_required", () => {

  const session = getSourceSession("truepeoplesearch");

  assert.equal(session.status, "session_required");

  assert.equal(session.effectiveStatus, "session_required");

  assert.equal(session.paused, false);

});



test("marking and pausing a session preserves prior status for resume", () => {

  const opened = markSourceSessionOpened("truepeoplesearch", {

    status: "ready",

    lastWarning: null,

  });

  assert.equal(opened.status, "ready");

  assert.ok(opened.lastOpenedAt);



  const checked = markSourceSessionChecked("truepeoplesearch", "challenge_required", {

    lastWarning: "captcha",

    lastWarningDetail: "Manual checkpoint detected",

  });

  assert.equal(checked.status, "challenge_required");

  assert.equal(checked.lastWarning, "captcha");

  assert.ok(checked.lastCheckedAt);



  const paused = setSourceSessionPaused("truepeoplesearch", true);

  assert.equal(paused.paused, true);

  assert.equal(paused.effectiveStatus, "inactive");

  assert.equal(paused.meta.priorStatus, "challenge_required");



  const resumed = setSourceSessionPaused("truepeoplesearch", false);

  assert.equal(resumed.paused, false);

  assert.equal(resumed.status, "challenge_required");

  assert.equal(resumed.effectiveStatus, "challenge_required");

});



test("listSourceSessions only returns sources with session UI support", () => {

  const sessions = listSourceSessions();

  assert.ok(sessions.some((entry) => entry.sourceId === "truepeoplesearch"));

  assert.ok(sessions.some((entry) => entry.sourceId === "deep_web_directories"));

  assert.ok(!sessions.some((entry) => entry.sourceId === "thatsthem"));

  assert.ok(!sessions.some((entry) => entry.sourceId === "census_geocoder"));

});



test("resetSourceSession restores the default state", () => {

  markSourceSessionChecked("truepeoplesearch", "ready", {

    lastWarning: "old-warning",

  });

  const reset = resetSourceSession("truepeoplesearch");

  assert.equal(reset.status, "session_required");

  assert.equal(reset.lastWarning, null);

  assert.equal(reset.lastCheckedAt, null);

});



test("sessionMetaForCheck records homepage vs lookup scope", () => {

  const homepageMeta = sessionMetaForCheck(

    "truepeoplesearch",

    "https://www.truepeoplesearch.com/",

    "ready"

  );

  assert.equal(homepageMeta.checkedUrlScope, "homepage");

  assert.equal(homepageMeta.lastCheckedUrl, "https://www.truepeoplesearch.com/");

  assert.ok(homepageMeta.verifiedScopes.homepage);



  const lookupMeta = sessionMetaForCheck(

    "truepeoplesearch",

    "https://www.truepeoplesearch.com/results?name=Kory+Drake&citystatezip=Maine",

    "ready"

  );

  assert.equal(lookupMeta.checkedUrlScope, "lookup");

  assert.ok(lookupMeta.verifiedScopes.lookup);

});



test("assessSourceSessionReadiness allows lookup URLs when only homepage is verified", () => {

  applySourceSessionOutcome("truepeoplesearch", {

    checkedUrl: "https://www.truepeoplesearch.com/",

    status: "ready",

    lastWarning: null,

    lastWarningDetail: null,

  });

  const lookupUrl = "https://www.truepeoplesearch.com/results?name=Kory+Drake&citystatezip=Maine";

  const ready = assessSourceSessionReadiness("truepeoplesearch", lookupUrl);

  assert.equal(ready.ready, true);

  assert.equal(ready.status, "ready");

  assert.equal(sessionCheckUrlScope("truepeoplesearch", lookupUrl), "lookup");

});



test("applySourceSessionOutcome sets lookup verifiedScopes on ready /results fetch", () => {

  const lookupUrl = "https://www.truepeoplesearch.com/results?name=Alec+McCutcheon&citystatezip=Maine";

  applySourceSessionOutcome("truepeoplesearch", {

    checkedUrl: lookupUrl,

    finalUrl: lookupUrl,

    status: "ready",

    lastWarning: null,

    lastWarningDetail: null,

  });

  const session = getSourceSession("truepeoplesearch");

  assert.equal(session.status, "ready");

  assert.equal(session.meta.checkedUrlScope, "lookup");

  assert.ok(session.meta.verifiedScopes.lookup);

  assert.equal(isSessionReadyForFetch("truepeoplesearch"), true);

});



test("applySourceSessionOutcome preserves pendingVerificationUrl on challenge", () => {

  const lookupUrl = "https://www.truepeoplesearch.com/results?name=Alec+McCutcheon&citystatezip=Maine";

  applySourceSessionOutcome("truepeoplesearch", {

    checkedUrl: lookupUrl,

    finalUrl: lookupUrl,

    status: "challenge_required",

    lastWarning: "captcha",

    lastWarningDetail: lookupUrl,

    verificationUrl: lookupUrl,

    lastFailedUrl: lookupUrl,

  });

  const session = getSourceSession("truepeoplesearch");

  assert.equal(session.status, "challenge_required");

  assert.equal(session.meta.pendingVerificationUrl, lookupUrl);

  assert.equal(session.meta.lastFailedUrl, lookupUrl);



  const readiness = assessSourceSessionReadiness("truepeoplesearch", lookupUrl);

  assert.equal(readiness.ready, false);

  assert.equal(readiness.status, "challenge_required");

  assert.equal(readiness.verificationUrl, lookupUrl);

});



test("applySourceSessionOutcome clears pending URL on ready", () => {

  const lookupUrl = "https://www.truepeoplesearch.com/results?name=Alec+McCutcheon&citystatezip=Maine";

  applySourceSessionOutcome("truepeoplesearch", {

    checkedUrl: lookupUrl,

    status: "challenge_required",

    lastWarning: "captcha",

    lastWarningDetail: lookupUrl,

    verificationUrl: lookupUrl,

    lastFailedUrl: lookupUrl,

  });

  applySourceSessionOutcome("truepeoplesearch", {

    checkedUrl: lookupUrl,

    finalUrl: lookupUrl,

    status: "ready",

    lastWarning: null,

    lastWarningDetail: null,

  });

  const session = getSourceSession("truepeoplesearch");

  assert.equal(session.status, "ready");

  assert.equal(session.meta.pendingVerificationUrl, null);

  assert.equal(session.meta.lastFailedUrl, null);

});



test("hydrateVerifiedScopes migrates legacy checkedUrlScope", () => {

  const scopes = hydrateVerifiedScopes({

    checkedUrlScope: "homepage",

    lastCheckedUrl: "https://www.truepeoplesearch.com/",

    lastCheckedAt: "2026-06-28T00:00:00.000Z",

  });

  assert.ok(scopes.homepage);

});


