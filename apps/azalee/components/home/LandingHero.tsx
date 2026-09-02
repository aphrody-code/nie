"use client";

import { ArrowDown } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import Image from "next/image";
import { useEffect, useState } from "react";
import { GlobalSearch } from "@/components/wiki/GlobalSearch";
import type { WikiSectionStats } from "./WikiCarousel";

/**
 * Key visuals qui défilent en fond du hero (crossfade).
 * Choisis pour leur format paysage et leur cohérence DA Inazuma,
 * lisibles derrière le gradient d'assombrissement.
 */
const HERO_BACKGROUNDS = [
	{
		src: "/sky.webp",
		// Position horizontale du Ken Burns ajustée par visuel pour garder le sujet cadré.
		objectPosition: "center 35%",
	},
	{
		src: "/ievr.webp",
		objectPosition: "center 30%",
	},
	{
		src: "/og-image-home.webp",
		objectPosition: "center 40%",
	},
] as const;

// Durée d'affichage de chaque fond (cycle) et durée du crossfade.
const HERO_CYCLE_MS = 7000;
const HERO_CROSSFADE_S = 1.3;

interface LandingHeroProps {
	stats?: WikiSectionStats;
}

export function LandingHero({ stats }: LandingHeroProps) {
	// Multi-layer parallax driven by page scroll
	const prefersReducedMotion = useReducedMotion();
	const { scrollY } = useScroll();
	const backgroundY = useTransform(scrollY, [0, 600], [0, -300]);
	const mascotY = useTransform(scrollY, [0, 600], [0, -150]);
	const foregroundY = useTransform(scrollY, [0, 600], [0, -75]);

	// Respect reduced motion: pin everything at 0.
	const bgStyle = prefersReducedMotion ? undefined : { y: backgroundY };
	const mascotStyle = prefersReducedMotion ? undefined : { y: mascotY };
	const foregroundStyle = prefersReducedMotion ? undefined : { y: foregroundY };

	// Cycle automatique des key visuals — figé sur la 1re image si motion réduit
	// ou si un seul visuel est configuré.
	const [bgIndex, setBgIndex] = useState(0);
	useEffect(() => {
		if (prefersReducedMotion || HERO_BACKGROUNDS.length <= 1) return;
		const id = window.setInterval(() => {
			setBgIndex((i) => (i + 1) % HERO_BACKGROUNDS.length);
		}, HERO_CYCLE_MS);
		return () => window.clearInterval(id);
	}, [prefersReducedMotion]);

	const activeBg = HERO_BACKGROUNDS[bgIndex] ?? HERO_BACKGROUNDS[0];

	const handleScrollToContent = () => {
		const contentElement = document.querySelector("#home-content");
		if (contentElement) {
			contentElement.scrollIntoView({ behavior: "smooth", block: "start" });
		}
	};

	const statPills = stats
		? [
				{ count: stats.characters, label: "joueurs" },
				{ count: stats.skills, label: "techniques" },
				{ count: stats.items, label: "objets" },
			].filter((s) => s.count > 0)
		: [];

	return (
		<section className="relative h-[90svh] min-h-[520px] md:h-[75vh] md:min-h-[520px] md:max-h-[700px] overflow-hidden bg-black w-auto -mx-4 md:-mx-8 lg:-mx-12">
			{/* Background switcher with parallax wrapper (layer 1 — deepest, -300px).
			    Plusieurs key visuals défilent en crossfade ; Ken Burns sur l'actif.
			    Motion réduit → 1re image statique, sans cycle ni zoom. */}
			<motion.div style={bgStyle} className="absolute inset-0 will-change-transform">
				{prefersReducedMotion ? (
					<Image
						src={HERO_BACKGROUNDS[0].src}
						alt=""
						fill
						priority
						sizes="100vw"
						style={{ objectPosition: HERO_BACKGROUNDS[0].objectPosition }}
						className="object-cover opacity-70 scale-105"
					/>
				) : (
					<AnimatePresence initial={false}>
						<motion.div
							key={activeBg.src}
							initial={{ opacity: 0 }}
							animate={{ opacity: 0.7 }}
							exit={{ opacity: 0 }}
							transition={{ duration: HERO_CROSSFADE_S, ease: "easeInOut" }}
							className="absolute inset-0"
						>
							<Image
								src={activeBg.src}
								alt=""
								fill
								// 1re image préchargée ; les suivantes en lazy.
								priority={bgIndex === 0}
								loading={bgIndex === 0 ? undefined : "lazy"}
								sizes="100vw"
								style={{ objectPosition: activeBg.objectPosition }}
								className="hero-kenburns object-cover"
							/>
						</motion.div>
					</AnimatePresence>
				)}
			</motion.div>

			{/* Gradient Overlays — layered for depth */}
			<div className="absolute inset-0 z-0 bg-linear-to-b from-black/40 via-black/50 to-background" />
			<div className="absolute inset-0 z-0 bg-linear-to-r from-black/30 via-transparent to-black/20 hidden md:block" />

			{/* CSS Particles */}
			<div className="absolute inset-0 z-10 overflow-hidden pointer-events-none" aria-hidden="true">
				<div className="hero-particle hero-particle-1" />
				<div className="hero-particle hero-particle-2" />
				<div className="hero-particle hero-particle-3" />
				<div className="hero-particle hero-particle-4" />
				<div className="hidden md:block hero-particle hero-particle-5" />
				<div className="hidden md:block hero-particle hero-particle-6" />
			</div>

			{/* ── Mobile Layout ── */}
			<div className="relative z-20 h-full flex flex-col md:hidden">
				{/* Ambient Reika — more visible on mobile (layer 2 — mascot, -150px) */}
				<motion.div
					style={mascotStyle}
					className="absolute bottom-0 left-0 right-0 w-full pointer-events-none flex justify-center"
					aria-hidden="true"
				>
					<div className="w-[80%] max-w-[300px]">
						<div className="relative animate-[mascotEntrance_1.2s_ease-out_0.3s_both]">
							<div className="absolute -inset-8 bg-[#F4D03F]/15 blur-[60px] rounded-full animate-[glowPulse_4s_ease-in-out_infinite]" />
							<Image
								src="/reika.webp"
								alt=""
								width={300}
								height={375}
								sizes="80vw"
								priority
								className="object-contain opacity-25 dark:opacity-20"
							/>
						</div>
					</div>
				</motion.div>

				{/* Content (layer 3 — foreground, -75px) */}
				<motion.div
					style={foregroundStyle}
					className="flex-1 flex flex-col items-center justify-center px-6"
				>
					<div className="flex flex-col items-center justify-center -translate-y-[5vh] animate-[fadeSlideUp_0.8s_ease-out_0.2s_both]">
						<Image
							src="/ie.webp"
							alt="Inazuma Eleven Logo"
							width={280}
							height={160}
							priority
							className="h-14 object-contain drop-shadow-[0_0_25px_rgba(240,125,125,0.4)] animate-[gentleFloat_4s_ease-in-out_infinite]"
						/>

						<p className="mt-4 text-[1.5rem] leading-tight font-black text-white text-center drop-shadow-lg">
							L&apos;encyclopédie
							<br />
							<span className="bg-clip-text text-transparent bg-linear-to-r from-[#F07D7D] via-[#F4D03F] to-[#F07D7D] bg-300% animate-gradient">
								Inazuma Eleven
							</span>
						</p>

						<p className="mt-2 text-sm text-white/60 text-center max-w-[280px]">
							Joueurs, techniques, objets et actus en français.
						</p>

						{/* Search CTA with glow */}
						<div className="mt-5 w-full max-w-[300px] hero-search-glow rounded-2xl">
							<GlobalSearch isMobileHero />
						</div>
					</div>
				</motion.div>

				{/* Scroll indicator */}
				<div className="relative z-30 flex justify-center pb-24">
					<button
						onClick={handleScrollToContent}
						className="flex flex-col items-center gap-1.5 animate-[fadeSlideUp_0.6s_ease-out_2s_both]"
						aria-label="Défiler vers le contenu"
					>
						<span className="text-[10px] font-bold uppercase tracking-widest text-white/40">
							Explorer
						</span>
						<div className="p-1.5 rounded-full bg-white/5 border border-white/10">
							<ArrowDown className="size-4 text-white/60" />
						</div>
					</button>
				</div>
			</div>

			{/* ── Desktop Layout ── */}
			<div className="relative z-20 container mx-auto h-full hidden md:flex flex-row items-center justify-center gap-12 lg:gap-20 px-4 pt-6">
				{/* Left: Text & CTA (layer 3 — foreground, -75px) */}
				<motion.div
					style={foregroundStyle}
					className="flex flex-col items-start text-left space-y-5 max-w-xl animate-[fadeSlideUp_0.8s_ease-out_0.2s_both]"
				>
					<Image
						src="/ie.webp"
						alt="Inazuma Eleven Logo"
						width={320}
						height={180}
						priority
						className="h-28 lg:h-32 object-contain mb-4 drop-shadow-[0_0_30px_rgba(240,125,125,0.5)] animate-[gentleFloat_4s_ease-in-out_infinite]"
					/>

					<h1 className="type-display-small lg:type-display-medium font-black text-white drop-shadow-lg max-w-lg">
						L&apos;information la plus précise autour d&apos;
						<span className="bg-clip-text text-transparent bg-linear-to-r from-[#F07D7D] via-[#F4D03F] to-[#F07D7D] bg-300% animate-gradient">
							Inazuma Eleven
						</span>
						.
					</h1>

					{/* Stat pills */}
					{statPills.length > 0 && (
						<div className="flex items-center gap-2 flex-wrap animate-[fadeSlideUp_0.6s_ease-out_0.6s_both]">
							{statPills.map((pill, i) => (
								<span key={pill.label}>
									<span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-white/10 backdrop-blur-md border border-white/15 text-white/90 text-sm font-bold shadow-lg">
										<span className="text-[#F4D03F]">{pill.count.toLocaleString("fr-FR")}+</span>{" "}
										{pill.label}
									</span>
									{i < statPills.length - 1 && <span className="mx-1 text-white/20">·</span>}
								</span>
							))}
						</div>
					)}

					{/* Desktop Search */}
					<div className="w-full max-w-md hero-search-glow rounded-2xl animate-[fadeSlideUp_0.6s_ease-out_0.8s_both]">
						<GlobalSearch isHero />
					</div>
				</motion.div>

				{/* Right: Mascot Reika (layer 2 — mascot, -150px) */}
				<motion.div
					style={mascotStyle}
					className="relative animate-[mascotEntrance_1s_ease-out_0.4s_both]"
				>
					<div className="relative w-[320px] h-[420px] lg:w-[420px] lg:h-[540px] animate-[gentleFloat_6s_ease-in-out_infinite]">
						{/* Multi-layered glow behind mascot */}
						<div className="absolute top-1/3 left-1/4 w-2/3 h-2/3 bg-[#F4D03F]/25 blur-[100px] rounded-full animate-[glowPulse_4s_ease-in-out_infinite]" />
						<div className="absolute bottom-1/4 right-1/4 w-1/2 h-1/2 bg-[#B03A2E]/20 blur-[80px] rounded-full animate-[glowPulse_4s_ease-in-out_1s_infinite]" />
						<div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-3/4 h-3/4 bg-[#F07D7D]/10 blur-[120px] rounded-full" />

						{/* Mascot image with enhanced drop shadow */}
						<Image
							src="/reika.webp"
							alt="Reika, mascotte vue en plongée : cheveux roses corail en haute queue-de-cheval, pull jaune, regard déterminé et confiant"
							width={420}
							height={540}
							sizes="(max-width: 1024px) 320px, 420px"
							priority
							className="w-full h-full object-contain relative z-10 drop-shadow-[0_10px_40px_rgba(0,0,0,0.4)]"
						/>
					</div>
				</motion.div>
			</div>

			{/* Desktop Scroll Down Indicator */}
			<div
				className="absolute bottom-8 left-1/2 -translate-x-1/2 z-30 cursor-pointer animate-[fadeSlideUp_1s_ease-out_1.5s_both] hidden md:block"
				onClick={handleScrollToContent}
				role="button"
				tabIndex={0}
				aria-label="Défiler vers le contenu"
				onKeyDown={(e) => {
					if (e.key === "Enter" || e.key === " ") {
						handleScrollToContent();
					}
				}}
			>
				<div className="flex flex-col items-center gap-2 group animate-[gentleBounce_2s_ease-in-out_infinite]">
					<span
						className="text-xs font-bold uppercase tracking-widest text-white/50 group-hover:text-[#F07D7D] transition-colors"
						aria-hidden="true"
					>
						Explorer
					</span>
					<div className="p-2 rounded-full bg-white/5 border border-white/10 backdrop-blur-sm group-hover:border-[#F07D7D]/50 group-hover:bg-[#F07D7D]/10 transition-all">
						<ArrowDown className="size-5 text-white group-hover:text-[#F07D7D]" />
					</div>
				</div>
			</div>
		</section>
	);
}
