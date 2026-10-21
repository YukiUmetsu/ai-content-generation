import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    // Vendored Kumiki source is upstream code pinned byte-for-byte; lint it upstream,
    // not here, so a pin bump never fails on unrelated rule drift.
    ignores: ["dist", "coverage", "node_modules", "src/components/ui", "src/styles/kumiki"],
  },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },
  {
    // Vite/Vitest declare their ambient types with a triple-slash reference.
    files: ["vite.config.ts"],
    rules: { "@typescript-eslint/triple-slash-reference": "off" },
  },
);
