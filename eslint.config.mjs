import { builtinModules } from "node:module";
import typescriptEslint from "typescript-eslint";
import prettierPlugin from "eslint-plugin-prettier";
import sonarjs from "eslint-plugin-sonarjs";

export default [
  ...typescriptEslint.configs.recommended,
  sonarjs.configs.recommended,
  {
    files: ["**/*.ts"],
  },
  {
    plugins: {
      "@typescript-eslint": typescriptEslint.plugin,
      prettier: prettierPlugin,
    },

    languageOptions: {
      parser: typescriptEslint.parser,
      ecmaVersion: 2024,
      sourceType: "module",
      parserOptions: {
        project: "./tsconfig.json",
      },
    },

    rules: {
      // Integrate Prettier as an ESLint rule so `eslint --fix` will apply formatting
      "prettier/prettier": [
        "error",
        {
          endOfLine: "auto",
        },
      ],
      "@typescript-eslint/naming-convention": [
        "error",
        {
          selector: "import",
          format: ["camelCase", "PascalCase"],
        },
      ],

      curly: "error",
      eqeqeq: "error",
      "no-throw-literal": "error",
      semi: "error",
      "@typescript-eslint/no-deprecated": "error",
      "no-negated-condition": "warn",
      "sonarjs/no-empty-collection": "warn",
      "@typescript-eslint/no-empty-object-type": "warn",
      "prefer-object-has-own": "warn",
      "@typescript-eslint/no-empty-function": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        {
          prefer: "type-imports",
        },
      ],
      "@typescript-eslint/no-unnecessary-type-assertion": "error",
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["../*"],
              message:
                "Usage of relative imports is not allowed. Use aliases instead.",
            },
            {
              group: builtinModules.flatMap((m) =>
                m.startsWith("node:") ? [] : [m, `${m}/*`],
              ),
              message: "Use node: protocol imports (e.g. node:fs) instead.",
            },
          ],
        },
      ],
      "no-unused-vars": "off",
      "prefer-destructuring": [
        "error",
        {
          object: true,
          array: false,
        },
      ],
      "@typescript-eslint/prefer-readonly": "error",
    },
  },
];
