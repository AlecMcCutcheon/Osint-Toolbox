/**
 * USPhoneBook lookup UI — client queue, structured display.
 * Icons: inline SVG only (no emoji).
 */

const SITE_BASE = "https://www.usphonebook.com";
/** Match server default /api maxTimeout; client aborts slightly later than Flare budget */
const FLARE_MAX_TIMEOUT_MS = 240000;
const LOOKUP_MAX_MS = 260000;
/** Failed / timeout jobs re-queue this many times before staying terminal */
const MAX_AUTO_RETRIES = 4;
const LS_KEY = "usphonebook_queue_v2";
const LS_MIGRATE_KEY = "usphonebook_queue_v1";
let saveTimer = 0;

const icons = {
  search:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>',
  person:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>',
  people:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>',
  link: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/></svg>',
  queue: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 14h4v-2H3v2zm0 5h4v-2H3v2zm0-10h4V7H3v2zm5 0h10V7H8v2zm0 5h10v-2H8v2zm0 5h10v-2H8v2z"/></svg>',
  list: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h2v2H4V6zm0 5h2v2H4v-2zm0 5h2v2H4v-2zM6 4v2H4V4h2zM4 10h2v2H4v-2zm0 4h2v2H4v-2zm2-5v2H4V9h2zm0 4v2H4v-2zm16 5H8v-2h12v2zm0-5H8v-2h12v2zm0-5H8V7h12v2z"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>',
  error: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>',
  phone:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/></svg>',
  clock:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/></svg>',
  bolt: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 2v11h3v9l7-12h-4l4-8z"/></svg>',
  view:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>',
};

let jobCounter = 0;
/** @type {Array<{
 *   id: string;
 *   phone: string;
 *   dashed?: string;
 *   status: 'pending' | 'running' | 'ok' | 'error' | 'timeout';
 *   result?: object;
 *   error?: string;
 *   startedAt?: number;
 *   finishedAt?: number;
 *   kind?: 'phone' | 'enrich' | 'name';
 *   parentId?: string;
 *   profilePath?: string;
 *   enrichKind?: string;
 *   enrichName?: string;
 *   searchName?: string;
 *   searchCity?: string;
 *   searchState?: string;
 *   searchStateName?: string;
 *   queryKey?: string;
 *   autoRetriesUsed?: number;
 * }>} */
const jobs = [];
let isRunnerIdle = true;
let selectedId = null;
/** @type {ReturnType<typeof setTimeout> | 0} */
let enqueueDebounce = 0;
/**
 * @param {object | undefined} result
 * @param {string | undefined} kind
 * @returns {object | undefined}
 */
function resultForStorage(result, kind) {
  if (!result) {
    return undefined;
  }
  if (kind === "enrich" && result.rawHtml) {
    const { rawHtml: _r, ...rest } = result;
    return { ...rest, rawHtmlOmitted: true, rawHtmlLength: result.rawHtmlLength };
  }
  return result;
}

/**
 * @returns {void}
 */
function saveQueue() {
  try {
    const payload = {
      v: 2,
      jobCounter,
      jobs: jobs.map((j) => ({
        id: j.id,
        phone: j.phone,
        dashed: j.dashed,
        status: j.status,
        result: resultForStorage(j.result, j.kind),
        error: j.error,
        startedAt: j.startedAt,
        finishedAt: j.finishedAt,
        kind: j.kind,
        parentId: j.parentId,
        profilePath: j.profilePath,
        enrichKind: j.enrichKind,
        enrichName: j.enrichName,
        searchName: j.searchName,
        searchCity: j.searchCity,
        searchState: j.searchState,
        searchStateName: j.searchStateName,
        queryKey: j.queryKey,
        autoRetriesUsed: j.autoRetriesUsed,
      })),
      selectedId,
    };
    const s = JSON.stringify(payload);
    if (s.length > 4_500_000) {
      payload.jobs = payload.jobs.slice(-25);
      localStorage.setItem(LS_KEY, JSON.stringify(payload));
    } else {
      localStorage.setItem(LS_KEY, JSON.stringify(payload));
    }
    try {
      localStorage.removeItem(LS_MIGRATE_KEY);
    } catch {
      // ignore
    }
  } catch {
    // quota or private mode
  }
}

/**
 * @returns {void}
 */
function scheduleSave() {
  if (saveTimer) {
    clearTimeout(saveTimer);
  }
  saveTimer = setTimeout(() => {
    saveTimer = 0;
    saveQueue();
  }, 150);
}

/**
 * Before reload/navigation, never persist "running" or navigational "failed" as a terminal error —
 * the in-flight request may still complete on the server; the next visit should retry and hit cache.
 * @returns {void}
 */
function flushQueueForPageExit() {
  for (const j of jobs) {
    if (j.status === "running") {
      j.status = "pending";
      j.error = undefined;
      j.startedAt = undefined;
    } else if (
      j.status === "error" &&
      j.error &&
      /failed to fetch|networkerror|aborted|load failed|the user aborted|download.*failed|fetch.*abort/i.test(
        String(j.error)
      )
    ) {
      j.status = "pending";
      j.error = undefined;
      j.finishedAt = undefined;
    }
  }
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = 0;
  }
  saveQueue();
}

/**
 * Multiple completed phone jobs for the same number are usually duplicate enqueues; keep
 * the newest and re-point ↳ Enrich children to the kept row.
 * @returns {void}
 */
function dedupeRedundantPhoneJobs() {
  const byDashed = new Map();
  for (const j of jobs) {
    if (j.kind !== "phone" || j.status !== "ok") {
      continue;
    }
    if (!byDashed.has(j.dashed)) {
      byDashed.set(j.dashed, []);
    }
    byDashed.get(j.dashed).push(j);
  }
  for (const list of byDashed.values()) {
    if (list.length <= 1) {
      continue;
    }
    list.sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0));
    const keeper = list[0];
    const removeIds = new Set(
      list
        .slice(1)
        .map((x) => x.id)
        .filter((id) => id !== keeper.id)
    );
    for (const e of jobs) {
      if (e.kind === "enrich" && e.parentId && removeIds.has(e.parentId)) {
        e.parentId = keeper.id;
      }
    }
    if (selectedId && removeIds.has(selectedId)) {
      selectedId = keeper.id;
    }
    for (let i = jobs.length - 1; i >= 0; i--) {
      if (removeIds.has(jobs[i].id) && jobs[i].kind === "phone") {
        jobs.splice(i, 1);
      }
    }
  }
}

function normalizePhoneInput(raw) {
  const d = String(raw).replace(/[^\d]/g, "");
  if (d.length === 10) {
    return {
      dashed: `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`,
      valid: true,
    };
  }
  if (/^\d{3}-\d{3}-\d{4}$/.test(raw.trim())) {
    return { dashed: raw.trim(), valid: true };
  }
  return { dashed: raw.trim(), valid: false };
}

function normalizeSearchText(raw) {
  return String(raw || "").replace(/\s+/g, " ").trim();
}

function slugifySearchText(raw) {
  return normalizeSearchText(raw)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeNameSearchInput(nameInput, cityInput, stateInput, stateNameInput) {
  const name = normalizeSearchText(nameInput);
  if (!name) {
    return { valid: false, error: "Enter a first and last name." };
  }
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length < 2) {
    return { valid: false, error: "Include at least first and last name." };
  }
  const city = normalizeSearchText(cityInput);
  const state = normalizeSearchText(stateInput).toUpperCase();
  const stateName = normalizeSearchText(stateNameInput);
  if (city && !state) {
    return { valid: false, error: "Choose a state when city is provided." };
  }
  return {
    valid: true,
    name,
    city,
    state,
    stateName,
    key: [slugifySearchText(name), state || "", slugifySearchText(city)].join("|"),
  };
}

function absoluteUrl(path) {
  if (!path || !path.startsWith("/")) {
    return SITE_BASE;
  }
  return SITE_BASE + path;
}

function showStub(message) {
  const t = document.createElement("div");
  t.className = "toast";
  t.setAttribute("role", "status");
  t.textContent = message;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 4500);
}

/**
 * @returns {void}
 */
function syncResultRemoveButton() {
  const btn = document.getElementById("result-remove-btn");
  if (!btn) {
    return;
  }
  const j = selectedId && jobs.find((x) => x.id === selectedId);
  if (j && j.status !== "running") {
    btn.removeAttribute("hidden");
  } else {
    btn.setAttribute("hidden", "");
  }
}

/**
 * @param {string} id
 * @returns {{ toRemove: Set<string>; nextJobs: typeof jobs } | null}
 */
function buildRemovalSnapshot(id) {
  if (!jobs.some((j) => j.id === id)) {
    return null;
  }
  const toRemove = new Set([id]);
  for (const j of jobs) {
    if (j.parentId === id) {
      toRemove.add(j.id);
    }
  }
  return {
    toRemove,
    nextJobs: jobs.filter((j) => !toRemove.has(j.id)),
  };
}

/**
 * @param {typeof jobs} nextJobs
 * @param {Set<string>} toRemove
 * @param {Awaited<ReturnType<typeof pushGraphToServer>> & { ok: true }} gsync
 * @returns {void}
 */
function commitRemovalAfterSuccessfulGraphSync(nextJobs, toRemove, gsync) {
  jobs.splice(0, jobs.length, ...nextJobs);
  if (selectedId && toRemove.has(selectedId)) {
    const last = jobs[jobs.length - 1] || null;
    selectedId = last ? last.id : null;
  }
  for (const j of jobs) {
    applyGraphIngestToJobResult(j, gsync.payload);
  }
  saveQueue();
  renderQueue();
  const sel = selectedId && jobs.find((j) => j.id === selectedId);
  void renderResult(sel || null).catch(() => {});
  syncResultRemoveButton();
  runNextJob();
}

/**
 * @param {string} parentId
 * @param {{ path: string; enrichKind: string; enrichName: string }} p
 * @returns {void}
 */
function addEnrichJob(parentId, p) {
  const parent = jobs.find((j) => j.id === parentId);
  if (!parent || parent.kind === "enrich" || parent.status !== "ok") {
    showStub("Enrich needs a completed phone lookup — run the number first.");
    return;
  }
  const path = String(p.path || "").trim();
  if (!path) {
    return;
  }
  if (String(p.enrichKind) === "phone-profile") {
    const taken = findMatchingPhoneProfileEnrichJob(parent, path);
    if (taken && (taken.status === "ok" || taken.status === "pending" || taken.status === "running")) {
      showStub("Profile enrich already queued or completed for this path.");
      return;
    }
  }
  const id = `E-${++jobCounter}`;
  const job = {
    id,
    kind: "enrich",
    parentId,
    phone: parent.dashed,
    dashed: parent.dashed,
    profilePath: path.split("?")[0],
    enrichKind: p.enrichKind,
    enrichName: p.enrichName || path.split("/").filter(Boolean).slice(-1)[0] || "Profile",
    status: "pending",
  };
  const pi = jobs.findIndex((j) => j.id === parentId);
  if (pi < 0) {
    return;
  }
  jobs.splice(pi + 1, 0, job);
  showStub("Enrich queued (same list as phone lookups).");
  renderQueue();
  saveQueue();
  runNextJob();
}

/**
 * Top-level enrich job (e.g. relative profile): not nested under the phone row; still uses `dashed` as lookup context for /api/profile.
 * @param {string} contextDashed
 * @param {{ path: string; enrichKind: string; enrichName: string }} p
 * @returns {void}
 */
function addStandaloneEnrichJob(contextDashed, p) {
  const path = String(p.path || "").trim();
  const dashed = String(contextDashed || "").trim();
  if (!path) {
    return;
  }
  const id = `E-${++jobCounter}`;
  const job = {
    id,
    kind: "enrich",
    phone: dashed,
    dashed: dashed || undefined,
    profilePath: path.split("?")[0],
    enrichKind: p.enrichKind,
    enrichName: p.enrichName || path.split("/").filter(Boolean).slice(-1)[0] || "Profile",
    status: "pending",
  };
  jobs.push(job);
  showStub("Enrich queued.");
  renderQueue();
  saveQueue();
  runNextJob();
}

/**
 * @param {string | undefined} profilePath
 * @returns {string}
 */
function normalizeProfilePathForMatch(profilePath) {
  return String(profilePath || "")
    .split("?")[0]
    .trim()
    .replace(/\/+$/, "");
}

/**
 * Completed enrich job whose scraped profile matches any normalized path for this relative (or subject profile).
 * @param {string | undefined} path
 * @param {string[] | undefined} alternateProfilePaths
 * @returns {(typeof jobs)[number] | null}
 */
function finishedEnrichJobMatchingPaths(path, alternateProfilePaths) {
  const keys = relativePathKeys({ path, alternateProfilePaths }).map((k) => normalizeProfilePathForMatch(k)).filter(Boolean);
  const keySet = new Set(keys);
  if (!keySet.size) {
    return null;
  }
  /** @type {(typeof jobs)[number] | null} */
  let found = null;
  for (const j of jobs) {
    if (j.kind !== "enrich" || j.status !== "ok" || !j.result?.profile) {
      continue;
    }
    const jp = normalizeProfilePathForMatch(j.profilePath);
    if (jp && keySet.has(jp)) {
      found = j;
    }
  }
  return found;
}

/**
 * @param {{ id: string; dashed: string }} phoneJob
 * @param {string | undefined} profilePath
 * @returns {(typeof jobs)[number] | null}
 */
function findMatchingPhoneProfileEnrichJob(phoneJob, profilePath) {
  const want = normalizeProfilePathForMatch(profilePath);
  if (!want) {
    return null;
  }
  const found =
    jobs.find(
      (j) =>
        j.kind === "enrich" &&
        j.parentId === phoneJob.id &&
        j.enrichKind === "phone-profile" &&
        normalizeProfilePathForMatch(j.profilePath) === want
    ) || null;
  return found;
}

/**
 * Disable the subject "Enrich profile" control while queued, running, or successfully completed.
 * @param {{ id: string; dashed: string }} phoneJob
 * @param {string | undefined} profilePath
 * @returns {boolean}
 */
function phoneProfileEnrichButtonDisabled(phoneJob, profilePath) {
  const j = findMatchingPhoneProfileEnrichJob(phoneJob, profilePath);
  return Boolean(j && (j.status === "ok" || j.status === "pending" || j.status === "running"));
}

/**
 * Completed enrich — use stronger muted styling until the user removes that job.
 * @param {{ id: string; dashed: string }} phoneJob
 * @param {string | undefined} profilePath
 * @returns {boolean}
 */
function phoneProfileEnrichCompletedLock(phoneJob, profilePath) {
  const j = findMatchingPhoneProfileEnrichJob(phoneJob, profilePath);
  return Boolean(j && j.status === "ok");
}

/**
 * @returns {string | null}
 */
function dashedFromSelectedPhoneOkJob() {
  const j = selectedId && jobs.find((x) => x.id === selectedId);
  if (j && j.kind === "phone" && j.status === "ok") {
    return j.dashed;
  }
  return null;
}

/**
 * @param {string} jobId
 * @returns {void}
 */
function retryJob(jobId) {
  const j = jobs.find((x) => x.id === jobId);
  if (!j || (j.status !== "error" && j.status !== "timeout")) {
    return;
  }
  if (j.kind === "enrich") {
    if (j.parentId) {
      const parent = jobs.find((p) => p.id === j.parentId);
      if (!parent || parent.status !== "ok") {
        showStub("Run or retry the parent line lookup first.");
        return;
      }
    }
  }
  j.status = "pending";
  j.error = undefined;
  j.result = undefined;
  j.finishedAt = undefined;
  j.startedAt = undefined;
  j.autoRetriesUsed = 0;
  selectedId = j.id;
  saveQueue();
  renderQueue();
  void renderResult(j).catch(() => {});
  runNextJob();
}

/**
 * @param {{ status?: string; error?: string }} job
 * @returns {boolean}
 */
function jobIsEligibleForAutoRetry(job) {
  if (job.status !== "error" && job.status !== "timeout") {
    return false;
  }
  if (String(job.error || "") === "Parent phone lookup is missing or not complete.") {
    return false;
  }
  return true;
}

/**
 * @param {string} jobId
 * @returns {Promise<void>}
 */
async function performRemoveJob(jobId) {
  const job = jobs.find((j) => j.id === jobId);
  if (!job) {
    return;
  }
  if (job.status === "running") {
    showStub("This job is still running; wait for it to finish, then you can remove it.");
    return;
  }
  const snap = buildRemovalSnapshot(jobId);
  if (!snap) {
    return;
  }
  const { toRemove, nextJobs } = snap;
  const shouldPurgeCache = Boolean(job.dashed) && !nextJobs.some((j) => j.dashed === job.dashed);
  if (shouldPurgeCache) {
    try {
      const res = await fetch("/api/lookups/purge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: job.dashed, removeCache: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        showStub(`Server: ${data.error || "could not clear cache"}`);
        return;
      }
    } catch (e) {
      showStub(`Server request failed: ${(e && e.message) || String(e)}`);
      return;
    }
  }
  const gsync = await pushGraphToServer(nextJobs);
  if (!gsync.ok) {
    showStub(`Graph did not sync: ${gsync.error}. The job was not removed.`);
    return;
  }
  commitRemovalAfterSuccessfulGraphSync(nextJobs, toRemove, gsync);
}

function badgeForStatus(job) {
  let core;
  if (job.status === "pending") {
    core = `<span class="badge badge--pending">Pending</span>`;
  } else if (job.status === "running") {
    core = `<span class="badge badge--running"><span class="icon spin">${icons.clock}</span>Running</span>`;
  } else if (job.status === "ok") {
    const c = job.kind !== "enrich" && job.result?.cached
      ? ' <span class="badge badge--cached">Cache</span>'
      : "";
    core = `<span class="badge badge--ok"><span class="icon">${icons.check}</span>Done</span>${c}`;
  } else if (job.status === "timeout") {
    core = `<span class="badge badge--timeout">Timeout</span>`;
  } else {
    core = `<span class="badge badge--error"><span class="icon">${icons.error}</span>Failed</span>`;
  }
  return core;
}

/**
 * @param {{ id: string; status: string }} j
 * @returns {string}
 */
function retryButtonHtml(j) {
  if (j.status !== "error" && j.status !== "timeout") {
    return "";
  }
  return `<button type="button" class="queue-item__retry" data-retry="${j.id}" aria-label="Retry job">Retry</button>`;
}

function nameJobSubtitle(job) {
  const bits = [];
  if (job.searchCity) {
    bits.push(job.searchCity);
  }
  if (job.searchState) {
    bits.push(job.searchState);
  }
  return bits.join(", ") || "All locations";
}

/**
 * Groups multiple enrich queue rows for the same person (same normalized name label).
 * @param {(typeof jobs)[number]} j
 * @returns {string}
 */
function enrichPersonNestKey(j) {
  if (j.kind !== "enrich") {
    return "";
  }
  const dn = j.result?.profile?.displayName;
  if (typeof dn === "string" && dn.trim()) {
    return relativeNameKey(dn.trim());
  }
  const en = j.enrichName && String(j.enrichName).trim();
  if (en) {
    return relativeNameKey(en);
  }
  return `__id:${j.id}`;
}

/**
 * Second and later enrich jobs for the same {@link enrichPersonNestKey} render nested under the first.
 * @param {typeof jobs} enrichJobs
 * @returns {Array<{ job: (typeof jobs)[number]; nested: boolean }>}
 */
function nestEnrichJobsOrdered(enrichJobs) {
  const seen = new Set();
  /** @type {Array<{ job: (typeof jobs)[number]; nested: boolean }>} */
  const out = [];
  for (const job of enrichJobs) {
    const k = enrichPersonNestKey(job);
    const nested = seen.has(k);
    seen.add(k);
    out.push({ job, nested });
  }
  return out;
}

/**
 * @param {(typeof jobs)[number]} j
 * @param {boolean} [nestedPeople] nested row under another People job (same person, another profile link)
 * @returns {string}
 */
function queueJobRowHtml(j, nestedPeople = false) {
  const nested = Boolean(nestedPeople && j.kind === "enrich");
  const u = j.autoRetriesUsed || 0;
  const autoRetryTitle =
    j.status === "pending" && u > 0
      ? ` title="Auto-retry ${u} of ${MAX_AUTO_RETRIES}"`
      : "";
  return `
    <li class="queue-item${j.kind === "enrich" ? " queue-item--enrich" : ""}${nested ? " queue-item--nested" : ""}${
      selectedId === j.id ? " queue-item--active" : ""
    }"${autoRetryTitle} data-id="${j.id}">
      <span class="queue-item__phone">${
        j.kind === "enrich"
          ? `${nested ? '<span class="queue-item__enrich-glyph" aria-hidden="true">↳</span>' : ""}<span class="queue-item__phone-stack"><span class="queue-item__main">${escapeHtml(enrichQueueTitle(j))}</span><span class="queue-item__sub mono">${escapeHtml(enrichJobSubtitle(j) || j.profilePath || "")}</span></span>`
          : j.kind === "name"
            ? `<span class="queue-item__phone-stack"><span class="queue-item__main">${escapeHtml(j.searchName || "Name search")}</span><span class="queue-item__sub">${escapeHtml(nameJobSubtitle(j))}</span></span>`
            : escapeHtml(j.dashed || "")
      }</span>
      <span class="queue-item__meta">${badgeForStatus(j)}${retryButtonHtml(j)}</span>
      <button type="button" class="queue-item__dismiss" data-dismiss="${j.id}" ${
        j.status === "running" ? "disabled" : ""
      } aria-label="Remove job" title="Remove">×</button>
    </li>`;
}

function renderQueue() {
  const list = document.getElementById("queue-list");
  if (!list) {
    return;
  }
  if (jobs.length === 0) {
    list.innerHTML = `<li class="muted" style="padding:1rem; font-size:0.85rem;">No jobs. Add a lookup above.</li>`;
    syncResultRemoveButton();
    return;
  }
  const phoneJobs = jobs.filter((j) => j.kind === "phone");
  const nameJobs = jobs.filter((j) => j.kind === "name");
  const enrichJobs = jobs.filter((j) => j.kind === "enrich");
  const sections = [];
  if (phoneJobs.length) {
    sections.push(`<li class="queue-group">
      <div class="queue-group__label"><span class="queue-group__icon">${icons.phone}</span> Lines</div>
      <ul class="queue-group__items">${phoneJobs.map(queueJobRowHtml).join("")}</ul>
    </li>`);
  }
  if (nameJobs.length) {
    sections.push(`<li class="queue-group">
      <div class="queue-group__label"><span class="queue-group__icon">${icons.search}</span> Names</div>
      <ul class="queue-group__items">${nameJobs.map(queueJobRowHtml).join("")}</ul>
    </li>`);
  }
  if (enrichJobs.length) {
    const peopleRows = nestEnrichJobsOrdered(enrichJobs)
      .map(({ job: ej, nested }) => queueJobRowHtml(ej, nested))
      .join("");
    sections.push(`<li class="queue-group queue-group--people">
      <div class="queue-group__label"><span class="queue-group__icon">${icons.person}</span> People</div>
      <ul class="queue-group__items">${peopleRows}</ul>
    </li>`);
  }
  list.innerHTML = sections.join("");
  list.querySelectorAll(".queue-item__retry").forEach((b) => {
    b.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const jid = b.getAttribute("data-retry");
      if (jid) {
        retryJob(jid);
      }
    });
  });
  list.querySelectorAll(".queue-item__dismiss").forEach((b) => {
    b.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const jid = b.getAttribute("data-dismiss");
      if (jid) {
        void performRemoveJob(jid);
      }
    });
  });
  list.querySelectorAll(".queue-item").forEach((row) => {
    row.addEventListener("click", () => {
      const id = row.getAttribute("data-id");
      const job = jobs.find((x) => x.id === id);
      if (!job) {
        return;
      }
      selectedId = id;
      void renderResult(job).catch(() => {});
      renderQueue();
      scheduleSave();
    });
  });
  scheduleSave();
  syncResultRemoveButton();
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * @param {string | undefined | null} type
 * @returns {string}
 */
function formatPhoneTypeLabel(type) {
  return String(type || "")
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

/**
 * @param {object | undefined | null} meta
 * @returns {string}
 */
function phoneMetadataSummaryHtml(meta) {
  if (!meta || typeof meta !== "object") {
    return "";
  }
  const parts = [];
  if (meta.e164) {
    parts.push(`<span class="mono">${escapeHtml(String(meta.e164))}</span>`);
  }
  if (meta.type) {
    parts.push(escapeHtml(formatPhoneTypeLabel(meta.type)));
  }
  if (meta.country) {
    parts.push(escapeHtml(String(meta.country)));
  }
  if (meta.isValid === true) {
    parts.push("Valid");
  } else if (meta.isPossible === true) {
    parts.push("Possible");
  } else if (meta.isValid === false) {
    parts.push("Unverified");
  }
  if (!parts.length) {
    return "";
  }
  return `<span class="muted" style="font-size:0.78rem">${parts.join(" · ")}</span>`;
}

/**
 * @param {object | undefined | null} addr
 * @returns {string}
 */
function addressEnrichmentSummaryHtml(addr) {
  if (!addr || typeof addr !== "object") {
    return "";
  }
  const bits = [];
  const geo = addr.censusGeocode;
  if (geo?.coordinates) {
    const county = geo?.censusGeography?.county?.name;
    const tract = geo?.censusGeography?.tract?.name;
    const loc = `${geo.coordinates.lat}, ${geo.coordinates.lon}`;
    bits.push(`Census geocode <span class="mono">${escapeHtml(loc)}</span>`);
    if (county) {
      bits.push(escapeHtml(String(county)));
    }
    if (tract) {
      bits.push(`Tract ${escapeHtml(String(tract))}`);
    }
  }
  if (addr.nearbyPlaces?.places?.length) {
    const places = addr.nearbyPlaces.places
      .slice(0, 3)
      .map((p) => `${escapeHtml(String(p.name || "Place"))} (${escapeHtml(String(p.distanceMeters || "?"))}m)`)
      .join(", ");
    bits.push(`Nearby: ${places}`);
  }
  if (Array.isArray(addr.assessorRecords) && addr.assessorRecords.length) {
    const record = addr.assessorRecords.find((x) => x && x.status === "ok") || addr.assessorRecords[0];
    if (record) {
      const owner = Array.isArray(record.ownerNames) && record.ownerNames.length ? record.ownerNames[0] : null;
      const parts = [];
      if (record.name) {
        parts.push(escapeHtml(String(record.name)));
      }
      if (owner) {
        parts.push(`Owner: ${escapeHtml(String(owner))}`);
      }
      if (record.parcelId) {
        parts.push(`Parcel: <span class="mono">${escapeHtml(String(record.parcelId))}</span>`);
      }
      if (record.assessedValue) {
        parts.push(`Assessed: ${escapeHtml(String(record.assessedValue))}`);
      }
      if (!owner && !record.parcelId && !record.assessedValue && Array.isArray(record.resourceLinks) && record.resourceLinks.length) {
        parts.push(`Directory resources: ${escapeHtml(String(record.resourceLinks.length))}`);
      }
      if (parts.length) {
        bits.push(`Assessor: ${parts.join(" · ")}`);
      }
    }
  }
  if (!bits.length) {
    return "";
  }
  return `<div class="muted" style="font-size:0.78rem; margin-top:0.2rem">${bits.join(" · ")}</div>`;
}

/**
 * @param {object | undefined | null} externalSources
 * @returns {string}
 */
function externalSourceSummaryHtml(externalSources) {
  if (!externalSources || typeof externalSources !== "object") {
    return "";
  }
  const telecom = externalSources.telecom;
  const peopleFinders = Array.isArray(externalSources.peopleFinders) ? externalSources.peopleFinders : [];
  const merged = externalSources.mergedFacts || {};
  const telecomParts = [];
  if (telecom?.nanp?.areaCode) {
    telecomParts.push(`Area code ${escapeHtml(String(telecom.nanp.areaCode))}`);
  }
  if (telecom?.nanp?.categoryLabel) {
    telecomParts.push(escapeHtml(String(telecom.nanp.categoryLabel)));
  }
  const sourceList = peopleFinders
    .map((src) => `${escapeHtml(String(src.source || "source"))}: ${escapeHtml(String(src.status || "unknown"))}`)
    .join(" · ");
  const mergedLines = [];
  const pushMerged = (label, arr) => {
    if (!Array.isArray(arr) || !arr.length) {
      return;
    }
    const shown = arr
      .slice(0, 4)
      .map((item) => `${escapeHtml(String(item.label || item.key || ""))} <span class="muted">[${escapeHtml((item.sources || []).join(", "))}]</span>`)
      .join(", ");
    mergedLines.push(`<li><strong>${label}:</strong> ${shown}</li>`);
  };
  pushMerged("Names", merged.names);
  pushMerged("Addresses", merged.addresses);
  pushMerged("Phones", merged.phones);
  pushMerged("Relatives", merged.relatives);
  if (!telecomParts.length && !sourceList && !mergedLines.length) {
    return "";
  }
  return `<div class="result-stack-section">
    <div class="card">
      <div class="card__head"><span class="icon">${icons.list}</span> External sources</div>
      <div class="card__body">
        ${telecomParts.length ? `<p class="muted" style="font-size:0.82rem; margin:0 0 0.5rem">Telecom: ${telecomParts.join(" · ")}</p>` : ""}
        ${sourceList ? `<p class="muted" style="font-size:0.82rem; margin:0 0 0.5rem">People finders: ${sourceList}</p>` : ""}
        ${mergedLines.length ? `<ul style="margin:0.2rem 0 0; padding-left:1.1rem; font-size:0.84rem">${mergedLines.join("")}</ul>` : `<p class="muted" style="font-size:0.82rem; margin:0">No corroborated external facts yet.</p>`}
      </div>
    </div>
  </div>`;
}

/**
 * @param {object} obj
 * @returns {string}
 */
function safeJsonStringify(obj) {
  try {
    return JSON.stringify(obj, null, 2);
  } catch (e) {
    const msg = e && e.message != null ? e.message : String(e);
    return `{\n  "stringifyError": ${JSON.stringify(msg)}\n}`;
  }
}

/**
 * Collapsible full API payload (includes fields not yet shown in the structured UI).
 * @param {string} summaryLabel
 * @param {object} obj
 * @returns {string}
 */
function rawApiJsonPanelHtml(summaryLabel, obj) {
  return `<div class="result-stack-section">
    <details class="raw-json-details">
      <summary class="raw-json-summary">${escapeHtml(summaryLabel)}</summary>
      <pre class="raw-json-pre">${escapeHtml(safeJsonStringify(obj))}</pre>
    </details>
  </div>`;
}

/**
 * Same normalization as `personKeyFromNameOnly` (server) for grouping.
 * @param {string} name
 * @returns {string}
 */
function relativeNameKey(name) {
  const t = String(name || "")
    .toLowerCase()
    .replace(/[.,#]/g, " ")
    .replace(/[^a-z0-9\u00C0-\u024F\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t || "unknown";
}

/**
 * Short tail of a profile path for disambiguation next to Enrich when one name maps to several URLs.
 * @param {string} path
 * @returns {string}
 */
function pathDisplayHint(path) {
  const p = String(path).split("#")[0].replace(/\/+$/, "");
  const parts = p.split("/").filter(Boolean);
  const last = parts[parts.length - 1] || p;
  return last.length > 40 ? `${last.slice(0, 38)}…` : last;
}

/**
 * @param {{ name: string; path: string; alternateProfilePaths?: string[] }} x
 * @param {string} ctxAttr
 * @param {{ id?: string }} viewingJob
 * @returns {string}
 */
function relatedProfileQueueActionHtml(x, contextDashed, viewingJob) {
  const ctx = String(contextDashed || "").trim();
  const ctxAttr = ctx ? ` data-context-phone="${escapeHtml(ctx)}"` : "";
  const done = finishedEnrichJobMatchingPaths(x.path, x.alternateProfilePaths);
  const hint = pathDisplayHint(x.path);
  if (done && viewingJob && viewingJob.id === done.id) {
    return `<span class="muted" style="font-size:0.78rem">This record</span>`;
  }
  if (done) {
    return `<button type="button" class="btn btn--sm btn--ghost show-enrich-job-btn" data-show-job="${escapeHtml(
      done.id
    )}" title="Open scraped profile in queue">
      <span class="icon">${icons.view}</span> Show
      <span class="muted" style="font-size:0.78rem; font-weight:400; margin-left:0.25rem">· ${escapeHtml(hint)}</span>
    </button>`;
  }
  return `<button type="button" class="btn btn--sm btn--ghost enrich-btn" data-kind="related-profile" data-path="${escapeHtml(
    x.path
  )}" data-name="${escapeHtml(x.name)}"${ctxAttr} title="${escapeHtml(x.path)}">
    <span class="icon">${icons.bolt}</span> Enrich
    <span class="muted" style="font-size:0.78rem; font-weight:400; margin-left:0.25rem">· ${escapeHtml(hint)}</span>
  </button>`;
}

/**
 * @param {string | undefined} path
 * @returns {string}
 */
function normalizedProfilePath(path) {
  return String(path || "").split("?")[0].trim().replace(/\/+$/, "");
}

/**
 * @param {{ path?: string; alternateProfilePaths?: string[] }} rel
 * @returns {string[]}
 */
function relativePathKeys(rel) {
  const raw = [rel?.path, ...(Array.isArray(rel?.alternateProfilePaths) ? rel.alternateProfilePaths : [])];
  const keys = [];
  const seen = new Set();
  for (const x of raw) {
    const n = normalizedProfilePath(x);
    if (n && !seen.has(n)) {
      seen.add(n);
      keys.push(n);
    }
  }
  return keys;
}

/**
 * @param {{ profilePath?: string }} j
 * @returns {string}
 */
function enrichJobSubtitle(j) {
  if (j.profilePath != null && String(j.profilePath).trim()) {
    return pathDisplayHint(String(j.profilePath));
  }
  return "";
}

/**
 * Queue row title: parsed profile name when present, else stored enrich label.
 * @param {{ kind?: string; enrichName?: string; result?: { profile?: { displayName?: string } } }} j
 * @returns {string}
 */
function enrichQueueTitle(j) {
  if (j.kind !== "enrich") {
    return "";
  }
  const dn = j.result?.profile?.displayName;
  if (typeof dn === "string" && dn.trim()) {
    return dn.trim();
  }
  const n = j.enrichName && String(j.enrichName).trim();
  return n || "Profile";
}

/**
 * One row per display name; multiple profile URLs under the same name are stacked in Profile / Enrich.
 * @param {Array<{ name: string; path: string }>} relatives
 * @returns {Array<{ displayName: string; items: { name: string; path: string }[] }>}
 */
function groupRelativesByName(relatives) {
  /** @type {Map<string, { items: { name: string; path: string }[] }>} */
  const m = new Map();
  for (const x of relatives) {
    if (!x || !x.name || !x.path) {
      continue;
    }
    const name = String(x.name).trim();
    const path = String(x.path).split("#")[0];
    if (!name || !path) {
      continue;
    }
    const k = relativeNameKey(name);
    let g = m.get(k);
    if (!g) {
      g = { items: [] };
      m.set(k, g);
    }
    if (!g.items.some((it) => it.path === path)) {
      g.items.push({
        name,
        path,
        ...(Array.isArray(x.alternateProfilePaths) ? { alternateProfilePaths: x.alternateProfilePaths } : {}),
      });
    }
  }
  return Array.from(m.values()).map((g) => {
    let displayName = g.items[0].name;
    for (const it of g.items) {
      if (String(it.name).length > displayName.length) {
        displayName = it.name;
      }
    }
    return { displayName, items: g.items };
  });
}

/**
 * @param {Array<{ name: string; path: string; alternateProfilePaths?: string[] }>} rel
 * @param {string} contextDashed line used as Flare context for related-profile enrich
 * @param {{ id?: string }} viewingJob
 * @returns {string}
 */
function buildRelatedPersonTableRows(rel, contextDashed, viewingJob) {
  const groups = groupRelativesByName(rel);
  return groups
    .map((g) => {
      if (g.items.length === 1) {
        const x = g.items[0];
        return `<tr>
              <td class="mono">${escapeHtml(x.name)}</td>
              <td><a href="${escapeHtml(absoluteUrl(x.path))}" target="_blank" rel="noopener noreferrer">View <span class="icon" style="width:0.85em; display:inline-block; vertical-align:-2px">${icons.link}</span></a></td>
              <td>${relatedProfileQueueActionHtml(x, contextDashed, viewingJob)}</td>
            </tr>`;
      }
      const nameCell = escapeHtml(g.displayName);
      const prof = g.items
        .map(
          (x) => `<div>
              <a href="${escapeHtml(absoluteUrl(x.path))}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(x.path)}">View <span class="icon" style="width:0.85em; display:inline-block; vertical-align:-2px">${icons.link}</span></a>
            </div>`
        )
        .join("");
      const enr = g.items
        .map((x) => `<div>${relatedProfileQueueActionHtml(x, contextDashed, viewingJob)}</div>`)
        .join("");
      return `<tr>
              <td class="mono">${nameCell}</td>
              <td><div style="display:flex; flex-direction:column; gap:0.4rem">${prof}</div></td>
              <td><div style="display:flex; flex-direction:column; gap:0.4rem; align-items:flex-start">${enr}</div></td>
            </tr>`;
    })
    .join("");
}

/**
 * Drives `POST /api/graph/rebuild` from the in-memory queue. Kept in sync with
 * `buildItemsFromLocalStorage` in /graph.js (same job→items rules).
 * @param {typeof jobs} jobList
 * @returns {Array<
 *   | { kind: "phone"; dashed: string; parsed: object; runId: string }
 *   | { kind: "enrich"; contextPhone: string; profile: object; runId: string }
 * >}
 */
function buildGraphSyncItems(jobList) {
  const items = [];
  for (const j of jobList) {
    if (j.status === "ok" && j.result?.normalized?.meta?.graphEligible === true) {
      items.push({
        normalized: j.result.normalized,
        runId: j.id,
      });
      continue;
    }
    if (j.kind === "enrich" && j.status === "ok" && j.result && j.result.profile) {
      const prof = { ...j.result.profile };
      if (j.profilePath != null && String(j.profilePath).trim()) {
        const req = String(j.profilePath).split("?")[0].trim().replace(/\/+$/, "");
        if (req.startsWith("/")) {
          prof.profilePath = req;
        }
      }
      items.push({
        kind: "enrich",
        contextPhone: j.dashed,
        profile: prof,
        runId: j.id,
      });
    } else if (j.kind === "phone" && j.status === "ok" && j.result && j.result.parsed) {
      items.push({ kind: "phone", dashed: j.dashed, parsed: j.result.parsed, runId: j.id });
    }
  }
  return items;
}

const GRAPH_SYNC_RETRIES = 2;
const GRAPH_SYNC_RETRY_MS = 500;

/**
 * @param {typeof jobs} jobList
 * @returns {Promise<
 *   | { ok: true; payload: { ok: true; itemResults: { runId: string; kind: string; graphIngest: object }[] } }
 *   | { ok: false; error: string }
 * >}
 */
async function pushGraphToServer(jobList) {
  let body;
  try {
    body = JSON.stringify({ items: buildGraphSyncItems(jobList) });
  } catch (e) {
    const msg = e && e.message != null ? e.message : String(e);
    return { ok: false, error: `Could not build sync payload (${msg}).` };
  }
  for (let attempt = 0; attempt < GRAPH_SYNC_RETRIES; attempt += 1) {
    if (attempt > 0) {
      await new Promise((r) => {
        setTimeout(r, GRAPH_SYNC_RETRY_MS);
      });
    }
    let res;
    try {
      res = await fetch("/api/graph/rebuild", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
    } catch (e) {
      const err = e && e.message != null ? e.message : String(e);
      if (attempt < GRAPH_SYNC_RETRIES - 1) {
        continue;
      }
      return { ok: false, error: `Network: ${err}` };
    }
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      if (res.ok) {
        return { ok: false, error: "Server returned invalid JSON for graph rebuild." };
      }
    }
    if (!res.ok) {
      const errMsg = (data && (data.error || data.message)) || res.statusText || `HTTP ${res.status}`;
      if (res.status === 413) {
        return { ok: false, error: "Request too large (8 MB limit on server). Remove some jobs or clear heavy enrich/raw captures." };
      }
      const retryable = res.status === 429 || (res.status >= 500 && res.status < 600);
      if (retryable && attempt < GRAPH_SYNC_RETRIES - 1) {
        continue;
      }
      return { ok: false, error: String(errMsg) };
    }
    if (data && data.ok === true && Array.isArray(data.itemResults)) {
      return { ok: true, payload: data };
    }
    if (data && Array.isArray(data.itemResults) && !data.error) {
      return { ok: true, payload: { ok: true, itemResults: data.itemResults } };
    }
    if (data && data.ok === false) {
      return { ok: false, error: String(data.error || "graph rebuild refused") };
    }
    if (attempt < GRAPH_SYNC_RETRIES - 1) {
      continue;
    }
    return { ok: false, error: "Unexpected response from /api/graph/rebuild." };
  }
  return { ok: false, error: "Graph sync did not complete." };
}

/**
 * @param {object} job
 * @param {{ ok?: boolean; itemResults?: { runId: string; graphIngest: object }[] } | null} sync
 * @returns {void}
 */
function applyGraphIngestToJobResult(job, sync) {
  if (!job || job.status !== "ok" || !job.result || !sync || !sync.ok || !Array.isArray(sync.itemResults)) {
    return;
  }
  const st = sync.itemResults.find((s) => s && s.runId === job.id);
  if (st && st.graphIngest) {
    job.result = { ...job.result, graphIngest: st.graphIngest };
  }
}

/**
 * @param {string} name
 * @returns {string}
 */
function displayNameToUrlSlug(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * @param {string} path
 * @returns {string}
 */
function profilePathNameSegment(path) {
  const t = String(path).split("?")[0].replace(/^\//, "");
  return (t.split("/")[0] || "").toLowerCase();
}

/**
 * @param {string} displayName
 * @param {string} profilePath
 * @returns {string} HTML or ""
 */
function profilePathSlugMismatchNoteHtml(displayName, profilePath) {
  const a = displayNameToUrlSlug(displayName);
  const b = profilePathNameSegment(profilePath);
  if (!a || !b || a === b) {
    return "";
  }
  return `<p class="muted" style="font-size:0.78rem;margin:0.5rem 0 0">The profile URL uses a different name segment than the page heading. The <strong>name</strong> above is taken from the on-page title (USPhonebook often shares one URL across household or related people).</p>`;
}

/**
 * Canonical dashed line key for matching across enrich results.
 * @param {string | undefined} raw
 * @returns {string}
 */
function phoneLineKeyForFilter(raw) {
  const s = String(raw || "").trim();
  if (!s) {
    return "";
  }
  const n = normalizePhoneInput(s);
  if (n.valid) {
    return n.dashed;
  }
  const digits = s.replace(/\D/g, "");
  if (digits.length === 10) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return digits || s;
}

/**
 * Stable id for “who holds this enrich profile” when deduping current holders.
 * @param {{ id?: string; profilePath?: string }} job
 * @returns {string}
 */
function enrichJobProfileOwnerKey(job) {
  const path =
    job.profilePath != null && String(job.profilePath).trim()
      ? normalizeProfilePathForMatch(job.profilePath)
      : "";
  return path || job.id || "";
}

/**
 * Maps each phone line → set of profile-owner keys that mark this line current on a completed enrich.
 * @returns {Map<string, Set<string>>}
 */
function buildExclusiveCurrentPhoneContext() {
  /** @type {Map<string, Set<string>>} */
  const byLine = new Map();
  for (const j of jobs) {
    if (j.kind !== "enrich" || j.status !== "ok" || !j.result?.profile?.phones) {
      continue;
    }
    const owner = enrichJobProfileOwnerKey(j);
    if (!owner) {
      continue;
    }
    for (const p of j.result.profile.phones) {
      if (!p || !p.isCurrent) {
        continue;
      }
      const key = phoneLineKeyForFilter(p.dashed || p.display);
      if (!key) {
        continue;
      }
      if (!byLine.has(key)) {
        byLine.set(key, new Set());
      }
      byLine.get(key).add(owner);
    }
  }
  return byLine;
}

/**
 * Drop non-current rows when exactly one profile marks that line as current (two+ current holders → keep all).
 * @param {Array<{ dashed?: string; display?: string; isCurrent?: boolean; lineType?: string }>} phones
 * @param {Map<string, Set<string>>} currentHoldersByLine
 * @returns {typeof phones}
 */
function filterPhonesWhenSingleCurrentHolder(phones, currentHoldersByLine) {
  return phones.filter((p) => {
    if (p.isCurrent) {
      return true;
    }
    const lineKey = phoneLineKeyForFilter(p.dashed || p.display);
    if (!lineKey) {
      return true;
    }
    const holders = currentHoldersByLine.get(lineKey);
    if (!holders || holders.size !== 1) {
      return true;
    }
    return false;
  });
}

/**
 * @param {object} job
 * @returns {string}
 */
function formatEnrichResultHtml(job) {
  const r = job.result;
  if (!r) {
    return `<div class="empty-state">No response payload. Try running enrich again.</div>`;
  }
  const pr = r.profile || {};
  const addrs = pr.addresses || [];
  const phonesRaw = pr.phones || [];
  const currentPhoneContext = buildExclusiveCurrentPhoneContext();
  const phones = filterPhonesWhenSingleCurrentHolder(phonesRaw, currentPhoneContext);
  const rels = pr.relatives || [];
  const emails = pr.emails || [];
  const aliases = pr.aliases || [];
  const workplaces = Array.isArray(pr.workplaces) ? pr.workplaces : [];
  const education = Array.isArray(pr.education) ? pr.education : [];
  const marital = Array.isArray(pr.marital) ? pr.marital : [];
  const ctxAttrMarital = String(job.dashed || "").trim()
    ? ` data-context-phone="${escapeHtml(String(job.dashed))}"`
    : "";
  const workplaceList = workplaces
    .map(
      (w) =>
        `<li style="margin-bottom:0.45rem">${w.isCurrent ? '<span class="badge badge--cached" style="font-size:0.65rem">current</span> ' : ""}${
          w.title ? `<span style="font-weight:600">${escapeHtml(w.title)}</span> · ` : ""
        }${w.company ? escapeHtml(w.company) : "—"}${
          w.location ? ` <span class="muted">· ${escapeHtml(w.location)}</span>` : ""
        }${w.industry ? ` <span class="muted">· ${escapeHtml(w.industry)}</span>` : ""}</li>`
    )
    .join("");
  const educationList = education
    .map((e) => {
      const parts = [e.institution, e.field, e.years].filter((x) => x && String(x).trim());
      const line = parts.length ? parts.map((x) => escapeHtml(String(x).trim())).join(" · ") : "—";
      return `<li style="margin-bottom:0.45rem">${line}</li>`;
    })
    .join("");
  const requestedPath =
    job.kind === "enrich" && job.profilePath != null && String(job.profilePath).trim()
      ? String(job.profilePath).split("?")[0].trim().replace(/\/+$/, "")
      : "";
  const pathForUi = requestedPath || pr.profilePath || r.url || "—";
  const addrList = addrs
    .map((a) => {
      const line = a.formattedFull || a.label || a.path || "—";
      const when = a.recordedRange || a.timeRange || "";
      const periods = Array.isArray(a.periods) ? a.periods.filter((p) => p && (p.recordedRange || p.timeRange)) : [];
      const periodSummary = periods.length > 1
        ? `<div class="muted" style="font-size:0.78rem; margin-top:0.2rem">History: ${escapeHtml(
            periods.map((p) => String(p.recordedRange || p.timeRange || "")).filter(Boolean).join("; ")
          )}</div>`
        : "";
      return `<li>${escapeHtml(line)}${
        a.isCurrent ? ' <span class="badge badge--cached" style="font-size:0.65rem">current</span>' : ""
      }${when ? ` <span class="muted" style="font-size:0.8rem">${escapeHtml(when)}</span>` : ""}${periodSummary}${addressEnrichmentSummaryHtml(a)}</li>`;
    })
    .join("");
  const phoneList = phones
    .map((p) => {
      const disp = escapeHtml(p.display || p.dashed || "—");
      const lt = p.lineType ? ` <span class="muted" style="font-size:0.8rem">${escapeHtml(p.lineType)}</span>` : "";
      const cur = p.isCurrent ? ' <span class="badge badge--cached" style="font-size:0.65rem">current</span>' : "";
      const meta = phoneMetadataSummaryHtml(p.phoneMetadata);
      const dash = (p.dashed && String(p.dashed).trim()) || "";
      const norm = dash ? normalizePhoneInput(dash) : { valid: false };
      const skipLookup = !norm.valid || dash === job.dashed;
      const lookupBtn = skipLookup
        ? ""
        : ` <button type="button" class="btn btn--sm btn--ghost phone-queue-btn" data-dashed="${escapeHtml(dash)}"><span class="icon">${icons.phone}</span> Lookup line</button>`;
      return `<li style="display:flex;flex-direction:column;align-items:flex-start;gap:0.15rem"><div style="display:flex;flex-wrap:wrap;align-items:center;gap:0.35rem">${disp}${lt}${cur}${lookupBtn}</div>${meta}</li>`;
    })
    .join("");
  return `
    <p style="margin:0 0 0.75rem; display:flex; flex-wrap:wrap; gap:0.4rem; align-items:center">
      ${job.dashed ? `<span class="muted" style="font-size:0.8rem">Line <span class="mono">${escapeHtml(job.dashed)}</span></span>` : `<span class="muted" style="font-size:0.8rem">Standalone profile enrich</span>`}
      <a class="btn btn--sm btn--ghost" href="/graph.html">Open graph</a>
    </p>
    <div class="card">
      <div class="card__head"><span class="icon">${icons.bolt}</span> Profile</div>
      <div class="card__body">
        <dl class="kv">
          <dt>Name</dt><dd>${escapeHtml(pr.displayName || "—")}</dd>
          <dt>Profile path</dt><dd class="mono">${escapeHtml(String(pathForUi))}</dd>
          <dt>Age</dt><dd>${pr.age != null ? escapeHtml(String(pr.age)) : "—"}</dd>
        </dl>
        ${pr.displayName && pathForUi !== "—" ? profilePathSlugMismatchNoteHtml(String(pr.displayName), String(pathForUi)) : ""}
        ${
          aliases.length
            ? `<p style="margin:0.6rem 0 0.2rem; font-size:0.8rem; font-weight:600">Also known as</p><p class="muted" style="font-size:0.85rem; margin:0">${escapeHtml(aliases.join(", "))}</p>`
            : ""
        }
        ${
          emails.length
            ? `<p style="margin:0.6rem 0 0.2rem; font-size:0.8rem; font-weight:600">Email</p><ul style="margin:0.2rem 0 0.5rem; padding-left:1.1rem; font-size:0.85rem">${emails
                .map((e) => `<li>${escapeHtml(e)}</li>`)
                .join("")}</ul>`
            : ""
        }
        ${
          marital.length
            ? `<p style="margin:0.6rem 0 0.2rem; font-size:0.8rem; font-weight:600">Marital</p><ul style="margin:0.2rem 0 0.5rem; padding-left:0; list-style:none; font-size:0.85rem">${marital
                .map((m) => {
                  if (m.path && m.name) {
                    return `<li style="display:flex;flex-wrap:wrap;align-items:center;gap:0.35rem; margin-bottom:0.4rem">${
                      m.role ? `<span>${escapeHtml(m.role)}:</span> ` : ""
                    }<span class="mono">${escapeHtml(m.name)}</span>
  <a href="${escapeHtml(absoluteUrl(m.path))}" target="_blank" rel="noopener noreferrer">View <span class="icon" style="width:0.85em; display:inline-block; vertical-align:-2px">${icons.link}</span></a>
  ${relatedProfileQueueActionHtml({ name: m.name, path: m.path }, ctxAttrMarital, job)}</li>`;
                  }
                  if (m.text) {
                    return `<li style="margin-bottom:0.4rem">${escapeHtml(m.text)}</li>`;
                  }
                  return "";
                })
                .filter(Boolean)
                .join("")}</ul>`
            : ""
        }
        <p style="margin:0.6rem 0 0.2rem; font-size:0.8rem; font-weight:600">Addresses <span class="muted" style="font-weight:400">(${addrs.length})</span></p>
        ${
          addrList
            ? `<ul style="margin:0.2rem 0 0.5rem; padding-left:1.1rem; font-size:0.85rem">${addrList}</ul>`
            : `<p class="muted" style="font-size:0.82rem; margin:0.2rem 0 0.5rem">None parsed.</p>`
        }
        <p style="margin:0.6rem 0 0.2rem; font-size:0.8rem; font-weight:600">Phones <span class="muted" style="font-weight:400">(${phones.length})</span></p>
        ${
          phoneList
            ? `<ul style="margin:0.2rem 0 0.5rem; padding-left:1.1rem; font-size:0.85rem">${phoneList}</ul>`
            : `<p class="muted" style="font-size:0.82rem; margin:0.2rem 0 0.5rem">None parsed.</p>`
        }
        <p style="margin:0.6rem 0 0.2rem; font-size:0.8rem; font-weight:600">Workplace <span class="muted" style="font-weight:400">(${workplaces.length})</span></p>
        ${
          workplaceList
            ? `<ul style="margin:0.2rem 0 0.5rem; padding-left:1.1rem; font-size:0.85rem; list-style:disc">${workplaceList}</ul>`
            : `<p class="muted" style="font-size:0.82rem; margin:0.2rem 0 0.5rem">None parsed on this profile.</p>`
        }
        <p style="margin:0.6rem 0 0.2rem; font-size:0.8rem; font-weight:600">Education <span class="muted" style="font-weight:400">(${education.length})</span></p>
        ${
          educationList
            ? `<ul style="margin:0.2rem 0 0.5rem; padding-left:1.1rem; font-size:0.85rem; list-style:disc">${educationList}</ul>`
            : `<p class="muted" style="font-size:0.82rem; margin:0.2rem 0 0.5rem">None parsed on this profile.</p>`
        }
      </div>
    </div>
    <div class="result-stack-section">
      <p class="section-title" style="margin:1rem 0 0.55rem; display:flex; flex-wrap:wrap; align-items:center; gap:0.5rem">
        <span style="display:inline-flex; align-items:center; gap:0.35rem"
          ><span class="icon" style="width:1em; vertical-align:-2px">${icons.people}</span> Relatives</span
        ><span class="muted" style="font-size:0.78rem; font-weight:400">(${rels.length})</span>
      </p>
      <div class="card">
        <div class="card__body" style="padding:0">
          ${
            rels.length
              ? `<div style="overflow-x:auto"><table class="data-table">
          <thead><tr><th>Name</th><th>Profile</th><th>Open</th></tr></thead>
          <tbody>${buildRelatedPersonTableRows(
            rels
              .filter((x) => x && x.path)
              .map((x) => ({
                name: x.name || "—",
                path: String(x.path).split("#")[0],
                alternateProfilePaths: Array.isArray(x.alternateProfilePaths) ? x.alternateProfilePaths : undefined,
              })),
            job.dashed,
            job
          )}</tbody>
        </table></div>`
              : `<p class="empty-state" style="padding:1.25rem">None parsed on this profile.</p>`
          }
        </div>
      </div>
    </div>
    ${rawApiJsonPanelHtml("Raw API JSON (full response)", r)}
  `;
}

function formatNameSearchResultHtml(job) {
  const result = job.result;
  if (!result) {
    return `<div class="empty-state">No response payload. Try the name search again.</div>`;
  }
  const parsed = result.parsed || {};
  const candidates = Array.isArray(parsed.candidates) ? parsed.candidates : [];
  const rows = candidates
    .map((candidate) => {
      const prior = Array.isArray(candidate.priorAddresses) && candidate.priorAddresses.length
        ? escapeHtml(candidate.priorAddresses.slice(0, 4).join(", "))
        : '<span class="muted">—</span>';
      const relCount = Array.isArray(candidate.relatives) ? candidate.relatives.length : 0;
      const relNames = relCount
        ? escapeHtml(candidate.relatives.slice(0, 4).map((rel) => rel.name).join(", "))
        : "—";
      const openSite = candidate.profilePath
        ? `<a class="btn btn--sm btn--ghost" href="${escapeHtml(absoluteUrl(candidate.profilePath))}" target="_blank" rel="noopener noreferrer"><span class="icon">${icons.link}</span> Profile</a>`
        : "";
      const enrich = candidate.profilePath
        ? relatedProfileQueueActionHtml({ name: candidate.displayName, path: candidate.profilePath }, "", job)
        : "";
      return `<tr>
        <td>
          <div style="font-weight:600">${escapeHtml(candidate.displayName || "—")}</div>
          <div class="muted" style="font-size:0.78rem">${candidate.age != null ? `Age ${escapeHtml(String(candidate.age))}` : "Age unknown"}</div>
        </td>
        <td>${escapeHtml(candidate.currentCityState || "—")}</td>
        <td>${prior}</td>
        <td><span title="${escapeHtml(relNames)}">${escapeHtml(relCount ? `${relCount} relative${relCount === 1 ? "" : "s"}` : "—")}</span></td>
        <td style="white-space:nowrap">${openSite} ${enrich}</td>
      </tr>`;
    })
    .join("");
  const filterBits = [job.searchCity, job.searchState].filter(Boolean).join(", ");
  return `
    <div class="card">
      <div class="card__head"><span class="icon">${icons.search}</span> Name search</div>
      <div class="card__body">
        <dl class="kv">
          <dt>Query</dt><dd>${escapeHtml(job.searchName || parsed.queryName || "—")}</dd>
          <dt>Filters</dt><dd>${escapeHtml(filterBits || "Nationwide")}</dd>
          <dt>Records</dt><dd>${escapeHtml(String(parsed.totalRecords != null ? parsed.totalRecords : candidates.length))}</dd>
          <dt>Source</dt><dd><a href="${escapeHtml(result.url)}" target="_blank" rel="noopener noreferrer">Open page <span class="icon" style="width:0.9em">${icons.link}</span></a></dd>
        </dl>
        ${parsed.summaryText ? `<p class="muted" style="font-size:0.82rem; margin:0.65rem 0 0">${escapeHtml(parsed.summaryText)}</p>` : ""}
        ${parsed.totalPages ? `<p class="muted" style="font-size:0.78rem; margin:0.4rem 0 0">Results span ${escapeHtml(String(parsed.totalPages))} page${parsed.totalPages === 1 ? "" : "s"} on USPhoneBook.</p>` : ""}
      </div>
    </div>
    <div class="result-stack-section">
      <div class="card">
        <div class="card__head"><span class="icon">${icons.people}</span> Candidates</div>
        <div class="card__body" style="padding:0">
          ${rows ? `<div style="overflow-x:auto"><table class="data-table"><thead><tr><th>Name</th><th>Lives in</th><th>Prior addresses</th><th>Relatives</th><th>Open</th></tr></thead><tbody>${rows}</tbody></table></div>` : `<p class="empty-state" style="padding:1.25rem">No candidate rows were parsed from this result page.</p>`}
        </div>
      </div>
    </div>
    ${rawApiJsonPanelHtml("Raw API JSON (full response)", result)}
  `;
}

async function renderResult(job) {
  const mount = document.getElementById("result-body");
  if (!mount) {
    return;
  }
  try {
  if (!job) {
    mount.innerHTML = `<div class="empty-state">Select a completed job from the queue, or enqueue a new lookup.</div>`;
    return;
  }
  if (job.kind === "enrich") {
    if (job.status === "pending" || job.status === "running") {
      mount.innerHTML = `<div class="empty-state">Enrich is ${
        job.status === "pending" ? "waiting in the job queue" : "running (Flare fetches the profile page)"
      }.</div>`;
      return;
    }
    if (job.status === "timeout") {
      mount.innerHTML = `<div class="card"><div class="card__body">
      <p class="mono muted">Enrich timed out after ${LOOKUP_MAX_MS / 1000}s.</p>
      <p style="margin-top:0.75rem"><button type="button" class="btn btn--sm btn--ghost" data-result-retry="${escapeHtml(
        job.id
      )}">Retry</button></p>
    </div></div>`;
      return;
    }
    if (job.status === "error") {
      mount.innerHTML = `<div class="card"><div class="card__body">
      <p class="mono" style="color:var(--danger)">${escapeHtml(job.error || "Error")}</p>
      <p style="margin-top:0.75rem"><button type="button" class="btn btn--sm btn--ghost" data-result-retry="${escapeHtml(
        job.id
      )}">Retry</button></p>
    </div></div>`;
      return;
    }
    mount.innerHTML = formatEnrichResultHtml(job);
    return;
  }
  if (job.kind === "name") {
    if (job.status === "pending" || job.status === "running") {
      mount.innerHTML = `<div class="empty-state">Name search is ${job.status === "pending" ? "waiting in queue" : "running on the solver"}.</div>`;
      return;
    }
    if (job.status === "timeout") {
      mount.innerHTML = `<div class="card"><div class="card__body">
      <p class="mono muted">Name search timed out after ${LOOKUP_MAX_MS / 1000}s.</p>
      <p style="margin-top:0.75rem"><button type="button" class="btn btn--sm btn--ghost" data-result-retry="${escapeHtml(job.id)}">Retry</button></p>
    </div></div>`;
      return;
    }
    if (job.status === "error") {
      mount.innerHTML = `<div class="card"><div class="card__body">
      <p class="mono" style="color:var(--danger)">${escapeHtml(job.error || "Error")}</p>
      <p style="margin-top:0.75rem"><button type="button" class="btn btn--sm btn--ghost" data-result-retry="${escapeHtml(job.id)}">Retry</button></p>
    </div></div>`;
      return;
    }
    mount.innerHTML = formatNameSearchResultHtml(job);
    return;
  }
  if (job.status === "pending" || job.status === "running") {
    mount.innerHTML = `<div class="empty-state">Job is ${job.status === "pending" ? "waiting in queue" : "running on the solver"}.</div>`;
    return;
  }
  if (job.status === "timeout") {
    mount.innerHTML = `<div class="card"><div class="card__body">
      <p class="mono muted">Request timed out after ${LOOKUP_MAX_MS / 1000}s.</p>
      <p style="margin-top:0.75rem"><button type="button" class="btn btn--sm btn--ghost" data-result-retry="${escapeHtml(
        job.id
      )}">Retry</button></p>
    </div></div>`;
    return;
  }
  if (job.status === "error") {
    mount.innerHTML = `<div class="card"><div class="card__body">
      <p class="mono" style="color:var(--danger)">${escapeHtml(job.error || "Error")}</p>
      <p style="margin-top:0.75rem"><button type="button" class="btn btn--sm btn--ghost" data-result-retry="${escapeHtml(
        job.id
      )}">Retry</button></p>
    </div></div>`;
    return;
  }
  const r = job.result;
  if (!r) {
    mount.innerHTML = `<div class="empty-state">No payload.</div>`;
    return;
  }
  const p = r.parsed || {};
  const owner = p.currentOwner;
  const rel = p.relatives || [];
  const linePhone = p.linePhone || r.url?.match(/\d{3}-\d{3}-\d{4}/)?.[0] || job.dashed;
  const profilePath = p.profilePath;
  const profileEnrichDisabled = profilePath ? phoneProfileEnrichButtonDisabled(job, profilePath) : false;
  const phoneProfileEnrichJ = profilePath ? findMatchingPhoneProfileEnrichJob(job, profilePath) : null;
  const profileEnrichDoneElsewhere =
    profilePath && (!phoneProfileEnrichJ || phoneProfileEnrichJ.status !== "ok")
      ? finishedEnrichJobMatchingPaths(profilePath, undefined)
      : null;
  const phoneProfileShowJob =
    phoneProfileEnrichJ && phoneProfileEnrichJ.status === "ok" ? phoneProfileEnrichJ : profileEnrichDoneElsewhere;
  const phoneProfileShow = Boolean(phoneProfileShowJob);
  const ownerName = owner
    ? owner.displayName || [owner.givenName, owner.familyName].filter(Boolean).join(" ") || "—"
    : "—";
  const lineMeta = phoneMetadataSummaryHtml(r.phoneMetadata || p.lookupPhoneMetadata);
  const externalSummary = externalSourceSummaryHtml(r.externalSources || p.externalSources);
  const noBlock = !owner && rel.length === 0;

  mount.innerHTML = `
    <div class="card">
      <div class="card__head">
        <span class="icon">${icons.phone}</span> Subject
        ${r.cached ? '<span class="badge badge--cached" style="margin-left:auto">Served from app cache</span>' : ""}
      </div>
      <div class="card__body">
        <dl class="kv">
          <dt>Line</dt><dd class="mono">${escapeHtml(String(linePhone))}</dd>
          <dt>Reported name</dt><dd>${escapeHtml(ownerName)}</dd>
          <dt>Source</dt><dd><a href="${escapeHtml(r.url)}" rel="noopener noreferrer" target="_blank">Open page <span class="icon" style="width:0.9em">${icons.link}</span></a></dd>
        </dl>
        ${lineMeta ? `<p class="muted" style="font-size:0.8rem; margin:0.55rem 0 0">${lineMeta}</p>` : ""}
        ${
          profilePath
            ? `<p style="margin-top:0.75rem; display:flex; flex-wrap:wrap; gap:0.4rem; align-items:center">
            <a class="btn btn--sm" href="${escapeHtml(absoluteUrl(profilePath))}" target="_blank" rel="noopener noreferrer">
              <span class="icon">${icons.link}</span> Profile (site)
            </a>
            ${
              phoneProfileShow && phoneProfileShowJob
                ? `<button type="button" class="btn btn--sm btn--ghost show-enrich-job-btn" data-show-job="${escapeHtml(
                    phoneProfileShowJob.id
                  )}" title="Open scraped profile in queue">
              <span class="icon">${icons.view}</span> Show profile
            </button>`
                : `<button type="button" class="btn btn--sm btn--ghost enrich-btn" data-kind="phone-profile" data-path="${escapeHtml(
                    profilePath
                  )}" data-context-phone="${escapeHtml(job.dashed)}" data-name="${escapeHtml(
                    ownerName !== "—" ? ownerName : ""
                  )}" ${profileEnrichDisabled ? "disabled" : ""}>
              <span class="icon">${icons.bolt}</span> Enrich profile
            </button>`
            }
            <a class="btn btn--sm btn--ghost" href="/graph.html">Graph</a>
          </p>`
            : ""
        }
        ${
          p.fullAddressTeaser
            ? `<p class="muted" style="font-size:0.82rem; margin-top:0.5rem">Site indicates a full address is available on their record (not displayed here).</p>`
            : ""
        }
      </div>
    </div>
    ${
      noBlock
        ? `<p class="muted" style="font-size:0.85rem; margin-bottom:1rem">The response did not include the usual people-finder block (blocked page, no listing, or layout change). Use the source link to inspect the live page.</p>`
        : ""
    }
    <div class="result-stack-section">
      <p class="section-title" style="margin:1rem 0 0.55rem; display:flex; flex-wrap:wrap; align-items:center; gap:0.5rem">
        <span style="display:inline-flex; align-items:center; gap:0.35rem"
          ><span class="icon" style="width:1em; vertical-align:-2px">${icons.people}</span> Related persons</span
        ><span class="muted" style="font-size:0.78rem; font-weight:400">(${rel.length})</span>
      </p>
      <div class="card">
        <div class="card__body" style="padding:0">
          ${
            rel.length
              ? `<table class="data-table">
          <thead><tr><th>Name</th><th>Profile</th><th>Open</th></tr></thead>
          <tbody>
            ${buildRelatedPersonTableRows(rel, job.dashed, job)}
          </tbody>
        </table>`
              : `<p class="empty-state" style="padding:1.25rem">No related persons on this lookup page for this line.</p>`
          }
        </div>
      </div>
    </div>
    ${externalSummary}
    ${rawApiJsonPanelHtml("Raw API JSON (full response)", r)}
  `;

  } finally {
    syncResultRemoveButton();
  }
}

async function runNextJob() {
  if (!isRunnerIdle) {
    return;
  }
  const next = jobs.find((j) => j.status === "pending");
  if (!next) {
    isRunnerIdle = true;
    return;
  }
  isRunnerIdle = false;
  next.status = "running";
  next.startedAt = Date.now();
  selectedId = next.id;
  renderQueue();
  await renderResult(next);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOKUP_MAX_MS);
  const isEnrich = next.kind === "enrich";
  try {
    if (isEnrich) {
      let contextPhone = next.dashed;
      let enrichBlocked = false;
      if (next.parentId) {
        const parent = jobs.find((p) => p.id === next.parentId);
        if (!parent || parent.status !== "ok") {
          next.status = "error";
          next.error = "Parent phone lookup is missing or not complete.";
          clearTimeout(timer);
          enrichBlocked = true;
        } else {
          contextPhone = parent.dashed;
        }
      }
      if (!enrichBlocked) {
        const res = await fetch("/api/profile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            path: next.profilePath,
            contextPhone,
            maxTimeout: FLARE_MAX_TIMEOUT_MS,
            disableMedia: true,
            ingest: true,
            includeRawHtml: false,
          }),
          signal: controller.signal,
        });
        clearTimeout(timer);
        const data = await res.json();
        if (!res.ok) {
          next.status = "error";
          next.error = data.error || `HTTP ${res.status}`;
        } else {
          next.status = "ok";
          next.result = data;
          if (data.profile && typeof data.profile === "object" && next.profilePath) {
            const req = String(next.profilePath).split("?")[0].trim().replace(/\/+$/, "");
            if (req.startsWith("/")) {
              data.profile.profilePath = req;
            }
          }
          const label = data.profile && typeof data.profile.displayName === "string" ? data.profile.displayName.trim() : "";
          if (label) {
            next.enrichName = label;
          }
        }
      }
    } else {
      const endpoint = next.kind === "name"
        ? "/api/name-search?" +
          new URLSearchParams({
            name: next.searchName || "",
            city: next.searchCity || "",
            state: next.searchState || "",
            maxTimeout: String(FLARE_MAX_TIMEOUT_MS),
            disableMedia: "1",
          })
        : "/api/phone-search?" +
          new URLSearchParams({
            phone: next.dashed,
            maxTimeout: String(FLARE_MAX_TIMEOUT_MS),
            disableMedia: "1",
          });
      const res = await fetch(endpoint, { signal: controller.signal });
      clearTimeout(timer);
      const j = await res.json();
      if (!res.ok) {
        next.status = "error";
        next.error = j.error || `HTTP ${res.status}`;
      } else {
        next.status = "ok";
        next.result = j;
      }
    }
    if (next.status === "ok") {
      next.autoRetriesUsed = 0;
      const gsync = await pushGraphToServer(jobs);
      if (gsync.ok) {
        applyGraphIngestToJobResult(next, gsync.payload);
      }
    }
  } catch (e) {
    clearTimeout(timer);
    const elapsed = Date.now() - (next.startedAt || 0);
    const msg = e && e.message != null ? e.message : String(e);
    if (e && e.name === "AbortError") {
      if (elapsed >= LOOKUP_MAX_MS - 2000) {
        next.status = "timeout";
        next.error = "Timed out";
      } else {
        next.status = "pending";
        next.error = undefined;
      }
    } else if (
      /failed to fetch|networkerror|aborted|load failed|the user aborted|download.*failed|fetch.*abort/i.test(
        String(msg)
      ) &&
      elapsed < LOOKUP_MAX_MS - 3000
    ) {
      next.status = "pending";
      next.error = undefined;
    } else {
      next.status = "error";
      next.error = msg;
    }
  }
  if (
    (next.status === "error" || next.status === "timeout") &&
    jobIsEligibleForAutoRetry(next) &&
    (next.autoRetriesUsed || 0) < MAX_AUTO_RETRIES
  ) {
    next.autoRetriesUsed = (next.autoRetriesUsed || 0) + 1;
    next.status = "pending";
    next.error = undefined;
    next.result = undefined;
    next.startedAt = undefined;
  }
  if (next.status === "ok" || next.status === "error" || next.status === "timeout") {
    next.finishedAt = Date.now();
  } else {
    next.finishedAt = undefined;
  }
  selectedId = next.id;
  renderQueue();
  await renderResult(next);
  saveQueue();
  isRunnerIdle = true;
  runNextJob();
}

function addJob(phoneInput) {
  const { dashed, valid } = normalizePhoneInput(phoneInput);
  if (!valid) {
    showStub("Enter a 10-digit US number or 000-000-0000 format.");
    return;
  }
  const samePhones = jobs.filter((j) => j.kind === "phone" && j.dashed === dashed);
  const inflight = samePhones.find((j) => j.status === "pending" || j.status === "running");
  if (inflight) {
    showStub("A lookup for this number is already running or waiting in the queue.");
    return;
  }
  const completed = samePhones.filter((j) => j.status === "ok");
  if (completed.length) {
    completed.sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0));
    const best = completed[0];
    selectedId = best.id;
    renderQueue();
    void renderResult(best).catch(() => {});
    showStub("This number is already in the list — see that row. Remove it with × if you need a new fetch.");
    return;
  }
  const id = `J-${++jobCounter}`;
  jobs.push({
    id,
    kind: "phone",
    phone: phoneInput,
    dashed,
    status: "pending",
  });
  renderQueue();
  saveQueue();
  runNextJob();
}

function addNameJob(nameInput, cityInput, stateInput, stateNameInput) {
  const normalized = normalizeNameSearchInput(nameInput, cityInput, stateInput, stateNameInput);
  if (!normalized.valid) {
    showStub(normalized.error);
    return;
  }
  const sameSearches = jobs.filter((j) => j.kind === "name" && j.queryKey === normalized.key);
  const inflight = sameSearches.find((j) => j.status === "pending" || j.status === "running");
  if (inflight) {
    showStub("A lookup for this name query is already running or waiting in the queue.");
    return;
  }
  const completed = sameSearches.filter((j) => j.status === "ok");
  if (completed.length) {
    completed.sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0));
    const best = completed[0];
    selectedId = best.id;
    renderQueue();
    void renderResult(best).catch(() => {});
    showStub("That name search is already in the list — opening the latest result.");
    return;
  }
  const id = `N-${++jobCounter}`;
  jobs.push({
    id,
    kind: "name",
    phone: "",
    status: "pending",
    searchName: normalized.name,
    searchCity: normalized.city,
    searchState: normalized.state,
    searchStateName: normalized.stateName,
    queryKey: normalized.key,
  });
  renderQueue();
  saveQueue();
  runNextJob();
}

/**
 * @returns {void}
 */
function loadFromStorage() {
  let raw;
  try {
    raw = localStorage.getItem(LS_KEY) || localStorage.getItem(LS_MIGRATE_KEY);
  } catch {
    return;
  }
  if (!raw) {
    return;
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return;
  }
  if (!data || !Array.isArray(data.jobs)) {
    return;
  }
  if (typeof data.jobCounter === "number" && data.jobCounter > jobCounter) {
    jobCounter = data.jobCounter;
  }
  jobs.length = 0;
  for (const j of data.jobs) {
    if (!j || !j.id) {
      continue;
    }
    let status = j.status === "running" ? "pending" : j.status;
    if (
      status === "error" &&
      j.error &&
      /failed to fetch|networkerror|aborted|load failed|the user aborted|download.*failed|fetch.*abort/i.test(
        String(j.error)
      )
    ) {
      status = "pending";
    }
    const kind = j.kind === "enrich" ? "enrich" : j.kind === "name" ? "name" : "phone";
    const enrichName =
      kind === "enrich" && status === "ok" && j.result?.profile?.displayName
        ? String(j.result.profile.displayName).trim() || j.enrichName
        : j.enrichName;
    jobs.push({
      id: j.id,
      phone: j.phone || j.dashed,
      dashed: j.dashed,
      status: status || "ok",
      result: status === "ok" ? j.result : undefined,
      error: status === "pending" ? undefined : j.error,
      startedAt: status === "pending" ? undefined : j.startedAt,
      finishedAt: status === "pending" ? undefined : j.finishedAt,
      kind,
      parentId: j.parentId,
      profilePath: j.profilePath,
      enrichKind: j.enrichKind,
      enrichName,
      searchName: j.searchName,
      searchCity: j.searchCity,
      searchState: j.searchState,
      searchStateName: j.searchStateName,
      queryKey: j.queryKey,
      autoRetriesUsed: typeof j.autoRetriesUsed === "number" ? j.autoRetriesUsed : 0,
    });
  }
  for (let i = jobs.length - 1; i >= 0; i--) {
    const j = jobs[i];
    if (j.kind === "enrich" && j.parentId && !jobs.some((p) => p.id === j.parentId)) {
      jobs.splice(i, 1);
    }
  }
  dedupeRedundantPhoneJobs();
  if (data.selectedId && jobs.some((j) => j.id === data.selectedId)) {
    selectedId = data.selectedId;
  } else {
    const last = jobs[jobs.length - 1];
    selectedId = last ? last.id : null;
  }
}

function init() {
  const form = document.getElementById("search-form");
  const input = document.getElementById("phone-input");
  const nameForm = document.getElementById("name-search-form");
  const nameInput = document.getElementById("name-input");
  const nameCityInput = document.getElementById("name-city-input");
  const nameStateInput = document.getElementById("name-state-input");
  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (enqueueDebounce) {
        return;
      }
      enqueueDebounce = setTimeout(() => {
        enqueueDebounce = 0;
      }, 450);
      addJob(input.value);
    });
  }
  if (nameForm && nameInput && nameCityInput && nameStateInput) {
    nameForm.addEventListener("submit", (e) => {
      e.preventDefault();
      if (enqueueDebounce) {
        return;
      }
      enqueueDebounce = setTimeout(() => {
        enqueueDebounce = 0;
      }, 450);
      const stateSelect = /** @type {HTMLSelectElement} */ (nameStateInput);
      addNameJob(nameInput.value, nameCityInput.value, stateSelect.value, stateSelect.options[stateSelect.selectedIndex]?.text || "");
    });
  }
  loadFromStorage();
  {
    const sel = jobs.find((j) => j.id === selectedId) || null;
    renderQueue();
    void renderResult(sel).catch(() => {});
  }
  (async () => {
    const gsync = await pushGraphToServer(jobs);
    if (gsync.ok) {
      for (const j of jobs) {
        applyGraphIngestToJobResult(j, gsync.payload);
      }
    }
    saveQueue();
    {
      const pick = selectedId && jobs.find((j) => j.id === selectedId);
      void renderResult(pick || null).catch(() => {});
    }
    runNextJob();
  })();
  window.addEventListener("pagehide", () => {
    flushQueueForPageExit();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      saveQueue();
    }
  });
  const resultRm = document.getElementById("result-remove-btn");
  if (resultRm) {
    resultRm.addEventListener("click", () => {
      if (selectedId) {
        void performRemoveJob(selectedId);
      }
    });
  }
  document.getElementById("result-body")?.addEventListener("click", (ev) => {
    const t = ev.target;
    if (!(t instanceof Element)) {
      return;
    }
    const retryEl = t.closest("[data-result-retry]");
    const id = retryEl && retryEl.getAttribute("data-result-retry");
    if (id) {
      ev.preventDefault();
      retryJob(id);
      return;
    }
    const showJobBtn = t.closest(".show-enrich-job-btn");
    const goId = showJobBtn && showJobBtn.getAttribute("data-show-job");
    if (goId) {
      ev.preventDefault();
      const jj = jobs.find((x) => x.id === goId);
      if (jj) {
        selectedId = goId;
        renderQueue();
        void renderResult(jj).catch(() => {});
      }
      return;
    }
    const pq = t.closest(".phone-queue-btn");
    if (pq) {
      ev.preventDefault();
      const d = pq.getAttribute("data-dashed");
      if (d && String(d).trim()) {
        addJob(String(d).trim());
      }
      return;
    }
    const enrichBtn = t.closest(".enrich-btn");
    if (!enrichBtn || enrichBtn.hasAttribute("disabled")) {
      return;
    }
    ev.preventDefault();
    const path = enrichBtn.getAttribute("data-path");
    const kind = enrichBtn.getAttribute("data-kind") || "profile";
    let name = (enrichBtn.getAttribute("data-name") || "").trim();
    const ctxPhone = enrichBtn.getAttribute("data-context-phone");
    if (!path) {
      return;
    }
    const selJob = jobs.find((x) => x.id === selectedId);
    if (!name && selJob && selJob.kind === "phone" && selJob.status === "ok" && selJob.result?.parsed?.currentOwner) {
      const o = selJob.result.parsed.currentOwner;
      name = (
        o.displayName ||
        [o.givenName, o.familyName].filter(Boolean).join(" ") ||
        ""
      ).trim();
    }
    const fallbackSlug = path.split("/").filter(Boolean).pop() || "Profile";
    if (kind === "related-profile") {
      const dashed = (ctxPhone && ctxPhone.trim()) || dashedFromSelectedPhoneOkJob() || "";
      addStandaloneEnrichJob(dashed, {
        path,
        enrichKind: kind,
        enrichName: name || fallbackSlug,
      });
      return;
    }
    const j = selJob;
    if (!j || j.kind === "enrich" || j.status !== "ok") {
      showStub("Select a completed phone lookup, then use Enrich.");
      return;
    }
    addEnrichJob(j.id, {
      path,
      enrichKind: kind,
      enrichName: name || fallbackSlug,
    });
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
