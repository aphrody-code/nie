namespace IECODE.Core.Dump;

/// <summary>
/// Presets de sélection pour le dump : globs sur le chemin interne (cpk_list).
/// ⚠️ Les chemins cpk_list sont préfixés `data/` (ex. `data/common/gamedata/...`,
/// `data/dx11/...`) et le matching est ancré `^...$` → tous les globs des presets
/// DOIVENT inclure ce préfixe, sinon ils matchent 0 fichier.
/// Allowlist PRÉCIS des seules catégories nécessaires (pas de map/event/movie/…),
/// + déduplication des chemins (base/patch) côté DumpService.
/// </summary>
public static class DumpPresets
{
    /// <summary>
    /// Catégories `common/gamedata/*` réellement chargées par inagle (Game Data API).
    /// Exclut volontairement : event, movie, rpg_battle, friendmap, dungeon, mission,
    /// ai, command, motion, weather, staffroll, etc. (jamais lus).
    /// </summary>
    private static readonly string[] InagleGamedataCategories =
    [
        "boost_grp", "capsule", "character", "chat_emote", "dictionary", "extend_story",
        "formation", "gallery", "inacode", "item", "nfc", "party", "phase",
        "players_universe", "quest", "scene_archive", "skill", "soccer", "team",
        "trophy", "user_name_plate",
    ];

    /// <summary>Globs gamedata inagle (une entrée précise par catégorie).</summary>
    private static string InagleGamedata =>
        string.Join(",", InagleGamedataCategories.Select(c => $"data/common/gamedata/{c}/**"));

    /// <summary>Textes localisés (loadCharaText, etc.).</summary>
    private const string Text = "data/common/text/**";

    /// <summary>
    /// Assets graphiques azalee (textures G4TX). `dx11/**` = textures rendues, dont
    /// tout `dx11/menu/**` réellement consommé par azalee :
    ///   - `icon_chr/{face,uniform}` + auras `icon_chr/aura_{fs,soul,armed,mixi}` et
    ///     miximax `icon_chr/aura_mixi[_c*]` (icônes carrées 256x256 du wiki /aura),
    ///   - `200_icon/{01_icon_emblem,02_icon_item}` (emblèmes équipes, icônes objets),
    ///   - `220_img/telop_waza/{fr,en}` (bandeaux telop 1728x352 des techniques ET des
    ///     auras — liaison auras/techniques de la fiche joueur, cf. azalee resolveAuraTelopUrl).
    /// `chr/**` = ressources persos brutes (coachs, spirits, …) qu'azalee n'adresse pas
    /// via dx11 ; conservé pour ne rien perdre.
    /// </summary>
    private const string AzaleeAssets = "data/dx11/**,data/chr/**";

    /// <summary>
    /// Presets nommés → globs (séparés par des virgules ; un glob préfixé `!` exclut).
    /// </summary>
    public static readonly IReadOnlyDictionary<string, string> Presets =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["inagle"] = $"{InagleGamedata},{Text}",
            ["azalee"] = $"{InagleGamedata},{AzaleeAssets}",
            ["inagle-azalee"] = $"{InagleGamedata},{Text},{AzaleeAssets}",
        };

    /// <summary>Résout un nom de preset en globs (null si inconnu).</summary>
    public static string? Resolve(string? preset) =>
        !string.IsNullOrWhiteSpace(preset) && Presets.TryGetValue(preset, out var globs) ? globs : null;

    /// <summary>Noms de presets disponibles (pour l'aide CLI).</summary>
    public static string Names => string.Join(", ", Presets.Keys);
}
