"use client";

import { motion, useInView, useReducedMotion } from "motion/react";
import { Children, isValidElement, useRef } from "react";

type AnimationDirection = "up" | "left" | "right" | "scale";

interface AnimatedSectionProps {
	children: React.ReactNode;
	className?: string;
	delay?: number;
	direction?: AnimationDirection;
	/** Stagger delay (in seconds) between direct children */
	stagger?: number;
}

const directionClass: Record<AnimationDirection, string> = {
	left: "scroll-reveal-left",
	right: "scroll-reveal-right",
	scale: "scroll-reveal-scale",
	up: "scroll-reveal-up",
};

// MD3 emphasized-decelerate easing
const EMPHASIZED_DECELERATE: [number, number, number, number] = [0.05, 0.7, 0.1, 1];

const initialByDirection: Record<
	AnimationDirection,
	{ opacity: number; x?: number; y?: number; scale?: number }
> = {
	left: { opacity: 0, x: -40 },
	right: { opacity: 0, x: 40 },
	scale: { opacity: 0, scale: 0.92 },
	up: { opacity: 0, y: 40 },
};

const visibleByDirection: Record<
	AnimationDirection,
	{ opacity: number; x?: number; y?: number; scale?: number }
> = {
	left: { opacity: 1, x: 0 },
	right: { opacity: 1, x: 0 },
	scale: { opacity: 1, scale: 1 },
	up: { opacity: 1, y: 0 },
};

export function AnimatedSection({
	children,
	className,
	delay = 0,
	direction = "up",
	stagger,
}: AnimatedSectionProps) {
	const ref = useRef<HTMLDivElement>(null);
	const inView = useInView(ref, { margin: "-60px 0px -60px 0px", once: true });
	const prefersReducedMotion = useReducedMotion();

	const initial = prefersReducedMotion ? { opacity: 1 } : initialByDirection[direction];
	const animate = prefersReducedMotion
		? { opacity: 1 }
		: inView
			? visibleByDirection[direction]
			: initialByDirection[direction];

	// Stagger: wrap each direct child in a motion.div with incremental delay.
	if (stagger && !prefersReducedMotion) {
		const childrenArray = Children.toArray(children);
		return (
			<div
				ref={ref}
				className={`${directionClass[direction]} ${inView ? "scroll-reveal-visible" : ""} ${className || ""}`}
			>
				{childrenArray.map((child, index) => {
					const key = isValidElement(child) && child.key != null ? child.key : index;
					return (
						<motion.div
							key={key}
							initial={initial}
							animate={animate}
							transition={{
								delay: delay + index * stagger,
								duration: 0.7,
								ease: EMPHASIZED_DECELERATE,
							}}
							className="scroll-stagger-child"
						>
							{child}
						</motion.div>
					);
				})}
			</div>
		);
	}

	return (
		<motion.div
			ref={ref}
			className={`${directionClass[direction]} ${inView || prefersReducedMotion ? "scroll-reveal-visible" : ""} ${className || ""}`}
			initial={initial}
			animate={animate}
			transition={{
				delay,
				duration: 0.7,
				ease: EMPHASIZED_DECELERATE,
			}}
		>
			{children}
		</motion.div>
	);
}
