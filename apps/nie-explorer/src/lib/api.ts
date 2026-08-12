// Façade typée au-dessus des commandes Tauri — délègue à `src/lib/bindings.ts`, généré par
// `tauri-specta` depuis les VRAIES signatures Rust de `src-tauri/src/lib.rs` (attribut
// `#[specta::specta]` sur chaque commande, régénéré à chaque `cargo tauri dev`). Avant, ce
// fichier était un miroir tenu À LA MAIN (`invoke<T>("cmd", {...})`) qui pouvait diverger de
// `lib.rs` en silence à chaque commande ajoutée/modifiée, sans qu'aucun outil ne le signale — cf.
// demande utilisateur « Tauri Specta… ça éliminerait ce doublon et les erreurs de synchro ».
//
// Ce module ne fait que deux choses au-dessus de `commands.*` :
// 1. Ré-adapter la forme d'erreur `tauri-specta` (`{status:"ok"|"error", data|error}`) vers une
//    promesse classique qui REJETTE sur erreur (`unwrap`) — pour ne rien changer aux ~8
//    composants qui font déjà `try { await api.foo() } catch (e) { toast.error(String(e)) }`.
// 2. Convertir `gameDir?: string` (ergonomie historique de l'UI, chaîne vide = auto-détection)
//    vers `string | null` (forme exacte attendue par les bindings générés).
import {
  commands,
  type ActivityDto,
  type AuraDto,
  type BelongTeamDto,
  type BlenderSceneResultDto,
  type CharaPickerDto,
  type CpkExportFileDto,
  type EmblemDto,
  type EntryDto,
  type FolderRoleDto,
  type FormationDto,
  type GalleryDto,
  type ItemDto,
  type LsDto,
  type PackFileDto,
  type QuestDto,
  type RawCpkEntryDto,
  type ReDumpHitDto,
  type ReDumpInfoDto,
  type ReDumpScanDto,
  type ReTraceDumpStatsDto,
  type ReTraceProcessDto,
  type ReTraceRegionDto,
  type LuaChunkInfoDto,
  type LuaExecResultDto,
  type LuaGlobalDto,
  type LuaSessionGlobalDto,
  type LuaDrainDto,
  type LuaApiReportDto,
  type McpInstallDto,
  type McpStatusDto,
  type McpTarget,
  type MotionClipDto,
  type MotionClipsDto,
  type PassiveDto,
  type SaveBlobDto,
  type ShopDto,
  type SpecialTacticsDto,
  type StadiumDto,
  type SkillDto,
  type StatBlockDto,
  type StatsDto,
  type TrickDto,
  type TrophyDto,
  type UniformDto,
  type ViolaMergeDto,
  type ViolaPackDto,
  type ViolaPlatform,
} from "@/lib/bindings";

/** Résultat d'un décodage typé — voir `api.vfsDecodeCfgbinTyped`. */
export type CfgbinTyped = {
  /** Clé de famille dérivée du nom de fichier (`skill_config`…). */
  cle: string;
  /** Étiquette du parseur qui a répondu, `null` si aucun. */
  famille: string | null;
  /** Données typées sérialisées, vide si `famille` est `null`. */
  json: string;
  /** Forme générique du conteneur — toujours présente. */
  brut: string;
};

export type VfsEntry = EntryDto;
export type FolderRole = FolderRoleDto;
export type LsResult = LsDto;
export type BlenderSceneResult = BlenderSceneResultDto;
export type VfsStats = StatsDto;
export type SaveBlobInfo = SaveBlobDto;
export type RawCpkEntry = RawCpkEntryDto;
export type PackFile = PackFileDto;
export type Skill = SkillDto;
export type Item = ItemDto;
export type Aura = AuraDto;
export type Trophy = TrophyDto;
export type Quest = QuestDto;
export type LuaChunkInfo = LuaChunkInfoDto;
export type McpStatus = McpStatusDto;
export type McpInstall = McpInstallDto;
export type { McpTarget };
export type LuaSessionGlobal = LuaSessionGlobalDto;
export type LuaDrain = LuaDrainDto;
export type LuaApiReport = LuaApiReportDto;
export type LuaExecResult = LuaExecResultDto;
export type LuaGlobal = LuaGlobalDto;
export type Shop = ShopDto;
export type Stadium = StadiumDto;
export type Passive = PassiveDto;
export type SpecialTactics = SpecialTacticsDto;
export type Emblem = EmblemDto;
export type Gallery = GalleryDto;
export type Trick = TrickDto;
export type Activity = ActivityDto;
export type BelongTeam = BelongTeamDto;
export type Formation = FormationDto;
export type Uniform = UniformDto;
export type CharaPicker = CharaPickerDto;
export type StatBlock = StatBlockDto;
export type CpkExportFile = CpkExportFileDto;
export type ReTraceProcess = ReTraceProcessDto;
export type ReTraceRegion = ReTraceRegionDto;
export type ReTraceDumpStats = ReTraceDumpStatsDto;
export type ReDumpInfo = ReDumpInfoDto;
export type ReDumpHit = ReDumpHitDto;
export type ReDumpScan = ReDumpScanDto;
export type MotionClip = MotionClipDto;
export type MotionClips = MotionClipsDto;

const gd = (gameDir?: string): string | null => (gameDir && gameDir.trim() ? gameDir : null);

/** Réadapte `{status:"ok",data}|{status:"error",error}` (tauri-specta) en promesse classique
 * (résout avec `data`, rejette avec `error`) — même contrat que l'ancien `invoke<T>()` direct.
 * `data: unknown` en entrée (pas `T`) : accepte aussi bien les commandes typées (`EntryDto[]`…)
 * que les commandes `RawJson`/`unknown` (résolveur azalee, `save_open` — cf. commentaire `RawJson`
 * dans `lib.rs`), dont la forme réelle est fixée ici par les interfaces `Remote*`/`SaveSummary`,
 * exactement comme l'ancien `invoke<T>()` ne la vérifiait pas non plus au runtime. */
async function unwrap<T>(p: Promise<{ status: "ok"; data: unknown } | { status: "error"; error: string }>): Promise<T> {
  const r = await p;
  if (r.status === "error") throw new Error(r.error);
  return r.data as T;
}

export const api = {
  defaultGameDir: () => commands.defaultGameDir(),
  checkGameDir: (game_dir: string) => commands.checkGameDir(game_dir),
  // Miroir wiki (`supabase-*.sqlite`) auto-détecté (NIE_WIKI_DB/SQLITE_DB_PATH, ou
  // `<jeu>/var/wiki-mirror/` le plus récent) — `null` si rien n'est trouvé.
  defaultWikiDb: (gameDir?: string) => commands.defaultWikiDb(gd(gameDir)),
  // `var/niers.sqlite` — base RE (fonctions/classes RTTI/xrefs), cf. `src/lib/reDb.ts`.
  defaultReDb: (gameDir?: string) => commands.defaultReDb(gd(gameDir)),
  // Force le (re)chargement du VFS en cache côté Rust — appelé une fois au montage de l'appli
  // pour amortir l'indexation AVANT la première navigation (cf. `VfsState` côté Rust).
  preloadVfs: (gameDir?: string) => unwrap<VfsStats>(commands.preloadVfs(gd(gameDir))),

  ls: (prefix: string, gameDir?: string) => unwrap<LsResult>(commands.vfsLs(prefix, gd(gameDir))),
  find: (query: string, ext: string | undefined, limit: number, gameDir?: string) =>
    unwrap<VfsEntry[]>(commands.vfsFind(query, ext || null, limit, gd(gameDir))),
  stats: (gameDir?: string) => unwrap<VfsStats>(commands.vfsStats(gd(gameDir))),
  // Métadonnées d'une seule entrée (dont `cpk`, pour savoir si elle est "loose" → éditable en
  // place, cf. `writeB64`) — `null` si le chemin n'existe pas dans le VFS.
  entryMeta: (path: string, gameDir?: string) => unwrap<VfsEntry | null>(commands.vfsEntryMeta(path, gd(gameDir))),
  describe: (path: string, gameDir?: string) => unwrap<string[]>(commands.vfsDescribe(path, gd(gameDir))),
  readB64: (path: string, gameDir?: string, maxBytes?: number) =>
    unwrap<string>(commands.vfsReadB64(path, gd(gameDir), maxBytes ?? null)),
  texturePngB64: (path: string, gameDir?: string) => unwrap<string>(commands.vfsTexturePngB64(path, gd(gameDir))),
  extractTo: (path: string, dest: string, gameDir?: string) => unwrap<number>(commands.vfsExtractTo(path, dest, gd(gameDir))),
  // Écriture EN PLACE (pas un export) — uniquement pour les entrées "loose" (`cpk: ""`, cf.
  // `VfsEntry.cpk`) : refusé côté Rust pour toute entrée empaquetée dans un CPK.
  writeB64: (path: string, dataB64: string, gameDir?: string) => unwrap<number>(commands.vfsWriteB64(path, dataB64, gd(gameDir))),
  // Override loose d'une entrée normalement CPK-packed — comportement réel de nie.exe NON
  // CONFIRMÉ par RE (le jeu peut ignorer ce fichier), cf. commentaire Rust `vfs_write_loose_override_b64`.
  writeLooseOverrideB64: (path: string, dataB64: string, gameDir?: string) =>
    unwrap<number>(commands.vfsWriteLooseOverrideB64(path, dataB64, gd(gameDir))),
  saveBytesB64: (dest: string, dataB64: string) => unwrap<number>(commands.saveBytesB64(dest, dataB64)),
  related: (needle: string, limit: number, gameDir?: string) =>
    unwrap<VfsEntry[]>(commands.vfsRelated(needle, limit, gd(gameDir))),
  // Scan complet du VFS (~255 800 entrées) — pour `vfsIndexDb.reindex`, pas d'usage direct UI.
  allEntries: (gameDir?: string) => unwrap<VfsEntry[]>(commands.vfsAllEntries(gd(gameDir))),
  // Variante annulable/avec progression du scan complet (nie-tasks) — cf. `vfsIndexDb.reindex`.
  indexScanStart: (gameDir?: string) => unwrap<string>(commands.vfsIndexScanStart(gd(gameDir))),
  indexScanCancel: (taskId: string) => unwrap<null>(commands.vfsIndexScanCancel(taskId)),
  indexScanTake: (taskId: string) => unwrap<VfsEntry[]>(commands.vfsIndexScanTake(taskId)),

  takePendingOpen: () => commands.takePendingOpen(),
  // Resynchronise le chrome natif (Mica) sur le thème clair/sombre choisi — cf. `App.tsx`.
  setTitlebarTheme: (dark: boolean) => unwrap<null>(commands.setTitlebarTheme(dark)),
  describeDiskFile: (path: string) => unwrap<string[]>(commands.describeDiskFile(path)),
  readDiskFileB64: (path: string, maxBytes?: number) => unwrap<string>(commands.readDiskFileB64(path, maxBytes ?? null)),
  // Existence d'un fichier disque arbitraire, hors portée fs:scope JS (Ctrl+V presse-papiers).
  diskFileExists: (path: string) => commands.diskFileExists(path),
  // Copie un fichier disque arbitraire (source hors fs:scope JS) vers AppData (Ctrl+V presse-papiers).
  copyDiskFileToAppdata: (src: string, destAppdataRel: string) => unwrap<number>(commands.copyDiskFileToAppdata(src, destAppdataRel)),
  // Remplace la texture d'un .g4tx mono-texture par un PNG (§2.2) — écrit dans le mod, jamais le jeu.
  stageTextureReplacement: (vfsPath: string, pngSrcPath: string, destAppdataRel: string, gameDir?: string) =>
    unwrap<number>(commands.stageTextureReplacement(vfsPath, pngSrcPath, destAppdataRel, gd(gameDir))),
  // Exporte un mod en .cpk autonome, non chiffré/non compressé (§1.2) — cf. nie_formats::cpk_encode.
  exportModAsCpk: (files: CpkExportFile[], dest: string) => unwrap<number>(commands.exportModAsCpk(files, dest)),

  openInBlender: (path: string, blenderExe?: string, gameDir?: string) =>
    unwrap<string>(commands.openInBlender(path, blenderExe || null, gd(gameDir))),
  // Installation PERSISTANTE de l'extension (dossier d'addons Blender réel + raw_data_root lié
  // au vrai <jeu>/data, survit à un Blender relancé sans passer par nie-explorer) — distinct de
  // openInBlender (bootstrap sys.path transitoire, un seul process).
  installNiersBlenderAddon: (blenderExe?: string, gameDir?: string) =>
    unwrap<string>(commands.installNiersBlenderAddon(blenderExe || null, gd(gameDir))),

  // Pont Blender ↔ niers : importer un .blend existant dans nie-explorer (aperçu headless) et
  // construire une VRAIE scène (personnage + cut-in de technique, assets VFS réels uniquement).
  blenderPreviewPngB64: (path: string, blenderExe?: string) =>
    unwrap<string>(commands.blenderPreviewPngB64(path, blenderExe || null)),
  blenderOpenScene: (path: string, blenderExe?: string) =>
    unwrap<null>(commands.blenderOpenScene(path, blenderExe || null)),
  blenderBuildSkillScene: (internalCode: string, skillQuery: string, blenderExe?: string, gameDir?: string) =>
    unwrap<BlenderSceneResultDto>(commands.blenderBuildSkillScene(internalCode, skillQuery, blenderExe || null, gd(gameDir))),

  // Presse-papiers FICHIERS natif Windows (CF_HDROP réel — ce que Ctrl+C/Ctrl+V dans
  // l'Explorateur Windows lisent/écrivent), inspiré de cosmic-files (`clipboard.rs`, recherche
  // 2026-08-08 « inspire-toi de cosmic-files pour... les interactions OS/filesystem »). Distinct
  // du presse-papiers TEXTE (`@tauri-apps/plugin-clipboard-manager`, `writeText`/`readText`,
  // toujours utilisé en repli pour un simple chemin copié en texte).
  clipboardWriteFileList: (paths: string[]) => unwrap<null>(commands.clipboardWriteFileList(paths)),
  clipboardReadFileList: () => commands.clipboardReadFileList(),
  trashAppdataFiles: (appdataRelPaths: string[]) => unwrap<null>(commands.trashAppdataFiles(appdataRelPaths)),

  // Résolveur distant azalee — contrat RÉEL confirmé (`https://azalee.rosegriffon.fr`,
  // GraphQL `graphql-yoga` sans auth + REST `/api/cpk`/`/api/save/resolve-roster`), pas une
  // convention devinée. `baseUrl` vide → azalee.rosegriffon.fr (défaut côté Rust). Les 3 renvoient
  // du JSON libre côté Rust (`RawJson`, exporté `unknown` — `serde_json::Value` est récursif,
  // cf. commentaire `RawJson` dans `lib.rs`) : la forme réelle est fixée ici par ces interfaces,
  // comme avant (l'ancien `invoke<T>()` ne la vérifiait pas non plus au runtime).
  remoteSearchChara: (baseUrl: string, query: string) => unwrap<RemoteCharaData>(commands.remoteSearchChara(baseUrl, query)),
  remoteSearchWaza: (baseUrl: string, query: string) => unwrap<RemoteWazaData>(commands.remoteSearchWaza(baseUrl, query)),
  remoteCpkSearch: (baseUrl: string, query: string) =>
    unwrap<{ query: string; count: number; files: RemoteCpkFile[] }>(commands.remoteCpkSearch(baseUrl, query)),
  // `ids` : IDs numériques du roster local (`SaveSummary.roster.owned[].id`) — convertis en
  // chaînes ici, seule forme acceptée par la commande Rust (`Vec<String>`, qui les relaie tels
  // quels au REST azalee `{ids: string[]}`). BUG réel trouvé par la migration tauri-specta : le
  // miroir `invoke<T>()` précédent déclarait `ids: number[]` sans jamais convertir → chaque appel
  // envoyait des nombres là où Rust attendait des chaînes, donc une erreur de désérialisation
  // systématique (silencieuse, `resolveRoster()` dans `SaveView` échouait toujours en pratique).
  remoteResolveRoster: (baseUrl: string, ids: number[]) =>
    unwrap<{ resolved: RemoteRosterEntry[]; matched: number; total: number }>(
      commands.remoteResolveRoster(baseUrl, ids.map(String)),
    ),

  videoPreviewB64: (path: string, gameDir?: string) => unwrap<string>(commands.vfsVideoPreviewB64(path, gd(gameDir))),
  audioPreviewB64: (path: string, gameDir?: string) => unwrap<string>(commands.vfsAudioPreviewB64(path, gd(gameDir))),
  // Parité RawCpkView (hors VFS) : même décodage audio/vidéo/3D, depuis une entrée du CPK brut ouvert.
  rawCpkAudioPreviewB64: (index: number) => unwrap<string>(commands.rawCpkAudioPreviewB64(index)),
  rawCpkVideoPreviewB64: (index: number) => unwrap<string>(commands.rawCpkVideoPreviewB64(index)),
  // Aperçu 3D d'une entrée .g4md du CPK ouvert — frères g4mg/g4tx résolus DANS ce CPK (pas le VFS),
  // cf. `assemble_glb_from_cpk_entries` côté Rust. Roadmap §6, gap fermé 2026-08-08.
  rawCpkGlbPreviewPngB64: (index: number) => unwrap<string>(commands.rawCpkGlbPreviewPngB64(index)),
  // Viewport 3D temps réel (mode Éditeur) : le GLB assemblé LUI-MÊME, pas un rendu de celui-ci
  // — la caméra vit côté frontend (three.js), plus côté Rust.
  // ── Atelier Lua (cf. `components/LuaView.tsx`) ────────────────────────────────────────────
  // Les scripts tournent dans la VRAIE VM du jeu (mlua/PUC-Rio 5.2.4, crate `nie-lua`). Chaque
  // commande prend SOIT un chemin VFS, SOIT une source éditée — jamais de fichier temporaire.
  // ── Session Lua PERSISTANTE (thread dédié côté Rust) ──────────────────────────────────────
  // Distincte des commandes ci-dessus qui repartent d'une VM neuve : ici l'état survit d'un
  // appel à l'autre — la console est un vrai REPL, et le rechargement est explicite.
  luaSessionExec: (path: string | null, source: string | null, gameDir?: string) =>
    unwrap<string[]>(commands.luaSessionExec(path, source, gd(gameDir))),
  luaSessionAttach: (path: string | null, source: string | null, gameDir?: string) =>
    unwrap<string[]>(commands.luaSessionAttach(path, source, gd(gameDir))),
  luaSessionBroadcast: (callback: string) => unwrap<number>(commands.luaSessionBroadcast(callback)),
  luaSessionEval: (expression: string) => unwrap<string>(commands.luaSessionEval(expression)),
  luaSessionSetGlobal: (name: string, expression: string) =>
    unwrap<null>(commands.luaSessionSetGlobal(name, expression)),
  luaSessionGlobals: (includeStdlib: boolean) =>
    unwrap<LuaSessionGlobal[]>(commands.luaSessionGlobals(includeStdlib)),
  luaSessionReload: () => unwrap<null>(commands.luaSessionReload()),
  luaSessionDrain: () => unwrap<LuaDrain>(commands.luaSessionDrain()),
  luaSessionApiReport: () => unwrap<LuaApiReport>(commands.luaSessionApiReport()),
  luaListScripts: (gameDir?: string) => unwrap<VfsEntry[]>(commands.luaListScripts(gd(gameDir))),
  luaChunkInfo: (path: string | null, source: string | null, gameDir?: string) =>
    unwrap<LuaChunkInfo>(commands.luaChunkInfo(path, source, gd(gameDir))),
  luaDisassemble: (path: string | null, source: string | null, gameDir?: string) =>
    unwrap<string>(commands.luaDisassemble(path, source, gd(gameDir))),
  luaExecute: (
    path: string | null,
    source: string | null,
    withMenuHost: boolean,
    instructionLimit: number | null,
    gameDir?: string,
  ) => unwrap<LuaExecResult>(commands.luaExecute(path, source, withMenuHost, instructionLimit, gd(gameDir))),
  luaGlobals: (
    path: string | null,
    source: string | null,
    withMenuHost: boolean,
    overrides: [string, string][],
    includeStdlib: boolean,
    gameDir?: string,
  ) => unwrap<LuaGlobal[]>(commands.luaGlobals(path, source, withMenuHost, overrides, includeStdlib, gd(gameDir))),
  luaEval: (
    path: string | null,
    source: string | null,
    expression: string,
    withMenuHost: boolean,
    gameDir?: string,
  ) => unwrap<string>(commands.luaEval(path, source, expression, withMenuHost, gd(gameDir))),
  glbBytesB64: (path: string, gameDir?: string) => unwrap<string>(commands.vfsGlbBytesB64(path, gd(gameDir))),
  // Clips d'animation DÉCLARÉS par les .g4mt des archives .g4pk de même radical. Liste seule : le
  // GLB de `glbBytesB64` n'embarque ni skin ni animation, rien ne peut être rejoué.
  motionClips: (path: string, gameDir?: string) => unwrap<MotionClips>(commands.vfsMotionClips(path, gd(gameDir))),
  // Éditeur de scène 3D NATIF (nie-editor : éditeur Fyrox embarqué, rendu OpenGL) — process séparé,
  // il a sa propre boucle d'événements et sa propre fenêtre GPU.
  openInSceneEditor: (path: string | null, gameDir?: string) => unwrap<string>(commands.openInSceneEditor(path, gd(gameDir))),
  rawCpkGlbBytesB64: (index: number) => unwrap<string>(commands.rawCpkGlbBytesB64(index)),
  glbPreviewPngB64: (path: string, gameDir?: string) => unwrap<string>(commands.vfsGlbPreviewPngB64(path, gd(gameDir))),
  // Turntable MP4 (§2.3, caméra orbitale via la barre de défilement vidéo) — cf. api ci-dessus.
  glbPreviewTurntableMp4B64: (path: string, gameDir?: string) => unwrap<string>(commands.vfsGlbPreviewTurntableMp4B64(path, gd(gameDir))),

  // CPK brut hors VFS — ouvre n'importe quel `.cpk` du disque (mod téléchargé, DLC séparé…) sans
  // passer par l'index du jeu. `open` remplace le CPK actuellement ouvert côté Rust (un seul à la
  // fois, cf. `RawCpkState`) ; les commandes suivantes référencent une entrée par INDEX (pas par
  // chemin : deux entrées de dossiers différents peuvent partager un nom de fichier).
  rawCpkOpen: (path: string) => unwrap<RawCpkEntry[]>(commands.openRawCpk(path)),
  rawCpkDescribe: (index: number) => unwrap<string[]>(commands.rawCpkDescribe(index)),
  rawCpkReadB64: (index: number, maxBytes?: number) => unwrap<string>(commands.rawCpkReadB64(index, maxBytes ?? null)),
  rawCpkExtractTo: (index: number, dest: string) => unwrap<number>(commands.rawCpkExtractTo(index, dest)),
  // Extrait toutes les entrées du CPK ouvert vers destDir (arborescence directory/filename
  // préservée) — renvoie [n_ok, n_err], les échecs individuels n'arrêtent pas le reste.
  rawCpkExtractAll: (destDir: string) => unwrap<[number, number]>(commands.rawCpkExtractAll(destDir)),
  // Vrais fichiers `.cpk` sous `<jeu>/data/packs/` — le VFS ne les expose jamais comme entrées
  // navigables (pont pour la navigation fusionnée VFS/CPK, cf. `ExplorerView`).
  listPacksDir: (gameDir?: string) => unwrap<PackFile[]>(commands.listPacksDir(gd(gameDir))),

  // Données de jeu STATIQUES décodées via les VRAIS parseurs typés de `nie-data` (crate déjà
  // déclarée, jamais câblée avant) — indépendant du miroir wiki azalee, lecture directe du VFS.
  gameDataSkills: (gameDir?: string) => unwrap<Skill[]>(commands.gameDataSkills(gd(gameDir))),
  gameDataItems: (gameDir?: string) => unwrap<Item[]>(commands.gameDataItems(gd(gameDir))),
  gameDataAuras: (gameDir?: string) => unwrap<Aura[]>(commands.gameDataAuras(gd(gameDir))),
  gameDataTrophies: (gameDir?: string) => unwrap<Trophy[]>(commands.gameDataTrophies(gd(gameDir))),
  gameDataQuests: (gameDir?: string) => unwrap<Quest[]>(commands.gameDataQuests(gd(gameDir))),
  // §4.1 roadmap — modules `nie-data` supplémentaires câblés (boutiques, stades, passifs, tactiques).
  gameDataShops: (gameDir?: string) => unwrap<Shop[]>(commands.gameDataShops(gd(gameDir))),
  gameDataStadiums: (gameDir?: string) => unwrap<Stadium[]>(commands.gameDataStadiums(gd(gameDir))),
  gameDataPassives: (gameDir?: string) => unwrap<Passive[]>(commands.gameDataPassives(gd(gameDir))),
  gameDataSpecialTactics: (gameDir?: string) => unwrap<SpecialTactics[]>(commands.gameDataSpecialTactics(gd(gameDir))),
  // §4.1 roadmap, second lot — familles RDBN à noms autoportés (aucune jointure texte devinée) :
  // écussons, galerie, feintes, activités (T2B), équipes (jointure `team_text` déjà validée par
  // `nie-game/examples/export_teams.rs`), formations et uniformes (identifiants bruts, leur table
  // de texte n'existe pas dans cette version du jeu).
  gameDataEmblems: (gameDir?: string) => unwrap<Emblem[]>(commands.gameDataEmblems(gd(gameDir))),
  gameDataGallery: (gameDir?: string) => unwrap<Gallery[]>(commands.gameDataGallery(gd(gameDir))),
  gameDataTricks: (gameDir?: string) => unwrap<Trick[]>(commands.gameDataTricks(gd(gameDir))),
  gameDataActivities: (gameDir?: string) => unwrap<Activity[]>(commands.gameDataActivities(gd(gameDir))),
  gameDataBelongTeams: (gameDir?: string) => unwrap<BelongTeam[]>(commands.gameDataBelongTeams(gd(gameDir))),
  gameDataFormations: (gameDir?: string) => unwrap<Formation[]>(commands.gameDataFormations(gd(gameDir))),
  gameDataUniforms: (gameDir?: string) => unwrap<Uniform[]>(commands.gameDataUniforms(gd(gameDir))),
  gameDataCharaPicker: (gameDir?: string) => unwrap<CharaPicker[]>(commands.gameDataCharaPicker(gd(gameDir))),
  // Calculateur de stats (§4.2) — rarityCode : 0=N, 2=R, 3=SR, 4=SSR, 5=UR, 6=LR, 7=Legend, 20=BASARA.
  gameDataCalculateStats: (charaParamId: string, level: number, rarityCode: number, gameDir?: string) =>
    unwrap<StatBlock>(commands.gameDataCalculateStats(charaParamId, level, rarityCode, gd(gameDir))),
  // Décodeur GÉNÉRIQUE de n'importe quel `.cfg.bin` du VFS (RDBN/T2B auto-détecté) vers la forme
  // JSON "inagle" — couvre les ~50 000 fichiers de config du jeu (vérifié réel, cf.
  // `game_data.rs` test `decode_cfgbin_sur_un_echantillon_large`), pas seulement les techniques.
  vfsDecodeCfgbin: (path: string, gameDir?: string) => unwrap<unknown>(commands.vfsDecodeCfgbin(path, gd(gameDir))),
  /**
   * Décode un `.cfg.bin` **et** le passe au parseur typé de sa famille, quand elle en a un.
   *
   * `vfsDecodeCfgbin` rend des colonnes numérotées ; ici les champs portent leur nom
   * (`consume_tp` plutôt que `var3`). `famille === null` signale qu'aucun des 112 parseurs de
   * `nie-data` ne couvre ce fichier — l'appelant retombe alors sur `brut`, toujours fourni.
   */
  vfsDecodeCfgbinTyped: (path: string, gameDir?: string) =>
    unwrap<CfgbinTyped>(commands.vfsDecodeCfgbinTyped(path, gd(gameDir))),
  // Ré-encode le JSON édité (forme "entries" T2B ou "lists" RDBN, dispatch auto) → bytes base64 —
  // à composer avec writeB64/writeLooseOverrideB64/saveBytesB64 côté appelant. `path` sert de
  // gabarit pour le patch RDBN (cf. doc Rust de `encode_cfgbin_config`), ignoré côté T2B.
  encodeCfgbinConfig: (path: string, json: string, gameDir?: string) =>
    unwrap<string>(commands.encodeCfgbinConfig(path, json, gd(gameDir))),

  // Auto-détection de la meilleure sauvegarde Steam Cloud (mtime + validité réelle) — cf. SaveView.
  defaultSavePath: () => commands.defaultSavePath(),
  saveOpen: (path: string) => unwrap<SaveSummary>(commands.saveOpen(path)),
  saveListBlobs: () => unwrap<SaveBlobInfo[]>(commands.saveListBlobs()),
  saveBlobHexB64: (index: number) => unwrap<string>(commands.saveBlobHexB64(index)),
  saveExport: (dest: string) => unwrap<number>(commands.saveExport(dest)),

  // RE en direct (`nie-trace`) — lecture SEULE de la mémoire vivante de `nie.exe`/
  // `nie_eacpatched.exe`, décision utilisatrice tranchée (cf. ROADMAP.md §4.3/§5, accord
  // RG-L5-VR-2026-001). Jamais d'écriture mémoire dans un process tiers depuis l'app.
  reTraceFindProcess: () => commands.reTraceFindProcess(),
  reTraceModuleRegions: (pid: number) => unwrap<ReTraceRegion[]>(commands.reTraceModuleRegions(pid)),
  reTraceReadBytesB64: (pid: number, addr: string, len: number) => unwrap<string>(commands.reTraceReadBytesB64(pid, addr, len)),
  reTraceDumpModule: (pid: number) => unwrap<ReTraceDumpStats>(commands.reTraceDumpModule(pid)),

  // Scan AOB HORS LIGNE (`nie-dump`) : un minidump `.dmp` déjà capturé, lu en lecture seule —
  // aucune attache au process du jeu. `reDumpScan` relit les plages du dump depuis le disque
  // (centaines de Mo) : compter plusieurs secondes, et borner par `limite` (0 = défaut côté Rust).
  reDumpOpen: (cheminDmp: string) => unwrap<ReDumpInfo>(commands.reDumpOpen(cheminDmp)),
  reDumpScan: (cheminDmp: string, motif: string, limite = 0) => unwrap<ReDumpScan>(commands.reDumpScan(cheminDmp, motif, limite)),

  // Serveur MCP `niers-game` : l'explorateur le déclare aux clients MCP (Claude Code /
  // Claude Desktop) depuis les Paramètres. C'est l'autre moitié du couple — le serveur pilote
  // en retour cette fenêtre par le pont `@niers/bridge` (cf. `lib/bridge.ts`).
  mcpStatus: (target: McpTarget) => unwrap<McpStatus>(commands.mcpStatus(target)),
  mcpInstall: (target: McpTarget, gameDir?: string) =>
    unwrap<McpInstall>(commands.mcpInstall(target, gameDir?.trim() ? gameDir.trim() : null)),

  // ── Viola : dump / pack / merge / crypto Criware (crate `nie-viola`, EN PROCESS) ───────────
  // Le dump rend un identifiant d'exécution ; son avancement arrive par les événements
  // `viola-dump-progress` / `viola-dump-done`, pas par la résolution de cette promesse.
  violaDumpStart: (
    sortie: string,
    opts: { filtre?: string; reprise?: boolean; sauterIdentiques?: boolean; threads?: number },
    gameDir?: string,
  ) =>
    unwrap<string>(
      commands.violaDumpStart(
        gd(gameDir),
        sortie,
        opts.filtre?.trim() ? opts.filtre.trim() : null,
        opts.reprise ?? true,
        opts.sauterIdentiques ?? true,
        opts.threads ?? null,
      ),
    ),
  violaCancel: (runId: string) => unwrap<null>(commands.violaCancel(runId)),
  violaPack: (cpkList: string, modDir: string, sortie: string, plateforme: ViolaPlatform) =>
    unwrap<ViolaPackDto>(commands.violaPack(cpkList, modDir, sortie, plateforme)),
  violaMerge: (sources: string[], sortie: string, semantique: boolean, gameDir?: string) =>
    unwrap<ViolaMergeDto>(commands.violaMerge(gd(gameDir), sources, sortie, semantique)),
  violaCrypto: (entree: string, sortie: string, cle?: string) =>
    unwrap<number | null>(commands.violaCrypto(entree, sortie, cle?.trim() ? cle.trim() : null)),
};

// ─── Types du GraphQL/REST azalee (contrat réel, cf. commentaire Rust `remote_search_*`) ──

interface LocalizedString {
  fr: string | null;
  en: string | null;
  ja: string | null;
}

export interface RemoteCharaVariant {
  charaParamId: string;
  position: string | null;
  element: string | null;
  rarity: string | null;
  image: string | null;
}

export interface RemoteChara {
  id: string;
  internalCode: string | null;
  name: LocalizedString;
  variants: RemoteCharaVariant[];
}

export interface RemoteCharaData {
  characters: RemoteChara[];
}

export interface RemoteWaza {
  id: string;
  name: LocalizedString;
  category: string | null;
  element: string | null;
  power: string | null;
  tension: number | null;
  image: string | null;
}

export interface RemoteWazaData {
  skills: RemoteWaza[];
}

export interface RemoteCpkFile {
  name: string;
  ext: string;
  cpk: string;
  path: string;
}

export interface RemoteRosterEntry {
  id: string;
  name: string | null;
  baseSlug: string | null;
  element: string | null;
  position: string | null;
  rarity: string | null;
}

// Miroir partiel de `nie_save::SaveSummary` (champs affichés par `SaveView`) — le reste du
// JSON (roster/team complets) est accessible tel quel si besoin, non typé ici.
export interface SaveSummary {
  slot_name: string;
  player_name: string;
  level_str: string;
  playtime_secs: number | null;
  unique_id: string;
  used_slots: number | null;
  max_slots: number | null;
  roster: { owned: { id: number; name: string | null }[]; total_slots?: number };
  [key: string]: unknown;
}
