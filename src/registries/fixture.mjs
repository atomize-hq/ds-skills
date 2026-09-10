import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { loadProject } from "../project/config.mjs";
export async function registryFixture({
  folder = "evidence",
  withIndex = true,
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "registry-evidence-")),
    routes = new Map(),
    requests = [];
  const server = http.createServer((req, res) => {
    requests.push({ url: req.url, headers: req.headers });
    const r = routes.get(req.url);
    if (!r) {
      res.writeHead(404);
      res.end("missing");
      return;
    }
    if (r.redirect) {
      res.writeHead(302, { Location: r.redirect });
      res.end();
      return;
    }
    const send = () => {
      if (res.destroyed) return;
      res.writeHead(r.status ?? 200, {
        "Content-Type": r.type ?? "application/json",
      });
      res.end(
        Buffer.isBuffer(r.body)
          ? r.body
          : typeof r.body === "string"
            ? r.body
            : JSON.stringify(r.body),
      );
    };
    if (r.delay) globalThis.setTimeout(send, r.delay).unref();
    else send();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  function write(file, value) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(
      target,
      typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n",
    );
  }
  const registries = ["widgets", "layout"].map((id) => {
    routes.set(`/${id}/index`, {
      body: { name: id, items: [{ name: "control" }] },
    });
    routes.set(`/${id}/control`, {
      body: {
        name: "control",
        type: "registry:component",
        files: [
          {
            path: "ui/control.tsx",
            content:
              "export function Control() { return <button>Go</button>; }\n",
            type: "registry:component",
          },
          {
            path: "other/control.tsx",
            content: "export type ControlId = string;\n",
            type: "registry:lib",
          },
        ],
        dependencies: ["react@19.0.0"],
        registryDependencies: ["unfetched-helper"],
        scripts: { postinstall: "DO NOT EXECUTE REMOTE EVIDENCE" },
      },
    });
    routes.set(`/${id}/license`, {
      body: "Example license evidence.\n",
      type: "text/plain",
    });
    return {
      id,
      version: "declared-v1",
      index: withIndex ? `${base}/${id}/index` : null,
      items: [{ name: "control", url: `${base}/${id}/control` }],
      documents: [{ id: "license", url: `${base}/${id}/license` }],
    };
  });
  const definition = { registryVersion: "1", registries },
    config = {
      projectVersion: "1",
      tokens: null,
      registries: {
        definition: "registries.json",
        evidence: null,
        candidate: `${folder}/candidate.json`,
        lockPath: ".locks/registries",
      },
    };
  write("registries.json", definition);
  write("project.json", config);
  return {
    root,
    base,
    routes,
    requests,
    write,
    definition,
    config,
    project: () => loadProject(path.join(root, "project.json")),
    close: async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}
