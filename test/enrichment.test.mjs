import test from "node:test";
import assert from "node:assert/strict";
import { extractCensusMatch, summarizeOverpassElements } from "../src/addressEnrichment.mjs";
import { enrichPhoneNumber, normalizeUsPhoneDigits } from "../src/phoneEnrichment.mjs";
import { enrichAddressWithAssessor } from "../src/assessorEnrichment.mjs";

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

test("enrichAddressWithAssessor uses configured city/county assessor template", async () => {
  const previous = process.env.ASSESSOR_SOURCES_JSON;
  process.env.ASSESSOR_SOURCES_JSON = JSON.stringify([
    {
      key: "portland-me-assessor",
      name: "Portland Assessor",
      state: "ME",
      countyIncludes: ["cumberland"],
      cityIncludes: ["portland"],
      searchUrlTemplate:
        "https://assessor.example/search?street={encodedStreet}&city={citySlug}&state={state}&zip={zip}",
      useFlare: false,
    },
  ]);
  try {
    const rows = await enrichAddressWithAssessor(
      {
        label: "123 Main St, Portland, ME 04101",
        censusGeocode: {
          censusGeography: {
            state: { stusab: "ME" },
            county: { name: "Cumberland County" },
          },
        },
      },
      async (url) => {
        assert.equal(
          url,
          "https://assessor.example/search?street=123%20Main%20St&city=portland&state=ME&zip=04101"
        );
        return {
          html: `
            <table>
              <tr><th>Owner</th><td>Jane Doe</td></tr>
              <tr><th>Parcel ID</th><td>MAP-12-LOT-3</td></tr>
              <tr><th>Assessed Value</th><td>$420,000</td></tr>
            </table>
          `,
          finalUrl: url,
        };
      }
    );
    const assessorRow = rows.find((row) => row.source === "portland-me-assessor");
    assert.ok(assessorRow);
    assert.equal(assessorRow.status, "ok");
    assert.deepEqual(assessorRow.ownerNames, ["Jane Doe"]);
    assert.equal(assessorRow.parcelId, "MAP-12-LOT-3");
    assert.equal(assessorRow.assessedValue, "$420,000");
  } finally {
    if (previous == null) {
      delete process.env.ASSESSOR_SOURCES_JSON;
    } else {
      process.env.ASSESSOR_SOURCES_JSON = previous;
    }
  }
});

test("enrichAddressWithAssessor supports Vision platform configs", async () => {
  const previous = process.env.ASSESSOR_SOURCES_JSON;
  const originalFetch = globalThis.fetch;
  process.env.ASSESSOR_SOURCES_JSON = JSON.stringify([
    {
      key: "vision-augusta-me",
      name: "Augusta Vision Assessor",
      state: "ME",
      cityIncludes: ["augusta"],
      platform: "vision",
      baseUrl: "https://gis.vgsi.com/augustame/",
    },
  ]);
  globalThis.fetch = async (url, init = {}) => {
    const href = String(url);
    if (href === "https://gis.vgsi.com/augustame/Search.aspx" && (!init.method || init.method === "GET")) {
      return new Response(
        `
          <html><body>
            <form action="./Search.aspx" method="post">
              <input type="hidden" name="__VIEWSTATE" value="state" />
              <input type="hidden" name="__VIEWSTATEGENERATOR" value="gen" />
              <input type="hidden" name="__EVENTVALIDATION" value="valid" />
              <input type="hidden" name="ctl00$MainContent$hdnSearchAddress" value="" />
              <input type="text" name="ctl00$MainContent$txtSearch" value="" />
            </form>
          </body></html>
        `,
        { status: 200, headers: { "Content-Type": "text/html" } }
      );
    }
    if (href === "https://gis.vgsi.com/augustame/Search.aspx" && init.method === "POST") {
      const bodyText = String(init.body);
      assert.match(bodyText, /ctl00%24MainContent%24txtSearch=16(?:\+|%20)Cony(?:\+|%20)Street/i);
      return new Response(
        `
          <table>
            <tr><td><a href="Parcel.aspx?pid=6910">16 CONY STREET</a></td></tr>
          </table>
        `,
        { status: 200, headers: { "Content-Type": "text/html" } }
      );
    }
    if (href === "https://gis.vgsi.com/augustame/Parcel.aspx?pid=6910") {
      return new Response(
        `
          <html><body>
            <h2>16 CONY STREET</h2>
            <table>
              <tr><td>Owner</td><td>AUGUSTA CITY OF</td></tr>
              <tr><td>PID</td><td>6910</td></tr>
              <tr><td>Total Market Value</td><td>$5,119,200</td></tr>
            </table>
            <table>
              <caption>Assessment</caption>
              <tr><th>Valuation Year</th><th>Improvements</th><th>Land</th><th>Total</th></tr>
              <tr><td>2026</td><td>$4,167,200</td><td>$952,000</td><td>$5,119,200</td></tr>
            </table>
            <table>
              <tr><td>Address</td><td>16 CONY ST AUGUSTA, ME 04330</td></tr>
              <tr><td>Year Built</td><td>1987</td></tr>
              <tr><td>Living Area</td><td>29,799</td></tr>
              <tr><td>Style</td><td>City/Town Hall</td></tr>
            </table>
          </body></html>
        `,
        { status: 200, headers: { "Content-Type": "text/html" } }
      );
    }
    throw new Error(`Unexpected fetch ${href}`);
  };
  try {
    const rows = await enrichAddressWithAssessor(
      {
        label: "16 Cony Street, Augusta, ME 04330",
        censusGeocode: {
          censusGeography: {
            state: { stusab: "ME" },
            county: { name: "Kennebec County" },
          },
        },
      },
      async () => {
        throw new Error("generic fetchHtml should not be used for Vision configs");
      }
    );
    const assessorRow = rows.find((row) => row.source === "vision-augusta-me");
    assert.ok(assessorRow);
    assert.equal(assessorRow.status, "ok");
    assert.deepEqual(assessorRow.ownerNames, ["AUGUSTA CITY OF"]);
    assert.equal(assessorRow.parcelId, "6910");
    assert.equal(assessorRow.assessedValue, "$5,119,200");
    assert.equal(assessorRow.propertyType, "City/Town Hall");
  } finally {
    globalThis.fetch = originalFetch;
    if (previous == null) {
      delete process.env.ASSESSOR_SOURCES_JSON;
    } else {
      process.env.ASSESSOR_SOURCES_JSON = previous;
    }
  }
});

test("enrichAddressWithAssessor rejects Vision parcel pages that do not match the requested address", async () => {
  const previous = process.env.ASSESSOR_SOURCES_JSON;
  const originalFetch = globalThis.fetch;
  process.env.ASSESSOR_SOURCES_JSON = JSON.stringify([
    {
      key: "vision-falmouth-me-mismatch-test",
      name: "Falmouth Vision Assessor Mismatch Test",
      state: "ME",
      cityIncludes: ["falmouth"],
      platform: "vision",
      baseUrl: "https://gis.vgsi.com/falmouthme/",
    },
  ]);
  globalThis.fetch = async (url, init = {}) => {
    const href = String(url);
    if (href === "https://gis.vgsi.com/falmouthme/Search.aspx" && (!init.method || init.method === "GET")) {
      return new Response(
        `
          <html><body>
            <form action="./Search.aspx" method="post">
              <input type="hidden" name="__VIEWSTATE" value="state" />
              <input type="hidden" name="__EVENTVALIDATION" value="valid" />
              <input type="text" name="ctl00$MainContent$txtSearch" value="" />
            </form>
          </body></html>
        `,
        { status: 200, headers: { "Content-Type": "text/html" } }
      );
    }
    if (href === "https://gis.vgsi.com/falmouthme/Search.aspx" && init.method === "POST") {
      return new Response(
        `
          <table>
            <tr><td><a href="Parcel.aspx?pid=2275">271 FORESIDE RD</a></td></tr>
          </table>
        `,
        { status: 200, headers: { "Content-Type": "text/html" } }
      );
    }
    if (href === "https://gis.vgsi.com/falmouthme/Parcel.aspx?pid=2275") {
      return new Response(
        `
          <html><body>
            <h2>1 HARRIS DR #1 Sales Print Map It</h2>
            <table>
              <tr><td>Owner</td><td>64 FORESIDE PROPERTIES LLC</td></tr>
              <tr><td>PID</td><td>2275</td></tr>
              <tr><td>Address</td><td>1 HARRIS DR FALMOUTH, ME 04105</td></tr>
            </table>
          </body></html>
        `,
        { status: 200, headers: { "Content-Type": "text/html" } }
      );
    }
    throw new Error(`Unexpected fetch ${href}`);
  };
  try {
    const rows = await enrichAddressWithAssessor(
      {
        label: "271 Foreside Rd, Falmouth, ME 04105",
        censusGeocode: {
          censusGeography: {
            state: { stusab: "ME" },
            county: { name: "Cumberland County" },
          },
        },
      },
      async () => {
        throw new Error("generic fetchHtml should not be used for Vision configs");
      }
    );
    const assessorRow = rows.find((row) => row.source === "vision-falmouth-me-mismatch-test");
    assert.ok(assessorRow);
    assert.equal(assessorRow.status, "no_match");
    assert.match(assessorRow.note, /did not confidently match/i);
    assert.deepEqual(assessorRow.ownerNames, []);
  } finally {
    globalThis.fetch = originalFetch;
    if (previous == null) {
      delete process.env.ASSESSOR_SOURCES_JSON;
    } else {
      process.env.ASSESSOR_SOURCES_JSON = previous;
    }
  }
});
