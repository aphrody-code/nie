/**
 * Téléchargement et intégration des médias pour la supertechnique Sauve-cabri (who01060 / Soyoyagi Step)
 * Sources : CDN CloudFront Azalée (WebM 60fps, poster JPG, thumbnail WebP) + Fandom Wiki (PNG).
 */

const TARGET_DIR = "var/skills/who01060";
const DATA_TARGET = "data/skills/who01060.json";

interface MediaDownload {
  url: string;
  filename: string;
  desc: string;
}

const downloads: MediaDownload[] = [
  {
    url: "https://dxi4wb638ujep.cloudfront.net/1/k/2/d/2dsflptek8e.webm",
    filename: "who01060.webm",
    desc: "Vidéo d'animation complète de la supertechnique (WebM / VP9)",
  },
  {
    url: "https://dxi4wb638ujep.cloudfront.net/1/k/t/0/t0xtgudchwk.jpg",
    filename: "who01060_poster.jpg",
    desc: "Affiche haute résolution de la technique",
  },
  {
    url: "https://dxi4wb638ujep.cloudfront.net/1/k/i/9/i9bgiab9d1m.webp",
    filename: "who01060_thumb.webp",
    desc: "Vignette de sélection de la technique",
  },
  {
    url: "https://static.wikia.nocookie.net/inazuma-eleven/images/6/6c/Soyoyagi_Step.png/revision/latest",
    filename: "who01060_fandom.png",
    desc: "Capture officielle de la supertechnique (Fandom Wiki)",
  },
];

console.log("=== Téléchargement des médias de Sauve-cabri (who01060) ===");

for (const item of downloads) {
  const destPath = `${TARGET_DIR}/${item.filename}`;
  const file = Bun.file(destPath);
  if (await file.exists()) {
    console.log(`[Déjà présent] ${item.filename} (${file.size} octets)`);
    continue;
  }

  console.log(`Téléchargement de ${item.desc}...`);
  console.log(`  Source : ${item.url}`);
  try {
    const res = await fetch(item.url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        "Accept": "*/*",
      },
    });

    if (!res.ok) {
      console.warn(`  Échec du téléchargement (${res.status} ${res.statusText}) pour ${item.url}`);
      continue;
    }

    const arrayBuffer = await res.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    await Bun.write(destPath, bytes);
    console.log(`  Écrit : ${destPath} (${bytes.length} octets)`);
  } catch (err) {
    console.error(`  Erreur réseau pour ${item.url} :`, err);
  }
}

// Extraction et synthèse des métadonnées enrichies
const skillMetadata = {
  id: "who01060",
  internal_code: "who01060",
  game_hash: "0xE0549BE6",
  game_hash_u32: 0xE0549BE6,
  names: {
    fr: "Sauve-cabri",
    en: "Easy Breezy Kid",
    ja: "そよヤギステップ",
    ja_kana: "ソヨヤギステップ",
    ja_romaji: "Soyoyagi Suteppu",
    es: "Brisa Encabritada",
    de: "Luftikitz",
  },
  category: {
    id: 2,
    slug: "dribble",
    label_fr: "Dribble",
    label_en: "Dribble",
    label_ja: "ドリブル",
  },
  element: {
    id: 1,
    slug: "wind",
    label_fr: "Vent",
    label_en: "Wind",
    label_ja: "風",
  },
  stats: {
    power_min: 70,
    power_max: 440,
    power_range: "70-440",
    consume_tp: 70,
    recast_time_s: 60,
    foul_rate: 0,
    growth_type: 5,
    growth_speed: "Type 5",
    partner_count: 0,
    has_partner: false,
    is_hyper: false,
  },
  descriptions: {
    fr: "Exécutez un dribble agile pour sauver un chevreau soudainement apparu sur le terrain.",
    en: "Save the goat kid that suddenly appears on the pitch by executing an Easy Breezy!",
    ja: "突如としてフィールドに現れる１匹のヤギ。\nそよかぜステップで　うまくヤギを救え！",
  },
  sources: {
    azalee: "https://azalee.rosegriffon.fr/skill/who01060",
    fandom: "https://inazuma-eleven.fandom.com/fr/wiki/Sauve-Cabri",
    game_table: "skill.cfg.bin -> SKILL_BASE (CRC32: 0xE0549BE6)",
    mirror_table: "var/mirror.sqlite -> inagle_skills",
  },
  media: {
    video_webm: `${TARGET_DIR}/who01060.webm`,
    poster_jpg: `${TARGET_DIR}/who01060_poster.jpg`,
    thumbnail_webp: `${TARGET_DIR}/who01060_thumb.webp`,
    fandom_png: `${TARGET_DIR}/who01060_fandom.png`,
    ingame_telop_path: "data/dx11/menu/220_img/telop_waza/fr/who01060_0.webp",
  },
  users: [
    {
      code: "c01000010",
      name_fr: "Arion Sherwind",
      name_ja: "松風 天馬 (Matsukaze Tenma)",
    },
  ],
};

await Bun.write(DATA_TARGET, JSON.stringify(skillMetadata, null, 2));
console.log(`\nMétadonnées canoniques enregistrées dans ${DATA_TARGET}`);
console.log("=== Téléchargement et synchronisation terminés avec succès ===");
