// Lecteur vidéo natif des cinématiques du jeu.
//
// Il joue le flux produit à la volée par `nievideo://` (remux pur Rust, cf. `src-tauri/video.rs`) —
// un MP4 si le film est en H.264, un WebM s'il est en VP9 — et, quand le film en a une, une piste
// sonore WAV SÉPARÉE. La séparation n'est pas un choix esthétique : la bande-son d'un USM est du
// HCA Criware, qu'aucun conteneur MP4 ne transporte. Les deux éléments sont resynchronisés ici.
//
// Mesuré sur le corpus : **2 films sur 97 seulement portent une piste sonore** (les deux logos).
// Les 95 autres sont muets par construction, le moteur les accompagnant de sa musique de fond
// (`bgmName` dans `movie_playing_config`). Le lecteur le dit plutôt que de laisser croire à une
// panne de son.
//
// ## Resynchronisation
//
// `<audio>` suit `<video>`, jamais l'inverse : la vidéo porte l'horloge de référence (c'est elle
// que le compositeur cadence sur le rafraîchissement de l'écran). À chaque `timeupdate` — soit
// ~4 fois par seconde — on mesure la dérive ; au-delà de DERIVE_MAX on recale l'audio d'un coup.
// Un recalage permanent produirait un hoquet audible à chaque mesure ; ne jamais recaler laisse
// la dérive s'installer sur un film de vingt minutes.
//
// ## Ce que le lecteur ne fait pas
//
// Il n'y a pas de piste de sous-titres : le jeu ne les stocke pas dans le conteneur mais dans un
// `.cfg.bin` séparé (`subtitleTextPath`), indexé par un hash de menu. Le chemin est affiché dans
// la fiche du film, sa résolution reste à faire.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/utils";

/** Dérive tolérée entre l'image et le son, en secondes, avant recalage. */
const DERIVE_MAX = 0.25;

/** Délai d'inactivité avant escamotage des contrôles, en millisecondes. */
const DELAI_MASQUAGE = 2600;

/** Vitesses de lecture proposées. */
const VITESSES = [0.25, 0.5, 1, 1.25, 1.5, 2];

/** Encode un chemin VFS en URL servie par le protocole `nievideo`.
 *
 * **`convertFileSrc` et pas une chaîne bâtie à la main** : la forme de l'URL dépend de la
 * plateforme. Sous Windows et Android, Tauri sert les protocoles personnalisés en
 * `http://<protocole>.localhost/<chemin>` ; ailleurs en `<protocole>://localhost/<chemin>`.
 * Écrire `nievideo://localhost/…` en dur ne chargerait donc rien sur cette machine.
 *
 * Hors runtime Tauri (un navigateur, pour déboguer une mise en page), il n'y a pas de protocole
 * du tout : la fonction rend une chaîne vide, et le `<video>` reste sans source plutôt que de
 * réclamer une URL qui n'existe pas. */
export function urlVideo(chemin: string, piste?: "audio"): string {
  let base: string;
  try {
    base = convertFileSrc(chemin, "nievideo");
  } catch {
    return "";
  }
  return `${base}${piste ? `?track=${piste}` : ""}`;
}

/** Deux chiffres, zéro devant. */
const deux = (n: number) => String(n).padStart(2, "0");

/** `93.55` → `1:33`. Rend `--:--` pour une durée inconnue. */
export function formaterDuree(secondes: number | null | undefined): string {
  if (secondes == null || !Number.isFinite(secondes) || secondes < 0) return "--:--";
  const s = Math.floor(secondes % 60);
  const m = Math.floor((secondes / 60) % 60);
  const h = Math.floor(secondes / 3600);
  return h > 0 ? `${h}:${deux(m)}:${deux(s)}` : `${m}:${deux(s)}`;
}

export interface VideoPlayerProps {
  /** Chemin VFS du `.usm`. */
  chemin: string;
  /** Titre affiché en surimpression. */
  titre: string;
  /** Sous-titre (rubrique, définition, codec…). */
  detail?: string;
  /** Le film a-t-il une piste sonore ? Sans elle, aucun `<audio>` n'est monté. */
  avecAudio?: boolean;
  /** Lecture immédiate. */
  autoPlay?: boolean;
  /** Fermeture (croix, Échap). */
  onClose?: () => void;
  /** Progression rapportée en continu — sert au « Reprendre la lecture ». */
  onProgression?: (secondes: number, duree: number) => void;
  /** Position de reprise, en secondes. */
  depart?: number;
  className?: string;
}

export function VideoPlayer({
  chemin,
  titre,
  detail,
  avecAudio = true,
  autoPlay = true,
  onClose,
  onProgression,
  depart,
  className,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const hoteRef = useRef<HTMLDivElement | null>(null);
  const minuterieRef = useRef<number | null>(null);

  const [enLecture, setEnLecture] = useState(false);
  const [position, setPosition] = useState(0);
  const [duree, setDuree] = useState(0);
  const [tampon, setTampon] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muet, setMuet] = useState(false);
  const [vitesse, setVitesse] = useState(1);
  const [pleinEcran, setPleinEcran] = useState(false);
  const [visible, setVisible] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [chargement, setChargement] = useState(true);

  const src = useMemo(() => urlVideo(chemin), [chemin]);
  const srcAudio = useMemo(() => (avecAudio ? urlVideo(chemin, "audio") : null), [chemin, avecAudio]);

  // ── Contrôles ───────────────────────────────────────────────────────────────

  const reveiller = useCallback(() => {
    setVisible(true);
    if (minuterieRef.current) window.clearTimeout(minuterieRef.current);
    minuterieRef.current = window.setTimeout(() => setVisible(false), DELAI_MASQUAGE);
  }, []);

  const basculerLecture = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => {});
    else v.pause();
    reveiller();
  }, [reveiller]);

  const chercher = useCallback(
    (secondes: number) => {
      const v = videoRef.current;
      if (!v || !Number.isFinite(secondes)) return;
      const cible = Math.max(0, Math.min(secondes, v.duration || 0));
      v.currentTime = cible;
      // Recalage immédiat de l'audio : attendre le `timeupdate` laisserait entendre l'ancienne
      // position pendant un quart de seconde.
      if (audioRef.current) audioRef.current.currentTime = cible;
      setPosition(cible);
      reveiller();
    },
    [reveiller],
  );

  const decaler = useCallback(
    (delta: number) => chercher((videoRef.current?.currentTime ?? 0) + delta),
    [chercher],
  );

  const basculerPleinEcran = useCallback(() => {
    const hote = hoteRef.current;
    if (!hote) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void hote.requestFullscreen().catch(() => {});
  }, []);

  const basculerPip = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (document.pictureInPictureElement) void document.exitPictureInPicture().catch(() => {});
    else void v.requestPictureInPicture?.().catch(() => {});
  }, []);

  // ── Synchronisation image/son ───────────────────────────────────────────────

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const surTemps = () => {
      setPosition(v.currentTime);
      onProgression?.(v.currentTime, v.duration || 0);
      const a = audioRef.current;
      if (a && !a.paused) {
        const derive = a.currentTime - v.currentTime;
        if (Math.abs(derive) > DERIVE_MAX) a.currentTime = v.currentTime;
      }
      if (v.buffered.length > 0) setTampon(v.buffered.end(v.buffered.length - 1));
    };
    const surMeta = () => {
      setDuree(v.duration || 0);
      setChargement(false);
      if (depart && depart > 0 && depart < (v.duration || 0)) {
        v.currentTime = depart;
        if (audioRef.current) audioRef.current.currentTime = depart;
      }
    };
    const surLecture = () => {
      setEnLecture(true);
      const a = audioRef.current;
      if (a) {
        a.currentTime = v.currentTime;
        void a.play().catch(() => {});
      }
    };
    const surPause = () => {
      setEnLecture(false);
      audioRef.current?.pause();
      setVisible(true);
    };
    const surFin = () => {
      setEnLecture(false);
      audioRef.current?.pause();
      setVisible(true);
    };
    const surErreur = () => {
      setChargement(false);
      setErreur(
        v.error?.message ||
          "cette vidéo n'a pas pu être décodée — son codec n'est peut-être pas du H.264",
      );
    };
    const surAttente = () => setChargement(true);
    const surPret = () => setChargement(false);

    v.addEventListener("timeupdate", surTemps);
    v.addEventListener("loadedmetadata", surMeta);
    v.addEventListener("play", surLecture);
    v.addEventListener("pause", surPause);
    v.addEventListener("ended", surFin);
    v.addEventListener("error", surErreur);
    v.addEventListener("waiting", surAttente);
    v.addEventListener("canplay", surPret);
    return () => {
      v.removeEventListener("timeupdate", surTemps);
      v.removeEventListener("loadedmetadata", surMeta);
      v.removeEventListener("play", surLecture);
      v.removeEventListener("pause", surPause);
      v.removeEventListener("ended", surFin);
      v.removeEventListener("error", surErreur);
      v.removeEventListener("waiting", surAttente);
      v.removeEventListener("canplay", surPret);
    };
  }, [depart, onProgression]);

  // La vitesse et le volume s'appliquent aux DEUX éléments, sinon le son dérive aussitôt.
  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = vitesse;
    if (audioRef.current) audioRef.current.playbackRate = vitesse;
  }, [vitesse]);

  useEffect(() => {
    // La piste vidéo est toujours muette : tout le son vient du `<audio>`. Un MP4 remuxé n'a
    // d'ailleurs aucune piste sonore — mais le rendre muet explicitement évite qu'un futur
    // conteneur avec son ne se superpose au WAV.
    if (videoRef.current) videoRef.current.muted = true;
    if (audioRef.current) {
      audioRef.current.volume = volume;
      audioRef.current.muted = muet;
    }
  }, [volume, muet]);

  // Changement de film : on repart de zéro plutôt que de garder l'erreur du précédent.
  useEffect(() => {
    setErreur(null);
    setChargement(true);
    setPosition(0);
    setDuree(0);
    setTampon(0);
  }, [chemin]);

  useEffect(() => {
    const surChangement = () => setPleinEcran(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", surChangement);
    return () => document.removeEventListener("fullscreenchange", surChangement);
  }, []);

  // ── Clavier ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    const surTouche = (e: KeyboardEvent) => {
      const cible = e.target as HTMLElement | null;
      // Un raccourci ne doit pas voler une frappe destinée à un champ de saisie.
      if (cible && (cible.tagName === "INPUT" || cible.tagName === "TEXTAREA" || cible.isContentEditable)) {
        return;
      }
      switch (e.key) {
        case " ":
        case "k":
          e.preventDefault();
          basculerLecture();
          break;
        case "ArrowLeft":
          e.preventDefault();
          decaler(e.shiftKey ? -1 : -5);
          break;
        case "ArrowRight":
          e.preventDefault();
          decaler(e.shiftKey ? 1 : 5);
          break;
        case "j":
          e.preventDefault();
          decaler(-10);
          break;
        case "l":
          e.preventDefault();
          decaler(10);
          break;
        case "ArrowUp":
          e.preventDefault();
          setVolume((v) => Math.min(1, v + 0.05));
          reveiller();
          break;
        case "ArrowDown":
          e.preventDefault();
          setVolume((v) => Math.max(0, v - 0.05));
          reveiller();
          break;
        case "m":
          setMuet((m) => !m);
          reveiller();
          break;
        case "f":
          basculerPleinEcran();
          break;
        case "p":
          basculerPip();
          break;
        case "Escape":
          if (!document.fullscreenElement) onClose?.();
          break;
        default:
          // 0–9 : saut au pourcentage correspondant, comme sur un lecteur web.
          if (/^[0-9]$/.test(e.key) && duree > 0) {
            e.preventDefault();
            chercher((Number(e.key) / 10) * duree);
          }
      }
    };
    window.addEventListener("keydown", surTouche);
    return () => window.removeEventListener("keydown", surTouche);
  }, [basculerLecture, basculerPip, basculerPleinEcran, chercher, decaler, duree, onClose, reveiller]);

  useEffect(
    () => () => {
      if (minuterieRef.current) window.clearTimeout(minuterieRef.current);
    },
    [],
  );

  // ── Rendu ───────────────────────────────────────────────────────────────────

  const pourcentage = duree > 0 ? (position / duree) * 100 : 0;
  const pourcentageTampon = duree > 0 ? (tampon / duree) * 100 : 0;

  const surBarre = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || duree <= 0) return;
    chercher(((e.clientX - rect.left) / rect.width) * duree);
  };

  return (
    <div
      ref={hoteRef}
      className={cn(
        "group relative flex h-full min-h-0 w-full items-center justify-center overflow-hidden bg-black",
        !visible && enLecture && "cursor-none",
        className,
      )}
      onMouseMove={reveiller}
      onDoubleClick={basculerPleinEcran}
    >
      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- le jeu ne fournit aucune piste
          de sous-titres dans le conteneur (cf. l'en-tête de ce fichier). */}
      <video
        ref={videoRef}
        src={src}
        autoPlay={autoPlay}
        muted
        playsInline
        className="h-full w-full object-contain"
        onClick={basculerLecture}
      />
      {srcAudio && <audio ref={audioRef} src={srcAudio} preload="auto" />}

      {chargement && !erreur && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-white/25 border-t-white/90" />
        </div>
      )}

      {erreur && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/85 p-6 text-center">
          <Icon name="error" size={28} className="text-status-error" />
          <div className="text-sm font-medium text-white">Lecture impossible</div>
          <div className="max-w-lg text-xs text-white/60">{erreur}</div>
        </div>
      )}

      {/* Bandeau haut : titre + fermeture. */}
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 bg-gradient-to-b from-black/80 to-transparent p-4 transition-opacity",
          visible || !enLecture ? "opacity-100" : "opacity-0",
        )}
      >
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-white">{titre}</div>
          {detail && <div className="truncate text-xs text-white/55">{detail}</div>}
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            title="Fermer (Échap)"
            aria-label="Fermer"
            className="pointer-events-auto rounded-md p-1.5 text-white/70 transition-colors hover:bg-white/15 hover:text-white"
          >
            <Icon name="close" size={18} />
          </button>
        )}
      </div>

      {/* Contrôles. */}
      <div
        className={cn(
          "absolute inset-x-0 bottom-0 flex flex-col gap-1 bg-gradient-to-t from-black/90 via-black/60 to-transparent px-4 pb-3 pt-10 transition-opacity",
          visible || !enLecture ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        {/* Barre de progression : le tampon en gris, la position en accent. */}
        <div
          className="group/barre relative h-4 cursor-pointer"
          onClick={surBarre}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") basculerLecture();
          }}
          role="slider"
          tabIndex={0}
          aria-label="Position dans la vidéo"
          aria-valuemin={0}
          aria-valuemax={Math.round(duree)}
          aria-valuenow={Math.round(position)}
        >
          <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-white/20 transition-[height] group-hover/barre:h-1.5">
            <div className="h-full rounded-full bg-white/30" style={{ width: `${pourcentageTampon}%` }} />
          </div>
          <div
            className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-accent transition-[height] group-hover/barre:h-1.5"
            style={{ width: `${pourcentage}%` }}
          />
          <div
            className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent opacity-0 transition-opacity group-hover/barre:opacity-100"
            style={{ left: `${pourcentage}%` }}
          />
        </div>

        <div className="flex items-center gap-1 text-white">
          <BoutonLecteur icone={enLecture ? "pause" : "play_arrow"} titre={enLecture ? "Pause (K)" : "Lecture (K)"} onClick={basculerLecture} />
          <BoutonLecteur icone="fast_rewind" titre="Reculer de 10 s (J)" onClick={() => decaler(-10)} />
          <BoutonLecteur icone="fast_forward" titre="Avancer de 10 s (L)" onClick={() => decaler(10)} />

          <div className="group/volume flex items-center gap-1">
            <BoutonLecteur
              icone={muet || volume === 0 ? "volume_off" : "volume_up"}
              titre={muet ? "Rétablir le son (M)" : "Couper le son (M)"}
              onClick={() => setMuet((m) => !m)}
              desactive={!srcAudio}
            />
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={muet ? 0 : volume}
              disabled={!srcAudio}
              onChange={(e) => {
                setVolume(Number(e.target.value));
                setMuet(false);
              }}
              aria-label="Volume"
              className="h-1 w-0 cursor-pointer appearance-none rounded-full bg-white/30 opacity-0 transition-all group-hover/volume:w-20 group-hover/volume:opacity-100 accent-accent"
            />
          </div>

          <div className="ml-2 select-none font-mono text-xs tabular-nums text-white/80">
            {formaterDuree(position)} <span className="text-white/35">/ {formaterDuree(duree)}</span>
          </div>

          <div className="flex-1" />

          {!srcAudio && (
            <span
              className="mr-1 rounded bg-white/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-white/50"
              title="Ce conteneur ne porte aucune piste sonore — c'est le cas de 95 des 97 films du jeu, que le moteur accompagne de sa musique de fond (bgmName)."
            >
              sans piste sonore
            </span>
          )}

          <select
            value={vitesse}
            onChange={(e) => setVitesse(Number(e.target.value))}
            aria-label="Vitesse de lecture"
            title="Vitesse de lecture"
            className="mr-1 rounded-md bg-white/10 px-1.5 py-1 text-xs text-white/85 outline-none hover:bg-white/20"
          >
            {VITESSES.map((v) => (
              <option key={v} value={v} className="text-ink">
                {v}×
              </option>
            ))}
          </select>

          <BoutonLecteur icone="picture_in_picture" titre="Incrustation (P)" onClick={basculerPip} />
          <BoutonLecteur
            icone={pleinEcran ? "fullscreen_exit" : "fullscreen"}
            titre={pleinEcran ? "Quitter le plein écran (F)" : "Plein écran (F)"}
            onClick={basculerPleinEcran}
          />
        </div>
      </div>
    </div>
  );
}

function BoutonLecteur({
  icone,
  titre,
  onClick,
  desactive,
}: {
  icone: string;
  titre: string;
  onClick: () => void;
  desactive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={titre}
      aria-label={titre}
      disabled={desactive}
      className="rounded-md p-1.5 text-white/85 transition-colors hover:bg-white/15 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
    >
      <Icon name={icone} size={18} />
    </button>
  );
}
