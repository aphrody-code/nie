"use client";

import { useReducer, useState } from "react";
import { Button } from "@rosegriffon/ui/button";
import { Input } from "@rosegriffon/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@rosegriffon/ui/select";
import { Modele3D, CurseurAtelier } from "./Modele3D";
import { ImportAvatar } from "./ImportAvatar";
import { lireProjet, nouveauProjet, reduireProjet, telecharger, type EtatAvatar, type Projet } from "./projet";
import { iconePart, nomPart, NOMS_CATEGORIES } from "./liaisons";
import type { Catalogue } from "./types";
import "./atelier.css";

const CATEGORIES_MASQUEES = new Set([1, 16, 17, 18]);

/** Le serveur reste propriétaire de l’assemblage ; l’atelier édite sa recette. */
export function Atelier({ catalogue, avatar, restaurer, url, cdn }: {
 catalogue: Catalogue; avatar: EtatAvatar; restaurer: (a: EtatAvatar) => void; url: string | null; cdn?: string;
}) {
 const [h, dispatch] = useReducer(reduireProjet, avatar, a => ({ passes: [], present: nouveauProjet(a), futurs: [] }));
 const [categorie, setCategorie] = useState(4);
 const [recherche, setRecherche] = useState("");
 const [message, setMessage] = useState("");
 const [importLocal, setImportLocal] = useState(false);
 const p = h.present;
 const categories = catalogue.categories.filter(c => c.parts.length && !CATEGORIES_MASQUEES.has(c.faceSettingType));
 const cat = categories.find(c => c.faceSettingType === categorie) ?? categories[0];
 const active = cat?.faceSettingType ?? categorie;
 const origine = cdn ?? (url?.includes("/model-avatar/") ? url.slice(0, url.indexOf("/model-avatar/")) : "https://cdn.rosegriffon.fr");
 const selection = cat?.parts.find(part => part.id === p.avatar.choix[active]);
 const pieces = cat?.parts.map((part, index) => ({ part, nom: nomPart(part, index) })).filter(({ nom }) => nom.toLocaleLowerCase("fr").includes(recherche.toLocaleLowerCase("fr"))) ?? [];
 const modifier = (projet: Projet) => { dispatch({ type: "modifier", projet }); restaurer(projet.avatar); };
 const changerAvatar = (suite: Partial<EtatAvatar>) => modifier({ ...p, avatar: { ...p.avatar, ...suite } });
 const parcourir = (type: "annuler" | "retablir") => { const suite = reduireProjet(h, { type }); dispatch({ type }); restaurer(suite.present.avatar); };
 if (importLocal) return <ImportAvatar retour={() => setImportLocal(false)} />;
 return <section className="nie-atelier" aria-label="Atelier 3D NIE">
  <header className="atelier-entete">
   <div className="atelier-titre"><h1>Atelier avatar</h1><p>Votre personnage, pièce par pièce.</p></div>
   <div className="atelier-actions">
    <Button variant="outline" onClick={() => setImportLocal(true)}>Importer 2D / 3D</Button>
    <Button variant="outline" disabled={!h.passes.length} onClick={() => parcourir("annuler")}>Annuler</Button>
    <Button variant="outline" disabled={!h.futurs.length} onClick={() => parcourir("retablir")}>Rétablir</Button>
    <Button onClick={() => { telecharger(new Blob([JSON.stringify(p, null, 2)], { type: "application/json" }), "avatar.nie.json"); setMessage("Projet exporté : conservez le fichier pour reprendre votre travail."); }}>Enregistrer le projet</Button>
   </div>
  </header>
  <p role="status" className="atelier-statut">{message || "Le projet conserve vos pièces et vos transformations."}</p>
  <div className="atelier-espace">
   <aside className="atelier-bibliotheque atelier-panneau" aria-label="Bibliothèque de pièces">
    <div className="atelier-section-titre"><h2>Bibliothèque</h2><span>{cat?.parts.length ?? 0} pièces</span></div>
    <label className="atelier-champ"><span>Catégorie</span>
     <Select value={String(active)} disabled={!categories.length} onValueChange={value => { setCategorie(Number(value)); setRecherche(""); }}>
      <SelectTrigger aria-label="Catégorie de pièces"><SelectValue /></SelectTrigger>
      <SelectContent className="atelier-menu">{categories.map(c => <SelectItem key={c.faceSettingType} value={String(c.faceSettingType)}>{NOMS_CATEGORIES[c.faceSettingType] ?? `Pièces ${c.faceSettingType}`}</SelectItem>)}</SelectContent>
     </Select>
    </label>
    <label className="atelier-champ"><span>Rechercher une pièce</span><Input type="search" placeholder="Nom de la pièce…" value={recherche} onChange={e => setRecherche(e.target.value)} /></label>
    <div className="atelier-pieces" aria-label={NOMS_CATEGORIES[active] ?? "Pièces"}>
     {pieces.map(({ part, nom }) => {
      const vignette = iconePart(origine, part);
      return <Button key={part.id} variant="outline" className="atelier-piece" aria-label={nom} aria-pressed={selection?.id === part.id}
       data-part-id={part.id} data-category={active} data-icon-hash={part.iconeHash} data-model-paths={JSON.stringify([...part.modeles, ...(part.modeles2 ?? [])])}
       onClick={() => changerAvatar({ choix: { ...p.avatar.choix, [active]: part.id } })}>
       <VignettePiece key={vignette ?? part.id} url={vignette} />
       <span className="atelier-piece-nom">{nom}</span>
       {selection?.id === part.id && <span className="atelier-selection" aria-hidden="true">✓</span>}
      </Button>;
     })}
    </div>
    {!pieces.length && <p className="atelier-note">Aucune pièce ne correspond à cette recherche.</p>}
    <p className="atelier-note" data-unsupported-category="18">Poitrine : réglage non pris en charge. Les préréglages de visage et de genre ne sont pas proposés ici.</p>
   </aside>
   <div className="atelier-scene" aria-label="Scène 3D">
    <div className="atelier-scene-titre"><span>{p.nom || "Sans titre"}</span><span>Vue 3D</span></div>
    {url ? <Modele3D url={url} transformation={p.transformation} edition /> : <div className="atelier-vide"><h2>Aperçu indisponible</h2><p>Choisissez une autre composition pour lancer l’assemblage.</p></div>}
   </div>
   <aside className="atelier-inspecteur atelier-panneau" aria-label="Inspecteur">
    <h2>Inspecteur</h2>
    <label className="atelier-champ"><span>Nom du projet</span><Input maxLength={120} value={p.nom} onChange={e => modifier({ ...p, nom: e.target.value })} /></label>
    <label className="atelier-champ"><span>Morphologie</span>
     <Select value={String(p.avatar.morphologie)} onValueChange={value => {
      const choix = { ...p.avatar.choix }; delete choix[17]; const morphologie = Number(value);
      changerAvatar({ choix, morphologie, genre: catalogue.modelesDeBase.morphologies[morphologie] === "female" ? 1 : 0 });
     }}><SelectTrigger aria-label="Morphologie"><SelectValue /></SelectTrigger><SelectContent className="atelier-menu">{catalogue.modelesDeBase.morphologies.map((nom, i) => <SelectItem key={`${nom}-${i}`} value={String(i)}>{nom}</SelectItem>)}</SelectContent></Select>
    </label>
    <div className="atelier-groupe"><h3>{NOMS_CATEGORIES[active] ?? "Pièce"}</h3><p className="atelier-note">{selection ? nomPart(selection, cat!.parts.indexOf(selection)) : "Composition par défaut — choisissez une pièce dans la bibliothèque."}</p>
     {cat && [3, 4, 6].includes(active) && <label className="atelier-champ"><span>Couleur</span>
      <Select value={String(p.avatar.valeurs[`couleur.${active}`] ?? -1)} onValueChange={value => changerAvatar({ valeurs: { ...p.avatar.valeurs, [`couleur.${active}`]: Number(value) } })}>
       <SelectTrigger aria-label="Couleur de la pièce"><SelectValue /></SelectTrigger><SelectContent className="atelier-menu"><SelectItem value="-1">Couleur par défaut</SelectItem>{cat.couleurs.map((id, i) => catalogue.couleursRgb?.[id] ? <SelectItem key={`${id}-${i}`} value={String(i)}><span className="atelier-echantillon" style={{ backgroundColor: `#${catalogue.couleursRgb[id].rgb}` }} />#{catalogue.couleursRgb[id].rgb}</SelectItem> : null)}</SelectContent>
      </Select>
     </label>}
    </div>
    <div className="atelier-groupe"><h3>Objet complet</h3>
     <CurseurAtelier label="Rotation Y" valeur={p.transformation.rotation} unite="°" min={-180} max={180} step={5} changer={rotation => modifier({ ...p, transformation: { ...p.transformation, rotation } })} />
     <CurseurAtelier label="Échelle" valeur={p.transformation.echelle} unite="×" min={0.25} max={4} step={0.05} changer={echelle => modifier({ ...p, transformation: { ...p.transformation, echelle } })} />
     <Button variant="outline" className="atelier-bouton-large" onClick={() => modifier({ ...p, transformation: { rotation: 0, echelle: 1 } })}>Réinitialiser les transformations</Button>
     <p className="atelier-note">Glissez pour orbiter, utilisez la molette pour zoomer. Les transformations portent sur l’objet entier.</p>
    </div>
    <div className="atelier-groupe"><label className="atelier-champ"><span>Ouvrir un projet</span>
     <Input aria-label="Ouvrir un projet JSON" type="file" accept=".json,application/json" onChange={async e => {
      const fichier = e.target.files?.[0]; e.target.value = ""; if (!fichier) return;
      try { if (fichier.size > 100_000) throw new Error("Projet trop volumineux (100 Ko maximum)."); modifier(lireProjet(await fichier.text(), catalogue)); setMessage("Projet ouvert. Annuler restaure le projet précédent."); }
      catch (erreur) { setMessage(erreur instanceof Error ? erreur.message : "Lecture impossible."); }
     }} />
    </label><p className="atelier-note">Le JSON conserve la recette éditable. Le GLB est un instantané 3D, pas une sauvegarde du jeu.</p></div>
   </aside>
  </div>
 </section>;
}

function VignettePiece({ url }: { url: string | null }) {
 const [erreur, setErreur] = useState(false);
 return <span className="atelier-vignette">{url && !erreur ? <img src={url} alt="" loading="lazy" decoding="async" width={88} height={88} onError={() => setErreur(true)} /> : <span className="atelier-vignette-absente">Aperçu {erreur ? "indisponible" : "non fourni"}</span>}</span>;
}
