import js from "@eslint/js";
import tseslint from "typescript-eslint";

/**
 * The pack's lint gate, required by SPEC.md §6 as part of taking ownership of
 * the code. Deliberately NOT Collider's config: the two repos have different
 * formatting and different rules, and unifying them would produce a large diff
 * that is entirely noise.
 *
 * Type-aware linting is on for the TypeScript sources. The relocated `.mjs`
 * validators are linted without type information — `checkJs` is a separate,
 * larger decision recorded in the backlog, and turning it on here by the side
 * door would make a lint gate into a typing project.
 */
export default tseslint.config(
  { ignores: ["dist/**", "plugin/dist/**", "coverage/**", "node_modules/**"] },
  js.configs.recommended,
  // `recommended`, not `recommendedTypeChecked`. The type-checked preset floods
  // this codebase with no-unsafe-* on every value crossing an untyped `.mjs`
  // boundary — 123 of them — which is the `checkJs` project the backlog already
  // owns, not a lint gate. The three type-aware rules that earn their keep are
  // enabled individually below.
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["vitest.config.ts", "eslint.config.js"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Type-aware, so scoped to the typed sources. These are the rules that
      // catch the shapes this migration keeps finding: a rejection nobody
      // awaits, a promise used where a value was meant.
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/require-await": "error",
    },
  },
  {
    // The `.mjs` modules and build scripts predate this gate and carry no
    // types. `checkJs` is a separate, larger decision recorded in the backlog;
    // turning it on here by the side door would make a lint gate into a typing
    // project.
    files: ["**/*.mjs", "**/*.js"],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      globals: {
        Buffer: "readonly",
        URL: "readonly",
        console: "readonly",
        fetch: "readonly",
        process: "readonly",
      },
    },
  },
  {
    rules: {
      // A CLI writes through streams it was handed, so it can be tested and so
      // a caller can tell stdout from stderr. console.log bypasses both.
      "no-console": "error",
      eqeqeq: ["error", "always", { null: "ignore" }],
      // `const { a: _omitted, ...rest }` is how you drop a key without a
      // helper. Flagging the binding you deliberately did not use makes the
      // idiom unavailable and buys nothing.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },
);
