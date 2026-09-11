import { Button, InfoBanner, InfoBannerSubtext, InfoBannerText } from "@aphrody/spaceui";
import { lazy, Suspense, useState } from "react";
import DownloadPage from "./DownloadPage";
import { DownloadModal } from "./DownloadModal";
import "./inacord-web.css";

const DesktopHost = lazy(() => import("#inacord-desktop-host"));

function BrowserIcon() {
	return (
		<svg aria-hidden="true" className="browser-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
			<circle cx="12" cy="12" r="9" />
			<path d="M3 12h18M12 3c2.4 2.5 3.6 5.5 3.6 9S14.4 18.5 12 21c-2.4-2.5-3.6-5.5-3.6-9S9.6 5.5 12 3Z" />
		</svg>
	);
}

function DownloadIcon() {
	return (
		<svg aria-hidden="true" className="browser-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
			<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
			<polyline points="7 10 12 15 17 10" />
			<line x1="12" y1="15" x2="12" y2="3" />
		</svg>
	);
}

function AppPreview() {
	const [downloadOpen, setDownloadOpen] = useState(false);

	return (
		<div className="web-app">
			<div className="web-warning" role="status">
				<InfoBanner icon={<BrowserIcon />} variant="warning">
					<div className="web-warning__body">
						<div className="web-warning__copy">
							<InfoBannerText>Inacord Web Workspace</InfoBannerText>
							<InfoBannerSubtext>
								Mode web connecté au backend nie. VFS local, montage RAM direct et performances GPU natives requièrent l’application Desktop ou Mobile.
							</InfoBannerSubtext>
						</div>
						<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
							<Button onClick={() => setDownloadOpen(true)} variant="accent" size="xs" rounding="full">
								<span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
									<DownloadIcon /> Télécharger Desktop / Mobile
								</span>
							</Button>
							<Button href="https://nie.aphrody.com" variant="gray" size="xs" rounding="full">
								Nie Engine
							</Button>
						</div>
					</div>
				</InfoBanner>
			</div>
			<div className="web-app__viewport">
				<Suspense fallback={<div className="app-loading">Chargement de l’interface Inacord…</div>}>
					<DesktopHost />
				</Suspense>
			</div>
			<DownloadModal isOpen={downloadOpen} onClose={() => setDownloadOpen(false)} />
		</div>
	);
}

export default function InacordWebHost() {
	const pathname = window.location.pathname;
	if (pathname === "/downloads" || pathname === "/telechargements") {
		return <DownloadPage />;
	}
	return <AppPreview />;
}

