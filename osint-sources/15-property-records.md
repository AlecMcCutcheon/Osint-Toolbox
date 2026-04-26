# Property Records & Real Estate OSINT

**Category:** Property / Real Estate Intelligence  
**Access:** Browser HTML + Direct HTTP  
**Integration Difficulty:** Medium

## Overview

Property and real estate records provide address-centric intelligence that complements people-search data. These sources reveal who owns property, who lives at an address, property values, and neighborhood context.

## Sources

### 1. Realtor.com
**URL:** https://www.realtor.com

**Search Patterns:**
```
https://www.realtor.com/realestateandhomes-detail/{address_slug}_{property_id}
```

**Data Available:**
- Property details (beds, baths, sqft, lot size)
- Sale history
- Estimated value
- Property photos
- Neighborhood stats
- School ratings

**Integration:**
```javascript
export function buildRealtorAddressUrl(address) {
  const slug = addressToSlug(address);
  return `https://www.realtor.com/realestateandhomes-search/${slug}`;
}
```

### 2. PropertyShark.com
**URL:** https://www.propertyshark.com

**Search Patterns:**
```
https://www.propertyshark.com/mason/Property/XXXXXXXX/
```

**Data Available:**
- Owner name
- Owner mailing address
- Property value
- Tax assessments
- Building permits
- Zoning
- Sales history

**Integration Notes:**
- Free tier provides basic owner info
- Detailed reports require subscription
- Strong for New York, California, Florida, Texas

### 3. Redfin
**URL:** https://www.redfin.com

**Search Patterns:**
```
https://www.redfin.com/address/{address_slug}
```

**Data Available:**
- Sale history
- Estimated value
- Property details
- Photos
- Comparable sales

### 4. Zillow
**URL:** https://www.zillow.com

**Search Patterns:**
```
https://www.zillow.com/homes/{address_slug}_rb/
```

**Data Available:**
- Zestimate (estimated value)
- Sale history
- Tax history
- Property details
- Photos

**Integration Notes:**
- Zillow is heavily JavaScript-rendered and anti-bot protected
- Uses Next.js with embedded JSON data (similar to Spokeo)
- Requires Playwright with warmed session

### 5. NeighborWho
**URL:** https://www.neighborwho.com

**Data Available:**
- Property owner
- Residents
- Neighbor information
- Property details

## Integration Strategy

### 1. Address-Centric Pipeline
When an address entity is created or enriched, trigger property record lookup:

```javascript
async function enrichAddressWithPropertyRecords(addressEntity) {
  const address = addressEntity.data.formattedFull;
  
  // Try multiple sources in parallel
  const [realtor, zillow, propertyShark] = await Promise.allSettled([
    fetchRealtorData(address),
    fetchZillowData(address),
    fetchPropertySharkData(address),
  ]);
  
  return {
    estimatedValue: zillow.value?.zestimate || realtor.value?.estimate || null,
    saleHistory: zillow.value?.saleHistory || realtor.value?.saleHistory || [],
    owner: propertyShark.value?.owner || null,
    ownerMailingAddress: propertyShark.value?.ownerMailingAddress || null,
    propertyDetails: {
      beds: realtor.value?.beds || null,
      baths: realtor.value?.baths || null,
      sqft: realtor.value?.sqft || null,
      lotSize: realtor.value?.lotSize || null,
      yearBuilt: realtor.value?.yearBuilt || null,
    },
  };
}
```

### 2. Owner-Resident Divergence Detection
A key OSINT insight is when property owner != resident:

```javascript
function detectOwnerResidentDivergence(propertyData, residents) {
  const ownerName = propertyData.owner;
  const residentNames = residents.map((r) => r.displayName?.toLowerCase());
  
  if (ownerName && !residentNames.some((r) => ownerName.toLowerCase().includes(r))) {
    return {
      divergence: true,
      owner: ownerName,
      residents: residentNames,
      insight: "Property owner does not appear to reside at this address",
    };
  }
  return { divergence: false };
}
```

This indicates:
- Rental property
- Property owned by family member
- Business-owned residential property
- Potential shell ownership

## Data Domains

- `address` (enriched with property details)
- `person` (owner)
- `parcel` (assessor data)
- `org` (business owner)

## Benefits to the Program

1. **Ownership Verification:** Confirms who actually owns a property
2. **Resident Discovery:** Finds all residents at an address (not just phone book listings)
3. **Value Assessment:** Property value indicates economic status
4. **Sale History:** Timeline of property transactions
5. **Rental Detection:** Owner-resident divergence indicates rental properties
6. **Business Ownership:** Properties owned by LLCs/corporations are investigative leads

## Overlaps

- `assessor_records`
- `clustrmaps`
- `usphonebook_profile`
- `census_geocoder`

## Implementation Notes

- Property sources are address-centric; integrate as enrichment after address normalization
- Zillow and Realtor.com are JavaScript-heavy; require Playwright
- PropertyShark has strong owner data but is subscription-based for details
- Store property photos as evidence URLs in address entity data
- Sale history should create temporal events in the graph
- Owner mailing addresses may differ from property address - creates new address entities
- Consider adding `parcel` entity type for property-specific data separate from address
- The `owner_resident_divergence` insight should be flagged for analyst attention
