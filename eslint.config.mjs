import typescriptEslint from "typescript-eslint";
import prettierPlugin from "eslint-plugin-prettier";

export default [
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
        "warn",
        {
          selector: "import",
          format: ["camelCase", "PascalCase"],
        },
      ],

      curly: "warn",
      eqeqeq: "warn",
      "no-throw-literal": "warn",
      semi: "warn",
      "@typescript-eslint/no-deprecated": "error",
      "@typescript-eslint/no-unused-vars": "warn",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        {
          prefer: "type-imports",
        },
      ],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["../*"],
              message:
                "Usage of relative imports is not allowed. Use aliases instead.",
            },
          ],
        },
      ],
      "no-unused-vars": "warn",
    },
  },
];
