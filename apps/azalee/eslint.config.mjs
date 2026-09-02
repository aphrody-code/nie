import nextjs from "../../packages/config/eslint-nextjs.mjs";

export default [
	...nextjs,
	{
		ignores: [
			".next/",
			"dist/",
			"build/",
			"out/",
			"node_modules/",
			"coverage/",
			".turbo/",
			"*.min.js",
			"public/",
			"config/**/*",
			"scripts/**/*",
			"supabase/**/*",
		],
	},
];
