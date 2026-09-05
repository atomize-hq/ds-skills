import { describe, expect, it } from "vitest";
import artifact from "./__fixtures__/artifact.json" with { type: "json" };
import { flattenTokenDocument } from "./token-mapping.js";

describe("flattenTokenDocument", () => {
  it("produces a deterministic sorted leaf list from a token artifact", () => {
    const leaves = flattenTokenDocument(artifact);

    expect(leaves).toHaveLength(12);
    expect(leaves[0]?.name).toBe("accent/primary");
    expect(leaves.at(-1)?.name).toBe("type/weight/bold");
  });

  it("parses color values from hex, hex8, rgb(), and rgba()", () => {
    const leaves = flattenTokenDocument({
      core: {
        color: {
          hex: { $type: "color", $value: "#ff0000" },
          hex8: { $type: "color", $value: "#00ff0080" },
          rgb: { $type: "color", $value: "rgb(0, 0, 255)" },
          rgba: { $type: "color", $value: "rgba(255, 0, 0, 0.5)" },
        },
      },
    });

    const byName = new Map(leaves.map((leaf) => [leaf.name, leaf]));
    expect(byName.get("core/color/hex")?.resolvedType).toBe("COLOR");
    expect(byName.get("core/color/hex")?.value).toEqual({
      r: 1,
      g: 0,
      b: 0,
      a: 1,
    });

    const hex8 = byName.get("core/color/hex8")?.value as {
      r: number;
      g: number;
      b: number;
      a: number;
    };
    expect(hex8.r).toBeCloseTo(0);
    expect(hex8.g).toBeCloseTo(1);
    expect(hex8.b).toBeCloseTo(0);
    expect(hex8.a).toBeCloseTo(128 / 255);

    expect(byName.get("core/color/rgb")?.value).toEqual({
      r: 0,
      g: 0,
      b: 1,
      a: 1,
    });

    const rgba = byName.get("core/color/rgba")?.value as {
      r: number;
      g: number;
      b: number;
      a: number;
    };
    expect(rgba.r).toBeCloseTo(1);
    expect(rgba.g).toBeCloseTo(0);
    expect(rgba.b).toBeCloseTo(0);
    expect(rgba.a).toBeCloseTo(0.5);
  });

  it("normalizes duration values to milliseconds", () => {
    const leaves = flattenTokenDocument({
      motion: {
        duration: {
          ms: { $type: "duration", $value: "150ms" },
          s: { $type: "duration", $value: "0.15s" },
        },
      },
    });

    const byName = new Map(leaves.map((leaf) => [leaf.name, leaf]));
    expect(byName.get("motion/duration/ms")?.resolvedType).toBe("FLOAT");
    expect(byName.get("motion/duration/ms")?.value).toBe(150);
    expect(byName.get("motion/duration/s")?.value).toBe(150);
  });

  it("rejects boolean tokens that are not booleans", () => {
    expect(() =>
      flattenTokenDocument({
        flags: {
          bad: { $type: "boolean", $value: "false" },
        },
      }),
    ).toThrow(/boolean tokens must use boolean values/);
  });
});
