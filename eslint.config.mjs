import next from "@next/eslint-plugin-next";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";
import importPlugin from "eslint-plugin-import";
import parser from "eslint-config-next/parser";
import globals from "globals";

/**
 * Flat config, which is the only kind this version of ESLint reads. `next lint`
 * has been removed and `next build` no longer lints, so this runs on its own
 * through `npm run lint`, which `npm run check` calls.
 *
 * Everything below is exactly what `eslint-config-next/core-web-vitals` sets,
 * written out rather than imported from it, because importing that config loads
 * `typescript-eslint`, and `typescript-eslint` 8 refuses to start against the
 * TypeScript 7 this project builds with. Its own message says so: "typescript-
 * eslint does not support TS 7.0."
 *
 * Nothing here needs the TypeScript API. The parser is the Babel one Next.js
 * ships, which reads TypeScript and JSX without it, so the hooks rules and the
 * accessibility rules both work. What is lost is only
 * `eslint-config-next/typescript`, the layer of rules about the language
 * itself, and the type checker already covers this project for that.
 *
 * Replace all of it with the two imports once typescript-eslint supports
 * TypeScript 7. The tracking issue is typescript-eslint 10940.
 */
const config = [
  {
    ignores: [
      ".next/**",
      "out/**",
      "build/**",
      "node_modules/**",
      "next-env.d.ts",
    ],
  },
  {
    files: ["**/*.{js,jsx,mjs,ts,tsx,mts,cts}"],
    plugins: {
      react,
      "react-hooks": reactHooks,
      import: importPlugin,
      "jsx-a11y": jsxA11y,
      "@next/next": next,
    },
    languageOptions: {
      parser,
      parserOptions: {
        requireConfigFile: false,
        sourceType: "module",
        allowImportExportEverywhere: true,
        babelOptions: {
          presets: ["next/babel"],
          caller: { supportsTopLevelAwait: true },
        },
      },
      globals: { ...globals.browser, ...globals.node },
    },
    settings: { react: { version: "detect" } },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      ...next.configs.recommended.rules,
      "import/no-anonymous-default-export": "warn",
      "react/no-unknown-property": "off",
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
      "jsx-a11y/alt-text": ["warn", { elements: ["img"], img: ["Image"] }],
      "jsx-a11y/aria-props": "warn",
      "jsx-a11y/aria-proptypes": "warn",
      "jsx-a11y/aria-unsupported-elements": "warn",
      "jsx-a11y/role-has-required-aria-props": "warn",
      "jsx-a11y/role-supports-aria-props": "warn",
      "react/jsx-no-target-blank": "off",
      // What core-web-vitals raises from a warning to an error.
      ...next.configs["core-web-vitals"].rules,
    },
  },
];

export default config;
