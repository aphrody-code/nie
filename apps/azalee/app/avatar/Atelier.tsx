"use client";

import { useReducer, useState } from "react";
import { Modele3D } from "./Modele3D";
import { lireProjet, nouveauProjet, reduireProjet, telecharger, type EtatAvatar, type Projet } from "./projet";
import type { Catalogue } from "./types";

/** Atelier de recettes NIE : le serveur reste propriétaire de l'assemblage. */
export function Atelier({ catalogue, avatar, restaurer, url }: {
	catalogue: Catalogue; avatar: EtatAvatar; restaurer: (a: EtatAvatar) => void; url: string | null;
}) {
	const [h, dispatch] = useReducer(reduireProjet, avatar, a => ({ passes: [], present: nouveauProjet(a), futurs: [] }));
	const [categorie, setCategorie] = useState(4);
	const [message, setMessage] = useState("");
	const p = h.present;
	const cat = catalogue.categories.find(c => c.faceSettingType === categorie);
	const modifier = (projet: Projet) => {
		dispatch({ type: "modifier", projet });
		restaurer(projet.avatar);
	};
	const changerAvatar = (suite: Partial<EtatAvatar>) => modifier({ ...p, avatar: { ...p.avatar, ...suite } });
	const parcourir = (type: "annuler" | "retablir") => {
		const suite = reduireProjet(h, { type });
		dispatch({ type });
		restaurer(suite.present.avatar);
	};
	const control = "rounded border border-outline-variant bg-surface px-3 py-2 text-on-surface focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-40";
	return <section className="space-y-4 text-on-surface" aria-label="Atelier 3D NIE">
		<header className="flex flex-wrap items-center gap-3">
			<div className="mr-auto"><h1 className="text-2xl font-semibold">Atelier avatar 3D</h1>
				<p className="text-sm text-on-surface-variant">Composer, inspecter et enregistrer un projet NIE.</p></div>
			<button className={control} disabled={!h.passes.length} onClick={() => parcourir("annuler")}>Annuler</button>
			<button className={control} disabled={!h.futurs.length} onClick={() => parcourir("retablir")}>Rétablir</button>
			<button className={control} onClick={() => {
				telecharger(new Blob([JSON.stringify(p, null, 2)], { type: "application/json" }), "avatar.nie.json");
				setMessage("Projet exporté : conservez le fichier pour reprendre votre travail.");
			}}>Enregistrer le projet</button>
			<label className={control}>Ouvrir un projet
				<input className="block max-w-48 text-xs" aria-label="Ouvrir un projet JSON" type="file" accept=".json,application/json" onChange={async e => {
					const fichier = e.target.files?.[0]; e.target.value = "";
					if (!fichier) return;
					try {
						if (fichier.size > 100_000) throw new Error("Projet trop volumineux (100 Ko maximum).");
						modifier(lireProjet(await fichier.text(), catalogue)); setMessage("Projet ouvert. Annuler restaure le projet précédent.");
					} catch (erreur) { setMessage(erreur instanceof Error ? erreur.message : "Lecture impossible."); }
				}} />
			</label>
		</header>
		<p role="status" className="min-h-5 text-sm">{message}</p>
		<div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)_18rem]">
			<aside className="space-y-4" aria-label="Composition">
				<label className="block">Nom du projet<input className={`${control} w-full`} maxLength={120} value={p.nom} onChange={e => modifier({ ...p, nom: e.target.value })} /></label>
				<label className="block">Morphologie<select className={`${control} w-full`} value={p.avatar.morphologie} onChange={e => {
					const choix = { ...p.avatar.choix }; delete choix[17];
					const morphologie = Number(e.target.value);
					changerAvatar({ choix, morphologie, genre: catalogue.modelesDeBase.morphologies[morphologie] === "female" ? 1 : 0 });
				}}>{catalogue.modelesDeBase.morphologies.map((nom, i) => <option key={nom} value={i}>{nom}</option>)}</select></label>
				<h2 className="font-semibold">Pièces et couches</h2>
				<div className="flex max-h-96 flex-col gap-1 overflow-auto">{catalogue.categories.filter(c => c.parts.length && c.faceSettingType !== 1 && c.faceSettingType !== 17).map(c =>
					<button key={c.faceSettingType} className={`${control} text-left`} aria-pressed={categorie === c.faceSettingType} onClick={() => setCategorie(c.faceSettingType)}>
						{c.prefixe || `Catégorie ${c.faceSettingType}`} {p.avatar.choix[c.faceSettingType] ? "•" : ""}
					</button>)}</div>
			</aside>
			<div className="relative min-h-[32rem] rounded-xl bg-surface-container-low" aria-label="Scène 3D">
				{url ? <Modele3D url={url} transformation={p.transformation} edition /> : <p>Assemblage indisponible pour cette composition.</p>}
			</div>
			<aside className="space-y-5" aria-label="Inspecteur">
				<h2 className="font-semibold">Inspecteur · {cat?.prefixe}</h2>
				{cat && <label className="block">Pièce<select className={`${control} w-full`} value={p.avatar.choix[categorie] || cat.parts[0]?.id || ""} onChange={e => changerAvatar({ choix: { ...p.avatar.choix, [categorie]: e.target.value } })}>
					{cat.parts.map((part, i) => <option key={part.id} value={part.id}>{part.resource || `Variante ${i + 1}`}</option>)}
				</select></label>}
				{cat && [3, 4, 6].includes(categorie) && <label className="block">Couleur<select className={`${control} w-full`} value={p.avatar.valeurs[`couleur.${categorie}`] ?? -1} onChange={e => changerAvatar({ valeurs: { ...p.avatar.valeurs, [`couleur.${categorie}`]: Number(e.target.value) } })}>
					<option value={-1}>Couleur par défaut</option>{cat.couleurs.map((id, i) => catalogue.couleursRgb?.[id] ? <option key={id} value={i}>#{catalogue.couleursRgb[id].rgb}</option> : null)}
				</select></label>}
				<h2 className="font-semibold">Objet complet</h2>
				<label className="block">Rotation Y : {p.transformation.rotation}°<input className="w-full" type="range" min={-180} max={180} step={5} value={p.transformation.rotation} onChange={e => modifier({ ...p, transformation: { ...p.transformation, rotation: Number(e.target.value) } })} /></label>
				<label className="block">Échelle : {p.transformation.echelle}×<input className="w-full" type="range" min={0.25} max={4} step={0.05} value={p.transformation.echelle} onChange={e => modifier({ ...p, transformation: { ...p.transformation, echelle: Number(e.target.value) } })} /></label>
				<button className={control} onClick={() => modifier({ ...p, transformation: { rotation: 0, echelle: 1 } })}>Réinitialiser les transformations</button>
				<p className="text-sm text-on-surface-variant">Glisser pour orbiter ; molette pour zoomer. Les transformations portent sur l’objet entier. Les pièces sont réassemblées par NIE.</p>
				<p className="text-sm text-on-surface-variant">Le JSON conserve la recette éditable. Le GLB est un instantané 3D ; ce n’est pas une sauvegarde du jeu.</p>
			</aside>
		</div>
	</section>;
}
