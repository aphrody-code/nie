// Cinéma — la médiathèque Inazuma Eleven : les dix saisons de la série ET les cinématiques du
// jeu, dans un seul catalogue à saisons.
//
// ## Deux sources, un seul catalogue
//
// La série vient de `data/anime/episodes.db` (355 épisodes, dix saisons nommées — Saison 1 à 3,
// GO, Chrono Stones, Galaxy, Outer Code, Ares, Orion, Films), que `packages/ietv` recense et que
// l'installeur embarque (cf. `lib/animeDb.ts`). Les cinématiques du jeu viennent du VFS.
//
// **`Victory Road` est présentée comme la saison qui suit les autres** : c'est ce qu'elle est
// pour qui regarde la série — la suite de l'histoire, dans un autre média. La ranger dans un
// onglet séparé aurait demandé de savoir, avant de chercher, si un passage est un épisode ou une
// cinématique ; ici la question ne se pose plus.
//
// Les deux sources ne se lisent pas de la même façon : un épisode est une vidéo YouTube (cadre
// d'intégration), une cinématique est un `.usm` démultiplexé par le lecteur natif. C'est la seule
// asymétrie visible, et elle l'est jusque dans les cartes (une vignette distante contre une
// affiche capturée à la volée).
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
import { openUrl } from "@tauri-apps/plugin-opener";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/Icon";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { VideoPlayer, formaterDuree, urlVideo } from "@/components/VideoPlayer";
import { api } from "@/lib/api";
import { animeDb, defaultAnimeDbPath, urlIntegration, urlYoutube, type EpisodeAnime, type SaisonAnime } from "@/lib/animeDb";
import { showFilmContextMenu } from "@/lib/contextMenu";
import {
  decrireLacune,
  ecrireVus,
  empreinte,
  lacunesDeSaison,
  lireVus,
  prochainNonVu,
  ressemble,
  voisins,
  type LacuneSaison,
} from "@/lib/serie";
import { useSettings } from "@/lib/settings";
import { cn } from "@/lib/utils";
import type { FilmDto } from "@/lib/bindings";

/** Clé de la saison qui porte les cinématiques du jeu. */
const CLE_VICTORY_ROAD = "victory-road";

/** Clé de la vue « toutes les saisons ». */
const CLE_TOUT = "__tout__";

/**
 * Un élément du catalogue, quelle que soit sa source. C'est ce type qui permet à la recherche, à
 * la reprise de lecture et aux rangées de traiter un épisode et une cinématique de la même façon ;
 * seule la LECTURE les distingue.
 */
interface Element {
  /** Identité stable : chemin VFS pour le jeu, identifiant YouTube pour la série. */
  cle: string;
  titre: string;
  sousTitre: string | null;
  source: "anime" | "jeu";
  /** Clé de la saison d'appartenance. */
  saison: string;
  /** Vignette distante (série) — le jeu, lui, capture son affiche à la volée. */
  vignette: string | null;
  film?: FilmDto;
  episode?: EpisodeAnime;
}

/** Une saison du catalogue — une rangée dans la vue d'ensemble, une grille quand elle est ouverte. */
interface Saison {
  cle: string;
  titre: string;
  source: "anime" | "jeu";
  elements: Element[];
}

/** Valeur du filtre « toutes langues » — `base-ui` réserve la chaîne vide à l'absence de
 * sélection et refuse un `SelectItem value=""`, d'où ce jeton, traduit en `""` à la sortie. */
const TOUTES_LANGUES = "__toutes__";

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
  const parametres = useSettings();
  /** Catalogue de la série — vide tant que la base n'est pas résolue, ou si elle est absente. */
  const [episodes, setEpisodes] = useState<EpisodeAnime[]>([]);
  const [saisonsAnime, setSaisonsAnime] = useState<SaisonAnime[]>([]);
  /** Épisode ouvert dans le cadre d'intégration — l'équivalent série de `enLecture`. */
  const [enLectureEpisode, setEnLectureEpisode] = useState<EpisodeAnime | null>(null);
  /** Saison affichée, ou `CLE_TOUT` pour la vue d'ensemble. */
  const [saisonOuverte, setSaisonOuverte] = useState<string>(CLE_TOUT);
  /** Épisodes marqués vus, en empreintes `saison:episode` — même règle que le bot Discord. */
  const [vus, setVus] = useState<Set<string>>(() => lireVus());

  /** Bascule « vu » d'un épisode, et le persiste aussitôt. */
  const basculerVu = useCallback((saison: number, episode: number | null) => {
    if (episode === null) return;
    setVus((prec) => {
      const suivant = new Set(prec);
      const cle = empreinte(saison, episode);
      if (suivant.has(cle)) suivant.delete(cle);
      else suivant.add(cle);
      ecrireVus(suivant);
      return suivant;
    });
  }, []);

  // Le catalogue de la série se charge en parallèle de celui du jeu, et son absence n'est pas une
  // erreur : sans le jeu on garde les épisodes, sans la base d'épisodes on garde les cinématiques.
  // C'est ce qui permet à la vue de rester utile sur une machine qui n'a que l'un des deux.
  useEffect(() => {
    let vivant = true;
    defaultAnimeDbPath(parametres.gameDir)
      .then(async (chemin) => {
        if (!chemin || !vivant) return;
        const [liste, saisons] = await Promise.all([animeDb.tous(chemin), animeDb.saisons(chemin)]);
        if (!vivant) return;
        setEpisodes(liste);
        setSaisonsAnime(saisons);
      })
      .catch(() => {});
    return () => {
      vivant = false;
    };
  }, [parametres.gameDir]);

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

  // ── Le catalogue unifié ─────────────────────────────────────────────────────
  //
  // Les saisons de la série d'abord, dans leur ordre de diffusion, puis Victory Road. L'ordre
  // n'est pas cosmétique : c'est la chronologie de la franchise, et la place du jeu à la fin est
  // exactement ce que la vue veut dire.
  const saisons = useMemo<Saison[]>(() => {
    const q = recherche.trim().toLowerCase();
    // La recherche porte sur les QUATRE champs qui nomment un épisode. Chercher « Sakkā » ou
    // « 必殺技 » doit trouver, et c'est souvent tout ce dont on se souvient d'un épisode : la base
    // porte 330 titres japonais, 327 romaji et 355 résumés que rien n'exploitait.
    const champs = (e: EpisodeAnime) => [e.titre, e.titreJp ?? "", e.romaji ?? "", e.description ?? ""];
    const exact = (e: EpisodeAnime) => champs(e).some((c) => c.toLowerCase().includes(q));

    let retenus = q ? episodes.filter(exact) : episodes;
    // Repli approché quand la frappe exacte ne rend rien : « Sakkaa » ou « Teïkoku » ne se
    // transcrivent pas d'une seule façon, et une lettre près ne devrait pas vider l'écran. C'est
    // le `fuzzyScore` de `ietv/src/video-search.ts`, porté dans `lib/serie.ts` — mais en REPLI,
    // jamais en premier : une correspondance exacte ne doit pas se faire diluer par des à-peu-près.
    if (q.length >= 3 && retenus.length === 0) {
      retenus = episodes.filter((e) => champs(e).some((c) => ressemble(q, c)));
    }

    const parSaison = new Map<number, Element[]>();
    for (const e of retenus) {
      const sousTitre = e.episode ? `Épisode ${e.episode}` : null;
      const cle = `s${e.saison}`;
      const el: Element = {
        cle: e.videoId,
        titre: e.titre,
        sousTitre,
        source: "anime",
        saison: cle,
        vignette: e.vignette,
        episode: e,
      };
      const liste = parSaison.get(e.saison);
      if (liste) liste.push(el);
      else parSaison.set(e.saison, [el]);
    }

    const sortie: Saison[] = saisonsAnime
      .map((s) => ({
        cle: `s${s.saison}`,
        titre: s.nom,
        source: "anime" as const,
        elements: parSaison.get(s.saison) ?? [],
      }))
      .filter((s) => s.elements.length > 0);

    // Victory Road : les cinématiques, déjà filtrées par langue et par recherche plus haut.
    if (filtres.length > 0) {
      sortie.push({
        cle: CLE_VICTORY_ROAD,
        titre: "Victory Road",
        source: "jeu",
        elements: filtres.map((f) => ({
          cle: f.chemin,
          titre: f.nom,
          sousTitre: f.rubrique,
          source: "jeu" as const,
          saison: CLE_VICTORY_ROAD,
          vignette: null,
          film: f,
        })),
      });
    }
    return sortie;
  }, [episodes, saisonsAnime, filtres, recherche]);

  const saisonCourante = useMemo(
    () => (saisonOuverte === CLE_TOUT ? null : (saisons.find((s) => s.cle === saisonOuverte) ?? null)),
    [saisons, saisonOuverte],
  );

  /**
   * Les trous du catalogue, saison par saison — calculés sur le catalogue COMPLET (`episodes`) et
   * non sur le résultat filtré : une recherche qui laisse trois épisodes ne crée pas trente-huit
   * lacunes. C'est la règle du bot Discord, portée telle quelle (`lib/serie.ts`).
   */
  const lacunes = useMemo(() => {
    const parSaison = new Map<number, (number | null)[]>();
    for (const e of episodes) {
      const liste = parSaison.get(e.saison);
      if (liste) liste.push(e.episode);
      else parSaison.set(e.saison, [e.episode]);
    }
    const sortie = new Map<number, LacuneSaison>();
    for (const [saison, numeros] of parSaison) {
      const l = lacunesDeSaison(saison, numeros);
      if (l) sortie.set(saison, l);
    }
    return sortie;
  }, [episodes]);

  /**
   * Les épisodes les plus récemment DIFFUSÉS (`publishDate`, renseignée pour 330 des 355).
   *
   * Ce n'est pas « récemment ajouté au catalogue » : la base ne garde pas la date de moisson, et
   * l'annoncer ainsi serait faux. C'est la date de première diffusion, donc la fin de la série —
   * ce qu'on cherche quand on revient après une longue absence.
   */
  const plusRecents = useMemo<Element[]>(
    () =>
      episodes
        .filter((e) => e.publie)
        .sort((a, b) => (b.publie ?? "").localeCompare(a.publie ?? ""))
        .slice(0, 20)
        .map((e) => ({
          cle: e.videoId,
          titre: e.titre,
          sousTitre: e.publie ? new Date(e.publie).toLocaleDateString("fr-FR") : null,
          source: "anime" as const,
          saison: `s${e.saison}`,
          vignette: e.vignette,
          episode: e,
        })),
    [episodes],
  );

  /**
   * Le prochain épisode à regarder : le premier non vu de la première saison qui en a un. C'est
   * `prochainNonVu` du bot, appliqué saison par saison — donc jamais un numéro absent du
   * catalogue, et jamais « celui qui suit le dernier vu » quand un trou a été sauté.
   */
  const aReprendreSerie = useMemo(() => {
    for (const s of saisonsAnime) {
      const dansSaison = episodes.filter((e) => e.saison === s.saison);
      const numeros = dansSaison.map((e) => e.episode).filter((n): n is number => n !== null);
      const vusSaison = new Set(numeros.filter((n) => vus.has(empreinte(s.saison, n))));
      const prochain = prochainNonVu(numeros, vusSaison);
      if (prochain === null) continue;
      const ep = dansSaison.find((e) => e.episode === prochain);
      if (ep) return { episode: ep, saison: s };
    }
    return null;
  }, [saisonsAnime, episodes, vus]);

  /** Ouvre un élément, quelle que soit sa source — le seul endroit qui connaît les deux lecteurs. */
  const lire = useCallback((el: Element) => {
    if (el.film) setEnLecture(el.film);
    else if (el.episode) setEnLectureEpisode(el.episode);
  }, []);

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

  // Un épisode de la série se lit dans un cadre d'intégration : la vidéo est hébergée par la
  // chaîne officielle, l'application n'en détient ni le flux ni le droit de le redistribuer. Le
  // lecteur natif reste pour ce que le jeu contient, et lui seul.
  if (enLectureEpisode) {
    const e = enLectureEpisode;
    const dansSaison = episodes.filter((x) => x.saison === e.saison);
    const numeros = dansSaison.map((x) => x.episode).filter((n): n is number => n !== null);
    // `voisins` du bot, et non un `index ± 1` : il encadre correctement un épisode retiré du
    // catalogue entre-temps, et ne propose jamais un numéro qui n'existe pas.
    const { precedent, suivant } = e.episode !== null ? voisins(numeros, e.episode) : { precedent: null, suivant: null };
    const parNumero = (n: number | null) => (n === null ? null : (dansSaison.find((x) => x.episode === n) ?? null));
    const nomSaison = saisonsAnime.find((s) => s.saison === e.saison)?.nom ?? `Saison ${e.saison}`;
    const vu = e.episode !== null && vus.has(empreinte(e.saison, e.episode));
    return (
      <div className="flex h-full min-h-0 flex-col bg-black">
        <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-white">{e.titre}</div>
            <div className="truncate text-xs text-white/50">
              {nomSaison}
              {e.episode ? ` · épisode ${e.episode}` : ""}
              {e.publie ? ` · ${new Date(e.publie).toLocaleDateString("fr-FR")}` : ""}
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className={vu ? "text-emerald-400" : "text-white/80 hover:text-white"}
            onClick={() => basculerVu(e.saison, e.episode)}
            disabled={e.episode === null}
            title={vu ? "Marquer comme non vu" : "Marquer comme vu"}
          >
            <Icon name={vu ? "check_circle" : "radio_button_unchecked"} size={16} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-white/80 hover:text-white"
            disabled={precedent === null}
            onClick={() => {
              const p = parNumero(precedent);
              if (p) setEnLectureEpisode(p);
            }}
            title="Épisode précédent"
          >
            <Icon name="skip_previous" size={16} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-white/80 hover:text-white"
            disabled={suivant === null}
            onClick={() => {
              const s = parNumero(suivant);
              if (s) setEnLectureEpisode(s);
            }}
            title="Épisode suivant"
          >
            <Icon name="skip_next" size={16} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-white/80 hover:text-white"
            onClick={() => void openUrl(urlYoutube(e.videoId))}
            title="Ouvrir sur YouTube"
          >
            <Icon name="open_in_new" size={16} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-white/80 hover:text-white"
            onClick={() => setEnLectureEpisode(null)}
            title="Fermer"
          >
            <Icon name="close" size={16} />
          </Button>
        </div>
        <iframe
          key={e.videoId}
          src={urlIntegration(e.videoId)}
          title={e.titre}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
          allowFullScreen
          className="min-h-0 flex-1 border-0 bg-black"
        />
        {/* La fiche sous la vidéo : titre original, transcription et résumé. Trois colonnes de la
            base que rien n'affichait — 330 titres japonais et 355 résumés dormaient dans le
            fichier. */}
        {(e.titreJp || e.romaji || e.description) && (
          <div className="max-h-40 shrink-0 overflow-y-auto border-t border-white/10 px-4 py-2">
            {(e.titreJp || e.romaji) && (
              <div className="mb-1 flex flex-wrap items-baseline gap-2 text-xs">
                {e.titreJp && <span className="text-white/85">{e.titreJp}</span>}
                {e.romaji && <span className="italic text-white/45">{e.romaji}</span>}
              </div>
            )}
            {e.description && <p className="text-xs leading-relaxed text-white/60">{e.description}</p>}
          </div>
        )}
      </div>
    );
  }

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
    // La file de lecture est la LISTE AFFICHÉE (`filtres`), pas le catalogue entier : « suivant »
    // doit désigner ce que l'utilisatrice voit à l'écran, filtres de recherche et de langue
    // compris. Un film joué puis exclu par un changement de filtre sort de la file (`-1`) — les
    // boutons disparaissent alors plutôt que de sauter à un film sans rapport.
    const rang = filtres.findIndex((x) => x.chemin === f.chemin);
    const versRang = (delta: number) => {
      const cible = filtres[rang + delta];
      if (cible) setEnLecture(cible);
    };
    return (
      <VideoPlayer
        chemin={f.chemin}
        titre={f.nom}
        detail={detail}
        film={f}
        avecAudio={f.audio.length > 0}
        depart={reprises[f.chemin]?.position}
        onProgression={(p, d) => noterProgression(f.chemin, p, d)}
        onClose={() => setEnLecture(null)}
        file={rang >= 0 ? { index: rang, total: filtres.length } : null}
        onPrecedent={rang > 0 ? () => versRang(-1) : undefined}
        onSuivant={rang >= 0 && rang < filtres.length - 1 ? () => versRang(1) : undefined}
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
        {/* `Select` du design system, comme `DetailPane` : ce `<select>` HTML brut était l'un des
            deux derniers de l'application à ignorer la palette et la navigation clavier des
            autres listes. La valeur vide se code `TOUTES` — un `SelectItem value=""` est refusé
            par base-ui, qui réserve la chaîne vide à l'absence de sélection. */}
        <Select
          value={langue || TOUTES_LANGUES}
          onValueChange={(v) => setLangue(v === TOUTES_LANGUES ? "" : (v ?? ""))}
        >
          <SelectTrigger size="sm" className="h-7 w-40 text-xs" aria-label="Filtrer par langue">
            <SelectValue placeholder="Toutes langues" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TOUTES_LANGUES}>Toutes langues</SelectItem>
            {langues.map((l) => (
              <SelectItem key={l} value={l}>
                {l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Les saisons, en tête et toujours visibles : c'est la navigation principale du catalogue.
          « Victory Road » y a exactement le même statut que « Orion » ou « Chrono Stones ». */}
      {saisons.length > 0 && (
        <div className="sticky top-[41px] z-10 flex gap-1 overflow-x-auto border-b border-app-line bg-app/85 px-4 py-1.5 backdrop-blur">
          <ChipSaison
            titre="Tout"
            nombre={saisons.reduce((n, s) => n + s.elements.length, 0)}
            actif={saisonOuverte === CLE_TOUT}
            onClick={() => setSaisonOuverte(CLE_TOUT)}
          />
          {saisons.map((s) => (
            <ChipSaison
              key={s.cle}
              titre={s.titre}
              nombre={s.elements.length}
              jeu={s.source === "jeu"}
              actif={saisonOuverte === s.cle}
              onClick={() => setSaisonOuverte(s.cle)}
            />
          ))}
        </div>
      )}

      {chargement && (
        <div className="flex flex-1 items-center justify-center text-sm text-ink-faint">
          Chargement du catalogue…
        </div>
      )}

      {/* `Alert` plutôt qu'un cadre rouge écrit à la main : c'est le composant que toutes les
          autres vues emploient pour dire qu'une source a échoué. */}
      {erreur && (
        <div className="m-4">
          <Alert variant="destructive">
            <AlertTitle>Catalogue indisponible</AlertTitle>
            <AlertDescription>{erreur}</AlertDescription>
          </Alert>
        </div>
      )}

      {!chargement && !erreur && films.length === 0 && (
        <div className="m-4">
          <Alert>
            <AlertTitle>Aucune cinématique</AlertTitle>
            <AlertDescription>
              Le catalogue est vide : le VFS du jeu n'est pas monté, ou ce montage ne porte aucun
              fichier USM.
            </AlertDescription>
          </Alert>
        </div>
      )}

      {/* Vue d'ensemble : la vedette, ce qu'on a commencé, puis une rangée par saison. */}
      {!saisonCourante && (
        <>
          {vedette && !recherche && !langue && (
            <Vedette
              film={vedette}
              onLire={() => setEnLecture(vedette)}
              onReveler={onOpenFile ? () => onOpenFile(vedette.chemin) : undefined}
            />
          )}

          {/* Le prochain épisode non vu, en tête : c'est la question qu'on se pose devant une
              série de 355 épisodes, et la seule réponse que le catalogue seul ne donne pas. */}
          {aReprendreSerie && !recherche && (
            <div className="mx-4 mb-1 flex items-center gap-3 rounded-lg border border-app-line bg-app-box px-3 py-2">
              <Icon name="play_circle" size={20} className="text-accent" />
              <div className="min-w-0 flex-1">
                <div className="text-tiny uppercase tracking-wider text-ink-faint">Reprendre la série</div>
                <div className="truncate text-sm text-ink">
                  {aReprendreSerie.saison.nom}
                  {aReprendreSerie.episode.episode ? ` · épisode ${aReprendreSerie.episode.episode}` : ""} —{" "}
                  {aReprendreSerie.episode.titre}
                </div>
              </div>
              <Button size="sm" onClick={() => setEnLectureEpisode(aReprendreSerie.episode)}>
                Lire
              </Button>
            </div>
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

          {!recherche && plusRecents.length > 0 && (
            <RangeeElements
              titre="Les plus récents (diffusion)"
              elements={plusRecents}
              total={plusRecents.length}
              reprises={reprises}
              onLire={lire}
              onVisible={enrichir}
              onPrecharger={precharger}
              onMenu={menuFilm}
              onOuvrirSaison={() => {
                const s = plusRecents[0]?.saison;
                if (s) setSaisonOuverte(s);
              }}
              vus={vus}
              onBasculerVu={basculerVu}
            />
          )}

          {saisons.map((s) => (
            <RangeeElements
              key={s.cle}
              titre={s.titre}
              elements={s.elements.slice(0, 30)}
              total={s.elements.length}
              reprises={reprises}
              onLire={lire}
              onVisible={enrichir}
              onPrecharger={precharger}
              onMenu={menuFilm}
              onOuvrirSaison={() => setSaisonOuverte(s.cle)}
              vus={vus}
              onBasculerVu={basculerVu}
            />
          ))}
        </>
      )}

      {/* Saison ouverte. Victory Road garde ses rubriques — « Chapitre 3 » et « Logos et intros »
          ne sont pas du même ordre, et les aplatir en une grille de 97 vignettes reviendrait à
          l'état que cette vue a justement remplacé. */}
      {saisonCourante && saisonCourante.cle === CLE_VICTORY_ROAD && (
        <>
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
        </>
      )}

      {saisonCourante && saisonCourante.cle !== CLE_VICTORY_ROAD && (
        <section className="px-4 py-3">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-dull">
            {saisonCourante.titre}
            <span className="ml-1 font-normal normal-case text-ink-faint">
              {saisonCourante.elements.length} épisodes
            </span>
          </h3>

          {/* Ce que le catalogue N'A PAS. Le bot Discord le dit depuis toujours ; l'application le
              taisait, et une saison trouée y ressemblait à une saison courte. */}
          {(() => {
            const numSaison = saisonCourante.elements[0]?.episode?.saison;
            const lacune = numSaison === undefined ? undefined : lacunes.get(numSaison);
            if (!lacune) return null;
            return (
              <Alert className="mb-3">
                <AlertTitle>
                  {lacune.manquants.length} épisode{lacune.manquants.length > 1 ? "s" : ""} absent
                  {lacune.manquants.length > 1 ? "s" : ""} du catalogue
                </AlertTitle>
                <AlertDescription>
                  Entre les épisodes {lacune.borne.debut} et {lacune.borne.fin} : {decrireLacune(lacune)}. La
                  source ne les publie pas — ce n'est pas un défaut de lecture.
                </AlertDescription>
              </Alert>
            );
          })()}

          <div className="grid grid-cols-[repeat(auto-fill,minmax(224px,1fr))] gap-3">
            {saisonCourante.elements.map((el) => (
              <CarteEpisode
                key={el.cle}
                element={el}
                vu={
                  el.episode?.episode != null && vus.has(empreinte(el.episode.saison, el.episode.episode))
                }
                onLire={() => lire(el)}
                onBasculerVu={() => el.episode && basculerVu(el.episode.saison, el.episode.episode)}
              />
            ))}
          </div>
        </section>
      )}

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
  // La bande-son d'un film n'est presque jamais dans son conteneur : elle vient de la banque
  // `anime_stream`, et `audio[0].source` dit laquelle des deux voies a répondu.
  const piste = film.audio[0];
  const meta = [
    film.duree ? formaterDuree(film.duree) : null,
    film.largeur ? `${film.largeur}×${film.hauteur}` : null,
    film.codec?.toUpperCase(),
    piste
      ? `son ${piste.codec.toUpperCase()} ${piste.frequence ? `${Math.round(piste.frequence / 1000)} kHz` : ""}`.trim()
      : "sans bande-son",
    piste && piste.source !== "conteneur" ? `cue ${piste.source}` : null,
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
          {/* Les deux actions de la vedette passent par `Button` : elles étaient peintes à la
              main (`bg-accent`, `text-white`), donc sourdes au thème clair et au zoom d'interface
              que le reste de l'application respecte. */}
          <Button onClick={onLire}>
            <Icon name="play_arrow" size={16} />
            Lire
          </Button>
          {onReveler && (
            <Button variant="outline" onClick={onReveler}>
              <Icon name="folder_open" size={16} />
              Voir le fichier
            </Button>
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

// ── Sélecteur de saison ───────────────────────────────────────────────────────

/** Une pastille de saison. Les cinématiques du jeu portent un liseré d'accent : elles sont une
 * saison du catalogue, pas une saison de la série — le dire dans l'interface évite d'avoir à
 * l'expliquer ailleurs. */
function ChipSaison({
  titre,
  nombre,
  actif,
  jeu,
  onClick,
}: {
  titre: string;
  nombre: number;
  actif: boolean;
  jeu?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={actif}
      className={cn(
        "shrink-0 rounded-full px-3 py-1 text-xs transition-colors",
        actif ? "bg-accent text-white" : "bg-app-box text-ink-dull hover:bg-app-hover hover:text-ink",
        jeu && !actif && "ring-1 ring-inset ring-accent/40",
      )}
    >
      {titre}
      <span className={cn("ml-1.5 tabular-nums", actif ? "text-white/70" : "text-ink-faint")}>{nombre}</span>
    </button>
  );
}

// ── Rangée d'éléments (série ou jeu) ──────────────────────────────────────────

function RangeeElements({
  titre,
  elements,
  total,
  reprises,
  onLire,
  onVisible,
  onPrecharger,
  onMenu,
  onOuvrirSaison,
  vus,
  onBasculerVu,
}: {
  titre: string;
  elements: Element[];
  total: number;
  reprises: Reprises;
  onLire: (el: Element) => void;
  onVisible: (chemin: string) => void;
  onPrecharger: (chemin: string) => void;
  onMenu: (f: FilmDto) => void;
  onOuvrirSaison: () => void;
  /** Empreintes `saison:episode` des épisodes déjà vus. */
  vus: ReadonlySet<string>;
  onBasculerVu: (saison: number, episode: number | null) => void;
}) {
  const pisteRef = useRef<HTMLDivElement | null>(null);

  const defiler = (sens: 1 | -1) => {
    const piste = pisteRef.current;
    if (!piste) return;
    piste.scrollBy({ left: sens * piste.clientWidth * 0.8, behavior: "smooth" });
  };

  return (
    <section className="group/rangee relative px-4 py-2">
      <div className="mb-1.5 flex items-baseline gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-dull">
          {titre} <span className="ml-1 font-normal normal-case text-ink-faint">{total}</span>
        </h3>
        <button
          type="button"
          onClick={onOuvrirSaison}
          className="text-tiny text-ink-faint underline-offset-2 hover:text-accent hover:underline"
        >
          tout voir
        </button>
      </div>
      <div className="relative">
        <button
          type="button"
          onClick={() => defiler(-1)}
          aria-label="Défiler vers la gauche"
          className="absolute left-0 top-0 z-10 hidden h-full w-8 items-center justify-center rounded-l-md bg-gradient-to-r from-app to-transparent text-ink-dull opacity-0 transition-opacity hover:text-ink group-hover/rangee:opacity-100 md:flex"
        >
          <Icon name="chevron_left" size={20} />
        </button>
        <div ref={pisteRef} className="no-scrollbar flex gap-2 overflow-x-auto scroll-smooth pb-1">
          {elements.map((el) =>
            el.film ? (
              <Carte
                key={el.cle}
                film={el.film}
                reprise={reprises[el.cle]}
                onLire={() => onLire(el)}
                onVisible={onVisible}
                onPrecharger={onPrecharger}
                onMenu={() => el.film && onMenu(el.film)}
              />
            ) : (
              <div key={el.cle} className="w-56 shrink-0">
                <CarteEpisode
                  element={el}
                  vu={el.episode?.episode != null && vus.has(empreinte(el.episode.saison, el.episode.episode))}
                  onLire={() => onLire(el)}
                  onBasculerVu={() => el.episode && onBasculerVu(el.episode.saison, el.episode.episode)}
                />
              </div>
            ),
          )}
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

// ── Carte d'épisode (série) ───────────────────────────────────────────────────

/**
 * La vignette vient de `img.youtube.com` : c'est une ressource distante, donc soumise au réseau.
 * Son échec est traité (`onError`) plutôt qu'ignoré — une carte muette avec une image cassée est
 * moins lisible qu'une carte qui assume de n'avoir que du texte.
 */
function CarteEpisode({
  element,
  vu,
  onLire,
  onBasculerVu,
}: {
  element: Element;
  vu?: boolean;
  onLire: () => void;
  onBasculerVu?: () => void;
}) {
  const [imageKo, setImageKo] = useState(false);
  const e = element.episode;
  return (
    <button
      type="button"
      onClick={onLire}
      className={cn(
        "group/carte flex w-full flex-col overflow-hidden rounded-md border bg-app-box text-left transition-colors hover:border-accent",
        vu ? "border-emerald-500/40" : "border-app-line",
      )}
    >
      <div className="relative aspect-video w-full overflow-hidden bg-app-darkBox">
        {element.vignette && !imageKo ? (
          <img
            src={element.vignette}
            alt=""
            loading="lazy"
            onError={() => setImageKo(true)}
            className="h-full w-full object-cover transition-transform duration-300 group-hover/carte:scale-105"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-ink-faint">
            <Icon name="movie" size={28} />
          </div>
        )}
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover/carte:opacity-100">
          <Icon name="play_circle" size={36} className="text-white" />
        </div>
        {e?.episode ? (
          <span className="absolute left-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-tiny font-medium text-white">
            É{e.episode}
          </span>
        ) : null}
        {e?.langue ? (
          <span className="absolute right-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-tiny uppercase text-white/80">
            {e.langue}
          </span>
        ) : null}
        {/* Marquer vu sans ouvrir : `stopPropagation` parce que la carte entière est un bouton —
            sans lui, cocher lancerait la lecture. */}
        {onBasculerVu && (
          <span
            role="button"
            tabIndex={-1}
            aria-label={vu ? "Marquer comme non vu" : "Marquer comme vu"}
            title={vu ? "Marquer comme non vu" : "Marquer comme vu"}
            onClick={(ev) => {
              ev.stopPropagation();
              onBasculerVu();
            }}
            className={cn(
              "absolute bottom-1 right-1 rounded-full bg-black/70 p-0.5 transition-opacity",
              vu ? "text-emerald-400 opacity-100" : "text-white/70 opacity-0 group-hover/carte:opacity-100",
            )}
          >
            <Icon name={vu ? "check_circle" : "radio_button_unchecked"} size={16} />
          </span>
        )}
      </div>
      <div className="p-2">
        <div className="line-clamp-2 text-xs font-medium text-ink" title={element.titre}>
          {element.titre}
        </div>
        <div className="mt-0.5 flex items-baseline gap-1.5 text-tiny text-ink-faint">
          {element.sousTitre && <span>{element.sousTitre}</span>}
          {/* La transcription romaji sous le titre français : c'est par elle qu'on relie un
              épisode à ce qu'en disent les sources japonaises. */}
          {e?.romaji && <span className="truncate italic opacity-70">{e.romaji}</span>}
        </div>
      </div>
    </button>
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
