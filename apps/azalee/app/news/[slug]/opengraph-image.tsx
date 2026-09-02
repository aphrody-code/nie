import { ImageResponse } from "next/og";
import { createClient } from "@/lib/supabase/server";

export const size = { height: 630, width: 1200 };
export const contentType = "image/png";

interface OgImageProps {
	params: Promise<{ slug: string }>;
}

const CATEGORY_LABELS: Record<string, string> = {
	announcement: "Annonce",
	community: "Communauté",
	critique: "Critique",
	event: "Événement",
};

function formatDate(dateString: string): string {
	try {
		const date = new Date(dateString);
		return new Intl.DateTimeFormat("fr-FR", {
			day: "numeric",
			month: "long",
			year: "numeric",
		}).format(date);
	} catch {
		return "";
	}
}

export default async function Image({ params }: OgImageProps) {
	const { slug } = await params;

	let title = "Azalee - Actualités Inazuma Eleven";
	let category: string | null = null;
	let authorName = "Azalée";
	let featuredImageUrl: string | null = null;
	let publishedAt: string | null = null;

	try {
		const supabase = await createClient();
		const { data } = await (supabase as any)
			.from("articles")
			.select("title, category, featured_image_url, published_at, author_id")
			.eq("slug", slug)
			.eq("app", "azalee")
			.single();

		if (data) {
			title = data.title || title;
			category = data.category || null;
			featuredImageUrl = data.featured_image_url || null;
			publishedAt = data.published_at || null;
			authorName = data.author?.full_name || "Azalée";
		}
	} catch {
		// Fallback gracieux
	}

	const categoryLabel = category ? CATEGORY_LABELS[category] || category : null;
	const dateLabel = publishedAt ? formatDate(publishedAt) : null;

	return new ImageResponse(
		<div
			style={{
				background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
				display: "flex",
				flexDirection: "column",
				fontFamily: "sans-serif",
				height: "100%",
				overflow: "hidden",
				position: "relative",
				width: "100%",
			}}
		>
			{/* Image de fond avec overlay */}
			{featuredImageUrl && (
				<>
					{/* Img natif requis pour ImageResponse — next/image non supporté dans Edge runtime */}
					<img
						src={featuredImageUrl}
						alt=""
						style={{
							height: "100%",
							inset: 0,
							objectFit: "cover",
							position: "absolute",
							width: "100%",
						}}
					/>
					{/* Overlay sombre 60% */}
					<div
						style={{
							background:
								"linear-gradient(135deg, rgba(26,26,46,0.85) 0%, rgba(22,33,62,0.75) 50%, rgba(26,26,46,0.90) 100%)",
							display: "flex",
							inset: 0,
							position: "absolute",
						}}
					/>
				</>
			)}

			{/* Contenu principal */}
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					height: "100%",
					justifyContent: "space-between",
					padding: "48px 60px",
					position: "relative",
					width: "100%",
					zIndex: 1,
				}}
			>
				{/* En-tête : logo + badge catégorie */}
				<div
					style={{
						alignItems: "center",
						display: "flex",
						justifyContent: "space-between",
					}}
				>
					<div
						style={{
							alignItems: "center",
							display: "flex",
							gap: 10,
						}}
					>
						<div
							style={{
								color: "#F2A93B",
								display: "flex",
								fontSize: 28,
								fontWeight: 900,
								letterSpacing: "-0.5px",
							}}
						>
							Azalee
						</div>
						<div
							style={{
								alignSelf: "flex-end",
								color: "#8899aa",
								display: "flex",
								fontSize: 13,
								paddingBottom: 2,
							}}
						>
							Rose Griffon
						</div>
					</div>

					{categoryLabel && (
						<div
							style={{
								alignItems: "center",
								background: "rgba(242, 169, 59, 0.18)",
								border: "1px solid rgba(242, 169, 59, 0.35)",
								borderRadius: 99,
								color: "#F2A93B",
								display: "flex",
								fontSize: 14,
								fontWeight: 700,
								letterSpacing: "0.5px",
								padding: "6px 18px",
								textTransform: "uppercase",
							}}
						>
							{categoryLabel}
						</div>
					)}
				</div>

				{/* Titre principal */}
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						gap: 16,
						maxWidth: 900,
					}}
				>
					<div
						style={{
							WebkitBoxOrient: "vertical",
							WebkitLineClamp: 3,
							color: "#ffffff",
							display: "-webkit-box",
							fontSize: title.length > 80 ? 42 : title.length > 50 ? 52 : 64,
							fontWeight: 900,
							letterSpacing: "-1px",
							lineHeight: 1.1,
							overflow: "hidden",
						}}
					>
						{title}
					</div>
				</div>

				{/* Pied de page : auteur + date + watermark */}
				<div
					style={{
						alignItems: "center",
						display: "flex",
						justifyContent: "space-between",
					}}
				>
					<div style={{ alignItems: "center", display: "flex", gap: 16 }}>
						{/* Auteur */}
						<div
							style={{
								alignItems: "center",
								background: "rgba(255,255,255,0.08)",
								border: "1px solid rgba(255,255,255,0.12)",
								borderRadius: 99,
								display: "flex",
								gap: 8,
								padding: "8px 16px",
							}}
						>
							<div
								style={{
									alignItems: "center",
									background: "linear-gradient(135deg, #F2A93B, #E53935)",
									borderRadius: "50%",
									color: "white",
									display: "flex",
									fontSize: 14,
									fontWeight: 700,
									height: 28,
									justifyContent: "center",
									width: 28,
								}}
							>
								{authorName.charAt(0).toUpperCase()}
							</div>
							<span
								style={{
									color: "#ccddee",
									display: "flex",
									fontSize: 15,
									fontWeight: 600,
								}}
							>
								{authorName}
							</span>
						</div>

						{/* Date */}
						{dateLabel && (
							<div
								style={{
									color: "#8899aa",
									display: "flex",
									fontSize: 14,
								}}
							>
								{dateLabel}
							</div>
						)}
					</div>

					{/* Watermark */}
					<div style={{ alignItems: "center", display: "flex", gap: 6 }}>
						<div
							style={{
								color: "#F2A93B",
								display: "flex",
								fontSize: 13,
								fontWeight: 700,
							}}
						>
							azalee.rosegriffon.fr
						</div>
					</div>
				</div>
			</div>
		</div>,
		{ ...size }
	);
}
