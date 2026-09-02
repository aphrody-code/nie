import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "Mon Équipe — Azalée";
export const size = { height: 630, width: 1200 };
export const contentType = "image/png";

const DOTS = [
	{ color: "#dc2626", x: 250, y: 120 },
	{ color: "#dc2626", x: 950, y: 120 },
	{ color: "#10b981", x: 600, y: 170 },
	{ color: "#10b981", x: 350, y: 280 },
	{ color: "#10b981", x: 850, y: 280 },
	{ color: "#10b981", x: 600, y: 320 },
	{ color: "#3b82f6", x: 250, y: 410 },
	{ color: "#3b82f6", x: 450, y: 440 },
	{ color: "#3b82f6", x: 750, y: 440 },
	{ color: "#3b82f6", x: 950, y: 410 },
	{ color: "#d97706", x: 600, y: 520 },
];

export default function OGImage() {
	return new ImageResponse(
		<div
			style={{
				alignItems: "center",
				background: "linear-gradient(135deg, #064e3b 0%, #065f46 50%, #047857 100%)",
				display: "flex",
				flexDirection: "column",
				height: "100%",
				justifyContent: "center",
				position: "relative",
				width: "100%",
			}}
		>
			<div
				style={{
					border: "2px solid rgba(255,255,255,0.2)",
					borderRadius: 8,
					display: "flex",
					inset: 40,
					position: "absolute",
				}}
			/>
			<div
				style={{
					borderTop: "2px solid rgba(255,255,255,0.15)",
					display: "flex",
					left: 40,
					position: "absolute",
					right: 40,
					top: 315,
				}}
			/>
			{DOTS.map((dot, i) => (
				<div
					key={i}
					style={{
						backgroundColor: dot.color,
						borderRadius: "50%",
						boxShadow: `0 0 12px ${dot.color}80`,
						display: "flex",
						height: 24,
						left: dot.x - 12,
						opacity: 0.8,
						position: "absolute",
						top: dot.y - 12,
						width: 24,
					}}
				/>
			))}
			<div
				style={{
					bottom: 40,
					display: "flex",
					flexDirection: "column",
					gap: 8,
					left: 60,
					position: "absolute",
				}}
			>
				<div
					style={{
						color: "white",
						display: "flex",
						fontSize: 48,
						fontWeight: 800,
						letterSpacing: 2,
					}}
				>
					Mon Équipe
				</div>
				<div style={{ color: "rgba(255,255,255,0.6)", display: "flex", fontSize: 22 }}>
					Créez votre équipe Inazuma Eleven idéale
				</div>
			</div>
			<div
				style={{
					alignItems: "center",
					bottom: 50,
					display: "flex",
					gap: 10,
					position: "absolute",
					right: 60,
				}}
			>
				<div style={{ color: "#F2A93B", display: "flex", fontSize: 28, fontWeight: 800 }}>
					Azalée
				</div>
			</div>
		</div>,
		{ ...size }
	);
}
