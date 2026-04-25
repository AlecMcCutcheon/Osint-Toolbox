/**
 * Settings — database maintenance, source sessions, and candidate-lead review.
 */

const LS_KEY = "usphonebook_queue_v2";
const LS_MIGRATE_KEY = "usphonebook_queue_v1";
let latestAudit = null;

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
    if (j.status === "ok" && j.result?.normalized?.meta?.graphEligible === true) {
      items.push({ normalized: j.result.normalized, runId: j.id });
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
      items.push({ kind: "enrich", contextPhone: j.dashed, profile: prof, runId: j.id });
    } else if (j.kind === "phone" && j.status === "ok" && j.result && j.result.parsed) {
      items.push({ kind: "phone", dashed: j.dashed, parsed: j.result.parsed, runId: j.id });
    }
  }
  return items;
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
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
  if (!res.ok || data?.ok === false) {
    throw new Error((data && (data.error || data.message)) || res.statusText || `HTTP ${res.status}`);
  }
  return data;
}

async function postDbWipe(hard) {
  return fetchJson("/api/db/wipe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hard }),
  });
}

async function postRebuildFromQueueStorage() {
  const items = buildItemsFromLocalStorage();
  return fetchJson("/api/graph/rebuild", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
  });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");
}

function formatIso(iso) {
  if (!iso) {
    return "—";
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return String(iso);
  }
  return d.toLocaleString();
}

function sessionBadgeHtml(session, source) {
  const status = session?.effectiveStatus || session?.status || (source?.sessionMode === "required" ? "session_required" : "ready");
  let className = "badge badge--cached";
  if (status === "ready") {
    className = "badge badge--ok";
  } else if (status === "challenge_required" || status === "blocked") {
    className = "badge badge--error";
  } else if (status === "session_required" || status === "reauth_required") {
    className = "badge badge--pending";
  }
  return `<span class="${className}">${escapeHtml(status.replace(/_/g, " "))}</span>`;
}

function sourceMeta(sourceId) {
  return latestAudit?.sources?.find((source) => source.id === sourceId) || null;
}

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

function renderAuditHtml(audit) {
  const summary = audit.summary || {};
  const activeSources = Array.isArray(audit.sources) ? audit.sources.filter((source) => source.status === "active") : [];
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
    </div>
  `;
}

function renderSessionHtml(sessions) {
  if (!Array.isArray(sessions) || !sessions.length) {
    return `<p class="empty-state" style="padding:1rem">No source sessions are configured yet.</p>`;
  }
  const rows = sessions
    .map(({ sourceId, session }) => {
      const source = sourceMeta(sourceId) || { id: sourceId, name: sourceId, sessionMode: "optional" };
      const manualMode = source.sessionMode === "required" ? "Manual session required" : source.sessionMode === "optional" ? "Manual session optional" : "No session";
      const warning = session?.lastWarning ? `<div class="muted audit-cell-sub">Last warning: ${escapeHtml(session.lastWarning)}</div>` : `<div class="muted audit-cell-sub">No recent warnings</div>`;
      return `<tr>
        <td>
          <div class="audit-source-name">${escapeHtml(source.name)}</div>
          <div class="muted mono audit-source-id">${escapeHtml(sourceId)}</div>
        </td>
        <td>
          <div>${sessionBadgeHtml(session, source)}</div>
          <div class="muted audit-cell-sub">${escapeHtml(manualMode)}</div>
        </td>
        <td>
          <div class="muted audit-cell-sub">Opened: ${escapeHtml(formatIso(session?.lastOpenedAt))}</div>
          <div class="muted audit-cell-sub">Checked: ${escapeHtml(formatIso(session?.lastCheckedAt))}</div>
          ${warning}
        </td>
        <td>
          <div class="settings-action-stack">
            <button type="button" class="btn btn--sm btn--ghost" data-session-action="open" data-source-id="${escapeHtml(sourceId)}">Open browser</button>
            <button type="button" class="btn btn--sm btn--ghost" data-session-action="check" data-source-id="${escapeHtml(sourceId)}">Check session</button>
            <button type="button" class="btn btn--sm btn--ghost" data-session-action="clear" data-source-id="${escapeHtml(sourceId)}">Clear session</button>
            <button type="button" class="btn btn--sm btn--ghost" data-session-action="pause" data-source-id="${escapeHtml(sourceId)}" data-paused="${session?.paused ? "1" : "0"}">${session?.paused ? "Resume source" : "Pause source"}</button>
          </div>
        </td>
      </tr>`;
    })
    .join("");
  return `<div class="audit-table-wrap"><table class="data-table">
    <thead>
      <tr>
        <th>Source</th>
        <th>Session state</th>
        <th>History</th>
        <th>Actions</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

function renderLeadHtml(leads) {
  if (!Array.isArray(leads) || !leads.length) {
    return `<p class="empty-state" style="padding:1rem">No candidate leads yet. Save one from a name-search result to review it here.</p>`;
  }
  const rows = leads
    .map((lead) => {
      const source = sourceMeta(lead.sourceId);
      return `<tr>
        <td>
          <div style="font-weight:600">${escapeHtml(lead.label || "Candidate lead")}</div>
          <div class="muted mono audit-source-id">${escapeHtml(lead.sourceId)}</div>
        </td>
        <td>
          <a href="${escapeHtml(lead.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(lead.url)}</a>
          <div class="muted audit-cell-sub">Access: ${escapeHtml(lead.accessMode || "lead_only")}</div>
          ${source ? `<div class="muted audit-cell-sub">Source: ${escapeHtml(source.name)}</div>` : ""}
        </td>
        <td>
          <div>${escapeHtml(lead.reviewStatus)}</div>
          <div class="muted audit-cell-sub">Updated ${escapeHtml(formatIso(lead.updatedAt))}</div>
          ${lead.evidence?.summary ? `<div class="muted audit-cell-sub">${escapeHtml(String(lead.evidence.summary))}</div>` : ""}
        </td>
        <td>
          <div class="settings-action-stack">
            <button type="button" class="btn btn--sm btn--ghost" data-lead-review="confirmed" data-lead-id="${escapeHtml(lead.id)}">Confirm</button>
            <button type="button" class="btn btn--sm btn--ghost" data-lead-review="ambiguous" data-lead-id="${escapeHtml(lead.id)}">Ambiguous</button>
            <button type="button" class="btn btn--sm btn--ghost" data-lead-review="rejected" data-lead-id="${escapeHtml(lead.id)}">Reject</button>
            <button type="button" class="btn btn--sm btn--primary" data-lead-promote="1" data-lead-id="${escapeHtml(lead.id)}" title="Fetch profile and add to graph">Promote to graph</button>
          </div>
        </td>
      </tr>`;
    })
    .join("");
  return `<div class="audit-table-wrap"><table class="data-table">
    <thead>
      <tr>
        <th>Lead</th>
        <th>URL</th>
        <th>Review state</th>
        <th>Actions</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

async function loadSourceAudit(ctx) {
  const { loadingEl, errorEl, rootEl } = ctx;
  loadingEl.hidden = false;
  errorEl.hidden = true;
  rootEl.hidden = true;
  try {
    const data = await fetchJson("/api/source-audit");
    latestAudit = data.audit;
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

async function loadSourceSessions(ctx) {
  const { loadingEl, errorEl, rootEl } = ctx;
  loadingEl.hidden = false;
  errorEl.hidden = true;
  rootEl.hidden = true;
  try {
    const data = await fetchJson("/api/source-sessions");
    rootEl.innerHTML = renderSessionHtml(data.sessions || []);
    wireSessionActions(rootEl, ctx);
    loadingEl.hidden = true;
    rootEl.hidden = false;
  } catch (e) {
    loadingEl.hidden = true;
    errorEl.hidden = false;
    errorEl.textContent = e && e.message != null ? e.message : String(e);
  }
}

async function loadCandidateLeads(ctx) {
  const { loadingEl, errorEl, rootEl } = ctx;
  loadingEl.hidden = false;
  errorEl.hidden = true;
  rootEl.hidden = true;
  try {
    const data = await fetchJson("/api/candidate-leads?limit=100");
    rootEl.innerHTML = renderLeadHtml(data.leads || []);
    wireLeadActions(rootEl, ctx);
    loadingEl.hidden = true;
    rootEl.hidden = false;
  } catch (e) {
    loadingEl.hidden = true;
    errorEl.hidden = false;
    errorEl.textContent = e && e.message != null ? e.message : String(e);
  }
}

function wireSessionActions(rootEl, ctx) {
  rootEl.querySelectorAll("[data-session-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const sourceId = button.getAttribute("data-source-id");
      const action = button.getAttribute("data-session-action");
      if (!sourceId || !action) {
        return;
      }
      button.disabled = true;
      ctx.errorEl.hidden = true;
      try {
        if (action === "open") {
          await fetchJson(`/api/source-sessions/${encodeURIComponent(sourceId)}/open`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          });
        } else if (action === "check") {
          await fetchJson(`/api/source-sessions/${encodeURIComponent(sourceId)}/check`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          });
        } else if (action === "clear") {
          if (!window.confirm(`Clear the saved local browser session for ${sourceId}?`)) {
            return;
          }
          await fetchJson(`/api/source-sessions/${encodeURIComponent(sourceId)}/clear`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          });
        } else if (action === "pause") {
          const paused = button.getAttribute("data-paused") !== "1";
          await fetchJson(`/api/source-sessions/${encodeURIComponent(sourceId)}/pause`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ paused }),
          });
        }
        await loadSourceAudit(window.__settingsAuditCtx);
        await loadSourceSessions(window.__settingsSessionCtx);
      } catch (e) {
        ctx.errorEl.hidden = false;
        ctx.errorEl.textContent = e && e.message != null ? e.message : String(e);
      } finally {
        button.disabled = false;
      }
    });
  });
}

function wireLeadActions(rootEl, ctx) {
  rootEl.querySelectorAll("[data-lead-review]").forEach((button) => {
    button.addEventListener("click", async () => {
      const leadId = button.getAttribute("data-lead-id");
      const reviewStatus = button.getAttribute("data-lead-review");
      if (!leadId || !reviewStatus) {
        return;
      }
      button.disabled = true;
      ctx.errorEl.hidden = true;
      try {
        await fetchJson(`/api/candidate-leads/${encodeURIComponent(leadId)}/review`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reviewStatus }),
        });
        await loadCandidateLeads(window.__settingsLeadCtx);
      } catch (e) {
        ctx.errorEl.hidden = false;
        ctx.errorEl.textContent = e && e.message != null ? e.message : String(e);
      } finally {
        button.disabled = false;
      }
    });
  });

  rootEl.querySelectorAll("[data-lead-promote]").forEach((button) => {
    button.addEventListener("click", async () => {
      const leadId = button.getAttribute("data-lead-id");
      if (!leadId) {
        return;
      }
      button.disabled = true;
      button.textContent = "Promoting…";
      ctx.errorEl.hidden = true;
      try {
        const result = await fetchJson(`/api/candidate-leads/${encodeURIComponent(leadId)}/promote`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        if (result.error) {
          ctx.errorEl.hidden = false;
          ctx.errorEl.textContent = result.error;
        }
        await loadCandidateLeads(window.__settingsLeadCtx);
      } catch (e) {
        ctx.errorEl.hidden = false;
        ctx.errorEl.textContent = e && e.message != null ? e.message : String(e);
      } finally {
        button.disabled = false;
        button.textContent = "Promote to graph";
      }
    });
  });
}

function init() {
  const btn = document.getElementById("btn-reset-database");
  const status = document.getElementById("settings-status");
  const auditCtx = {
    loadingEl: document.getElementById("audit-loading"),
    errorEl: document.getElementById("audit-error"),
    rootEl: document.getElementById("audit-root"),
  };
  const sessionCtx = {
    loadingEl: document.getElementById("session-loading"),
    errorEl: document.getElementById("session-error"),
    rootEl: document.getElementById("session-root"),
  };
  const leadCtx = {
    loadingEl: document.getElementById("lead-loading"),
    errorEl: document.getElementById("lead-error"),
    rootEl: document.getElementById("lead-root"),
  };
  if (!btn || !status || !auditCtx.loadingEl || !sessionCtx.loadingEl || !leadCtx.loadingEl) {
    return;
  }
  window.__settingsAuditCtx = auditCtx;
  window.__settingsSessionCtx = sessionCtx;
  window.__settingsLeadCtx = leadCtx;
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
        status.textContent = `Database reset. Could not rebuild automatically: ${re && re.message != null ? re.message : String(re)} — open Graph and click Rebuild.`;
        status.classList.add("settings-status--err");
        return;
      }
      status.textContent = "Database file recreated and graph rebuilt from your local queue. Use Graph or Lookup as usual.";
      status.classList.add("settings-status--ok");
    } catch (e) {
      status.textContent = e && e.message != null ? e.message : String(e);
      status.classList.add("settings-status--err");
    }
  });

  void loadSourceAudit(auditCtx).then(() => loadSourceSessions(sessionCtx));
  void loadCandidateLeads(leadCtx);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
