import { expect, it } from "vitest";
import { checkComponentReport } from "./report-io.mjs";
const now = new Date("2026-09-09T12:00:00.000Z");
const expected = {
  statusVersion: "3",
  scope: "configured-component-evidence",
  generatedAt: now.toISOString(),
  revision: "a".repeat(40),
  inputDigest: "b".repeat(64),
  evidence: {},
  policies: {},
};
const check = (data) =>
  checkComponentReport(
    Buffer.from(JSON.stringify(data)),
    expected,
    { maxAgeMinutes: 60 },
    { now },
  );
it("checks current derived content separately from report time", () => {
  expect(check(expected).ok).toBe(true);
});
it.each([
  null,
  [],
  {},
  { ...expected, extra: true },
  { ...expected, statusVersion: "2" },
  { ...expected, revision: "c".repeat(40) },
  { ...expected, inputDigest: "d".repeat(64) },
  { ...expected, generatedAt: "2026-09-09T13:00:00.000Z" },
  { ...expected, generatedAt: "2026-02-30T12:00:00.000Z" },
  { ...expected, generatedAt: "2026-09-09T10:00:00.000Z" },
  { ...expected, generatedAt: null },
])("rejects malformed, forged or stale report", (data) => {
  expect(check(data).ok).toBe(false);
});
it("rejects missing and malformed JSON explicitly", () => {
  expect(
    checkComponentReport(null, expected, { maxAgeMinutes: 60 }, { now }).ok,
  ).toBe(false);
  expect(
    checkComponentReport(
      Buffer.from("broken"),
      expected,
      { maxAgeMinutes: 60 },
      { now },
    ).ok,
  ).toBe(false);
});
