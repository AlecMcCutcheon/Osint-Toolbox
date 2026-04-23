const inflight = new Map();

/**
 * While `work()` is in flight for `key`, additional callers await the same promise
 * (one upstream fetch / Flare run instead of N).
 * @template T
 * @param {string} key
 * @param {() => Promise<T>} work
 * @returns {Promise<T>}
 */
export function dedupeInflight(key, work) {
  const existing = inflight.get(key);
  if (existing) {
    return existing;
  }
  const p = work().finally(() => {
    if (inflight.get(key) === p) {
      inflight.delete(key);
    }
  });
  inflight.set(key, p);
  return p;
}
