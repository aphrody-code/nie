const SOURCE = "/vendor/model-viewer.min.js";
let loading: Promise<void> | null = null;

/** Partage le chargement entre galerie et fiche, y compris les erreurs et reprises. */
export function loadModelViewer(): Promise<void> {
	if (typeof window === "undefined") return Promise.resolve();
	if (window.customElements?.get("model-viewer")) return Promise.resolve();
	if (loading) return loading;
	// Décodeurs locaux : aucun fichier utilisateur ni demande de décodage vers un CDN tiers.
	const config = window as typeof window & { ModelViewerElement?: Record<string, unknown> };
	config.ModelViewerElement = { ...config.ModelViewerElement,
		dracoDecoderLocation: "/vendor/draco/",
		ktx2TranscoderLocation: "/vendor/basis/",
		meshoptDecoderLocation: "/vendor/meshopt_decoder.module.js",
	};
	const attempt = new Promise<void>((resolve, reject) => {
		const existing = document.querySelector<HTMLScriptElement>(`script[src="${SOURCE}"]`);
		const script = existing ?? document.createElement("script");
		let settled = false;
		const finish = (error?: Error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			script.removeEventListener("error", fail);
			if (error) {
				script.remove();
				reject(error);
			} else resolve();
		};
		const fail = () => finish(new Error("Échec du chargement du viewer 3D."));
		const timeout = setTimeout(() => finish(new Error("Délai de chargement du viewer 3D dépassé.")), 30_000);
		script.addEventListener("error", fail);
		window.customElements.whenDefined("model-viewer").then(() => finish(), fail);
		if (!existing) {
			script.src = SOURCE;
			script.async = true;
			document.head.appendChild(script);
		}
	});
	loading = attempt.catch((error: unknown) => {
		loading = null;
		throw error;
	});
	return loading;
}
