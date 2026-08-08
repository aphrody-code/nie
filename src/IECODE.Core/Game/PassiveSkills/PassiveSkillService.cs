using IECODE.Core.Formats.Level5.CfgBin;
using IECODE.Core.Formats.Level5.CfgBin.Logic;

namespace IECODE.Core.Game.PassiveSkills;

/// <summary>
/// Service de chargement des talents passifs depuis les CFG.BIN.
/// </summary>
/// <remarks>
/// Aligné sur le layout RÉEL vérifié contre inagle
/// (packages/inagle/src/parsers/passive-skill-config.ts) et les octets du dump.
///
/// - passive_skill_config.cfg.bin :
///   * PASSIVE_SKILL_INFO_{N} : [0] passiveId, [1] effectId, [2] nameId, [3] descId, [4] rareté.
///   * PASSIVE_SKILL_EFFECT_{N} : [0] effectId (hash), [1] param (float), [2..8] sentinelles.
///   * PASSIVE_SKILL_INFO_REF_EFFECT/REF_BUFF_ICON : paires (index, count).
///
/// L'ancien LoadEffectConfig parsait une arborescence
/// PASSIVE_SKILL_EFFECT_INFO_LIST_BEG / EXEC_TIMING / TARGET / GRAND_TOTAL inexistante :
/// le fichier passive_skill_effect_config réel n'a que des listes
/// (m_soccerPassiveSkillEffect{,Info,Range}List). Il n'est donc plus parsé par une
/// arborescence inventée ; les effets bruts viennent de la table PASSIVE_SKILL_EFFECT_{N}.
/// </remarks>
public sealed class PassiveSkillService
{
    private const string PassiveSkillInfoPrefix = "PASSIVE_SKILL_INFO_";
    private const string PassiveSkillInfoRefEffectPrefix = "PASSIVE_SKILL_INFO_REF_EFFECT_";
    private const string PassiveSkillInfoRefBuffIconPrefix = "PASSIVE_SKILL_INFO_REF_BUFF_ICON_";
    private const string PassiveSkillEffectPrefix = "PASSIVE_SKILL_EFFECT_";

    private readonly Dictionary<int, PassiveSkillDefinition> _skills = [];
    private readonly List<PassiveSkillEffect> _effects = [];

    /// <summary>Définitions de talents passifs chargées (indexées par ID local).</summary>
    public IReadOnlyDictionary<int, PassiveSkillDefinition> Skills => _skills;

    /// <summary>Effets bruts chargés (hash + param float).</summary>
    public IReadOnlyList<PassiveSkillEffect> Effects => _effects;

    /// <summary>Récupère un talent passif par ID local.</summary>
    public PassiveSkillDefinition? GetSkill(int id) => _skills.GetValueOrDefault(id);

    /// <summary>
    /// Charge les talents passifs ET les effets bruts depuis passive_skill_config.cfg.bin.
    /// </summary>
    /// <param name="data">Données brutes du fichier CFG.BIN.</param>
    /// <returns>Nombre de talents chargés.</returns>
    [System.Diagnostics.CodeAnalysis.RequiresUnreferencedCode("CFG.BIN parsing uses reflection.")]
    public int LoadSkillConfig(byte[] data)
    {
        if (!CfgBin.HasValidFooter(data))
            throw new InvalidDataException("Invalid cfg.bin file: missing footer.");

        var cfg = new CfgBin();
        cfg.Open(data);

        var entries = FlattenEntries(cfg.Entries);

        // Effets bruts : PASSIVE_SKILL_EFFECT_{N} (hors INFO / REF / LIST).
        _effects.Clear();
        foreach (var entry in entries)
        {
            if (entry.Name.StartsWith(PassiveSkillEffectPrefix, StringComparison.Ordinal) &&
                !entry.Name.Contains("INFO") &&
                !entry.Name.Contains("REF") &&
                !entry.Name.Contains("LIST") &&
                entry.Variables.Count >= 1)
            {
                _effects.Add(new PassiveSkillEffect
                {
                    EffectHash = (uint)GetIntValue(entry.Variables, 0),
                    Param1 = GetFloatValue(entry.Variables, 1)
                });
            }
        }

        // Talents : PASSIVE_SKILL_INFO_{N} (hors REF / LIST).
        var loadedCount = 0;
        var skillInfoEntries = entries
            .Where(e => e.Name.StartsWith(PassiveSkillInfoPrefix, StringComparison.Ordinal) &&
                        !e.Name.Contains("REF") &&
                        !e.Name.Contains("LIST"))
            .ToList();

        foreach (var entry in skillInfoEntries)
        {
            if (!TryParseSkillId(entry.Name, PassiveSkillInfoPrefix, out int id))
                continue;

            var skillDef = new PassiveSkillDefinition { Id = id };

            if (entry.Variables.Count >= 5)
            {
                skillDef.Info = new PassiveSkillInfo
                {
                    PassiveHash = (uint)GetIntValue(entry.Variables, 0),
                    EffectHash = (uint)GetIntValue(entry.Variables, 1),
                    NameHash = (uint)GetIntValue(entry.Variables, 2),
                    DescHash = (uint)GetIntValue(entry.Variables, 3),
                    Rarity = GetIntValue(entry.Variables, 4),
                    Reserved = GetIntValue(entry.Variables, 5)
                };
            }

            var buffIconName = $"{PassiveSkillInfoRefBuffIconPrefix}{id}";
            var buffIconEntry = entries.FirstOrDefault(e => e.Name == buffIconName);
            if (buffIconEntry?.Variables.Count >= 2)
            {
                skillDef.BuffIconRef = new PassiveSkillBuffIconRef
                {
                    Index = GetIntValue(buffIconEntry.Variables, 0),
                    Count = GetIntValue(buffIconEntry.Variables, 1)
                };
            }

            var effectRefName = $"{PassiveSkillInfoRefEffectPrefix}{id}";
            var effectRefEntry = entries.FirstOrDefault(e => e.Name == effectRefName);
            if (effectRefEntry?.Variables.Count >= 2)
            {
                skillDef.EffectRef = new PassiveSkillEffectRef
                {
                    Index = GetIntValue(effectRefEntry.Variables, 0),
                    Count = GetIntValue(effectRefEntry.Variables, 1)
                };
            }

            _skills[id] = skillDef;
            loadedCount++;
        }

        return loadedCount;
    }

    /// <summary>Talents filtrés par rareté (champ [4] de PASSIVE_SKILL_INFO).</summary>
    public IEnumerable<PassiveSkillDefinition> GetSkillsByRarity(int rarity)
    {
        return _skills.Values.Where(s => s.Info.Rarity == rarity);
    }

    /// <summary>
    /// Exporte les talents en JSON (champs vérifiés uniquement).
    /// </summary>
    public string ExportToJson()
    {
        var sb = new System.Text.StringBuilder();
        sb.AppendLine("{");
        sb.AppendLine("  \"skills\": [");

        var skillList = _skills.Values.OrderBy(s => s.Id).ToList();
        for (int i = 0; i < skillList.Count; i++)
        {
            var skill = skillList[i];
            sb.AppendLine("    {");
            sb.AppendLine($"      \"id\": {skill.Id},");
            sb.AppendLine($"      \"passiveHash\": \"0x{skill.Info.PassiveHash:X8}\",");
            sb.AppendLine($"      \"effectHash\": \"0x{skill.Info.EffectHash:X8}\",");
            sb.AppendLine($"      \"nameHash\": \"0x{skill.Info.NameHash:X8}\",");
            sb.AppendLine($"      \"descHash\": \"0x{skill.Info.DescHash:X8}\",");
            sb.AppendLine($"      \"rarity\": {skill.Info.Rarity}");
            sb.Append("    }");
            sb.AppendLine(i < skillList.Count - 1 ? "," : "");
        }

        sb.AppendLine("  ],");
        sb.AppendLine($"  \"totalSkills\": {_skills.Count},");
        sb.AppendLine($"  \"totalEffects\": {_effects.Count}");
        sb.AppendLine("}");

        return sb.ToString();
    }

    /// <summary>Efface toutes les données chargées.</summary>
    public void Clear()
    {
        _skills.Clear();
        _effects.Clear();
    }

    #region Private Helpers

    private static List<Entry> FlattenEntries(List<Entry> entries)
    {
        var result = new List<Entry>();
        foreach (var entry in entries)
        {
            result.Add(entry);
            result.AddRange(FlattenEntries(entry.Children));
        }
        return result;
    }

    private static bool TryParseSkillId(string name, string prefix, out int id)
    {
        id = 0;
        if (!name.StartsWith(prefix, StringComparison.Ordinal))
            return false;

        var suffix = name[prefix.Length..];
        return int.TryParse(suffix, out id);
    }

    private static int GetIntValue(List<Variable> variables, int index)
    {
        if (index < 0 || index >= variables.Count)
            return 0;

        var variable = variables[index];
        if (variable.Value is int i)
            return i;
        if (variable.Value is float f)
            return (int)f;
        if (int.TryParse(variable.Value?.ToString(), out int parsed))
            return parsed;

        return 0;
    }

    private static float GetFloatValue(List<Variable> variables, int index)
    {
        if (index < 0 || index >= variables.Count)
            return 0f;

        var variable = variables[index];
        if (variable.Value is float f)
            return f;
        if (variable.Value is int i)
            return i;
        if (float.TryParse(variable.Value?.ToString(),
                System.Globalization.NumberStyles.Float,
                System.Globalization.CultureInfo.InvariantCulture, out float parsed))
            return parsed;

        return 0f;
    }

    #endregion
}
