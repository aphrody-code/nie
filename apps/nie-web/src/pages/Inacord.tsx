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
import { lazy, Suspense } from "react";
import { DOWNLOADS } from "../entries";
import DownloadPage from "../inacord-web/DownloadPage";
import { SecondaryScreen } from "./SecondaryScreen";
import "../inacord-web/inacord-web.css";
import "./inacord.css";

const DesktopHost = lazy(() => import("#inacord-desktop-host"));

interface InacordProps {
	/** `inacord` for the workspace, `downloads` for the catalogue of native builds. */
	view: string;
	onSelect: (view: string) => void;
}

export function Inacord({ view, onSelect }: InacordProps) {
	if (view === DOWNLOADS) {
		return (
			<SecondaryScreen currentView={view} onSelect={onSelect} health={null}>
				<div className="inacord-downloads">
					<DownloadPage />
				</div>
			</SecondaryScreen>
		);
	}

	// The workspace owns the whole viewport. The download entry point lives in its own
	// sidebar footer (`desktop/components/Sidebar.tsx`), not in a banner above it.
	return (
		<div className="inacord-frame">
			<Suspense fallback={<div className="app-loading">Chargement de l’interface Inacord…</div>}>
				<DesktopHost />
			</Suspense>
		</div>
	);
}
