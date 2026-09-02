import { getSkillImageUrl } from "@rosegriffon/azalee/images";
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

export const alt = "Technique Inazuma Eleven Victory Road - Azalee";
export const size = { height: 630, width: 1200 };
export const contentType = "image/png";

const ELEMENT_COLORS: Record<string, string> = {
	Fire: "#E53935",
	Forest: "#1B5E20",
	Mountain: "#F9A825",
	Void: "#78909C",
	Wind: "#43A047",
};

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const skill = await wikiService.getSkill(id);

	if (!skill) {
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
				Technique introuvable
			</div>,
			{ ...size }
		);
	}

	const name = skill.name_FR || skill.name_EN || skill.displayName || "???";
	const category = skill.categoryName?.fr || skill.categoryName?.en || "Special";
	const element = skill.elementName?.en || "Void";
	const elementFr = skill.elementName?.fr || "";
	const power = skill.power_min
		? skill.power_max && skill.power_max !== skill.power_min
			? `${skill.power_min} - ${skill.power_max}`
			: `${skill.power_min}`
		: null;
	const tp = skill.consumeTp || null;

	const elementColor = ELEMENT_COLORS[element] || "#78909C";

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

			{/* Background glow */}
			<div
				style={{
					background: `radial-gradient(circle, ${elementColor}10 0%, transparent 70%)`,
					borderRadius: "50%",
					display: "flex",
					height: 500,
					left: "50%",
					position: "absolute",
					top: "50%",
					transform: "translate(-50%, -50%)",
					width: 500,
				}}
			/>

			{/* Skill image */}
			<div
				style={{
					alignItems: "center",
					display: "flex",
					flexShrink: 0,
					justifyContent: "center",
					padding: "40px 20px 40px 60px",
					width: 300,
				}}
			>
				{absoluteUrl(getSkillImageUrl(skill.internalCode)) ? (
					<img
						src={absoluteUrl(getSkillImageUrl(skill.internalCode))!}
						width={180}
						height={180}
						style={{
							border: `2px solid ${elementColor}60`,
							borderRadius: 20,
							objectFit: "contain",
						}}
						alt={`Image de la technique ${name}`}
					/>
				) : (
					<div
						style={{
							alignItems: "center",
							background: "#3D2E22",
							border: `2px solid ${elementColor}60`,
							borderRadius: 20,
							color: elementColor,
							display: "flex",
							fontSize: 64,
							height: 180,
							justifyContent: "center",
							width: 180,
						}}
					>
						⚡
					</div>
				)}
			</div>

			{/* Info */}
			<div
				style={{
					display: "flex",
					flex: 1,
					flexDirection: "column",
					gap: 16,
					justifyContent: "center",
					padding: "40px 60px 40px 0",
				}}
			>
				{/* Category label */}
				<div
					style={{
						color: "#A09080",
						display: "flex",
						fontSize: 16,
						fontWeight: 700,
						letterSpacing: 3,
						textTransform: "uppercase",
					}}
				>
					{category}
				</div>

				{/* Name */}
				<div
					style={{
						color: "white",
						display: "flex",
						fontSize: 52,
						fontWeight: 900,
						lineHeight: 1.1,
					}}
				>
					{name}
				</div>

				{/* Badges */}
				<div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
					{elementFr && (
						<div
							style={{
								background: `${elementColor}20`,
								border: `1px solid ${elementColor}40`,
								borderRadius: 20,
								color: elementColor,
								display: "flex",
								fontSize: 18,
								fontWeight: 700,
								padding: "8px 20px",
							}}
						>
							{elementFr}
						</div>
					)}
					{power && (
						<div
							style={{
								background: "#3D2E22",
								border: "1px solid #5D4E42",
								borderRadius: 20,
								color: "#F2A93B",
								display: "flex",
								fontSize: 18,
								fontWeight: 700,
								padding: "8px 20px",
							}}
						>
							Puissance {power}
						</div>
					)}
					{tp && (
						<div
							style={{
								background: "#3D2E22",
								border: "1px solid #5D4E42",
								borderRadius: 20,
								color: "#29B6F6",
								display: "flex",
								fontSize: 18,
								fontWeight: 700,
								padding: "8px 20px",
							}}
						>
							{tp} TP
						</div>
					)}
				</div>
			</div>

			{/* Branding */}
			<div
				style={{
					alignItems: "center",
					bottom: 20,
					display: "flex",
					gap: 8,
					left: 60,
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
