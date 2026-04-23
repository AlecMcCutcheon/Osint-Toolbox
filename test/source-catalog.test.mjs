import test from "node:test";
import assert from "node:assert/strict";
import { buildSourceAuditSnapshot } from "../src/sourceCatalog.mjs";

test("buildSourceAuditSnapshot propagates observed usage into source rows", () => {
  const audit = buildSourceAuditSnapshot({
    truepeoplesearch: { entityRefs: 4, cacheRefs: 2, entityTypes: ["phone_number", "person"] },
    assessor_records: { entityRefs: 1, cacheRefs: 6, entityTypes: ["address"] },
  });
  const tps = audit.sources.find((source) => source.id === "truepeoplesearch");
  const assessor = audit.sources.find((source) => source.id === "assessor_records");
  assert.ok(tps);
  assert.equal(tps.observed.entityRefs, 4);
  assert.equal(tps.observed.cacheRefs, 2);
  assert.deepEqual(tps.observed.entityTypes, ["phone_number", "person"]);
  assert.ok(assessor);
  assert.equal(assessor.observed.cacheRefs, 6);
});

test("buildSourceAuditSnapshot exposes roadmap, silos, and browser-automation recommendation", () => {
  const audit = buildSourceAuditSnapshot({});
  assert.ok(Array.isArray(audit.roadmap));
  assert.ok(audit.roadmap.some((item) => item.id === "browser_worker_pool"));
  assert.ok(Array.isArray(audit.silos));
  assert.ok(audit.silos.some((item) => item.id === "browser_queue_truth"));
  const uspb = audit.sources.find((source) => source.id === "usphonebook_phone_search");
  assert.equal(uspb.runtime.label, "FlareSolverr + cheerio parser");
});