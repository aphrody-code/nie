namespace IECODE.Core.GameData;

/// <summary>
/// Rareté d'un joueur (charaRarity de starSignCharaInfo).
/// </summary>
/// <remarks>
/// Codes et libellés vérifiés contre le parser inagle
/// (packages/inagle/src/parsers/star-sign.ts, rarityCodeToName + rarityToGrowthRank)
/// et la surface rendue par azalee (rarity_label : « Normal », « Héros », « BASARA »…).
///
/// Le champ source est <c>charaParamId → starSignCharaInfo.charaRarity</c> dans
/// les données de jeu (pas un offset mémoire). Les valeurs numériques observées :
/// 0/1 = Normal, 2 = Expérimenté, 3 = Émérite, 4 = Normal, 5/6/7 = Légendaire,
/// 10 = Héros (variantes Hero), 20 = BASARA.
///
/// Les codes 5/6/7 partagent le libellé « Légendaire » (inagle) ; ils ne sont donc
/// pas exposés comme membres distincts pour éviter d'inventer des paliers
/// (les anciens « UR / LR / Legend » et leurs comptes de personnages chiffrés
/// n'étaient adossés à aucune donnée réelle).
/// </remarks>
public enum PlayerRarity
{
    /// <summary>Normal (codes 0, 1 et 4).</summary>
    Normal = 0,

    /// <summary>Expérimenté (code 2).</summary>
    Experimente = 2,

    /// <summary>Émérite (code 3).</summary>
    Emerite = 3,

    /// <summary>Légendaire (codes 5, 6 et 7 — même libellé inagle).</summary>
    Legendaire = 5,

    /// <summary>Héros (code 10) — variantes Hero (Fire/Black/Pink).</summary>
    Heros = 10,

    /// <summary>BASARA (code 20) — palier le plus haut.</summary>
    Basara = 20
}

/// <summary>
/// Position d'un joueur sur le terrain.
/// </summary>
/// <remarks>
/// Codes vérifiés contre inagle (packages/inagle/src/parsers/chara-param.ts,
/// positionIdToCode) et le dump chara_param (variable [3] = mainPosition).
/// Le code 0 = Coach existe aussi dans positionIdToCode mais n'apparaît pas comme
/// position jouable dans les entrées CHARA_PARAM_INFO échantillonnées.
/// </remarks>
public enum PlayerPosition
{
    /// <summary>Gardien (1).</summary>
    GK = 1,

    /// <summary>Attaquant (2).</summary>
    FW = 2,

    /// <summary>Milieu (3).</summary>
    MF = 3,

    /// <summary>Défenseur (4).</summary>
    DF = 4
}

/// <summary>
/// Élément (attribut) d'un joueur.
/// </summary>
/// <remarks>
/// Codes vérifiés contre inagle (packages/inagle/src/parsers/chara-param.ts,
/// elementIdToNames) et le dump chara_param (variable [2] = element).
/// Preuves inagle : Mark Evans [2]=4 (Montagne/Mountain), Axel Blaze [2]=3 (Feu/Fire),
/// Nathan Swift [2]=1 (Vent/Wind).
/// </remarks>
public enum PlayerElement
{
    /// <summary>Vent / 風 (1).</summary>
    Wind = 1,

    /// <summary>Forêt / 林 (2).</summary>
    Forest = 2,

    /// <summary>Feu / 火 (3).</summary>
    Fire = 3,

    /// <summary>Montagne / 山 (4).</summary>
    Mountain = 4
}
