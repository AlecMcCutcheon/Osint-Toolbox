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
import { parseFastPeopleSearchPhoneHtml, parseFastPeopleSearchProfileHtml } from "../src/fastPeopleSearch.mjs";
import { parseUsPhonebookAddressHtml } from "../src/parseUsPhonebookAddress.mjs";
import { parseThatsThemPhoneHtml } from "../src/thatsThem.mjs";
import { enrichTelecomNumber } from "../src/telecomEnrichment.mjs";
import { buildTruePeopleSearchAddressUrl, buildTruePeopleSearchNameUrl, parseTruePeopleSearchAddressHtml, parseTruePeopleSearchAddressSearchHtml, parseTruePeopleSearchPhoneHtml, parseTruePeopleSearchProfileHtml } from "../src/truePeopleSearch.mjs";

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

test("parseTruePeopleSearchPhoneHtml ignores outer result wrappers and keeps leaf cards", () => {
  const html = `
    <section class="search-results">
      <div class="card card-block">
        <h3>Alex Example</h3>
        <a href="/address-lookup/123-main-st-portland-me">123 Main St, Portland, ME 04101</a>
        <div>(207) 242-0526</div>
      </div>
      <div class="card card-block">
        <h3>Jamie Sample</h3>
        <a href="/address-lookup/44-oak-ave-bangor-me">44 Oak Ave, Bangor, ME 04401</a>
        <div>(207) 555-0101</div>
      </div>
    </section>
  `;
  const parsed = parseTruePeopleSearchPhoneHtml(html, "https://www.truepeoplesearch.com/results?PhoneNo=2072420526");
  assert.equal(parsed.status, "ok");
  assert.equal(parsed.people.length, 2);
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

test("parseTruePeopleSearchPhoneHtml does not false-positive on normal pages mentioning Cloudflare", () => {
  const parsed = parseTruePeopleSearchPhoneHtml(
    `<main>
      <section class="card">
        <h3>Alex Example</h3>
        <div>Age 41</div>
        <div>This profile uses Cloudflare protected image assets.</div>
        <a href="/address-lookup/123-main-st-portland-me">123 Main St, Portland, ME 04101</a>
        <div>(207) 242-0526</div>
      </section>
    </main>`,
    "https://www.truepeoplesearch.com/results?PhoneNo=2072420526"
  );
  assert.equal(parsed.status, "ok");
  assert.equal(parsed.people.length, 1);
});

test("parseTruePeopleSearchPhoneHtml ignores noscript javascript warnings on real result pages", () => {
  const parsed = parseTruePeopleSearchPhoneHtml(
    `<main>
      <noscript>Please enable JavaScript to continue.</noscript>
      <section class="card">
        <h3>Alex Example</h3>
        <div>Age 41</div>
        <a href="/address-lookup/123-main-st-portland-me">123 Main St, Portland, ME 04101</a>
        <div>(207) 242-0526</div>
        <div>Possible Relatives</div>
        <a href="/find/person/jane-example">Jane Example</a>
      </section>
    </main>`,
    "https://www.truepeoplesearch.com/results?name=Alex+Example&citystatezip=Maine"
  );
  assert.equal(parsed.status, "ok");
  assert.equal(parsed.people.length, 1);
});

test("parseTruePeopleSearchPhoneHtml parses live-style search summary cards", () => {
  const parsed = parseTruePeopleSearchPhoneHtml(
    `<div class="card card-body shadow-form card-summary pt-3 mb-2" data-detail-link="/find/person/pxrl92nu649n60r4r068">
      <div class="content-header">Kory Drake Jr</div>
      <div><span>Age </span><span class="content-value">25</span><span> • </span><span class="content-value">Waterville, ME</span></div>
      <div><span class="content-label">Used to live in </span><span class="content-value">South Portland ME, Corinna ME, Bangor ME</span></div>
      <div><span class="content-label">Related to </span><span class="content-value">Cecil Drake, Crystal Drake, Julie Drake</span></div>
      <a class="btn btn-success btn-lg detail-link shadow-form" href="/find/person/pxrl92nu649n60r4r068">View Details</a>
    </div>`,
    "https://www.truepeoplesearch.com/results?name=Kory+Drake&citystatezip=Maine"
  );
  assert.equal(parsed.status, "ok");
  assert.equal(parsed.people.length, 1);
  assert.equal(parsed.people[0].displayName, "Kory Drake Jr");
  assert.equal(parsed.people[0].age, 25);
  assert.equal(parsed.people[0].profilePath, "/find/person/pxrl92nu649n60r4r068");
  assert.deepEqual(
    parsed.people[0].addresses.map((x) => x.label),
    ["Waterville, ME", "South Portland, ME", "Corinna, ME", "Bangor, ME"]
  );
  assert.deepEqual(parsed.people[0].relatives.map((x) => x.name), ["Cecil Drake", "Crystal Drake", "Julie Drake"]);
});

test("parseTruePeopleSearchPhoneHtml ignores CTA-only labels in wrapper cards", () => {
  const parsed = parseTruePeopleSearchPhoneHtml(
    `<section class="result-wrapper">
      <a class="btn btn-success detail-link" href="/find/person/not-a-person">View Details</a>
      <div class="card card-summary" data-detail-link="/find/person/real-person-123">
        <div class="content-header">Kory Drake Sr</div>
        <div><span>Age </span><span class="content-value">48</span><span> • </span><span class="content-value">Bangor, ME</span></div>
        <div><span class="content-label">Related to </span><span class="content-value">Crystal Drake</span></div>
        <a class="btn btn-success btn-lg detail-link shadow-form" href="/find/person/real-person-123">View Details</a>
      </div>
    </section>`,
    "https://www.truepeoplesearch.com/results?name=Kory+Drake&citystatezip=Maine"
  );
  assert.equal(parsed.status, "ok");
  assert.equal(parsed.people.length, 1);
  assert.equal(parsed.people[0].displayName, "Kory Drake Sr");
});

test("parseFastPeopleSearchPhoneHtml does not false-positive on normal pages mentioning Cloudflare", () => {
  const parsed = parseFastPeopleSearchPhoneHtml(
    `<div class="card shadow">
      <h2><a href="/name/alex-example_portland-me">Alex Example</a></h2>
      <div>Age 41</div>
      <div class="content-value">Cloudflare-protected CDN assets are in use.</div>
      <a href="/address/123-main-st-portland-me">123 Main St, Portland, ME 04101</a>
      <div>(207) 242-0526</div>
    </div>`,
    "https://www.fastpeoplesearch.com/phone/207-242-0526"
  );
  assert.equal(parsed.status, "ok");
  assert.equal(parsed.people.length, 1);
});

test("parseFastPeopleSearchPhoneHtml prefers parseable results over stale challenge text", () => {
  const parsed = parseFastPeopleSearchPhoneHtml(
    `<main>
      <div style="display:none">Attention Required! Checking your browser before accessing FastPeopleSearch</div>
      <div class="card shadow">
        <h2><a href="/name/alex-example_portland-me">Alex Example</a></h2>
        <div>Age 41</div>
        <a href="/address/123-main-st-portland-me">123 Main St, Portland, ME 04101</a>
        <div>(207) 242-0526</div>
      </div>
    </main>`,
    "https://www.fastpeoplesearch.com/phone/207-242-0526"
  );
  assert.equal(parsed.status, "ok");
  assert.equal(parsed.people.length, 1);
});

test("parseFastPeopleSearchPhoneHtml ignores stale cloudflare footer text on real result pages", () => {
  const parsed = parseFastPeopleSearchPhoneHtml(
    `<main>
      <div style="display:none">Ray ID: 1234567890abcdef Please enable cookies.</div>
      <div class="card shadow">
        <h2><a href="/name/alex-example_portland-me">Alex Example</a></h2>
        <div>Age 41</div>
        <div>Portland, ME</div>
        <a class="link-to-details" href="/alex-example_id_G-123456789">View Free Details</a>
      </div>
    </main>`,
    "https://www.fastpeoplesearch.com/name/alex-example_maine"
  );
  assert.equal(parsed.status, "ok");
  assert.equal(parsed.people.length, 1);
});

test("parseFastPeopleSearchPhoneHtml parses live-style result cards with detail links and text sections", () => {
  const parsed = parseFastPeopleSearchPhoneHtml(
    `<div class="people-list">
      <div id="G-605477354999355573" class="card">
        <div class="card-block">
          <h2 class="card-title" style="position:relative">
            <a href="/kory-drake_id_G-605477354999355573" title="Free background report on Kory A Drake Sr in Waterville, ME">
              <span class="larger">Kory Drake</span>
              <br><span class="grey" style="font-size:16px;">Age 48 • Waterville, ME</span>
            </a>
          </h2>
          <div style="text-overflow:ellipsis;width:100%;overflow:hidden;white-space:nowrap;">
            <h3 style="color:#737373">Past Addresses:</h3>
            Corinna, ME • Corinna, ME • Swanville, ME • Belfast, ME
          </div>
          <div style="text-overflow:ellipsis;width:100%;overflow:hidden;white-space:nowrap;">
            <h3 style="color:#737373">Relatives:</h3>
            Crystal Drake • Cecil Drake • Julie Drake • Julie Drake
          </div>
          <a class="btn btn-primary link-to-details" title="Free public record details for Kory Drake in Waterville, ME" href="/kory-drake_id_G-605477354999355573">View Free Details</a>
        </div>
      </div>
    </div>`,
    "https://www.fastpeoplesearch.com/name/kory-drake_maine"
  );
  assert.equal(parsed.status, "ok");
  assert.equal(parsed.people.length, 1);
  assert.equal(parsed.people[0].displayName, "Kory Drake");
  assert.equal(parsed.people[0].age, 48);
  assert.equal(parsed.people[0].profilePath, "/kory-drake_id_G-605477354999355573");
  assert.deepEqual(
    parsed.people[0].addresses.map((x) => x.label),
    ["Waterville, ME", "Corinna, ME", "Swanville, ME", "Belfast, ME"]
  );
  assert.deepEqual(
    parsed.people[0].relatives.map((x) => x.name),
    ["Crystal Drake", "Cecil Drake", "Julie Drake"]
  );
});

test("parseFastPeopleSearchProfileHtml extracts aliases, relatives, associates, and emails", () => {
  const parsed = parseFastPeopleSearchProfileHtml(
    `<div id="email_section" class="detail-box">
      <h2>Email Addresses</h2>
      <h3>xlx_balls2thewalls69_xlx@yahoo.com</h3>
      <h3>korydrake15@gmail.com</h3>
    </div>
    <div class="detail-box" id="aka-links">
      <h2>Also Known As</h2>
      <h3>Kory A Drake Jr</h3>
      <h3>Corey Drake</h3>
    </div>
    <div class="detail-box" id="relative-links">
      <h2>Relatives of Kory Drake in Corinna, ME</h2>
      <a href="/cecil-drake_id_G-3301622743292958772">Cecil Drake</a>
      <a href="/crystal-drake_id_G136139362826896873">Crystal Drake</a>
    </div>
    <div class="detail-box" id="associate-links">
      <h2>Associates of Kory Drake in Corinna, ME</h2>
      <a href="/amanda-marshall_id_G8606075724253372072">Amanda Marshall</a>
      <a href="/anthony-watkinson_id_G5578755847255673499">Anthony Watkinson</a>
    </div>`,
    "https://www.fastpeoplesearch.com/kory-drake_id_G-319275649760343068"
  );
  assert.equal(parsed.source, "fastpeoplesearch");
  assert.equal(parsed.profilePath, "/kory-drake_id_G-319275649760343068");
  assert.deepEqual(parsed.aliases, ["Kory A Drake Jr", "Corey Drake"]);
  assert.deepEqual(parsed.emails, ["xlx_balls2thewalls69_xlx@yahoo.com", "korydrake15@gmail.com"]);
  assert.deepEqual(parsed.relatives.map((x) => x.name), ["Cecil Drake", "Crystal Drake"]);
  assert.deepEqual(parsed.associates.map((x) => x.name), ["Amanda Marshall", "Anthony Watkinson"]);
});

test("parseTruePeopleSearchProfileHtml extracts aliases, addresses, phones, emails, relatives, and associates", () => {
  const parsed = parseTruePeopleSearchProfileHtml(
    `<div id="personDetails" class="card card-body shadow-form pt-2">
      <div class="row pl-md-1"><div class="col"><h1 class="oh1">Kory Drake</h1><span>Age 48, Born November 1977<br>Lives in Waterville, ME</span><br><span>(207) 338-5941</span></div></div>
      <div id="toc-akas"></div>
      <div class="row pl-md-1"><div class="col-12 col-sm-11 pl-sm-1"><div class="row"><div class="col"><h2 class="h5">Also Seen As</h2></div></div><div class="row pl-sm-2"><div class="col"><div><span>Kory H Drake Sr</span>, <span>Cory Drake</span></div></div></div></div></div>
      <div id="toc-current-address"></div>
      <div class="row pl-md-1"><div class="col-12 col-sm-11 pl-sm-1"><div class="row"><div class="col"><h2 class="h5">Current Address</h2></div></div><div class="row pl-sm-2"><div class="col-12"><div><a href="/find/address/14-burleigh-st-3_waterville-me-04901">14 Burleigh St #3<br>Waterville, ME 04901</a><div class="mt-1 dt-ln"><span class="dt-sb">(Jun 2018 - Apr 2026)</span></div></div></div></div></div></div>
      <div id="toc-phones"></div>
      <div class="row pl-md-1"><div class="col-12 col-sm-11 pl-sm-1"><div class="row"><div class="col"><h2 class="h5">Phone Numbers</h2></div></div><div class="row pl-sm-2"><div class="col-12 col-md-6 mb-3"><div><a href="/find/phone/2073385941"><span>(207) 338-5941</span></a> - <span class="smaller">Landline</span><div class="mt-1 dt-ln"><span class="dt-sb"><b>Possible Primary Phone</b></span></div></div></div><div class="col-12 col-md-6 mb-3"><div><a href="/find/phone/2073383631"><span>(207) 338-3631</span></a> - <span class="smaller">Wireless</span></div></div></div></div></div>
      <div id="toc-emails"></div>
      <div class="row pl-md-1"><div class="col-12 col-sm-11 pl-sm-1"><div class="row"><div class="col"><h2 class="h5">Email Addresses</h2></div></div><div class="row pl-sm-2"><div class="col"><div>korydrake15@gmail.com</div></div></div><div class="row pl-sm-2"><div class="col"><div>xlx_balls2thewalls69_xlx@yahoo.com</div></div></div></div></div>
      <div id="toc-previous-addresses"></div>
      <div class="row pl-md-1"><div class="col-12 col-sm-11 pl-sm-1"><div class="row"><div class="col"><h2 class="h5">Previous Addresses</h2></div></div><div class="row pl-sm-2"><div class="col-12 col-md-6 mb-3"><div><a href="/find/address/100-newport-rd_corinna-me-04928">100 Newport Rd<br>Corinna, ME 04928</a><div class="mt-1 dt-ln"><span class="dt-sb">(Apr 2006 - May 2017)</span></div></div></div></div></div></div>
      <div id="toc-relatives"></div>
      <div class="row pl-md-1"><div class="col-12 col-sm-11 pl-sm-1"><div class="row"><div class="col"><h2 class="h5">Possible Relatives</h2></div></div><div class="row pl-sm-2"><div class="col-6 col-md-3 mb-3 pr-0"><div><a href="/find/person/plr6lr9r628268968nr">Crystal Drake</a></div></div><div class="col-6 col-md-3 mb-3 pl-1 pr-0"><div><a href="/find/person/pxrr0l622n4r2929u8nn2">Cecil Drake</a></div></div></div></div></div>
      <div id="toc-associates"></div>
      <div class="row pl-md-1"><div class="col-12 col-sm-11 pl-sm-1"><div class="row"><div class="col"><h2 class="h5">Possible Associates</h2></div></div><div class="row pl-sm-2"><div class="col-6 col-md-3 mb-3 pr-0"><div><a href="/find/person/px82ul826n4nr696u0n00">Chelsea Levesque</a></div></div><div class="col-6 col-md-3 mb-3 pl-1 pr-0"><div><a href="/find/person/px2u66ur8822nr802l24">Kayla Small</a></div></div></div></div></div>
    </div>`,
    "https://www.truepeoplesearch.com/find/person/px60u4nnru4999ruuunr"
  );
  assert.equal(parsed.source, "truepeoplesearch");
  assert.equal(parsed.displayName, "Kory Drake");
  assert.equal(parsed.profilePath, "/find/person/px60u4nnru4999ruuunr");
  assert.equal(parsed.age, 48);
  assert.deepEqual(parsed.aliases, ["Kory H Drake Sr", "Cory Drake"]);
  assert.deepEqual(parsed.emails, ["korydrake15@gmail.com", "xlx_balls2thewalls69_xlx@yahoo.com"]);
  assert.equal(parsed.addresses[0].label, "14 Burleigh St #3, Waterville, ME 04901");
  assert.equal(parsed.addresses[0].isCurrent, true);
  assert.ok(parsed.addresses.some((x) => x.label === "100 Newport Rd, Corinna, ME 04928"));
  assert.deepEqual(parsed.phones.map((x) => x.dashed), ["207-338-5941", "207-338-3631"]);
  assert.equal(parsed.phones[0].isCurrent, true);
  assert.deepEqual(parsed.relatives.map((x) => x.name), ["Crystal Drake", "Cecil Drake"]);
  assert.deepEqual(parsed.associates.map((x) => x.name), ["Chelsea Levesque", "Kayla Small"]);
});

test("parseUsPhonebookAddressHtml extracts residents and businesses from address pages", () => {
  const parsed = parseUsPhonebookAddressHtml(
    `<div class="phase2-section">
      <h1>123 Main St, Portland, ME 04101</h1>
      <div class="ls_contacts__title">Current Residents</div>
      <div>
        <a href="/john-doe/abc123">John Doe</a>
        <a href="/jane-doe/def456">Jane Doe</a>
      </div>
      <div class="ls_contacts__title">Businesses</div>
      <div><div><a href="/business/acme-plumbing">Acme Plumbing</a> (207) 555-0101</div></div>
    </div>`,
    "https://www.usphonebook.com/address/123-main-st-portland-me"
  );
  assert.equal(parsed.documentType, "address_document");
  assert.equal(parsed.address.formattedFull, "123 Main St, Portland, ME 04101");
  assert.deepEqual(parsed.residents.map((x) => x.name), ["John Doe", "Jane Doe"]);
  assert.equal(parsed.businesses[0].name, "Acme Plumbing");
  assert.equal(parsed.businesses[0].phones[0].dashed, "207-555-0101");
});

test("parseTruePeopleSearchAddressHtml extracts residents and businesses from address documents", () => {
  const parsed = parseTruePeopleSearchAddressHtml(
    `<div id="personDetails" class="card card-body shadow-form pt-2">
      <div class="row pl-md-1"><div class="col"><h1 class="oh1">123 Main St<br>Portland, ME 04101</h1></div></div>
      <div class="row pl-md-1"><div class="col"><h2 class="h5">Current Residents</h2></div></div>
      <div class="row pl-sm-2"><div class="col-6"><div><a href="/find/person/john-doe-1">John Doe</a></div></div><div class="col-6"><div><a href="/find/person/jane-doe-2">Jane Doe</a></div></div></div>
      <div class="row pl-md-1"><div class="col"><h2 class="h5">Businesses</h2></div></div>
      <div class="row pl-sm-2"><div class="col"><div><a href="/biz/acme-plumbing">Acme Plumbing</a> (207) 555-0101</div></div></div>
    </div>`,
    "https://www.truepeoplesearch.com/find/address/123-main-st-portland-me-04101"
  );
  assert.equal(parsed.documentType, "address_document");
  assert.equal(parsed.address.label, "123 Main St, Portland, ME 04101");
  assert.deepEqual(parsed.residents.map((x) => x.name), ["John Doe", "Jane Doe"]);
  assert.equal(parsed.businesses[0].name, "Acme Plumbing");
});

test("buildTruePeopleSearchAddressUrl emits the expected address search query", () => {
  assert.equal(
    buildTruePeopleSearchAddressUrl("123 Main St", "Portland", "ME", "04101"),
    "https://www.truepeoplesearch.com/results?StreetAddress=123+Main+St&CityStateZip=Portland%2C+ME%2C+04101"
  );
});

test("parseTruePeopleSearchAddressSearchHtml tags result cards as address searches", () => {
  const parsed = parseTruePeopleSearchAddressSearchHtml(
    `<div class="card card-block"><h3>Alex Example</h3><a href="/address-lookup/123-main-st-portland-me">123 Main St, Portland, ME 04101</a><div>(207) 242-0526</div></div>`,
    "https://www.truepeoplesearch.com/results?StreetAddress=123+Main+St&CityStateZip=Portland%2C+ME"
  );
  assert.equal(parsed.status, "ok");
  assert.equal(parsed.searchType, "address");
  assert.equal(parsed.people[0].displayName, "Alex Example");
});

test("buildTruePeopleSearchNameUrl uses full state names for state-only searches", () => {
  assert.equal(
    buildTruePeopleSearchNameUrl("Kory Drake", "", "Maine"),
    "https://www.truepeoplesearch.com/results?name=Kory+Drake&citystatezip=Maine"
  );
  assert.equal(
    buildTruePeopleSearchNameUrl("Kory Drake", "Waterville", "ME"),
    "https://www.truepeoplesearch.com/results?name=Kory+Drake&citystatezip=Waterville%2C+ME"
  );
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

test("parseThatsThemPhoneHtml does not synthesize an aggregate person from main wrappers", () => {
  const html = `
    <main>
      <section class="contact-card">
        <h1>Alex Example</h1>
        <div class="address">123 Main St, Portland, ME 04101</div>
        <div>(207) 242-0526</div>
      </section>
      <section class="contact-card">
        <h1>Jamie Sample</h1>
        <div class="address">44 Oak Ave, Bangor, ME 04401</div>
        <div>(207) 555-0101</div>
      </section>
    </main>
  `;
  const parsed = parseThatsThemPhoneHtml(html, "https://thatsthem.com/reverse-phone-lookup/2072420526");
  assert.equal(parsed.status, "ok");
  assert.equal(parsed.people.length, 2);
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
