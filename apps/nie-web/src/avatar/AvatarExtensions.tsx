import { useEffect, useRef, useState, type RefObject } from "react";
import { fetchCharaCatalog, type CharaCatalogEntry } from "@nie/asset-source/chara";
import type { AssetSource, EntityRow } from "@nie/asset-source";
import { useAssetSource } from "@nie/inacord-ui/source";
import type { AvatarCatalog, AvatarProfile, AvatarReferenceImport, AvatarState, OcReference } from "@nie/inacord-ui/avatar/contract";
import { exportAvatarOcDocument, importAvatarReference } from "../game/avatar-runtime";
import { inspectModelGlb, replaceModelTextureGlb } from "../game/model-render";

const MAX_GLB_BYTES = 64 * 1024 * 1024;
// Must stay aligned with nie_render3d::glb::EDITOR_MAX_PNG_BYTES.
const MAX_PNG_BYTES = 32 * 1024 * 1024;
const STAT_COLUMNS = {
	kick: "stat_frappe",
	control: "stat_controle",
	technique: "stat_technique",
	pressure: "stat_pression",
	physical: "stat_physique",
	agility: "stat_agilite",
	intelligence: "stat_intelligence",
} as const;
export type AvatarStatValues = Partial<Record<keyof typeof STAT_COLUMNS, number>>;

export interface AvatarPlayerReference {
	referenceOnly: true;
	internalCode: string;
	name: string;
	element: string | null;
	position: string | null;
	modelId: string | null;
	modelUrl: string;
	stats: AvatarStatValues | null;
}

/** Resolve only an exact canonical identity; a fuzzy catalogue hit is never accepted as a player. */
export async function resolvePlayerReference(
	source: AssetSource,
	identity: { internalCode?: string; identifier?: string },
	signal?: AbortSignal,
): Promise<AvatarPlayerReference> {
	const lookup = identity.internalCode ?? identity.identifier;
	if (!lookup) throw new Error("La référence joueur est vide.");
	// La recherche est FLOUE, la correspondance est EXACTE — d'où la marche sur les pages.
	//
	// `q=<lookup>` est un filtre par sous-chaîne, et la réponse est plafonnée à 200 entrées
	// (`PER_PAGE_MAX`, appliqué en silence). Ne lire que la première page suffisait tant qu'un
	// motif ramenait moins de 200 lignes ; au-delà, la bonne entrée pouvait être en page 2 et
	// l'appelant recevait « Ce joueur n'existe pas dans le miroir canonique » — un faux négatif
	// indiscernable d'un vrai. On s'arrête dès que la correspondance exacte est trouvée : le cas
	// courant reste UNE requête.
	const normalized = lookup.toLowerCase();
	const exact = (candidate: CharaCatalogEntry & EntityRow) =>
		[candidate.internal_code, candidate.base_slug, candidate.slug]
			.some((value) => typeof value === "string" && value.toLowerCase() === normalized);

	const lirePage = async (page: number): Promise<{ elements: Array<CharaCatalogEntry & EntityRow>; pages: number }> => {
		if (source.entityRows) {
			const r = await source.entityRows("inagle_characters", { q: lookup, page, perPage: 200, signal });
			return { elements: r.elements as Array<CharaCatalogEntry & EntityRow>, pages: r.pages };
		}
		if (source.hote === "nie") {
			const r = await fetchCharaCatalog({ q: lookup, page, perPage: 200, signal });
			return { elements: r.elements as Array<CharaCatalogEntry & EntityRow>, pages: r.pages };
		}
		if (source.wiki) {
			const r = await source.wiki<CharaCatalogEntry>("inagle_characters", { q: lookup, page, parPage: 200, signal });
			return { elements: r.elements as Array<CharaCatalogEntry & EntityRow>, pages: r.pages };
		}
		throw new Error("La source locale ne sait pas résoudre les références joueur.");
	};

	let entry: (CharaCatalogEntry & EntityRow) | undefined;
	let pages = 1;
	for (let page = 1; page <= pages && !entry; page += 1) {
		const lot = await lirePage(page);
		pages = Math.max(1, lot.pages);
		entry = lot.elements.find(exact);
	}
	if (!entry?.internal_code) throw new Error("Ce joueur n’existe pas dans le miroir canonique.");
	if (!source.urlModele) throw new Error("Cette source ne sait pas assembler le modèle du joueur.");
	const stats = Object.fromEntries(Object.entries(STAT_COLUMNS).flatMap(([field, column]) => {
		const value = entry[column];
		return typeof value === "number" && Number.isFinite(value) ? [[field, value] as const] : [];
	})) as AvatarStatValues;
	return {
		referenceOnly: true,
		internalCode: entry.internal_code,
		name: entry.name_fr ?? entry.name_en ?? entry.name_ja ?? entry.internal_code,
		element: entry.element,
		position: entry.position,
		modelId: entry.model_id,
		modelUrl: source.urlModele(entry.internal_code),
		stats: Object.keys(stats).length ? stats : null,
	};
}

export function profileWithPlayerStats(profile: AvatarProfile, stats: AvatarStatValues): AvatarProfile {
	return { ...profile, ...stats };
}

function appendReference(current: OcReference[], reference: OcReference): OcReference[] {
	const withoutDuplicate = current.filter((item) => item.kind !== reference.kind || item.value !== reference.value);
	return [...withoutDuplicate, reference].slice(-32);
}

async function sha256(bytes: Uint8Array): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer);
	return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

async function readBounded(file: File, maximum: number, label: string): Promise<Uint8Array> {
	if (file.size <= 0 || file.size > maximum) throw new Error(`${label} vide ou supérieur à ${Math.floor(maximum / 1024 / 1024)} Mio.`);
	return new Uint8Array(await file.arrayBuffer());
}

export async function avatarProject(
	catalog: AvatarCatalog,
	state: AvatarState,
	metadata: { slug: string; internalCode: string | null; references: OcReference[] },
	owner: typeof exportAvatarOcDocument = exportAvatarOcDocument,
): Promise<string> {
	return owner(catalog, state, metadata);
}

function saveBlob(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = filename;
	anchor.click();
	setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

async function saveUrl(url: string, filename: string): Promise<void> {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`Export indisponible (${response.status}).`);
	const size = Number(response.headers.get("content-length"));
	if (Number.isFinite(size) && size > 64 * 1024 * 1024) throw new Error("Export supérieur à 64 Mio.");
	const blob = await response.blob();
	if (blob.size > 64 * 1024 * 1024) throw new Error("Export supérieur à 64 Mio.");
	saveBlob(blob, filename);
}

async function capturePng(root: HTMLElement): Promise<void> {
	const canvas = root.querySelector<HTMLCanvasElement>('canvas[data-native-renderer="nie-render3d"][data-model-ready="true"]');
	if (!canvas?.toBlob) throw new Error("Le rendu n’est pas prêt pour une capture.");
	const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
		(value) => value ? resolve(value) : reject(new Error("La capture PNG a échoué.")),
		"image/png",
	));
	saveBlob(blob, "avatar.png");
}

export function AvatarExtensions({
	catalog,
	state,
	modelUrl,
	captureRoot,
	onState,
	onPlayerReference,
}: {
	catalog: AvatarCatalog;
	state: AvatarState;
	modelUrl: string | null;
	captureRoot: RefObject<HTMLElement | null>;
	onState: (state: AvatarState) => void;
	onPlayerReference: (reference: AvatarPlayerReference | null) => void;
}) {
	const source = useAssetSource();
	const projectFile = useRef<HTMLInputElement>(null);
	const glbFile = useRef<HTMLInputElement>(null);
	const pngFile = useRef<HTMLInputElement>(null);
	const localModelUrl = useRef<string | null>(null);
	const [open, setOpen] = useState(false);
	const [reference, setReference] = useState("");
	const [slug, setSlug] = useState("");
	const [internalCode, setInternalCode] = useState("");
	const [assetKind, setAssetKind] = useState<"png" | "glb">("png");
	const [assetValue, setAssetValue] = useState("");
	const [references, setReferences] = useState<OcReference[]>([]);
	const [localModel, setLocalModel] = useState<{ bytes: Uint8Array; textures: number; name: string } | null>(null);
	const [textureIndex, setTextureIndex] = useState(0);
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState<string | null>(null);
	useEffect(() => () => {
		if (localModelUrl.current) URL.revokeObjectURL(localModelUrl.current);
	}, []);

	const showLocalModel = (bytes: Uint8Array, name: string, textures: number) => {
		if (localModelUrl.current) URL.revokeObjectURL(localModelUrl.current);
		const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: "model/gltf-binary" }));
		localModelUrl.current = url;
		setLocalModel({ bytes, textures, name });
		onPlayerReference({
			referenceOnly: true, internalCode: internalCode || "OC", name: slug || name,
			element: null, position: null, modelId: null, modelUrl: url, stats: null,
		});
	};

	const apply = async (value: string) => {
		setBusy(true);
		setMessage(null);
		try {
			const imported: AvatarReferenceImport = await importAvatarReference(catalog, state, value);
			if (imported.kind === "editable") {
				onPlayerReference(null);
				onState(imported.state);
				if (imported.document) {
					setSlug(imported.document.slug);
					setInternalCode(imported.document.internalCode ?? "");
					setReferences(imported.document.references);
				}
				setMessage("Document OC importé et validé par le moteur Rust.");
			} else if (imported.kind === "share_code") {
				setReferences((current) => appendReference(current, {
					kind: "share_code", value, rawSlots: imported.rawSlots,
					provenance: "syntax decoded by nie-data; slot semantics intentionally unassigned",
				}));
				setMessage(`Code valide (${imported.rawSlots.length} emplacements), mais leur liaison aux contrôles Chara Edit n’est pas prouvée.`);
			} else {
				const player = await resolvePlayerReference(source, imported.kind === "azalee_player"
					? { identifier: imported.identifier }
					: { internalCode: imported.internalCode });
				onPlayerReference(player);
				setReferences((current) => appendReference(current, {
					kind: imported.kind === "zukan_player" ? "zukan" : imported.kind === "azalee_player" ? "azalee" : "nie_character",
					value,
					provenance: `${player.internalCode}${player.modelId ? ` · model_id ${player.modelId}` : ""}`,
				}));
				setMessage("Joueur chargé comme référence canonique — aucune recette Chara Edit n’est attribuée.");
			}
		} catch (error) {
			setMessage(error instanceof Error ? error.message : "Import impossible.");
		} finally {
			setBusy(false);
		}
	};

	const importGlb = async (selected: File) => run(async () => {
		const bytes = await readBounded(selected, MAX_GLB_BYTES, "GLB");
		const inspection = await inspectModelGlb(bytes);
		const hash = await sha256(bytes);
		setReferences((current) => appendReference(current, {
			kind: "glb", value: selected.name, bytes: selected.size, sha256: hash,
			provenance: `local file validated by nie-render3d · ${inspection.primitives} primitives · ${inspection.textures} textures`,
		}));
		setTextureIndex(0);
		showLocalModel(bytes, selected.name, inspection.textures);
		setMessage(`GLB validé par Rust (${inspection.primitives} primitives, ${inspection.textures} textures).`);
	});

	const importPng = async (selected: File) => run(async () => {
		if (!localModel) throw new Error("Ouvrez d’abord un fichier GLB local validé.");
		const png = await readBounded(selected, MAX_PNG_BYTES, "PNG");
		const replaced = await replaceModelTextureGlb(localModel.bytes, textureIndex, png);
		const inspection = await inspectModelGlb(replaced);
		const [pngHash, modelHash] = await Promise.all([sha256(png), sha256(replaced)]);
		setReferences((current) => appendReference(appendReference(current, {
			kind: "png", value: selected.name, bytes: selected.size, sha256: pngHash,
			provenance: `local file applied to GLB texture ${textureIndex} by nie-render3d`,
		}), {
			kind: "glb", value: localModel.name, bytes: replaced.byteLength, sha256: modelHash,
			provenance: `local GLB with texture ${textureIndex} replaced and reparsed by nie-render3d`,
		}));
		showLocalModel(replaced, localModel.name, inspection.textures);
		setMessage(`Texture ${textureIndex} remplacée dans le GLB et revalidée par Rust.`);
	});

	const run = async (operation: () => Promise<void>) => {
		setBusy(true);
		setMessage(null);
		try { await operation(); }
		catch (error) { setMessage(error instanceof Error ? error.message : "Export impossible."); }
		finally { setBusy(false); }
	};

	return <div className="avatar-extensions">
		<button type="button" className="avatar-extensions__toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
			Extensions
		</button>
		{open ? <section className="avatar-extensions__panel" aria-label="Extensions de l’éditeur d’avatar">
			<header><strong>Extensions</strong><button type="button" aria-label="Fermer les extensions" onClick={() => setOpen(false)}>×</button></header>
			<p>Importer un document OC, un code brut, ou une référence joueur Zukan/Azalée.</p>
			<div className="avatar-extensions__row">
				<input aria-label="Référence avatar" value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Lien, code ou cXXXXXXXX" />
				<button type="button" disabled={busy || !reference.trim()} onClick={() => void apply(reference)}>Importer</button>
			</div>
			<input ref={projectFile} hidden type="file" accept="application/json,.json" aria-label="Importer un projet avatar JSON" onChange={(event) => {
				const selected = event.currentTarget.files?.[0];
				if (!selected) return;
				if (selected.size > 100_000) { setMessage("Projet supérieur à 100 Ko."); return; }
				void selected.text().then(apply);
			}} />
			<input ref={glbFile} hidden type="file" accept="model/gltf-binary,.glb" aria-label="Importer un modèle GLB" onChange={(event) => {
				const selected = event.currentTarget.files?.[0];
				if (selected) void importGlb(selected);
				event.currentTarget.value = "";
			}} />
			<input ref={pngFile} hidden type="file" accept="image/png,.png" aria-label="Importer une texture PNG" onChange={(event) => {
				const selected = event.currentTarget.files?.[0];
				if (selected) void importPng(selected);
				event.currentTarget.value = "";
			}} />
			<div className="avatar-extensions__row">
				<input aria-label="Slug OC" value={slug} onChange={(event) => setSlug(event.target.value)} placeholder="slug-de-l-oc" />
				<input aria-label="Code interne OC" value={internalCode} onChange={(event) => setInternalCode(event.target.value)} placeholder="c99… (optionnel)" />
			</div>
			<div className="avatar-extensions__row">
				<select aria-label="Type de référence" value={assetKind} onChange={(event) => setAssetKind(event.target.value as "png" | "glb")}><option value="png">PNG</option><option value="glb">GLB</option></select>
				<input aria-label="Chemin ou URL de référence" value={assetValue} onChange={(event) => setAssetValue(event.target.value)} placeholder="references/face.png" />
				<button type="button" disabled={!assetValue.trim()} onClick={() => {
					setReferences((current) => appendReference(current, { kind: assetKind, value: assetValue.trim(), provenance: "declared provenance only; no bytes loaded" }));
					setAssetValue("");
				}}>Ajouter</button>
			</div>
			{references.length ? <ul className="avatar-extensions__references">{references.map((item, index) => <li key={`${item.kind}-${item.value}-${index}`}>
				<span>{item.kind.toUpperCase()} · {item.value}</span>
				{item.bytes ? <small>{item.bytes.toLocaleString("fr-FR")} octets{item.sha256 ? ` · sha256 ${item.sha256.slice(0, 12)}…` : ""}</small> : null}
				<button type="button" aria-label={`Retirer ${item.value}`} onClick={() => setReferences((current) => current.filter((_, at) => at !== index))}>×</button>
			</li>)}</ul> : null}
			<div className="avatar-extensions__actions">
				<button type="button" disabled={busy} onClick={() => projectFile.current?.click()}>Ouvrir un JSON OC</button>
				<button type="button" disabled={busy} onClick={() => glbFile.current?.click()}>Ouvrir un GLB</button>
				<label>Texture
					<input type="number" min={0} max={Math.max(0, (localModel?.textures ?? 1) - 1)} value={textureIndex} disabled={!localModel?.textures}
						onChange={(event) => setTextureIndex(Math.max(0, Math.min((localModel?.textures ?? 1) - 1, Number(event.target.value))))} />
				</label>
				<button type="button" disabled={busy || !localModel?.textures} onClick={() => pngFile.current?.click()}>Appliquer un PNG</button>
				<button type="button" disabled={busy || !/^[A-Za-z0-9_-]{1,120}$/.test(slug) || (!!internalCode && !/^c\d{8}$/i.test(internalCode))} onClick={() => void run(async () => {
					const json = await avatarProject(catalog, state, { slug, internalCode: internalCode || null, references });
					saveBlob(new Blob([json], { type: "application/json" }), `${slug}.oc.json`);
				})}>Exporter OC JSON</button>
				<button type="button" disabled={busy || (!localModel && !modelUrl)} onClick={() => void run(async () => {
					if (localModel) saveBlob(new Blob([localModel.bytes.slice().buffer], { type: "model/gltf-binary" }), "avatar.glb");
					else if (modelUrl) await saveUrl(modelUrl, "avatar.glb");
				})}>Exporter GLB</button>
				<button type="button" disabled={busy || !captureRoot.current} onClick={() => captureRoot.current && void run(() => capturePng(captureRoot.current!))}>Capturer PNG</button>
			</div>
			<p className="avatar-extensions__limit">Les chemins déclarés restent de la provenance. Seuls les fichiers GLB validés par Rust sont affichés; un PNG est appliqué à un index de texture explicite puis le GLB est reparsé.</p>
			{message ? <p role="status">{message}</p> : null}
		</section> : null}
	</div>;
}
