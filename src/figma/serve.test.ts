import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { renderPluginSources } from "../plugin/build.js";
import { resolveConfig } from "../config.js";
import { CannotEvaluateError } from "./profile.mjs";
import {
  artifactUrlPathFor,
  driftReportUrlPath,
  loopbackHosts,
  readServeConfig,
  startTokenServer,
  type TokenServer,
} from "./serve.js";

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
const artifactPath = path.join(packageRoot, "src/__fixtures__/artifact.json");

let tmpDir: string;
let server: TokenServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
  if (tmpDir !== undefined) fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** A config on a free port, so tests never collide with a developer's server. */
function writeConfig(overrides: Record<string, unknown> = {}): string {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ds-skills-serve-"));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const file = path.join(tmpDir, "config.json");
  fs.writeFileSync(
    file,
    JSON.stringify({
      collectionName: "Design Tokens",
      artifactUrl: `http://localhost:${port}/design-tokens/tokens.json`,
      tokenSourcePath: "tokens/",
      extensionsNamespace: "com.example.tokens",
      fallbackThemeId: "light",
      plugin: { name: "Design Token Sync", id: "design-token-sync-dev" },
      ...overrides,
    }),
  );
  return file;
}

async function get(port: number, urlPath: string, method = "GET") {
  const response = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
    method,
  });
  return { status: response.status, body: await response.text() };
}

describe("the served surface is exactly two resources", () => {
  it("serves the artifact at the path the plugin will ask for", async () => {
    const configPath = writeConfig();
    server = await startTokenServer({ configPath, artifactPath });

    const response = await get(server.port, server.artifactUrlPath);
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({ accent: {} });
  });

  it.each([
    ["the repo root", "/"],
    ["the artifact's directory", "/design-tokens/"],
    ["a sibling file", "/design-tokens/other.json"],
    ["a traversal attempt", "/design-tokens/../../package.json"],
    ["the drift path by GET", driftReportUrlPath],
  ])("refuses %s", async (_what, urlPath) => {
    // The easy migration is a static server rooted at the consumer's checkout.
    // It is the wrong one: the plugin needs one file, and a server that will
    // hand out any path in the repo is a larger thing wearing this one's name.
    const configPath = writeConfig();
    server = await startTokenServer({ configPath, artifactPath });
    expect((await get(server.port, urlPath)).status).toBe(404);
  });

  it("refuses methods it does not implement", async () => {
    const configPath = writeConfig();
    server = await startTokenServer({ configPath, artifactPath });
    expect(
      (await get(server.port, server.artifactUrlPath, "DELETE")).status,
    ).toBe(405);
  });
});

describe("the embedded URL and the served endpoint cannot drift apart", () => {
  it("derives the served path from the same artifactUrl the builder substitutes", async () => {
    const configPath = writeConfig();
    const config = readServeConfig(configPath);
    server = await startTokenServer({ configPath, artifactPath });

    // Both sides read one field. A separate --url flag here is exactly how a
    // server ends up correct and unreachable.
    expect(server.artifactUrlPath).toBe(artifactUrlPathFor(config));
    expect(server.artifactUrlPath).toBe(new URL(config.artifactUrl).pathname);
  });

  it("accepts drift reports at the URL the plugin is built with", () => {
    const config = resolveConfig(
      JSON.parse(fs.readFileSync(writeConfig(), "utf8")) as object,
    );
    const { uiHtml } = renderPluginSources(config);
    const origin = new URL(config.artifactUrl).origin;
    expect(uiHtml).toContain(`${origin}${driftReportUrlPath}`);
  });
});

describe("drift reports", () => {
  it("writes a report, stamped with provenance the client did not supply", async () => {
    const configPath = writeConfig();
    const driftReportPath = path.join(tmpDir, "reports", "drift.json");
    server = await startTokenServer({
      configPath,
      artifactPath,
      driftReportPath,
      revision: "abc123",
    });

    const response = await fetch(
      `http://127.0.0.1:${server.port}${driftReportUrlPath}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // A client claiming a different artifact must not be believed.
        body: JSON.stringify({
          ok: true,
          findings: [],
          artifactSha256: "lies",
        }),
      },
    );

    expect(response.status).toBe(200);
    const written = JSON.parse(fs.readFileSync(driftReportPath, "utf8")) as {
      artifactSha256: string;
      repoRevision: string;
    };
    expect(written.artifactSha256).not.toBe("lies");
    expect(written.repoRevision).toBe("abc123");
  });

  it("rejects a body that is not a drift report", async () => {
    const configPath = writeConfig();
    server = await startTokenServer({
      configPath,
      artifactPath,
      driftReportPath: path.join(tmpDir, "drift.json"),
    });
    const response = await fetch(
      `http://127.0.0.1:${server.port}${driftReportUrlPath}`,
      { method: "POST", body: "{}" },
    );
    expect(response.status).toBe(400);
  });

  it("refuses reports entirely when no destination was given", async () => {
    // Serving is read-only unless a consumer asks for a write, by naming where.
    const configPath = writeConfig();
    server = await startTokenServer({ configPath, artifactPath });
    const response = await fetch(
      `http://127.0.0.1:${server.port}${driftReportUrlPath}`,
      { method: "POST", body: JSON.stringify({ findings: [] }) },
    );
    expect(response.status).toBe(405);
  });
});

describe("startup and shutdown", () => {
  it("refuses to start on an occupied port, and says which", async () => {
    const configPath = writeConfig();
    server = await startTokenServer({ configPath, artifactPath });
    await expect(
      startTokenServer({ configPath, artifactPath, port: server.port }),
    ).rejects.toThrow(/already in use/);
  });

  it("stops listening when closed", async () => {
    const configPath = writeConfig();
    const started = await startTokenServer({ configPath, artifactPath });
    const port = started.port;
    await started.close();
    server = undefined;

    await expect(get(port, "/design-tokens/tokens.json")).rejects.toThrow();
  });

  it("cannot serve an artifact that has not been built", async () => {
    const configPath = writeConfig();
    await expect(
      startTokenServer({
        configPath,
        artifactPath: path.join(tmpDir, "absent.json"),
      }),
    ).rejects.toThrow(CannotEvaluateError);
  });
});

describe("the bind surface", () => {
  it("binds loopback only, never a wildcard address", async () => {
    // Stated as a checkable contract rather than a comment: this serves a
    // development artifact, and a wildcard bind puts a repo's tokens on the
    // network of whatever café the developer is sitting in.
    const configPath = writeConfig();
    server = await startTokenServer({ configPath, artifactPath });

    expect(server.hosts.length).toBeGreaterThan(0);
    for (const host of server.hosts) expect(loopbackHosts).toContain(host);
    expect(server.hosts).not.toContain("0.0.0.0");
  });
});

describe("an ephemeral port is reported, not requested", () => {
  it("binds a free port and says which one", async () => {
    // `--port 0` used to report 0 — a URL nothing can connect to — and bind the
    // two loopback families to two different ephemeral ports.
    const configPath = writeConfig();
    server = await startTokenServer({ configPath, artifactPath, port: 0 });

    expect(server.port).toBeGreaterThan(0);
    expect((await get(server.port, server.artifactUrlPath)).status).toBe(200);
  });

  it("puts every loopback family on that same port", async () => {
    const configPath = writeConfig();
    server = await startTokenServer({ configPath, artifactPath, port: 0 });
    for (const host of server.hosts) {
      const response = await fetch(
        `http://${host.includes(":") ? `[${host}]` : host}:${server.port}${server.artifactUrlPath}`,
      );
      expect(response.status, host).toBe(200);
    }
  });
});
