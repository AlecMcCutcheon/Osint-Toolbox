import test from "node:test";
import assert from "node:assert/strict";
import {
  graphRebuildItemFromNormalized,
  normalizeNameSearchPayload,
  normalizePhoneSearchPayload,
  normalizeProfileLookupPayload,
} from "../src/normalizedResult.mjs";

test("normalizePhoneSearchPayload builds a shared normalized envelope", () => {
  const normalized = normalizePhoneSearchPayload(
    {
      url: "https://www.usphonebook.com/phone-search/207-242-0526",
      httpStatus: 200,
      userAgent: "UA",
      rawHtmlLength: 12345,
      parsed: {
        currentOwner: { givenName: "John", familyName: "Doe", displayName: "John Doe" },
        linePhone: "(207) 242-0526",
        profilePath: "/john-doe/maine/portland",
        fullAddressTeaser: true,
        relatives: [{ name: "Jane Doe", path: "/jane-doe/maine/portland" }],
      },
      phoneMetadata: {
        dashed: "207-242-0526",
        e164: "+12072420526",
        country: "US",
        type: "FIXED_LINE_OR_MOBILE",
      },
      externalSources: { telecom: { nanp: { areaCode: "207" } } },
      cached: true,
      cachedAt: "2026-04-23T00:00:00.000Z",
    },
    "207-242-0526"
  );

  assert.equal(normalized.kind, "phone_search");
  assert.equal(normalized.meta.graphEligible, true);
  assert.equal(normalized.query.phoneDashed, "207-242-0526");
  assert.equal(normalized.records.length, 1);
  assert.equal(normalized.records[0].displayName, "John Doe");
  assert.equal(normalized.records[0].phones[0].e164, "+12072420526");
  assert.equal(normalized.records[0].addresses[0].isTeaser, true);
  assert.equal(normalized.records[0].relatives[0].path, "/jane-doe/maine/portland");
  assert.equal("alternateProfilePaths" in normalized.records[0].relatives[0], false);
});

test("normalizeNameSearchPayload builds candidate records without marking them graph-eligible", () => {
  const normalized = normalizeNameSearchPayload({
    url: "https://www.usphonebook.com/john-doe/maine/portland",
    httpStatus: 200,
    userAgent: "UA",
    rawHtmlLength: 7890,
    search: {
      name: "John Doe",
      city: "Portland",
      state: "maine",
      path: "/john-doe/maine/portland",
    },
    parsed: {
      queryName: "John Doe",
      totalRecords: 2,
      totalPages: 1,
      summaryText: "2 Public Records Found for John Doe in Portland, ME",
      candidates: [
        {
          displayName: "John Doe",
          age: 45,
          currentCityState: "Portland, ME",
          priorAddresses: ["South Portland, ME"],
          relatives: [{ name: "Jane Doe", path: "/jane-doe/maine/portland" }],
          profilePath: "/john-doe/maine/portland",
        },
      ],
    },
  });

  assert.equal(normalized.kind, "name_search");
  assert.equal(normalized.meta.graphEligible, false);
  assert.equal(normalized.records.length, 1);
  assert.equal(normalized.records[0].recordType, "person_candidate");
  assert.equal(normalized.records[0].addresses.length, 2);
  assert.equal(normalized.records[0].addresses[0].isCurrent, true);
  assert.equal(normalized.records[0].relatives[0].name, "Jane Doe");
  assert.equal("aliases" in normalized.records[0], false);
  assert.equal("emails" in normalized.records[0], false);
});

test("normalizeProfileLookupPayload preserves rich profile detail in the shared envelope", () => {
  const normalized = normalizeProfileLookupPayload({
    url: "https://www.usphonebook.com/john-doe/maine/portland",
    httpStatus: 200,
    userAgent: "UA",
    rawHtmlLength: 4567,
    contextPhone: "207-242-0526",
    profile: {
      displayName: "John Doe",
      profilePath: "/john-doe/maine/portland",
      age: 45,
      aliases: ["Johnny Doe"],
      emails: ["john@example.com"],
      addresses: [
        {
          label: "123 Main St, Portland, ME 04101",
          formattedFull: "123 Main St, Portland, ME 04101",
          path: "/address/123-main-st",
          normalizedKey: "123 main st portland me 04101",
          timeRange: "Jan 2020 - Present",
          recordedRange: "Jan 2020 - Present",
          isCurrent: true,
          periods: [{ label: "123 Main St, Portland, ME 04101", recordedRange: "Jan 2020 - Present" }],
        },
      ],
      phones: [
        {
          dashed: "207-242-0526",
          display: "(207) 242-0526",
          isCurrent: true,
          lineType: "wireless",
          phoneMetadata: { e164: "+12072420526", country: "US" },
        },
      ],
      relatives: [{ name: "Jane Doe", path: "/jane-doe/maine/portland" }],
      workplaces: [{ title: "Engineer", company: "Acme" }],
      education: [{ institution: "UMaine" }],
      marital: [{ role: "Spouse", name: "Jane Doe", path: "/jane-doe/maine/portland" }],
    },
  });

  assert.equal(normalized.kind, "profile_lookup");
  assert.equal(normalized.meta.graphEligible, true);
  assert.equal(normalized.query.contextPhone, "207-242-0526");
  assert.equal(normalized.records.length, 1);
  assert.equal(normalized.records[0].phones[0].type, "wireless");
  assert.equal(normalized.records[0].addresses[0].periods.length, 1);
  assert.equal(normalized.records[0].sourceFields.workplaces[0].company, "Acme");
  assert.equal("nearbyPlaces" in normalized.records[0].addresses[0], false);
});

test("graphRebuildItemFromNormalized converts normalized phone envelopes into ingest items", () => {
  const normalized = normalizePhoneSearchPayload(
    {
      parsed: {
        currentOwner: { givenName: "John", familyName: "Doe", displayName: "John Doe" },
        linePhone: "207-242-0526",
        profilePath: "/john-doe/maine/portland",
        relatives: [{ name: "Jane Doe", path: "/jane-doe/maine/portland" }],
        fullAddressTeaser: false,
      },
      phoneMetadata: { dashed: "207-242-0526", e164: "+12072420526" },
    },
    "207-242-0526"
  );

  const item = graphRebuildItemFromNormalized(normalized, "RUN-1");
  assert.ok(item);
  assert.equal(item.kind, "phone");
  assert.equal(item.runId, "RUN-1");
  assert.equal(item.dashed, "207-242-0526");
  assert.equal(item.parsed.currentOwner.displayName, "John Doe");
  assert.equal(item.parsed.relatives[0].path, "/jane-doe/maine/portland");
});

test("graphRebuildItemFromNormalized converts normalized profile envelopes into enrich items", () => {
  const normalized = normalizeProfileLookupPayload({
    contextPhone: "207-242-0526",
    profile: {
      displayName: "John Doe",
      profilePath: "/john-doe/maine/portland",
      addresses: [],
      phones: [],
      relatives: [],
      aliases: [],
      emails: [],
    },
  });

  const item = graphRebuildItemFromNormalized(normalized, "RUN-2");
  assert.ok(item);
  assert.equal(item.kind, "enrich");
  assert.equal(item.contextPhone, "207-242-0526");
  assert.equal(item.profile.profilePath, "/john-doe/maine/portland");
});
