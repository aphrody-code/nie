"use client";

import { Box, Download } from "lucide-react";
import { useState } from "react";
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@rosegriffon/ui";
import { ModelViewerSurface } from "@niers/inacord-ui/three/ModelViewerSurface";
import { loadModelViewer } from "../../lib/model-viewer-loader";

interface CharacterModelViewerProps {
	glbUrl: string;
	name?: string;
	inline?: boolean;
}

/** Detail adapter: the same viewer body is used inline and inside the dialog. */
export default function CharacterModelViewer({ glbUrl, name, inline }: CharacterModelViewerProps) {
	const [open, setOpen] = useState(false);
	const viewerBody = <ModelViewerSurface src={glbUrl}
		label={`Modèle 3D de ${name ?? "personnage"}`} loadViewer={loadModelViewer}
		active={Boolean(inline || open)}
		className="aspect-[3/4] relative bg-surface-container-high rounded-xl overflow-hidden">
		{({ loaded, errored }) => <>
			{!loaded && !errored && <div className="absolute inset-0 flex items-center justify-center bg-surface/50">
				<div className="animate-spin rounded-full size-8 border-b-2 border-primary" />
			</div>}
			{errored && <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
				<span className="text-sm text-on-surface-variant">Modèle 3D indisponible.</span>
			</div>}
			{loaded && !errored && <>
				<a href={glbUrl} download={`${name ?? "modele"}.glb`} onClick={event => event.stopPropagation()}
					className={`absolute ${inline ? "top-2 right-2" : "bottom-3 right-3"} z-10 inline-flex items-center gap-1 rounded-full bg-surface/70 backdrop-blur px-2.5 py-1 text-xs font-medium text-on-surface hover:bg-surface border border-outline-variant/30 transition-colors`}
					title="Télécharger le modèle 3D (GLB)"><Download className="size-3" /> GLB</a>
				<div className="absolute bottom-3 left-0 right-0 text-center pointer-events-none">
					<span className="text-xs text-on-surface-variant/60 bg-surface/40 px-2 py-1 rounded">Glissez pour tourner · molette pour zoomer</span>
				</div>
			</>}
		</>}
	</ModelViewerSurface>;
	if (inline) return viewerBody;
	return <Dialog open={open} onOpenChange={setOpen}>
		<DialogTrigger asChild>
			<Button variant="ghost" size="icon" className="size-11 sm:size-8 text-on-surface-variant hover:text-primary">
				<Box className="size-4" /><span className="sr-only">Voir le modèle 3D de {name}</span>
			</Button>
		</DialogTrigger>
		<DialogContent className="sm:max-w-[420px] bg-surface p-0 overflow-hidden border-outline-variant rounded-xl sm:rounded-2xl">
			<DialogHeader className="p-4 pr-10 bg-surface-container/80 absolute top-0 w-full z-10 backdrop-blur-sm border-b border-outline-variant/20 pointer-events-none">
				<DialogTitle className="text-on-surface flex items-center gap-2 text-base pointer-events-auto">
					<Box className="size-4 text-primary" />{name || "Modèle 3D"}
				</DialogTitle>
			</DialogHeader>
			{viewerBody}
		</DialogContent>
	</Dialog>;
}
