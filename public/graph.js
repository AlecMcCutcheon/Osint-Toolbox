/**
 * d3-force layout + pan/zoom + node popup (no raw IDs in UI).
 */

const SITE_BASE = "https://www.usphonebook.com";
const SITE_BASES = {
  usphonebook_profile: "https://www.usphonebook.com",
  fastpeoplesearch: "https://www.fastpeoplesearch.com",
  truepeoplesearch: "https://www.truepeoplesearch.com",
};
/** Same keys as /app.js — same browser queue drives the graph. */
const LS_KEY = "usphonebook_queue_v2";
const LS_MIGRATE_KEY = "usphonebook_queue_v1";

/**
 * @returns {Array<
 *   | { kind: "phone"; dashed: string; parsed: object; runId: string }
 *   | { kind: "enrich"; contextPhone: string; profile: object; runId: string }
 *   | { normalized: object; runId: string }
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

const canvas = document.getElementById("graph-canvas");
const meta = document.getElementById("graph-meta");
const btnRebuild = document.getElementById("btn-rebuild");
const btnRefresh = document.getElementById("btn-refresh");
const btnReset = document.getElementById("btn-reset-view");
const viewport = document.getElementById("graph-viewport");
const nodePopup = document.getElementById("graph-node-popup");
const popTitle = document.getElementById("graph-popup-title");
const popPrimary = document.getElementById("graph-popup-primary");
const popHints = document.getElementById("graph-popup-hints");
const popEnrich = document.getElementById("graph-btn-enrich");
const popOpen = document.getElementById("graph-btn-open");
const popClose = document.getElementById("graph-popup-close");

const COLORS = {
  person: "#5b8cff",
  phone_number: "#3ecf8e",
  address: "#e8a54b",
  email: "#c084fc",
  default: "#9aa4b2",
};

const ICON = {
  person: "P",
  phone: "T",
  map: "A",
  mail: "@",
  work: "W",
  info: "i",
  dot: "·",
};

/** d3 ManyBody strength (negative = repel). Stronger magnitude = more spread. */
const CHARGE_BY_TYPE = {
  person: -920,
  phone_number: -1080,
  address: -1180,
  email: -760,
  default: -980,
};

const COLLIDE_BY_TYPE = {
  person: 30,
  phone_number: 38,
  address: 40,
  email: 28,
  default: 34,
};

/** Weak vertical band so entity types drift to different regions. */
const Y_BAND_OFFSET = {
  person: 0,
  phone_number: -110,
  address: 115,
  email: -70,
  default: 0,
};

const NODE_R = 18;
const LAYOUT_R_BASE = 0.38;
const LINK_REST = 248;
const REPULSE_MIN = 130;
const REPULSE_STRENGTH = 0.34;
/** Pairwise fallback repulse multiplier when two nodes share an edge (weaker push-apart). */
const LINKED_REPULSE_FACTOR = 0.38;
const ITER = 100;

/**
 * @type {{
 *   nodes: object[];
 *   edges: object[];
 *   pos: Map<string, { x: number; y: number; vx: number; vy: number }>;
 *   panX: number;
 *   panY: number;
 *   scale: number;
 *   simulation: { stop: Function; on: Function; alpha: Function; alphaTarget: Function; restart: Function } | null;
 *   simNodes: object[] | null;
 *   idToSim: Map<string, object> | null;
 *   didInitialFit: boolean;
 * } | null}
 */
let g = null;

/**
 * @param {string} s
 * @returns {boolean}
 */
function isUuidLike(s) {
  return /^[0-9a-f]{8}-[0-9a-f-]{4}-[0-9a-f-]{4}-[0-9a-f-]{4}-[0-9a-f]{12}$/i.test(String(s).trim());
}

/**
 * @param {string} t
 * @returns {string}
 */
function typeHeadline(t) {
  if (t === "phone_number") {
    return "Phone number";
  }
  if (t === "person") {
    return "Person";
  }
  if (t === "address") {
    return "Address";
  }
  if (t === "email") {
    return "Email";
  }
  return t ? String(t) : "Record";
}

/**
 * @param {object} n
 * @returns {string}
 */
function formatNodeLabel(n) {
  const sub = String(n.sub || "");
  const title = String(n.title || "").trim();

  if (n.type === "phone_number") {
    const d = sub.replace(/^phone_number:/, "");
    if (d) {
      return d;
    }
    if (title && !/^Phone\s+\d/.test(title)) {
      return title.replace(/^Phone\s+/i, "").trim() || title;
    }
    return title.replace(/^Phone\s+/i, "").trim() || "Phone";
  }

  if (n.type === "address") {
    const d = n.data && typeof n.data === "object" ? n.data : {};
    if (d.streetLine && String(d.streetLine).trim()) {
      const s = String(d.streetLine).trim();
      return s.length > 56 ? `${s.slice(0, 53)}…` : s;
    }
    if (d.formattedFull && String(d.formattedFull).trim()) {
      const s = String(d.formattedFull).trim();
      return s.length > 56 ? `${s.slice(0, 53)}…` : s;
    }
    if (title && !isUuidLike(title) && !sub.startsWith("address:")) {
      return title.length > 48 ? `${title.slice(0, 45)}…` : title;
    }
    const raw = sub.replace(/^address:/, "").trim();
    if (raw && raw.length < 80) {
      return raw;
    }
    return "Address";
  }

  if (n.type === "email") {
    const d = n.data && typeof n.data === "object" ? n.data : {};
    const em = (d.displayEmail || d.address || title || "").trim();
    if (em && !isUuidLike(em)) {
      return em.length > 52 ? `${em.slice(0, 49)}…` : em;
    }
    const raw = sub.replace(/^email:/, "").trim();
    return raw || "Email";
  }

  if (n.type === "person") {
    if (title && !isUuidLike(title)) {
      return title;
    }
    if (sub.startsWith("person:")) {
      const path = sub.slice(7);
      if (path.startsWith("/")) {
        const parts = path.split("/").filter(Boolean);
        const last = parts[parts.length - 1] || path;
        return last.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) || "Person";
      }
    }
    return "Person";
  }

  if (title && !isUuidLike(title)) {
    return title;
  }
  return typeHeadline(n.type);
}

function sourceLabelForId(sourceId) {
  const key = String(sourceId || "").trim().toLowerCase();
  if (key === "usphonebook_profile") return "USPhoneBook";
  if (key === "truepeoplesearch") return "TruePeopleSearch";
  if (key === "fastpeoplesearch") return "FastPeopleSearch";
  return key || "Source";
}

function sourceSortWeight(sourceId) {
  const key = String(sourceId || "").trim().toLowerCase();
  if (key === "usphonebook_profile") return 0;
  if (key === "truepeoplesearch") return 1;
  if (key === "fastpeoplesearch") return 2;
  return 9;
}

function absoluteUrl(path, sourceId = "usphonebook_profile") {
  if (!path) {
    return SITE_BASES[sourceId] || SITE_BASE;
  }
  if (/^https?:\/\//i.test(String(path))) {
    return String(path);
  }
  if (!String(path).startsWith("/")) {
    return SITE_BASES[sourceId] || SITE_BASE;
  }
  return (SITE_BASES[sourceId] || SITE_BASE) + String(path).split("?")[0];
}

function normalizeProfilePath(path) {
  return String(path || "").trim().split("?")[0].replace(/\/+$/, "");
}

function normalizeEnrichEntries(entries) {
  const seen = new Set();
  return (Array.isArray(entries) ? entries : [])
    .map((entry) => {
      const path = normalizeProfilePath(entry?.path);
      const sourceId = String(entry?.sourceId || "usphonebook_profile").trim() || "usphonebook_profile";
      const name = String(entry?.name || "").trim() || undefined;
      if (!path) {
        return null;
      }
      return { path, sourceId, ...(name ? { name } : {}) };
    })
    .filter(Boolean)
    .sort((a, b) => {
      const bySource = sourceSortWeight(a.sourceId) - sourceSortWeight(b.sourceId);
      if (bySource !== 0) {
        return bySource;
      }
      return String(a.path).localeCompare(String(b.path));
    })
    .filter((entry) => {
      const key = `${entry.sourceId}|${entry.path}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function readQueueState() {
  try {
    const raw = localStorage.getItem(LS_KEY) || localStorage.getItem(LS_MIGRATE_KEY);
    if (!raw) {
      return { v: 2, jobCounter: 0, jobs: [], selectedId: null };
    }
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.jobs)) {
      return { v: 2, jobCounter: 0, jobs: [], selectedId: null };
    }
    return parsed;
  } catch {
    return { v: 2, jobCounter: 0, jobs: [], selectedId: null };
  }
}

function writeQueueState(state) {
  localStorage.setItem(LS_KEY, JSON.stringify(state));
}

function graphNodeEnrichEntries(node) {
  const data = node?.data && typeof node.data === "object" ? node.data : {};
  const entries = [];
  if (data.mergedSourceProfiles && typeof data.mergedSourceProfiles === "object") {
    for (const [sourceId, info] of Object.entries(data.mergedSourceProfiles)) {
      const path = normalizeProfilePath(info?.profilePath);
      if (path) {
        entries.push({ path, sourceId, name: info?.displayName || data.displayName || node.title || "Person" });
      }
    }
  }
  if (data.profilePath) {
    entries.push({
      path: normalizeProfilePath(data.profilePath),
      sourceId: String(data.sourceId || "usphonebook_profile").trim() || "usphonebook_profile",
      name: data.displayName || node.title || "Person",
    });
  }
  if (Array.isArray(data.alternateProfilePaths)) {
    for (const path of data.alternateProfilePaths) {
      entries.push({
        path: normalizeProfilePath(path),
        sourceId: String(data.sourceId || "usphonebook_profile").trim() || "usphonebook_profile",
        name: data.displayName || node.title || "Person",
      });
    }
  }
  return normalizeEnrichEntries(entries);
}

function connectedPhoneForNode(node) {
  const data = node?.data && typeof node.data === "object" ? node.data : {};
  const currentPhone = Array.isArray(data.phones)
    ? data.phones.find((phone) => phone && phone.isCurrent && phone.dashed)?.dashed || data.phones.find((phone) => phone && phone.dashed)?.dashed
    : "";
  if (currentPhone) {
    return currentPhone;
  }
  if (!g) {
    return "";
  }
  const byId = new Map(g.nodes.map((entry) => [entry.id, entry]));
  for (const edge of g.edges) {
    const otherId = edge.from === node.id ? edge.to : edge.to === node.id ? edge.from : null;
    if (!otherId) {
      continue;
    }
    const other = byId.get(otherId);
    if (!other || other.type !== "phone_number") {
      continue;
    }
    const label = formatNodeLabel(other);
    if (/^\d{3}-\d{3}-\d{4}$/.test(label)) {
      return label;
    }
  }
  return "";
}

async function enrichFromGraphNode(node) {
  const entries = graphNodeEnrichEntries(node);
  if (!entries.length) {
    throw new Error("No enrichable profile paths were found for this node.");
  }
  const contextPhone = connectedPhoneForNode(node) || null;
  const response = await fetch("/api/profile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      path: entries[0].path,
      entries,
      sourceId: entries[0].sourceId,
      contextPhone,
      disableMedia: true,
      ingest: true,
      includeRawHtml: false,
    }),
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error || `HTTP ${response.status}`);
  }

  const queueState = readQueueState();
  const jobId = `E-${Number(queueState.jobCounter || 0) + 1}`;
  queueState.jobCounter = Number(queueState.jobCounter || 0) + 1;
  queueState.jobs.push({
    id: jobId,
    kind: "enrich",
    phone: contextPhone || "",
    dashed: contextPhone || undefined,
    profilePath: entries[0].path,
    enrichEntries: entries,
    enrichKind: "graph-profile",
    enrichName: result.profile?.displayName || formatNodeLabel(node) || "Profile",
    sourceId: entries[0].sourceId,
    status: "ok",
    result,
    startedAt: Date.now(),
    finishedAt: Date.now(),
  });
  queueState.selectedId = jobId;
  writeQueueState(queueState);
  await refresh();
}

/**
 * @param {object} node
 * @returns {string[]}
 */
function relationshipHints(node) {
  if (!g || !g.edges?.length) {
    return [];
  }
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const out = [];
  const seen = new Set();

  /**
   * @param {string} line
   */
  function add(line) {
    if (line && !seen.has(line)) {
      seen.add(line);
      out.push(line);
    }
  }

  for (const e of g.edges) {
    const otherId = e.from === node.id ? e.to : e.to === node.id ? e.from : null;
    if (!otherId || otherId === node.id) {
      continue;
    }
    const o = byId.get(otherId);
    if (!o) {
      continue;
    }
    const ol = formatNodeLabel(o);
    const kind = e.label || "";

    if (kind === "relative") {
      if (e.from === node.id) {
        add(`Relative: ${ol}`);
      } else {
        add(`Relative: ${ol}`);
      }
    } else if (kind === "line_assigned") {
      if (node.type === "person" && o.type === "phone_number") {
        add(`From this number search: ${ol}`);
      } else if (node.type === "phone_number" && o.type === "person") {
        add(`Name on that line: ${ol}`);
      }
    } else if (kind === "profile_from_phone_context") {
      if (o.type === "phone_number" && node.type === "person") {
        add(`Connected from phone view: ${ol}`);
      } else if (o.type === "person" && node.type === "phone_number") {
        add(`Profile opened from this number: ${ol}`);
      }
    } else if (kind === "has_phone") {
      if (node.type === "person" && o.type === "phone_number") {
        add(`Phone: ${ol}`);
      } else if (node.type === "phone_number" && o.type === "person") {
        add(`Person: ${ol}`);
      }
    } else if (kind === "at_address") {
      if (node.type === "person" && o.type === "address") {
        add(`Address: ${ol}`);
      } else if (node.type === "address" && o.type === "person") {
        add(`Person: ${ol}`);
      }
    } else if (kind === "has_email") {
      if (node.type === "person" && o.type === "email") {
        add(`Email: ${ol}`);
      } else if (node.type === "email" && o.type === "person") {
        add(`Person: ${ol}`);
      }
    }
    if (out.length >= 5) {
      break;
    }
  }
  return out.slice(0, 5);
}

function colorFor(n) {
  return COLORS[n.type] || COLORS.default;
}

function iconFor(n) {
  const k = n.icon || "dot";
  return ICON[k] || ICON.dot;
}

function canvasToBuffer(ev) {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width) {
    return { x: 0, y: 0 };
  }
  return {
    x: ((ev.clientX - rect.left) * canvas.width) / rect.width,
    y: ((ev.clientY - rect.top) * canvas.height) / rect.height,
  };
}

/**
 * @param {number} bufX
 * @param {number} bufY
 * @returns {{ x: number; y: number }}
 */
function screenToWorld(bufX, bufY) {
  if (!g) {
    return { x: 0, y: 0 };
  }
  return {
    x: (bufX - g.panX) / g.scale,
    y: (bufY - g.panY) / g.scale,
  };
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {number} lineH
 * @param {number} maxW
 * @param {string} font
 * @param {number} maxLines
 * @returns {string[]}
 */
function buildWrappedLines(ctx, text, lineH, maxW, font, maxLines) {
  ctx.font = font;
  const words = (text || "").split(/\s+/);
  const lines = [];
  let line = "";
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (ctx.measureText(t).width <= maxW || !line) {
      line = t;
    } else {
      lines.push(line);
      line = w;
    }
  }
  if (line) {
    lines.push(line);
  }
  return lines.slice(0, maxLines);
}

/**
 * @param {object[]} simNodes
 * @param {Map<string, { x: number; y: number; vx: number; vy: number }>} pos
 */
function syncPosFromSim(simNodes, pos) {
  for (const sn of simNodes) {
    const s = /** @type {{ id: string; x?: number; y?: number; vx?: number; vy?: number }} */ (sn);
    const x = s.x != null ? s.x : 0;
    const y = s.y != null ? s.y : 0;
    pos.set(s.id, { x, y, vx: s.vx || 0, vy: s.vy || 0 });
  }
}

/**
 * Stronger repulsion for node pairs that do not share an edge (spreads indirect ties apart).
 * @param {Set<string>} adjacentPairs `"idA:idB"` with idA < idB lexicographically
 * @param {number} strengthScale
 * @returns {object}
 */
function forceNonAdjacentRepulse(adjacentPairs, strengthScale) {
  /** @type {object[] | undefined} */
  let nodes;
  function force(alpha) {
    if (!nodes) {
      return;
    }
    const k = strengthScale * alpha;
    const n = nodes.length;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const ni = nodes[i];
        const nj = nodes[j];
        const ai = /** @type {{ id: string }} */ (ni).id;
        const aj = /** @type {{ id: string }} */ (nj).id;
        const pk = String(ai) < String(aj) ? `${ai}:${aj}` : `${aj}:${ai}`;
        if (adjacentPairs.has(pk)) {
          continue;
        }
        let dx = (nj.x || 0) - (ni.x || 0);
        let dy = (nj.y || 0) - (ni.y || 0);
        const dist = Math.sqrt(dx * dx + dy * dy) || 1e-6;
        dx /= dist;
        dy /= dist;
        const rep = k * (1 + 150 / Math.max(dist, 8));
        ni.vx -= dx * rep;
        ni.vy -= dy * rep;
        nj.vx += dx * rep;
        nj.vy += dy * rep;
      }
    }
  }
  force.initialize = function (initNodes) {
    nodes = initNodes;
  };
  return force;
}

/**
 * @param {object[]} rawNodes
 * @param {object[]} rawEdges
 * @param {number} w
 * @param {number} h
 * @returns {{
 *   pos: Map<string, { x: number; y: number; vx: number; vy: number }>;
 *   simulation: object;
 *   simNodes: object[];
 *   idToSim: Map<string, object>;
 * } | null}
 */
function startLiveForceSimulation(rawNodes, rawEdges, w, h) {
  if (typeof d3 === "undefined" || !d3.forceSimulation || !rawNodes.length) {
    return null;
  }
  const n = rawNodes.length;
  const simNodes = rawNodes.map((node, i) => ({
    id: node.id,
    nodeType: node.type || "default",
    x: w / 2 + Math.cos((2 * Math.PI * i) / Math.max(1, n)) * w * 0.34,
    y: h / 2 + Math.sin((2 * Math.PI * i) / Math.max(1, n)) * h * 0.34,
  }));

  const adjacentPairs = new Set();
  for (const e of rawEdges) {
    const a = String(e.from);
    const b = String(e.to);
    const pk = a < b ? `${a}:${b}` : `${b}:${a}`;
    adjacentPairs.add(pk);
  }

  const idSet = new Set(simNodes.map((d) => d.id));
  const linkObjs = rawEdges
    .map((e) => ({ source: e.from, target: e.to }))
    .filter((l) => idSet.has(/** @type {string} */ (l.source)) && idSet.has(/** @type {string} */ (l.target)));

  const idToSim = new Map(simNodes.map((sn) => [sn.id, sn]));

  const pos = new Map();
  syncPosFromSim(simNodes, pos);

  const strengthBody = (d) => CHARGE_BY_TYPE[/** @type {{ nodeType?: string }} */ (d).nodeType] ?? CHARGE_BY_TYPE.default;
  const collideR = (d) =>
    COLLIDE_BY_TYPE[/** @type {{ nodeType?: string }} */ (d).nodeType] ?? COLLIDE_BY_TYPE.default;
  const yTarget = (d) =>
    h / 2 + (Y_BAND_OFFSET[/** @type {{ nodeType?: string }} */ (d).nodeType] ?? Y_BAND_OFFSET.default);

  const simulation = d3
    .forceSimulation(simNodes)
    .velocityDecay(0.34)
    .alphaMin(0.0012)
    .force(
      "link",
      d3
        .forceLink(linkObjs)
        .id((d) => d.id)
        .distance(216)
        .strength(0.52)
    )
    .force("charge", d3.forceManyBody().strength(strengthBody))
    .force("yBand", d3.forceY(yTarget).strength(0.072))
    .force("center", d3.forceCenter(w / 2, h / 2).strength(0.09))
    .force("collide", d3.forceCollide(collideR))
    .force("nonAdjacent", forceNonAdjacentRepulse(adjacentPairs, 2.05));

  return { pos, simulation, simNodes, idToSim };
}

/**
 * @param {object[]} nodes
 * @param {object[]} edges
 * @param {number} w
 * @param {number} h
 * @returns {Map<string, { x: number; y: number; vx: number; vy: number }>}
 */
function layoutFallback(nodes, edges, w, h) {
  const pos = new Map();
  const len = nodes.length;
  const cx = w / 2;
  const cy = h / 2;
  const ring = Math.min(w, h) * LAYOUT_R_BASE;
  nodes.forEach((node, i) => {
    const ang = (2 * Math.PI * i) / Math.max(1, len);
    pos.set(node.id, {
      x: cx + Math.cos(ang) * ring,
      y: cy + Math.sin(ang) * ring,
      vx: 0,
      vy: 0,
    });
  });

  const links = edges.map((e) => ({ s: e.from, t: e.to }));
  const adjacentPairsFb = new Set();
  for (const e of edges) {
    const a = String(e.from);
    const b = String(e.to);
    const pk = a < b ? `${a}:${b}` : `${b}:${a}`;
    adjacentPairsFb.add(pk);
  }
  const margin = 50;
  for (let iter = 0; iter < ITER; iter++) {
    for (const p of pos.values()) {
      p.vx *= 0.9;
      p.vy *= 0.9;
    }
    for (const l of links) {
      const a = pos.get(l.s);
      const b = pos.get(l.t);
      if (!a || !b) {
        continue;
      }
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = (dist - LINK_REST) * 0.018;
      const fx = (dx / dist) * f;
      const fy = (dy / dist) * f;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const ida = nodes[i].id;
        const idb = nodes[j].id;
        const a = pos.get(ida);
        const b = pos.get(idb);
        if (!a || !b) {
          continue;
        }
        const pk = String(ida) < String(idb) ? `${ida}:${idb}` : `${idb}:${ida}`;
        const linked = adjacentPairsFb.has(pk);
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const repMin = linked ? REPULSE_MIN * 0.85 : REPULSE_MIN;
        if (dist < repMin) {
          const f = (repMin - dist) * REPULSE_STRENGTH * (linked ? LINKED_REPULSE_FACTOR : 1);
          const frx = (dx / dist) * f;
          const fry = (dy / dist) * f;
          a.vx -= frx;
          a.vy -= fry;
          b.vx += frx;
          b.vy += fry;
        }
      }
    }
    for (const p of pos.values()) {
      p.x += p.vx;
      p.y += p.vy;
      p.x = Math.max(margin, Math.min(w - margin, p.x));
      p.y = Math.max(margin, Math.min(h - margin, p.y));
    }
    for (const p of pos.values()) {
      p.vx += (cx - p.x) * 0.0004;
      p.vy += (cy - p.y) * 0.0004;
    }
  }
  return pos;
}

function worldBounds() {
  if (!g || !g.pos.size) {
    return null;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of g.pos.values()) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const pad = 120;
  return { minX, minY, maxX, maxY, pad };
}

function fitView() {
  if (!g || !canvas) {
    return;
  }
  const b = worldBounds();
  if (!b) {
    g.panX = canvas.width / 2;
    g.panY = canvas.height / 2;
    g.scale = 0.85;
    return;
  }
  const bw = Math.max(80, b.maxX - b.minX);
  const bh = Math.max(80, b.maxY - b.minY);
  const cxg = (b.minX + b.maxX) / 2;
  const cgy = (b.minY + b.maxY) / 2;
  const s = Math.min(
    (canvas.width - b.pad * 2) / bw,
    (canvas.height - b.pad * 2) / bh,
    1.4
  );
  g.scale = Math.max(0.12, s);
  g.panX = canvas.width / 2 - cxg * g.scale;
  g.panY = canvas.height / 2 - cgy * g.scale;
}

function draw() {
  if (!g || !canvas) {
    return;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }
  const w = canvas.width;
  const h = canvas.height;
  const nodes = g.nodes;
  const edges = g.edges;
  const pos = g.pos;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const panel = getComputedStyle(document.documentElement).getPropertyValue("--panel").trim() || "#151a24";
  ctx.fillStyle = panel;
  ctx.fillRect(0, 0, w, h);

  const { panX, panY, scale } = g;
  ctx.setTransform(scale, 0, 0, scale, panX, panY);

  ctx.strokeStyle = "rgba(180,190,210,0.3)";
  ctx.lineWidth = 1 / scale;
  for (const e of edges) {
    const a = pos.get(e.from);
    const b = pos.get(e.to);
    if (!a || !b) {
      continue;
    }
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  const textColor = getComputedStyle(document.documentElement).getPropertyValue("--text").trim() || "#e6e9ef";
  const labelW = 220;
  const lineH = 12;
  const gapAboveNode = 6;
  const titleFont = "500 10px Inter, system-ui, sans-serif";
  for (const n of nodes) {
    const p = pos.get(n.id);
    if (!p) {
      continue;
    }
    const label = formatNodeLabel(n);
    const titleLines = buildWrappedLines(ctx, label, lineH, labelW, titleFont, 2);
    const blockH = titleLines.length * lineH;
    const bottomY = p.y - NODE_R - gapAboveNode;
    const topY = bottomY - blockH;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    let ty = topY;
    ctx.fillStyle = textColor;
    for (const tl of titleLines) {
      ctx.font = titleFont;
      ctx.fillText(tl, p.x, ty, labelW);
      ty += lineH;
    }
  }

  for (const n of nodes) {
    const p = pos.get(n.id);
    if (!p) {
      continue;
    }
    ctx.beginPath();
    ctx.fillStyle = colorFor(n);
    ctx.globalAlpha = 0.95;
    ctx.arc(p.x, p.y, NODE_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#0e1117";
    ctx.font = `600 ${Math.round(13 / 0.95)}px Inter, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(iconFor(n), p.x, p.y);
  }
}

/**
 * @param {object} node
 * @returns {{ href: string; label: string; isSite: boolean }}
 */
function buildOpenUrl(node) {
  const d = node.data && typeof node.data === "object" ? node.data : {};
  const sub = String(node.sub || "");
  let path = d.profilePath || null;
  const sourceId = String(d.sourceId || "usphonebook_profile").trim() || "usphonebook_profile";
  if (!path && (node.type === "person" || sub.startsWith("person:"))) {
    const rest = sub.startsWith("person:") ? sub.slice(7) : sub;
    if (rest && rest.startsWith("/")) {
      path = rest.split("?")[0];
    }
  }
  if (path && String(path).startsWith("/")) {
    return { href: absoluteUrl(path, sourceId), label: `Open on ${sourceLabelForId(sourceId)}`, isSite: true };
  }
  if (node.type === "phone_number" && sub) {
    const k = sub.replace(/^phone_number:/, "");
    if (k) {
      return { href: `${SITE_BASE}/phone-search/${k}`, label: "Open on USPhoneBook", isSite: true };
    }
  }
  if (node.type === "address" && (d.path || sub.startsWith("address:"))) {
    const ap = d.path || sub.replace(/^address:/, "/");
    if (ap && ap.includes("/")) {
      return { href: `${SITE_BASE}${ap.startsWith("/") ? ap : `/${ap}`}`, label: "Open on USPhoneBook", isSite: true };
    }
  }
  if (node.type === "email") {
    const em = String(d.address || sub.replace(/^email:/, "") || "").trim();
    if (em.includes("@")) {
      return { href: `mailto:${em}`, label: "Open mail client", isSite: false };
    }
  }
  return {
    href: `/api/entity/${encodeURIComponent(node.id)}`,
    label: "View stored record (API)",
    isSite: false,
  };
}

/**
 * @param {object} node
 * @param {number} clientX
 * @param {number} clientY
 */
function showPopup(node, clientX, clientY) {
  if (!nodePopup || !popTitle || !popPrimary || !popOpen || !popHints) {
    return;
  }
  if (node.type === "address") {
    popTitle.textContent = "Address";
    const d = node.data && typeof node.data === "object" ? node.data : {};
    const body = d.graphPopupText || d.formattedFull || formatNodeLabel(node);
    popPrimary.textContent = body;
    popPrimary.style.whiteSpace = "pre-line";
  } else if (node.type === "email") {
    popTitle.textContent = "Email";
    const d = node.data && typeof node.data === "object" ? node.data : {};
    const body = String(d.displayEmail || d.address || formatNodeLabel(node)).trim();
    popPrimary.textContent = body || "—";
    popPrimary.style.whiteSpace = "";
  } else {
    popTitle.textContent = typeHeadline(node.type);
    popPrimary.textContent = formatNodeLabel(node);
    popPrimary.style.whiteSpace = "";
  }

  const hints = relationshipHints(node);
  if (hints.length) {
    popHints.hidden = false;
    popHints.innerHTML = hints.map((h) => `<li>${escapeHint(h)}</li>`).join("");
  } else {
    popHints.innerHTML = "";
    popHints.hidden = true;
  }

  const open = buildOpenUrl(node);
  popOpen.href = open.href;
  popOpen.textContent = open.label;
  if (!open.isSite) {
    popOpen.setAttribute("title", "JSON from this app (same origin)");
  } else {
    popOpen.removeAttribute("title");
  }

  if (popEnrich) {
    const enrichable = node.type === "person" && graphNodeEnrichEntries(node).length > 0;
    popEnrich.hidden = !enrichable;
    popEnrich.disabled = false;
    popEnrich.dataset.nodeId = enrichable ? String(node.id) : "";
  }

  nodePopup.hidden = false;
  if (!viewport) {
    return;
  }
  const r = viewport.getBoundingClientRect();
  let left = clientX - r.left;
  let top = clientY - r.top + 12;
  const pw = 300;
  const ph = 200;
  left = Math.max(8, Math.min(left, r.width - pw - 8));
  top = Math.max(8, Math.min(top, r.height - ph - 8));
  nodePopup.style.left = `${left}px`;
  nodePopup.style.top = `${top}px`;
  nodePopup.style.transform = "none";
}

/**
 * @param {string} s
 */
function escapeHint(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function hidePopup() {
  if (nodePopup) {
    nodePopup.hidden = true;
  }
}

if (popClose) {
  popClose.addEventListener("click", hidePopup);
}
if (popEnrich) {
  popEnrich.addEventListener("click", async () => {
    const nodeId = popEnrich.dataset.nodeId || "";
    if (!nodeId || !g) {
      return;
    }
    const node = g.nodes.find((entry) => String(entry.id) === nodeId);
    if (!node) {
      return;
    }
    const original = popEnrich.textContent;
    popEnrich.disabled = true;
    popEnrich.textContent = "Enriching…";
    try {
      await enrichFromGraphNode(node);
      hidePopup();
      meta.textContent = "Profile enriched from graph and saved to the shared queue. Open Lookup to review details.";
    } catch (error) {
      meta.textContent = error && error.message != null ? error.message : String(error);
      popEnrich.disabled = false;
      popEnrich.textContent = original;
      return;
    }
    popEnrich.textContent = original;
    popEnrich.disabled = false;
  });
}
document.addEventListener("click", (e) => {
  if (!nodePopup || nodePopup.hidden) {
    return;
  }
  if (e.target && nodePopup.contains(/** @type {Node} */ (e.target))) {
    return;
  }
  if (canvas && (e.target === canvas || canvas.contains(/** @type {Node} */ (e.target)))) {
    return;
  }
  hidePopup();
});

/**
 * @type {{ kind: "node"; id: string; startBufX: number; startBufY: number; downWx: number; downWy: number; origX: number; origY: number; moved: boolean; simNode: object | null } | { kind: "pan"; x: number; y: number; startPanX: number; startPanY: number } | null}
 */
let drag = null;

/**
 * @param {object} n
 * @param {Map<string, { x: number; y: number }>} pos
 * @param {number} wx
 * @param {number} wy
 */
function nodeHit(n, pos, wx, wy) {
  const p = pos.get(n.id);
  if (!p) {
    return false;
  }
  const dx = wx - p.x;
  const dy = wy - p.y;
  if (dx * dx + dy * dy <= (NODE_R + 6) * (NODE_R + 6)) {
    return true;
  }
  const labelH = 40;
  const labelW = 115;
  return (
    wx >= p.x - labelW &&
    wx <= p.x + labelW &&
    wy >= p.y - NODE_R - 6 - labelH &&
    wy < p.y - NODE_R
  );
}

function findNodeAt(worldX, worldY) {
  if (!g) {
    return null;
  }
  for (let i = g.nodes.length - 1; i >= 0; i--) {
    if (nodeHit(g.nodes[i], g.pos, worldX, worldY)) {
      return g.nodes[i];
    }
  }
  return null;
}

if (canvas) {
  canvas.addEventListener("mousedown", (ev) => {
    if (ev.button !== 0) {
      return;
    }
    hidePopup();
    if (!g) {
      return;
    }
    const p = canvasToBuffer(ev);
    const w = screenToWorld(p.x, p.y);
    const node = findNodeAt(w.x, w.y);
    if (node) {
      const po = g.pos.get(node.id);
      if (po) {
        const simNode = g.idToSim ? g.idToSim.get(node.id) : null;
        if (simNode && g.simulation) {
          g.simulation.alphaTarget(0.35).restart();
          simNode.fx = w.x;
          simNode.fy = w.y;
        }
        drag = {
          kind: "node",
          id: node.id,
          startBufX: p.x,
          startBufY: p.y,
          downWx: w.x,
          downWy: w.y,
          origX: po.x,
          origY: po.y,
          moved: false,
          simNode: simNode || null,
        };
      }
    } else {
      if (viewport) {
        viewport.classList.add("is-panning");
      }
      drag = {
        kind: "pan",
        x: p.x,
        y: p.y,
        startPanX: g.panX,
        startPanY: g.panY,
      };
    }
  });

  window.addEventListener("mousemove", (ev) => {
    if (!g) {
      return;
    }
    const p = canvasToBuffer(ev);
    if (drag && drag.kind === "node") {
      const w = screenToWorld(p.x, p.y);
      if (Math.hypot(p.x - drag.startBufX, p.y - drag.startBufY) > 4) {
        drag.moved = true;
      }
      if (drag.simNode && g.simulation) {
        drag.simNode.fx = w.x;
        drag.simNode.fy = w.y;
      } else {
        const po = g.pos.get(drag.id);
        if (po) {
          po.x = drag.origX + (w.x - drag.downWx);
          po.y = drag.origY + (w.y - drag.downWy);
          const margin = 30;
          po.x = Math.max(margin, Math.min(canvas.width - margin, po.x));
          po.y = Math.max(margin, Math.min(canvas.height - margin, po.y));
        }
        draw();
      }
    } else if (drag && drag.kind === "pan") {
      g.panX = drag.startPanX + (p.x - drag.x);
      g.panY = drag.startPanY + (p.y - drag.y);
      draw();
    }
  });

  window.addEventListener("mouseup", (ev) => {
    if (ev.button !== 0) {
      return;
    }
    if (drag && drag.kind === "node" && !drag.moved) {
      const p = canvasToBuffer(ev);
      const w = screenToWorld(p.x, p.y);
      const node = findNodeAt(w.x, w.y);
      if (node && node.id === drag.id) {
        setTimeout(() => showPopup(node, ev.clientX, ev.clientY), 0);
      }
    }
    if (drag && drag.kind === "node" && drag.simNode && g && g.simulation) {
      drag.simNode.fx = null;
      drag.simNode.fy = null;
      g.simulation.alphaTarget(0);
    }
    if (viewport) {
      viewport.classList.remove("is-panning");
    }
    drag = null;
  });

  canvas.addEventListener(
    "wheel",
    (ev) => {
      if (!g) {
        return;
      }
      ev.preventDefault();
      const p = canvasToBuffer(ev);
      const w = screenToWorld(p.x, p.y);
      const factor = ev.deltaY > 0 ? 0.9 : 1.1;
      const next = Math.max(0.12, Math.min(3, g.scale * factor));
      g.panX = p.x - w.x * next;
      g.panY = p.y - w.y * next;
      g.scale = next;
      draw();
    },
    { passive: false }
  );
}

async function loadGraph() {
  const res = await fetch("/api/graph");
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

function mountGraphData(data) {
  if (g && g.simulation) {
    g.simulation.stop();
    g.simulation.on("tick", null);
  }
  const nodes = data.nodes || [];
  const edges = data.edges || [];
  const w = canvas.width;
  const h = canvas.height;

  const live = startLiveForceSimulation(nodes, edges, w, h);
  const pos = live
    ? live.pos
    : layoutFallback(nodes, edges, w, h);

  g = {
    nodes,
    edges,
    pos,
    panX: 0,
    panY: 0,
    scale: 0.8,
    simulation: live ? live.simulation : null,
    simNodes: live ? live.simNodes : null,
    idToSim: live ? live.idToSim : null,
    didInitialFit: !live,
  };
  if (live) {
    live.simulation.on("tick", () => {
      if (!g || !g.simNodes) {
        return;
      }
      syncPosFromSim(g.simNodes, g.pos);
      draw();
      if (!g.didInitialFit && live.simulation.alpha() < 0.045) {
        g.didInitialFit = true;
        fitView();
        draw();
      }
    });
    live.simulation.alpha(1).restart();
    draw();
  } else {
    fitView();
    draw();
  }
  const engine = live ? "d3-force (live)" : "static layout";
  meta.textContent = `${nodes.length} nodes · ${edges.length} edges · ${engine} — pan / zoom · drag nodes to pull the graph`;
}

async function refresh() {
  try {
    const data = await loadGraph();
    mountGraphData(data);
    hidePopup();
  } catch (e) {
    meta.textContent = String(e.message || e);
  }
}

/**
 * @returns {Promise<void>}
 */
async function loadAfterQueueSync() {
  let warn = null;
  try {
    await postRebuildFromQueueStorage();
  } catch (e) {
    warn = e && e.message != null ? e.message : String(e);
  }
  await refresh();
  if (warn && meta) {
    const base = meta.textContent || "";
    meta.textContent = `${base} — note: could not post queue to server (${warn})`;
  }
}

if (btnRebuild) {
  btnRebuild.addEventListener("click", loadAfterQueueSync);
}
btnRefresh.addEventListener("click", refresh);
if (btnReset) {
  btnReset.addEventListener("click", () => {
    if (g) {
      fitView();
      draw();
    }
  });
}

refresh();
