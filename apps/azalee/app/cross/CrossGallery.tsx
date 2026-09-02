"use client";

import React, { useState } from "react";
import Image from "next/image";
import { Image as ImageIcon, ShieldCheck, Database, Maximize2, X, Cpu } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, Badge } from "@rosegriffon/ui";

interface AssetTab {
	id: string;
	label: string;
	icon: React.ReactNode;
}

const TABS: AssetTab[] = [
	{ id: "apk-icons", label: "Icônes & Lanceur (APK)", icon: <ShieldCheck className="size-4" /> },
	{ id: "apk-textures", label: "Atlases de Textures (APK)", icon: <ImageIcon className="size-4" /> },
	{ id: "apk-masterdata", label: "Schémas de Données (APK)", icon: <Database className="size-4" /> },
	{ id: "apk-engine3d", label: "Moteur & Indexation 3D (APK)", icon: <Cpu className="size-4" /> },
];

const APK_ICONS = [
	{
		src: "/inazuma-cross/textures/app_icon_apk.png",
		name: "app_icon.png",
		desc: "L'icône officielle de l'application Inazuma Eleven Cross affichant Yo Shiosawa, extraite des ressources mipmap de l'APK.",
	},
	{
		src: "/inazuma-cross/textures/ic_launcher_foreground.png",
		name: "ic_launcher_foreground.png",
		desc: "Le premier plan (foreground) de l'icône de lancement adaptative d'Android.",
	},
	{
		src: "/inazuma-cross/textures/ic_launcher_background.png",
		name: "ic_launcher_background.png",
		desc: "L'arrière-plan (background) de l'icône de lancement adaptative d'Android.",
	},
];

const APK_TEXTURES = [
	{
		src: "/inazuma-cross/textures/Goldman-Regular_SDF_Atlas.png",
		name: "Goldman-Regular SDF Atlas.png",
		desc: "Atlas de police TextMeshPro SDF utilisé pour le rendu des scores et textes dans les matchs.",
	},
	{
		src: "/inazuma-cross/textures/BO-GSanSrfStd-Bd_Atlas.png",
		name: "BO-GSanSrfStd-Bd Atlas.png",
		desc: "Atlas de textures de police système principale pour les menus du jeu (Level-5 x Aiming).",
	},
	{
		src: "/inazuma-cross/textures/BO-SoftGoStd-DeBold_Atlas.png",
		name: "BO-SoftGoStd-DeBold Atlas.png",
		desc: "Atlas de textures de police grasse secondaire extrait du package Addressables de police du jeu.",
	},
	{
		src: "/inazuma-cross/textures/Img_PointFont_TMP.png",
		name: "Img_PointFont_TMP.png",
		desc: "Atlas de police de points pour les indicateurs graphiques secondaires de l'interface.",
	},
	{
		src: "/inazuma-cross/textures/LiberationSans_Atlas.png",
		name: "LiberationSans Atlas.png",
		desc: "Atlas de police standard de secours intégré dans le build de développement Unity.",
	},
	{
		src: "/inazuma-cross/textures/Knob.png",
		name: "Knob.png",
		desc: "Asset graphique d'interrupteur/curseur extrait des bundles UI de l'interface.",
	},
	{
		src: "/inazuma-cross/textures/Checkmark.png",
		name: "Checkmark.png",
		desc: "Asset graphique de coche de sélection utilisé dans les configurations d'équipe.",
	},
];

const MASTERDATA_TABLES = [
	{
		name: "CharacterMaster",
		columns: 30,
		desc: "Table maîtresse des personnages. Contient les statistiques de base (frappe, défense, vitesse), l'ID du modèle 3D associé, l'élément (Wind/Forest/Fire/Mountain), et la rareté de base.",
	},
	{
		name: "SpecialMoveMaster",
		columns: 14,
		desc: "Table des hissatsu (techniques spéciales). Contient la puissance de base, l'élément, le coût en TP/Points, et le type de technique (Tir, Dribble, Défense, Arrêt).",
	},
	{
		name: "GachaMachineMaster",
		columns: 22,
		desc: "Table des machines à gacha (bannières de recrutement). Définit la devise requise, les taux de drop par rareté, la période de validité et les animations associées.",
	},
	{
		name: "EquipmentItemMaster",
		columns: 10,
		desc: "Table des équipements (chaussures, bracelets, pendentifs). Liste les boosts de stats octroyés, les restrictions d'utilisation par personnage, et les prix de revente.",
	},
	{
		name: "FormationMaster",
		columns: 8,
		desc: "Table des formations tactiques d'équipe. Définit les coordonnées (X, Y) des 11 positions sur le terrain et les bonus passifs accordés par la tactique.",
	},
	{
		name: "PvpRankMaster",
		columns: 14,
		desc: "Table de progression du mode PvP. Définit les seuils de points requis pour monter en division et les récompenses associées en fin de saison.",
	},
	{
		name: "RaidGroupMaster",
		columns: 9,
		desc: "Table des boss de raids collaboratifs. Associe le boss à un ennemi géant, ses phases de combat, ses techniques et la table de récompenses en points.",
	},
];

export function CrossGallery() {
	const [activeTab, setActiveTab] = useState<string>("apk-icons");
	const [selectedTable, setSelectedTable] = useState<string>("CharacterMaster");
	const [lightboxImage, setLightboxImage] = useState<string | null>(null);

	const activeTableData = MASTERDATA_TABLES.find((t) => t.name === selectedTable) || MASTERDATA_TABLES[0];

	return (
		<Card className="border-2 bg-surface-container-low shadow-md" style={{ borderColor: "#00aeef80" }}>
			<CardHeader className="pb-4 border-b border-outline-variant/20">
				<CardTitle className="type-headline-small flex items-center gap-3 text-primary">
					<Database className="size-6 text-[#00aeef]" />
					Démonstrateur d'Assets & Données de l'APK
				</CardTitle>
				<p className="type-body-medium text-on-surface-variant">
					Visualisez les fichiers réels, les atlases de polices et la structure de la base de données extraits directement de l'APK d'Inazuma Eleven Cross.
				</p>
			</CardHeader>
			<CardContent className="pt-6 space-y-6">
				{/* Onglets */}
				<div className="flex flex-wrap gap-2 border-b border-outline-variant/10 pb-4">
					{TABS.map((tab) => (
						<button
							key={tab.id}
							onClick={() => setActiveTab(tab.id)}
							className={`flex items-center gap-2 rounded-xl px-4 py-2.5 type-label-large font-bold transition-all duration-300 ${
								activeTab === tab.id
									? "bg-primary text-on-primary shadow-sm scale-105"
									: "bg-surface hover:bg-surface-container-high text-on-surface-variant"
							}`}
						>
							{tab.icon}
							{tab.label}
						</button>
					))}
				</div>

				{/* Onglet 1 : Icônes & Lanceur de l'APK */}
				{activeTab === "apk-icons" && (
					<div className="space-y-6">
						<div className="flex items-center gap-2 text-on-surface-variant">
							<Badge className="bg-primary-container text-on-primary-container">Véridique APK</Badge>
							<span className="type-body-medium">Images d'icônes et lanceurs extraites du répertoire de ressources mipmap de l'APK.</span>
						</div>
						<div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
							{APK_ICONS.map((img) => (
								<Card key={img.name} className="overflow-hidden border border-outline-variant/20 bg-surface-container-low shadow-sm">
									<div 
										onClick={() => setLightboxImage(img.src)}
										className="group relative aspect-square bg-[#0c1730]/90 cursor-pointer flex items-center justify-center"
									>
										<div className="relative size-36">
											<Image
												src={img.src}
												alt={img.name}
												fill
												sizes="144px"
												className="object-contain transition-all group-hover:scale-105"
											/>
										</div>
										<div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
											<Maximize2 className="size-6 text-white" />
										</div>
									</div>
									<CardHeader className="p-4">
										<CardTitle className="type-title-medium font-mono text-[#00aeef]">{img.name}</CardTitle>
									</CardHeader>
									<CardContent className="px-4 pb-4 pt-0">
										<p className="type-body-small text-on-surface-variant">{img.desc}</p>
									</CardContent>
								</Card>
							))}
						</div>
					</div>
				)}

				{/* Onglet 2 : Atlases de Textures de Polices de l'APK */}
				{activeTab === "apk-textures" && (
					<div className="space-y-6">
						<div className="flex items-center gap-2 text-on-surface-variant">
							<Badge className="bg-primary-container text-on-primary-container">Véridique APK</Badge>
							<span className="type-body-medium">Atlases de polices TextMeshPro extraites des bundles Addressables intégrés dans l'APK.</span>
						</div>
						<div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
							{APK_TEXTURES.map((tex) => (
								<Card key={tex.name} className="overflow-hidden border border-outline-variant/20 bg-surface-container-low shadow-sm">
									<div 
										onClick={() => setLightboxImage(tex.src)}
										className="group relative aspect-square bg-slate-950 cursor-pointer flex items-center justify-center"
									>
										<Image
											src={tex.src}
											alt={tex.name}
											fill
											sizes="(max-width: 640px) 45vw, 15vw"
											className="object-contain p-2 opacity-80 group-hover:opacity-100 transition-all"
										/>
										<div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
											<Maximize2 className="size-5 text-white" />
										</div>
									</div>
									<CardHeader className="p-3">
										<CardTitle className="type-title-small font-mono text-[#00aeef] truncate" title={tex.name}>{tex.name}</CardTitle>
									</CardHeader>
									<CardContent className="px-3 pb-3 pt-0">
										<p className="type-body-small text-on-surface-variant text-[11px] leading-tight">{tex.desc}</p>
									</CardContent>
								</Card>
							))}
						</div>
					</div>
				)}

				{/* Onglet 3 : Schémas de Données & Masterdata */}
				{activeTab === "apk-masterdata" && (
					<div className="space-y-6">
						<div className="flex items-center gap-2 text-on-surface-variant">
							<Badge className="bg-secondary-container text-on-secondary-container">SQLite & IL2CPP</Badge>
							<span className="type-body-medium">Schéma et taxonomie de la base de données masterdata de <strong>153 tables</strong> extraite de l'APK.</span>
						</div>

						<div className="grid grid-cols-1 gap-6 lg:grid-cols-[250px_1fr]">
							{/* Menu latéral tables */}
							<div className="flex flex-col gap-1.5 max-h-[350px] overflow-y-auto pr-2 border-r border-outline-variant/10">
								{MASTERDATA_TABLES.map((t) => (
									<button
										key={t.name}
										onClick={() => setSelectedTable(t.name)}
										className={`text-left px-3 py-2 rounded-lg font-mono text-xs transition-colors ${
											selectedTable === t.name
												? "bg-primary-container text-on-primary-container font-bold"
												: "hover:bg-surface-container-high text-on-surface-variant"
										}`}
									>
										{t.name}
									</button>
								))}
							</div>

							{/* Détail table sélectionnée */}
							<Card className="bg-surface border border-outline-variant/20 p-5 space-y-4">
								<div>
									<h4 className="type-headline-small font-mono text-[#00aeef]">{activeTableData.name}</h4>
									<Badge className="mt-2 bg-secondary text-on-secondary font-mono">{activeTableData.columns} colonnes typées</Badge>
								</div>
								<p className="type-body-medium text-on-surface-variant">{activeTableData.desc}</p>
								<div className="rounded-xl bg-slate-950 p-4 font-mono text-xs text-green-400 overflow-x-auto">
									<span className="text-gray-500">// Structure DDL PostgreSQL générée depuis l'APK</span>
									<br />
									<span className="text-blue-400">CREATE TABLE</span> public.inagle_cross_{activeTableData.name.toLowerCase()} (
									<br />
									&nbsp;&nbsp;id <span className="text-yellow-400">integer</span> <span className="text-blue-400">PRIMARY KEY</span>,
									<br />
									&nbsp;&nbsp;data <span className="text-yellow-400">jsonb</span> <span className="text-blue-400">NOT NULL</span>,
									<br />
									&nbsp;&nbsp;created_at <span className="text-yellow-400">timestamp with time zone</span> <span className="text-blue-400">DEFAULT</span> now()
									<br />
									);
								</div>
							</Card>
						</div>
					</div>
				)}

				{/* Onglet 4 : Moteur & Indexation 3D */}
				{activeTab === "apk-engine3d" && (
					<div className="space-y-6">
						<div className="flex items-center gap-2 text-on-surface-variant">
							<Badge className="bg-tertiary-container text-on-tertiary-container">Unity & Addressables</Badge>
							<span className="type-body-medium">Cartographie de l'index des fichiers binaires physiques constituant le client de jeu APK.</span>
						</div>

						<div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
							<div className="bg-surface px-4 py-5 rounded-2xl text-center border border-outline-variant/30">
								<div className="type-headline-medium font-bold text-[#00aeef]">1 263</div>
								<div className="type-label-large text-on-surface-variant/80 font-bold uppercase mt-1">Meshes 3D</div>
								<p className="type-body-small text-on-surface-variant/60 mt-1">Modèles 3D géométriques référencés dans l'index de l'APK.</p>
							</div>
							<div className="bg-surface px-4 py-5 rounded-2xl text-center border border-outline-variant/30">
								<div className="type-headline-medium font-bold text-[#00aeef]">22.8 Mo</div>
								<div className="type-label-large text-on-surface-variant/80 font-bold uppercase mt-1">global-metadata</div>
								<p className="type-body-small text-on-surface-variant/60 mt-1">Fichier de métadonnées décrypté depuis l'exécutable Unity IL2CPP.</p>
							</div>
							<div className="bg-surface px-4 py-5 rounded-2xl text-center border border-outline-variant/30">
								<div className="type-headline-medium font-bold text-[#00aeef]">175 Mo</div>
								<div className="type-label-large text-on-surface-variant/80 font-bold uppercase mt-1">libil2cpp.so</div>
								<p className="type-body-small text-on-surface-variant/60 mt-1">Librairie système native contenant le code machine compilé.</p>
							</div>
							<div className="bg-surface px-4 py-5 rounded-2xl text-center border border-outline-variant/30">
								<div className="type-headline-medium font-bold text-[#00aeef]">23 247</div>
								<div className="type-label-large text-on-surface-variant/80 font-bold uppercase mt-1">Objets Catalog</div>
								<p className="type-body-small text-on-surface-variant/60 mt-1">Nombre total d'éléments Addressables indexés dans `catalog.bin`.</p>
							</div>
						</div>

						<div className="rounded-2xl border border-outline-variant/20 bg-surface p-5 flex gap-4">
							<Cpu className="size-6 text-[#00aeef] shrink-0 mt-0.5" />
							<div>
								<h4 className="type-title-medium font-bold text-primary">Preuve de Concept Technique (Spécification Unity APK)</h4>
								<p className="type-body-medium text-on-surface-variant mt-1">
									Le client de jeu tourne sous le moteur <strong>Unity 6000.0.62f1</strong> avec compilation native <strong>IL2CPP (arm64-v8a)</strong>. Les modèles 3D et meshes géométriques sont empaquetés au sein de <strong>2 081 AssetBundles</strong>. La taxonomie décryptée compte 14 283 classes de code associant la physique 3D et le rendu aux données masterdata.
								</p>
							</div>
						</div>
					</div>
				)}

				{/* Lightbox / Zoom image */}
				{lightboxImage && (
					<div
						className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 transition-all duration-300"
						onClick={() => setLightboxImage(null)}
					>
						<button
							className="absolute right-4 top-4 text-white hover:text-primary transition-colors"
							onClick={() => setLightboxImage(null)}
						>
							<X className="size-8" />
						</button>
						<div
							className="relative aspect-auto max-h-[85vh] max-w-[95vw] w-full h-full"
							onClick={(e) => e.stopPropagation()}
						>
							<Image
								src={lightboxImage}
								alt="Zoom asset"
								fill
								sizes="95vw"
								className="object-contain"
							/>
						</div>
					</div>
				)}
			</CardContent>
		</Card>
	);
}
