import { getDb } from "./db/db.mjs";

const SOURCE_DEFINITIONS = [
  {
    id: "usphonebook_phone_search",
    name: "USPhoneBook reverse phone",
    status: "active",
    category: "people_directory",
    access: "browser_challenge_html",
    acquisition: {
      current: "FlareSolverr-backed HTML fetch",
      recommended: "Playwright persistent context worker for future multi-hop crawling",
    },
    runtime: {
      label: "FlareSolverr + cheerio parser",
      detail: "Remote browser challenge handling via FlareSolverr; HTML is parsed server-side.",
    },
    dataDomains: ["person", "phone", "profile_path", "household_links"],
    overlaps: ["usphonebook_profile", "truepeoplesearch", "thatsthem"],
    siloRisk: "medium",
    expansionPriority: 1,
    automationBlueprint: {
      primaryFramework: "Playwright",
      alternates: ["Puppeteer", "Selenium"],
      sessionStrategy: "One persistent browser context per source family with TTL-based recycling and explicit storage-state checkpoints.",
      navigationStrategy: "Queue-based navigation with deterministic waits, per-page timeout budgets, and request/response telemetry.",
      extractionStrategy: "Capture final DOM plus selected network metadata, then parse server-side into normalized source documents.",
      notes: [
        "Current implementation uses FlareSolverr; future browser workers should preserve source provenance and screenshots on parser failure.",
        "Prefer one solver/browser lane per source family rather than one global session for everything.",
      ],
    },
  },
  {
    id: "usphonebook_profile",
    name: "USPhoneBook profile pages",
    status: "active",
    category: "profile_document",
    access: "browser_challenge_html",
    acquisition: {
      current: "FlareSolverr-backed profile fetch + parse",
      recommended: "Playwright persistent context with follow-on address-page crawling",
    },
    runtime: {
      label: "FlareSolverr + cheerio parser",
      detail: "Profile pages are fetched through FlareSolverr and enriched server-side.",
    },
    dataDomains: ["person", "address", "phone", "email", "relative", "workplace", "education"],
    overlaps: ["usphonebook_phone_search", "truepeoplesearch", "thatsthem", "assessor_records"],
    siloRisk: "high",
    expansionPriority: 1,
    automationBlueprint: {
      primaryFramework: "Playwright",
      alternates: ["Puppeteer"],
      sessionStrategy: "Keep household/profile traversals within the same context so linked pages share cookies, localStorage, and navigation history.",
      navigationStrategy: "Profile -> address -> related profile job chains with explicit depth limits and queue backpressure.",
      extractionStrategy: "Persist raw profile documents separately before graph ingestion so parser revisions can be replayed without re-fetching.",
      notes: [
        "Best next zero-API expansion is dedicated address-page crawling because the site already exposes those pivots.",
      ],
    },
  },
  {
    id: "truepeoplesearch",
    name: "TruePeopleSearch",
    status: "active",
    category: "people_directory",
    access: "browser_html",
    acquisition: {
      current: "Cached HTML fetch + parser",
      recommended: "Playwright context worker with request/response tracing and challenge-state classification",
    },
    runtime: {
      label: "HTTP/Flare fetch + parser",
      detail: "Direct HTML fetch path with caching; challenge handling falls back through current fetch helpers.",
    },
    dataDomains: ["person", "address", "phone", "relative"],
    overlaps: ["usphonebook_phone_search", "usphonebook_profile", "thatsthem"],
    siloRisk: "medium",
    expansionPriority: 2,
    automationBlueprint: {
      primaryFramework: "Playwright",
      alternates: ["Puppeteer"],
      sessionStrategy: "Shared context per target site with cookie persistence and bounded concurrency.",
      navigationStrategy: "Search result landing pages with block/no-match/error classification before deeper parsing.",
      extractionStrategy: "Parser-first with DOM snapshots and failure samples persisted for drift analysis.",
      notes: [
        "Treat challenge pages as explicit states, not silent no-match results.",
      ],
    },
  },
  {
    id: "thatsthem",
    name: "That's Them",
    status: "active",
    category: "people_directory",
    access: "browser_html",
    acquisition: {
      current: "Cached HTML fetch + parser",
      recommended: "Playwright context worker with route-level observability",
    },
    runtime: {
      label: "HTTP/Flare fetch + parser",
      detail: "Candidate URLs are fetched and parsed with explicit blocked/no-match states.",
    },
    dataDomains: ["person", "address", "phone", "email"],
    overlaps: ["usphonebook_phone_search", "usphonebook_profile", "truepeoplesearch"],
    siloRisk: "medium",
    expansionPriority: 2,
    automationBlueprint: {
      primaryFramework: "Playwright",
      alternates: ["Puppeteer"],
      sessionStrategy: "Persistent context with conservative request pacing and source-specific cache keys.",
      navigationStrategy: "Candidate URL ladder with deterministic fallback handling.",
      extractionStrategy: "Contact-card and alternate-layout parsers with structured blocked/no-match outcomes.",
      notes: [
        "Network and parser traces are more valuable than trying to hide automation behavior.",
      ],
    },
  },
  {
    id: "census_geocoder",
    name: "U.S. Census geocoder",
    status: "active",
    category: "public_registry",
    access: "direct_http",
    acquisition: {
      current: "Direct HTTP JSON fetch",
      recommended: "Keep direct fetch with aggressive caching",
    },
    runtime: {
      label: "Direct fetch",
      detail: "No browser automation; normalized addresses are geocoded via public HTTP requests.",
    },
    dataDomains: ["address", "coordinates", "census_geography"],
    overlaps: ["assessor_records", "openstreetmap_overpass"],
    siloRisk: "low",
    expansionPriority: 2,
    automationBlueprint: {
      primaryFramework: "Direct fetch",
      alternates: [],
      sessionStrategy: "No browser context required; cache results by normalized address.",
      navigationStrategy: "Single-request enrichment after address normalization.",
      extractionStrategy: "Response reduction into stable geographic fields.",
      notes: ["Keep user-agent/contact metadata explicit and polite."],
    },
  },
  {
    id: "openstreetmap_overpass",
    name: "OpenStreetMap / Overpass",
    status: "active",
    category: "geospatial_context",
    access: "direct_http",
    acquisition: {
      current: "Direct POST query with rate limiting",
      recommended: "Keep direct fetch and queue requests centrally",
    },
    runtime: {
      label: "Direct fetch",
      detail: "Rate-limited Overpass POST queries with cache-backed summaries.",
    },
    dataDomains: ["location_context", "poi", "proximity"],
    overlaps: ["census_geocoder", "assessor_records"],
    siloRisk: "low",
    expansionPriority: 3,
    automationBlueprint: {
      primaryFramework: "Direct fetch",
      alternates: [],
      sessionStrategy: "Central queue with minimum interval enforcement.",
      navigationStrategy: "Only request after geocode success.",
      extractionStrategy: "Reduce raw elements into nearby-place summaries with deterministic distance sorting.",
      notes: ["Good example of enrichment that should never require browser automation."],
    },
  },
  {
    id: "assessor_records",
    name: "County assessor / property records",
    status: "active",
    category: "public_registry",
    access: "mixed_html",
    acquisition: {
      current: "Config-driven fetch and generic HTML extraction",
      recommended: "Registry of per-county drivers with browser/manual modes",
    },
    runtime: {
      label: "Config-driven fetch + HTML extraction",
      detail: "County sources use configured URLs plus generic extraction; no Playwright worker exists yet.",
    },
    dataDomains: ["address", "owner", "parcel", "value", "tax_metadata"],
    overlaps: ["census_geocoder", "usphonebook_profile"],
    siloRisk: "high",
    expansionPriority: 2,
    automationBlueprint: {
      primaryFramework: "Playwright",
      alternates: ["Selenium", "Direct fetch"],
      sessionStrategy: "Per-county driver capabilities (direct fetch, static HTML parse, or full browser workflow).",
      navigationStrategy: "Address/parcel search workflows with explicit extractor contracts per county family.",
      extractionStrategy: "Persist raw result pages and parsed parcel snapshots separately.",
      notes: [
        "This is the cleanest place to introduce driver plug-ins because county sites vary wildly.",
      ],
    },
  },
  {
    id: "telecom_local",
    name: "Local telecom / NANP analysis",
    status: "active",
    category: "local_enrichment",
    access: "local_logic",
    acquisition: {
      current: "Pure local classification",
      recommended: "Keep local",
    },
    runtime: {
      label: "Local logic",
      detail: "Deterministic enrichment with no external network dependency.",
    },
    dataDomains: ["phone", "numbering_plan", "line_classification"],
    overlaps: ["usphonebook_phone_search", "truepeoplesearch", "thatsthem"],
    siloRisk: "low",
    expansionPriority: 4,
    automationBlueprint: {
      primaryFramework: "Local logic",
      alternates: [],
      sessionStrategy: "No session required.",
      navigationStrategy: "Enrich at parse time.",
      extractionStrategy: "Deterministic classification from normalized digits.",
      notes: ["Use this as a trust anchor when remote sources disagree."],
    },
  },
  {
    id: "social_public_web",
    name: "Social media public web surfaces",
    status: "planned",
    category: "social_surface",
    access: "browser_workflow",
    acquisition: {
      current: "Not implemented",
      recommended: "Playwright workers with source-specific view models and manual-review checkpoints",
    },
    dataDomains: ["handle", "display_name", "bio", "links", "public_posts", "media_refs"],
    overlaps: ["usphonebook_profile", "public_web_directories"],
    siloRisk: "high",
    expansionPriority: 3,
    automationBlueprint: {
      primaryFramework: "Playwright",
      alternates: ["Selenium", "Puppeteer"],
      sessionStrategy: "Persistent per-platform contexts with saved storage state and explicit account isolation.",
      navigationStrategy: "Seed from known handles/URLs, capture profile cards and post indexes, and queue expansions conservatively.",
      extractionStrategy: "Browser-side DOM extraction with screenshot and HTML capture for every source document.",
      notes: [
        "Implement only for publicly visible pages and model manual review gates before any deep crawl.",
        "Do not rely on fragile one-off selectors; define adapter contracts per platform.",
      ],
    },
  },
  {
    id: "public_web_directories",
    name: "Public registries and web directories",
    status: "planned",
    category: "registry_family",
    access: "mixed_html",
    acquisition: {
      current: "Not implemented",
      recommended: "Driver registry supporting direct fetch, Playwright, or Selenium per site family",
    },
    dataDomains: ["person", "address", "org", "filing", "license", "registration"],
    overlaps: ["assessor_records", "social_public_web"],
    siloRisk: "medium",
    expansionPriority: 2,
    automationBlueprint: {
      primaryFramework: "Playwright",
      alternates: ["Direct fetch", "Selenium"],
      sessionStrategy: "One worker pool per registry family with capability flags stored in a source registry.",
      navigationStrategy: "Form-submit/search-result/detail-page pipelines with replayable step traces.",
      extractionStrategy: "Persist both structured fields and evidence snippets for each observed fact.",
      notes: ["Model registries as first-class connectors with declared search keys, rate limits, and parser tests."],
    },
  },
  {
    id: "deep_web_directories",
    name: "Searchable deep-web directories",
    status: "planned",
    category: "directory_family",
    access: "browser_workflow",
    acquisition: {
      current: "Not implemented",
      recommended: "Playwright form-workflow drivers with trace capture and bounded crawl depth",
    },
    dataDomains: ["directory_entry", "contact_point", "cross_reference", "location"],
    overlaps: ["public_web_directories", "social_public_web"],
    siloRisk: "high",
    expansionPriority: 3,
    automationBlueprint: {
      primaryFramework: "Playwright",
      alternates: ["Selenium"],
      sessionStrategy: "Isolate each directory in its own persistent context and recycle contexts on schedule or error threshold.",
      navigationStrategy: "Search form -> paginated results -> detail record chain with cursor checkpoints and replay logs.",
      extractionStrategy: "Structured result harvesting plus raw HTML snapshots for parser drift recovery.",
      notes: [
        "Treat these as workflow automations, not generic crawlers.",
        "Favor resumable jobs and source health scoring over high request volume.",
      ],
    },
  },
];

const ROADMAP = [
  {
    id: "source_documents",
    title: "Persist source documents before graph merges",
    priority: "now",
    summary: "Store raw source documents, retrieval metadata, and parser outputs separately so source drift can be replayed without re-fetching.",
  },
  {
    id: "authoritative_server_jobs",
    title: "Make server-side jobs authoritative",
    priority: "now",
    summary: "Move the browser queue from source-of-truth to UI state only; persist job runs, source runs, and replayable artifacts on the server.",
  },
  {
    id: "address_and_registry_drivers",
    title: "Introduce driver registry for address and public-record sources",
    priority: "next",
    summary: "Define connector capabilities, search inputs, wait strategies, and extractor contracts per source family instead of hard-coding bespoke flows.",
  },
  {
    id: "browser_worker_pool",
    title: "Add browser worker pool",
    priority: "next",
    summary: "Run Playwright-based workers with persistent contexts, storage-state checkpoints, route telemetry, and controlled concurrency for JS-heavy sources.",
  },
  {
    id: "social_surface_connectors",
    title: "Add public social-surface connectors",
    priority: "later",
    summary: "Implement source-specific adapters for public profile pages, external links, and post indexes with manual-review checkpoints.",
  },
  {
    id: "field_provenance",
    title: "Attach per-field provenance",
    priority: "now",
    summary: "Every normalized fact should carry source id, URL, retrieval time, evidence snippet, and confidence so overlaps become explainable instead of opaque.",
  },
];

const OVERLAP_GROUPS = [
  {
    id: "person_identity",
    title: "Person identity overlap",
    sources: ["usphonebook_phone_search", "usphonebook_profile", "truepeoplesearch", "thatsthem", "social_public_web"],
    fields: ["display_name", "aliases", "profile path/handle", "relatives"],
  },
  {
    id: "address_context",
    title: "Address context overlap",
    sources: ["usphonebook_profile", "census_geocoder", "openstreetmap_overpass", "assessor_records", "public_web_directories"],
    fields: ["normalized address", "geography", "parcel context", "nearby places"],
  },
  {
    id: "phone_facts",
    title: "Phone fact overlap",
    sources: ["usphonebook_phone_search", "usphonebook_profile", "truepeoplesearch", "thatsthem", "telecom_local"],
    fields: ["normalized line", "line type", "ownership clues"],
  },
];

const SILO_FINDINGS = [
  {
    id: "browser_queue_truth",
    title: "Browser queue remains a data silo",
    severity: "high",
    detail: "Completed jobs still originate from browser-local state and must be pushed back to the server to reconstruct graph truth.",
  },
  {
    id: "source_document_gap",
    title: "Source documents are not yet first-class persisted records",
    severity: "high",
    detail: "Current ingestion stores merged entities but not replayable source documents, making parser evolution and audit trails harder.",
  },
  {
    id: "connector_capabilities_gap",
    title: "Connector capabilities are implicit in code",
    severity: "medium",
    detail: "The app has multiple adapters, but rate limits, session models, and search inputs are not represented in a source registry.",
  },
  {
    id: "fetch_telemetry_gap",
    title: "Fetch observability is incomplete",
    severity: "medium",
    detail: "There is limited structured capture of navigation timings, blocked states, and parser-failure artifacts across sources.",
  },
];

/**
 * @param {Map<string, { entityRefs: number; cacheRefs: number; types: Set<string> }>} usage
 * @returns {Record<string, { entityRefs: number; cacheRefs: number; entityTypes: string[] }>}
 */
function finalizeUsage(usage) {
  const out = {};
  for (const [key, value] of usage.entries()) {
    out[key] = {
      entityRefs: value.entityRefs,
      cacheRefs: value.cacheRefs,
      entityTypes: Array.from(value.types).sort(),
    };
  }
  return out;
}

/**
 * @param {Map<string, { entityRefs: number; cacheRefs: number; types: Set<string> }>} usage
 * @param {string | null | undefined} sourceId
 * @param {string | null | undefined} entityType
 * @returns {void}
 */
function markUsage(usage, sourceId, entityType) {
  const key = String(sourceId || "").trim();
  if (!key) {
    return;
  }
  if (!usage.has(key)) {
    usage.set(key, { entityRefs: 0, cacheRefs: 0, types: new Set() });
  }
  const bucket = usage.get(key);
  bucket.entityRefs += 1;
  if (entityType) {
    bucket.types.add(String(entityType));
  }
}

/**
 * @param {Map<string, { entityRefs: number; cacheRefs: number; types: Set<string> }>} usage
 * @param {string | null | undefined} sourceId
 * @returns {void}
 */
function markCacheUsage(usage, sourceId) {
  const key = String(sourceId || "").trim();
  if (!key) {
    return;
  }
  if (!usage.has(key)) {
    usage.set(key, { entityRefs: 0, cacheRefs: 0, types: new Set() });
  }
  usage.get(key).cacheRefs += 1;
}

/**
 * @param {object} data
 * @param {string} entityType
 * @param {Map<string, { entityRefs: number; cacheRefs: number; types: Set<string> }>} usage
 * @returns {void}
 */
function collectNestedUsage(data, entityType, usage) {
  if (!data || typeof data !== "object") {
    return;
  }
  markUsage(usage, data.source, entityType);
  if (data.externalSources && typeof data.externalSources === "object") {
    const peopleFinders = Array.isArray(data.externalSources.peopleFinders) ? data.externalSources.peopleFinders : [];
    for (const source of peopleFinders) {
      markUsage(usage, source?.source, entityType);
    }
    if (data.externalSources.telecom) {
      markUsage(usage, "telecom_local", entityType);
    }
  }
  if (data.censusGeocode) {
    markUsage(usage, "census_geocoder", entityType);
  }
  if (data.nearbyPlaces) {
    markUsage(usage, "openstreetmap_overpass", entityType);
  }
  if (Array.isArray(data.assessorRecords)) {
    for (const record of data.assessorRecords) {
      if (!record || typeof record !== "object") {
        continue;
      }
      if (String(record.source || "").startsWith("maine-county-reference:")) {
        markUsage(usage, "assessor_records", entityType);
        continue;
      }
      markUsage(usage, record.source || "assessor_records", entityType);
      markUsage(usage, "assessor_records", entityType);
    }
  }
}

/**
 * @returns {Record<string, { entityRefs: number; cacheRefs: number; entityTypes: string[] }>}
 */
export function getObservedSourceUsage() {
  const db = getDb();
  const usage = new Map();
  const entityRows = db.prepare("SELECT type, data_json FROM entities").all();
  for (const row of entityRows) {
    let data = null;
    try {
      data = JSON.parse(row.data_json || "{}");
    } catch {
      data = null;
    }
    collectNestedUsage(data, row.type, usage);
  }
  const cacheRows = db.prepare("SELECT cache_key FROM enrichment_cache").all();
  for (const row of cacheRows) {
    const key = String(row.cache_key || "");
    if (key.startsWith("source:truepeoplesearch:")) {
      markCacheUsage(usage, "truepeoplesearch");
    } else if (key.startsWith("source:thatsthem:")) {
      markCacheUsage(usage, "thatsthem");
    } else if (key.startsWith("census-geocode:")) {
      markCacheUsage(usage, "census_geocoder");
    } else if (key.startsWith("overpass-nearby:")) {
      markCacheUsage(usage, "openstreetmap_overpass");
    } else if (key.startsWith("assessor-record:")) {
      markCacheUsage(usage, "assessor_records");
    }
  }
  return finalizeUsage(usage);
}

/**
 * @param {Record<string, { entityRefs?: number; cacheRefs?: number; entityTypes?: string[] }>} observedUsage
 * @returns {object}
 */
export function buildSourceAuditSnapshot(observedUsage = {}) {
  const sources = SOURCE_DEFINITIONS.map((source) => {
    const observed = observedUsage[source.id] || { entityRefs: 0, cacheRefs: 0, entityTypes: [] };
    return {
      ...source,
      observed,
      implemented: source.status === "active",
      expansionReady: source.status === "planned",
    };
  });
  const active = sources.filter((source) => source.status === "active");
  const planned = sources.filter((source) => source.status === "planned");
  const activeFamilies = Array.from(new Set(active.map((source) => source.category))).sort();
  const highestOverlap = OVERLAP_GROUPS.map((group) => ({
    ...group,
    activeSources: group.sources.filter((sourceId) => {
      const hit = sources.find((source) => source.id === sourceId);
      return hit && hit.status === "active";
    }),
  }));
  return {
    generatedAt: new Date().toISOString(),
    summary: {
      activeSourceCount: active.length,
      plannedSourceCount: planned.length,
      activeFamilies,
      highestPriorityExpansion: ROADMAP.filter((item) => item.priority === "now"),
      browserAutomationRecommendation:
        "Use Playwright as the primary browser-automation layer for future JS-heavy zero-API sources; reserve Selenium for browser-compatibility/grid cases and Puppeteer for lightweight CDP-centric tooling.",
    },
    sources,
    overlaps: highestOverlap,
    silos: SILO_FINDINGS,
    roadmap: ROADMAP,
  };
}

/**
 * @returns {object}
 */
export function getSourceAuditSnapshot() {
  const observedUsage = getObservedSourceUsage();
  return buildSourceAuditSnapshot(observedUsage);
}
