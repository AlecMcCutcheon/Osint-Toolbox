import test from "node:test";
import assert from "node:assert/strict";
import { selectAddressPathsFromProfile } from "../src/graphIngestPipeline.mjs";

test("selectAddressPathsFromProfile prefers current address and caps results", () => {
  const paths = selectAddressPathsFromProfile(
    {
      addresses: [
        { path: "/address/old-home", isCurrent: false },
        { path: "/address/current-home", isCurrent: true },
        { path: "/address/second-home", isCurrent: false },
        { path: "/address/third-home", isCurrent: false },
      ],
    },
    2
  );
  assert.deepEqual(paths, ["/address/current-home", "/address/old-home"]);
});

test("selectAddressPathsFromProfile ignores addresses without paths", () => {
  const paths = selectAddressPathsFromProfile({
    addresses: [{ label: "No path" }, { path: "/address/valid-home", isCurrent: true }],
  });
  assert.deepEqual(paths, ["/address/valid-home"]);
});
