import { addressPresentation } from "./addressFormat.mjs";
import { getDb } from "./db/db.mjs";
import { uniqueProfilePaths } from "./personKey.mjs";

const TYPE_ICON = {
  person: "person",
  phone_number: "phone",
  address: "map",
  email: "mail",
  org: "work",
  enrichment: "info",
  default: "dot",
};

/**
 * @returns {{ nodes: object[]; edges: object[] }}
 */
export function getFullGraph() {
  const db = getDb();
  const rows = db
    .prepare("SELECT id, type, dedupe_key, label, data_json FROM entities")
    .all();
  const nodes = rows.map((r) => {
    let data;
    try {
      data = JSON.parse(r.data_json);
    } catch {
      data = {};
    }
    if (r.type === "address" && data && typeof data === "object") {
      const pres = addressPresentation(data);
      data = { ...data, ...pres };
    }
    if (r.type === "email" && data && typeof data === "object" && data.address) {
      data = { ...data, displayEmail: String(data.address) };
    }
    return {
      id: r.id,
      type: r.type,
      title: r.label || r.dedupe_key,
      sub: r.dedupe_key,
      icon: TYPE_ICON[r.type] || TYPE_ICON.default,
      data,
    };
  });
  const erows = db
    .prepare("SELECT from_id, to_id, kind, meta_json FROM edges")
    .all();
  const edges = erows.map((e, i) => ({
    id: `e${i}`,
    from: e.from_id,
    to: e.to_id,
    label: e.kind,
    meta: (() => {
      try {
        return JSON.parse(e.meta_json || "{}");
      } catch {
        return {};
      }
    })(),
  }));
  return { nodes, edges };
}

/**
 * @param {string} entityId
 * @param {number} depth
 * @returns {{ nodes: object[]; edges: object[] }}
 */
export function getNeighborhood(entityId, depth = 1) {
  if (depth < 1) {
    return { nodes: [], edges: [] };
  }
  const db = getDb();
  const idSet = new Set([entityId]);
  const edgeRows = [];
  for (let d = 0; d < depth; d++) {
    const frontier = [...idSet];
    for (const fid of frontier) {
      const out = db
        .prepare("SELECT * FROM edges WHERE from_id = ? OR to_id = ?")
        .all(fid, fid);
      for (const e of out) {
        edgeRows.push(e);
        idSet.add(e.from_id);
        idSet.add(e.to_id);
      }
    }
  }
  const nodes = [];
  for (const id of idSet) {
    const r = db
      .prepare("SELECT id, type, dedupe_key, label, data_json FROM entities WHERE id = ?")
      .get(id);
    if (r) {
      let data;
      try {
        data = JSON.parse(r.data_json);
      } catch {
        data = {};
      }
      if (r.type === "address" && data && typeof data === "object") {
        const pres = addressPresentation(data);
        data = { ...data, ...pres };
      }
      if (r.type === "email" && data && typeof data === "object" && data.address) {
        data = { ...data, displayEmail: String(data.address) };
      }
      nodes.push({
        id: r.id,
        type: r.type,
        title: r.label || r.dedupe_key,
        sub: r.dedupe_key,
        icon: TYPE_ICON[r.type] || TYPE_ICON.default,
        data,
      });
    }
  }
  const seen = new Set();
  const edges = [];
  for (const e of edgeRows) {
    const k = `${e.from_id}|${e.to_id}|${e.kind}`;
    if (seen.has(k)) {
      continue;
    }
    seen.add(k);
    edges.push({
      id: e.id,
      from: e.from_id,
      to: e.to_id,
      label: e.kind,
    });
  }
  return { nodes, edges };
}

/**
 * @param {string} q
 * @param {number} limit
 * @returns {object[]}
 */
export function searchEntitiesByLabel(q, limit = 20) {
  if (!q || !String(q).trim()) {
    return [];
  }
  const like = `%${String(q).trim().replace(/%/g, "")}%`;
  return getDb()
    .prepare(
      "SELECT id, type, label, dedupe_key FROM entities WHERE label LIKE ? OR dedupe_key LIKE ? LIMIT ?"
    )
    .all(like, like, limit);
}

/**
 * @param {object} data
 * @returns {string[]}
 */
function profilePathsFromPersonData(data) {
  if (!data || typeof data !== "object") {
    return [];
  }
  const alts = Array.isArray(data.alternateProfilePaths) ? data.alternateProfilePaths : [];
  const raw = [data.profilePath, ...alts].filter((x) => x != null && String(x).trim() !== "");
  return uniqueProfilePaths(raw.map((p) => String(p).split("#")[0].trim()));
}

/**
 * Relatives of the line's primary person: everyone linked with `relative` from that primary
 * in the graph, with merged profile paths on each person node.
 * @param {string} dashed
 * @returns {{ primaryPersonId: string | null; relatives: { id: string; name: string; dedupeKey: string; profilePaths: string[] }[] }}
 */
export function getUnifiedRelativesForPhoneDashed(dashed) {
  const d0 = String(dashed || "").trim();
  if (!/^\d{3}-\d{3}-\d{4}$/.test(d0)) {
    return { primaryPersonId: null, relatives: [] };
  }
  const db = getDb();
  const phone = db
    .prepare("SELECT id FROM entities WHERE type = 'phone_number' AND dedupe_key = ?")
    .get(`phone_number:${d0}`);
  if (!phone) {
    return { primaryPersonId: null, relatives: [] };
  }
  const line = db
    .prepare("SELECT to_id AS tid FROM edges WHERE from_id = ? AND kind = 'line_assigned'")
    .get(phone.id);
  if (!line || !line.tid) {
    return { primaryPersonId: null, relatives: [] };
  }
  const primaryId = line.tid;
  const relRows = db
    .prepare("SELECT DISTINCT to_id AS tid FROM edges WHERE from_id = ? AND kind = 'relative'")
    .all(primaryId);
  const relatives = [];
  for (const row of relRows) {
    const pr = db
      .prepare("SELECT id, type, label, dedupe_key, data_json FROM entities WHERE id = ?")
      .get(row.tid);
    if (!pr || pr.type !== "person") {
      continue;
    }
    let data;
    try {
      data = JSON.parse(pr.data_json);
    } catch {
      data = {};
    }
    const name =
      (data.displayName && String(data.displayName).trim()) || pr.label || "Unknown";
    const profilePaths = profilePathsFromPersonData(data);
    if (!profilePaths.length) {
      continue;
    }
    relatives.push({
      id: pr.id,
      name,
      dedupeKey: pr.dedupe_key,
      profilePaths,
    });
  }
  relatives.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  return { primaryPersonId: primaryId, relatives };
}
