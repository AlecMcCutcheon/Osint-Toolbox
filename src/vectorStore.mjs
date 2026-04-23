import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { mkdirSync, existsSync } from "node:fs";

/* Optional: install a vector engine (e.g. `ruvector` if your lockfile ships `dist/`)
 * and set RUVECTOR_ENABLE=1; otherwise this module is a no-op. */

const DIM = 128;
let _db = null;
let _initTried = false;
let _lastError = null;

function getStoragePath() {
  const fromEnv = process.env.RUVECTOR_PATH;
  const base = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "data",
    "ruvector.vectordb"
  );
  return fromEnv ? resolve(fromEnv) : resolve(base);
}

function isEnabled() {
  return String(process.env.RUVECTOR_ENABLE || "0") === "1";
}

/**
 * Deterministic 128-d text fingerprint for later replacement with real embeddings.
 * @param {string} text
 * @returns {Float32Array}
 */
function fakeEmbeddingFromText(text) {
  const h = createHash("sha256").update(text).digest();
  const out = new Float32Array(DIM);
  for (let i = 0; i < DIM; i++) {
    out[i] = (h[i % 32] / 255) * 2 - 1;
  }
  return out;
}

async function getVectorDb() {
  if (!isEnabled() || _initTried) {
    return _db;
  }
  _initTried = true;
  try {
    const mod = await import("ruvector");
    const { VectorDB } = mod;
    const sp = getStoragePath();
    const d = dirname(sp);
    if (!existsSync(d)) {
      mkdirSync(d, { recursive: true });
    }
    _db = new VectorDB({
      dimensions: DIM,
      storagePath: sp,
      distanceMetric: "cosine",
    });
  } catch (e) {
    _lastError = String(e?.message || e);
    _db = null;
  }
  return _db;
}

/**
 * @returns {Promise<{ ok: boolean; path: string | null; error: string | null }>}
 */
export async function getVectorStatus() {
  const path = isEnabled() ? getStoragePath() : null;
  if (!isEnabled()) {
    return { ok: false, path, error: "RUVECTOR_ENABLE!=1" };
  }
  const v = await getVectorDb();
  return {
    ok: Boolean(v),
    path: v ? getStoragePath() : null,
    error: v ? null : _lastError,
  };
}

/**
 * @param {string} entityId
 * @param {string} text
 * @returns {Promise<void>}
 */
export async function indexEntityText(entityId, text) {
  const vdb = await getVectorDb();
  if (!vdb || !text) {
    return;
  }
  const vector = fakeEmbeddingFromText(text);
  const meta = { entityId, text: text.slice(0, 500) };
  try {
    if (typeof vdb.upsert === "function") {
      await vdb.upsert(`ent_${entityId}`, { vector, metadata: meta });
    } else {
      await vdb.insert({ vector, metadata: meta });
    }
  } catch {
    try {
      await vdb.insert({ vector, metadata: { ...meta, id: `ent_${entityId}` } });
    } catch {
      // best-effort; ruvector build may use different method names
    }
  }
}

/**
 * @param {string} text
 * @param {number} k
 * @returns {Promise<Array<{ id: string; score?: number }>>}
 */
export async function searchByText(text, k = 8) {
  const vdb = await getVectorDb();
  if (!vdb) {
    return [];
  }
  const vector = fakeEmbeddingFromText(text);
  try {
    const r = await vdb.search({ vector, k: Math.min(50, k) });
    return (r || []).map((x) => ({
      id: x.id || x.metadata?.entityId,
      score: x.score,
    }));
  } catch {
    return [];
  }
}
