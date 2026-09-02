import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
	const baseUrl = "https://azalee.rosegriffon.fr";

	return {
		rules: [
			{
				// /api/llm/* = contexte IA (CLAUDE.md/GEMINI.md/Grok) : autorisé (allow plus spécifique que disallow /api/).
				// `/api/og/` : les cartes de partage des 5 204 fiches de personnage sont
				// servies depuis là ; interdites, elles laissaient chaque partage sans
				// visuel. Comme `/api/llm/`, l'autorisation précède l'interdiction.
				allow: ["/", "/api/llm/", "/api/og/"],
				disallow: [
					"/dashboard/",
					"/api/",
					"/auth/",
					"/login",
					"/settings",
					// Pages de compte : elles exposent la biographie d'un membre en
					// description, sans intérêt d'index et sans consentement demandé.
					"/profil/",
					// Page technique, sans contenu propre.
					"/maintenance",
				],
				userAgent: "*",
			},
			{
				// Mediapartners-Google = robot d'AdSense. Il lit le contenu de la page
				// pour choisir les annonces ; sans autorisation explicite il ne reste que
				// du remplissage générique, et le revenu s'effondre sans message d'erreur.
				// Mêmes exclusions que la règle générique : rien de privé ne s'ouvre ici.
				allow: "/",
				disallow: [
					"/dashboard/",
					"/api/",
					"/auth/",
					"/login",
					"/settings",
					"/profil/",
					"/maintenance",
				],
				userAgent: "Mediapartners-Google",
			},
			{
				// Crawlers IA explicitement autorisés (condition pour l'ingestion LLM)
				// `/api/og/` : les cartes de partage des 5 204 fiches de personnage sont
				// servies depuis là ; interdites, elles laissaient chaque partage sans
				// visuel. Comme `/api/llm/`, l'autorisation précède l'interdiction.
				allow: ["/", "/api/llm/", "/api/og/"],
				disallow: [
					"/dashboard/",
					"/api/",
					"/auth/",
					"/login",
					"/settings",
					// Pages de compte : elles exposent la biographie d'un membre en
					// description, sans intérêt d'index et sans consentement demandé.
					"/profil/",
					// Page technique, sans contenu propre.
					"/maintenance",
				],
				userAgent: [
					"GPTBot",
					"ChatGPT-User",
					"OAI-SearchBot",
					"ClaudeBot",
					"Claude-Web",
					"anthropic-ai",
					"Anthropic-AI",
					"Google-Extended",
					"PerplexityBot",
					"Perplexity-User",
					"CCBot",
					"Bytespider",
					"Amazonbot",
					"Applebot",
					"Applebot-Extended",
					"cohere-ai",
					"FacebookBot",
					"Meta-ExternalAgent",
					"ImagesiftBot",
				],
			},
		],
		sitemap: `${baseUrl}/sitemap.xml`,
	};
}
