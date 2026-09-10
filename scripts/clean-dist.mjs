import fs from "node:fs";
// This exact product-owned generated directory is the only cleanup target.
// A rebuild must not ship removed modules or compiled tests from an older build.
fs.rmSync(new URL("../dist", import.meta.url), {
  recursive: true,
  force: true,
});
