import test from "node:test";
import assert from "node:assert/strict";
import { getBuiltinAssessorReferences, parseGenericAssessorHtml } from "../src/assessorEnrichment.mjs";
import { mergePeopleFinderFacts } from "../src/sourceObservations.mjs";
import {
  annotateSourceResult,
  getThatsThemCandidatePattern,
  isSourceTrustFailure,
  rankThatsThemCandidateUrls,
  recordThatsThemCandidateOutcome,
  shouldSkipThatsThemCandidatePattern,
} from "../src/sourceStrategy.mjs";
import { parseThatsThemPhoneHtml } from "../src/thatsThem.mjs";
import { enrichTelecomNumber } from "../src/telecomEnrichment.mjs";
import { parseTruePeopleSearchPhoneHtml } from "../src/truePeopleSearch.mjs";

test("annotateSourceResult does not mark session_required as a trust failure", () => {
  const result = annotateSourceResult({
    source: "truepeoplesearch",
    status: "session_required",
    people: [],
    note: "Open the browser session first.",
  });
  assert.equal(result.trustFailure, false);
  assert.equal(result.failureKind, null);
});

test("parseTruePeopleSearchPhoneHtml extracts names, phones, addresses, and relatives", () => {
  const html = `
    <div class="card card-block">
      <h3>Alex Example</h3>
      <div>Age 41</div>
      <a href="/address-lookup/123-main-st-portland-me">123 Main St, Portland, ME 04101</a>
      <div>(207) 242-0526</div>
      <div>Possible Relatives</div>
      <a href="/find/person/jane-example">Jane Example</a>
    </div>
  `;
  const parsed = parseTruePeopleSearchPhoneHtml(html, "https://www.truepeoplesearch.com/results?PhoneNo=2072420526");
  assert.equal(parsed.status, "ok");
  assert.equal(parsed.people.length, 1);
  assert.equal(parsed.people[0].displayName, "Alex Example");
  assert.equal(parsed.people[0].age, 41);
  assert.equal(parsed.people[0].phones[0].dashed, "207-242-0526");
  assert.equal(parsed.people[0].addresses[0].label, "123 Main St, Portland, ME 04101");
  assert.equal(parsed.people[0].relatives[0].name, "Jane Example");
});

test("parseTruePeopleSearchPhoneHtml dedupes repeated matching containers", () => {
  const html = `
    <main>
      <div class="card">
        <h3>Alex Example</h3>
        <div>(207) 242-0526</div>
        <a href="/address-lookup/123-main-st-portland-me">123 Main St, Portland, ME 04101</a>
      </div>
      <div class="card">
        <h3>Alex Example</h3>
        <div>(207) 242-0526</div>
        <a href="/address-lookup/123-main-st-portland-me">123 Main St, Portland, ME 04101</a>
      </div>
    </main>
  `;
  const parsed = parseTruePeopleSearchPhoneHtml(html, "https://www.truepeoplesearch.com/results?PhoneNo=2072420526");
  assert.equal(parsed.people.length, 1);
});

test("parseThatsThemPhoneHtml detects challenge pages", () => {
  const parsed = parseThatsThemPhoneHtml("<h1>Quick Humanity Check!</h1><div>captcha</div>", "https://thatsthem.com/reverse-phone-lookup/2072420526");
  assert.equal(parsed.status, "blocked");
  assert.equal(parsed.reason, "humanity_check");
});

test("parseTruePeopleSearchPhoneHtml exposes blocked reason", () => {
  const parsed = parseTruePeopleSearchPhoneHtml(
    "<html><body><h1>Attention Required</h1><div>Cloudflare</div></body></html>",
    "https://www.truepeoplesearch.com/results?PhoneNo=2072420526"
  );
  assert.equal(parsed.status, "blocked");
  assert.equal(parsed.reason, "attention_required");
});

test("annotateSourceResult marks blocked anti-bot outcomes as source trust failures", () => {
  const parsed = annotateSourceResult(
    parseTruePeopleSearchPhoneHtml(
      "<html><body><h1>Attention Required</h1><div>Cloudflare</div></body></html>",
      "https://www.truepeoplesearch.com/results?PhoneNo=2072420526"
    )
  );
  assert.equal(isSourceTrustFailure(parsed), true);
  assert.equal(parsed.failureKind, "source_trust");
  assert.equal(parsed.trustReason, "attention_required");
});

test("parseThatsThemPhoneHtml treats 404 pages as no_match instead of a person", () => {
  const parsed = parseThatsThemPhoneHtml(
    "<main><h1>404 - Page Not Found :'(</h1><p>Sorry, that page does not exist.</p></main>",
    "https://thatsthem.com/reverse-phone-lookup/2074234103"
  );
  assert.equal(parsed.status, "no_match");
  assert.equal(parsed.reason, "not_found_page");
  assert.deepEqual(parsed.people, []);
});

test("Thatsthem candidate ranking demotes repeated not-found patterns", () => {
  const stats = new Map();
  const pathDigits = "https://thatsthem.com/reverse-phone-lookup/2074234103";
  const queryPhone = "https://thatsthem.com/reverse-phone-lookup?phone=2074234103";
  assert.equal(getThatsThemCandidatePattern(pathDigits), "path_digits");
  assert.equal(getThatsThemCandidatePattern(queryPhone), "query_phone");
  for (let i = 0; i < 3; i += 1) {
    recordThatsThemCandidateOutcome(stats, pathDigits, {
      status: "no_match",
      reason: "not_found_page",
    });
  }
  recordThatsThemCandidateOutcome(stats, queryPhone, {
    status: "no_match",
    reason: "no_results_text",
  });
  assert.equal(shouldSkipThatsThemCandidatePattern(stats.get("path_digits")), true);
  const ranked = rankThatsThemCandidateUrls([pathDigits, queryPhone], stats);
  assert.deepEqual(ranked, [queryPhone, pathDigits]);
});

test("parseThatsThemPhoneHtml extracts contact-card style fields", () => {
  const html = `
    <main>
      <section class="contact-card">
        <h1>Alex Example</h1>
        <div class="address">123 Main St, Portland, ME 04101</div>
        <div>(207) 242-0526 Mobile Verizon</div>
        <div>alex@example.com</div>
        <div>Age: 41</div>
      </section>
    </main>
  `;
  const parsed = parseThatsThemPhoneHtml(html, "https://thatsthem.com/reverse-phone-lookup/2072420526");
  assert.equal(parsed.status, "ok");
  assert.equal(parsed.people[0].displayName, "Alex Example");
  assert.equal(parsed.people[0].phones[0].lineType, "mobile");
  assert.equal(parsed.people[0].phones[0].serviceProvider, "Verizon");
  assert.equal(parsed.people[0].emails[0], "alex@example.com");
});

test("parseThatsThemPhoneHtml dedupes repeated matching containers", () => {
  const html = `
    <main>
      <section class="contact-card">
        <h1>Alex Example</h1>
        <div class="address">123 Main St, Portland, ME 04101</div>
        <div>(207) 242-0526 Mobile Verizon</div>
        <div>alex@example.com</div>
      </section>
      <section class="contact-card">
        <h1>Alex Example</h1>
        <div class="address">123 Main St, Portland, ME 04101</div>
        <div>(207) 242-0526 Mobile Verizon</div>
        <div>alex@example.com</div>
      </section>
    </main>
  `;
  const parsed = parseThatsThemPhoneHtml(html, "https://thatsthem.com/reverse-phone-lookup/2072420526");
  assert.equal(parsed.people.length, 1);
});

test("mergePeopleFinderFacts merges same facts by source", () => {
  const merged = mergePeopleFinderFacts([
    {
      source: "truepeoplesearch",
      status: "ok",
      people: [
        {
          displayName: "Alex Example",
          addresses: [{ label: "123 Main St, Portland, ME 04101" }],
          phones: [{ dashed: "207-242-0526" }],
          emails: [],
          relatives: [{ name: "Jane Example" }],
        },
      ],
    },
    {
      source: "thatsthem",
      status: "ok",
      people: [
        {
          displayName: "Alex Example",
          addresses: [{ label: "123 Main St, Portland, ME 04101" }],
          phones: [{ dashed: "207-242-0526" }],
          emails: ["alex@example.com"],
          relatives: [{ name: "Jane Example" }],
        },
      ],
    },
  ]);
  assert.equal(merged.names[0].sources.length, 2);
  assert.equal(merged.phones[0].sources.length, 2);
  assert.equal(merged.addresses[0].sources.length, 2);
  assert.equal(merged.relatives[0].sources.length, 2);
  assert.equal(merged.emails[0].sources.length, 1);
});

test("enrichTelecomNumber classifies NANP special use numbers", () => {
  const tollFree = enrichTelecomNumber("800-555-1212");
  assert.equal(tollFree.nanp.category, "toll_free");
  const standard = enrichTelecomNumber("207-242-0526");
  assert.equal(standard.nanp.areaCode, "207");
  assert.equal(standard.nanp.category, "geographic");
});

test("parseGenericAssessorHtml extracts common parcel fields", () => {
  const html = `
    <table>
      <tr><th>Owner Name</th><td>Alex Example</td></tr>
      <tr><th>Parcel ID</th><td>123-456-789</td></tr>
      <tr><th>Assessed Value</th><td>$450,000</td></tr>
      <tr><th>Mailing Address</th><td>PO Box 1, Portland, ME 04101</td></tr>
      <tr><th>Year Built</th><td>1989</td></tr>
    </table>
  `;
  const parsed = parseGenericAssessorHtml(html, "https://county.example/parcel?id=123", { key: "demo-county", name: "Demo County Assessor" });
  assert.equal(parsed.status, "ok");
  assert.equal(parsed.ownerNames[0], "Alex Example");
  assert.equal(parsed.parcelId, "123-456-789");
  assert.equal(parsed.assessedValue, "$450,000");
  assert.equal(parsed.yearBuilt, "1989");
});

test("parseGenericAssessorHtml reports no_match when nothing structured is found", () => {
  const parsed = parseGenericAssessorHtml("<html><body><p>Welcome to the property records portal.</p></body></html>", "https://county.example/search", {
    key: "demo-county",
    name: "Demo County Assessor",
  });
  assert.equal(parsed.status, "no_match");
});

test("getBuiltinAssessorReferences returns Maine county property resources", () => {
  const refs = getBuiltinAssessorReferences({
    censusGeocode: {
      censusGeography: {
        state: { stusab: "ME" },
        county: { name: "Cumberland County" },
      },
    },
  });
  assert.equal(refs.length, 1);
  assert.equal(refs[0].status, "reference");
  assert.match(refs[0].name, /Cumberland County/);
  assert.ok(Array.isArray(refs[0].resourceLinks));
  assert.ok(refs[0].resourceLinks.some((x) => /publicrecords\.netronline\.com/.test(x.url)));
});
