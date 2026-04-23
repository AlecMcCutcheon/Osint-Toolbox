import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseUsPhonebookHtml } from "../src/parseUsPhonebook.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, "..", "test", "fixture-phone-page.html"), "utf8");
const parsed = parseUsPhonebookHtml(html);
if (parsed.currentOwner?.givenName !== "Marci" || parsed.currentOwner?.familyName !== "Mccutcheon") {
  console.error("FAIL", parsed);
  process.exit(1);
}
if (parsed.relatives.length < 1 || !parsed.relatives[0].name.includes("Alec")) {
  console.error("FAIL relatives", parsed.relatives);
  process.exit(1);
}
console.log("parse-selftest OK", JSON.stringify(parsed, null, 2));
