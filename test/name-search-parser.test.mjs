import test from "node:test";
import assert from "node:assert/strict";
import { parseUsPhonebookNameSearchHtml } from "../src/parseUsPhonebookNameSearch.mjs";

test("parseUsPhonebookNameSearchHtml extracts result summary and candidates", () => {
  const html = `
    <div class="wrapper-success result-block">
      <div class="row search-header">
        <div class="info-wrapper"><h1 class="ls_header-5">John Doe</h1></div>
        <h2>Success, We've found 2 records for John Doe</h2>
        <div class="info-wrapper">
          <p class="info-text-description">We uncovered 2 records for the name John Doe in and around Portland, ME.</p>
        </div>
      </div>
      <div class="content-success clearfix">
        <div class="success-wrapper result-by-name pull-left">
          <div class="success-wrapper-block" itemid="https://www.usphonebook.com/john-rohack/U3QDO5kzM2YjM3gzM2cDN3EDO40yR">
            <div class="ls_contacts-people-finder-wrapper">
              <div class="success-wrapper-padding">
                <h3 class="ls_number-text"><span itemprop="name">John Thomas Rohack</span>, Age 20</h3>
                <div class="ls_success-content-extra-info">Lives in: <span class="ls_success-black-text" itemprop="address">Tappan, NY</span></div>
                <div class="ls_success-content-extra-info ls_overflow-ellipsis">Prior addresses:
                  <span class="ls_success-black-text"><span itemprop="address">New City, NY</span><span>, </span></span>
                  <span class="ls_success-black-text"><span itemprop="address">Pearl River, NY</span><span>, </span></span>
                  <span class="ls_success-black-text"><span itemprop="address">Oradell, NJ</span></span>
                </div>
                <div class="ls_success-content-extra-info">Relatives:
                  <a href="/georgia-dee-barker/UAjM1UTN3cTO5YzM0EzMzEDO1YzR" class="ls_success-blue-link">Georgia Barker,</a>
                  <a href="/ellen-a-greene/UyMTO4czN2IzN3IjM4QDOwUTN00yR" class="ls_success-blue-link">Ellen Greene</a>
                </div>
                <a href="/john-rohack/U3QDO5kzM2YjM3gzM2cDN3EDO40yR" class="ls_contacts-btn ls_success-extra-margin">VIEW FULL ADDRESS &amp; PHONE</a>
              </div>
            </div>
          </div>
          <div class="success-wrapper-block" itemid="https://www.usphonebook.com/john-doerrie/UkDMwAzN2MTN4cDM4YzNxQDMykzR">
            <div class="ls_contacts-people-finder-wrapper">
              <div class="success-wrapper-padding">
                <h3 class="ls_number-text"><span itemprop="name">John J Doerrie</span>, Age 98</h3>
                <div class="ls_success-content-extra-info">Lives in: <span class="ls_success-black-text" itemprop="address">Fountain Valley, CA</span></div>
                <div class="ls_success-content-extra-info ls_overflow-ellipsis">Prior addresses:
                  <span class="ls_success-black-text"><span itemprop="address">Santa Ana, CA</span><span>, </span></span>
                  <span class="ls_success-black-text"><span itemprop="address">Long Beach, CA</span></span>
                </div>
                <div class="ls_success-content-extra-info">Relatives:
                  <a href="/elsie-audrey-doerrie/U0YzM5cDO0UjNygTOxkTN0QTO30yR" class="ls_success-blue-link">Elsie Doerrie</a>
                </div>
                <a href="/john-doerrie/UkDMwAzN2MTN4cDM4YzNxQDMykzR" class="ls_contacts-btn ls_success-extra-margin">VIEW FULL ADDRESS &amp; PHONE</a>
              </div>
            </div>
          </div>
        </div>
      </div>
      <p>Still searching for the right John Doe in Portland, ME? We have 2 pages of results for John Doe.</p>
    </div>
  `;

  const parsed = parseUsPhonebookNameSearchHtml(html);
  assert.equal(parsed.queryName, "John Doe");
  assert.equal(parsed.totalRecords, 2);
  assert.equal(parsed.totalPages, 2);
  assert.equal(parsed.candidates.length, 2);
  assert.equal(parsed.candidates[0].displayName, "John Thomas Rohack");
  assert.equal(parsed.candidates[0].age, 20);
  assert.equal(parsed.candidates[0].currentCityState, "Tappan, NY");
  assert.deepEqual(parsed.candidates[0].priorAddresses, ["New City, NY", "Pearl River, NY", "Oradell, NJ"]);
  assert.equal(parsed.candidates[0].relatives.length, 2);
  assert.equal(parsed.candidates[0].profilePath, "/john-rohack/U3QDO5kzM2YjM3gzM2cDN3EDO40yR");
  assert.equal(parsed.candidates[1].displayName, "John J Doerrie");
  assert.equal(parsed.candidates[1].relatives[0].name, "Elsie Doerrie");
});
