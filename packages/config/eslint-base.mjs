import js from "@eslint/js";
import tseslint from "typescript-eslint";
import oxlint from "eslint-plugin-oxlint";

export default [
	js.configs.recommended,
	...oxlint.configs["flat/recommended"],
	{
		ignores: [
			"**/node_modules/**",
			"**/.next/**",
			"**/dist/**",
			"**/build/**",
			"**/.turbo/**",
			"**/coverage/**",
			"**/*.d.ts",
		],
	},
	{
		files: ["**/*.{js,jsx,mjs,cjs}"],
		languageOptions: {
			ecmaVersion: 2024,
			sourceType: "module",
			globals: {
				Bun: "readonly",
				process: "readonly",
				console: "readonly",
			},
		},
		rules: {
			"no-unused-vars": "off",
			"no-undef": "off",
		},
	},
	{
		files: ["**/*.{ts,tsx,mts,cts}"],
		plugins: {
			"@typescript-eslint": tseslint.plugin,
		},
		languageOptions: {
			parser: tseslint.parser,
			ecmaVersion: 2024,
			sourceType: "module",
			parserOptions: {
				ecmaFeatures: { jsx: true },
			},
			globals: {
				Bun: "readonly",
				process: "readonly",
				console: "readonly",
			},
		},
		rules: {
			"no-unused-vars": "off",
			"no-undef": "off",
		},
	},
];
