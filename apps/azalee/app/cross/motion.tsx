"use client";

/**
 * Primitives d'animation pour la page /cross.
 *
 * Reproduisent fidèlement les animations du site officiel inazuma-cross.jp :
 *  - Reveal : éléments `.animation` → `.is-action` au scroll (IntersectionObserver,
 *    seuil ~20 % du viewport). Effet `fadeup` (translateY(20→0)+opacity) — cf. home.css @keyframes fadeup.
 *  - KenBurns : boucle lente du key visual (équivalent @keyframes bgLoop : pan/zoom continu).
 *  - StampPop : tampons « 達成 » des récompenses (scale 2.5→0.9→1.05→1, staggered) — @keyframes stamp-pop.
 *  - Carousel : remplace Swiper 11 (slidesPerView auto, navigation prev/next + dots).
 *  - Float : flottement doux des éléments décoratifs.
 *
 * GARANTIE ANTI-INVISIBILITÉ : aucun contenu ne reste à opacity:0.
 *  - reduced-motion → rendu statique, opacity:1 immédiat.
 *  - sinon, l'animation `show` est déclenchée soit à l'entrée dans le viewport
 *    (IntersectionObserver via `whileInView`), soit AU MONTAGE après un court délai
 *    de garde (fallback). Si l'observer ne fire jamais (capture headless, viewport
 *    bizarre, contenu déjà au-dessus de la ligne de flottaison), le fallback force
 *    l'état `show` → le contenu devient visible quoi qu'il arrive.
 *
 * Tout respecte `prefers-reduced-motion` (motion/react `useReducedMotion`).
 */

import { useReducedMotion, motion, useInView, type Variants } from "motion/react";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";

// fadeup : translateY(20px)+opacity 0 → 0+1, cubic-bezier proche du site (ease-out doux).
const FADEUP: Variants = {
	hidden: { opacity: 0, y: 24 },
	show: {
		opacity: 1,
		y: 0,
		transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] },
	},
};

const FADEUP_BLUR: Variants = {
	hidden: { opacity: 0, y: 16, filter: "blur(12px)" },
	show: {
		opacity: 1,
		y: 0,
		filter: "blur(0px)",
		transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1] },
	},
};

/**
 * Garde anti-invisibilité ROBUSTE.
 *
 * Combine deux déclencheurs et renvoie l'état d'animation cible (`"show"` | `"hidden"`)
 * piloté par `animate` (PAS par `whileInView` — qui, couplé à `viewport`, ignore le
 * fallback `animate` tant que l'élément n'est jamais entré dans le viewport, ce qui
 * laissait du contenu bloqué à opacity:0) :
 *  1. `useInView(ref)` — reveal au scroll (IntersectionObserver, `once`).
 *  2. fallback monté → après `delayMs`, on force `show` quoi qu'il arrive.
 *
 * Garantit qu'AUCUN contenu ne reste invisible : si l'observer ne fire jamais
 * (capture headless, élément hors-flux, viewport atypique), le fallback prend le relais.
 */
function useReveal(
	ref: React.RefObject<Element | null>,
	{ amount = 0.2, delayMs = 500 }: { amount?: number; delayMs?: number } = {},
): "show" | "hidden" {
	const inView = useInView(ref, { once: true, amount, margin: "0px 0px -8% 0px" });
	const [forced, setForced] = useState(false);
	useEffect(() => {
		const t = setTimeout(() => setForced(true), delayMs);
		return () => clearTimeout(t);
	}, [delayMs]);
	return inView || forced ? "show" : "hidden";
}

export function Reveal({
	children,
	className,
	delay = 0,
	blur = false,
	as = "div",
	amount = 0.2,
}: {
	children: ReactNode;
	className?: string;
	delay?: number;
	blur?: boolean;
	as?: "div" | "section" | "li" | "article";
	amount?: number;
}) {
	const reduce = useReducedMotion();
	const ref = useRef<HTMLDivElement>(null);
	const state = useReveal(ref, { amount });
	const MotionTag = motion[as] as typeof motion.div;
	if (reduce) {
		const Tag = as;
		return <Tag className={className}>{children}</Tag>;
	}
	return (
		<MotionTag
			ref={ref}
			className={className}
			variants={blur ? FADEUP_BLUR : FADEUP}
			initial="hidden"
			animate={state}
			transition={{ delay }}
		>
			{children}
		</MotionTag>
	);
}

/** Conteneur qui décale (stagger) le reveal de ses enfants `RevealChild`. */
export function RevealGroup({
	children,
	className,
	stagger = 0.1,
	as = "div",
}: {
	children: ReactNode;
	className?: string;
	stagger?: number;
	as?: "div" | "ul" | "section";
}) {
	const reduce = useReducedMotion();
	const ref = useRef<HTMLDivElement>(null);
	const state = useReveal(ref, { amount: 0.1 });
	const MotionTag = motion[as] as typeof motion.div;
	if (reduce) {
		const Tag = as;
		return <Tag className={className}>{children}</Tag>;
	}
	return (
		<MotionTag
			ref={ref}
			className={className}
			initial="hidden"
			animate={state}
			variants={{
				hidden: {},
				show: { transition: { staggerChildren: stagger } },
			}}
		>
			{children}
		</MotionTag>
	);
}

export function RevealChild({
	children,
	className,
	blur = false,
	as = "div",
}: {
	children: ReactNode;
	className?: string;
	blur?: boolean;
	as?: "div" | "li" | "article";
}) {
	const reduce = useReducedMotion();
	const MotionTag = motion[as] as typeof motion.div;
	if (reduce) {
		const Tag = as;
		return <Tag className={className}>{children}</Tag>;
	}
	// Les enfants héritent de l'orchestration du parent RevealGroup (variants hidden/show).
	// Si le parent force `show` (fallback), les enfants suivent → jamais bloqués invisibles.
	return (
		<MotionTag className={className} variants={blur ? FADEUP_BLUR : FADEUP}>
			{children}
		</MotionTag>
	);
}

/** Tampon « 達成 » — reproduit @keyframes stamp-pop (overshoot puis settle), staggered au reveal. */
export function StampPop({
	src,
	alt,
	delay = 0,
	className,
}: {
	src: string;
	alt: string;
	delay?: number;
	className?: string;
}) {
	const reduce = useReducedMotion();
	const ref = useRef<HTMLImageElement>(null);
	const state = useReveal(ref, { amount: 0.4, delayMs: 900 });
	if (reduce) {
		// eslint-disable-next-line @next/next/no-img-element
		return <img src={src} alt={alt} className={className} />;
	}
	const settled = {
		scale: [2.4, 0.9, 1.05, 1] as number[],
		opacity: [0, 1, 1, 1] as number[],
	};
	return (
		<motion.img
			ref={ref}
			src={src}
			alt={alt}
			className={className}
			initial={{ scale: 2.4, opacity: 0 }}
			// piloté par `animate` (useReveal) → jamais bloqué invisible même sans trigger.
			animate={state === "show" ? settled : { scale: 2.4, opacity: 0 }}
			transition={{
				duration: 0.45,
				delay,
				ease: [0.18, 0.89, 0.32, 1.28],
				times: [0, 0.55, 0.8, 1],
			}}
		/>
	);
}

/**
 * KenBurns : enveloppe le key visual du hero et applique une boucle lente
 * de pan + zoom (équivalent @keyframes bgLoop du site, qui fait défiler la
 * background-position en continu). Désactivé en reduced-motion.
 * Le contenu reste TOUJOURS visible (pas d'opacity:0).
 */
export function KenBurns({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	const reduce = useReducedMotion();
	if (reduce) return <div className={className}>{children}</div>;
	return (
		<motion.div
			className={className}
			initial={{ scale: 1.06, x: "-1%", y: "-1%" }}
			animate={{ scale: [1.06, 1.14, 1.06], x: ["-1%", "1%", "-1%"], y: ["-1%", "1%", "-1%"] }}
			transition={{ duration: 28, ease: "easeInOut", repeat: Infinity }}
		>
			{children}
		</motion.div>
	);
}

/** Flottement doux (décoratif). Le contenu reste visible. */
export function Float({
	children,
	className,
	distance = 8,
	duration = 4,
}: {
	children: ReactNode;
	className?: string;
	distance?: number;
	duration?: number;
}) {
	const reduce = useReducedMotion();
	if (reduce) return <div className={className}>{children}</div>;
	return (
		<motion.div
			className={className}
			animate={{ y: [0, -distance, 0] }}
			transition={{ duration, ease: "easeInOut", repeat: Infinity }}
		>
			{children}
		</motion.div>
	);
}

/**
 * Carousel : remplace le Swiper 11 du site (slidesPerView auto, snap, nav prev/next + dots).
 * Scroll-snap natif + boutons + indicateurs. Mobile-first, drag tactile via overflow.
 */
export function Carousel({
	children,
	count,
	className,
	itemClassName,
	ariaLabel,
}: {
	children: ReactNode[];
	count: number;
	className?: string;
	itemClassName?: string;
	ariaLabel: string;
}) {
	const trackRef = useRef<HTMLDivElement>(null);
	const [active, setActive] = useState(0);

	const scrollToIndex = useCallback((i: number) => {
		const track = trackRef.current;
		if (!track) return;
		const child = track.children[i] as HTMLElement | undefined;
		if (child) {
			track.scrollTo({ left: child.offsetLeft - track.offsetLeft, behavior: "smooth" });
		}
	}, []);

	const onScroll = useCallback(() => {
		const track = trackRef.current;
		if (!track) return;
		const center = track.scrollLeft + track.clientWidth / 2;
		let best = 0;
		let bestDist = Infinity;
		Array.from(track.children).forEach((c, i) => {
			const el = c as HTMLElement;
			const mid = el.offsetLeft - track.offsetLeft + el.clientWidth / 2;
			const d = Math.abs(mid - center);
			if (d < bestDist) {
				bestDist = d;
				best = i;
			}
		});
		setActive(best);
	}, []);

	useEffect(() => {
		const track = trackRef.current;
		if (!track) return;
		track.addEventListener("scroll", onScroll, { passive: true });
		return () => track.removeEventListener("scroll", onScroll);
	}, [onScroll]);

	return (
		<div className={className} role="group" aria-label={ariaLabel}>
			<div className="relative">
				<div
					ref={trackRef}
					className="flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
				>
					{children.map((child, i) => (
						<div key={i} className={`shrink-0 snap-center ${itemClassName ?? ""}`}>
							{child}
						</div>
					))}
				</div>
				<button
					type="button"
					aria-label="Précédent"
					onClick={() => scrollToIndex(Math.max(0, active - 1))}
					disabled={active <= 0}
					className="absolute top-1/2 left-1 z-10 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-surface/80 text-on-surface shadow-level-1 backdrop-blur transition hover:bg-surface disabled:opacity-30 md:size-9 sm:-left-3"
				>
					‹
				</button>
				<button
					type="button"
					aria-label="Suivant"
					onClick={() => scrollToIndex(Math.min(count - 1, active + 1))}
					disabled={active >= count - 1}
					className="absolute top-1/2 right-1 z-10 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-surface/80 text-on-surface shadow-level-1 backdrop-blur transition hover:bg-surface disabled:opacity-30 md:size-9 sm:-right-3"
				>
					›
				</button>
			</div>
			<div className="mt-3 flex justify-center gap-2">
				{Array.from({ length: count }).map((_, i) => (
					<button
						key={i}
						type="button"
						aria-label={`Aller à l'élément ${i + 1}`}
						onClick={() => scrollToIndex(i)}
						className={`h-2 rounded-full transition-all ${
							i === active ? "w-6 bg-primary" : "w-2 bg-outline-variant"
						}`}
					/>
				))}
			</div>
		</div>
	);
}
