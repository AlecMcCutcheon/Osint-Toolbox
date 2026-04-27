import { randomUUID, createHash } from "node:crypto";
import { getDb, nowIso } from "./db/db.mjs";
import { indexEntityText } from "./vectorStore.mjs";
import { addressPresentation } from "./addressFormat.mjs";
import { enrichPhoneNumber } from "./phoneEnrichment.mjs";
import {
  peopleProfileSlugKey,
  peopleProfileSlugKeyLoose,
  personKeyFromNameOnly,
  personKeyFromPath,
  personPathKeySetsForMatch,
  profilePathnameOnly,
  uniqueNames,
  uniqueProfilePaths,
} from "./personKey.mjs";

/**
 * Per rebuild/ingest: profile path string → entity id, so the same person is one row
 * even when one edge uses a path `dedupe_key` and another uses `name:…` or a different string.
 * Reset at the start of each full `rebuildGraphFromQueueItems`.
 * @type {Map<string, string>}
 */
const pathKeyToEntityId = new Map();

/**
 * /people/… profile slug (see peopleProfileSlugKey) → entity id. First-writer wins on conflict.
 * @type {Map<string, string>}
 */
const peopleProfileSlugToEntityId = new Map();

/**
 * @type {Map<string, string>}
 */
const peopleProfileSlugLooseToEntityId = new Map();

/**
 * @returns {void}
 */
export function clearPersonPathKeyIndex() {
  pathKeyToEntityId.clear();
  peopleProfileSlugToEntityId.clear();
  peopleProfileSlugLooseToEntityId.clear();
}

/**
 * @param {string} entityId
 * @param {object} data
 * @returns {void}
 */
function registerPathKeysForPersonData(entityId, data) {
  if (!entityId || !data || typeof data !== "object") {
    return;
  }
  const paths = uniqueProfilePaths([
    data.profilePath,
    ...(Array.isArray(data.alternateProfilePaths) ? data.alternateProfilePaths : []),
  ]);
  for (const raw of paths) {
    if (!raw) {
      continue;
    }
    const k = personKeyFromPath(raw);
    if (k) {
      pathKeyToEntityId.set(k, entityId);
    }
    const sk = peopleProfileSlugKey(raw);
    if (sk) {
      const prev = peopleProfileSlugToEntityId.get(sk);
      if (prev == null || prev === entityId) {
        peopleProfileSlugToEntityId.set(sk, entityId);
      }
    }
    const slk = peopleProfileSlugKeyLoose(raw);
    if (slk) {
      const p2 = peopleProfileSlugLooseToEntityId.get(slk);
      if (p2 == null || p2 === entityId) {
        peopleProfileSlugLooseToEntityId.set(slk, entityId);
      }
    }
  }
}

/**
 * @param {object} data
 * @param {import("better-sqlite3").Database} db
 * @returns {object | null}
 */
function findExistingPersonByPathIndex(data, db) {
  if (!data || typeof data !== "object") {
    return null;
  }
  const paths = uniqueProfilePaths([
    data.profilePath,
    ...(Array.isArray(data.alternateProfilePaths) ? data.alternateProfilePaths : []),
  ]);
  for (const raw of paths) {
    if (!raw) {
      continue;
    }
    const pk = personKeyFromPath(raw);
    if (pk && pathKeyToEntityId.has(pk)) {
      const eid = pathKeyToEntityId.get(pk);
      const ex = eid
        ? /** @type {object | undefined} */ (db.prepare("SELECT * FROM entities WHERE id = ?").get(eid))
        : null;
      if (ex) {
        return ex;
      }
      pathKeyToEntityId.delete(pk);
    }
  }
  for (const raw of paths) {
    if (!raw) {
      continue;
    }
    const sk = peopleProfileSlugKey(raw);
    if (sk && peopleProfileSlugToEntityId.has(sk)) {
      const eid = peopleProfileSlugToEntityId.get(sk);
      const ex = eid
        ? /** @type {object | undefined} */ (db.prepare("SELECT * FROM entities WHERE id = ?").get(eid))
        : null;
      if (ex) {
        return ex;
      }
      peopleProfileSlugToEntityId.delete(sk);
    }
  }
  for (const raw of paths) {
    if (!raw) {
      continue;
    }
    const slk = peopleProfileSlugKeyLoose(raw);
    if (slk && peopleProfileSlugLooseToEntityId.has(slk)) {
      const eid = peopleProfileSlugLooseToEntityId.get(slk);
      const ex = eid
        ? /** @type {object | undefined} */ (db.prepare("SELECT * FROM entities WHERE id = ?").get(eid))
        : null;
      if (ex) {
        return ex;
      }
      peopleProfileSlugLooseToEntityId.delete(slk);
    }
  }
  return null;
}

/**
 * In-memory index can miss (different href shapes); scan SQLite for any person whose stored URLs
 * overlap incoming path / slug / loose-slug sets.
 * @param {object} data
 * @param {import("better-sqlite3").Database} db
 * @returns {object | null}
 */
function findExistingPersonInDbByPathOverlap(data, db) {
  const inc = personPathKeySetsForMatch(data);
  if (!inc.pathKeys.size && !inc.slugStrict.size && !inc.slugLoose.size) {
    return null;
  }
  const rows = db.prepare("SELECT * FROM entities WHERE type = 'person'").all();
  for (const row of rows) {
    let d;
    try {
      d = JSON.parse(/** @type {{ data_json: string }} */ (row).data_json);
    } catch {
      continue;
    }
    if (!d || typeof d !== "object") {
      continue;
    }
    const ex = personPathKeySetsForMatch(d);
    if (setOverlap(inc.pathKeys, ex.pathKeys)) {
      return row;
    }
    if (setOverlap(inc.slugStrict, ex.slugStrict)) {
      return row;
    }
    if (inc.slugLoose.size && ex.slugLoose.size && setOverlap(inc.slugLoose, ex.slugLoose)) {
      return row;
    }
  }
  return null;
}

/**
 * @param {Set<string>} a
 * @param {Set<string>} b
 * @returns {boolean}
 */
function setOverlap(a, b) {
  for (const x of a) {
    if (b.has(x)) {
      return true;
    }
  }
  return false;
}

/**
 * @param {unknown} a
 * @param {unknown} b
 * @returns {string[]}
 */
function shallowNewKeys(a, b) {
  if (!a || typeof a !== "object" || !b || typeof b !== "object") {
    return [];
  }
  const pa = a;
  const out = [];
  for (const k of Object.keys(b)) {
    if (!(k in pa) || JSON.stringify(pa[k]) !== JSON.stringify(b[k])) {
      out.push(k);
    }
  }
  return out;
}

/**
 * @param {object} data
 * @returns {string}
 */
function hashData(data) {
  return createHash("sha256").update(JSON.stringify(data)).digest("hex");
}

/**
 * @param {string} type
 * @param {string} key
 * @param {string} label
 * @param {object} data
 * @param {string | null} sourceRunId
 * @returns {{ id: string; newFieldKeys: string[] }}
 */
function upsertEntity(type, key, label, data, sourceRunId) {
  const db = getDb();
  const dedupeKey = `${type}:${key}`;

  let existing = null;
  if (type === "person" && data) {
    const byIndex = findExistingPersonByPathIndex(data, db);
    if (byIndex) {
      existing = byIndex;
    }
  }
  if (!existing) {
    existing = db.prepare("SELECT * FROM entities WHERE dedupe_key = ?").get(dedupeKey) || null;
  }
  if (type === "person" && data && !existing) {
    const fromDb = findExistingPersonInDbByPathOverlap(data, db);
    if (fromDb) {
      existing = fromDb;
    }
  }

  const id = existing?.id || randomUUID();
  let nextData = data;
  if (type === "person" && existing) {
    const prev = JSON.parse(existing.data_json);
    nextData = mergePersonRecord(prev, data);
  }
  const nextHash = hashData(nextData);
  const t = nowIso();
  if (existing) {
    const prev = JSON.parse(existing.data_json);
    const newFieldKeys = shallowNewKeys(prev, nextData);
    db.prepare("INSERT INTO merge_snapshots (entity_id, data_json, source_run_id, created_at) VALUES (?, ?, ?, ?)").run(
      id,
      existing.data_json,
      sourceRunId,
      t
    );
    db.prepare(
      `UPDATE entities SET label = COALESCE(?, label), data_json = ?, data_hash = ?, updated_at = ? WHERE id = ?`
    ).run(label || null, JSON.stringify(nextData), nextHash, t, id);
    if (type === "person") {
      registerPathKeysForPersonData(id, nextData);
    }
    return { id, newFieldKeys };
  }
  db.prepare(
    `INSERT INTO entities (id, type, dedupe_key, label, data_json, data_hash, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    type,
    dedupeKey,
    label,
    JSON.stringify(nextData),
    nextHash,
    t,
    t
  );
  if (type === "person") {
    registerPathKeysForPersonData(id, nextData);
  }
  return { id, newFieldKeys: Object.keys(nextData) };
}

/**
 * @param {string} from
 * @param {string} to
 * @param {string} kind
 * @param {object} [meta]
 * @returns {void}
 */
/**
 * @param {object} prev
 * @param {object} next
 * @returns {object}
 */
export function mergePersonRecord(prev, next) {
  if (!next || typeof next !== "object") {
    return { ...prev };
  }
  if (!prev || typeof prev !== "object") {
    return { ...next };
  }
  const a = (x) => (Array.isArray(x) ? x : []);
  const nameParts = [
    ...a(prev.aliases),
    ...a(next.aliases),
    prev.displayName,
    next.displayName,
    [prev.givenName, prev.familyName].filter(Boolean).join(" ").trim(),
    [next.givenName, next.familyName].filter(Boolean).join(" ").trim(),
  ];
  const aliases = uniqueNames(nameParts);
  const pathCandidates = uniqueProfilePaths([
    prev.profilePath,
    next.profilePath,
    ...a(prev.alternateProfilePaths),
    ...a(next.alternateProfilePaths),
  ]);
  const primary = next.profilePath
    ? String(next.profilePath).split("#")[0].trim()
    : prev.profilePath
      ? String(prev.profilePath).split("#")[0].trim()
      : pathCandidates[0] || null;
  const primaryKey = personKeyFromPath(primary || "");
  const alternates = pathCandidates.filter(
    (p) => p && personKeyFromPath(p) && personKeyFromPath(p) !== primaryKey
  );
  return {
    ...prev,
    ...next,
    displayName: next.displayName || prev.displayName,
    givenName: next.givenName != null && next.givenName !== "" ? next.givenName : prev.givenName,
    familyName: next.familyName != null && next.familyName !== "" ? next.familyName : prev.familyName,
    profilePath: primary,
    aliases,
    alternateProfilePaths: uniqueProfilePaths(alternates),
  };
}

function addEdgeIfMissing(from, to, kind, meta = {}) {
  const db = getDb();
  const existing = db
    .prepare("SELECT id FROM edges WHERE from_id = ? AND to_id = ? AND kind = ?")
    .get(from, to, kind);
  if (existing) {
    return false;
  }
  const id = randomUUID();
  const t = nowIso();
  db.prepare(
    `INSERT INTO edges (id, from_id, to_id, kind, meta_json, created_at) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, from, to, kind, JSON.stringify(meta), t);
  return true;
}

/**
 * @param {string} path
 * @returns {string}
 */
function normPath(path) {
  return profilePathnameOnly(path);
}

/**
 * One person row per normalized display name when the name is known; all profile URL variants go in
 * `data_json` instead of separate `dedupe_key`s (avoids duplicate graph nodes for obfuscated/dual hrefs).
 * Falls back to {@link personKeyFromPath} when the name is missing or "unknown".
 * @param {string} displayName
 * @param {string} pathKey personKeyFromPath(path) or ""
 * @returns {string}
 */
function personDedupeKeyPreferName(displayName, pathKey) {
  const raw =
    displayName != null ? String(displayName).replace(/\s*,\s*$/g, "").trim() : "";
  const nk = raw ? personKeyFromNameOnly(raw) : "";
  if (nk && nk !== "unknown") {
    return `name:${nk}`;
  }
  return pathKey || "";
}

/**
 * Resolves a related person. Stored under a name-first `dedupe_key` when the name is known; profile
 * paths are merged into one row (see `personDedupeKeyPreferName`).
 * @param {string} name
 * @param {string} path
 * @param {string | null} sourceRun
 * @param {Record<string, string[]>} byEntity
 * @param {string[] | undefined} alternateProfilePaths
 */
function personFromNamePath(name, path, sourceRun, byEntity, alternateProfilePaths, source = "relative_name") {
  const n = name != null ? String(name).replace(/\s*,\s*$/g, "").trim() : "";
  const fromRel = [path, ...(Array.isArray(alternateProfilePaths) ? alternateProfilePaths : [])]
    .filter((x) => x != null && String(x).trim() !== "");
  const pathsU = uniqueProfilePaths(fromRel.map((x) => String(x).split("#")[0].trim()));
  if (!n && !pathsU.length) {
    return null;
  }
  const p = pathsU[0] ? profilePathnameOnly(pathsU[0]) : "";
  const alts = pathsU.length > 1 ? pathsU.slice(1) : [];
  const pathKey = p ? personKeyFromPath(p) : "";
  const key = personDedupeKeyPreferName(n, pathKey);
  if (!key) {
    return null;
  }
  const u = upsertEntity(
    "person",
    key,
    n || p,
    {
      displayName: n || p,
      profilePath: p || null,
      ...(alts.length ? { alternateProfilePaths: alts } : {}),
      givenName: "",
      familyName: "",
      aliases: n ? [n] : [],
      source,
    },
    sourceRun
  );
  if (u.newFieldKeys.length) {
    byEntity[u.id] = (byEntity[u.id] || []).concat(u.newFieldKeys);
  }
  return u.id;
}

/**
 * @param {string} dashed
 * @param {object | null | undefined} data
 * @param {string} source
 * @returns {object}
 */
function buildPhoneEntityData(dashed, data, source) {
  const phoneMetadata = data?.phoneMetadata || enrichPhoneNumber(data?.dashed || dashed);
  return {
    ...(data && typeof data === "object" ? data : {}),
    dashed,
    e164Style: phoneMetadata?.e164 || dashed,
    phoneMetadata,
    externalSources: data?.externalSources || null,
    source: data?.source || source,
  };
}

/**
 * @param {{ personId: string; factType: "phone" | "address" | "email"; phone?: { dashed?: string; display?: string; isCurrent?: boolean; phoneMetadata?: object | null }; address?: { normalizedKey?: string; formattedFull?: string; label?: string; path?: string | null; isCurrent?: boolean } | null; email?: string | null; source?: string | null }} input
 * @returns {{ runId: string; personId: string; entityId: string; edgeKind: string; created: boolean; alreadyAssigned: boolean }}
 */
export function assignFactToPerson(input) {
  const personId = String(input?.personId || "").trim();
  if (!personId) {
    throw new Error("personId is required");
  }
  const db = getDb();
  const person = db.prepare("SELECT id, type, label FROM entities WHERE id = ?").get(personId);
  if (!person || person.type !== "person") {
    throw new Error("person not found");
  }
  const runId = randomUUID();
  const source = String(input?.source || "manual_assignment").trim() || "manual_assignment";
  if (input.factType === "phone") {
    const dashed = String(input?.phone?.dashed || "").trim();
    if (!dashed) {
      throw new Error("phone.dashed is required");
    }
    const phoneEntity = upsertEntity(
      "phone_number",
      dashed,
      `Phone ${dashed}`,
      buildPhoneEntityData(dashed, { ...(input.phone || {}), source }, source),
      runId
    );
    const created = addEdgeIfMissing(personId, phoneEntity.id, "has_phone", {
      current: input?.phone?.isCurrent === true,
      from: source,
      manual: true,
    });
    void indexEntityText(phoneEntity.id, dashed);
    return {
      runId,
      personId,
      entityId: phoneEntity.id,
      edgeKind: "has_phone",
      created,
      alreadyAssigned: !created,
    };
  }
  if (input.factType === "address") {
    const address = input?.address && typeof input.address === "object" ? input.address : null;
    const normalizedKey = String(address?.normalizedKey || "").trim();
    if (!normalizedKey) {
      throw new Error("address.normalizedKey is required");
    }
    const pres = addressPresentation(address || {});
    const addrRow = { ...(address || {}), ...pres, source };
    const addressEntity = upsertEntity(
      "address",
      normalizedKey,
      pres.formattedFull || address?.label || normalizedKey,
      addrRow,
      runId
    );
    const created = addEdgeIfMissing(personId, addressEntity.id, "at_address", {
      current: address?.isCurrent === true,
      from: source,
      manual: true,
    });
    void indexEntityText(addressEntity.id, `${pres.formattedFull || address?.label || normalizedKey}`);
    return {
      runId,
      personId,
      entityId: addressEntity.id,
      edgeKind: "at_address",
      created,
      alreadyAssigned: !created,
    };
  }
  if (input.factType === "email") {
    const email = String(input?.email || "").trim().toLowerCase();
    if (!email || !email.includes("@")) {
      throw new Error("valid email is required");
    }
    const emailEntity = upsertEntity(
      "email",
      email,
      email,
      { kind: "email", address: email, source },
      runId
    );
    const created = addEdgeIfMissing(personId, emailEntity.id, "has_email", {
      from: source,
      manual: true,
    });
    void indexEntityText(emailEntity.id, email);
    return {
      runId,
      personId,
      entityId: emailEntity.id,
      edgeKind: "has_email",
      created,
      alreadyAssigned: !created,
    };
  }
  throw new Error("unsupported factType");
}

/**
 * Ingests structured phone-search parse into entities and edges.
 * @param {object} parsed
 * @param {string} dashed
 * @param {string} [sourceRunId]
 * @returns {{
 *   runId: string;
 *   phoneId: string;
 *   newFieldsByEntity: Record<string, string[]>;
 *   linkedIds: { phone: string; primaryPerson: string | null; relatives: string[] };
 * }}
 */
export function ingestPhoneSearchParsed(parsed, dashed, sourceRunId) {
  const runId = sourceRunId || randomUUID();
  const byEntity = /** @type {Record<string, string[]>} */ ({});

  const phoneE = upsertEntity(
    "phone_number",
    dashed,
    `Phone ${dashed}`,
    buildPhoneEntityData(
      dashed,
      {
        phoneMetadata: parsed?.lookupPhoneMetadata,
        externalSources: parsed?.externalSources || null,
      },
      "phone_search"
    ),
    runId
  );
  if (phoneE.newFieldKeys.length) {
    byEntity[phoneE.id] = (byEntity[phoneE.id] || []).concat(phoneE.newFieldKeys);
  }
  const phoneId = phoneE.id;
  void indexEntityText(phoneId, `phone ${dashed}`);

  let primaryId = null;
  if (parsed.profilePath) {
    const p = normPath(parsed.profilePath);
    const n =
      parsed.currentOwner?.displayName ||
      [parsed.currentOwner?.givenName, parsed.currentOwner?.familyName].filter(Boolean).join(" ").trim() ||
      "Unknown";
    const pKey = personDedupeKeyPreferName(n, personKeyFromPath(p));
    const personData = {
      displayName: n,
      givenName: parsed.currentOwner?.givenName || "",
      familyName: parsed.currentOwner?.familyName || "",
      profilePath: p,
      fullAddressTeaser: parsed.fullAddressTeaser,
      source: "phone_search",
    };
    const u = upsertEntity("person", pKey, n, personData, runId);
    if (u.newFieldKeys.length) {
      byEntity[u.id] = (byEntity[u.id] || []).concat(u.newFieldKeys);
    }
    primaryId = u.id;
    addEdgeIfMissing(phoneId, primaryId, "line_assigned", { from: "phone_search" });
    void indexEntityText(primaryId, `${n} ${p}`);
  }

  const relIdSet = new Set();
  for (const r of parsed.relatives || []) {
    const id = personFromNamePath(
      r.name,
      r.path,
      runId,
      byEntity,
      Array.isArray(r.alternateProfilePaths) ? r.alternateProfilePaths : undefined
    );
    if (id) {
      relIdSet.add(id);
      if (primaryId) {
        addEdgeIfMissing(primaryId, id, "relative", { from: "phone_search" });
      }
    }
  }
  const relIds = Array.from(relIdSet);

  for (const [eid, keys] of Object.entries(byEntity)) {
    const label = getDb().prepare("SELECT label FROM entities WHERE id = ?").get(eid)?.label || "";
    void indexEntityText(eid, `${label} ${keys.join(" ")}`);
  }

  return {
    runId,
    phoneId,
    newFieldsByEntity: byEntity,
    linkedIds: {
      phone: phoneId,
      primaryPerson: primaryId,
      relatives: relIds,
    },
  };
}

/**
 * @param {object} profilePayload
 * @param {string} contextPhoneDashed
 * @param {string} [sourceRunId]
 * @returns {{ runId: string; newFieldsByEntity: Record<string, string[]>; personId: string | null }}
 */
export function ingestProfileParsed(profilePayload, contextPhoneDashed, sourceRunId) {
  const runId = sourceRunId || randomUUID();
  const byEntity = /** @type {Record<string, string[]>} */ ({});
  const pPath = profilePayload.profilePath
    ? normPath(profilePayload.profilePath)
    : null;
  const display = profilePayload.displayName || "Unknown";
  if (!pPath) {
    return { runId, newFieldsByEntity: {}, personId: null };
  }
  const pKey = personDedupeKeyPreferName(display, personKeyFromPath(pPath));
  const payloadAliases = uniqueNames([...(Array.isArray(profilePayload.aliases) ? profilePayload.aliases : []), display]);
  const u = upsertEntity(
    "person",
    pKey,
    display,
    { ...profilePayload, profilePath: pPath, aliases: payloadAliases, source: "profile_page" },
    runId
  );
  if (u.newFieldKeys.length) {
    byEntity[u.id] = u.newFieldKeys;
  }
  void indexEntityText(u.id, `${display} ${pPath} ${(profilePayload.aliases || []).join(" ")}`);
  if (contextPhoneDashed) {
    const ph = getDb()
      .prepare("SELECT id FROM entities WHERE dedupe_key = ?")
      .get(`phone_number:${contextPhoneDashed}`);
    if (ph) {
      addEdgeIfMissing(ph.id, u.id, "profile_from_phone_context", { runId });
    }
  }
  for (const addr of profilePayload.addresses || []) {
    if (!addr.normalizedKey) {
      continue;
    }
    const pres = addressPresentation(addr);
    const addrRow = { ...addr, ...pres };
    const a = upsertEntity(
      "address",
      addr.normalizedKey,
      pres.formattedFull || addr.label || addr.normalizedKey,
      addrRow,
      runId
    );
    if (a.newFieldKeys.length) {
      byEntity[a.id] = (byEntity[a.id] || []).concat(a.newFieldKeys);
    }
    addEdgeIfMissing(u.id, a.id, "at_address", { current: Boolean(addr.isCurrent) });
  }
  for (const ph of profilePayload.phones || []) {
    if (!ph.dashed) {
      continue;
    }
    const pe = upsertEntity(
      "phone_number",
      ph.dashed,
      `Phone ${ph.dashed}`,
      buildPhoneEntityData(ph.dashed, ph, "profile_page"),
      runId
    );
    if (pe.newFieldKeys.length) {
      byEntity[pe.id] = (byEntity[pe.id] || []).concat(pe.newFieldKeys);
    }
    addEdgeIfMissing(u.id, pe.id, "has_phone", { current: Boolean(ph.isCurrent) });
  }
  for (const rawEm of profilePayload.emails || []) {
    const emStr =
      typeof rawEm === "string"
        ? rawEm.trim().toLowerCase()
        : rawEm != null
          ? String(rawEm).trim().toLowerCase()
          : "";
    if (!emStr || !emStr.includes("@")) {
      continue;
    }
    const em = upsertEntity(
      "email",
      emStr,
      emStr,
      { kind: "email", address: emStr, source: "profile_page" },
      runId
    );
    if (em.newFieldKeys.length) {
      byEntity[em.id] = (byEntity[em.id] || []).concat(em.newFieldKeys);
    }
    addEdgeIfMissing(u.id, em.id, "has_email", {});
    void indexEntityText(em.id, emStr);
  }
  for (const rel of profilePayload.relatives || []) {
    if (!rel.path) {
      continue;
    }
    const rid = personFromNamePath(
      rel.name,
      rel.path,
      runId,
      byEntity,
      Array.isArray(rel.alternateProfilePaths) ? rel.alternateProfilePaths : undefined
    );
    if (rid) {
      addEdgeIfMissing(u.id, rid, "relative", { from: "profile" });
    }
  }
  return { runId, newFieldsByEntity: byEntity, personId: u.id };
}

/**
 * @param {object} addressDocumentPayload
 * @param {string} [sourceRunId]
 * @returns {{ runId: string; newFieldsByEntity: Record<string, string[]>; addressId: string | null; residentIds: string[]; businessIds: string[] }}
 */
export function ingestAddressDocumentParsed(addressDocumentPayload, sourceRunId) {
  const runId = sourceRunId || randomUUID();
  const byEntity = /** @type {Record<string, string[]>} */ ({});
  const address = addressDocumentPayload?.address && typeof addressDocumentPayload.address === "object"
    ? addressDocumentPayload.address
    : null;
  if (!address?.normalizedKey) {
    return { runId, newFieldsByEntity: byEntity, addressId: null, residentIds: [], businessIds: [] };
  }

  const pres = addressPresentation(address);
  const addressRow = { ...address, ...pres, source: "address_document" };
  const addrEntity = upsertEntity(
    "address",
    address.normalizedKey,
    pres.formattedFull || address.label || address.normalizedKey,
    addressRow,
    runId
  );
  if (addrEntity.newFieldKeys.length) {
    byEntity[addrEntity.id] = (byEntity[addrEntity.id] || []).concat(addrEntity.newFieldKeys);
  }
  void indexEntityText(addrEntity.id, `${pres.formattedFull || address.label || address.normalizedKey} ${address.normalizedKey}`);

  const residentIds = [];
  const residentIdSet = new Set();
  for (const resident of Array.isArray(addressDocumentPayload?.residents) ? addressDocumentPayload.residents : []) {
    const residentId = personFromNamePath(
      resident?.name,
      resident?.path,
      runId,
      byEntity,
      Array.isArray(resident?.alternateProfilePaths) ? resident.alternateProfilePaths : undefined,
      "address_document"
    );
    if (!residentId || residentIdSet.has(residentId)) {
      continue;
    }
    residentIdSet.add(residentId);
    residentIds.push(residentId);
    addEdgeIfMissing(residentId, addrEntity.id, "at_address", {
      current: resident?.isCurrent === true,
      from: "address_document",
      role: resident?.role || "resident",
    });
  }
  for (let i = 0; i < residentIds.length; i += 1) {
    for (let j = i + 1; j < residentIds.length; j += 1) {
      addEdgeIfMissing(residentIds[i], residentIds[j], "co_resident", { addressId: addrEntity.id, from: "address_document" });
      addEdgeIfMissing(residentIds[j], residentIds[i], "co_resident", { addressId: addrEntity.id, from: "address_document" });
    }
  }

  const businessIds = [];
  for (const business of Array.isArray(addressDocumentPayload?.businesses) ? addressDocumentPayload.businesses : []) {
    const name = business?.name != null ? String(business.name).trim() : "";
    if (!name) {
      continue;
    }
    const businessKey = `${name.toLowerCase()}@${address.normalizedKey}`;
    const businessEntity = upsertEntity(
      "organization",
      businessKey,
      name,
      {
        displayName: name,
        category: business?.category || null,
        website: business?.website || null,
        path: business?.path || null,
        source: "address_document",
      },
      runId
    );
    if (businessEntity.newFieldKeys.length) {
      byEntity[businessEntity.id] = (byEntity[businessEntity.id] || []).concat(businessEntity.newFieldKeys);
    }
    businessIds.push(businessEntity.id);
    addEdgeIfMissing(businessEntity.id, addrEntity.id, "at_address", { from: "address_document", role: "business" });
    void indexEntityText(businessEntity.id, `${name} ${business?.category || ""}`);

    for (const phone of Array.isArray(business?.phones) ? business.phones : []) {
      if (!phone?.dashed) {
        continue;
      }
      const phoneEntity = upsertEntity(
        "phone_number",
        phone.dashed,
        `Phone ${phone.dashed}`,
        buildPhoneEntityData(phone.dashed, phone, "address_document"),
        runId
      );
      if (phoneEntity.newFieldKeys.length) {
        byEntity[phoneEntity.id] = (byEntity[phoneEntity.id] || []).concat(phoneEntity.newFieldKeys);
      }
      addEdgeIfMissing(businessEntity.id, phoneEntity.id, "has_phone", { current: phone?.isCurrent === true, from: "address_document" });
    }
  }

  return {
    runId,
    newFieldsByEntity: byEntity,
    addressId: addrEntity.id,
    residentIds,
    businessIds,
  };
}
