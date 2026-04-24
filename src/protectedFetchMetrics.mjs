const MAX_EVENTS = Math.max(20, Number(process.env.PROTECTED_FETCH_METRICS_MAX || 200));

/** @type {Array<Record<string, any>>} */
const events = [];

/**
 * @param {Record<string, any>} event
 */
export function recordProtectedFetchEvent(event) {
  const item = {
    at: new Date().toISOString(),
    ...event,
  };
  events.push(item);
  if (events.length > MAX_EVENTS) {
    events.splice(0, events.length - MAX_EVENTS);
  }
  return item;
}

export function listProtectedFetchEvents(limit = 20) {
  const n = Math.max(1, Math.min(Number(limit) || 20, MAX_EVENTS));
  return events.slice(-n).reverse();
}

function median(values) {
  const xs = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!xs.length) {
    return null;
  }
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 === 0 ? Math.round((xs[mid - 1] + xs[mid]) / 2) : xs[mid];
}

export function getProtectedFetchHealth() {
  const recent = listProtectedFetchEvents(50);
  const total = recent.length;
  const challenge = recent.filter((x) => x.status === "challenge_required" || x.challengeDetected === true).length;
  const ok = recent.filter((x) => x.status === "ok").length;
  const failed = recent.filter((x) => x.status === "error").length;
  const timedOut = recent.filter((x) => x.status === "timeout").length;
  const durations = recent.map((x) => Number(x.durationMs)).filter(Number.isFinite);
  const challengeRate = total ? Number((challenge / total).toFixed(3)) : null;
  const successRate = total ? Number((ok / total).toFixed(3)) : null;
  let trustState = "unknown";
  if (total > 0) {
    if ((challengeRate != null && challengeRate >= 0.5) || (successRate != null && successRate < 0.35)) {
      trustState = "poor";
    } else if ((challengeRate != null && challengeRate >= 0.2) || (successRate != null && successRate < 0.7)) {
      trustState = "degrading";
    } else {
      trustState = "healthy";
    }
  }
  return {
    trustState,
    total,
    ok,
    failed,
    timedOut,
    challenge,
    successRate,
    challengeRate,
    medianDurationMs: median(durations),
    lastEventAt: recent[0]?.at || null,
    recent,
  };
}
