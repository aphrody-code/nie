"use client";

import {
	CapsuleCard as SharedCapsuleCard,
	CostumeCard as SharedCostumeCard,
	type CapsuleCardProps as SharedCapsuleCardProps,
	type CostumeCardProps as SharedCostumeCardProps,
} from "@niers/inacord-ui/components/wiki/wiki/GachaCard";
import type { CapsulePrize, Costume } from "@rosegriffon/azalee/wiki/gacha-shared";

export interface CapsuleCardProps extends Omit<SharedCapsuleCardProps, "prize"> { prize: CapsulePrize; }
export interface CostumeCardProps extends Omit<SharedCostumeCardProps, "costume"> { costume: Costume; }

/** Azalée facade retains its domain contracts while presentation is shared. */
export function CapsuleCard({ prize, ...props }: CapsuleCardProps) {
	return <SharedCapsuleCard {...props} prize={prize} />;
}

export function CostumeCard({ costume, ...props }: CostumeCardProps) {
	return <SharedCostumeCard {...props} costume={costume} />;
}
