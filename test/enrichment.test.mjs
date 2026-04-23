import test from "node:test";
import assert from "node:assert/strict";
import { extractCensusMatch, summarizeOverpassElements } from "../src/addressEnrichment.mjs";
import { enrichPhoneNumber, normalizeUsPhoneDigits } from "../src/phoneEnrichment.mjs";

test("normalizeUsPhoneDigits handles plain and country-code numbers", () => {
  assert.deepEqual(normalizeUsPhoneDigits("2072420526"), {
    digits: "2072420526",
    dashed: "207-242-0526",
  });
  assert.deepEqual(normalizeUsPhoneDigits("+1 (207) 242-0526"), {
    digits: "2072420526",
    dashed: "207-242-0526",
  });
});

test("enrichPhoneNumber returns normalized libphonenumber metadata", () => {
  const meta = enrichPhoneNumber("207-242-0526");
  assert.ok(meta);
  assert.equal(meta.country, "US");
  assert.equal(meta.dashed, "207-242-0526");
  assert.equal(meta.e164, "+12072420526");
  assert.equal(meta.isPossible, true);
});

test("extractCensusMatch reduces Census geocoder payload into stable fields", () => {
  const match = extractCensusMatch({
    result: {
      addressMatches: [
        {
          matchedAddress: "123 Main St, Portland, ME, 04101",
          coordinates: { x: -70.2551, y: 43.6591 },
          tigerLine: { tigerLineId: "12345", side: "L" },
          geographies: {
            States: [{ NAME: "Maine", STUSAB: "ME", GEOID: "23" }],
            Counties: [{ NAME: "Cumberland County", GEOID: "23005" }],
            "Census Tracts": [{ NAME: "001400", GEOID: "23005001400" }],
            "Census Blocks": [{ NAME: "Block 1000", GEOID: "230050014001000" }],
            "118th Congressional Districts": [{ NAME: "Congressional District 1", GEOID: "2301" }],
          },
        },
      ],
    },
  });
  assert.deepEqual(match, {
    matchedAddress: "123 Main St, Portland, ME, 04101",
    coordinates: { lat: 43.6591, lon: -70.2551 },
    tigerLineId: "12345",
    tigerLineSide: "L",
    censusGeography: {
      state: { name: "Maine", stusab: "ME", geoid: "23" },
      county: { name: "Cumberland County", geoid: "23005" },
      tract: { name: "001400", geoid: "23005001400" },
      block: { name: "Block 1000", geoid: "230050014001000", blockGroup: "1" },
      congressionalDistrict: { name: "Congressional District 1", geoid: "2301" },
    },
  });
});

test("summarizeOverpassElements sorts nearby features by distance and trims the list", () => {
  const summary = summarizeOverpassElements(
    { lat: 43.6591, lon: -70.2551 },
    [
      { id: 2, type: "node", lat: 43.6602, lon: -70.2552, tags: { amenity: "school", name: "Harbor School" } },
      { id: 1, type: "node", lat: 43.6592, lon: -70.2550, tags: { amenity: "hospital", name: "Mercy Hospital" } },
      { id: 3, type: "node", lat: 43.6640, lon: -70.2600, tags: { shop: "supermarket", name: "Corner Market" } },
    ],
    2
  );
  assert.equal(summary.radiusMeters >= 100, true);
  assert.equal(summary.count, 3);
  assert.equal(summary.places.length, 2);
  assert.equal(summary.places[0].name, "Mercy Hospital");
  assert.equal(summary.places[1].name, "Harbor School");
});
