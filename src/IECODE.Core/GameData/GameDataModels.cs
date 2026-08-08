using System.Text.Json.Serialization;
using IECODE.Core.Formats.Level5.CfgBin;
using IECODE.Core.Formats.Level5.CfgBin.Logic;

namespace IECODE.Core.GameData;

/// <summary>
/// Classe de base pour les entrées de données de jeu mappées depuis des entrées CfgBin génériques.
/// </summary>
public abstract class GameDataEntry
{
    [JsonIgnore]
    public Entry OriginalEntry { get; set; }

    protected GameDataEntry(Entry entry)
    {
        OriginalEntry = entry;
        MapFromEntry(entry);
    }

    protected abstract void MapFromEntry(Entry entry);

    protected int GetInt(Entry entry, int index, int defaultValue = 0)
    {
        if (index >= entry.Variables.Count) return defaultValue;
        return entry.Variables[index].GetInt32();
    }

    protected float GetFloat(Entry entry, int index, float defaultValue = 0f)
    {
        if (index >= entry.Variables.Count) return defaultValue;
        return entry.Variables[index].GetSingle();
    }

    protected string GetString(Entry entry, int index, string defaultValue = "")
    {
        if (index >= entry.Variables.Count) return defaultValue;
        return entry.Variables[index].GetString() ?? defaultValue;
    }

    /// <summary>Convertit un int 32 bits (signé) en hash hex « 0xXXXXXXXX » (comme inagle/toHex).</summary>
    protected static string ToHex(int value) => $"0x{(uint)value:X8}";
}

public class SubtitleData : GameDataEntry
{
    public int TextIdHash { get; set; }
    public float StartTime { get; set; }
    public float EndTime { get; set; }

    public SubtitleData(Entry entry) : base(entry) { }

    protected override void MapFromEntry(Entry entry)
    {
        // EV_SUBTITLE_DATA. NON ENTIÈREMENT VÉRIFIÉ contre un parser inagle dédié
        // (inagle n'expose pas de parser sous-titres). Seuls les deux premiers champs
        // sont mappés de façon prudente ; [2] varie (Int/Float selon l'échantillon)
        // et n'est lu que s'il est de type Float pour éviter une fausse interprétation.
        TextIdHash = GetInt(entry, 0);
        StartTime = GetFloat(entry, 1);

        var v2 = entry.Variables.Count > 2 ? entry.Variables[2] : null;
        if (v2 != null && v2.Type == VariableType.Float && v2.Value is float f)
        {
            EndTime = f;
        }
    }
}

/// <summary>
/// Aura / Hyper-technique (Keshin, Totem, Miximax…) depuis aura_skill_config (nœuds AURA_CMD_INFO_*).
/// </summary>
/// <remarks>
/// Layout vérifié contre inagle (packages/inagle/src/skills/mapper-aura.ts, parseAuraCmdInfo)
/// et le dump skill/aura_skill_config_*.cfg.bin.json (AURA_CMD_INFO_0, 19 variables) :
///   [0] auraId (hash), [1] assetCode (String, ex. « wks00020 »),
///   [2] nameId (hash texte), [3] descId (hash texte),
///   [6] skillId1 (hash), [7] skillId2 (hash), [8] element (0..4),
///   [12] buffId (hash), [16] rank.
/// (L'ancien mapping EffectId/Duration/Param1/Param2 sur le préfixe AURA_CMD_UNIQUE_EFFECT
///  était une supposition : ce préfixe désigne la table d'effets, pas l'aura elle-même.)
/// </remarks>
public class AuraSkillConfig : GameDataEntry
{
    public string AuraId { get; set; } = "";
    public string AssetCode { get; set; } = "";
    public string NameId { get; set; } = "";
    public string DescId { get; set; } = "";
    public int Element { get; set; }
    public string? SkillId1 { get; set; }
    public string? SkillId2 { get; set; }
    public string? BuffId { get; set; }
    public int Rank { get; set; }

    public AuraSkillConfig(Entry entry) : base(entry) { }

    protected override void MapFromEntry(Entry entry)
    {
        AuraId = ToHex(GetInt(entry, 0));
        AssetCode = GetString(entry, 1);
        NameId = ToHex(GetInt(entry, 2));
        DescId = ToHex(GetInt(entry, 3));
        SkillId1 = HashOrNull(entry, 6);
        SkillId2 = HashOrNull(entry, 7);
        Element = GetInt(entry, 8);
        BuffId = HashOrNull(entry, 12);
        Rank = GetInt(entry, 16);
    }

    private string? HashOrNull(Entry entry, int index)
    {
        int v = GetInt(entry, index);
        return v != 0 ? ToHex(v) : null;
    }
}

/// <summary>
/// Objet consommable / équipement depuis item_config (nœuds ITEM_CONSUME_INFO_*).
/// </summary>
/// <remarks>
/// Layout vérifié contre inagle (packages/inagle/src/parsers/item-config.ts) et le dump
/// item/item_config_*.cfg.bin.json (ITEM_CONSUME_INFO_0, 18 variables) :
///   [0] itemId (hash), [2] nameId (hash texte), [3] descId (hash texte),
///   [4] price (prix d'achat), [11] internalCode (String, ex. « btl_re000001 »).
/// (L'ancienne version exposait NameId/Price/Rarity sans jamais les remplir et
///  appelait [11] « ScriptName » : corrigé en internalCode comme inagle.)
/// </remarks>
public class ItemConfig : GameDataEntry
{
    public string ItemId { get; set; } = "";
    public string NameId { get; set; } = "";
    public string DescId { get; set; } = "";
    public int Price { get; set; }
    public string? InternalCode { get; set; }

    public ItemConfig(Entry entry) : base(entry) { }

    protected override void MapFromEntry(Entry entry)
    {
        ItemId = ToHex(GetInt(entry, 0));
        NameId = ToHex(GetInt(entry, 2));
        DescId = ToHex(GetInt(entry, 3));
        Price = GetInt(entry, 4);
        InternalCode = GetString(entry, 11);
    }
}

/// <summary>
/// Fiche de base d'un personnage depuis chara_base (nœuds CHARA_BASE_INFO_*).
/// </summary>
/// <remarks>
/// Layout vérifié contre inagle (packages/inagle/src/parsers/chara-base.ts) et le dump
/// chara_base_*.cfg.bin.json (CHARA_BASE_INFO_0, 34 variables) :
///   [0] charaId (hash unique), [1] internalCode (String, ex. « npc0010 »),
///   [3] nameHash (→ chara_text NOUN_INFO), [4] lastNameHash.
/// (Le champ [1] est le code interne du personnage, pas un « ModelId » : renommé.)
/// </remarks>
public class CharacterBaseInfo : GameDataEntry
{
    public int CharacterId { get; set; }
    public string? InternalCode { get; set; }
    public int NameId { get; set; }

    public CharacterBaseInfo(Entry entry) : base(entry) { }

    protected override void MapFromEntry(Entry entry)
    {
        CharacterId = GetInt(entry, 0);
        InternalCode = GetString(entry, 1);
        NameId = GetInt(entry, 3);
    }
}

/// <summary>
/// Entrée de noms localisés (chara_text / NOUN_INFO).
/// </summary>
/// <remarks>
/// Layout vérifié contre le dump text/&lt;lang&gt;/chara_text.cfg.bin.json
/// (NOUN_INFO_0, 15 variables : [0] hash CRC32, [5] String = nom localisé,
/// ex. « Mamoru Endo »). Concorde avec l'usage chara-text d'inagle.
/// </remarks>
public class NounInfo : GameDataEntry
{
    public int Crc32 { get; set; }
    public string Name { get; set; } = "";

    public NounInfo(Entry entry) : base(entry) { }

    protected override void MapFromEntry(Entry entry)
    {
        Crc32 = GetInt(entry, 0);
        Name = GetString(entry, 5);
    }
}

/// <summary>
/// Slot de technique appris (paire niveau/hash) extrait d'un nœud CHARA_PARAM_INFO.
/// </summary>
public class CharacterSkillSlot
{
    /// <summary>Niveau d'apprentissage (0..99).</summary>
    public int LearnLevel { get; set; }

    /// <summary>Hash de la technique (hex « 0xXXXXXXXX »).</summary>
    public string SkillId { get; set; } = "";
}

/// <summary>
/// Variante (carte) d'un personnage depuis chara_param (nœuds CHARA_PARAM_INFO_*).
/// </summary>
/// <remarks>
/// Layout vérifié contre inagle (packages/inagle/src/parsers/chara-param.ts) et le dump
/// chara_param_*.cfg.bin.json (CHARA_PARAM_INFO_*, 43 variables) :
///   [0] charaParamId (hash variante), [1] charaBaseId (hash personnage de base),
///   [2] element (1..4), [3] mainPosition (1..4), [4] subPosition,
///   [8] growthPattern, puis 9 slots de techniques NIVEAU D'ABORD à partir de [10] :
///   ([10] niveau, [11] hash), ([12] niveau, [13] hash)… jusqu'à 9 slots.
///
/// IMPORTANT — chara_param NE CONTIENT PAS les statistiques (Kick/Control/Technique…).
/// L'ancien mapping [1..7] = Kick/Control/Technic/Intelligence/Pressure/Agility/Physical
/// était une HALLUCINATION : [1] est le hash du personnage de base, [2] l'élément,
/// [3] la position. Les stats viennent de growth_table_config / growthTableMain
/// (calculées par inagle via la position/pattern/rang, pas stockées ici) — donc
/// aucun champ de stat n'est exposé sur ce modèle.
/// </remarks>
public class CharacterParam : GameDataEntry
{
    /// <summary>Hash unique de la variante (clé de jointure starSign/zukan).</summary>
    public string CharaParamId { get; set; } = "";

    /// <summary>Hash du personnage de base (→ chara_base CHARA_BASE_INFO).</summary>
    public string CharaBaseId { get; set; } = "";

    /// <summary>Élément (1=Vent, 2=Forêt, 3=Feu, 4=Montagne).</summary>
    public int Element { get; set; }

    /// <summary>Position principale (1=GK, 2=FW, 3=MF, 4=DF).</summary>
    public int MainPosition { get; set; }

    /// <summary>Sous-position.</summary>
    public int SubPosition { get; set; }

    /// <summary>Pattern de croissance (entrée dans growth_table).</summary>
    public int GrowthPattern { get; set; }

    /// <summary>Techniques apprises (jusqu'à 9 slots, niveau d'abord).</summary>
    public List<CharacterSkillSlot> Skills { get; set; } = [];

    public CharacterParam(Entry entry) : base(entry) { }

    protected override void MapFromEntry(Entry entry)
    {
        CharaParamId = ToHex(GetInt(entry, 0));
        CharaBaseId = ToHex(GetInt(entry, 1));
        Element = GetInt(entry, 2);
        MainPosition = GetInt(entry, 3);
        SubPosition = GetInt(entry, 4);
        GrowthPattern = GetInt(entry, 8);

        // 9 slots, NIVEAU d'abord, à partir de [10] : niveau aux index pairs (10,12,…),
        // hash aux index impairs (11,13,…). On valide le NIVEAU (0..99), le hash pouvant
        // être n'importe quelle valeur 32 bits non nulle.
        for (int slot = 0; slot < 9; slot++)
        {
            int levelIdx = 10 + slot * 2;
            int hashIdx = 11 + slot * 2;
            if (hashIdx >= entry.Variables.Count) break;

            int skillIdNum = GetInt(entry, hashIdx);
            int learnLevel = GetInt(entry, levelIdx);

            if (skillIdNum != 0 && learnLevel >= 0 && learnLevel <= 99)
            {
                Skills.Add(new CharacterSkillSlot
                {
                    LearnLevel = learnLevel,
                    SkillId = ToHex(skillIdNum)
                });
            }
        }
    }
}

/// <summary>
/// Talent passif (ability) depuis passive_skill_config (nœuds PASSIVE_SKILL_INFO_*).
/// </summary>
/// <remarks>
/// Layout vérifié contre inagle (packages/inagle/src/parsers/passive-skill-config.ts,
/// collectSkills) et le dump skill/passive_skill_config_*.cfg.bin.json
/// (PASSIVE_SKILL_INFO_0, 6 variables Int) :
///   [0] passiveId (hash), [1] effectId (hash → passive_skill_effect_config),
///   [2] nameId (hash texte), [3] descId (hash texte), [4] rareté (6 ou 9 observés), [5] = 0.
///
/// (L'ancien modèle lisait [0]=SkillId, [1]=EffectValue(Float) : [1] est en réalité
///  l'effectId entier, pas une valeur d'effet flottante — corrigé.)
/// </remarks>
public class PassiveSkillConfig : GameDataEntry
{
    public string PassiveId { get; set; } = "";
    public string EffectId { get; set; } = "";
    public string NameId { get; set; } = "";
    public string DescId { get; set; } = "";
    public int Rarity { get; set; }

    public PassiveSkillConfig(Entry entry) : base(entry) { }

    protected override void MapFromEntry(Entry entry)
    {
        PassiveId = ToHex(GetInt(entry, 0));
        EffectId = ToHex(GetInt(entry, 1));
        NameId = ToHex(GetInt(entry, 2));
        DescId = ToHex(GetInt(entry, 3));
        Rarity = GetInt(entry, 4);
    }
}

/// <summary>
/// Entrée de texte générique (NOUN_INFO / nom-description localisé).
/// </summary>
/// <remarks>
/// Même layout que <see cref="NounInfo"/> (NOUN_INFO_*, [0] hash, [5] texte) :
/// le texte des talents/techniques est résolu via ces tables NOUN_INFO localisées.
/// </remarks>
public class PassiveSkillText : GameDataEntry
{
    public int TextId { get; set; }
    public string Text { get; set; } = "";

    public PassiveSkillText(Entry entry) : base(entry) { }

    protected override void MapFromEntry(Entry entry)
    {
        TextId = GetInt(entry, 0);
        Text = GetString(entry, 5);
    }
}
