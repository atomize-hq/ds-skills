import { describe, expect, it, vi } from "vitest";
import artifact from "../__fixtures__/artifact.json" with { type: "json" };
import { flattenTokenDocument } from "../token-mapping.js";
import {
  createSyncPlan,
  FigmaVariablesSyncError,
  parseFigmaFileKey,
  resolveAccessToken,
  syncVariablesViaRest,
  verifySyncOutcome,
} from "./rest-variables.js";

const collectionName = "Design Tokens";
const modeName = "Base";
const desiredVariables = flattenTokenDocument(artifact);

/** A read-back payload that satisfies verification for `desiredVariables`. */
function readBackFor(
  variables = desiredVariables,
  overrides: Record<string, unknown> = {},
) {
  const ids = variables.map((_, index) => `VariableID:${index}`);
  return {
    meta: {
      variableCollections: {
        "VariableCollectionId:1": {
          id: "VariableCollectionId:1",
          name: collectionName,
          defaultModeId: "mode:1",
          modes: [{ modeId: "mode:1", name: modeName }],
          variableIds: ids,
          ...overrides,
        },
      },
      variables: Object.fromEntries(
        variables.map((variable, index) => [
          ids[index]!,
          {
            name: variable.name,
            resolvedType: variable.resolvedType,
            valuesByMode: { "mode:1": variable.value },
          },
        ]),
      ),
    },
  };
}

describe("resolveAccessToken", () => {
  it("accepts an OAuth token", () => {
    expect(resolveAccessToken({ FIGMA_OAUTH_ACCESS_TOKEN: "oauth-abc" })).toBe(
      "oauth-abc",
    );
  });

  it("rejects a personal token with an actionable message", () => {
    expect(() => resolveAccessToken({ FIGMA_TOKEN: "personal" })).toThrow(
      /not accepted by the Variables REST rail/,
    );
  });

  it("rejects an empty environment", () => {
    expect(() => resolveAccessToken({})).toThrow(/FIGMA_OAUTH_ACCESS_TOKEN/);
  });
});

describe("parseFigmaFileKey", () => {
  it("extracts the key", () => {
    expect(parseFigmaFileKey("figma://file/ABC123")).toBe("ABC123");
    expect(parseFigmaFileKey("figma://file/ABC123/some-name?node-id=1")).toBe(
      "ABC123",
    );
  });

  it.each([["https://figma.com/file/ABC"], [""], [null]])(
    "rejects %s",
    (input) => {
      expect(() => parseFigmaFileKey(input)).toThrow(FigmaVariablesSyncError);
    },
  );
});

describe("createSyncPlan", () => {
  it("creates the collection when the file has none", () => {
    const plan = createSyncPlan({
      currentState: { meta: { variableCollections: {} } },
      desiredVariables,
      collectionName,
      modeName,
    });
    const body = plan.requestBody as {
      variableCollections: { action: string }[];
    };

    expect(body.variableCollections.map((entry) => entry.action)).toEqual([
      "CREATE",
    ]);
    expect(plan.variableCount).toBe(desiredVariables.length);
  });

  it("deletes an existing collection first, which is why VariableIDs do not survive", () => {
    const plan = createSyncPlan({
      currentState: {
        meta: {
          variableCollections: {
            "VariableCollectionId:9": {
              id: "VariableCollectionId:9",
              name: collectionName,
            },
          },
        },
      },
      desiredVariables,
      collectionName,
      modeName,
    });
    const body = plan.requestBody as {
      variableCollections: { action: string; id: string }[];
    };

    expect(body.variableCollections[0]).toMatchObject({
      action: "DELETE",
      id: "VariableCollectionId:9",
    });
    expect(body.variableCollections[1]).toMatchObject({ action: "CREATE" });
  });

  it("emits one variable and one mode value per token leaf", () => {
    const plan = createSyncPlan({
      currentState: {},
      desiredVariables,
      collectionName,
      modeName,
    });
    const body = plan.requestBody as {
      variables: unknown[];
      variableModeValues: unknown[];
    };

    expect(body.variables).toHaveLength(desiredVariables.length);
    expect(body.variableModeValues).toHaveLength(desiredVariables.length);
  });
});

describe("verifySyncOutcome", () => {
  it("passes when the read-back matches", () => {
    expect(
      verifySyncOutcome({
        readBack: readBackFor(),
        desiredVariables,
        collectionName,
        modeName,
      }),
    ).toEqual({
      collectionCount: 1,
      determinismVerified: true,
      variableCount: desiredVariables.length,
    });
  });

  it("tolerates the float32 precision Figma reads numbers back at", () => {
    const readBack = readBackFor();
    const opacityIndex = desiredVariables.findIndex(
      (entry) => entry.name === "opacity/muted",
    );
    const id = `VariableID:${opacityIndex}`;
    readBack.meta.variables[id]!.valuesByMode["mode:1"] = 0.699999988079071;

    expect(() =>
      verifySyncOutcome({
        readBack,
        desiredVariables,
        collectionName,
        modeName,
      }),
    ).not.toThrow();
  });

  it.each([
    [
      "a missing collection",
      { readBack: { meta: { variableCollections: {} } } },
    ],
    [
      "a wrong mode name",
      { overrides: { modes: [{ modeId: "mode:1", name: "Other" }] } },
    ],
    [
      "a variable count mismatch",
      { overrides: { variableIds: ["VariableID:0"] } },
    ],
  ])("fails on %s", (_label, setup: Record<string, unknown>) => {
    const readBack =
      setup["readBack"] ??
      readBackFor(desiredVariables, setup["overrides"] as never);
    expect(() =>
      verifySyncOutcome({
        readBack,
        desiredVariables,
        collectionName,
        modeName,
      }),
    ).toThrow(FigmaVariablesSyncError);
  });

  it("fails when a value did not persist", () => {
    const readBack = readBackFor();
    readBack.meta.variables["VariableID:0"]!.valuesByMode["mode:1"] = {
      r: 0,
      g: 0,
      b: 0,
      a: 1,
    };

    expect(() =>
      verifySyncOutcome({
        readBack,
        desiredVariables,
        collectionName,
        modeName,
      }),
    ).toThrow(/did not persist/);
  });
});

describe("syncVariablesViaRest", () => {
  function fakeFetch(responses: { status: number; body: unknown }[]) {
    const calls: { url: string; method: string }[] = [];
    const fetchImpl = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), method: init?.method ?? "GET" });
        const next = responses.shift() ?? { status: 200, body: readBackFor() };
        return new Response(JSON.stringify(next.body), { status: next.status });
      },
    );
    return {
      fetchImpl: fetchImpl as unknown as typeof globalThis.fetch,
      calls,
    };
  }

  it("reads, writes, then verifies", async () => {
    const { fetchImpl, calls } = fakeFetch([
      { status: 200, body: { meta: { variableCollections: {} } } },
      { status: 200, body: {} },
      { status: 200, body: readBackFor() },
    ]);

    const result = await syncVariablesViaRest({
      artifactDocument: artifact,
      figmaFile: "figma://file/ABC123",
      env: { FIGMA_OAUTH_ACCESS_TOKEN: "oauth-abc" },
      collectionName,
      fetch: fetchImpl,
    });

    expect(calls.map((call) => call.method)).toEqual(["GET", "POST", "GET"]);
    expect(calls[0]?.url).toBe(
      "https://api.figma.com/v1/files/ABC123/variables/local",
    );
    expect(result.verification.variableCount).toBe(desiredVariables.length);
  });

  it("retries a retryable status, then succeeds", async () => {
    const { fetchImpl, calls } = fakeFetch([
      { status: 503, body: { message: "slow down" } },
      { status: 200, body: { meta: { variableCollections: {} } } },
      { status: 200, body: {} },
      { status: 200, body: readBackFor() },
    ]);

    await syncVariablesViaRest({
      artifactDocument: artifact,
      figmaFile: "figma://file/ABC123",
      env: { FIGMA_OAUTH_ACCESS_TOKEN: "oauth-abc" },
      collectionName,
      fetch: fetchImpl,
      sleep: async () => {},
    });

    expect(calls).toHaveLength(4);
  });

  it("surfaces a non-retryable failure with the Figma message", async () => {
    const { fetchImpl } = fakeFetch([
      { status: 403, body: { message: "Variables API not enabled" } },
    ]);

    await expect(
      syncVariablesViaRest({
        artifactDocument: artifact,
        figmaFile: "figma://file/ABC123",
        env: { FIGMA_OAUTH_ACCESS_TOKEN: "oauth-abc" },
        collectionName,
        fetch: fetchImpl,
        sleep: async () => {},
      }),
    ).rejects.toThrow(/Variables API not enabled/);
  });
});
