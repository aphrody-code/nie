"use client";

import Image from "next/image";
import {
	TacticCard as SharedTacticCard,
	type TacticCardProps as SharedTacticCardProps,
} from "@niers/inacord-ui/components/wiki/wiki/TacticCard";

export type TacticCardProps = Omit<SharedTacticCardProps, "renderImage">;

/** Azalée adapter: it keeps Next image handling while the card UI is shared. */
export function TacticCard(props: TacticCardProps) {
	return (
		<SharedTacticCard
			{...props}
			renderImage={({ src, alt, className, onError }) => (
				<Image
					src={src}
					alt={alt}
					fill
					sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
					className={className}
					unoptimized
					onError={onError}
				/>
			)}
		/>
	);
}
