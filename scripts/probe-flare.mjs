import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: process.env.DOTENV_PATH || resolve(__dirname, "..", ".env") });

const base = (process.env.FLARE_BASE_URL || "http://127.0.0.1:8191").replace(/\/$/, "");
let res;
let text;
try {
  res = await fetch(`${base}/v1`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cmd: "sessions.list" }),
    signal: AbortSignal.timeout(15000),
  });
  text = await res.text();
} catch (e) {
  console.error("FLARE_BASE_URL:", base);
  console.error("Request failed:", e.cause?.message || e.message || e);
  console.error(
    "If this is a Docker internal IP (e.g. 172.19.x.x), use the host LAN IP and published port 8191 instead."
  );
  process.exit(1);
}
let data;
try {
  data = JSON.parse(text);
} catch {
  data = { raw: text };
}
console.log("FLARE_BASE_URL:", base);
console.log("HTTP:", res.status, res.ok ? "ok" : "fail");
console.log(JSON.stringify(data, null, 2));
const ok = res.ok && data.status !== "error";
process.exit(ok ? 0 : 1);
