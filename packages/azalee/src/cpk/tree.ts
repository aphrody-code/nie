/**
 * Modèle d'arbre **lazy** pour l'explorateur /cpk (react-arborist, données contrôlées).
 *
 * react-arborist ne charge pas les enfants à la demande nativement : on maintient nous-mêmes
 * l'état `data` et, à l'ouverture d'un dossier (`onToggle`), on fetch ses enfants via
 * `/api/cpk?path=<dir>` puis on les fusionne immuablement. Un dossier non chargé porte un enfant
 * sentinelle `__loading__` pour rester « internal » (flèche d'expansion visible) tant qu'on n'a
 * pas récupéré son contenu réel.
 *
 * Échelle : un répertoire peut contenir des **dizaines de milliers** de fichiers directs
 * (`common/sound/ja` ≈ 15 443). On NE charge donc que les `TREE_FILE_CAP` premiers fichiers dans
 * l'arbre (navigation), et on pousse un nœud sentinelle `kind:"more"` « … N fichiers de plus »
 * qui, activé, ouvre le dossier dans la grille paginée (le vrai outil de parcours en masse).
 * Cf. docs/cpk-explorer-design.md.
 */

/** Plafond de fichiers chargés directement dans l'ARBRE par dossier (le reste → grille paginée). */
export const TREE_FILE_CAP = 500;

/** Un nœud de l'arbre CPK : dossier (enfants lazy), fichier (feuille) ou sentinelle « plus ». */
export interface CpkNode {
	/** Chemin d'index complet (`data/...`) — sert d'`id` arborist unique. */
	id: string;
	/** Nom affiché (dernier segment). */
	name: string;
	/** `dir` = dossier navigable, `file` = feuille, `more` = « voir tout » (→ grille). */
	kind: "dir" | "file" | "more";
	/** Extension (fichiers uniquement, sans point). */
	ext?: string;
	/** Nombre de descendants (dossiers) ou de fichiers restants (`more`). */
	count?: number;
	/** Dossier parent (nœud `more` uniquement) — cible d'ouverture dans la grille. */
	parent?: string;
	/** Enfants : `undefined` pour un fichier (feuille) ; `[sentinelle]` si non chargé. */
	children?: CpkNode[];
}

/** Réponse paginée de `/api/cpk?path=<dir>`. */
interface CpkListing {
	dir: string;
	dirs: { name: string; count: number }[];
	files: { name: string; ext: string; path: string }[];
	/** Nombre total de fichiers directs (avant pagination). */
	fileTotal?: number;
}

const SENTINEL = "__loading__";
const MORE = "__more__";

/** Crée le placeholder qui maintient un dossier « expandable » avant chargement. */
function loadingChild(parentId: string): CpkNode {
	return { id: `${parentId}/${SENTINEL}`, name: "…", kind: "dir", children: [] };
}

/** `true` si le dossier n'a pas encore chargé ses vrais enfants. */
export function isUnloaded(node: CpkNode): boolean {
	return (
		node.kind === "dir" &&
		!!node.children &&
		node.children.length === 1 &&
		node.children[0].id.endsWith(`/${SENTINEL}`)
	);
}

/** Construit un nœud dossier (enfants lazy non chargés). */
function dirNode(parentPath: string, name: string, count: number): CpkNode {
	const id = `${parentPath}/${name}`;
	return { id, name, kind: "dir", count, children: [loadingChild(id)] };
}

/** Construit un nœud fichier (feuille). */
function fileNode(file: { name: string; ext: string; path: string }): CpkNode {
	return { id: file.path, name: file.name, kind: "file", ext: file.ext };
}

/**
 * Fetch les `TREE_FILE_CAP` premiers fichiers directs d'un dossier (`data/...` ou `data`) + ses
 * sous-dossiers, et les transforme en nœuds. Si le dossier compte plus de fichiers que le cap, on
 * pousse une feuille sentinelle `kind:"more"` qui renvoie vers la grille paginée du dossier.
 */
export async function fetchChildren(dirPath: string): Promise<CpkNode[]> {
	const res = await fetch(`/api/cpk?path=${encodeURIComponent(dirPath)}&limit=${TREE_FILE_CAP}`);
	if (!res.ok) return [];
	const listing = (await res.json()) as CpkListing;
	const dirs = listing.dirs.map((d) => dirNode(dirPath, d.name, d.count));
	const files = listing.files.map(fileNode);
	const remaining = (listing.fileTotal ?? files.length) - files.length;
	if (remaining > 0) {
		files.push({
			id: `${dirPath}/${MORE}`,
			name: `… ${remaining.toLocaleString("fr")} fichiers de plus`,
			kind: "more",
			count: remaining,
			parent: dirPath,
		});
	}
	return [...dirs, ...files];
}

/** Remplace immuablement les enfants du nœud `id` dans l'arbre. */
export function setChildren(tree: CpkNode[], id: string, children: CpkNode[]): CpkNode[] {
	return tree.map((n) => {
		if (n.id === id) return { ...n, children };
		if (n.children && id.startsWith(`${n.id}/`)) {
			return { ...n, children: setChildren(n.children, id, children) };
		}
		return n;
	});
}

/** Trouve un nœud par id (DFS). */
export function findNode(tree: CpkNode[], id: string): CpkNode | null {
	for (const n of tree) {
		if (n.id === id) return n;
		if (n.children && id.startsWith(`${n.id}/`)) {
			const hit = findNode(n.children, id);
			if (hit) return hit;
		}
	}
	return null;
}

/** Liste des ancêtres (`data/a`, `data/a/b`, …) d'un chemin, pour l'auto-expansion d'un deep-link. */
export function ancestorPaths(indexPath: string): string[] {
	const segs = indexPath.split("/");
	const out: string[] = [];
	for (let i = 1; i < segs.length; i++) out.push(segs.slice(0, i + 1).join("/"));
	return out;
}
