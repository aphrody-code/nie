import { Button, Card, CardContent } from "@aphrody/spaceui";
import { useEffect, useState } from "react";
import { formatBytes, normalizeCatalog, type DownloadItem } from "./catalog";

interface DownloadModalProps {
	isOpen: boolean;
	onClose: () => void;
}

interface BeforeInstallPromptEvent extends Event {
	prompt: () => Promise<void>;
	userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function DownloadModal({ isOpen, onClose }: DownloadModalProps) {
	const [items, setItems] = useState<DownloadItem[]>([]);
	const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
	const [installed, setInstalled] = useState(false);

	useEffect(() => {
		const handleBeforeInstall = (e: Event) => {
			e.preventDefault();
			setDeferredPrompt(e as BeforeInstallPromptEvent);
		};
		window.addEventListener("beforeinstallprompt", handleBeforeInstall);
		window.addEventListener("appinstalled", () => setInstalled(true));
		return () => {
			window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
		};
	}, []);

	useEffect(() => {
		if (!isOpen) return;
		const controller = new AbortController();
		fetch("/downloads/catalog.json", { signal: controller.signal })
			.then(async (res) => {
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				return res.json();
			})
			.then((data) => {
				setItems(normalizeCatalog(data));
			})
			.catch(() => {
				setItems([
					{
						id: "desktop-windows",
						name: "Inacord Desktop (Windows)",
						kind: "desktop",
						platform: "Windows 10/11 x64",
						description: "Application native complète : VFS local, montage RAM, décodage 3D direct et performances maximales.",
						url: "/downloads/files/Inacord_x64-setup.exe",
						status: "available",
					},
					{
						id: "mobile-android",
						name: "Inacord Mobile (Android / PWA)",
						kind: "mobile",
						platform: "Android / PWA",
						description: "Version mobile installable avec mise en cache hors-ligne et interface tactile optimisée.",
						url: "/downloads/files/inacord-mobile.apk",
						status: "available",
					},
					{
						id: "cli-engine",
						name: "Niers Engine CLI",
						kind: "cli",
						platform: "Linux / Windows CLI",
						description: "Outil en ligne de commande haute performance pour l extraction VFS et les scripts de forge.",
						url: "/downloads/files/niers-cli.tar.gz",
						status: "available",
					},
				]);
			});
		return () => controller.abort();
	}, [isOpen]);

	if (!isOpen) return null;

	const handleInstallPwa = async () => {
		if (deferredPrompt) {
			await deferredPrompt.prompt();
			const choice = await deferredPrompt.userChoice;
			if (choice.outcome === "accepted") setInstalled(true);
			setDeferredPrompt(null);
		} else {
			alert("Sur mobile, utilisez le menu de votre navigateur puis Ajouter à l écran d accueil.");
		}
	};

	const desktopItems = items.filter((i) => i.kind === "desktop");
	const mobileItems = items.filter((i) => i.kind === "mobile");
	const otherItems = items.filter((i) => i.kind !== "desktop" && i.kind !== "mobile");

	return (
		<div className="download-modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
			<div className="download-modal-sheet" onClick={(e) => e.stopPropagation()}>
				<div className="download-modal-header">
					<div>
						<h2 className="download-modal-title">Télécharger Inacord</h2>
						<p className="download-modal-subtitle">
							Installez l application native sur Desktop ou Mobile pour débloquer le VFS local et les performances maximales.
						</p>
					</div>
					<button type="button" onClick={onClose} className="download-modal-close" aria-label="Fermer">
						✕
					</button>
				</div>

				<div className="download-modal-body">
					{/* Section Desktop */}
					<div className="download-modal-section">
						<div className="download-modal-section-title">
							<span className="download-badge desktop">Desktop</span>
							<h3>Windows / Mac / Linux</h3>
						</div>
						<div className="download-grid">
							{desktopItems.length > 0 ? (
								desktopItems.map((item) => (
									<Card key={item.id} className="download-card">
										<CardContent className="download-card-content">
											<div className="download-card-header">
												<h4>{item.name}</h4>
												<span className="download-meta">{item.platform} {item.bytes ? `· ${formatBytes(item.bytes)}` : ""}</span>
											</div>
											<p className="download-desc">{item.description}</p>
											<div className="download-card-actions">
												<Button href={item.url || "/downloads/files/Inacord_x64-setup.exe"} variant="accent" size="sm" rounding="full">
													Télécharger (.exe) ↓
												</Button>
											</div>
										</CardContent>
									</Card>
								))
							) : (
								<Card className="download-card">
									<CardContent className="download-card-content">
										<div className="download-card-header">
											<h4>Inacord Desktop x64</h4>
											<span className="download-meta">Windows 10 / 11 64-bit</span>
										</div>
										<p className="download-desc">
											Application native complète : VFS local, montage RAM, décodage 3D direct.
										</p>
										<div className="download-card-actions">
											<Button href="/downloads/files/Inacord_x64-setup.exe" variant="accent" size="sm" rounding="full">
												Télécharger Windows (.exe) ↓
											</Button>
										</div>
									</CardContent>
								</Card>
							)}
						</div>
					</div>

					{/* Section Mobile */}
					<div className="download-modal-section">
						<div className="download-modal-section-title">
							<span className="download-badge mobile">Mobile</span>
							<h3>Android & PWA Tactile</h3>
						</div>
						<div className="download-grid">
							<Card className="download-card">
								<CardContent className="download-card-content">
									<div className="download-card-header">
										<h4>Application Mobile Tactile (PWA)</h4>
										<span className="download-meta">iOS & Android</span>
									</div>
									<p className="download-desc">
										Installez l application directement depuis votre navigateur avec mise en cache hors-ligne complète.
									</p>
									<div className="download-card-actions">
										<Button onClick={handleInstallPwa} variant="accent" size="sm" rounding="full">
											{installed ? "Application installée ✓" : "Installer sur l écran d accueil +"}
										</Button>
									</div>
								</CardContent>
							</Card>

							{mobileItems.map((item) => (
								<Card key={item.id} className="download-card">
									<CardContent className="download-card-content">
										<div className="download-card-header">
											<h4>{item.name}</h4>
											<span className="download-meta">{item.platform}</span>
										</div>
										<p className="download-desc">{item.description}</p>
										<div className="download-card-actions">
											<Button href={item.url} variant="gray" size="sm" rounding="full">
												Télécharger APK ↓
											</Button>
										</div>
									</CardContent>
								</Card>
							))}
						</div>
					</div>

					{/* Section CLI & Outils */}
					{otherItems.length > 0 && (
						<div className="download-modal-section">
							<div className="download-modal-section-title">
								<span className="download-badge tools">Outils</span>
								<h3>CLI, MCP & Plugins</h3>
							</div>
							<div className="download-grid">
								{otherItems.map((item) => (
									<Card key={item.id} className="download-card">
										<CardContent className="download-card-content">
											<div className="download-card-header">
												<h4>{item.name}</h4>
												<span className="download-meta">{item.kind.toUpperCase()}</span>
											</div>
											<p className="download-desc">{item.description}</p>
											<div className="download-card-actions">
												{item.url ? (
													<Button href={item.url} variant="gray" size="sm" rounding="full">
														Télécharger ↓
													</Button>
												) : (
													<span className="download-meta">Prévu</span>
												)}
											</div>
										</CardContent>
									</Card>
								))}
							</div>
						</div>
					)}
				</div>

				<div className="download-modal-footer">
					<a href="/downloads" className="download-catalog-link">
						Voir le catalogue complet des distributions et signatures SHA-256 →
					</a>
					<Button onClick={onClose} variant="bare" size="sm" rounding="full">
						Fermer
					</Button>
				</div>
			</div>
		</div>
	);
}
