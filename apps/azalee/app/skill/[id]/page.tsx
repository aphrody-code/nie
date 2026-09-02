/**
 * Rendu incrémental plutôt que `force-dynamic`.
 *
 * La fiche ne lit ni cookie ni en-tête (le pont JWT Supabase est désactivé :
 * `createClient()` ne touche à `headers()` que si on le réactive) — elle
 * n'avait donc aucune raison d'être recalculée à chaque visite. En
 * `force-dynamic`, les 993 techniques repayaient trois requêtes SQLite par
 * affichage, TTFB compris : c'est du budget d'exploration gaspillé pour un
 * robot d'indexation, et un Core Web Vital dégradé pour tout le monde.
 *
 * Une heure de fraîcheur couvre largement le rythme réel de la donnée : le
 * miroir SQLite n'est échangé qu'une fois par nuit (`nie-miroir`), et
 * la republication qui suit repart de toute façon sur un cache vide.
 */
export const revalidate = 3600;

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { OverrideSkillData } from "@/components/wiki/OverrideSkillSection";
import { SkillCutinSection } from "@/components/wiki/SkillCutinSection";
import { SkillDetail } from "@/components/wiki/SkillDetail";
import type { SkillVideoVariant } from "@/components/wiki/SkillVideoPlayer";
import { cutinHasAssets, getSkillCutin } from "@rosegriffon/azalee/game/skills-cutin";
import { getSkillImageUrl } from "@rosegriffon/azalee/images";
import { createClient } from "@/lib/supabase/server";
import { wikiService } from "@/lib/wiki-service";

/**
 * getSkill() (lib/wiki-service.ts) spreads sheet_data — empty {} for the 993 real
 * skills — then overrides with a subset of DB columns. Several populated columns
 * (evolution_type, growth_type, tp_cost, foul_rate, partner_count, recast_time,
 * description_en, skill_effect_bit_flag) are never mapped, so the detail page can't
 * render them. We read them directly here and map onto the field names SkillDetail
 * already expects, without touching wiki-service.
 */
async function enrichSkillFromDbColumns(skill: Record<string, unknown>): Promise<void> {
	const code = skill.internalCode as string | undefined;
	if (!code) {
		return;
	}
	try {
		const supabase = await createClient();
		const { data } = await supabase
			.from("inagle_skills")
			.select(
				"evolution_type, growth_type, tp_cost, tension_cost, foul_rate, partner_count, recast_time, description_en, skill_effect_bit_flag, hash_id"
			)
			.eq("internal_code", code)
			.limit(1)
			.maybeSingle();
		if (!data) {
			return;
		}
		const row = data as Record<string, unknown>;
		// Tension: real skills carry tp_cost; tension_cost is null. Keep existing if set.
		if (skill.consumeTp == null) {
			skill.consumeTp = row.tp_cost ?? row.tension_cost ?? skill.consumeTp;
		}
		if (skill.foulRate == null && row.foul_rate != null) {
			skill.foulRate = row.foul_rate;
		}
		if (skill.partnerCount == null && row.partner_count != null) {
			skill.partnerCount = row.partner_count;
		}
		if (skill.recastTime == null && row.recast_time != null) {
			skill.recastTime = row.recast_time;
		}
		if (!skill.desc_EN && row.description_en) {
			skill.desc_EN = row.description_en;
		}
		// Fields newly surfaced (rendered by SkillDetail's stats grid).
		skill.evolutionType = row.evolution_type ?? null;
		skill.growthTypeId = row.growth_type ?? null;
		skill.skillEffectBitFlag = row.skill_effect_bit_flag ?? null;
		skill.hashId = row.hash_id ?? null;
	} catch {
		// Mirror/Postgres unavailable — fall back to whatever getSkill returned.
	}
}

/**
 * Variantes vidéo officielles de la technique (`inagle_skill_videos`).
 *
 * 236 techniques sur les 895 publiées par zukan ont DEUX vidéos (réussite/échec,
 * défense/contre-tir) : `inagle_skills.video_url` ne peut en porter qu'une, la
 * table de liaison porte les autres. Lecture sur la même source que le reste de
 * la fiche (miroir SQLite en prod, Postgres sinon).
 */
interface SkillVideos {
	variants: SkillVideoVariant[];
	/**
	 * Date à laquelle la vidéo a été publiée sur cette fiche (`created_at` de la
	 * ligne la plus ancienne). C'est `uploadDate` du `VideoObject` : zukan ne
	 * date pas ses vidéos, et Google exige le champ — on donne la seule date
	 * réelle en notre possession plutôt que d'en inventer une.
	 */
	publishedAt: string | null;
}

async function fetchSkillVideos(skillId: string): Promise<SkillVideos> {
	try {
		const supabase = await createClient();
		const { data } = await supabase
			.from("inagle_skill_videos")
			.select("position, label, video_url, poster_url, created_at")
			.eq("skill_id", skillId)
			.order("position", { ascending: true });
		const rows = data ?? [];
		const dates = rows.map((row) => row.created_at).filter(Boolean) as string[];
		return {
			publishedAt: dates.length > 0 ? dates.toSorted()[0]! : null,
			variants: rows.map((row) => ({
				label: row.label,
				posterUrl: row.poster_url,
				position: row.position,
				videoUrl: row.video_url,
			})),
		};
	} catch {
		// Miroir/Postgres indisponible — la fiche retombe sur `skill.videoUrl`.
		return { publishedAt: null, variants: [] };
	}
}

export async function generateMetadata({
	params,
}: {
	params: Promise<{ id: string }>;
}): Promise<Metadata> {
	const { id } = await params;
	const skill = await wikiService.getSkill(id);
	const name = skill?.name_FR || skill?.displayName || "Technique";
	const category = skill?.categoryName?.fr || skill?.categoryName?.en || "";
	const element = skill?.elementName?.fr || "";
	const power = skill?.power_min ? `Puissance ${skill.power_min}` : "";
	const tp = skill?.consumeTp ? `${skill.consumeTp} TP` : "";
	const metaParts = [category, element, power, tp].filter(Boolean);

	// La description du jeu D'ABORD, la fiche technique ensuite.
	//
	// Toutes les fiches partageaient auparavant le même gabarit « Nom - Catégorie -
	// Élément - Puissance - TP », c'est-à-dire un extrait quasi identique d'une
	// technique à l'autre : rien qui distingue deux tirs de feu de même puissance
	// dans une page de résultats. Le texte du jeu, lui, est unique par technique —
	// c'est la seule phrase qui donne une raison de cliquer sur celle-ci plutôt que
	// sur la voisine. Les chiffres restent, en fin de ligne, quand il reste la place.
	const gameDesc = (skill?.desc_FR || skill?.desc_EN || "").replace(/\s+/g, " ").trim();
	const facts = metaParts.join(" · ");
	const description = gameDesc
		? `${truncate(gameDesc, 145 - facts.length)} ${facts}`.trim()
		: `${[name, ...metaParts].join(" - ")}. Technique spéciale Inazuma Eleven: Victory Road.`;
	const title = `${name} | Inazuma Eleven Victory Road - Azalée`;

	// getSkillImageUrl gate : `skill.image` brut (DB) contredisait la page (`SkillDetail` s'en
	// détourne déjà, cf. commentaire de la fonction) — servait un og:image 404 sur les 19
	// techniques `rh*` sans telop (audit d'images azalee, 2026-08-15).
	const telop = getSkillImageUrl(skill?.internalCode, skill?.image);

	// Le poster de la vidéo zukan est une vraie image large (image extraite de
	// l'animation, ~1280 px) : c'est la carte « grande image » que l'on veut sur X
	// et Discord. Le telop est une bannière de titre — informative, mais pas une
	// vignette. On ne bascule en `summary_large_image` que si on a le poster :
	// annoncer une grande image et servir un telop étroit donne un aperçu vide.
	const poster = skill?.posterUrl || null;
	const ogImage = poster || telop;
	const ogImageUrl =
		ogImage && ogImage.startsWith("/") ? `https://azalee.rosegriffon.fr${ogImage}` : ogImage;

	return {
		alternates: { canonical: `/skill/${id}` },
		description,
		keywords: [
			name,
			skill?.name_EN,
			skill?.name_JA,
			category,
			element,
			"Inazuma Eleven Victory Road",
			"technique spéciale",
			"hissatsu",
		].filter(Boolean) as string[],
		openGraph: {
			description,
			images: ogImageUrl ? [{ url: ogImageUrl, alt: name }] : [],
			locale: "fr_FR",
			siteName: "Azalée - Inazuma Eleven Victory Road",
			title: `${name} | Azalée`,
			type: "article",
			url: `/skill/${id}`,
			...(skill?.videoUrl
				? { videos: [{ type: "video/webm", url: skill.videoUrl as string }] }
				: {}),
		},
		title,
		twitter: {
			card: poster ? "summary_large_image" : "summary",
			description,
			images: ogImageUrl ? [ogImageUrl] : undefined,
			title: `${name} | Azalée`,
		},
	};
}

/** Coupe sur un mot entier, sans laisser d'espace ni de ponctuation orpheline. */
function truncate(text: string, max: number): string {
	if (max < 40) {
		max = 40;
	}
	if (text.length <= max) {
		return text;
	}
	const cut = text.slice(0, max);
	const lastSpace = cut.lastIndexOf(" ");
	return `${(lastSpace > 20 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.–-]+$/, "")}…`;
}

export default async function MoveDetailPage({ params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;

	const skill = await wikiService.getSkill(id);
	if (!skill) {
		notFound();
	}

	// Rich DB columns not surfaced by getSkill() (wiki-service spreads an empty
	// sheet_data for real skills, so foulRate/growth/tp_cost/etc. never reach the UI).
	// Supplementary read on the same source (inagle_skills mirror) to enrich display.
	await enrichSkillFromDbColumns(skill as unknown as Record<string, unknown>);

	const name = skill.name_FR || skill.name_EN || skill.displayName || "Unknown";
	const desc = skill.desc_FR || skill.desc_EN || "";
	const category = skill.categoryName?.fr || skill.categoryName?.en || "Spécial";
	const element = skill.elementName?.fr || skill.elementName?.en || "Néant";

	// Fetch related skills from same category via wikiService (consistent types)
	const categoryKey = skill.categoryName?.en?.toLowerCase();
	const currentCode = (skill as any).internalCode;
	const { data: sameCatSkills } = await wikiService.getSkillsList({
		category: categoryKey,
		limit: 20,
	});

	const relatedSkills = sameCatSkills
		.filter((s: any) => s.internalCode !== currentCode)
		.map((s: any) => {
			let score = 10; // Same category guaranteed
			if (skill.elementName?.en && s.elementName?.en === skill.elementName?.en) {
				score += 5;
			}
			if (s.videoUrl) {
				score += 20;
			}
			return { score, skill: s };
		})
		.toSorted((a, b) => b.score - a.score)
		.slice(0, 3)
		.map((item) => item.skill);

	// Fetch override skills (Overdrive combinations)
	const skillHexId = (skill as any).skillId || (skill as any).skillID || id;
	const overrideSkills: OverrideSkillData[] =
		await wikiService.getOverrideSkillsForSkill(skillHexId);

	// Assets de cut-in (niers : modèle 3D, telop, son) — clé = code interne `skill_id_str`.
	const cutinEntry = getSkillCutin((skill as any).internalCode || id);

	// Vidéos officielles zukan (1 ou 2 variantes selon la technique).
	const { variants: videos, publishedAt } = await fetchSkillVideos((skill as any).skillId || id);

	const pageUrl = `https://azalee.rosegriffon.fr/skill/${id}`;

	const breadcrumbJsonLd = {
		"@type": "BreadcrumbList",
		itemListElement: [
			{ "@type": "ListItem", item: "https://azalee.rosegriffon.fr", name: "Accueil", position: 1 },
			{
				"@type": "ListItem",
				item: "https://azalee.rosegriffon.fr/skill",
				name: "Techniques",
				position: 2,
			},
			{ "@type": "ListItem", item: pageUrl, name, position: 3 },
		],
	};

	/**
	 * `VideoObject` par variante — la seule donnée de cette fiche qui puisse
	 * prétendre à un résultat enrichi.
	 *
	 * Une technique a une ou deux animations officielles (réussite/échec,
	 * défense/contre-tir) : chacune est une vidéo distincte, avec son propre
	 * poster et son propre libellé. Les décrire toutes plutôt qu'une seule évite
	 * de déclarer une page à vidéo unique là où il y en a deux.
	 *
	 * `uploadDate` vient de `inagle_skill_videos.created_at` — la date à laquelle
	 * la vidéo est apparue ici. Zukan ne date pas ses fichiers ; à défaut de cette
	 * date réelle on n'émettrait pas de `VideoObject` du tout plutôt que d'en
	 * fabriquer une. Sans vidéo, pas de bloc : un `VideoObject` sans `contentUrl`
	 * est un balisage qui ment.
	 */
	const videoJsonLd = videos
		.filter((v) => v.videoUrl)
		.map((v) => ({
			"@type": "VideoObject",
			contentUrl: v.videoUrl,
			description: `${v.label} — ${name}, technique ${category.toLowerCase()} d'élément ${element.toLowerCase()} d'Inazuma Eleven: Victory Road.`,
			inLanguage: "fr-FR",
			isFamilyFriendly: true,
			name: videos.length > 1 ? `${name} (${v.label})` : name,
			thumbnailUrl: [v.posterUrl, (skill as any).thumbnailUrl].filter(Boolean),
			...(publishedAt ? { uploadDate: publishedAt } : {}),
			url: pageUrl,
		}));

	const jsonLd = {
		"@context": "https://schema.org",
		"@graph": [breadcrumbJsonLd, ...videoJsonLd],
	};

	return (
		<>
			<script
				type="application/ld+json"
				dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
			/>
			<SkillDetail
				skill={skill}
				name={name}
				desc={desc}
				category={category}
				element={element}
				relatedSkills={relatedSkills}
				overrideSkills={overrideSkills}
				videos={videos}
			/>
			{cutinEntry?.cutin && (
				<div className="mt-6">
					<SkillCutinSection
						cutin={cutinEntry.cutin}
						skillCode={String((skill as any).internalCode || id)}
						skillName={name}
						assetsAvailable={cutinHasAssets(cutinEntry.cutin.event_id_name)}
					/>
				</div>
			)}
		</>
	);
}
