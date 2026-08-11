using System.Diagnostics.CodeAnalysis;
using IECODE.Core;
using IECODE.Core.Game.PassiveSkills;

namespace IECODE.CLI.Commands;

/// <summary>
/// Commande d'analyse et d'export des talents passifs.
/// Usage : iecode passive [sous-commande] [options]
/// </summary>
public static class PassiveSkillCommand
{
    /// <summary>
    /// Analyse passive_skill_config.cfg.bin et exporte les données.
    /// </summary>
    /// <remarks>
    /// Le fichier passive_skill_config.cfg.bin contient à la fois les talents
    /// (PASSIVE_SKILL_INFO) et leurs effets bruts (PASSIVE_SKILL_EFFECT). Le fichier
    /// passive_skill_effect_config.cfg.bin (format listes m_soccerPassiveSkillEffect*)
    /// n'est PAS un arbre d'effets exploitable comme l'ancienne version le supposait :
    /// l'option --effect-config a donc été retirée.
    /// </remarks>
    [RequiresUnreferencedCode("CFG.BIN parsing uses reflection.")]
    public static async Task AnalyzeAsync(
        string? gamePath,
        string? skillConfig,
        string? output,
        int? rarityFilter,
        bool verbose)
    {
        try
        {
            using var game = new IEVRGame(gamePath);
            var service = new PassiveSkillService();

            if (string.IsNullOrEmpty(skillConfig))
            {
                Console.Error.WriteLine("Error: --skill-config est requis (passive_skill_config.cfg.bin).");
                Environment.ExitCode = 1;
                return;
            }

            if (!File.Exists(skillConfig))
            {
                Console.Error.WriteLine($"Error: Skill config not found: {skillConfig}");
                Environment.ExitCode = 1;
                return;
            }

            var data = await File.ReadAllBytesAsync(skillConfig);
            var count = service.LoadSkillConfig(data);
            Console.WriteLine($"Loaded {count} passive skill definitions, {service.Effects.Count} raw effects");

            // Filtrage par rareté (champ [4] de PASSIVE_SKILL_INFO).
            if (rarityFilter.HasValue)
            {
                var filtered = service.GetSkillsByRarity(rarityFilter.Value).ToList();
                Console.WriteLine($"\nSkills with rarity '{rarityFilter.Value}': {filtered.Count}");

                foreach (var skill in filtered.Take(20))
                {
                    Console.WriteLine($"  [{skill.Id}] Passive: 0x{skill.Info.PassiveHash:X8}, Effect: 0x{skill.Info.EffectHash:X8}");
                }

                if (filtered.Count > 20)
                {
                    Console.WriteLine($"  ... and {filtered.Count - 20} more");
                }
            }

            // Distribution par rareté (valeurs réelles, non préjugées).
            Console.WriteLine("\n=== Rarity Distribution ===");
            foreach (var group in service.Skills.Values
                         .GroupBy(s => s.Info.Rarity)
                         .OrderBy(g => g.Key))
            {
                Console.WriteLine($"  Rarity {group.Key}: {group.Count()} skills");
            }

            if (!string.IsNullOrEmpty(output))
            {
                var json = service.ExportToJson();
                await File.WriteAllTextAsync(output, json);
                Console.WriteLine($"\nExported to: {output}");
            }

            if (verbose)
            {
                Console.WriteLine("\n=== Sample Skills (first 10) ===");
                foreach (var skill in service.Skills.Values.Take(10))
                {
                    Console.WriteLine($"[{skill.Id}] rarity {skill.Info.Rarity}");
                    Console.WriteLine($"  PassiveHash: 0x{skill.Info.PassiveHash:X8}");
                    Console.WriteLine($"  EffectHash:  0x{skill.Info.EffectHash:X8}");
                    Console.WriteLine($"  NameHash:    0x{skill.Info.NameHash:X8}");
                    Console.WriteLine($"  DescHash:    0x{skill.Info.DescHash:X8}");
                    Console.WriteLine();
                }
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Error: {ex.Message}");
            if (verbose)
            {
                Console.Error.WriteLine(ex.StackTrace);
            }
            Environment.ExitCode = 1;
        }
    }

    /// <summary>
    /// Affiche l'aide de la commande passive.
    /// </summary>
    public static void ShowHelp()
    {
        Console.WriteLine(@"
Passive Skill Analysis Command
==============================

Usage:
  iecode passive analyze [options]
  iecode passive help

Commands:
  analyze     Parse passive_skill_config.cfg.bin and export data
  help        Show this help message

Analyze Options:
  --skill-config <path>   Path to passive_skill_config.cfg.bin (requis)
  --output <path>         Export results to JSON file
  --rarity <n>            Filter by rarity value (champ [4] de PASSIVE_SKILL_INFO)
  --verbose               Show detailed output

Examples:
  iecode passive analyze --skill-config passive_skill_config_0.08.86.cfg.bin
  iecode passive analyze --skill-config skill.cfg.bin --output skills.json --verbose
  iecode passive analyze --skill-config skill.cfg.bin --rarity 6
");
    }
}
