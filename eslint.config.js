import tseslint from "typescript-eslint";
export default tseslint.config(
  {ignores: ["dist/**", "node_modules/**"]},
  ...tseslint.configs.recommended,
  {files: ["**/*.cjs"], rules: {"@typescript-eslint/no-require-imports": "off"}},
  {files: ["**/*.{ts,tsx}"], rules: {
    // Existing UI components use flexible chart/library types. Correctness rules
    // apply across the app; introducing a strict style/type migration is separate.
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-unused-vars": "off",
    "@typescript-eslint/no-empty-object-type": "off",
    "no-constant-binary-expression": "error",
    "no-unreachable": "error",
    "no-unsafe-finally": "error",
  }},
);
