import { Button, InfoBanner, InfoBannerSubtext, InfoBannerText } from "@aphrody/spaceui";
import { lazy, Suspense } from "react";
import DownloadPage from "./DownloadPage";
import "./inacord-web.css";

const DesktopHost = lazy(() => import("#inacord-desktop-host"));

function BrowserIcon() {
	return <svg aria-hidden="true" className="browser-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.4 2.5 3.6 5.5 3.6 9S14.4 18.5 12 21c-2.4-2.5-3.6-5.5-3.6-9S9.6 5.5 12 3Z"/></svg>;
}

function AppPreview() {
	return <div className="web-app">
		<div className="web-warning" role="status">
			<InfoBanner icon={<BrowserIcon />} variant="warning">
				<div className="web-warning__body">
					<div className="web-warning__copy"><InfoBannerText>Mode navigateur</InfoBannerText><InfoBannerSubtext>Lecture via le backend HTTP. Les fichiers locaux, l’écriture VFS, les processus et les mises à jour nécessitent l’application desktop.</InfoBannerSubtext></div>
					<Button href="/" variant="gray" size="xs" rounding="full">Téléchargements</Button>
				</div>
			</InfoBanner>
		</div>
		<div className="web-app__viewport"><Suspense fallback={<div className="app-loading">Chargement de l’interface Inacord…</div>}><DesktopHost /></Suspense></div>
	</div>;
}

export default function InacordWebHost() {
	return window.location.pathname === "/app" || window.location.pathname.startsWith("/app/") ? <AppPreview /> : <DownloadPage />;
}
