"use client";

import type { TouchEvent } from "react";
import { useEffect, useRef } from "react";

interface SwipeInput {
	onSwipedLeft?: () => void;
	onSwipedRight?: () => void;
	onSwipedUp?: () => void;
	onSwipedDown?: () => void;
	delta?: number;
}

interface SwipeOutput {
	onTouchStart: (e: TouchEvent) => void;
	onTouchMove: (e: TouchEvent) => void;
	onTouchEnd: () => void;
}

/**
 * Hook pour détecter les gestes de swipe sur les écrans tactiles
 */
export function useSwipe({
	onSwipedLeft,
	onSwipedRight,
	onSwipedUp,
	onSwipedDown,
	delta = 50, // Distance minimale pour considérer un swipe
}: SwipeInput): SwipeOutput {
	const touchStart = useRef<{ x: number; y: number } | null>(null);
	const touchEnd = useRef<{ x: number; y: number } | null>(null);

	const onTouchStart = (e: TouchEvent) => {
		touchEnd.current = null;
		const touch = e.targetTouches[0];
		if (touch) {
			touchStart.current = {
				x: touch.clientX,
				y: touch.clientY,
			};
		}
	};

	const onTouchMove = (e: TouchEvent) => {
		const touch = e.targetTouches[0];
		if (touch) {
			touchEnd.current = {
				x: touch.clientX,
				y: touch.clientY,
			};
		}
	};

	const onTouchEnd = () => {
		if (!touchStart.current || !touchEnd.current) {
			return;
		}

		const distanceX = touchStart.current.x - touchEnd.current.x;
		const distanceY = touchStart.current.y - touchEnd.current.y;
		const isLeftSwipe = distanceX > delta;
		const isRightSwipe = distanceX < -delta;
		const isUpSwipe = distanceY > delta;
		const isDownSwipe = distanceY < -delta;

		// Déterminer si c'est un swipe horizontal ou vertical
		if (Math.abs(distanceX) > Math.abs(distanceY)) {
			// Swipe horizontal
			if (isLeftSwipe && onSwipedLeft) {
				onSwipedLeft();
			} else if (isRightSwipe && onSwipedRight) {
				onSwipedRight();
			}
		} else {
			// Swipe vertical
			if (isUpSwipe && onSwipedUp) {
				onSwipedUp();
			} else if (isDownSwipe && onSwipedDown) {
				onSwipedDown();
			}
		}

		// Reset
		touchStart.current = null;
		touchEnd.current = null;
	};

	return {
		onTouchEnd,
		onTouchMove,
		onTouchStart,
	};
}

/**
 * Hook pour ajouter des événements de swipe à un élément DOM
 */
export function useSwipeElement(
	elementRef: React.RefObject<HTMLElement | null>,
	handlers: SwipeInput
) {
	const swipe = useSwipe(handlers);

	useEffect(() => {
		const element = elementRef.current;
		if (!element) {
			return;
		}

		const handleTouchStart = (e: globalThis.TouchEvent) => {
			swipe.onTouchStart(e as unknown as TouchEvent);
		};

		const handleTouchMove = (e: globalThis.TouchEvent) => {
			swipe.onTouchMove(e as unknown as TouchEvent);
		};

		const handleTouchEnd = () => {
			swipe.onTouchEnd();
		};

		element.addEventListener("touchstart", handleTouchStart, { passive: true });
		element.addEventListener("touchmove", handleTouchMove, { passive: true });
		element.addEventListener("touchend", handleTouchEnd);

		return () => {
			element.removeEventListener("touchstart", handleTouchStart);
			element.removeEventListener("touchmove", handleTouchMove);
			element.removeEventListener("touchend", handleTouchEnd);
		};
	}, [elementRef, swipe]);
}
