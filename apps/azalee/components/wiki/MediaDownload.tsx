import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { cpkExplorerHref, exportUrl, vfsStat } from "@rosegriffon/azalee/cpk/live";

/**
 * Bloc « ce fichier » : téléchargement **au format voulu**, et lien vers son emplacement réel.
 *
 * Les pages média ne proposaient qu'un format — le PNG pour une texture, le WAV par défaut pour
 * un son — alors que le convertisseur du dépôt en produit neuf pour une texture seule. La table
 * vient de `/vfs/stat`, qui expose la MÊME liste que l'app desktop
 * (`nie_explore::export::formats_pour`), et chaque lien passe par `/export`, qui applique la même
 * règle de nommage (`x.cfg.bin` donne `x.json`, pas `x.cfg.json`).
 *
 * Le lien vers l'explorateur CPK manquait dans les deux sens : une page média montre un fichier
 * décodé, l'explorateur montre où il vit — dossier, archive, taille, voisins.
 *
 * Composant serveur : la table est résolue au rendu, aucun JS n'est envoyé pour ça.
 *
 * @param awbId cue précis d'une banque audio, quand le téléchargement doit viser une piste.
 */
export async function MediaDownload({ path, awbId }: { path: string; awbId?: number | null }) {
	const meta = await vfsStat(path).catch(() => null);
	if (!meta) {
		return (
			<p className="px-1 text-xs italic text-on-surface-variant">
				Métadonnées du fichier indisponibles — le VFS ne répond pas.
			</p>
		);
	}

	const octets = meta.size.toLocaleString("fr");
	return (
		<section className="rounded-2xl border border-outline-variant bg-surface-container-low p-4">
			<h2 className="mb-2 text-sm font-medium text-on-surface">Télécharger</h2>
			<ul className="flex flex-wrap gap-2">
				{meta.formats.map((f) => (
					<li key={f.id}>
						<a
							href={exportUrl(path, f.id, { awbId })}
							download
							className="flex items-center gap-1.5 rounded-full border border-outline-variant bg-surface-container px-3 py-1.5 text-xs text-on-surface transition hover:border-primary/50 hover:bg-surface-container-high"
							title={f.label}
						>
							<Icon name="download" size={14} className="shrink-0" />
							<span className="font-medium uppercase">{f.ext}</span>
							{/* Dire ce qui se perd est plus utile que de le taire : GIF quantifie sur
							    256 couleurs, JPEG compresse avec perte. */}
							{!f.sansPerte && <span className="text-on-surface-variant">avec perte</span>}
						</a>
					</li>
				))}
			</ul>
			<p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-on-surface-variant">
				<Link href={cpkExplorerHref(path)} className="text-primary hover:underline">
					Voir dans l'explorateur CPK
				</Link>
				<span className="font-mono">{path}</span>
				<span>{octets} o</span>
				{meta.cpk && <span className="font-mono">{meta.cpk}</span>}
			</p>
			{meta.describe && meta.describe.length > 0 && (
				<details className="mt-2">
					<summary className="cursor-pointer text-xs text-on-surface-variant hover:text-on-surface">
						Détail du format
					</summary>
					{/* Lignes produites par l'inspection RÉELLE des octets (`describe_content`), pas
					    par l'extension : c'est ce que l'app desktop affiche dans son aperçu. */}
					<pre className="mt-1 max-h-64 overflow-auto rounded-lg bg-surface-container p-2 font-mono text-[11px] leading-relaxed text-on-surface-variant">
						{meta.describe.join("\n")}
					</pre>
				</details>
			)}
		</section>
	);
}
