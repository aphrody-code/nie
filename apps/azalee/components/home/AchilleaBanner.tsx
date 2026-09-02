import { Zap } from "lucide-react";
import localFont from "next/font/local";
import Image from "next/image";

import { Button, Card, CardContent } from "@rosegriffon/ui";

const humane = localFont({
	display: "swap",
	src: "../../public/fonts/Humane-Regular.otf",
	variable: "--font-humane",
});

const DiscordIcon = ({ className }: { className?: string }) => (
	<svg
		viewBox="0 0 24 24"
		fill="currentColor"
		className={className}
		xmlns="http://www.w3.org/2000/svg"
	>
		<path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515a.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0a12.64 12.64 0 0 0-.617-1.25a.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057a19.9 19.9 0 0 0 5.993 3.03a.078.078 0 0 0 .084-.028a14.09 14.09 0 0 0 1.226-1.994a.076.076 0 0 0-.041-.106a13.107 13.107 0 0 1-1.872-.892a.077.077 0 0 1-.008-.128a10.2 10.2 0 0 0 .372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127a12.299 12.299 0 0 1-1.873.892a.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028a19.839 19.839 0 0 0 6.002-3.03a.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.956-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.955-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.946 2.418-2.157 2.418z" />
	</svg>
);

export interface AchilleaBannerProps {
	description?: string;
	image?: string;
	link?: string;
	discordLink?: string;
}

function EsportBadge({ variant }: { variant: "mobile" | "desktop" }) {
	const isMobile = variant === "mobile";
	return (
		<div
			className={`inline-flex items-center gap-2 rounded-full font-bold uppercase tracking-wide px-3.5 py-1.5 bg-[#6d00ce]/25 border border-[#6d00ce]/45 text-white ${
				isMobile ? "text-[10px]" : "text-xs shadow-md"
			}`}
		>
			<Zap className="size-3 fill-[#DFFF57] text-[#DFFF57] animate-pulse" />
			E-Sport
		</div>
	);
}

function AchilleaLogo({ size }: { size: "sm" | "lg" }) {
	const cls = size === "sm" ? "size-10" : "size-14";
	return (
		<div className={`relative shrink-0 ${cls}`}>
			<Image
				src="/achillea/logo1.svg"
				alt="Logo Achillea"
				fill
				className="object-contain drop-shadow-[0_0_12px_rgba(223,255,87,0.7)]"
			/>
		</div>
	);
}

function AchilleaTitle({ className }: { className: string }) {
	return (
		<div className={`relative flex items-center justify-center md:justify-start ${className}`}>
			<Image
				src="/achillea/achillea site titre transparent-2.webp"
				alt="ACHILLEA"
				width={380}
				height={96}
				className="h-full w-auto object-contain drop-shadow-[0_2px_12px_rgba(223,255,87,0.4)]"
			/>
		</div>
	);
}

function AchilleaButtons({
	link,
	discordLink,
	variant,
}: {
	link: string;
	discordLink: string;
	variant: "mobile" | "desktop";
}) {
	const isMobile = variant === "mobile";
	return (
		<div className={isMobile ? "flex gap-3" : "flex flex-wrap gap-4 pt-2"}>
			<Button
				asChild
				size="lg"
				className={`bg-[#6d00ce] hover:bg-[#5a00ab] text-white font-black rounded-xl shadow-[0_0_20px_-5px_rgba(223,255,87,0.6)] transition-all duration-300 border border-[#DFFF57] cursor-pointer ${
					isMobile ? "flex-1" : "hover:shadow-[0_0_25px_-5px_rgba(223,255,87,0.8)] px-8"
				}`}
			>
				<a href={link} target="_blank" rel="noopener noreferrer">
					Site web
				</a>
			</Button>
			<Button
				asChild
				variant="outline"
				size="lg"
				className={`font-bold rounded-xl transition-all duration-300 backdrop-blur-md bg-white/10 text-white border-white/20 hover:bg-white/20 hover:border-white/30 cursor-pointer ${
					isMobile ? "flex-1" : "px-8"
				}`}
			>
				<a href={discordLink} target="_blank" rel="noopener noreferrer">
					Discord
					<DiscordIcon className={`ml-2 ${isMobile ? "size-4" : "size-5"}`} />
				</a>
			</Button>
		</div>
	);
}

export function AchilleaBanner({
	description = "Le carrefour de l'esport Inazuma Eleven ! Gestion de clans, tournois, matchs classés, ranking communautaire et bot officiel.",
	image = "/achillea/bannière.webp",
	link = "https://achillea.rosegriffon.fr/",
	discordLink = "https://discord.gg/achillea-competitif-inazuma-eleven-fr-1055585286320554055",
}: AchilleaBannerProps) {
	return (
		<div className={`w-full ${humane.variable}`}>
			{/* ── Mobile: image-as-background, full-bleed ── */}
			<div className="md:hidden -mx-4 relative overflow-hidden">
				<Image
					src={image}
					alt="Bannière Achillea"
					fill
					className="object-cover object-center"
					sizes="100vw"
				/>
				<div className="absolute inset-0 bg-linear-to-t from-black/85 via-black/60 to-black/35" />
				<div className="absolute inset-0 bg-[url('/noise.svg')] opacity-10 mix-blend-overlay pointer-events-none" />
				<div className="absolute -right-10 -top-10 size-48 bg-[#6d00ce] rounded-full blur-[80px] opacity-20 pointer-events-none" />
				<div className="absolute -left-10 -bottom-10 size-48 bg-[#DFFF57] rounded-full blur-[80px] opacity-10 pointer-events-none" />

				<div className="relative z-10 p-5 flex flex-col items-center text-center gap-4">
					<div className="flex items-center gap-3 justify-center">
						<EsportBadge variant="mobile" />
						<AchilleaLogo size="sm" />
					</div>
					<AchilleaTitle className="h-14 max-w-[260px] mx-auto" />
					<p className="text-white/80 text-sm leading-relaxed font-medium line-clamp-2 max-w-[300px] mx-auto">
						{description}
					</p>
					<div className="w-full">
						<AchilleaButtons link={link} discordLink={discordLink} variant="mobile" />
					</div>
				</div>
			</div>

			{/* ── Desktop: side-by-side grid ── */}
			<Card className="hidden md:block overflow-hidden border border-[#6d00ce]/10 shadow-[0_0_40px_-10px_rgba(109,0,206,0.3)] bg-[#100720] relative group rounded-[32px] p-0">
				<div className="absolute inset-0 bg-[url('/noise.svg')] opacity-10 mix-blend-overlay pointer-events-none" />
				<div className="absolute -right-20 -top-20 size-96 bg-[#6d00ce] rounded-full blur-[128px] opacity-25 pointer-events-none" />
				<div className="absolute -left-20 -bottom-20 size-96 bg-[#DFFF57] rounded-full blur-[128px] opacity-10 pointer-events-none" />

				<div className="grid md:grid-cols-2 gap-0 relative z-20">
					<div className="relative h-auto w-full overflow-hidden">
						<Image
							src={image}
							alt="Bannière Achillea"
							fill
							className="object-cover object-center transition-transform duration-700 group-hover:scale-105"
							sizes="50vw"
						/>
					</div>

					<CardContent className="p-8 md:p-12 flex flex-col justify-center space-y-6 bg-transparent relative text-white">
						<div className="space-y-5">
							<div className="flex items-center justify-between w-full">
								<EsportBadge variant="desktop" />
								<AchilleaLogo size="lg" />
							</div>
							<div className="space-y-1">
								<AchilleaTitle className="h-20 md:h-24 max-w-md" />
								<div className="h-1 w-24 bg-linear-to-r from-[#6d00ce] to-transparent rounded-full opacity-80" />
							</div>
						</div>
						<p className="text-white/80 text-lg leading-relaxed max-w-md font-medium border-l-2 border-[#6d00ce]/40 pl-4">
							{description}
						</p>
						<AchilleaButtons link={link} discordLink={discordLink} variant="desktop" />
					</CardContent>
				</div>
			</Card>
		</div>
	);
}
