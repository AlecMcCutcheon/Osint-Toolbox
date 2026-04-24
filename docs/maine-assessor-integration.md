# Maine Assessor Integration

This app can move an address from `Assessor ref` to real parcel data only when it has a municipality or county property-search URL that can be fetched deterministically.

## What "fully integrated" means

For a Maine municipality, the app is fully integrated only when all of these are true:

1. The address geocodes successfully.
2. The municipality has a predictable property-search or parcel-result URL.
3. That URL can be reached by direct fetch or the protected fetch helper.
4. The returned HTML contains fields the generic parser can extract, such as owner, parcel ID, assessed value, market value, or mailing address.

If any of those are missing, the app falls back to orange `Assessor ref`, which is just a reference directory, not parcel data.

## Best order for Maine work

Do not try to solve all of Maine at once. Work municipality-first.

Recommended order:

1. Pick the Maine towns or cities you care about most.
2. For each one, find the public property/assessor search page.
3. Check whether a search result URL can be constructed from address parts.
4. Add one config entry.
5. Test it with a known address.
6. Move to the next municipality only after the first is green.

Good early targets are municipalities with public, unauthenticated search pages and stable query parameters.

## When the current config system is enough

The current generic config path is enough when the assessor site:

- accepts query params in the URL
- renders the result as ordinary HTML
- does not require a login
- does not require a CAPTCHA
- does not require a complex multi-step JavaScript workflow

In those cases, use `ASSESSOR_SOURCES_FILE` and add a config entry.

## When you need a custom driver later

The current config system is not enough when the site:

- requires a search form POST with anti-CSRF tokens
- requires selecting result rows across multiple pages
- is a GIS map app with no stable HTML result page
- blocks direct fetches and only works in a live browser workflow
- needs town-specific parsing rules beyond the generic owner/parcel/value fields

Those sites need a dedicated municipality driver later. Start with the easy municipalities first.

## Config file workflow

Use `ASSESSOR_SOURCES_FILE` in `.env`:

```dotenv
ASSESSOR_SOURCES_FILE=./docs/assessor-sources.maine.json
```

Then create a JSON array in that file. Each object is one municipality or county source.

Supported matching/filter fields:

- `state`
- `countyIncludes`
- `cityIncludes`
- `townIncludes`

Supported URL placeholders:

- `{encodedAddress}`
- `{address}`
- `{encodedStreet}`
- `{street}`
- `{encodedCity}`
- `{city}`
- `{citySlug}`
- `{state}`
- `{county}`
- `{zip}`

## Starter example

```json
[
  {
    "key": "portland-me-assessor",
    "name": "Portland Assessor",
    "state": "ME",
    "countyIncludes": ["cumberland"],
    "cityIncludes": ["portland"],
    "searchUrlTemplate": "https://property.example.gov/search?street={encodedStreet}&city={encodedCity}&state={state}&zip={zip}",
    "maxTimeout": 25000,
    "useFlare": false
  }
]
```

Use one entry per municipality family. If a county and a town use different search systems, treat them as separate entries.

## How to evaluate a Maine assessor site

For each municipality, answer these questions before adding a config:

1. Can I search by street address without signing in?
2. After searching manually, does the browser end up on a stable URL?
3. Does that URL include query params I can reconstruct from address parts?
4. Is the result page HTML, not only a JavaScript map canvas?
5. Does the page visibly include owner, parcel ID, or assessed value text?

If the answer to 2 through 5 is yes, it is a good candidate for the current config system.

## Practical test loop

For one municipality:

1. Add the config entry to `ASSESSOR_SOURCES_FILE`.
2. Restart the app.
3. Run a profile lookup for a known Maine address in that municipality.
4. Check the node terminal for the assessor fetch attempt.
5. Confirm the UI changes from orange `ref` to green `ok`.

If it still shows orange `ref`, that means the municipality config did not match the address.

If it shows grey `no match`, that means the config matched but the page did not yield structured parcel fields.

## What to capture when a municipality fails

When a municipality does not integrate cleanly, capture these facts:

1. The town name and county.
2. The exact public search URL.
3. Whether it is GET, POST, or a JavaScript workflow.
4. Whether direct fetch works or needs browser automation.
5. A sample result page URL.
6. Which fields are visible on the page.

With that, it becomes straightforward to decide whether to keep it as a config entry or promote it to a custom driver.

## Recommended Maine rollout

Treat Maine as a staged rollout:

1. Tier 1: municipalities with simple public search pages and stable query params.
2. Tier 2: municipalities with static HTML but inconsistent layouts.
3. Tier 3: municipalities using GIS-heavy or JS-heavy property systems.

Tier 1 should be your immediate focus because it turns orange references into green parcel data fastest.

## Next step

The fastest way forward is to pick 3 to 5 Maine municipalities you use most often. Then build and test those entries one at a time.