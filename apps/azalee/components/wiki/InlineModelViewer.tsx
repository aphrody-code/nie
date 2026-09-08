"use client";

import { ModelViewerSurface } from "@niers/inacord-ui/three/ModelViewerSurface";
import { loadModelViewer } from "../../lib/model-viewer-loader";

interface InlineModelViewerProps {
	glbUrl: string;
	name?: string;
	autoRotate?: boolean;
}

/** Gallery adapter: suspend the shared viewer outside the visibility margin. */
export default function InlineModelViewer({ glbUrl, name, autoRotate = true }: InlineModelViewerProps) {
	return <ModelViewerSurface src={glbUrl} label={`Modèle 3D de ${name ?? "modèle"}`}
		loadViewer={loadModelViewer} observeVisibility checkAvailability
		autoRotate={autoRotate} rotationPerSecond="24deg" shadowIntensity="0.8" interactionPrompt="none">
		{({ loaded, errored, visible }) => <>
			{visible && !loaded && !errored && <div className="absolute inset-0 flex items-center justify-center">
				<div className="animate-spin rounded-full size-7 border-b-2 border-primary" />
			</div>}
			{errored && <div className="absolute inset-0 flex items-center justify-center p-3 text-center">
				<span className="text-xs text-on-surface-variant">Modèle indisponible</span>
			</div>}
		</>}
	</ModelViewerSurface>;
}
