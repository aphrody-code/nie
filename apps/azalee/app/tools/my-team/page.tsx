import type { Metadata } from "next";
import type { PickerCharacter } from "@/components/tools/my-team/CharacterPicker";
import { getServerSession } from "@/lib/auth-helpers";
import { getCharacterImageUrl } from "@rosegriffon/azalee/images";
import { wikiService } from "@/lib/wiki-service";
import { TeamBuilderLoader } from "./TeamBuilderLoader";

export const metadata: Metadata = {
	alternates: { canonical: "/tools/my-team" },
	description:
		"Créez votre équipe Inazuma Eleven idéale. Glissez-déposez vos joueurs sur le terrain, choisissez votre formation et partagez votre équipe.",
	title: "Mon Équipe | Inazuma Eleven Victory Road - Azalée",
};

export const dynamic = "force-dynamic";

function resolveImageUrl(char: any): string {
	const variant = char.variants?.[0] as any;
	const zukanHash = char.zukanHash || variant?.zukanHash;
	if (zukanHash) {
		const clean = zukanHash.startsWith("/") ? zukanHash.slice(1) : zukanHash;
		return `https://dxi4wb638ujep.cloudfront.net/1/${clean}.png`;
	}
	return getCharacterImageUrl(char.internalCode);
}

export default async function MyTeamPage() {
	const session = await getServerSession();
	const isAuthenticated = Boolean(session?.user);

	const [{ data: rawChars }, { data: rawCoords }] = await Promise.all([
		wikiService.getCharactersList({
			limit: 6000,
			page: 1,
			status: "all",
		}),
		wikiService.getCoordinatorsList({
			limit: 200,
			status: "all",
		})
	]);

	// Group variants and deduplicate
	const grouped = wikiService.groupVariants(rawChars);

	// Map players to picker-friendly format
	const mappedPlayers: PickerCharacter[] = grouped
		.map((char) => {
			const variant = char.variants?.[0] as any;
			const name = char.names?.fr || char.names?.en || char.names?.ja || "?";
			const position = variant?.position || "MF";
			const element = variant?.element || "Void";
			const rarity = (char as any).bestRarity || variant?.rarity || "Normal";
			const imageUrl = resolveImageUrl(char);
			const slug = (char as any).slug || variant?.slug || char.charaId;
			const statsLv99 = variant?.stats?.lv99;

			return {
				charaId: char.charaId,
				element,
				imageUrl,
				name,
				position,
				rarity,
				series: (char as any).sheetData?.series,
				slug,
				internalCode: char.internalCode,
				zukanHash: char.zukanHash || variant?.zukanHash,
				stats: statsLv99
					? {
							kick: statsLv99.kick || 0,
							control: statsLv99.control || 0,
							technique: statsLv99.technique || 0,
							pressure: statsLv99.pressure || 0,
							physical: statsLv99.physical || 0,
							agility: statsLv99.agility || 0,
							intelligence: statsLv99.intelligence || 0,
						}
					: undefined,
			};
		})
		.filter((c) => c.imageUrl);

	// Map coordinators to picker-friendly format
	const mappedCoords: PickerCharacter[] = rawCoords.map((c: any) => {
		const isCoord = c.bestRarity === "Coordinator";
		return {
			charaId: c.charaId,
			element: "Void",
			imageUrl: c.image_url || c.image || "https://dxi4wb638ujep.cloudfront.net/1/k/c/b/cb88nfolkwe.png",
			name: c.names?.fr || c.names?.en || "?",
			position: isCoord ? "COORD" : "COACH",
			rarity: c.bestRarity || "Coach",
			slug: c.slug,
			internalCode: c.internalCode,
			zukanHash: c.zukanHash,
			stats: undefined,
		};
	});

	const characters = [...mappedPlayers, ...mappedCoords];

	return <TeamBuilderLoader characters={characters} isAuthenticated={isAuthenticated} />;
}
