import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
	return {
		background_color: "#19120D",
		categories: ["entertainment", "sports", "games"],
		description: "L'information la plus précise sur Inazuma Eleven: Victory Road.",
		dir: "ltr",
		display: "standalone",
		display_override: ["window-controls-overlay"],
		icons: [
			{
				src: "/icon.webp",
				sizes: "192x192",
				type: "image/webp",
			},
			{
				src: "/icon.webp",
				sizes: "512x512",
				type: "image/webp",
			},
			{
				src: "/icon.webp",
				sizes: "512x512",
				type: "image/webp",
				purpose: "maskable",
			},
		],
		id: "/",
		lang: "fr",
		name: "Azalée",
		orientation: "portrait",
		prefer_related_applications: false,
		scope: "/",
		short_name: "Azalée",
		start_url: "/",
		theme_color: "#FFB700",
	};
}
