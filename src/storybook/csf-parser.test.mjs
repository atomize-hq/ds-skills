import { expect, it } from "vitest";
import { parseStorySource } from "./csf-parser.mjs";
const parse = (source) => parseStorySource(source, "demo.stories.tsx");
it("parses declarative local aliases and typed metadata without executing imports or stories", () => {
  const result = parse(
    `import { dangerous } from 'missing-runtime'; const title = 'UI/Notice'; const meta = ({ title } satisfies Meta); export default meta; export const Default = {render: () => dangerous()}; export type Helper = string;`,
  );
  expect(result).toEqual({ errors: [], storyIds: ["ui-notice--default"] });
});
it.each([
  ["id: 'stable-name', title:'Renamed'", "stable-name--basic"],
  ["title:'UI/Foo'", "ui-foo--basic"],
])("uses metadata %s", (meta, id) => {
  expect(
    parse(`export default {${meta}}; export const Basic={};`).storyIds,
  ).toEqual([id]);
});
it.each([
  ["includeStories: ['Basic']", ["demo--basic"]],
  ["excludeStories: ['Hidden']", ["demo--basic"]],
  ["includeStories: /^B/", ["demo--basic"]],
  ["excludeStories: /Hidden/", ["demo--basic"]],
  ["includeStories: []", []],
])("honors static export filter %s", (filter, ids) => {
  expect(
    parse(
      `export default {title:'Demo', ${filter}}; export const Basic={}; export const Hidden={};`,
    ).storyIds,
  ).toEqual(ids);
});
it("includes exported functions and does not reserve ordinary story names", () => {
  expect(
    parse(
      `export default {title:'Demo'}; export function Sample() {} export const args={}; export const __namedExportsOrder=[];`,
    ).storyIds,
  ).toEqual(["demo--sample", "demo--args"]);
});
it.each([
  "export default {title:'Demo', ...other}; export const Basic={};",
  "export default {title:'Demo', ['id']: 'x'};",
  "const a=b; const b=a; export default a;",
  "import meta from './meta'; export default meta;",
  "export default {title: makeTitle()};",
  "export default {title:'Demo', id: something};",
  "export default {title:'Demo', includeStories: makeFilter()};",
  "export default {title:'Demo', includeStories: [unknown]};",
  "export default {title:'Demo'}; export * from './other';",
  "export default {title:'Demo'}; const Basic={}; export {Basic};",
  "export default {title:'Demo'}; export const { Basic } = other;",
  "const meta={title:'Demo'}; export default meta; meta.title='Changed';",
  "export default {title:'Demo'}; export const Basic={parameters:{__id:'custom'}};",
  "export default {title:'Demo'}; export const OneTwo={}; export const One_Two={};",
  "export default { title: ",
])(
  "rejects unsupported/ambiguous source instead of partial coverage %#",
  (source) => {
    const result = parse(source);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.storyIds).toEqual([]);
  },
);
