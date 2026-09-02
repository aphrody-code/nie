"use client";

import { useEffect } from "react";

/**
 * Boundary d'erreur GLOBALE (remplace tout le document quand le root layout lui-même
 * échoue). Doit rendre ses propres <html>/<body> et rester TOTALEMENT autonome :
 * aucun composant à contexte (pas de @rosegriffon/ui, pas de provider parent) — sinon
 * le prerender du `/_global-error` de Next 16 crashe (`useContext` null à l'export).
 * Styles 100% inline aux couleurs DA Rose Griffon (marine / or / Azalée) car le CSS
 * global n'est pas garanti disponible à ce niveau.
 */
export default function GlobalError({
	error,
	reset,
}: {
	error: Error & { digest?: string };
	reset: () => void;
}) {
	useEffect(() => {
		console.error(error);
	}, [error]);

	return (
		<html lang="fr">
			<body
				style={{
					margin: 0,
					minHeight: "100vh",
					display: "flex",
					flexDirection: "column",
					alignItems: "center",
					justifyContent: "center",
					gap: "1.5rem",
					padding: "1.5rem",
					textAlign: "center",
					backgroundColor: "#0c1730",
					color: "#f5f0e6",
					fontFamily:
						'Poppins, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
				}}
			>
				<h1
					style={{
						margin: 0,
						fontSize: "clamp(1.75rem, 6vw, 2.75rem)",
						fontWeight: 900,
						color: "#d4af37",
						textShadow: "0 4px 0 rgba(0,0,0,0.5)",
						letterSpacing: "-0.02em",
					}}
				>
					Erreur critique
				</h1>
				<p
					style={{
						margin: 0,
						maxWidth: "32rem",
						fontSize: "1.05rem",
						lineHeight: 1.6,
						color: "rgba(245,240,230,0.85)",
					}}
				>
					Azalée a rencontré un problème inattendu et n&apos;a pas pu afficher la
					page. Vous pouvez réessayer ou revenir à l&apos;accueil.
				</p>
				<div
					style={{
						display: "flex",
						flexWrap: "wrap",
						gap: "0.75rem",
						justifyContent: "center",
					}}
				>
					<button
						type="button"
						onClick={() => reset()}
						style={{
							cursor: "pointer",
							border: "2px solid #d4af37",
							borderRadius: "9999px",
							padding: "0.625rem 1.5rem",
							fontWeight: 700,
							fontSize: "0.95rem",
							color: "#0c1730",
							backgroundColor: "#F89C5A",
							boxShadow: "0 4px 0 0 rgba(0,0,0,0.5)",
						}}
					>
						Réessayer
					</button>
					{/* <a> volontaire (pas next/link) : le root layout a échoué, le routeur
					    Next n'est pas fiable ici → navigation full-page assumée. */}
					{/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
					<a
						href="/"
						style={{
							border: "2px solid #d4af37",
							borderRadius: "9999px",
							padding: "0.625rem 1.5rem",
							fontWeight: 700,
							fontSize: "0.95rem",
							textDecoration: "none",
							color: "#f5f0e6",
							backgroundColor: "rgba(255,255,255,0.06)",
						}}
					>
						Accueil
					</a>
				</div>
			</body>
		</html>
	);
}
