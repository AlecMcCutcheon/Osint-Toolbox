# Public Records & Government Data

**Category:** Public Registry / Government Records  
**Access:** Mixed (Direct HTTP + Browser HTML)  
**Integration Difficulty:** High (varies by jurisdiction)

## Overview

Government and public records are authoritative sources for person, property, and business data. Unlike commercial people-search sites, these are primary sources with high accuracy but varying accessibility.

## Source Types

### 1. County Assessor / Property Records
**Examples:**
- Los Angeles County Assessor: `https://portal.assessor.lacounty.gov`
- Cook County Assessor: `https://www.cookcountyassessor.com`
- Harris County Appraisal District: `https://www.hcad.org`

**Data Available:**
- Property owner name
- Mailing address
- Property value
- Tax records
- Parcel number
- Square footage, lot size
- Year built
- Sales history

**Integration:**
- Already partially implemented via `assessor_records` source
- Each county has unique URL structure and search form
- Some offer direct API/JSON endpoints; others require browser automation
- Config-driven approach with per-county drivers is recommended

### 2. State Voter Registration Records
**Examples:**
- Florida Voter Search: `https://dos.myflorida.com/elections/for-voters/voter-registration/voter-registration-lookup/`
- Texas Voter Lookup: `https://teamrv-mvp.sos.texas.gov`

**Data Available:**
- Full name
- Address
- Party affiliation (in some states)
- Voting history (in some states)
- Date of birth (month/year in some states)

**Integration Notes:**
- Varies wildly by state (some public, some restricted)
- Florida, Texas, Ohio have relatively open records
- California, New York are more restricted
- Requires per-state driver implementation

### 3. Court Records
**Examples:**
- PACER (Federal): `https://pacer.uscourts.gov` (paid, $0.10/page)
- State court portals (varies by state)
- County clerk records

**Data Available:**
- Civil cases
- Criminal records
- Marriage/divorce records
- Bankruptcy filings
- Party names and addresses

**Integration Notes:**
- PACER requires account and payment
- State/county courts vary in online accessibility
- Some use commercial portals (Tyler Technologies, etc.)
- Browser automation often required for search forms

### 4. UCC Filings (Business Liens)
**Examples:**
- State Secretary of State offices
- `https://www.sos.state.tx.us/corp.shtml`

**Data Available:**
- Debtor name
- Secured party name
- Collateral description
- Filing date

### 5. Professional Licenses
**Examples:**
- State medical boards
- State bar associations
- Real estate commissions
- Contractor license boards

**Data Available:**
- Licensee name
- License number
- Address
- License status
- Disciplinary actions

## Integration Strategy

### 1. Registry-Driver Architecture
The existing `assessor_records` source already points toward a driver-based approach:

```javascript
// src/registryDrivers/countyAssessor.mjs
export const COUNTY_DRIVERS = {
  "los-angeles-ca": {
    name: "Los Angeles County Assessor",
    searchType: "form_post",
    searchUrl: "https://portal.assessor.lacounty.gov/api/parcelsearch",
    buildSearchPayload: (address) => ({ street: address.street, city: address.city }),
    parseResult: (json) => ({
      owner: json.ownerName,
      mailingAddress: json.mailingAddress,
      assessedValue: json.assessedValue,
      parcelNumber: json.ain,
    }),
  },
  "cook-il": {
    name: "Cook County Assessor",
    searchType: "browser_workflow",
    searchUrl: "https://www.cookcountyassessor.com/search",
    // Requires Playwright form submission
  },
};
```

### 2. State Voter Record Driver

```javascript
export const VOTER_DRIVERS = {
  "fl": {
    name: "Florida Voter Registration",
    searchType: "browser_workflow",
    searchUrl: "https://registration.elections.myflorida.com/CheckVoterStatus",
    requiredFields: ["firstName", "lastName", "dateOfBirth"],
  },
  "tx": {
    name: "Texas Voter Lookup",
    searchType: "direct_fetch",
    searchUrl: "https://teamrv-mvp.sos.texas.gov/MVP/mvp.do",
    // ...
  },
};
```

## Data Domains

- `person` (name, DOB)
- `address` (residential, mailing)
- `parcel` (property)
- `org` (business entities)
- `license` (professional)
- `filing` (court, UCC)

## Benefits to the Program

1. **Authoritative Data:** Government records are primary sources - highest accuracy
2. **Property Ownership:** Confirms who actually owns a property vs. who lives there
3. **Voter Data:** Name + address + DOB is the gold standard for identity verification
4. **Court Intelligence:** Legal history adds investigative depth
5. **Business Affiliations:** UCC filings and business registrations reveal financial ties

## Overlaps

- `assessor_records`
- `usphonebook_profile`
- `public_web_directories`
- `census_geocoder`

## Implementation Notes

- **This is the highest-value but highest-effort expansion**
- Each jurisdiction requires bespoke driver development
- Consider a **community driver registry** where users can contribute county/state parsers
- Store raw source documents before parsing (per roadmap item `source_documents`)
- PACER integration requires payment infrastructure; consider as premium feature
- Voter records should be handled carefully due to varying state laws
- Professional license boards are often the easiest starting point (simple search forms)
- The existing `public_web_directories` planned source is the right architectural bucket for this
