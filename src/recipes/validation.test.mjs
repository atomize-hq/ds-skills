import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { createTokenInventory, validateRecipe } from "./index.mjs";

const recipe = JSON.parse(
  fs.readFileSync(
    new URL("./__fixtures__/notice.recipe.json", import.meta.url),
    "utf8",
  ),
);
const tokens = JSON.parse(
  fs.readFileSync(
    new URL("./__fixtures__/tokens.json", import.meta.url),
    "utf8",
  ),
);
function evaluate(mutate = () => {}) {
  const value = globalThis.structuredClone(recipe);
  mutate(value);
  return validateRecipe(value, {
    filenameStem: value.componentId,
    tokenIds: createTokenInventory(tokens),
  });
}

describe("portable intrinsic recipe validation", () => {
  it("accepts arbitrary token namespaces and a component with no separate registration", () => {
    expect(evaluate()).toBeNull();
    expect(
      evaluate((r) => {
        r.componentId = "editor";
      }),
    ).toBeNull();
  });
  it("allows source-owned axes to evolve", () => {
    expect(
      evaluate((r) => {
        r.variantAxes[0].values.push("quiet");
        r.defaults.variants.intent = "quiet";
      }),
    ).toBeNull();
  });
  it("requires filename and component identity to match", () => {
    expect(
      validateRecipe(recipe, {
        filenameStem: "different",
        tokenIds: createTokenInventory(tokens),
      }),
    ).toMatchObject({ rule: "filename-alignment" });
  });
  it.each([
    [
      "duplicate-axis",
      (r) => r.variantAxes.push(globalThis.structuredClone(r.variantAxes[0])),
    ],
    ["unique-items", (r) => r.variantAxes[0].values.push("normal")],
    [
      "default-axis",
      (r) => {
        r.defaults.variants.absent = "value";
      },
    ],
    [
      "default-axis",
      (r) => r.variantAxes.push({ name: "size", values: ["small"] }),
    ],
    [
      "default-value",
      (r) => {
        r.defaults.variants.intent = "missing";
      },
    ],
    [
      "default-state",
      (r) => {
        r.defaults.state = "missing";
      },
    ],
    [
      "state-slot",
      (r) => {
        r.states.idle.absent = { text: "{brand.ink}" };
      },
    ],
    [
      "state-slots",
      (r) => {
        r.states.idle = "{brand.ink}";
      },
    ],
    [
      "fallback-state",
      (r) => {
        r.fallbacks.stateFallbacks.absent = "idle";
      },
    ],
    [
      "fallback-target",
      (r) => {
        r.fallbacks.stateFallbacks.muted = "absent";
      },
    ],
    [
      "fallback-cycle",
      (r) => {
        r.fallbacks.stateFallbacks.idle = "muted";
      },
    ],
    [
      "fallback-cycle",
      (r) => {
        r.fallbacks.stateFallbacks.idle = "idle";
      },
    ],
    [
      "additional-property",
      (r) => {
        r.defaults.extra = true;
      },
    ],
    [
      "additional-property",
      (r) => {
        r.fallbacks.extra = true;
      },
    ],
    [
      "token-reference",
      (r) => {
        r.slots.body.text = "red";
      },
    ],
    [
      "token-inventory",
      (r) => {
        r.states.idle.body.text = "{brand.absent}";
      },
    ],
    [
      "pattern",
      (r) => {
        r.slots["Bad Slot"] = r.slots.body;
      },
    ],
  ])("rejects %s at the intended rule", (rule, mutate) => {
    expect(evaluate(mutate)).toMatchObject({ rule });
  });
  it("does not treat inherited properties as required source fields", () => {
    const inherited = Object.create(recipe);
    expect(
      validateRecipe(inherited, {
        filenameStem: "notice",
        tokenIds: createTokenInventory(tokens),
      }),
    ).toMatchObject({ rule: "required" });
  });
});

describe("token inventory boundary", () => {
  it("reads explicit and inherited types without counting metadata as tokens", () => {
    expect([
      ...createTokenInventory({ ...tokens, $extensions: { ignored: true } }),
    ]).toEqual(["brand.ink", "brand.muted", "spacing.gap"]);
  });
  it.each([
    null,
    [],
    { bad: 1 },
    { bad: { $value: "red" } },
    { bad: { $type: "color", $value: "red", child: {} } },
  ])("refuses malformed token trees %j", (value) => {
    expect(() => createTokenInventory(value)).toThrow(/token/i);
  });
});
