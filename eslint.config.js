// The lint the check runs: the recommended rules, a reason on every suppression, and the layer's
// imports in src/.
// See docs/development.md
// Adapted from spike-html-apps-sdk (df65376): eslint.config.js.

import comments from "@eslint-community/eslint-plugin-eslint-comments";
import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import boundaries from "eslint-plugin-boundaries";
import importX from "eslint-plugin-import-x";
import globals from "globals";
import tseslint from "typescript-eslint";

const code = ["**/*.js", "**/*.ts"];

/** The layer table cut to the SDK: its sources, which may import nothing but themselves. */
export const layers = [{ name: "sdk", path: "src", may: ["sdk"] }];

/** The adapters: each a file of a layer that alone may import the packages it adapts, and that no
 * other module imports. */
export const adapters = [
  {
    category: "nats-adapter",
    file: "src/events/nats.ts",
    packages: ["@nats-io/nats-core", "@nats-io/jetstream"],
  },
];

const elements = layers.map(({ name, path }) => ({
  type: name,
  pattern: [path, `${path}/**/.*`],
  partialMatch: false,
}));
const files = adapters.map(({ category, file }) => ({ category, pattern: file }));

const policies = [
  ...layers.map(({ name, may }) => ({
    from: { element: { type: name } },
    allow: { to: may.map((target) => ({ element: { type: target } })) },
  })),
  ...adapters.flatMap(({ category, packages }) => [
    {
      from: { file: { categories: category } },
      allow: { to: { module: { origin: "external", source: packages } } },
    },
    {
      disallow: { to: { file: { categories: category } } },
      message: "An adapter is imported by its subpath, never by another module of the package.",
    },
  ]),
];

const declarations = {
  disallow: { to: { internalPath: "**/*.d.ts" }, dependency: { kind: "value" } },
  message:
    "A .d.ts file is a declaration with no runtime: import it with `import type` (or export " +
    "from it with `export type`), never as a value, a side effect, or an import().",
};

export default defineConfig([
  { ignores: ["dist/"] },
  { files: code, extends: [js.configs.recommended, tseslint.configs.recommended] },
  {
    files: code,
    plugins: { "@eslint-community/eslint-comments": comments },
    rules: {
      "@eslint-community/eslint-comments/require-description": "error",
      "@typescript-eslint/ban-ts-comment": [
        "error",
        {
          "ts-check": false,
          "ts-expect-error": "allow-with-description",
          "ts-ignore": "allow-with-description",
          "ts-nocheck": "allow-with-description",
        },
      ],
    },
  },
  { files: code, languageOptions: { globals: globals.browser } },
  { files: ["test/**/*.ts", "scripts/**"], languageOptions: { globals: globals.node } },
  {
    files: ["src/**"],
    plugins: { boundaries, "import-x": importX },
    settings: {
      "import/resolver": { typescript: true },
      "import-x/resolver": { typescript: true },
      "boundaries/elements": elements,
      "boundaries/files": files,
    },
    rules: {
      "import-x/no-unresolved": "error",
      "import-x/no-extraneous-dependencies": [
        "error",
        { devDependencies: false, includeInternal: true, includeTypes: true },
      ],
      "import-x/no-relative-packages": "error",
      "boundaries/dependencies": [
        "error",
        {
          default: "disallow",
          checkAllOrigins: true,
          checkUnknownLocals: true,
          checkInternals: true,
          policies: [...policies, declarations],
        },
      ],
    },
  },
]);
