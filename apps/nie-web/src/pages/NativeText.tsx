/** Accessible native bitmap text. No system-font substitute is drawn on failure. */
import { useAssetSource } from "@niers/inacord-ui";
import { useEffect, useRef, useState } from "react";
import { NATIVE_FONT_TEXTURE, nativeTextRaster } from "../game/native-font";

export function NativeText({ text, color = 0xffffffff, height = 71, width, onReady, onError }: {
	text: string; color?: number; height?: number; width?: number; onReady?: () => void; onError?: () => void;
}) {
	const source = useAssetSource();
	const canvas = useRef<HTMLCanvasElement>(null);
	const [failed, setFailed] = useState(false);
	useEffect(() => {
		let active = true;
		setFailed(false);
		if (canvas.current) {
			delete canvas.current.dataset.nativeTextReady;
			canvas.current.width = 1;
			canvas.current.height = 1;
		}
		nativeTextRaster(source, text, color).then(frame => {
			if (!active || !canvas.current) return;
			const target = canvas.current;
			target.width = frame.width;
			target.height = frame.height;
			target.style.width = `${width ?? frame.width * height / frame.height}px`;
			const ctx = target.getContext("2d");
			if (!ctx) throw new Error("Native text canvas unavailable");
			ctx.putImageData(new ImageData(new Uint8ClampedArray(frame.rgba), frame.width, frame.height), 0, 0);
			target.dataset.nativeTextReady = "true";
			onReady?.();
		}).catch(() => { if (active) { setFailed(true); onError?.(); } });
		return () => { active = false; };
	}, [source, text, color, height, width, onReady, onError]);
	return <canvas ref={canvas} role="img" aria-label={text} data-vfs-font={NATIVE_FONT_TEXTURE}
		data-native-text-error={failed || undefined} style={{ height, display: "inline-block", verticalAlign: "middle" }} />;
}
