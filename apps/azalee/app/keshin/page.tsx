/**
 * `/keshin` — conservée pour les liens existants, redirige vers la famille correspondante.
 *
 * Les esprits guerriers et leurs armures étaient une page à part, alimentée par le miroir, à
 * côté d'un `/modeles` filtré par un manifeste statique : deux pages, deux sources, une fraction
 * du corpus. Elles ne font plus qu'une — `/modeles` couvre les 6 236 modèles du jeu, esprits
 * compris, sur le VFS live.
 *
 * Redirection permanente : l'URL a été indexée et partagée, elle doit continuer à mener au bon
 * endroit plutôt que rendre un doublon.
 */
import { permanentRedirect } from "next/navigation";

export default function KeshinPage(): never {
	permanentRedirect("/modeles/keshin");
}
