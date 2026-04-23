import test from "node:test";
import assert from "node:assert/strict";
import { parseUsPhonebookProfileHtml } from "../src/parseUsPhonebookProfile.mjs";

test("parseUsPhonebookProfileHtml dedupes same canonical address and keeps most recent period current", () => {
  const html = `
    <div>
      <div class="phase2-section">
        <h3><span>Crystal Drake</span></h3>
        <div class="ls_contacts__title">Current Address</div>
        <div>
          <a href="/address/16-winter-st-unit-1_waterville-me">
            16 Winter St, UNIT 1, Waterville, ME 04901-6063
            <span class="minor-lapse">(Aug 2016 - Mar 2026)</span>
          </a>
        </div>
        <div class="ls_contacts__title">Previous Addresses</div>
        <div>
          <a href="/address/16-winter-st-unit-1_waterville-me">
            16 Winter St, UNIT 1, Waterville, ME 04901-6063
            <span class="minor-lapse">(Feb 2017 - Aug 2019)</span>
          </a>
          <a href="/address/100-newport-rd_corinna-me">
            100 Newport Rd, Corinna, ME 04928-3739
            <span class="minor-lapse">(Feb 2015 - Dec 2019)</span>
          </a>
        </div>
        <ul class="marital-section">
          <li>Spouse: <a href="/crystal-ann-drake/UwM3gjN5gjNygjM2MTOzEjNzEzR">Crystal Drake</a></li>
          <li>Spouse: <a href="/robert-scott/abc123/">Robert Scott</a></li>
        </ul>
        <div class="section-relative">
          <a class="ls_success-link" href="/crystal-ann-drake/UwM3gjN5gjNygjM2MTOzEjNzEzR">Crystal Drake</a>
          <a class="ls_success-link" href="/kassie-mears/UUzN2MDMzATNwADNzgDN3QzN3gzR">Kassie Mears</a>
        </div>
      </div>
    </div>
  `;
  const parsed = parseUsPhonebookProfileHtml(html);
  assert.equal(parsed.addresses.length, 2);
  assert.equal(parsed.addresses[0].formattedFull, "16 Winter St, Unit 1, Waterville, ME 04901-6063");
  assert.equal(parsed.addresses[0].normalizedKey, "16 winter st, unit 1, waterville, me 04901 6063");
  assert.equal(parsed.addresses[0].isCurrent, true);
  assert.equal(parsed.addresses[0].periods.length, 2);
  assert.deepEqual(
    parsed.addresses[0].periods.map((p) => p.recordedRange),
    ["(Aug 2016 - Mar 2026)", "(Feb 2017 - Aug 2019)"]
  );
  assert.equal(parsed.addresses[1].isCurrent, false);
  assert.equal(parsed.addresses[1].periods.length, 1);
  assert.equal(parsed.relatives.length, 1);
  assert.equal(parsed.relatives[0].name, "Kassie Mears");
  assert.equal(parsed.marital.length, 1);
  assert.equal(parsed.marital[0].name, "Robert Scott");
});

test("parseUsPhonebookProfileHtml cleans obviously empty workplace location fields", () => {
  const html = `
    <div>
      <div class="phase2-section">
        <h3><span>Crystal Drake</span></h3>
        <div class="workplace-expandable-list">
          <div class="ls_contacts__title"><h3>Workplaces</h3></div>
          <div class="relative-card workplace">
            <p class="current">Current</p>
            <p>Massage Therapist</p>
            <p class="companyName">Eaglxxxxxxxxxx</p>
            <p>, ,</p>
          </div>
        </div>
      </div>
    </div>
  `;
  const parsed = parseUsPhonebookProfileHtml(html);
  assert.equal(parsed.workplaces.length, 1);
  assert.equal(parsed.workplaces[0].title, "Massage Therapist");
  assert.equal(parsed.workplaces[0].location, null);
});