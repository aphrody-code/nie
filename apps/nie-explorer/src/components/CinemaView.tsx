// Cinéma — les 97 cinématiques du jeu, présentées comme un catalogue de streaming.
//
// ## Pourquoi cette forme
//
// Les films vivaient dans l'Explorateur comme 194 lignes `.usm` (chaque film étant présent sous
// `common/movie` ET `dx11/movie`), sans durée, sans définition, sans aperçu : rien ne distinguait
// une cinématique de vingt minutes d'un logo de six secondes. Une grille par rubrique avec durée,
// définition et prévisualisation au survol répond exactement à la question qu'on se pose devant
// ce dossier — « lequel est-ce ? ».
//
// ## Coût, et ce qui en découle
//
// Une vignette n'est pas gratuite : l'obtenir demande de démultiplexer le conteneur et de le
// remuxer en MP4 (jusqu'à 300 Mo pour un chapitre). D'où trois décisions :
//
// * le catalogue s'ouvre **sans** lire un octet des conteneurs (`videoCatalog`) ;
// * durée, définition et codec arrivent film par film (`videoInfo`), pour les cartes visibles
//   seulement, via un `IntersectionObserver` et une file à un seul travailleur ;
// * la prévisualisation animée ne démarre qu'au **survol soutenu** — c'est le seul moment où
//   l'on sait que l'utilisateur veut vraiment voir ce film-là. La première image capturée reste
//   ensuite affichée comme affiche.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Icon } from "@/components/ui/Icon";
import { Input } from "@/components/ui/input";
import { VideoPlayer, formaterDuree, urlVideo } from "@/components/VideoPlayer";
import { api } from "@/lib/api";
import { showFilmContextMenu } from "@/lib/contextMenu";
import type { FilmDto } from "@/lib/bindings";

/** Délai de survol avant de lancer une prévisualisation, en millisecondes. */
const DELAI_APERCU = 550;

/** Délai de survol avant de PRÉCHARGER, en millisecondes — plus court : rien ne s'affiche. */
const DELAI_PRECHARGE = 150;

/** Clé de persistance des positions de lecture. */
const CLE_REPRISE = "nie-explorer:cinema:reprise";

/** Un film au-delà de ce nombre de secondes vues est considéré comme « en cours ». */
const REPRISE_MIN = 5;

/** Fraction de la durée à laquelle on capture l'affiche : le tout début est souvent noir. */
const INSTANT_AFFICHE = 0.12;

type Reprises = Record<string, { position: number; duree: number }>;

function lireReprises(): Reprises {
  try {
    return JSON.parse(localStorage.getItem(CLE_REPRISE) ?? "{}") as Reprises;
  } catch {
    return {};
  }
}

function ecrireReprises(r: Reprises) {
  try {
    localStorage.setItem(CLE_REPRISE, JSON.stringify(r));
  } catch {
    // Quota plein : la reprise est un confort, pas une donnée à défendre.
  }
}

/** `312761536` → `298 Mo`. */
function formaterOctets(n: number): string {
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} Ko`;
  if (n < 1024 * 1024 * 1024) return `${Math.round(n / (1024 * 1024))} Mo`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} Go`;
}

/** Affiches déjà capturées, par chemin — un cache de session, jamais persisté. */
const affiches = new Map<string, string>();

export function CinemaView({ onOpenFile }: { onOpenFile?: (path: string) => void }) {
  const [films, setFilms] = useState<FilmDto[]>([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [recherche, setRecherche] = useState("");
  const [langue, setLangue] = useState<string>("");
  const [enLecture, setEnLecture] = useState<FilmDto | null>(null);
  const [reprises, setReprises] = useState<Reprises>(() => lireReprises());

  // File d'enrichissement : un seul film inspecté à la fois. Démultiplexer en parallèle ferait
  // lire plusieurs centaines de mégaoctets simultanément pour aucun gain d'affichage.
  const file = useRef<string[]>([]);
  const occupe = useRef(false);
  const demandes = useRef(new Set<string>());

  useEffect(() => {
    let vivant = true;
    api
      .videoCatalog()
      .then((c) => {
        if (vivant) setFilms(c.films);
        return c;
      })
      .catch((e: unknown) => vivant && setErreur(String(e)))
      .finally(() => vivant && setChargement(false));
    return () => {
      vivant = false;
    };
  }, []);

  const traiterFile = useCallback(() => {
    if (occupe.current) return;
    const chemin = file.current.shift();
    if (!chemin) return;
    occupe.current = true;
    api
      .videoInfo(chemin)
      .then((fiche) => {
        setFilms((prec) => prec.map((f) => (f.chemin === chemin ? fiche : f)));
        return fiche;
      })
      .catch(() => {})
      .finally(() => {
        occupe.current = false;
        traiterFile();
      });
  }, []);

  // ── Préchargement ───────────────────────────────────────────────────────────
  //
  // Précharger, c'est produire le conteneur web et le garder côté Rust : au clic suivant, la
  // lecture démarre sans attendre le démultiplexage. Un seul film à la fois, et seulement celui
  // que le curseur désigne — le cache ne tient que quatre entrées et 768 Mo, précharger « tout »
  // se contredirait lui-même en évinçant ce qu'on vient de préparer.
  const prechargeEnCours = useRef<string | null>(null);
  const dejaPrecharge = useRef(new Set<string>());

  const precharger = useCallback((chemin: string) => {
    if (dejaPrecharge.current.has(chemin) || prechargeEnCours.current) return;
    prechargeEnCours.current = chemin;
    api
      .videoPrecharger(chemin)
      .then((o) => {
        dejaPrecharge.current.add(chemin);
        return o;
      })
      // Un échec est normal ici (MPEG-2 sans conteneur web) : la carte le dit déjà, inutile
      // d'ajouter un toast pour un geste que l'utilisateur n'a pas explicitement demandé.
      .catch(() => {})
      .finally(() => {
        prechargeEnCours.current = null;
      });
  }, []);

  const enrichir = useCallback(
    (chemin: string) => {
      if (demandes.current.has(chemin)) return;
      demandes.current.add(chemin);
      file.current.push(chemin);
      traiterFile();
    },
    [traiterFile],
  );

  const menuFilm = useCallback(
    (f: FilmDto) => {
      void showFilmContextMenu({
        path: f.chemin,
        nom: f.nom,
        octets: f.octets,
        codec: f.codec,
        avecAudio: f.audio.length > 0,
        onLire: () => setEnLecture(f),
        onReveler: onOpenFile ? () => onOpenFile(f.chemin) : undefined,
      });
    },
    [onOpenFile],
  );

  const noterProgression = useCallback((chemin: string, position: number, duree: number) => {
    if (position < REPRISE_MIN || duree <= 0) return;
    setReprises((prec) => {
      const suivant = { ...prec };
      // Un film vu à plus de 95 % n'est plus « en cours » : le proposer serait absurde.
      if (position / duree > 0.95) delete suivant[chemin];
      else suivant[chemin] = { position, duree };
      ecrireReprises(suivant);
      return suivant;
    });
  }, []);

  // ── Filtrage et regroupement ────────────────────────────────────────────────

  const filtres = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    return films.filter((f) => {
      if (langue && f.langue !== langue) return false;
      if (!q) return true;
      return (
        f.nom.toLowerCase().includes(q) ||
        f.rubrique.toLowerCase().includes(q) ||
        (f.nom_origine ?? "").toLowerCase().includes(q)
      );
    });
  }, [films, recherche, langue]);

  const rangees = useMemo(() => {
    const par = new Map<string, FilmDto[]>();
    for (const f of filtres) {
      const liste = par.get(f.rubrique);
      if (liste) liste.push(f);
      else par.set(f.rubrique, [f]);
    }
    // Les rubriques nommées d'abord, puis les chapitres dans leur ordre numérique.
    // `sort` porte sur la copie que `[...entries()]` vient de créer — rien de partagé n'est muté.
    // (`toSorted` n'existe pas ici : cette application cible ES2022.)
    const ordre = (r: string) => (r.startsWith("Chapitre ") ? 2 : r === "Logos et intros" ? 0 : 1);
    return [...par.entries()].sort(([a], [b]) => ordre(a) - ordre(b) || a.localeCompare(b, "fr"));
  }, [filtres]);

  const langues = useMemo(() => {
    const vues = new Set<string>();
    for (const f of films) if (f.langue) vues.add(f.langue);
    return [...vues].sort();
  }, [films]);

  const aReprendre = useMemo(
    () => films.filter((f) => reprises[f.chemin]).slice(0, 12),
    [films, reprises],
  );

  // Le film mis en avant : le plus long du catalogue, celui qu'on a le plus envie de voir.
  const vedette = useMemo(() => {
    if (films.length === 0) return null;
    return films.reduce((meilleur, f) => (f.octets > meilleur.octets ? f : meilleur), films[0]);
  }, [films]);

  useEffect(() => {
    if (vedette && vedette.duree == null) enrichir(vedette.chemin);
  }, [vedette, enrichir]);

  // ── Rendu ───────────────────────────────────────────────────────────────────

  if (enLecture) {
    const f = enLecture;
    const detail = [
      f.rubrique,
      f.largeur ? `${f.largeur}×${f.hauteur}` : null,
      f.codec?.toUpperCase(),
      f.cadence ? `${f.cadence.toFixed(3)} i/s` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    return (
      <VideoPlayer
        chemin={f.chemin}
        titre={f.nom}
        detail={detail}
        avecAudio={f.audio.length > 0}
        depart={reprises[f.chemin]?.position}
        onProgression={(p, d) => noterProgression(f.chemin, p, d)}
        onClose={() => setEnLecture(null)}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-app">
      <div className="sticky top-0 z-20 flex items-center gap-2 border-b border-app-line bg-app/85 px-4 py-2 backdrop-blur">
        <Icon name="movie" size={16} className="text-ink-faint" />
        <span className="text-sm font-semibold">Cinéma</span>
        <span className="text-tiny text-ink-faint">
          {filtres.length} film{filtres.length > 1 ? "s" : ""}
          {filtres.length !== films.length ? ` sur ${films.length}` : ""}
        </span>
        <div className="flex-1" />
        <Input
          value={recherche}
          onChange={(e) => setRecherche(e.target.value)}
          placeholder="Rechercher un film…"
          className="h-7 w-56 text-xs"
        />
        <select
          value={langue}
          onChange={(e) => setLangue(e.target.value)}
          aria-label="Filtrer par langue"
          className="h-7 rounded-md border border-app-line bg-app-box px-2 text-xs text-ink outline-none"
        >
          <option value="">Toutes langues</option>
          {langues.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </div>

      {chargement && (
        <div className="flex flex-1 items-center justify-center text-sm text-ink-faint">
          Chargement du catalogue…
        </div>
      )}

      {erreur && (
        <div className="m-4 rounded-md border border-status-error/40 bg-status-error/10 p-3 text-xs text-status-error">
          {erreur}
        </div>
      )}

      {!chargement && !erreur && films.length === 0 && (
        <div className="flex flex-1 items-center justify-center text-sm text-ink-faint">
          Aucune cinématique trouvée — le VFS du jeu est-il monté ?
        </div>
      )}

      {vedette && !recherche && !langue && (
        <Vedette
          film={vedette}
          onLire={() => setEnLecture(vedette)}
          onReveler={onOpenFile ? () => onOpenFile(vedette.chemin) : undefined}
        />
      )}

      {aReprendre.length > 0 && (
        <Rangee
          titre="Reprendre la lecture"
          films={aReprendre}
          reprises={reprises}
          onLire={setEnLecture}
          onVisible={enrichir}
          onPrecharger={precharger}
          onMenu={menuFilm}
        />
      )}

      {rangees.map(([rubrique, liste]) => (
        <Rangee
          key={rubrique}
          titre={rubrique}
          films={liste}
          reprises={reprises}
          onLire={setEnLecture}
          onVisible={enrichir}
          onPrecharger={precharger}
          onMenu={menuFilm}
        />
      ))}

      <div className="h-6" />
    </div>
  );
}

// ── Bandeau de tête ───────────────────────────────────────────────────────────

function Vedette({
  film,
  onLire,
  onReveler,
}: {
  film: FilmDto;
  onLire: () => void;
  onReveler?: () => void;
}) {
  // 95 des 97 films n'ont AUCUNE piste sonore dans leur conteneur : le jeu les accompagne de sa
  // musique de fond, désignée par `bgmName` dans `movie_playing_config`. « Muet » décrit donc le
  // fichier, pas ce qu'on entend en jouant — d'où l'affichage du nom de la BGM quand il existe.
  const meta = [
    film.duree ? formaterDuree(film.duree) : null,
    film.largeur ? `${film.largeur}×${film.hauteur}` : null,
    film.codec?.toUpperCase(),
    film.audio.length > 0
      ? `${film.audio[0].canaux} canal/aux ${film.audio[0].codec.toUpperCase()}`
      : "sans piste sonore",
    film.bgm ? `BGM ${film.bgm}` : null,
    formaterOctets(film.octets),
  ].filter(Boolean);

  return (
    <div className="relative m-4 mb-2 overflow-hidden rounded-xl border border-app-line bg-gradient-to-br from-app-box to-app-darkBox p-6">
      <div className="absolute inset-0 opacity-[0.07]">
        <Icon name="movie" size={320} className="absolute -right-10 -top-10" />
      </div>
      <div className="relative max-w-2xl">
        <div className="text-tiny uppercase tracking-wider text-accent">{film.rubrique}</div>
        <h2 className="mt-1 text-2xl font-semibold text-ink">{film.nom}</h2>
        {film.nom_origine && (
          <div className="mt-1 truncate font-mono text-tiny text-ink-faint" title={film.nom_origine}>
            {film.nom_origine}
          </div>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-dull">
          {meta.map((m) => (
            <span key={m} className="rounded bg-app-line/60 px-1.5 py-0.5">
              {m}
            </span>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={onLire}
            className="flex items-center gap-1.5 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            <Icon name="play_arrow" size={16} />
            Lire
          </button>
          {onReveler && (
            <button
              type="button"
              onClick={onReveler}
              className="flex items-center gap-1.5 rounded-md border border-app-line px-3 py-2 text-sm text-ink-dull transition-colors hover:bg-app-hover hover:text-ink"
            >
              <Icon name="folder_open" size={16} />
              Voir le fichier
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Rangée horizontale ────────────────────────────────────────────────────────

function Rangee({
  titre,
  films,
  reprises,
  onLire,
  onVisible,
  onPrecharger,
  onMenu,
}: {
  titre: string;
  films: FilmDto[];
  reprises: Reprises;
  onLire: (f: FilmDto) => void;
  onVisible: (chemin: string) => void;
  onPrecharger: (chemin: string) => void;
  onMenu: (f: FilmDto) => void;
}) {
  const pisteRef = useRef<HTMLDivElement | null>(null);

  const defiler = (sens: 1 | -1) => {
    const piste = pisteRef.current;
    if (!piste) return;
    piste.scrollBy({ left: sens * piste.clientWidth * 0.8, behavior: "smooth" });
  };

  return (
    <section className="group/rangee relative px-4 py-2">
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-dull">
        {titre} <span className="ml-1 font-normal normal-case text-ink-faint">{films.length}</span>
      </h3>
      <div className="relative">
        <button
          type="button"
          onClick={() => defiler(-1)}
          aria-label="Défiler vers la gauche"
          className="absolute left-0 top-0 z-10 hidden h-full w-8 items-center justify-center rounded-l-md bg-gradient-to-r from-app to-transparent text-ink-dull opacity-0 transition-opacity hover:text-ink group-hover/rangee:opacity-100 md:flex"
        >
          <Icon name="chevron_left" size={20} />
        </button>
        <div
          ref={pisteRef}
          className="no-scrollbar flex gap-2 overflow-x-auto scroll-smooth pb-1"
        >
          {films.map((f) => (
            <Carte
              key={f.chemin}
              film={f}
              reprise={reprises[f.chemin]}
              onLire={() => onLire(f)}
              onVisible={onVisible}
              onPrecharger={onPrecharger}
              onMenu={() => onMenu(f)}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={() => defiler(1)}
          aria-label="Défiler vers la droite"
          className="absolute right-0 top-0 z-10 hidden h-full w-8 items-center justify-center rounded-r-md bg-gradient-to-l from-app to-transparent text-ink-dull opacity-0 transition-opacity hover:text-ink group-hover/rangee:opacity-100 md:flex"
        >
          <Icon name="chevron_right" size={20} />
        </button>
      </div>
    </section>
  );
}

// ── Carte ─────────────────────────────────────────────────────────────────────

function Carte({
  film,
  reprise,
  onLire,
  onVisible,
  onPrecharger,
  onMenu,
}: {
  film: FilmDto;
  reprise?: { position: number; duree: number };
  onLire: () => void;
  onVisible: (chemin: string) => void;
  onPrecharger: (chemin: string) => void;
  onMenu: () => void;
}) {
  const hoteRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const minuterie = useRef<number | null>(null);
  const [apercu, setApercu] = useState(false);
  const [affiche, setAffiche] = useState<string | null>(() => affiches.get(film.chemin) ?? null);

  // Enrichissement à l'entrée dans le champ de vision : ni au montage (97 requêtes d'un coup)
  // ni au survol (l'utilisateur veut voir la durée AVANT de choisir où pointer).
  useEffect(() => {
    const hote = hoteRef.current;
    if (!hote || film.duree != null) return;
    const obs = new IntersectionObserver(
      (entrees) => {
        if (entrees.some((e) => e.isIntersecting)) {
          onVisible(film.chemin);
          obs.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    obs.observe(hote);
    return () => obs.disconnect();
  }, [film.chemin, film.duree, onVisible]);

  const capturer = useCallback(() => {
    const v = videoRef.current;
    if (!v || affiches.has(film.chemin) || v.videoWidth === 0) return;
    const canvas = document.createElement("canvas");
    // Largeur d'affiche fixe : une carte fait 224 px, inutile de garder du 1920.
    canvas.width = 320;
    canvas.height = Math.round((320 * v.videoHeight) / v.videoWidth);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
    try {
      const url = canvas.toDataURL("image/jpeg", 0.7);
      affiches.set(film.chemin, url);
      setAffiche(url);
    } catch {
      // Canvas « teinté » : sans affiche, la carte garde son fond typographique.
    }
  }, [film.chemin]);

  const minuteriePrecharge = useRef<number | null>(null);

  const entrer = () => {
    if (film.lisible === false) return;
    // Deux temporisations distinctes, et c'est voulu : le PRÉCHARGEMENT part vite (150 ms), parce
    // qu'il ne fait que préparer des octets côté Rust ; la PRÉVISUALISATION attend plus longtemps
    // (550 ms), parce qu'elle démarre un décodage vidéo visible. Traverser une rangée à la souris
    // ne doit lancer ni l'un ni l'autre.
    if (minuteriePrecharge.current) window.clearTimeout(minuteriePrecharge.current);
    minuteriePrecharge.current = window.setTimeout(() => onPrecharger(film.chemin), DELAI_PRECHARGE);
    if (minuterie.current) window.clearTimeout(minuterie.current);
    minuterie.current = window.setTimeout(() => setApercu(true), DELAI_APERCU);
  };

  const sortir = () => {
    if (minuterie.current) window.clearTimeout(minuterie.current);
    if (minuteriePrecharge.current) window.clearTimeout(minuteriePrecharge.current);
    setApercu(false);
  };

  useEffect(
    () => () => {
      if (minuterie.current) window.clearTimeout(minuterie.current);
      if (minuteriePrecharge.current) window.clearTimeout(minuteriePrecharge.current);
    },
    [],
  );

  const progression = reprise && reprise.duree > 0 ? (reprise.position / reprise.duree) * 100 : 0;

  return (
    <div
      ref={hoteRef}
      className="group/carte relative w-56 shrink-0 cursor-pointer select-none"
      onMouseEnter={entrer}
      onMouseLeave={sortir}
      onClick={onLire}
      onContextMenu={(e) => {
        // `preventDefault` : sans lui, la webview ouvre SON menu (« Recharger », « Inspecter »)
        // par-dessus le menu natif — deux menus, dont un hors de propos.
        e.preventDefault();
        sortir();
        onMenu();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onLire();
        }
      }}
      role="button"
      tabIndex={0}
      title={film.chemin}
    >
      <div className="relative aspect-video overflow-hidden rounded-md border border-app-line bg-app-darkBox transition-transform duration-150 group-hover/carte:scale-[1.03] group-hover/carte:border-accent/60">
        {affiche && !apercu && (
          <img src={affiche} alt="" className="h-full w-full object-cover" draggable={false} />
        )}
        {!affiche && !apercu && (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-gradient-to-br from-app-box to-app-darkBox">
            <Icon name="movie" size={22} className="text-ink-faint/50" />
            <span className="px-2 text-center font-mono text-[10px] text-ink-faint">{film.nom}</span>
          </div>
        )}
        {apercu && (
          // eslint-disable-next-line jsx-a11y/media-has-caption -- aperçu muet, sans dialogue.
          <video
            ref={videoRef}
            src={urlVideo(film.chemin)}
            // `crossOrigin` : le protocole `nievideo` a sa propre origine sous Windows, et
            // sans requête CORS le `canvas` de `capturer` serait teinté — donc aucune affiche.
            crossOrigin="anonymous"
            muted
            autoPlay
            loop
            playsInline
            className="h-full w-full object-cover"
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              // On saute le tout début : les cinématiques ouvrent souvent sur un fondu au noir.
              if (v.duration > 2) v.currentTime = v.duration * INSTANT_AFFICHE;
            }}
            onSeeked={capturer}
          />
        )}

        {film.lisible === false && (
          <div className="absolute inset-x-0 bottom-0 bg-status-warning/85 px-1.5 py-0.5 text-center text-[10px] font-medium text-black">
            {film.codec?.toUpperCase()} — non lisible ici
          </div>
        )}

        {film.duree != null && film.lisible !== false && (
          <div className="absolute bottom-1 right-1 rounded bg-black/70 px-1 py-0.5 font-mono text-[10px] text-white/90">
            {formaterDuree(film.duree)}
          </div>
        )}

        {film.langue && (
          <div className="absolute left-1 top-1 rounded bg-black/60 px-1 py-0.5 text-[10px] font-medium uppercase text-white/80">
            {film.langue}
          </div>
        )}

        {progression > 0 && (
          <div className="absolute inset-x-0 bottom-0 h-0.5 bg-white/20">
            <div className="h-full bg-accent" style={{ width: `${progression}%` }} />
          </div>
        )}

        <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover/carte:opacity-100">
          <div className="rounded-full bg-black/55 p-2 backdrop-blur-sm">
            <Icon name="play_arrow" size={18} className="text-white" />
          </div>
        </div>
      </div>

      <div className="mt-1 truncate text-xs text-ink" title={film.nom}>
        {film.nom}
      </div>
      <div className="truncate text-[10px] text-ink-faint">
        {film.largeur ? `${film.largeur}×${film.hauteur} · ` : ""}
        {formaterOctets(film.octets)}
      </div>
    </div>
  );
}
