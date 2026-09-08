import type { AssetSource } from "@niers/asset-source";
import { useEffect, useState, type CSSProperties } from "react";
import { NativeResources } from "./native-resources";

/** Decode the selected original G4TX in Rust; release its browser image when selection changes. */
export function NativeTexturePreview({ source, path, style, className, alt = "" }: {
	source: Pick<AssetSource, "urlFichier">; path: string; style?: CSSProperties; className?: string; alt?: string;
}) {
	const [result, setResult] = useState<{ path: string; source: typeof source; url?: string; failed?: boolean } | null>(null);
	useEffect(() => {
		const resources = new NativeResources(source);
		let active = true;
		let url: string | undefined;
		setResult(null);
		resources.texture(path).then(blob => {
			if (!active) return;
			url = URL.createObjectURL(blob);
			setResult({ path, source, url });
		}).catch(() => {
			if (active) setResult({ path, source, failed: true });
		});
		return () => {
			active = false;
			resources.dispose();
			if (url) URL.revokeObjectURL(url);
		};
	}, [source, path]);
	const current = result?.path === path && result.source === source ? result : null;
	if (current?.failed) return <p role="status">Texture indisponible.</p>;
	return current?.url ? <img src={current.url} alt={alt} style={style} className={className} /> : null;
}
