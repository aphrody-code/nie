using System.CommandLine;
using System.Text.Json;
using IECODE.Core.GameData;
using IECODE.Core.Serialization;

namespace IECODE.CLI.Commands;

public static class DumpGameDataCommand
{
    public static Command Create()
    {
        var command = new Command("dump-gamedata", "Dump specific game data types to JSON using typed models");

        var typeArg = new Argument<string>("type", "Type of data to dump (character, item, skill, subtitle, noun, param, all)");
        command.AddArgument(typeArg);

        var dumpOption = new Option<string?>(
            aliases: ["--dump", "-d"],
            description: "Path to dump folder (auto-detects NIE_GAME_DIR or current directory)");
        command.AddOption(dumpOption);

        var langOption = new Option<string>(
            aliases: ["--lang", "-l"],
            description: "Language (fr, de, en, ja, etc.)",
            getDefaultValue: () => "fr");
        command.AddOption(langOption);

        var outputOption = new Option<string?>(
            aliases: ["--output", "-o"],
            description: "Output JSON file path or directory (default: stdout)");
        command.AddOption(outputOption);

        command.SetHandler(Execute, typeArg, dumpOption, langOption, outputOption);

        return command;
    }

    private static void Execute(string type, string? dumpPath, string language, string? outputPath)
    {
        try
        {
            string basePath = ResolveDumpPath(dumpPath);
            var mapper = new GameDataMapper(basePath, language);

            if (type.ToLower() == "all")
            {
                DumpAll(mapper, language, outputPath);
                return;
            }

            string json = "";
            switch (type.ToLower())
            {
                case "character":
                    var chars = mapper.LoadEntries<CharacterBaseInfo>(
                        @"data\common\gamedata\character",
                        "CHARA_BASE_INFO",
                        e => new CharacterBaseInfo(e),
                        "chara_base*.cfg.bin");
                    json = JsonSerializer.Serialize(chars, AppJsonContext.Default.ListCharacterBaseInfo);
                    break;
                case "item":
                    var items = mapper.LoadEntries<ItemConfig>(
                        @"data\common\gamedata\item",
                        "ITEM_CONSUME_INFO",
                        e => new ItemConfig(e),
                        "item_config*.cfg.bin");
                    json = JsonSerializer.Serialize(items, AppJsonContext.Default.ListItemConfig);
                    break;
                case "skill":
                    var skills = mapper.LoadEntries<AuraSkillConfig>(
                        @"data\common\gamedata\skill",
                        "AURA_CMD_INFO_",
                        e => new AuraSkillConfig(e),
                        "aura_skill_config*.cfg.bin");
                    json = JsonSerializer.Serialize(skills, AppJsonContext.Default.ListAuraSkillConfig);
                    break;
                case "subtitle":
                    var subs = mapper.LoadEntries<SubtitleData>(
                        @"data\common\gamedata\event\subtitle",
                        "EV_SUBTITLE_DATA",
                        e => new SubtitleData(e),
                        "*.cfg.bin");
                    json = JsonSerializer.Serialize(subs, AppJsonContext.Default.ListSubtitleData);
                    break;
                case "noun":
                    var nouns = mapper.LoadEntries<NounInfo>(
                        Path.Combine(@"data\common\text", language),
                        "NOUN_INFO",
                        e => new NounInfo(e),
                        "chara_text*.cfg.bin");
                    json = JsonSerializer.Serialize(nouns, AppJsonContext.Default.ListNounInfo);
                    break;
                case "param":
                    var paramsData = mapper.LoadEntries<CharacterParam>(
                        @"data\common\gamedata\character",
                        "CHARA_PARAM_INFO",
                        e => new CharacterParam(e),
                        "chara_param*.cfg.bin");
                    json = JsonSerializer.Serialize(paramsData, AppJsonContext.Default.ListCharacterParam);
                    break;
                default:
                    Console.Error.WriteLine($"Unknown type: {type}. Supported: character, item, skill, subtitle, noun, param, all");
                    return;
            }

            if (!string.IsNullOrEmpty(outputPath))
            {
                File.WriteAllText(outputPath, json);
                Console.WriteLine($"Dumped {type} data to {outputPath}");
            }
            else
            {
                Console.WriteLine(json);
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Error: {ex.Message}");
        }
    }

    private static void DumpAll(GameDataMapper mapper, string language, string? outputDir)
    {
        string targetDir = outputDir ?? Path.Combine(Directory.GetCurrentDirectory(), "gamedata_export");
        Directory.CreateDirectory(targetDir);

        var types = new[] { "character", "item", "skill", "subtitle", "noun", "param" };
        foreach (var type in types)
        {
            string fileName = Path.Combine(targetDir, $"{type}_{language}.json");
            Execute(type, null, language, fileName);
        }

        Console.WriteLine($"\nFull export completed to: {targetDir}");
    }

    private static string ResolveDumpPath(string? userPath)
    {
        if (!string.IsNullOrEmpty(userPath) && Directory.Exists(userPath))
            return userPath;

        string[] defaultPaths =
        [
            Environment.GetEnvironmentVariable("NIE_GAME_DIR") ?? string.Empty,
            Directory.GetCurrentDirectory(),
        ];
        foreach (var path in defaultPaths)
        {
            if (Directory.Exists(Path.Combine(path, "data")))
                return path;
        }

        throw new DirectoryNotFoundException("Dump folder not found. Specify path with --dump option.");
    }
}
