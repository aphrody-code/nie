// Catalogue des épisodes de la série — le quatrième gisement (`anime`, cf. `docs/FUSION.md`),
// lu depuis `data/anime/episodes.db` par `tauri-plugin-sql`, exactement comme le miroir du wiki
// (`wikiDb.ts`) et la base de reverse (`reDb.ts`).
//
// ## D'où vient cette base
//
// `packages/ietv` (`@aphrody/ietv`) recense les épisodes publiés par la chaîne officielle et les
// écrit dans ce SQLite ; la tâche `packages/cron/src/tasks/ietv-cache.ts` le rafraîchit. Le
// paquet lui-même n'est PAS importé ici : c'est un scraper Node qui parle à YouTube, il n'a rien
// à faire dans une webview. Ce qui voyage jusqu'à l'application, c'est son résultat — la base,
// embarquée dans l'installeur au même titre que les deux autres (`installer_bases_embarquees`).
//
// `@aphrody/ietv-client` (le client REST) vise un serveur `/api/ietv` : il reste la bonne porte
// pour un bot ou un site, pas pour une application qui doit fonctionner hors ligne. Le schéma lu
// ici est celui qu'écrit `IETVCache`, donc les deux chemins servent les mêmes données.
import Database from "@tauri-apps/plugin-sql";

import { api } from "./api";

/** Un épisode de la série. */
export interface EpisodeAnime {
  id: number;
  /** Numéro de saison tel que le porte la base (1…10). */
  saison: number;
  /** Numéro d'épisode dans la saison, `null` pour un film ou un hors-série. */
  episode: number | null;
  /** Identifiant YouTube — c'est lui qui sert à la lecture (`embed`). */
  videoId: string;
  titre: string;
  /** Titre original japonais — renseigné pour 330 des 355 épisodes. */
  titreJp: string | null;
  /** Transcription latine du titre japonais — 327 des 355. */
  romaji: string | null;
  description: string | null;
  vignette: string | null;
  /** Date de première diffusion (`2008-10-05`) — 330 des 355. */
  publie: string | null;
  langue: string | null;
  /**
   * Durée en secondes. **Vide sur tout le corpus actuel** (0 épisode sur 355), comme `viewCount`
   * et `quality` : la colonne existe au schéma de `IETVCache`, la source ne la remplit pas. Elle
   * est lue quand même — le jour où elle l'est, rien n'aura à changer ici — mais l'interface ne
   * réserve aucune place à un chiffre qui n'arrive jamais.
   */
  duree: number | null;
}

/** Une saison, telle que nommée par la source (« GO », « Chrono Stones », « Films »…). */
export interface SaisonAnime {
  saison: number;
  nom: string;
  total: number;
}

let promesseDb: Promise<Database> | null = null;
let cheminOuvert: string | null = null;

/** sqlx veut des `/`, pas des `\` — même conversion que `wikiDb`/`reDb`. */
function uriSqlite(chemin: string): string {
  return `sqlite:${chemin.replace(/\\/g, "/")}`;
}

function connect(chemin: string): Promise<Database> {
  if (promesseDb && cheminOuvert === chemin) return promesseDb;
  cheminOuvert = chemin;
  promesseDb = Database.load(uriSqlite(chemin));
  return promesseDb;
}

/** Chemin résolu de la base (commande Rust `default_anime_db`), ou `null` si aucune n'existe. */
export function defaultAnimeDbPath(gameDir?: string): Promise<string | null> {
  return api.defaultAnimeDb(gameDir);
}

export const animeDb = {
  /**
   * Les saisons, dans l'ordre de diffusion.
   *
   * Le total vient d'un décompte des épisodes RÉELLEMENT présents, pas de la colonne
   * `seasons.totalEpisodes` : celle-ci porte ce que la chaîne annonce, et une saison partiellement
   * moissonnée afficherait un nombre d'épisodes qu'on ne saurait pas ouvrir.
   */
  async saisons(chemin: string): Promise<SaisonAnime[]> {
    const d = await connect(chemin);
    return d.select<SaisonAnime[]>(
      `SELECT s.season AS saison,
              COALESCE(s.name, 'Saison ' || s.season) AS nom,
              (SELECT count(*) FROM episodes e WHERE e.season = s.season) AS total
         FROM seasons s
        GROUP BY s.season
       HAVING total > 0
        ORDER BY s.season`,
    );
  },

  /** Les épisodes d'une saison, dans l'ordre. */
  async episodes(chemin: string, saison: number): Promise<EpisodeAnime[]> {
    const d = await connect(chemin);
    return d.select<EpisodeAnime[]>(
      `SELECT id, season AS saison, episode, videoId, title AS titre, description,
              titleJp AS titreJp, romaji,
              thumbnail AS vignette, publishDate AS publie, language AS langue, duration AS duree
         FROM episodes WHERE season = $1
        ORDER BY COALESCE(episode, 9999), id`,
      [saison],
    );
  },

  /** Tous les épisodes, saison puis numéro — une seule requête pour bâtir toutes les rangées. */
  async tous(chemin: string): Promise<EpisodeAnime[]> {
    const d = await connect(chemin);
    return d.select<EpisodeAnime[]>(
      `SELECT id, season AS saison, episode, videoId, title AS titre, description,
              titleJp AS titreJp, romaji,
              thumbnail AS vignette, publishDate AS publie, language AS langue, duration AS duree
         FROM episodes
        ORDER BY season, COALESCE(episode, 9999), id`,
    );
  },

  /**
   * Recherche plein texte, sur les quatre champs qui peuvent porter le nom d'un épisode.
   *
   * La vue Cinéma filtre en mémoire (elle a déjà les 355 épisodes) ; cette requête sert aux
   * appelants qui n'ont pas le catalogue sous la main — l'équivalent de `IETVCache.search` côté
   * bot, avec la même portée de champs que celle qu'`IETVCache` couvre désormais.
   */
  async chercher(chemin: string, q: string, limite = 200): Promise<EpisodeAnime[]> {
    const terme = q.trim().replace(/[%_]/g, "");
    if (terme.length < 2) return [];
    const d = await connect(chemin);
    return d.select<EpisodeAnime[]>(
      `SELECT id, season AS saison, episode, videoId, title AS titre, description,
              titleJp AS titreJp, romaji,
              thumbnail AS vignette, publishDate AS publie, language AS langue, duration AS duree
         FROM episodes
        WHERE title LIKE $1 OR titleJp LIKE $1 OR romaji LIKE $1 OR description LIKE $1
        ORDER BY season, COALESCE(episode, 9999)
        LIMIT $2`,
      [`%${terme}%`, limite],
    );
  },

  /** Volumétrie, pour le tableau de bord et l'état de la vue Cinéma. */
  async stats(chemin: string): Promise<{ saisons: number; episodes: number }> {
    const d = await connect(chemin);
    const [r] = await d.select<{ saisons: number; episodes: number }[]>(
      `SELECT (SELECT count(DISTINCT season) FROM episodes) AS saisons,
              (SELECT count(*) FROM episodes) AS episodes`,
    );
    return r ?? { saisons: 0, episodes: 0 };
  },
};

/** URL d'intégration YouTube d'un épisode. `youtube-nocookie` plutôt que `youtube` : le domaine
 * sans cookie ne dépose rien tant que la lecture n'a pas commencé — la vue Cinéma affiche des
 * dizaines de vignettes, elle n'a aucune raison d'ouvrir autant de traceurs. */
export function urlIntegration(videoId: string, depart?: number): string {
  const p = new URLSearchParams({ autoplay: "1", rel: "0", modestbranding: "1" });
  if (depart && depart > 0) p.set("start", String(Math.floor(depart)));
  return `https://www.youtube-nocookie.com/embed/${videoId}?${p}`;
}

/** URL de la page YouTube — pour « ouvrir dans le navigateur ». */
export function urlYoutube(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}
