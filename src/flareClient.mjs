import "./env.mjs";
const DEFAULT_FLARE = "http://127.0.0.1:8191";

/**
 * @param {object} payload FlareSolverr /v1 JSON body
 * @param {{ baseUrl?: string }} [opts]
 * @returns {Promise<object>}
 */
export async function flareV1(payload, opts = {}) {
  const baseUrl = (opts.baseUrl || process.env.FLARE_BASE_URL || DEFAULT_FLARE).replace(
    /\/$/,
    ""
  );
  const res = await fetch(`${baseUrl}/v1`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`FlareSolverr returned non-JSON (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    const msg = data?.message || data?.error || text;
    throw new Error(`FlareSolverr HTTP ${res.status}: ${msg}`);
  }
  if (data.status === "error") {
    throw new Error(data.message || "FlareSolverr status error");
  }
  return data;
}
