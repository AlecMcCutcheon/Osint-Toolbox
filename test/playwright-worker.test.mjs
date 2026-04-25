import test from "node:test";
import assert from "node:assert/strict";
import { captureSettledPageSnapshot, closePopupPageIfNeeded } from "../src/playwrightWorker.mjs";

test("closePopupPageIfNeeded leaves normal pages open when opener resolves null", async () => {
  let closed = false;
  const page = {
    opener: async () => null,
    close: async () => {
      closed = true;
    },
    isClosed: () => false,
  };

  const result = await closePopupPageIfNeeded(page);
  assert.equal(result, false);
  assert.equal(closed, false);
});

test("closePopupPageIfNeeded closes real popup pages", async () => {
  let closed = false;
  const openerPage = { id: "parent" };
  const page = {
    opener: async () => openerPage,
    close: async () => {
      closed = true;
    },
    isClosed: () => false,
  };

  const result = await closePopupPageIfNeeded(page);
  assert.equal(result, true);
  assert.equal(closed, true);
});

test("captureSettledPageSnapshot waits for a challenge page to clear before reporting status", async () => {
  let phase = "challenge";
  const page = {
    content: async () =>
      phase === "challenge"
        ? "<html><body><h1>Attention Required</h1><div>Checking your browser before accessing FastPeopleSearch</div></body></html>"
        : `<html><body><div class="card shadow"><h2><a href="/name/alex-example_portland-me">Alex Example</a></h2><div>Age 41</div><a href="/address/123-main-st-portland-me">123 Main St, Portland, ME 04101</a><div>(207) 242-0526</div></div></body></html>`,
    url: () =>
      phase === "challenge"
        ? "https://www.fastpeoplesearch.com/cdn-cgi/challenge-platform/h/g/orchestrate/jsch/v1"
        : "https://www.fastpeoplesearch.com/phone/207-242-0526",
    waitForFunction: async () => {
      phase = "results";
    },
    waitForLoadState: async () => {},
  };

  const snapshot = await captureSettledPageSnapshot(page, 15000);
  assert.equal(snapshot.challengeReason, null);
  assert.match(snapshot.finalUrl, /fastpeoplesearch\.com\/phone\//i);
  assert.match(snapshot.html, /Alex Example/);
});

test("captureSettledPageSnapshot treats visible Fast People Search results as settled even if stale challenge text remains", async () => {
  const page = {
    content: async () => `
      <html><body>
        <div style="display:none">Attention Required! Checking your browser before accessing FastPeopleSearch</div>
        <div class="card-block">
          <h2 class="card-title"><a href="/kory-drake_id_G-605477354999355573"><span class="larger">Kory Drake</span><br><span class="grey">Age 48 • Waterville, ME</span></a></h2>
          <div><h3>Past Addresses:</h3>Corinna, ME • Belfast, ME</div>
          <a class="btn btn-primary link-to-details" href="/kory-drake_id_G-605477354999355573">View Free Details</a>
        </div>
      </body></html>`,
    url: () => "https://www.fastpeoplesearch.com/name/kory-drake_maine",
    waitForFunction: async () => {},
    waitForLoadState: async () => {},
  };

  const snapshot = await captureSettledPageSnapshot(page, 15000);
  assert.equal(snapshot.challengeReason, null);
  assert.match(snapshot.html, /View Free Details/);
});
