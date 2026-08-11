using System.Runtime.InteropServices;

namespace IECODE.Core.Game.PassiveSkills;

// ============================================================================
// REMARQUE D'AUDIT (anti-hallucination)
//
// Les structures et tables ci-dessous sont alignées sur le layout RÉEL vérifié
// contre inagle (packages/inagle/src/parsers/passive-skill-config.ts) et les octets
// du dump (skill/passive_skill_config_*.cfg.bin + passive_skill_effect_config.cfg.bin,
// échantillonnés via les .cfg.bin.json).
//
// CE QUI A ÉTÉ RETIRÉ car FABRIQUÉ (aucune assise dans le dump ni inagle) :
//  - enum PassiveSkillBuildType : le champ [4] de PASSIVE_SKILL_INFO est la RARETÉ
//    (valeurs 6/9 observées), pas un « build type » (les libellés japonais
//    Knockout/Tension/Counter/Kizuna/RoughPlay/Justice étaient inventés).
//  - enum PassiveSkillEffectType + PassiveSkillHashes : la table PASSIVE_SKILL_EFFECT
//    contient 79 hashes d'effet distincts, pas 8 ; les libellés KICK/GUARD/CATCH/…
//    et les fourchettes « 50%-150% » étaient une taxonomie inventée. On conserve les
//    hashes bruts d'effet sans leur coller de nom de stat non vérifié.
//  - enums PassiveSkillTiming / PassiveSkillTarget et structs PassiveSkillCondition /
//    PassiveSkillEffectData / PassiveSkillGrandTotalInfo : ils décrivaient une
//    arborescence PASSIVE_SKILL_EFFECT_INFO_LIST_BEG / EXEC_TIMING_DATA / TARGET_DATA /
//    GRAND_TOTAL_INFO qui N'EXISTE PAS. Le fichier passive_skill_effect_config réel ne
//    contient que m_soccerPassiveSkillEffect{,Info,Range}List (effectId + 8 params float).
// ============================================================================

/// <summary>
/// Entrée PASSIVE_SKILL_INFO_{N} de passive_skill_config.cfg.bin.
/// </summary>
/// <remarks>
/// Layout vérifié (inagle collectSkills + dump : PASSIVE_SKILL_INFO_0 =
/// [975948532, 1105141741, 0, 0, 6, 0]) :
///   [0] passiveId (hash), [1] effectId (hash → table d'effets),
///   [2] nameId (hash texte), [3] descId (hash texte), [4] rareté, [5] = 0.
/// </remarks>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct PassiveSkillInfo
{
    /// <summary>Hash du talent passif (CRC32).</summary>
    public uint PassiveHash;

    /// <summary>Hash de l'effet lié.</summary>
    public uint EffectHash;

    /// <summary>Hash du nom (table texte localisée).</summary>
    public uint NameHash;

    /// <summary>Hash de la description (table texte localisée).</summary>
    public uint DescHash;

    /// <summary>Rareté (valeurs 6 et 9 observées dans le dump).</summary>
    public int Rarity;

    /// <summary>Champ réservé (toujours 0 dans le dump).</summary>
    public int Reserved;
}

/// <summary>
/// Référence d'effet PASSIVE_SKILL_INFO_REF_EFFECT_{N} (index local + nombre).
/// </summary>
/// <remarks>
/// Layout vérifié (dump : REF_EFFECT_0 = [0, 1]). Ce sont des index/compteurs locaux
/// au regroupement, PAS le hash d'effet (celui-ci est dans PASSIVE_SKILL_INFO [1]).
/// </remarks>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct PassiveSkillEffectRef
{
    /// <summary>Index/offset local (0 dans le 1er échantillon).</summary>
    public int Index;

    /// <summary>Nombre d'effets référencés (1 dans le 1er échantillon).</summary>
    public int Count;
}

/// <summary>
/// Référence d'icône PASSIVE_SKILL_INFO_REF_BUFF_ICON_{N} (index local + nombre).
/// </summary>
/// <remarks>Layout vérifié (dump : REF_BUFF_ICON_0 = [0, 1]).</remarks>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct PassiveSkillBuffIconRef
{
    /// <summary>Index/offset local.</summary>
    public int Index;

    /// <summary>Nombre d'icônes référencées.</summary>
    public int Count;
}

/// <summary>
/// Effet brut PASSIVE_SKILL_EFFECT_{N} de passive_skill_config.cfg.bin.
/// </summary>
/// <remarks>
/// Layout vérifié (inagle collectEffects + dump : PASSIVE_SKILL_EFFECT_0 =
/// [0x8A52A068, Float 0.5, sentinelle ×7]) :
///   [0] effectId (hash), [1] param principal (souvent Float), [2..8] params
///   additionnels — non utilisés mis à la sentinelle 0xC4C43E1A (-992181094).
/// 79 hashes d'effet distincts existent : aucun libellé de stat n'est inféré ici.
/// </remarks>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct PassiveSkillEffect
{
    /// <summary>Hash de l'effet (CRC32).</summary>
    public uint EffectHash;

    /// <summary>Premier paramètre, stocké en float (ex. 0.5, 1.2…).</summary>
    public float Param1;

    /// <summary>Valeur sentinelle des paramètres inutilisés (0xC4C43E1A = -992181094).</summary>
    public const int SentinelValue = -992181094;
}

/// <summary>
/// Définition complète d'un talent passif (info + références + textes résolus).
/// </summary>
public class PassiveSkillDefinition
{
    /// <summary>ID local (index dans la table PASSIVE_SKILL_INFO_{id}).</summary>
    public int Id { get; set; }

    /// <summary>Info principale.</summary>
    public PassiveSkillInfo Info { get; set; }

    /// <summary>Référence d'icône de buff (index/compteur locaux).</summary>
    public PassiveSkillBuffIconRef BuffIconRef { get; set; }

    /// <summary>Référence d'effet (index/compteur locaux).</summary>
    public PassiveSkillEffectRef EffectRef { get; set; }

    /// <summary>Nom résolu (table texte).</summary>
    public string? Name { get; set; }

    /// <summary>Description résolue (table texte).</summary>
    public string? Description { get; set; }
}
