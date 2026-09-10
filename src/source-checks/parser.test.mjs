import { expect, it } from "vitest";
import { parseContractSource } from "./contract-parser.mjs";
const parse = (s) => parseContractSource(s, "component.tsx");
it("handles inline/list/default exports, aliases, and type distinction", () => {
  const r = parse(
    "interface T{}; const A=1; export {type T,A as B}; export const C=2,D=3; export default function Named(){}",
  );
  expect(new Map(r.exports)).toEqual(
    new Map([
      ["T", "type"],
      ["B", "value"],
      ["C", "value"],
      ["D", "value"],
      ["default", "value"],
    ]),
  );
});
it("finds quoted JSX literal slots and expression literals but not comments or JSX prose", () => {
  const r = parse(
    `// data-slot="fake"\nconst x=<div data-slot={'item'}>[data-slot=prose]</div>; const c='[data-slot="item"]';`,
  );
  expect(r.declared).toEqual(["item"]);
  expect(r.selected).toEqual(["item"]);
});
it("does not count text disguised as source exports", () => {
  expect(
    parse(`const s='export const Fake=1'; /* export {Other} */`).exports,
  ).toEqual([]);
});
it("reports unsupported declarations and syntax instead of silently omitting them", () => {
  expect(parse("export const {x}=source;").errors.length).toBeGreaterThan(0);
  expect(parse("export const broken = <div").errors.length).toBeGreaterThan(0);
});
