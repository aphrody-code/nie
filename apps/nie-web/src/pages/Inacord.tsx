/**
 * Inacord inside nie — the whole workspace, one origin.
 *
 * ## Why this page exists
 *
 * Inacord Web used to be a second bundle on a second host (`inacord.aphrody.com`), with its own
 * banner pointing back at nie and nie's explorer pointing at it through `window.open`. Two
 * sites for one product, each linking to the other. Since 2026-09-12 the workspace is a route
 * of this site: `/inacord` hosts it, `/downloads` lists the native builds, and the game's
 * secondary shell frames both — same header, same tiles, same Escape to return.
 *
 * ## What is NOT duplicated
 *
 * The workspace itself is `src/desktop` (the Tauri app), loaded lazily behind the Tauri→HTTP
 * shims of `src/inacord-web/shims`. Nothing here re-implements a view: this file is a frame.
 */
import { lazy, Suspense, useState } from "react";
import { Button } from "@aphrody/spaceui";
import { DOWNLOADS } from "../entries";
import { DownloadModal } from "../inacord-web/DownloadModal";
import DownloadPage from "../inacord-web/DownloadPage";
import { HOME } from "../routing";
import { SecondaryScreen } from "./SecondaryScreen";
import "../inacord-web/inacord-web.css";
import "./inacord.css";

const DesktopHost = lazy(() => import("#inacord-desktop-host"));

interface InacordProps {
	/** `inacord` for the workspace, `downloads` for the catalogue of native builds. */
	view: string;
	onHome: () => void;
	onSelect: (view: string) => void;
}

export function Inacord({ view, onHome, onSelect }: InacordProps) {
	const [downloadOpen, setDownloadOpen] = useState(false);

	if (view === DOWNLOADS) {
		return (
			<SecondaryScreen currentView={view} onSelect={onSelect} health={null}>
				<div className="inacord-downloads">
					<DownloadPage />
				</div>
			</SecondaryScreen>
		);
	}

	return (
		<div className="inacord-frame">
			<header className="inacord-frame__bar">
				<button type="button" className="inacord-frame__home" onClick={onHome} aria-label="Retour au menu">
					nie
				</button>
				<span className="inacord-frame__title">Inacord</span>
				<span className="inacord-frame__hint">
					Espace de travail web. VFS local, montage RAM et GPU natif demandent l’application Desktop ou Mobile.
				</span>
				<div className="inacord-frame__actions">
					<Button onClick={() => setDownloadOpen(true)} variant="accent" size="xs" rounding="full">
						Télécharger Desktop / Mobile
					</Button>
					<Button onClick={() => onSelect(HOME)} variant="gray" size="xs" rounding="full">
						Menu
					</Button>
				</div>
			</header>
			<div className="inacord-frame__viewport">
				<Suspense fallback={<div className="app-loading">Chargement de l’interface Inacord…</div>}>
					<DesktopHost />
				</Suspense>
			</div>
			<DownloadModal isOpen={downloadOpen} onClose={() => setDownloadOpen(false)} />
		</div>
	);
}
