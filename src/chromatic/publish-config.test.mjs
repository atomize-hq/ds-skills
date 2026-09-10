import { expect, it } from "vitest";
import { readChromaticPublish } from "../project/chromatic-publish-config.mjs";
const valid = {
  provider: "chromatic-node-v15",
  buildDir: "static",
  tokenEnv: "REVIEW_TOKEN",
  repository: "example/ui",
  timeoutSeconds: 600,
  mode: "review",
};
it("normalizes optional publication configuration", () => {
  expect(readChromaticPublish(null, "/tmp")).toBe(null);
  expect(readChromaticPublish(valid, "/tmp").buildDir).toBe("/tmp/static");
});
it.each([
  { provider: "latest" },
  { buildDir: "../escape" },
  { buildDir: "  static" },
  { tokenEnv: "bad-key" },
  { repository: "../ui" },
  { repository: "a/b/c" },
  { timeoutSeconds: 0 },
  { timeoutSeconds: 1.1 },
  { timeoutSeconds: 3601 },
  { mode: "passed" },
  { command: "arbitrary" },
])("rejects invalid publication input %j", (partial) => {
  expect(() =>
    readChromaticPublish({ ...valid, ...partial }, "/tmp"),
  ).toThrow();
});
