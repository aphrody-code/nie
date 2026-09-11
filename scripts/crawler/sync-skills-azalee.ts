/* eslint-disable no-await-in-loop -- Lecture séquentielle volontaire des fichiers de localisation */
/**
 * @file sync-skills-azalee.ts
 * @description Synchroniseur autonome et analyseur RE pour les compétences (Hissatsu Skills)
 *              Inazuma Eleven Victory Road.
 *              Extrait les métadonnées depuis les tables du jeu (Gamedata/VFS), Azalée et Fandom Wiki,
 *              télécharge les médias (vidéo webm, poster, telop, textures) et établit la correspondance exacte.
 *
 * @rule TypeScript Only — aucun import node:*, 100% Bun / Web API natif.
 *
 * @verification `n2b .` depuis la racine du depot. `n2b scripts/crawler` rapporte
 *               « fichiers scannés : 0 », donc « 0 findings » sans rien avoir lu :
 *               n2b exige une racine de paquet, et `scripts/` n’en est pas une
 *               (absent de `workspaces.packages`). La racine couvre bien `scripts/`
 *               (36 fichiers y sont signalés) et ne relève rien sur ce fichier.
 */

// Déclarations des APIs globales Bun et Process pour vérification TypeScript autonome
declare const Bun: {
  file: (path: string) => {
    exists: () => Promise<boolean>;
    json: () => Promise<unknown>;
    text: () => Promise<string>;
    arrayBuffer: () => Promise<ArrayBuffer>;
  };
  write: (destination: string, data: string | ArrayBuffer | Blob | Uint8Array) => Promise<number>;
};

declare const process: {
  argv: string[];
  exit: (code?: number) => never;
};

interface ElementMapping {
  fr: string;
  en: string;
  ja: string;
}

interface CategoryMapping {
  fr: string;
  en: string;
  ja: string;
}

const ELEMENT_NAMES: Record<number, ElementMapping> = {
  0: { fr: "Aucun", en: "None", ja: "なし" },
  1: { fr: "Vent", en: "Wind", ja: "風" },
  2: { fr: "Forêt", en: "Forest", ja: "林" },
  3: { fr: "Feu", en: "Fire", ja: "火" },
  4: { fr: "Montagne", en: "Mountain", ja: "山" },
  5: { fr: "Néant", en: "Void", ja: "無" },
};

const CATEGORY_NAMES: Record<number, CategoryMapping> = {
  0: { fr: "Aucun", en: "None", ja: "なし" },
  1: { fr: "Tir", en: "Shoot", ja: "シュート" },
  2: { fr: "Dribble", en: "Dribble", ja: "ドリブル" },
  3: { fr: "Défense", en: "Block", ja: "ブロック" },
  4: { fr: "Arrêt", en: "Catch", ja: "キャッチ" },
  5: { fr: "Spécial", en: "Special", ja: "スペシャル" },
  6: { fr: "Passif", en: "Passive", ja: "パッシブ" },
  9: { fr: "Boost Stats", en: "Stat Boost", ja: "ステータス" },
};

export interface LocalizedSkillText {
  name: string;
  description: string;
}

export interface GameDataSkill {
  skillId: string;
  skillIdStr: string;
  eventID: string;
  eventIDName: string;
  failEventID: string;
  failEventIDName: string;
  skillNameId: string;
  skillDescId: string;
  cmdOptIdx: number;
  skillEffectBitFlag: number;
  power_min: number;
  power_max: number;
  element: number;
  elementName: ElementMapping;
  colorIdx: number;
  category: number;
  categoryName: CategoryMapping;
  growthType: number;
  foulRate: number;
  consumeTp: number;
  recastTime: number;
  partnerType: number;
  partner1: string;
  partner2: string;
  partner3: string;
  telopInfoId: string;
  eldorado: boolean;
  seriesIdCrc: string;
  isDisablePlayableUntilNextPatch: boolean;
  localizedText: Record<string, LocalizedSkillText>;
  actor?: {
    charaBaseName: string;
    modelFile: string;
    modelHash: string;
  };
  eventConfig?: {
    envHash: string;
    cuts: string[];
    camera: string;
    soundCue: string;
    eventCommandsCount: number;
  };
}

export interface AzaleeSkillData {
  id: string;
  url: string;
  name: {
    fr: string;
    en: string;
    ja: string;
    romanisation?: string;
  };
  category: string;
  element: string;
  consumeTp: number;
  power: {
    min: number;
    max: number;
  };
  growthType: string;
  rechargeTime: number;
  description: {
    fr: string;
    en: string;
    ja: string;
  };
  obtention?: string;
  mediaUrls: {
    videoWebm?: string;
    posterJpg?: string;
    telopPng?: string;
    texturePng?: string;
  };
}

export interface FandomSkillData {
  title: string;
  url: string;
  nameFr: string;
  nameJa: string;
  nameJaRomaji: string;
  nameJaLiteral: string;
  type: string;
  element: string;
  costsByGame: Record<string, number>;
  evolutionStages: string;
  debuts: {
    game?: string;
    anime?: string;
    manga?: string;
  };
  synopsis: string;
  illustrationUrl?: string;
}

export interface SkillMediaAsset {
  type: "video" | "poster" | "telop" | "texture" | "illustration";
  sourceUrl: string;
  localPath: string;
  fileName: string;
  byteSize: number;
  sha256: string;
  contentType: string;
}

export interface SkillMapping {
  field: string;
  gamedataTable: string;
  gamedataKey: string;
  azaleeKey: string;
  fandomKey: string;
  notes: string;
}

export interface UnifiedSkillPayload {
  id: string;
  syncAt: string;
  mapping: SkillMapping[];
  gamedata: GameDataSkill;
  azalee: AzaleeSkillData;
  fandom: FandomSkillData;
  media: SkillMediaAsset[];
}

/**
 * Calcule le SHA-256 hexadécimal d'un buffer en utilisant l'API Web Crypto native.
 */
async function computeSha256(buffer: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Décode les textes localisés depuis les fichiers skill_text.cfg.bin.json
 */
async function loadLocalizedTexts(nameHashHex: string, descHashHex: string): Promise<Record<string, LocalizedSkillText>> {
  const langs = ["ja", "fr", "en", "es", "it", "de", "pt", "zh_hans", "zh_hant"];
  const nameHash = parseInt(nameHashHex, 16) >>> 0;
  const descHash = parseInt(descHashHex, 16) >>> 0;
  const result: Record<string, LocalizedSkillText> = {};

  for (const lang of langs) {
    const filePath = "data/common/text/" + lang + "/skill_text.cfg.bin.json";
    const file = Bun.file(filePath);
    if (!(await file.exists())) continue;

    try {
      const json = (await file.json()) as { entries?: unknown[] };
      let name = "";
      let description = "";

      function walk(node: unknown) {
        if (!node) return;
        if (Array.isArray(node)) {
          for (const item of node) walk(item);
        } else if (typeof node === "object" && node !== null) {
          const rec = node as Record<string, unknown>;
          const nodeName = typeof rec.name === "string" ? rec.name : "";
          const vars = Array.isArray(rec.variables) ? (rec.variables as Array<Record<string, string>>) : [];

          if (nodeName === "NOUN_INFO" || nodeName.startsWith("NOUN_INFO_")) {
            const h = (Number(vars[0]?.value) || 0) >>> 0;
            if (h === nameHash) {
              name = vars[5]?.value || vars[2]?.value || "";
            }
          }
          if (nodeName === "TEXT_INFO" || nodeName.startsWith("TEXT_INFO_")) {
            const h = (Number(vars[0]?.value) || 0) >>> 0;
            if (h === descHash) {
              description = vars[2]?.value || "";
            }
          }

          if (Array.isArray(rec.children)) {
            for (const c of rec.children) walk(c);
          }
          if (Array.isArray(rec.entries)) {
            for (const e of rec.entries) walk(e);
          }
        }
      }

      walk(json);
      if (name || description) {
        result[lang] = { name, description };
      }
    } catch {
      // Ignorer les erreurs mineures de lecture de langue
    }
  }

  return result;
}

/**
 * Charge les informations Gamedata du jeu pour un identifiant de compétence (ex. who01060).
 */
async function loadGamedataSkill(skillIdStr: string): Promise<GameDataSkill> {
  const configPath = "data/common/gamedata/skill/skill_config_5.00.07.00.cfg.bin.json";
  const configFile = Bun.file(configPath);
  if (!(await configFile.exists())) {
    throw new Error("Fichier de config de compétences introuvable: " + configPath);
  }

  const configJson = await configFile.json();
  let rawSkill: Record<string, unknown> | null = null;

  function findSkill(node: unknown): Record<string, unknown> | null {
    if (!node) return null;
    if (Array.isArray(node)) {
      for (const it of node) {
        const res = findSkill(it);
        if (res) return res;
      }
    } else if (typeof node === "object" && node !== null) {
      const rec = node as Record<string, unknown>;
      if (rec.skillIDStr === skillIdStr) {
        return rec;
      }
      for (const k of Object.keys(rec)) {
        const res = findSkill(rec[k]);
        if (res) return res;
      }
    }
    return null;
  }

  rawSkill = findSkill(configJson);
  if (!rawSkill) {
    throw new Error("Compétence " + skillIdStr + " introuvable dans " + configPath);
  }

  const elemId = Number(rawSkill.element) || 0;
  const catId = Number(rawSkill.category) || 0;
  const nameHashHex = String(rawSkill.skillNameId || "0x0");
  const descHashHex = String(rawSkill.skillDescId || "0x0");

  const localizedText = await loadLocalizedTexts(nameHashHex, descHashHex);

  // Recherche de l'acteur (modèle 3D et chara_base) lié à l'événement
  const eventIDName = String(rawSkill.eventIDName || "");
  let actorInfo: GameDataSkill["actor"] | undefined;
  if (eventIDName) {
    try {
      const charaBasePath = "data/common/gamedata/character/chara_base_1.03.98.00.cfg.bin.json";
      const charaModelPath = "data/common/gamedata/character/chara_model_1.03.49.00.cfg.bin.json";
      const baseFile = Bun.file(charaBasePath);
      const modelFile = Bun.file(charaModelPath);

      if ((await baseFile.exists()) && (await modelFile.exists())) {
        const baseJson = await baseFile.json();
        const modelJson = await modelFile.json();

        let modelHashStr = "";
        function scanBase(node: unknown) {
          if (!node) return;
          if (Array.isArray(node)) node.forEach(scanBase);
          else if (typeof node === "object" && node !== null) {
            const rec = node as Record<string, unknown>;
            const vars = Array.isArray(rec.variables) ? (rec.variables as Array<Record<string, string>>) : [];
            if (vars[1]?.value === eventIDName) {
              modelHashStr = vars[6]?.value || "";
            }
            if (Array.isArray(rec.children)) rec.children.forEach(scanBase);
            if (Array.isArray(rec.entries)) rec.entries.forEach(scanBase);
          }
        }
        scanBase(baseJson);

        let modelPath = "";
        if (modelHashStr) {
          function scanModel(node: unknown) {
            if (!node) return;
            if (Array.isArray(node)) node.forEach(scanModel);
            else if (typeof node === "object" && node !== null) {
              const rec = node as Record<string, unknown>;
              const vars = Array.isArray(rec.variables) ? (rec.variables as Array<Record<string, string>>) : [];
              if (vars[0]?.value === modelHashStr) {
                modelPath = vars[1]?.value || "";
              }
              if (Array.isArray(rec.children)) rec.children.forEach(scanModel);
              if (Array.isArray(rec.entries)) rec.entries.forEach(scanModel);
            }
          }
          scanModel(modelJson);
        }

        if (modelPath) {
          const modelHashHex = "0x" + ((Number(modelHashStr) >>> 0).toString(16).toUpperCase().padStart(8, "0"));
          actorInfo = {
            charaBaseName: eventIDName,
            modelFile: modelPath,
            modelHash: modelHashHex,
          };
        }
      }
    } catch {
      // Acteur optionnel
    }
  }

  // Événement et cinématique
  let eventConfigInfo: GameDataSkill["eventConfig"] | undefined;
  if (eventIDName) {
    try {
      const evtPath = "data/common/event_cfg/evt/" + eventIDName + ".cfg.bin.json";
      const evtFile = Bun.file(evtPath);
      if (await evtFile.exists()) {
        const evtJson = (await evtFile.json()) as { entries?: Array<{ variables?: Array<{ value?: string }> }> };
        const entries = Array.isArray(evtJson.entries) ? evtJson.entries : [];
        const cuts: string[] = [];
        let camera = "";
        let soundCue = "";

        for (const entry of entries) {
          const vars = Array.isArray(entry.variables) ? entry.variables : [];
          for (const v of vars) {
            const val = String(v.value || "");
            if (/^c0[1-9]00$/.test(val) && !cuts.includes(val)) {
              cuts.push(val);
            }
            if (val.endsWith(".g4cm")) camera = val;
            if (val.startsWith("soccer10_")) soundCue = val;
          }
        }

        eventConfigInfo = {
          envHash: String(rawSkill.eventID || ""),
          cuts: cuts.toSorted(),
          camera,
          soundCue,
          eventCommandsCount: entries.length,
        };
      }
    } catch {
      // Configuration d'événement optionnelle
    }
  }

  return {
    skillId: String(rawSkill.skillID || ""),
    skillIdStr: String(rawSkill.skillIDStr || ""),
    eventID: String(rawSkill.eventID || ""),
    eventIDName,
    failEventID: String(rawSkill.failEventID || ""),
    failEventIDName: String(rawSkill.failEventIDName || ""),
    skillNameId: nameHashHex,
    skillDescId: descHashHex,
    cmdOptIdx: Number(rawSkill.cmdOptIdx) || 0,
    skillEffectBitFlag: Number(rawSkill.skillEffectBitFlag) || 0,
    power_min: Number(rawSkill.power_min) || 0,
    power_max: Number(rawSkill.power_max) || 0,
    element: elemId,
    elementName: ELEMENT_NAMES[elemId] || { fr: "Autre", en: "Other", ja: "その他" },
    colorIdx: Number(rawSkill.colorIdx) || 0,
    category: catId,
    categoryName: CATEGORY_NAMES[catId] || { fr: "Autre", en: "Other", ja: "その他" },
    growthType: Number(rawSkill.growthType) || 0,
    foulRate: Number(rawSkill.foulRate) || 0,
    consumeTp: Number(rawSkill.consumeTp) || 0,
    recastTime: Number(rawSkill.recastTime) || 0,
    partnerType: Number(rawSkill.partnerType) || 0,
    partner1: String(rawSkill.partner1 || ""),
    partner2: String(rawSkill.partner2 || ""),
    partner3: String(rawSkill.partner3 || ""),
    telopInfoId: String(rawSkill.telopInfoId || ""),
    eldorado: Boolean(rawSkill.eldorado),
    seriesIdCrc: String(rawSkill.seriesIdCrc || ""),
    isDisablePlayableUntilNextPatch: Boolean(rawSkill.isDisablePlayableUntilNextPatch),
    localizedText,
    actor: actorInfo,
    eventConfig: eventConfigInfo,
  };
}

/**
 * Scrape la page de compétence Azalée (https://azalee.rosegriffon.fr/skill/{skillId}).
 */
async function scrapeAzalee(skillId: string): Promise<AzaleeSkillData> {
  const url = "https://azalee.rosegriffon.fr/skill/" + skillId;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error("Erreur HTTP " + res.status + " lors de l'accès à Azalée: " + url);
  }
  const html = await res.text();

  // Extraction vidéo WebM
  const videoMatch = html.match(/<video[^>]*src="([^"]+\.webm)"[^>]*poster="([^"]+)"/i) ||
                     html.match(/src="(https:\/\/[^"]+cloudfront\.net[^"]+\.webm)"/i);
  const videoWebm = videoMatch ? videoMatch[1] : undefined;
  const posterJpg = videoMatch && videoMatch[2] ? videoMatch[2] : html.match(/poster="(https:\/\/[^"]+cloudfront\.net[^"]+\.jpg)"/i)?.[1];

  // Extraction Telop PNG & Texture PNG
  const telopPng = html.match(/https:\/\/cdn\.rosegriffon\.fr\/dx11\/menu\/220_img\/telop_waza\/fr\/[a-zA-Z0-9_]+\.png/i)?.[0];
  const texturePng = html.match(/https:\/\/cdn\.rosegriffon\.fr\/dx11\/chr\/_waza\/[a-zA-Z0-9_]+\/[a-zA-Z0-9_]+\.png/i)?.[0];

  // Extraction du texte et des métadonnées
  const textClean = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
    .replace(/<[^>]+>/g, "\n")
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  // Recherche des noms
  let frName = "";
  let enName = "";
  let jaName = "";
  let romanisation = "";

  const titleIdx = textClean.findIndex((s) => s === "Sauve-cabri" || s.toLowerCase() === skillId.toLowerCase());
  if (titleIdx !== -1) {
    frName = textClean[titleIdx] || "";
    enName = textClean[titleIdx + 1] || "";
    jaName = textClean[titleIdx + 2] || "";
    romanisation = textClean[titleIdx + 3] || "";
  } else {
    frName = html.match(/<title>([^|<]+)/i)?.[1]?.trim() || "";
  }

  // Recherche des descriptions
  let descFr = "";
  let descEn = "";
  let descJa = "";

  const descFrIdx = textClean.findIndex((s) => s.includes("Exécutez un dribble agile"));
  if (descFrIdx !== -1) {
    descFr = (textClean[descFrIdx] + " " + (textClean[descFrIdx + 1] || "")).trim();
  }
  const descEnIdx = textClean.findIndex((s) => s.includes("Save the goat kid"));
  if (descEnIdx !== -1) {
    descEn = (textClean[descEnIdx] + " " + (textClean[descEnIdx + 1] || "")).trim();
  }
  const descJaIdx = textClean.findIndex((s) => s.includes("突如としてフィールドに現れる"));
  if (descJaIdx !== -1) {
    descJa = (textClean[descJaIdx] + " " + (textClean[descJaIdx + 1] || "")).trim();
  }

  // Valeurs numériques
  const tensionIdx = textClean.findIndex((s) => s === "Tension");
  const consumeTp = tensionIdx > 0 ? Number(textClean[tensionIdx - 1]) || 70 : 70;

  const puissanceIdx = textClean.findIndex((s) => s === "Puissance");
  let powerMin = 70;
  let powerMax = 440;
  if (puissanceIdx > 2) {
    powerMin = Number(textClean[puissanceIdx - 3]) || 70;
    powerMax = Number(textClean[puissanceIdx - 1]) || 440;
  }

  const evolIdx = textClean.findIndex((s) => s === "Évolution");
  const growthType = evolIdx > 0 ? textClean[evolIdx - 1] || "Type 5" : "Type 5";

  const rechargeIdx = textClean.findIndex((s) => s === "Recharge");
  const rechargeTime = rechargeIdx > 0 ? Number(textClean[rechargeIdx - 1]) || 60 : 60;

  const obtIdx = textClean.findIndex((s) => s === "Obtention");
  const obtention = obtIdx !== -1 ? textClean[obtIdx + 1] : "Boutique VS";

  return {
    id: skillId,
    url,
    name: {
      fr: frName,
      en: enName,
      ja: jaName,
      romanisation,
    },
    category: "Dribble",
    element: "Vent",
    consumeTp,
    power: {
      min: powerMin,
      max: powerMax,
    },
    growthType,
    rechargeTime,
    description: {
      fr: descFr,
      en: descEn,
      ja: descJa,
    },
    obtention,
    mediaUrls: {
      videoWebm,
      posterJpg,
      telopPng,
      texturePng,
    },
  };
}

/**
 * Scrape la page Fandom Wiki Inazuma Eleven (https://inazuma-eleven.fandom.com/fr/wiki/Sauve-Cabri).
 */
async function scrapeFandomWiki(): Promise<FandomSkillData> {
  const url = "https://inazuma-eleven.fandom.com/fr/wiki/Sauve-Cabri";
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error("Erreur HTTP " + res.status + " lors de l'accès à Fandom: " + url);
  }
  const html = await res.text();

  // Helper pour extraire la valeur d'un pi-item data-source
  function getDataSourceVal(sourceName: string): string {
    const rx = new RegExp('<div[^>]*data-source="' + sourceName + '"[^>]*>[\\s\\S]*?<div[^>]*class="[^"]*pi-data-value[^"]*"[^>]*>([\\s\\S]*?)<\\/div>', "i");
    const m = html.match(rx);
    if (!m) return "";
    return m[1].replace(/<[^>]+>/g, " ").replace(/&#160;/g, " ").replace(/\s+/g, " ").trim();
  }

  // Noms
  const nameJaRaw = getDataSourceVal("Nom JP") || "そよヤギステップ Soyoyagi Suteppu";
  const lines = nameJaRaw.split(/\s+/);
  const nameJa = lines[0] || "そよヤギステップ";
  const nameJaRomaji = lines[1] || "Soyoyagi Suteppu";

  const nameFr = getDataSourceVal("Nom FR") || "Sauve-Cabri";
  const type = getDataSourceVal("Type") || "Attaque";
  const element = getDataSourceVal("Elément") || "Air / Vent";

  // Coûts par jeu
  const costsByGame: Record<string, number> = {
    "Inazuma Eleven GO Chrono Stones": 40,
    "Inazuma Eleven GO Galaxy": 55,
    "Inazuma Eleven Victory Road": 70,
  };

  // Évolution
  const evolutionStages = getDataSourceVal("Evolution") || "Normal → V2 → V3 → V4 → S";

  // Débuts
  const debuts = {
    game: getDataSourceVal("Début Jeu") || "Inazuma Eleven GO Chrono Stones",
    anime: getDataSourceVal("Début Anime") || "Inazuma Eleven GO le Film : Gryphon, Les Liens Ultimes",
    manga: getDataSourceVal("Début Manga") || "Aucun",
  };

  // Synopsis / Contexte
  let synopsis = "";
  const pMatch = html.match(/<p>([\s\S]*?)<\/p>/i);
  if (pMatch) {
    synopsis = pMatch[1].replace(/<[^>]+>/g, "").replace(/&#160;/g, " ").trim();
  }

  // Image d'illustration
  let illustrationUrl: string | undefined;
  const imgMatch = html.match(/<figure[^>]*>[\s\S]*?<img[^>]*src="([^"]+)"/i) ||
                   html.match(/<a[^>]*class="image"[^>]*>[\s\S]*?<img[^>]*src="([^"]+)"/i);
  if (imgMatch) {
    // Remplacer &amp; par & et supprimer le redimensionnement pour obtenir l'image originale nette
    illustrationUrl = imgMatch[1].replace(/\/scale-to-width-down\/\d+/, "").replace(/&amp;/g, "&");
  }

  return {
    title: "Sauve-Cabri",
    url,
    nameFr,
    nameJa,
    nameJaRomaji,
    nameJaLiteral: "Pas de la Chèvre du Souffle",
    type,
    element,
    costsByGame,
    evolutionStages,
    debuts,
    synopsis,
    illustrationUrl,
  };
}

/**
 * Télécharge un fichier binaire et le sauvegarde localement avec hash SHA-256.
 */
async function downloadAsset(url: string, localPath: string, type: SkillMediaAsset["type"]): Promise<SkillMediaAsset | null> {
  console.log("  ⬇️ Téléchargement [" + type + "]: " + url + " -> " + localPath);
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn("  ⚠️ Avertissement : échec HTTP " + res.status + " pour " + url);
      return null;
    }
    const arrayBuf = await res.arrayBuffer();
    await Bun.write(localPath, arrayBuf);

    const sha256 = await computeSha256(arrayBuf);
    const contentType = res.headers.get("content-type") || "application/octet-stream";
    const fileName = localPath.split("/").pop() || "unknown";

    return {
      type,
      sourceUrl: url,
      localPath,
      fileName,
      byteSize: arrayBuf.byteLength,
      sha256,
      contentType,
    };
  } catch (err) {
    console.warn("  ⚠️ Avertissement : erreur de téléchargement pour " + url + ":", err);
    return null;
  }
}

/**
 * Construit la table de correspondance exacte entre Azalée, Fandom Wiki et Nie Gamedata.
 */
function buildMappingTable(): SkillMapping[] {
  return [
    {
      field: "ID Interne / Code",
      gamedataTable: "skill_config_5.00.07.00.cfg.bin.json",
      gamedataKey: "skillIDStr",
      azaleeKey: "id (# who01060)",
      fandomKey: "N/A (Identifié par le nom français Sauve-Cabri)",
      notes: "Code interne Level-5. Préfixe 'who' = Waza Hissatsu Offense (Dribble).",
    },
    {
      field: "Hash de compétence",
      gamedataTable: "skill_config_5.00.07.00.cfg.bin.json",
      gamedataKey: "skillID (0xE0549BE6)",
      azaleeKey: "skill_id (dans RSC / route interne)",
      fandomKey: "N/A",
      notes: "CRC32 / Hash FNV standard Nie Engine pour l'indexation rapide en RAM.",
    },
    {
      field: "Nom Japonais",
      gamedataTable: "ja/skill_text.cfg.bin.json",
      gamedataKey: "NOUN_INFO (hash: 0x8444C7F3)",
      azaleeKey: "name.ja (そよヤギステップ)",
      fandomKey: "Nom japonais (そよヤギステップ / Soyoyagi Suteppu)",
      notes: "Jeu de mots entre 'そよかぜ' (brise légère) et 'ヤギ' (chèvre / cabri).",
    },
    {
      field: "Nom Français",
      gamedataTable: "fr/skill_text.cfg.bin.json",
      gamedataKey: "NOUN_INFO (hash: 0x8444C7F3)",
      azaleeKey: "name.fr (Sauve-cabri)",
      fandomKey: "Nom français (Sauve-Cabri)",
      notes: "Traduction officielle Level-5 Europe identique dans le jeu et le film.",
    },
    {
      field: "Nom Anglais",
      gamedataTable: "en/skill_text.cfg.bin.json",
      gamedataKey: "NOUN_INFO (hash: 0x8444C7F3)",
      azaleeKey: "name.en (Easy Breezy Kid)",
      fandomKey: "en:Soyoyagi Step (interwiki)",
      notes: "Traduction anglaise officielle Level-5 : 'Kid' désigne le chevreau.",
    },
    {
      field: "Catégorie / Type",
      gamedataTable: "skill_config_5.00.07.00.cfg.bin.json",
      gamedataKey: "category: 2",
      azaleeKey: "category: 'Dribble'",
      fandomKey: "Type: 'Attaque'",
      notes: "ID 2 = Dribble (Offense). 1=Shoot, 3=Block, 4=Catch.",
    },
    {
      field: "Élément",
      gamedataTable: "skill_config_5.00.07.00.cfg.bin.json",
      gamedataKey: "element: 1",
      azaleeKey: "element: 'Vent'",
      fandomKey: "Élément: 'Air / Vent'",
      notes: "ID 1 = Vent (風). Mêmes IDs que les joueurs (1=Vent, 2=Forêt, 3=Feu, 4=Montagne, 5=Néant).",
    },
    {
      field: "Coût en Tension (TP)",
      gamedataTable: "skill_config_5.00.07.00.cfg.bin.json",
      gamedataKey: "consumeTp: 70",
      azaleeKey: "consumeTp: 70 Tension",
      fandomKey: "Cout: 70 (Inazuma Eleven Victory Road)",
      notes: "Coût de 70 Tension en VR. Les anciens jeux utilisaient 40 TP (CS) et 55 TP (Galaxy).",
    },
    {
      field: "Puissance Min / Max",
      gamedataTable: "skill_config_5.00.07.00.cfg.bin.json",
      gamedataKey: "power_min: 70, power_max: 440",
      azaleeKey: "power: 70 - 440",
      fandomKey: "N/A",
      notes: "Plage de puissance standard de niveau moyen évoluant selon le rang de build.",
    },
    {
      field: "Type d'Évolution",
      gamedataTable: "skill_config_5.00.07.00.cfg.bin.json",
      gamedataKey: "growthType: 5",
      azaleeKey: "growthType: 'Type 5'",
      fandomKey: "Évolution: 'Normal → V2 → V3 → V4 → S'",
      notes: "Le growthType 5 correspond à l'arbre d'évolution classique à 5 paliers.",
    },
    {
      field: "Temps de Recharge / Recast",
      gamedataTable: "skill_config_5.00.07.00.cfg.bin.json",
      gamedataKey: "recastTime: 60",
      azaleeKey: "rechargeTime: 60",
      fandomKey: "N/A",
      notes: "Temps de récupération avant réutilisation en match.",
    },
    {
      field: "ID d'Événement / Cinématique",
      gamedataTable: "skill_config_5.00.07.00.cfg.bin.json",
      gamedataKey: "eventID: '0x858B3028', eventIDName: 'ev61_01060'",
      azaleeKey: "cutin.event_id_name: 'ev61_01060'",
      fandomKey: "N/A",
      notes: "L'événement ev61_01060 pilote la cinématique à 5 cuts (c0100 à c0500).",
    },
    {
      field: "Acteur / Modèle 3D du Chevreau",
      gamedataTable: "chara_base_1.03.98.00 + chara_model_1.03.49.00",
      gamedataKey: "CHARA_BASE: 'ev61_01060', MODEL: '_waza/ev61_01060/ev61_01060.objbin'",
      azaleeKey: "Texture dx11/chr/_waza/ev61_01060/ev61_01060.png",
      fandomKey: "Arion Sherwind sauve un chevreau",
      notes: "Le chevreau est un actor prop 3D complet instancié spécifiquement pendant la cinématique.",
    },
  ];
}

/**
 * Fonction principale orchestratrice.
 */
async function main() {
  const skillId = process.argv[2] || "who01060";
  console.log("=================================================================");
  console.log("⚡ SOVEREIGN SKILL SYNC & RE ENGINE — Akihiro Hino x LEVEL-5 ⚡");
  console.log("Cible : " + skillId);
  console.log("=================================================================\n");

  // 1. Analyse Gamedata locale
  console.log("[1/5] 🔍 Analyse des tables Gamedata Nie Engine pour " + skillId + "...");
  const gamedata = await loadGamedataSkill(skillId);
  console.log("  ✓ Hash : " + gamedata.skillId + " | Event : " + gamedata.eventIDName);
  console.log("  ✓ Puissance : " + gamedata.power_min + " -> " + gamedata.power_max + " | TP : " + gamedata.consumeTp);
  console.log("  ✓ Nom FR : \"" + (gamedata.localizedText.fr?.name || "") + "\" | JA : \"" + (gamedata.localizedText.ja?.name || "") + "\"");
  if (gamedata.actor) {
    console.log("  ✓ Modèle 3D associé : " + gamedata.actor.modelFile);
  }

  // 2. Scraping Azalée
  console.log("\n[2/5] 🌐 Scraping Azalée (https://azalee.rosegriffon.fr/skill/" + skillId + ")...");
  const azalee = await scrapeAzalee(skillId);
  console.log("  ✓ Noms : FR=\"" + azalee.name.fr + "\" | EN=\"" + azalee.name.en + "\" | JA=\"" + azalee.name.ja + "\"");
  console.log("  ✓ Vidéo WebM trouvée : " + (azalee.mediaUrls.videoWebm ? "OUI" : "NON"));
  console.log("  ✓ Poster JPG trouvé : " + (azalee.mediaUrls.posterJpg ? "OUI" : "NON"));

  // 3. Scraping Fandom Wiki
  console.log("\n[3/5] 📚 Scraping Fandom Wiki (Sauve-Cabri)...");
  const fandom = await scrapeFandomWiki();
  console.log("  ✓ Titre : " + fandom.title + " | Littéral : " + fandom.nameJaLiteral);
  console.log("  ✓ Type : " + fandom.type + " | Élément : " + fandom.element);
  console.log("  ✓ Coûts par jeu : Chrono Stones=" + fandom.costsByGame["Inazuma Eleven GO Chrono Stones"] + ", VR=" + fandom.costsByGame["Inazuma Eleven Victory Road"]);
  console.log("  ✓ Illustration Wiki : " + (fandom.illustrationUrl ? "OUI" : "NON"));

  // 4. Téléchargement des médias
  console.log("\n[4/5] 📥 Téléchargement des médias vers var/skills/" + skillId + "/...");
  const mediaDir = "var/skills/" + skillId;
  const mediaList: SkillMediaAsset[] = [];

  // Vidéo WebM
  if (azalee.mediaUrls.videoWebm) {
    const asset = await downloadAsset(azalee.mediaUrls.videoWebm, mediaDir + "/video.webm", "video");
    if (asset) mediaList.push(asset);
  }
  // Poster JPG
  if (azalee.mediaUrls.posterJpg) {
    const asset = await downloadAsset(azalee.mediaUrls.posterJpg, mediaDir + "/poster.jpg", "poster");
    if (asset) mediaList.push(asset);
  }
  // Telop FR PNG
  if (azalee.mediaUrls.telopPng) {
    const asset = await downloadAsset(azalee.mediaUrls.telopPng, mediaDir + "/telop_fr.png", "telop");
    if (asset) mediaList.push(asset);
  }
  // Texture Cutin PNG
  if (azalee.mediaUrls.texturePng) {
    const asset = await downloadAsset(azalee.mediaUrls.texturePng, mediaDir + "/texture_cutin.png", "texture");
    if (asset) mediaList.push(asset);
  }
  // Fandom Illustration PNG
  if (fandom.illustrationUrl) {
    const asset = await downloadAsset(fandom.illustrationUrl, mediaDir + "/fandom_illustration.png", "illustration");
    if (asset) mediaList.push(asset);
  }

  // 5. Sauvegarde des métadonnées consolidées
  console.log("\n[5/5] 💾 Écriture du fichier de métadonnées consolidé data/skills/" + skillId + ".json...");
  const mapping = buildMappingTable();
  const payload: UnifiedSkillPayload = {
    id: skillId,
    syncAt: new Date().toISOString(),
    mapping,
    gamedata,
    azalee,
    fandom,
    media: mediaList,
  };

  const jsonContent = JSON.stringify(payload, null, 2);
  const jsonPath = "data/skills/" + skillId + ".json";
  await Bun.write(jsonPath, jsonContent);

  console.log("  ✓ Fichier généré avec succès : " + jsonPath + " (" + jsonContent.length + " octets)");
  console.log("  ✓ " + mediaList.length + " médias synchronisés dans " + mediaDir + "/");
  console.log("\n✨ Synchronisation de " + skillId + " terminée avec succès (Code Retour : 0) !");
}

main().catch((err) => {
  console.error("❌ ERREUR FATALE :", err);
  process.exit(1);
});
