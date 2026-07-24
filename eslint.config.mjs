import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/build/**",
      "**/release/**",
      "**/node_modules/**",
      "**/*.d.ts",
      "**/prisma/generated/**",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    rules: {
      // The stub taught this lesson the hard way: an `any` silences the compiler
      // without making the code correct. Warn, so new ones are a deliberate choice.
      "@typescript-eslint/no-explicit-any": "warn",

      // Unused code is where real bugs hide. Underscore-prefixed args are intentional.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],

      // Prisma calls and Express handlers are async; a forgotten await silently
      // returns a Promise where a value was expected.
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-constant-condition": ["error", { checkLoops: false }], // while(true) with break is fine
      "prefer-const": "error",
      "no-var": "error",
    },
  },

  // ─── Backend + Electron main + build scripts (Node) ───
  {
    files: [
      "server/**/*.ts",
      "electron/src/**/*.ts",
      "electron/scripts/**/*.{mjs,cjs,js}",
      "scripts/**/*.mjs",
      "**/*.config.{ts,js,mjs}",
    ],
    languageOptions: {
      globals: { ...globals.node },
      sourceType: "module",
    },
  },

  // electron-builder loads its hooks through CommonJS require(). That is the
  // contract, not a mistake.
  {
    files: ["**/*.cjs"],
    languageOptions: {
      globals: { ...globals.node },
      sourceType: "commonjs",
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },

  // ─── Frontend (browser + React) ───
  {
    files: ["client/**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      // This is the rule that would have caught calling a hook inside a click
      // handler in Integraciones.tsx. It is worth the whole config on its own.
      ...reactHooks.configs.recommended.rules,
    },
  },

  // ─── Tests ───
  {
    files: ["server/tests/**/*.ts"],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      "@typescript-eslint/no-explicit-any": "off", // fixtures mimic raw API payloads
    },
  }
);
