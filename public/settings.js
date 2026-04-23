/**
 * Settings — server database maintenance (same queue keys as app.js / graph.js).
 */

const LS_KEY = "usphonebook_queue_v2";
const LS_MIGRATE_KEY = "usphonebook_queue_v1";

/**
 * @returns {Array<
 *   | { kind: "phone"; dashed: string; parsed: object; runId: string }
 *   | { kind: "enrich"; contextPhone: string; profile: object; runId: string }
 * >}
 */
function buildItemsFromLocalStorage() {
  let raw;
  try {
    raw = localStorage.getItem(LS_KEY) || localStorage.getItem(LS_MIGRATE_KEY);
  } catch {
    return [];
  }
  if (!raw) {
    return [];
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!data || !Array.isArray(data.jobs)) {
    return [];
  }
  const items = [];
  for (const j of data.jobs) {
    if (!j) {
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
    } else if (j.status === "ok" && j.result && j.result.parsed) {
      items.push({ kind: "phone", dashed: j.dashed, parsed: j.result.parsed, runId: j.id });
    }
  }
  return items;
}

/**
 * @param {boolean} hard
 * @returns {Promise<unknown>}
 */
async function postDbWipe(hard) {
  const res = await fetch("/api/db/wipe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hard }),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    if (!res.ok) {
      throw new Error(res.statusText || `HTTP ${res.status}`);
    }
  }
  if (!res.ok) {
    throw new Error((data && (data.error || data.message)) || res.statusText || `HTTP ${res.status}`);
  }
  if (data && data.ok === false) {
    throw new Error(String(data.error || "wipe failed"));
  }
  return data;
}

async function postRebuildFromQueueStorage() {
  const items = buildItemsFromLocalStorage();
  const res = await fetch("/api/graph/rebuild", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    if (!res.ok) {
      throw new Error(res.statusText || `HTTP ${res.status}`);
    }
    throw new Error("Server response was not valid JSON");
  }
  if (!res.ok) {
    throw new Error((data && (data.error || data.message)) || res.statusText || `HTTP ${res.status}`);
  }
  if (data && data.ok === false) {
    throw new Error(String(data.error || "rebuild failed"));
  }
}

function init() {
  const btn = document.getElementById("btn-reset-database");
  const status = document.getElementById("settings-status");
  const auditLoading = document.getElementById("audit-loading");
  const auditError = document.getElementById("audit-error");
  const auditRoot = document.getElementById("audit-root");
  if (!btn || !status || !auditLoading || !auditError || !auditRoot) {
    return;
  }
  btn.addEventListener("click", async () => {
    if (
      !window.confirm(
        "Delete the SQLite database file on the server and create a new empty one? This removes everything stored in that file (graph + cache). Your browser lookup queue is unchanged."
      )
    ) {
      return;
    }
    status.textContent = "Resetting database…";
    status.classList.remove("settings-status--ok", "settings-status--err");
    try {
      await postDbWipe(true);
      status.textContent = "Rebuilding graph from this browser’s queue…";
      try {
        await postRebuildFromQueueStorage();
      } catch (re) {
        status.textContent =
          `Database reset. Could not rebuild automatically: ${re && re.message != null ? re.message : String(re)} — open Graph and click Rebuild.`;
        status.classList.add("settings-status--err");
        return;
      }
      status.textContent =
        "Database file recreated and graph rebuilt from your local queue. Use Graph or Lookup as usual.";
      status.classList.add("settings-status--ok");
    } catch (e) {
      status.textContent = e && e.message != null ? e.message : String(e);
      status.classList.add("settings-status--err");
    }
  });

  void loadSourceAudit({ loadingEl: auditLoading, errorEl: auditError, rootEl: auditRoot });
}

/**
 * @param {string} value
 * @returns {string}
 */
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");
}

/**
 * @param {{ loadingEl: HTMLElement; errorEl: HTMLElement; rootEl: HTMLElement }} ctx
 * @returns {Promise<void>}
 */
async function loadSourceAudit(ctx) {
  const { loadingEl, errorEl, rootEl } = ctx;
  loadingEl.hidden = false;
  errorEl.hidden = true;
  rootEl.hidden = true;
  try {
    const res = await fetch("/api/source-audit");
    const data = await res.json();
    if (!res.ok || !data?.ok || !data.audit) {
      throw new Error(data?.error || `HTTP ${res.status}`);
    }
    rootEl.innerHTML = renderAuditHtml(data.audit);
    loadingEl.hidden = true;
    errorEl.hidden = true;
    rootEl.hidden = false;
  } catch (e) {
    loadingEl.hidden = true;
    errorEl.hidden = false;
    errorEl.textContent = e && e.message != null ? e.message : String(e);
    rootEl.hidden = true;
  }
}

/**
 * @param {Array<any>} sources
 * @returns {string}
 */
function renderSourcesTable(sources) {
  return `<div class="audit-table-wrap"><table class="data-table">
    <thead>
      <tr>
        <th>Source</th>
        <th>Status</th>
        <th>Observed</th>
        <th>Domains</th>
        <th>Current runtime</th>
      </tr>
    </thead>
    <tbody>
      ${sources
        .map((source) => {
          const observed = source.observed || { entityRefs: 0, cacheRefs: 0, entityTypes: [] };
          return `<tr>
            <td>
              <div class="audit-source-name">${escapeHtml(source.name)}</div>
              <div class="muted mono audit-source-id">${escapeHtml(source.id)}</div>
            </td>
            <td>
              <div>${escapeHtml(source.status)}</div>
              <div class="muted audit-cell-sub">${escapeHtml(source.category)}</div>
            </td>
            <td>
              <div>${escapeHtml(String(observed.entityRefs || 0))} entity refs</div>
              <div class="muted audit-cell-sub">${escapeHtml(String(observed.cacheRefs || 0))} cache refs</div>
            </td>
            <td>
              <div>${escapeHtml((source.dataDomains || []).join(", "))}</div>
              <div class="muted audit-cell-sub">Access: ${escapeHtml(source.access || "n/a")}</div>
            </td>
            <td>
              <div><strong>${escapeHtml(source.runtime?.label || source.acquisition?.current || "n/a")}</strong></div>
              <div class="muted audit-cell-sub">${escapeHtml(source.runtime?.detail || "")}</div>
            </td>
          </tr>`;
        })
        .join("")}
    </tbody>
  </table></div>`;
}

/**
 * @param {any} audit
 * @returns {string}
 */
function renderAuditHtml(audit) {
  const summary = audit.summary || {};
  const activeSources = Array.isArray(audit.sources)
    ? audit.sources.filter((source) => source.status === "active")
    : [];
  return `
    <section class="audit-summary-grid">
      <article class="audit-stat">
        <div class="audit-stat__label">Active sources</div>
        <div class="audit-stat__value">${escapeHtml(String(summary.activeSourceCount || 0))}</div>
      </article>
      <article class="audit-stat">
        <div class="audit-stat__label">Observed active categories</div>
        <div class="audit-stat__value">${escapeHtml(String((summary.activeFamilies || []).length || 0))}</div>
      </article>
      <article class="audit-stat">
        <div class="audit-stat__label">Active categories</div>
        <div class="audit-stat__value audit-stat__value--sm">${escapeHtml((summary.activeFamilies || []).join(", "))}</div>
      </article>
    </section>

    <div class="card settings-section-gap">
      <div class="card__head">Source registry</div>
      <div class="card__body">
        ${renderSourcesTable(activeSources)}
    </div>
  `;
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
