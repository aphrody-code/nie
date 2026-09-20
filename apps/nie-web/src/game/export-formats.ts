/**
 * Le convertisseur de `nie-site`, vu du navigateur.
 *
 * Deux routes, et rien de deviné : `/api/v1/export/formats/<chemin>` dit ce que le serveur sait
 * produire POUR CE FICHIER, `/api/v1/export/file/<chemin>?format=<id>` rend les octets. Sans
 * `format`, la seconde rend le fichier brut — c'est ce que le format `raw` déclare, et c'est
 * pourquoi ce cas n'ajoute pas de paramètre plutôt que d'en inventer un.
 *
 * Le chemin voyage en SEGMENTS : c'en est un, et `encodeURIComponent` est appliqué composant par
 * composant pour ne pas transformer les `/` du VFS en `%2F`.
 */
import { fetchJson } from "@niers/asset-source";
import type { ExportFormat } from "@niers/inacord-ui/gallery/contracts";

/** Réponse de `/api/v1/export/formats/<chemin>`, recopiée du DTO servi. */
interface ExportFormatsResponse {
	path: string;
	formats: ExportFormat[];
}

const segments = (vfsPath: string) => vfsPath.split("/").map(encodeURIComponent).join("/");

export const exportFormatsUrl = (vfsPath: string) => `/api/v1/export/formats/${segments(vfsPath)}`;

/** `raw` = le fichier d'origine : la route le rend quand AUCUN format n'est demandé. */
export const exportFileUrl = (vfsPath: string, formatId?: string) =>
	formatId && formatId !== "raw"
		? `/api/v1/export/file/${segments(vfsPath)}?format=${encodeURIComponent(formatId)}`
		: `/api/v1/export/file/${segments(vfsPath)}`;

export async function fetchExportFormats(vfsPath: string, signal?: AbortSignal): Promise<ExportFormat[]> {
	const body = await fetchJson<ExportFormatsResponse>(exportFormatsUrl(vfsPath), { signal, retries: 1 });
	return body.formats ?? [];
}

/**
 * Télécharge le fichier converti.
 *
 * Le blob est lu AVANT d'ouvrir le lien, pour deux raisons : un `<a href>` pointé sur la route
 * navigue en silence quand le serveur répond une erreur — l'utilisateur ne voit rien — et c'est
 * la lecture qui permet de remonter le code HTTP à l'appelant, qui l'affichera.
 */
export async function downloadExport(vfsPath: string, format: ExportFormat): Promise<void> {
	const response = await fetch(exportFileUrl(vfsPath, format.id));
	if (!response.ok) throw new Error(`Conversion refusée par le serveur (HTTP ${response.status})`);
	const blob = await response.blob();
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	// Le nom vient du serveur : lui seul connaît l'extension réelle de la sortie.
	anchor.download = format.fileName || vfsPath.split("/").pop() || "fichier";
	anchor.click();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}
