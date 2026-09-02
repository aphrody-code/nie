import next from "@next/eslint-plugin-next";
import reactCompiler from "eslint-plugin-react-compiler";
import jsxA11y from "eslint-plugin-jsx-a11y";
import betterTailwindcss from "eslint-plugin-better-tailwindcss";
import base from "./eslint-base.mjs";

export default [
	...base,
	{
		files: ["**/*.{ts,tsx}"],
		plugins: {
			"@next/next": next,
			"react-compiler": reactCompiler,
			"jsx-a11y": jsxA11y,
			"better-tailwindcss": betterTailwindcss,
		},
		rules: {
			...next.configs.recommended.rules,
			...next.configs["core-web-vitals"].rules,
			"react-compiler/react-compiler": "warn",
			"better-tailwindcss/enforce-consistent-line-wrapping": ["warn", { printWidth: 120 }],
			"better-tailwindcss/no-unregistered-classes": "off",
		},
		settings: {
			"better-tailwindcss": {
				entryPoint: "src/app/globals.css",
			},
		},
	},
];
