import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { resolveConfig, type RailConfig } from "../config.js";
import { CannotEvaluateError } from "./profile.mjs";

/**
 * `figma serve` — serve one artifact to the plugin, and accept one drift report
 * back.
 *
 * Two resources, both named up front. The easy migration is a static file
 * server rooted at the consumer's checkout, and it is the wrong one: the plugin
 * needs exactly one file, and a server that will hand out any path in the repo
 * is a different, larger thing wearing this one's name.
 */

export interface ServeOptions {
  readonly configPath: string;
  readonly artifactPath: string;
  /** Where a posted drift report is written. Omit to refuse reports entirely. */
  readonly driftReportPath?: string;
  readonly port?: number;
  /** Provenance stamp for a posted report; omitted when unavailable. */
  readonly revision?: string | null;
}

export interface TokenServer {
  readonly artifactUrlPath: string;
  readonly driftReportUrlPath: string;
  readonly port: number;
  close(): Promise<void>;
}

export const driftReportUrlPath = "/figma/drift-report";

export function readServeConfig(configPath: string): RailConfig {
  const absPath = path.resolve(configPath);
  try {
    return resolveConfig(JSON.parse(fs.readFileSync(absPath, "utf8")));
  } catch (error) {
    throw new CannotEvaluateError(
      "CONFIG_UNREADABLE",
      `config could not be read: ${absPath} (${(error as Error).message})`,
    );
  }
}

/**
 * The path the plugin will ask for, taken from the same `artifactUrl` the
 * builder substitutes into the plugin. Deriving it here rather than accepting a
 * separate flag is what keeps the served endpoint and the embedded URL from
 * drifting apart.
 */
export function artifactUrlPathFor(config: RailConfig): string {
  return new URL(config.artifactUrl).pathname;
}

export async function startTokenServer(
  options: ServeOptions,
): Promise<TokenServer> {
  const config = readServeConfig(options.configPath);
  const artifactPath = path.resolve(options.artifactPath);

  if (!fs.existsSync(artifactPath)) {
    throw new CannotEvaluateError(
      "ARTIFACT_MISSING",
      `missing ${artifactPath}. Build the token artifact before serving it.`,
    );
  }

  const artifactUrlPath = artifactUrlPathFor(config);
  const port = options.port ?? Number(new URL(config.artifactUrl).port || 4173);
  const handler = createHandler({ ...options, artifactPath }, artifactUrlPath);

  // Bound explicitly to loopback, both families: some environments resolve
  // `localhost` to ::1. Never 0.0.0.0 — this serves a development artifact and
  // has no business being reachable off the machine.
  const servers = [http.createServer(handler), http.createServer(handler)];
  await listen(servers[0]!, port, "127.0.0.1");
  try {
    await listen(servers[1]!, port, "::1");
  } catch {
    // No IPv6 loopback here; the IPv4 listener is the one that matters.
    servers.pop();
  }

  return {
    artifactUrlPath,
    driftReportUrlPath,
    port,
    close: async () => {
      await Promise.all(
        servers.map(
          (server) =>
            new Promise<void>((resolve) => server.close(() => resolve())),
        ),
      );
    },
  };
}

function listen(
  server: http.Server,
  port: number,
  host: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", (error: NodeJS.ErrnoException) => {
      reject(
        error.code === "EADDRINUSE"
          ? new CannotEvaluateError(
              "PORT_IN_USE",
              `port ${port} is already in use on ${host}; stop the other server or pass --port`,
            )
          : error,
      );
    });
    server.listen(port, host, () => resolve());
  });
}

function createHandler(
  options: ServeOptions & { artifactPath: string },
  artifactUrlPath: string,
) {
  return (req: http.IncomingMessage, res: http.ServerResponse): void => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.url === undefined) {
      res.statusCode = 400;
      res.end("missing url");
      return;
    }
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }
    if (req.method === "POST" && req.url === driftReportUrlPath) {
      handleDriftReport(req, res, options);
      return;
    }
    if (req.method !== "GET") {
      res.statusCode = 405;
      res.end("method not allowed");
      return;
    }
    // Exactly one servable path. Not a prefix, not a directory, not a root.
    if (req.url !== artifactUrlPath) {
      res.statusCode = 404;
      res.end("not found");
      return;
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    fs.createReadStream(options.artifactPath).pipe(res);
  };
}

/**
 * Records the plugin's read-only comparison as a repo artifact, so a ledger's
 * `verification.materializationStatus` can cite a measurement instead of a
 * hand-entered claim. Writes a report only — never token sources.
 */
function handleDriftReport(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  options: ServeOptions & { artifactPath: string },
): void {
  const target = options.driftReportPath;
  if (target === undefined) {
    sendJson(res, 405, { error: "This server accepts no drift reports" });
    return;
  }

  const chunks: Buffer[] = [];
  req.on("data", (chunk: Buffer) => chunks.push(chunk));
  req.on("error", (error) => {
    sendJson(res, 400, { error: `Request read error: ${error.message}` });
  });
  req.on("end", () => {
    let report: { findings?: unknown; ok?: unknown };
    try {
      report = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      sendJson(res, 400, { error: "Request body must be valid JSON" });
      return;
    }
    if (
      report === null ||
      typeof report !== "object" ||
      !Array.isArray(report.findings)
    ) {
      sendJson(res, 400, {
        error: "Payload must be a drift report with a findings array",
      });
      return;
    }

    // Provenance is stamped here rather than trusted from the client: a report
    // is only meaningful against a specific artifact build.
    //
    // The stamp goes LAST. Spreading the client's payload after it — which is
    // what the consumer's server did — lets a caller supply its own
    // `artifactSha256` and have the file record it as measured, which is the
    // one thing this envelope exists to prevent.
    const envelope = {
      ...report,
      checkedAt: new Date().toISOString(),
      artifactPath: options.artifactPath,
      artifactSha256: crypto
        .createHash("sha256")
        .update(fs.readFileSync(options.artifactPath))
        .digest("hex"),
      repoRevision: options.revision ?? null,
    };

    try {
      fs.mkdirSync(path.dirname(path.resolve(target)), { recursive: true });
      const tmpPath = path.join(
        os.tmpdir(),
        `ds-skills-drift-${Date.now()}.json`,
      );
      fs.writeFileSync(
        tmpPath,
        `${JSON.stringify(envelope, null, 2)}\n`,
        "utf8",
      );
      fs.renameSync(tmpPath, path.resolve(target));
    } catch (error) {
      sendJson(res, 500, {
        error: `File write error: ${(error as Error).message}`,
      });
      return;
    }

    sendJson(res, 200, {
      written: path.resolve(target),
      ok: envelope.ok === true,
      findingCount: (report.findings as unknown[]).length,
    });
  });
}

function sendJson(
  res: http.ServerResponse,
  status: number,
  body: unknown,
): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}
