import { lazy, Suspense } from "react";
import DownloadPage from "./DownloadPage";
import "./inacord-web.css";

const DesktopHost = lazy(() => import("#inacord-desktop-host"));

function AppPreview() {
	return <div className="web-app">
		<div className="web-warning" role="status"><strong>Mode navigateur</strong><span>Interface desktop chargée en aperçu. Fichiers locaux, écriture VFS, processus, mise à jour, MCP et Blender nécessitent l’application desktop.</span><a href="/">Téléchargements</a></div>
		<div className="web-app__viewport"><Suspense fallback={<div className="app-loading">Chargement de l’interface Inacord…</div>}><DesktopHost /></Suspense></div>
	</div>;
}

export default function InacordWebHost() {
	return window.location.pathname === "/app" || window.location.pathname.startsWith("/app/") ? <AppPreview /> : <DownloadPage />;
}
