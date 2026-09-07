import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { resolveConfig, type RailConfig } from "../config.js";
import {
  buildPlugin,
  escapeHtml,
  jsString,
  PluginBuildError,
  readTemplate,
  renderPluginSources,
  substitute,
} from "./build.js";

/**
 * T6's substitution checks, made durable. They were run once by hand against
 * three configurations and then had nothing pinning them, which is the state
 * every one of these tests exists to leave.
 */

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
const exampleConfigPath = path.join(
  packageRoot,
  "ds-skills.config.example.json",
);

let tmpDir: string;
beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ds-skills-plugin-"));
});
afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function configWith(overrides: Partial<RailConfig>): RailConfig {
  return resolveConfig({
    ...(JSON.parse(fs.readFileSync(exampleConfigPath, "utf8")) as object),
    ...overrides,
  });
}

describe("the script escaper, pinned directly", () => {
  // Routing a hostile value through a URL does not exercise this: `new URL()`
  // rejects `<` in a hostname with ERR_INVALID_URL, so the escaper is defence in
  // depth for a value that cannot currently carry the sequence — which is
  // exactly why nothing pinned it before, and exactly why it is pinned here
  // rather than through a config.
  it.each([
    ["</script>", '"\\u003c/script\\u003e"'],
    [
      "<script>alert(1)</script>",
      '"\\u003cscript\\u003ealert(1)\\u003c/script\\u003e"',
    ],
    ["<!--", '"\\u003c!--"'],
    ["-->", '"--\\u003e"'],
  ])("neutralizes %j", (input, expected) => {
    expect(jsString(input)).toBe(expected);
  });

  it("never emits a raw angle bracket, whatever it is given", () => {
    const hostile = 'http://x/</script><script>a="b"</script>';
    const encoded = jsString(hostile);
    expect(encoded).not.toMatch(/[<>]/);
    // Still the same string once parsed: escaping must not corrupt the value.
    expect(JSON.parse(encoded)).toBe(hostile);
  });

  it("escapes HTML text separately, because the two contexts differ", () => {
    expect(escapeHtml('<a href="x">&')).toBe(
      "&lt;a href=&quot;x&quot;&gt;&amp;",
    );
    // Applying the HTML escaper inside a <script> would emit &lt; as source
    // text; applying the JS escaper in HTML would leave the quotes in place.
    expect(escapeHtml("</script>")).not.toBe(jsString("</script>"));
  });
});

describe("substitution drift is refused in both directions", () => {
  it("refuses a placeholder the template no longer contains", () => {
    // A configured value silently not reaching the plugin.
    expect(() =>
      substitute("nothing here", "t", { __RAIL_MISSING__: "x" }),
    ).toThrow(PluginBuildError);
  });

  it("refuses a placeholder the substitution map does not know", () => {
    // A placeholder surviving into shipped output.
    expect(() =>
      substitute("__RAIL_KNOWN__ __RAIL_UNKNOWN__", "t", {
        __RAIL_KNOWN__: "x",
      }),
    ).toThrow(/still contains __RAIL_UNKNOWN__/);
  });

  it("leaves no placeholder in either real template", () => {
    const { manifest, uiHtml } = renderPluginSources(configWith({}));
    expect(manifest).not.toMatch(/__RAIL_/);
    expect(uiHtml).not.toMatch(/__RAIL_/);
  });

  it("has templates that still carry every placeholder the build substitutes", () => {
    // Guards the inverse of the two tests above at the real templates: a
    // template edit that drops a placeholder must fail the build, not the map.
    expect(readTemplate("manifest.template.json")).toContain(
      "__RAIL_PLUGIN_ID__",
    );
    expect(readTemplate("ui.html")).toContain("__RAIL_DRIFT_REPORT_URL__");
  });
});

describe("an alternate configuration produces the intended changed output", () => {
  // Byte identity to a recorded digest is the criterion for the ORIGINAL
  // configuration only. For an alternate one the question is whether the
  // changed value actually reached the output, which a digest cannot answer.
  it("carries a different origin into both artifacts", () => {
    const { manifest, uiHtml } = renderPluginSources(
      configWith({ artifactUrl: "https://tokens.example.test:8443/a/b.json" }),
    );
    const parsed = JSON.parse(manifest) as {
      networkAccess: { devAllowedDomains: string[] };
    };
    expect(parsed.networkAccess.devAllowedDomains).toEqual([
      "https://tokens.example.test:8443",
    ]);
    expect(uiHtml).toContain(
      "https://tokens.example.test:8443/figma/drift-report",
    );
    // The path is deliberately not part of the origin: the manifest grants a
    // domain, not a file.
    expect(manifest).not.toContain("/a/b.json");
  });

  it("carries a different plugin identity", () => {
    const { manifest } = renderPluginSources(
      configWith({ plugin: { name: "Other Sync", id: "other-sync-1" } }),
    );
    expect(JSON.parse(manifest)).toMatchObject({
      name: "Other Sync",
      id: "other-sync-1",
    });
  });

  it("escapes a hostile plugin name into the HTML rather than the DOM", () => {
    const { uiHtml } = renderPluginSources(
      configWith({ plugin: { name: '<img src=x onerror="1">', id: "x" } }),
    );
    expect(uiHtml).toContain("&lt;img src=x onerror=&quot;1&quot;&gt;");
    expect(uiHtml).not.toContain("<img src=x");
  });
});

describe("the generated endpoint, together with the permission that gates it", () => {
  /**
   * T6 tested substitution and stopped there, which proved the URL was correct
   * and said nothing about whether the plugin could reach it. `networkAccess`
   * pins `allowedDomains` to ["none"] and grants the origin only through
   * `devAllowedDomains`, which Figma applies in development. So a consumer
   * pointing at a hosted origin gets a correct manifest that cannot fetch it —
   * a finding about the config, not about the substitution.
   */
  it("grants the configured origin only for development", () => {
    const { manifest } = renderPluginSources(
      configWith({ artifactUrl: "https://tokens.example.test/tokens.json" }),
    );
    const parsed = JSON.parse(manifest) as {
      networkAccess: { allowedDomains: string[]; devAllowedDomains: string[] };
    };
    expect(parsed.networkAccess.allowedDomains).toEqual(["none"]);
    expect(parsed.networkAccess.devAllowedDomains).toEqual([
      "https://tokens.example.test",
    ]);
  });

  it("means a non-loopback origin is unreachable from a published plugin", () => {
    // Stated as an assertion so the constraint cannot be forgotten: nothing in
    // the manifest permits the configured origin outside development, however
    // correct the substituted URL is.
    const { manifest } = renderPluginSources(
      configWith({ artifactUrl: "https://tokens.example.test/tokens.json" }),
    );
    const parsed = JSON.parse(manifest) as {
      networkAccess: { allowedDomains: string[] };
    };
    expect(parsed.networkAccess.allowedDomains).not.toContain(
      "https://tokens.example.test",
    );
  });
});

describe("buildPlugin writes what Figma loads", () => {
  it("writes ui.html and manifest.json, and returns the same bytes", () => {
    const outDir = path.join(tmpDir, "out");
    const result = buildPlugin({
      configPath: exampleConfigPath,
      outDir,
      skipBundle: true,
    });
    // Figma reads ui.html from disk as well as through the bundle, so a
    // returned-but-unwritten value would load stale markup.
    expect(fs.readFileSync(path.join(outDir, "ui.html"), "utf8")).toBe(
      result.uiHtml,
    );
    expect(fs.readFileSync(path.join(outDir, "manifest.json"), "utf8")).toBe(
      result.manifest,
    );
  });

  it("cannot evaluate a config that is not there", () => {
    expect(() =>
      buildPlugin({
        configPath: path.join(tmpDir, "absent.json"),
        outDir: path.join(tmpDir, "out2"),
        skipBundle: true,
      }),
    ).toThrow(/No config at/);
  });
});
