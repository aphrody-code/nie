import { ImageResponse } from "next/og";
import { wikiService } from "@/lib/wiki-service";

const SUPABASE_URL =
	process.env.NEXT_PUBLIC_SUPABASE_URL &&
	process.env.NEXT_PUBLIC_SUPABASE_URL.startsWith("http")
		? process.env.NEXT_PUBLIC_SUPABASE_URL
		: "https://azalee.rosegriffon.fr";

function absoluteUrl(url?: string | null): string | undefined {
	if (!url) {
		return undefined;
	}
	if (url.startsWith("http")) {
		return url;
	}
	if (url.startsWith("/storage/")) {
		return `${SUPABASE_URL}${url}`;
	}
	return `https://azalee.rosegriffon.fr${url}`;
}

export const alt = "Personnage Inazuma Eleven Victory Road - Azalée";
export const size = { height: 630, width: 1200 };
export const contentType = "image/png";

const ELEMENT_COLORS: Record<string, string> = {
	Feu: "#E53935",
	Fire: "#E53935",
	Forest: "#1B5E20",
	Foret: "#1B5E20",
	Montagne: "#F9A825",
	Mountain: "#F9A825",
	Vent: "#43A047",
	Wind: "#43A047",
};

const POSITION_LABELS: Record<string, string> = {
	Coach: "Coach",
	DF: "Defenseur",
	FW: "Attaquant",
	GK: "Gardien",
	MF: "Milieu",
};

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;

	let baseChar = await wikiService.getCharacter(id);
	if (!baseChar) {
		baseChar = await wikiService.getCharacterBySlug(id);
	}

	if (!baseChar) {
		return new ImageResponse(
			<div
				style={{
					alignItems: "center",
					background: "linear-gradient(135deg, #1A120D 0%, #2D1F14 100%)",
					color: "#F2A93B",
					display: "flex",
					fontSize: 48,
					fontWeight: 700,
					height: "100%",
					justifyContent: "center",
					width: "100%",
				}}
			>
				Personnage introuvable
			</div>,
			{ ...size }
		);
	}

	const variant = baseChar.variants[0];
	const name = baseChar.names.fr || baseChar.names.en || baseChar.names.ja || "Inconnu";
	const nameJa = baseChar.names.ja || "";
	const position = variant?.position || "";
	const element = variant?.element || "";
	const rarity = variant?.rarity || baseChar.bestRarity || "";
	const team = (baseChar as any).teams?.[0]?.names?.fr || "";

	const elementColor = ELEMENT_COLORS[element] || "#F2A93B";
	const positionLabel = POSITION_LABELS[position] || position;

	const stats = variant?.stats?.lv99;

	return new ImageResponse(
		<div
			style={{
				background: "linear-gradient(135deg, #1A120D 0%, #2D1F14 50%, #1A120D 100%)",
				color: "white",
				display: "flex",
				fontFamily: "sans-serif",
				height: "100%",
				overflow: "hidden",
				position: "relative",
				width: "100%",
			}}
		>
			{/* Background accent */}
			<div
				style={{
					background: `linear-gradient(180deg, ${elementColor}15 0%, ${elementColor}05 100%)`,
					display: "flex",
					height: "100%",
					position: "absolute",
					right: 0,
					top: 0,
					width: 400,
				}}
			/>

			{/* Top bar */}
			<div
				style={{
					background: `linear-gradient(90deg, #F2A93B, ${elementColor}, #F2A93B)`,
					display: "flex",
					height: 4,
					left: 0,
					position: "absolute",
					right: 0,
					top: 0,
				}}
			/>

			{/* Character image area */}
			<div
				style={{
					alignItems: "center",
					display: "flex",
					flexShrink: 0,
					justifyContent: "center",
					padding: "40px 20px 40px 40px",
					width: 280,
				}}
			>
				{absoluteUrl(baseChar.image) ? (
					<img
						src={absoluteUrl(baseChar.image)!}
						alt={name}
						width={200}
						height={200}
						style={{
							border: `3px solid ${elementColor}`,
							borderRadius: 24,
							boxShadow: `0 0 40px ${elementColor}40`,
							objectFit: "cover",
						}}
					/>
				) : (
					<div
						style={{
							alignItems: "center",
							background: "#3D2E22",
							border: `3px solid ${elementColor}`,
							borderRadius: 24,
							display: "flex",
							fontSize: 72,
							height: 200,
							justifyContent: "center",
							width: 200,
						}}
					>
						?
					</div>
				)}
			</div>

			{/* Info section */}
			<div
				style={{
					display: "flex",
					flex: 1,
					flexDirection: "column",
					gap: 12,
					justifyContent: "center",
					padding: "40px 40px 40px 0",
				}}
			>
				{/* Name */}
				<div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
					<div
						style={{
							color: "white",
							display: "flex",
							fontSize: 48,
							fontWeight: 900,
							lineHeight: 1.1,
						}}
					>
						{name}
					</div>
					{nameJa && (
						<div
							style={{
								color: "#A09080",
								display: "flex",
								fontSize: 20,
							}}
						>
							{nameJa}
						</div>
					)}
				</div>

				{/* Badges row */}
				<div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
					{positionLabel && (
						<div
							style={{
								background: "#3D2E22",
								border: "1px solid #5D4E42",
								borderRadius: 20,
								color: "#F2A93B",
								display: "flex",
								fontSize: 16,
								fontWeight: 700,
								padding: "6px 16px",
							}}
						>
							{positionLabel}
						</div>
					)}
					{element && (
						<div
							style={{
								background: `${elementColor}20`,
								border: `1px solid ${elementColor}40`,
								borderRadius: 20,
								color: elementColor,
								display: "flex",
								fontSize: 16,
								fontWeight: 700,
								padding: "6px 16px",
							}}
						>
							{element}
						</div>
					)}
					{rarity && (
						<div
							style={{
								background: rarity === "BASARA" ? "#7367f020" : "#3D2E22",
								border: `1px solid ${rarity === "BASARA" ? "#7367f040" : "#5D4E42"}`,
								borderRadius: 20,
								color: rarity === "BASARA" ? "#9B8FFF" : "#C0A080",
								display: "flex",
								fontSize: 16,
								fontWeight: 700,
								padding: "6px 16px",
							}}
						>
							{rarity}
						</div>
					)}
				</div>

				{team && (
					<div
						style={{
							color: "#A09080",
							display: "flex",
							fontSize: 18,
						}}
					>
						{team}
					</div>
				)}

				{/* Stats bar */}
				{stats && (
					<div
						style={{
							display: "flex",
							flexWrap: "wrap",
							gap: 16,
							marginTop: 8,
						}}
					>
						{[
							{ color: "#E53935", label: "FRA", value: stats.kick },
							{ color: "#43A047", label: "CTR", value: stats.control },
							{ color: "#29B6F6", label: "TEC", value: stats.technique },
							{ color: "#1565C0", label: "PRE", value: stats.pressure },
							{ color: "#FF9800", label: "PHY", value: stats.physical },
							{ color: "#FDD835", label: "AGI", value: stats.agility },
							{ color: "#AB47BC", label: "INT", value: stats.intelligence },
						].map((s) => (
							<div
								key={s.label}
								style={{
									alignItems: "center",
									display: "flex",
									flexDirection: "column",
									gap: 2,
								}}
							>
								<div
									style={{
										color: s.color,
										display: "flex",
										fontSize: 11,
										fontWeight: 700,
									}}
								>
									{s.label}
								</div>
								<div
									style={{
										color: "white",
										display: "flex",
										fontSize: 22,
										fontWeight: 900,
									}}
								>
									{s.value || "?"}
								</div>
							</div>
						))}
					</div>
				)}
			</div>

			{/* Branding footer */}
			<div
				style={{
					alignItems: "center",
					bottom: 16,
					display: "flex",
					gap: 8,
					left: 40,
					position: "absolute",
				}}
			>
				<div
					style={{
						color: "#F2A93B",
						display: "flex",
						fontSize: 14,
						fontWeight: 700,
					}}
				>
					azalee.rosegriffon.fr
				</div>
				<div
					style={{
						color: "#6D5E50",
						display: "flex",
						fontSize: 12,
					}}
				>
					Inazuma Eleven: Victory Road
				</div>
			</div>
		</div>,
		{ ...size }
	);
}
