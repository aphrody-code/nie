"use client";

import {
	TacticCard as SharedTacticCard,
	type TacticCardProps as SharedTacticCardProps,
} from "@niers/inacord-ui/components/wiki/wiki/TacticCard";
import { Image } from "@niers/inacord-ui/components/ui/image";

export type TacticCardProps = Omit<SharedTacticCardProps, "renderImage">;

/** Desktop adapter: it keeps VFS-aware image handling while the card UI is shared. */
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
