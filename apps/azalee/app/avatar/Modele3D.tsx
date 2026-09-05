"use client";

import { useEffect, useRef, useState } from "react";
import { loadModelViewer } from "../../lib/model-viewer-loader";
import { telecharger, type Projet } from "./projet";

type Viewer = HTMLElement & { exportScene: () => Promise<Blob>; updateFraming: () => void };
const IDENTITE = { rotation: 0, echelle: 1 };

/** Un seul viewer : les changements de recette préservent la caméra. */
export function Modele3D({ url, transformation = IDENTITE, edition = false }: {
 url: string; transformation?: Projet["transformation"]; edition?: boolean;
}) {
 const hote = useRef<HTMLDivElement>(null);
 const viewer = useRef<Viewer | null>(null);
 const [pret, setPret] = useState(false);
 const [charge, setCharge] = useState(false);
 const [erreur, setErreur] = useState("");
 const [tentative, setTentative] = useState(0);
 const [exporte, setExporte] = useState(false);
 useEffect(() => {
  let annule = false;
  setErreur("");
  loadModelViewer().then(() => {
   if (annule || !hote.current) return;
   const mv = document.createElement("model-viewer") as Viewer;
   for (const [nom, valeur] of Object.entries({ alt: "Avatar NIE éditable en 3D", "camera-controls": "", "touch-action": "pan-y", "camera-orbit": "0deg 82deg auto", "interaction-prompt": "none", exposure: "1", "shadow-intensity": "0" })) mv.setAttribute(nom, valeur);
   mv.style.cssText = "width:100%;height:100%;min-height:28rem";
   mv.addEventListener("load", () => { setCharge(true); setErreur(""); });
   mv.addEventListener("error", () => { setCharge(false); setErreur("Assemblage 3D indisponible. Réessayez ou choisissez une autre pièce."); });
   hote.current.appendChild(mv); viewer.current = mv; setPret(true);
  }).catch(e => { if (!annule) setErreur(e instanceof Error ? e.message : "Visualiseur indisponible."); });
  return () => { annule = true; viewer.current?.remove(); viewer.current = null; };
 }, [tentative]);
 useEffect(() => {
  if (!pret || !viewer.current) return;
  setCharge(false); setErreur(""); viewer.current.setAttribute("src", url);
 }, [url, pret, tentative]);
 useEffect(() => {
  if (!pret || !viewer.current) return;
  viewer.current.setAttribute("orientation", `0deg 0deg ${transformation.rotation}deg`);
  viewer.current.setAttribute("scale", `${transformation.echelle} ${transformation.echelle} ${transformation.echelle}`);
 }, [pret, tentative, transformation.rotation, transformation.echelle]);
 return <div className="flex h-full min-h-[32rem] flex-col">
  <div ref={hote} className="min-h-[28rem] flex-1" />
  <div className="flex flex-wrap items-center gap-3 p-3">
   <p role="status" className="mr-auto text-sm">{erreur || (charge ? "Modèle prêt" : "Chargement du modèle…")}</p>
   {erreur && <button onClick={() => { setPret(false); setCharge(false); setTentative(t => t + 1); }}>Réessayer</button>}
   {edition && <>
    <button onClick={() => { viewer.current?.setAttribute("camera-orbit", "0deg 82deg auto"); viewer.current?.updateFraming(); }}>Recadrer</button>
    <button disabled={!charge || exporte} onClick={async () => {
     const mv = viewer.current;
     if (!mv) return;
     setExporte(true);
     try { telecharger(await mv.exportScene(), "avatar.glb"); }
     catch { setErreur("Export GLB impossible. Réessayez après le chargement complet."); }
     finally { setExporte(false); }
    }}>{exporte ? "Export en cours…" : "Exporter le GLB"}</button>
   </>}
  </div>
 </div>;
}
