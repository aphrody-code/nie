import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";

export const runtime = "edge";

/**
 * GET /api/og/character?id=...
 */
export async function GET(request: NextRequest) {
	try {
		const { searchParams } = new URL(request.url);
		const name = searchParams.get("name") || "Personnage";
		const element = searchParams.get("element") || "neutral";
		const rarity = searchParams.get("rarity") || "N";
		const imageUrl = searchParams.get("image");

		// Element colors mapping
		const elementColors: Record<string, string> = {
			earth: "#f59e0b",
			fire: "#ef4444",
			neutral: "#94a3b8",
			wind: "#3b82f6",
			wood: "#22c55e",
		};

		const accentColor = elementColors[element.toLowerCase()] || elementColors.neutral;

		return new ImageResponse(
			<div
				style={{
					alignItems: "center",
					backgroundColor: "#1a120d",
					backgroundImage: "radial-gradient(circle at 50% 50%, #2d1f14 0%, #1a120d 100%)",
					display: "flex",
					flexDirection: "column",
					fontFamily: "sans-serif",
					height: "100%",
					justifyContent: "center",
					padding: "40px",
					width: "100%",
				}}
			>
				<div
					style={{
						alignItems: "center",
						backgroundColor: "rgba(0,0,0,0.3)",
						border: `1px solid ${accentColor}`,
						borderRadius: "100px",
						display: "flex",
						padding: "8px 16px",
						position: "absolute",
						right: "20px",
						top: "20px",
					}}
				>
					<span style={{ color: "#fff", fontSize: "20px", fontWeight: "bold" }}>
						Azalée IE Wiki
					</span>
				</div>

				<div
					style={{
						alignItems: "center",
						display: "flex",
						flexDirection: "row",
						gap: "40px",
						justifyContent: "flex-start",
						width: "100%",
					}}
				>
					{imageUrl && (
						<div
							style={{
								border: `4px solid ${accentColor}`,
								borderRadius: "28px",
								boxShadow: "0 20px 50px rgba(0,0,0,0.5)",
								display: "flex",
								overflow: "hidden",
							}}
						>
							{/* eslint-disable-next-line @next/next/no-img-element */}
							<img
								src={imageUrl}
								alt={name}
								width="300"
								height="300"
								style={{ objectFit: "cover" }}
							/>
						</div>
					)}

					<div style={{ display: "flex", flex: 1, flexDirection: "column" }}>
						<div
							style={{
								alignItems: "center",
								display: "flex",
								marginBottom: "12px",
							}}
						>
							<div
								style={{
									backgroundColor: accentColor,
									borderRadius: "50%",
									height: "12px",
									marginRight: "12px",
									width: "12px",
								}}
							/>
							<span
								style={{
									color: accentColor,
									fontSize: "24px",
									fontWeight: "bold",
									textTransform: "uppercase",
								}}
							>
								{element} · {rarity}
							</span>
						</div>
						<h1
							style={{
								color: "#fff",
								fontSize: "64px",
								fontWeight: "900",
								lineHeight: "1.1",
								margin: "0 0 20px 0",
								textShadow: "0 4px 10px rgba(0,0,0,0.5)",
							}}
						>
							{name}
						</h1>
						<p
							style={{
								color: "#bba998",
								fontSize: "24px",
								lineHeight: "1.5",
								margin: 0,
							}}
						>
							Découvrez les statistiques, techniques et talents de {name} sur Azalée, le wiki
							francophone de Victory Road.
						</p>
					</div>
				</div>

				<div
					style={{
						alignItems: "center",
						bottom: "20px",
						display: "flex",
						gap: "10px",
						left: "40px",
						position: "absolute",
					}}
				>
					<div
						style={{
							backgroundColor: accentColor,
							height: "4px",
							width: "40px",
						}}
					/>
					<span style={{ color: "#6b5d52", fontSize: "16px" }}>rosegriffon.fr</span>
				</div>
			</div>,
			{
				height: 630,
				width: 1200,
			}
		);
	} catch (error: any) {
		console.error(`[OG Error] ${error.message}`);
		return new Response("Failed to generate image", { status: 500 });
	}
}
