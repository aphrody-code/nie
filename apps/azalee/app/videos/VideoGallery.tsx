"use client";

/**
 * Grille des cinématiques (îlot client), rangée par rubrique.
 *
 * Chaque carte lit le flux **à la demande** (`preload="none"` : aucun octet réseau tant qu'on ne
 * lance pas la lecture) — indispensable avec 97 films, car chaque flux déclenche un démux
 * USM→MP4 live côté CDN.
 *
 * Deux choses que cette galerie doit faire et qu'une simple grille de `<video>` ne fait pas :
 *
 * * **Le son est un fichier à part.** 95 films sur 97 sont muets dans leur conteneur ; leur
 *   bande-son vit dans `anime_stream` et se sert en WAV (`?track=audio`). Le lecteur monte donc
 *   un `<audio>` distinct et le tient synchronisé sur la vidéo — c'est le lecteur qui recale,
 *   pas le conteneur.
 * * **20 films ne se lisent pas dans un navigateur.** Les MPEG-2 (18 écrans-titres, 2 logos)
 *   n'ont aucun conteneur web : on l'annonce et on propose le flux élémentaire au téléchargement,
 *   au lieu d'un lecteur qui resterait noir.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { MediaCount, MediaTitle } from "@/components/wiki/MediaShell";
import { cpkExplorerHref } from "@rosegriffon/azalee/cpk/live";
import {
	aDuSon,
	type FilmDto,
	type LangueDto,
	formatDefinition,
	formatDuree,
	formatOctets,
	formatSortie,
	ordreRubrique,
	videoAudioUrl,
	videoDownloadUrl,
	videoUrl,
} from "@rosegriffon/azalee/cpk/video";

/** Un film du catalogue, augmenté de ce que la page a résolu côté serveur. */
export interface FilmVue extends FilmDto {
	/** Titre affichable — un vrai nom quand les données du jeu en portent un, sinon le code. */
	titre: string;
	/** Contexte attesté (épisode, langue), `null` s'il n'y en a pas. */
	contexte: string | null;
	/** Chemin réellement servi : la variante haut débit quand elle existe. */
	cheminServi: string;
	/** Taille de la variante servie, en octets. */
	octetsServis: number;
	/** Variante servie : `haute` = dx11 (débit PC), `standard` = common. */
	variante: "haute" | "standard";
}

/** Écart au-delà duquel la piste sonore est recalée sur l'image, en secondes. */
const DERIVE_MAX = 0.25;

/**
 * Lecteur d'un film : l'image d'un côté, le son de l'autre, tenus ensemble.
 *
 * La vidéo remuxée ne porte aucune piste sonore — le remux est vidéo seule, et le HCA de la
 * bande-son n'entre dans aucun conteneur web. Le `<video>` est donc toujours muet, et c'est
 * l'`<audio>` qui porte le son : volume, vitesse et position lui sont répercutés.
 */
function LecteurFilm({ film }: { film: FilmVue }) {
	const videoRef = useRef<HTMLVideoElement>(null);
	const audioRef = useRef<HTMLAudioElement>(null);
	const avecSon = aDuSon(film);
	const [erreurSon, setErreurSon] = useState(false);

	const recaler = useCallback(() => {
		const v = videoRef.current;
		const a = audioRef.current;
		if (!v || !a) return;
		if (Math.abs(a.currentTime - v.currentTime) > DERIVE_MAX) a.currentTime = v.currentTime;
	}, []);

	// Le son suit l'image : lecture, pause, saut, vitesse, volume.
	useEffect(() => {
		const v = videoRef.current;
		const a = audioRef.current;
		if (!v || !a) return;
		const jouer = () => {
			a.currentTime = v.currentTime;
			void a.play().catch(() => setErreurSon(true));
		};
		const pause = () => a.pause();
		const vitesse = () => {
			a.playbackRate = v.playbackRate;
		};
		const volume = () => {
			a.volume = v.volume;
			a.muted = v.muted;
		};
		v.addEventListener("play", jouer);
		v.addEventListener("pause", pause);
		v.addEventListener("seeked", recaler);
		v.addEventListener("timeupdate", recaler);
		v.addEventListener("ratechange", vitesse);
		v.addEventListener("volumechange", volume);
		volume();
		return () => {
			v.removeEventListener("play", jouer);
			v.removeEventListener("pause", pause);
			v.removeEventListener("seeked", recaler);
			v.removeEventListener("timeupdate", recaler);
			v.removeEventListener("ratechange", vitesse);
			v.removeEventListener("volumechange", volume);
		};
	}, [recaler]);

	return (
		<>
			{/* eslint-disable-next-line jsx-a11y/media-has-caption -- les sous-titres du jeu ne sont pas encore extraits en WebVTT */}
			<video
				ref={videoRef}
				controls
				autoPlay
				muted={!avecSon}
				preload="metadata"
				className="absolute inset-0 size-full bg-black"
				src={videoUrl(film.cheminServi)}
			/>
			{avecSon && (
				// eslint-disable-next-line jsx-a11y/media-has-caption -- piste sonore seule, sans dialogue transcrit
				<audio
					ref={audioRef}
					preload="auto"
					src={videoAudioUrl(film.chemin)}
					onError={() => setErreurSon(true)}
				/>
			)}
			{avecSon && erreurSon && (
				<p className="absolute bottom-1 left-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white">
					bande-son indisponible
				</p>
			)}
		</>
	);
}

/** Les repères d'un film, dans l'ordre où on les cherche : durée, définition, poids, son. */
function Reperes({ film }: { film: FilmVue }) {
	const duree = formatDuree(film.duree);
	const definition = formatDefinition(film);
	return (
		<span className="text-[11px] text-on-surface-variant/70">
			{duree && <>{duree} · </>}
			{definition && <>{definition} · </>}
			{formatOctets(film.octetsServis)}
			{film.variante === "haute" && <span title="Variante PC, débit supérieur"> · HD</span>}
			{film.cadence != null && film.cadence > 0 && <> · {film.cadence.toFixed(0)} i/s</>}
		</span>
	);
}

/** Une carte : l'aperçu, le lecteur à la demande, et ce qu'on peut emporter. */
function CarteFilm({ film }: { film: FilmVue }) {
	const [actif, setActif] = useState(false);
	const sortie = formatSortie(film);
	const avecSon = aDuSon(film);
	const lisible = film.lisibleNavigateur;

	return (
		<div className="group overflow-hidden rounded-2xl border border-outline-variant/20 bg-surface-container transition-colors hover:border-primary/40">
			<div className="relative aspect-video bg-surface-container-high">
				{actif && lisible ? (
					<LecteurFilm film={film} />
				) : (
					<button
						type="button"
						onClick={() => setActif(true)}
						disabled={!lisible}
						className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-on-surface-variant transition-colors hover:text-primary disabled:cursor-not-allowed disabled:hover:text-on-surface-variant"
						aria-label={lisible ? `Lire ${film.titre}` : `${film.titre} — codec non lisible ici`}
					>
						<Icon name={lisible ? "play_circle" : "movie_off"} size={56} />
						<span className="px-3 text-center text-xs">
							{lisible ? "Lire" : `${film.codec.toUpperCase()} — aucun navigateur ne le décode`}
						</span>
					</button>
				)}
				{film.langue && (
					<span className="absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium uppercase text-white">
						{film.langue}
					</span>
				)}
				{!actif && avecSon && (
					<span
						className="absolute right-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white"
						title={
							film.bandeSon
								? `Bande-son ${film.bandeSon.cue} (anime_stream)`
								: "Bande-son dans le conteneur"
						}
					>
						<Icon name="music_note" size={11} />
					</span>
				)}
			</div>

			<div className="min-w-0 p-2.5">
				<MediaTitle title={film.titre} code={film.nom} context={film.contexte ?? undefined} />
				<div className="mt-1 flex items-center justify-between gap-2">
					<Reperes film={film} />
					<span className="flex items-center gap-2">
						<a
							href={videoDownloadUrl(film.cheminServi, sortie.id)}
							className="inline-flex items-center gap-1 text-[11px] text-on-surface-variant transition-colors hover:text-primary"
							title={`Télécharger le ${sortie.libelle} (remux sans réencodage)`}
						>
							<Icon name="download" size={12} /> {sortie.libelle}
						</a>
						{avecSon && (
							<a
								href={videoDownloadUrl(film.chemin, "wav")}
								className="text-[11px] text-on-surface-variant/70 transition-colors hover:text-primary"
								title="Télécharger la bande-son décodée (WAV)"
							>
								WAV
							</a>
						)}
						<a
							href={cpkExplorerHref(film.cheminServi)}
							className="text-[11px] text-on-surface-variant/70 transition-colors hover:text-primary"
							title="Voir le fichier dans l'explorateur CPK"
						>
							USM
						</a>
					</span>
				</div>
			</div>
		</div>
	);
}

/** Filtre de son : ce qu'on cherche quand on cherche « les films qui ont une musique ». */
type FiltreSon = "tous" | "avec" | "sans";

export function VideoGallery({
	films,
	langues,
	degrade,
}: {
	films: FilmVue[];
	langues: LangueDto[];
	degrade: boolean;
}) {
	const [rubrique, setRubrique] = useState<string>("toutes");
	const [langue, setLangue] = useState<string>("toutes");
	const [son, setSon] = useState<FiltreSon>("tous");
	const [requete, setRequete] = useState("");

	// Les rubriques viennent des films eux-mêmes, dans l'ordre du récit — pas de l'alphabet, qui
	// intercalerait « Chronicle » entre deux chapitres.
	const rubriques = useMemo(() => {
		const vues = [...new Set(films.map((f) => f.rubrique))];
		return vues.toSorted((a, b) => ordreRubrique(a) - ordreRubrique(b) || a.localeCompare(b, "fr"));
	}, [films]);

	// Les langues réellement portées par le corpus, nommées par la table du jeu.
	const languesPresentes = useMemo(() => {
		const codes = new Set(films.map((f) => f.langue).filter((l): l is string => l != null));
		const nom = new Map(langues.map((l) => [l.code, l.nom]));
		return [...codes]
			.toSorted((a, b) => a.localeCompare(b, "fr"))
			.map((code) => ({ code, nom: nom.get(code) ?? code }));
	}, [films, langues]);

	const visibles = useMemo(() => {
		const q = requete.trim().toLowerCase();
		return films.filter((f) => {
			if (rubrique !== "toutes" && f.rubrique !== rubrique) return false;
			if (langue !== "toutes" && f.langue !== langue) return false;
			if (son === "avec" && !aDuSon(f)) return false;
			if (son === "sans" && aDuSon(f)) return false;
			if (q === "") return true;
			// La recherche porte sur le libellé, le code et le contexte : « épisode 3 » doit se
			// trouver par son nom, et un code connu doit continuer de fonctionner.
			return (
				f.nom.toLowerCase().includes(q) ||
				f.titre.toLowerCase().includes(q) ||
				f.rubrique.toLowerCase().includes(q) ||
				(f.contexte?.toLowerCase().includes(q) ?? false)
			);
		});
	}, [films, langue, requete, rubrique, son]);

	// Regroupement par rubrique : c'est ainsi que les films se cherchent — par moment du récit,
	// pas par ordre alphabétique de nom de fichier.
	const sections = useMemo(() => {
		const par = new Map<string, FilmVue[]>();
		for (const f of visibles) {
			const liste = par.get(f.rubrique);
			if (liste) liste.push(f);
			else par.set(f.rubrique, [f]);
		}
		return [...par.entries()].toSorted(
			([a], [b]) => ordreRubrique(a) - ordreRubrique(b) || a.localeCompare(b, "fr"),
		);
	}, [visibles]);

	const classeChip = (actif: boolean) =>
		`h-9 shrink-0 rounded-full px-3 text-sm transition-colors ${
			actif
				? "bg-primary text-on-primary"
				: "bg-surface-container text-on-surface-variant hover:bg-surface-container-high"
		}`;

	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-center gap-2">
				<div className="flex h-10 min-w-[12rem] flex-1 items-center gap-2 rounded-full bg-surface-container-highest px-3">
					<Icon name="search" size={18} className="shrink-0 text-on-surface-variant" />
					<input
						value={requete}
						onChange={(e) => setRequete(e.target.value)}
						placeholder="Rechercher une vidéo…"
						className="min-w-0 flex-1 bg-transparent text-sm text-on-surface outline-none placeholder:text-on-surface-variant/60"
					/>
				</div>

				{languesPresentes.length > 0 && (
					<select
						value={langue}
						onChange={(e) => setLangue(e.target.value)}
						className="h-9 rounded-full bg-surface-container px-3 text-sm text-on-surface-variant"
						aria-label="Filtrer par langue"
					>
						<option value="toutes">Toutes les langues</option>
						{languesPresentes.map((l) => (
							<option key={l.code} value={l.code}>
								{l.nom}
							</option>
						))}
					</select>
				)}

				{!degrade && (
					<div className="flex gap-1.5">
						<button type="button" onClick={() => setSon("tous")} className={classeChip(son === "tous")}>
							Toutes
						</button>
						<button type="button" onClick={() => setSon("avec")} className={classeChip(son === "avec")}>
							Avec son
						</button>
						<button type="button" onClick={() => setSon("sans")} className={classeChip(son === "sans")}>
							Muettes
						</button>
					</div>
				)}
			</div>

			<div className="flex flex-wrap gap-1.5">
				<button
					type="button"
					onClick={() => setRubrique("toutes")}
					className={classeChip(rubrique === "toutes")}
				>
					Toutes les rubriques
				</button>
				{rubriques.map((r) => (
					<button
						key={r}
						type="button"
						onClick={() => setRubrique(r)}
						className={classeChip(rubrique === r)}
					>
						{r}
					</button>
				))}
			</div>

			<MediaCount
				left={`${visibles.length.toLocaleString("fr")} vidéo${visibles.length > 1 ? "s" : ""}`}
				right={
					visibles.length === films.length
						? undefined
						: `sur ${films.length.toLocaleString("fr")}`
				}
			/>

			{visibles.length === 0 ? (
				<p className="p-8 text-center text-sm text-on-surface-variant">Aucune vidéo.</p>
			) : (
				sections.map(([titre, liste]) => (
					<section key={titre} className="space-y-2">
						{sections.length > 1 && (
							<h2 className="px-1 text-sm font-semibold text-on-surface">
								{titre}
								<span className="ml-2 text-xs font-normal text-on-surface-variant">
									{liste.length}
								</span>
							</h2>
						)}
						<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
							{liste.map((f) => (
								<CarteFilm key={f.chemin} film={f} />
							))}
						</div>
					</section>
				))
			)}
		</div>
	);
}
