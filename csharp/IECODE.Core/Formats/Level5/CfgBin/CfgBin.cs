using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using IECODE.Core.Formats.Level5.CfgBin.Logic;
using IECODE.Core.Formats.Level5.CfgBin.Tools;

namespace IECODE.Core.Formats.Level5.CfgBin
{
    /// <summary>
    /// cfg.bin file parser and writer.
    /// Compatible with netstandard2.0 and net8.0.
    /// </summary>
    public sealed class CfgBin
    {
        public Encoding Encoding { get; set; } = Encoding.UTF8;
        public List<Entry> Entries { get; set; } = new List<Entry>();
        public Dictionary<int, string> Strings { get; set; } = new Dictionary<int, string>();

        /// <summary>
        /// Check if the data has a valid cfg.bin footer pattern.
        /// Valid cfg.bin files contain: 0x01 0x74 0x32 0x62 0xFE near the end (within last 32 bytes).
        /// </summary>
        public static bool HasValidFooter(byte[] data)
        {
            if (data.Length < 16) return false;

            // Search for footer pattern in the last 32 bytes (handles padding)
            // Footer pattern: 01 74 32 62 FE
            int searchStart = Math.Max(0, data.Length - 32);
            for (int i = searchStart; i < data.Length - 4; i++)
            {
                if (data[i] == 0x01
                    && data[i + 1] == 0x74
                    && data[i + 2] == 0x32
                    && data[i + 3] == 0x62)
                {
                    return true;
                }
            }
            return false;
        }

        [System.Diagnostics.CodeAnalysis.RequiresUnreferencedCode("Calls ReadFromReader which requires unreferenced code.")]
        public void Open(byte[] data)
        {
            using (var reader = new BinaryDataReader(data))
            {
                ReadFromReader(reader);
            }
        }

        [System.Diagnostics.CodeAnalysis.RequiresUnreferencedCode("Calls ReadFromReader which requires unreferenced code.")]
        public void Open(Stream stream)
        {
            using (var reader = new BinaryDataReader(stream))
            {
                ReadFromReader(reader);
            }
        }

        [System.Diagnostics.CodeAnalysis.RequiresUnreferencedCode("Calls ReadStruct which requires unreferenced code.")]
        private void ReadFromReader(BinaryDataReader reader)
        {
            if (reader.Length < 0x10)
                throw new InvalidDataException("File is too small to be a valid cfg.bin");

            // Verify footer
            reader.Seek((uint)Math.Max(0, reader.Length - 32));
            byte[] footerArea = reader.GetSection((int)Math.Min(32, reader.Length - reader.Position));
            bool validFooter = false;
            for (int i = 0; i < footerArea.Length - 4; i++)
            {
                if (footerArea[i] == 0x01 && footerArea[i + 1] == 0x74 && footerArea[i + 2] == 0x32 && footerArea[i + 3] == 0x62)
                {
                    validFooter = true;
                    break;
                }
            }

            if (!validFooter)
                throw new InvalidDataException("Invalid cfg.bin footer magic.");

            reader.Seek((uint)reader.Length - 0x0A);
            Encoding = SetEncoding(reader.ReadByte());

            reader.Seek(0x0);
            var header = reader.ReadStruct<CfgBinSupport.Header>();

            if (header.StringTableOffset < 0x10)
                throw new InvalidDataException($"Invalid StringTableOffset: {header.StringTableOffset}");

            if (header.StringTableLength < 0)
                throw new InvalidDataException($"Invalid StringTableLength: {header.StringTableLength}");

            if (header.StringTableOffset > reader.Length)
                throw new InvalidDataException($"StringTableOffset {header.StringTableOffset} is beyond file length {reader.Length}");

            if ((long)header.StringTableOffset + header.StringTableLength > reader.Length)
                throw new InvalidDataException($"StringTable extends beyond file length");

            byte[] entriesBuffer = reader.GetSection(0x10, header.StringTableOffset - 0x10);

            byte[] stringTableBuffer = reader.GetSection((uint)header.StringTableOffset, header.StringTableLength);
            Strings = ParseStrings(header.StringTableCount, stringTableBuffer);

            long keyTableOffset = RoundUp((long)header.StringTableOffset + header.StringTableLength, 16);

            if (keyTableOffset > reader.Length)
                throw new InvalidDataException($"KeyTableOffset {keyTableOffset} is beyond file length {reader.Length}");

            reader.Seek((uint)keyTableOffset);
            int keyTableSize = reader.ReadInt32();

            if (keyTableSize < 0 || keyTableOffset + 4 + keyTableSize > reader.Length)
                throw new InvalidDataException($"Invalid KeyTableSize: {keyTableSize}");

            byte[] keyTableBlob = reader.GetSection((uint)keyTableOffset, keyTableSize);
            var keyTable = ParseKeyTable(keyTableBlob);

            // Basic validation for entries buffer size
            // Each entry has at least 4 bytes (CRC) + 1 byte (ParamCount)
            if (entriesBuffer.Length < header.EntriesCount * 5)
                throw new InvalidDataException($"EntriesBuffer too small ({entriesBuffer.Length}) for {header.EntriesCount} entries");

            Entries = ParseEntries(header.EntriesCount, entriesBuffer, keyTable);
        }

        public byte[] Save()
        {
            var stringsTable = GetStringsTable();

            using (var stream = new MemoryStream())
            using (var writer = new BinaryDataWriter(stream))
            {
                int distinctStringCount = GetDistinctStrings().Length;

                var header = new CfgBinSupport.Header
                {
                    EntriesCount = Count(Entries),
                    StringTableOffset = 0,
                    StringTableLength = 0,
                    StringTableCount = distinctStringCount
                };

                writer.Seek(0x10);

                foreach (var entry in Entries)
                {
                    writer.Write(entry.EncodeEntry(stringsTable));
                }

                writer.WriteAlignment(0x10, 0xFF);
                header.StringTableOffset = (int)writer.Position;

                if (distinctStringCount > 0)
                {
                    writer.Write(EncodeStrings());
                    header.StringTableLength = (int)writer.Position - header.StringTableOffset;
                    writer.WriteAlignment(0x10, 0xFF);
                }

                var uniqueKeysList = Entries
                    .SelectMany(entry => entry.GetUniqueKeys())
                    .Distinct()
                    .ToList();

                writer.Write(EncodeKeyTable(uniqueKeysList));

                writer.Write(new byte[] { 0x01, 0x74, 0x32, 0x62, 0xFE });
                writer.Write(new byte[] { 0x01, GetEncodingByte(), 0x00, 0x01 });
                writer.WriteAlignment();

                writer.Seek(0);
                writer.WriteStruct(header);

                return stream.ToArray();
            }
        }

        public void Save(string fileName)
        {
            File.WriteAllBytes(fileName, Save());
        }

        public string ToJsonString()
        {
            var sb = new StringBuilder();
            sb.AppendLine("{");
            sb.AppendLine($"  \"Encoding\": \"{Encoding.WebName}\",");

            if (Entries.Count > 0)
            {
                sb.AppendLine("  \"Entries\": [");

                for (int i = 0; i < Entries.Count; i++)
                {
                    AppendEntryToJson(sb, Entries[i], 1, i == Entries.Count - 1);
                }

                sb.AppendLine("  ]");
            }

            sb.AppendLine("}");

            return sb.ToString();
        }

        public void ToJson(string fileName)
        {
            File.WriteAllText(fileName, ToJsonString(), new UTF8Encoding(false));
        }

        private void AppendEntryToJson(StringBuilder sb, Entry entry, int indentLevel, bool lastElement)
        {
            string indent = new string(' ', 2 * indentLevel);

            sb.AppendLine($"{indent}{{");
            sb.AppendLine($"{indent}  \"Name\": \"{EscapeJson(entry.Name)}\",");
            sb.AppendLine($"{indent}  \"EndTerminator\": {entry.EndTerminator.ToString().ToLowerInvariant()},");
            sb.AppendLine($"{indent}  \"Variables\": [");

            for (int i = 0; i < entry.Variables.Count; i++)
            {
                var variable = entry.Variables[i];
                string variableName = variable.Name ?? $"Variable_{i}";

                sb.AppendLine($"{indent}    {{");
                sb.AppendLine($"{indent}      \"Name\": \"{EscapeJson(variableName)}\",");
                sb.AppendLine($"{indent}      \"Type\": \"{variable.Type}\",");
                sb.AppendLine($"{indent}      \"Value\": {GetValueString(variable.Value)}");

                sb.AppendLine(i < entry.Variables.Count - 1
                    ? $"{indent}    }},"
                    : $"{indent}    }}");
            }

            if (entry.Children.Count > 0)
            {
                sb.AppendLine($"{indent}  ],");
                sb.AppendLine($"{indent}  \"Children\": [");

                for (int i = 0; i < entry.Children.Count; i++)
                {
                    AppendEntryToJson(sb, entry.Children[i], indentLevel + 1, i == entry.Children.Count - 1);
                }

                sb.AppendLine($"{indent}  ]");
            }
            else
            {
                sb.AppendLine($"{indent}  ]");
            }

            sb.AppendLine(lastElement ? $"{indent}}}" : $"{indent}}},");
        }

        private static string EscapeJson(string value)
        {
            return value
                .Replace("\\", "\\\\")
                .Replace("\"", "\\\"")
                .Replace("\n", "\\n")
                .Replace("\r", "\\r")
                .Replace("\t", "\\t");
        }

        private static string GetValueString(object? value)
        {
            if (value == null) return "null";
            if (value is string s) return $"\"{EscapeJson(s)}\"";
            if (value is int i) return i.ToString();
            if (value is float f) return f.ToString(CultureInfo.InvariantCulture);
            return "null";
        }

        public void ImportJson(string fileName)
        {
            string jsonContent = File.ReadAllText(fileName);
            ImportJsonString(jsonContent);
        }

        public void ImportJsonString(string jsonContent)
        {
            using (var doc = JsonDocument.Parse(jsonContent))
            {
                var root = doc.RootElement;
                Console.WriteLine($"[DEBUG] JSON Root Kind: {root.ValueKind}");

                if (root.ValueKind == JsonValueKind.Object)
                {
                    Console.WriteLine("[DEBUG] Root properties:");
                    foreach (var prop in root.EnumerateObject())
                    {
                        Console.WriteLine($"  - {prop.Name} ({prop.Value.ValueKind})");
                    }
                }

                if (root.TryGetProperty("Encoding", out var encodingElement) || root.TryGetProperty("encoding", out encodingElement))
                {
                    string? encodingName = encodingElement.GetString();
                    Encoding = encodingName != null ? Encoding.GetEncoding(encodingName) : Encoding.UTF8;
                }

                Entries = new List<Entry>();
                Strings = new Dictionary<int, string>();

                if (root.TryGetProperty("Entries", out var entriesElement) || root.TryGetProperty("entries", out entriesElement))
                {
                    Console.WriteLine($"[DEBUG] Found entries array with {entriesElement.GetArrayLength()} elements");
                    foreach (var entryElement in entriesElement.EnumerateArray())
                    {
                        Entries.Add(ParseEntryFromJson(entryElement));
                    }
                }
                else if (root.TryGetProperty("lists", out var listsElement) && listsElement.ValueKind == JsonValueKind.Array)
                {
                    Console.WriteLine($"[DEBUG] Found 'lists' array with {listsElement.GetArrayLength()} elements");
                    foreach (var listElement in listsElement.EnumerateArray())
                    {
                        string listName = "";
                        if (listElement.TryGetProperty("name", out var nameProp))
                        {
                            listName = nameProp.GetString() ?? "";
                            Console.WriteLine($"[DEBUG] List Name: {listName}");
                        }

                        if (listElement.TryGetProperty("values", out var listValues) && listValues.ValueKind == JsonValueKind.Array)
                        {
                            Console.WriteLine($"[DEBUG] Found list with {listValues.GetArrayLength()} values");
                            int valIdx = 0;
                            foreach (var entryElement in listValues.EnumerateArray())
                            {
                                var entry = ParseEntryFromJson(entryElement);
                                if (string.IsNullOrEmpty(entry.Name) && !string.IsNullOrEmpty(listName))
                                {
                                    entry.Name = $"{listName}_{valIdx:D3}";
                                }
                                Entries.Add(entry);
                                valIdx++;
                            }
                        }
                    }
                }
                else
                {
                    Console.WriteLine("[DEBUG] Could not find 'Entries', 'entries', or 'lists' property in JSON root");
                }
            }
        }

        private static int _debugEntryCount = 0;
        private Entry ParseEntryFromJson(JsonElement element)
        {
            var entry = new Entry
            {
                Encoding = Encoding
            };

            // Debug: print properties of the entry element
            if (_debugEntryCount < 5)
            {
                Console.WriteLine($"[DEBUG] Entry {_debugEntryCount} properties:");
                foreach (var prop in element.EnumerateObject())
                {
                    Console.WriteLine($"  - {prop.Name} ({prop.Value.ValueKind})");
                }
                _debugEntryCount++;
            }

            if (element.TryGetProperty("Name", out var nameElement) || element.TryGetProperty("name", out nameElement))
                entry.Name = nameElement.GetString() ?? string.Empty;
            else if (element.TryGetProperty("id", out var idElement))
                entry.Name = idElement.GetString() ?? string.Empty;
            else if (element.TryGetProperty("hash", out var hashElement))
                entry.Name = hashElement.ValueKind == JsonValueKind.Number ? hashElement.GetInt32().ToString() : hashElement.GetString() ?? string.Empty;

            if (element.TryGetProperty("EndTerminator", out var endTermElement) || element.TryGetProperty("endTerminator", out endTermElement))
                entry.EndTerminator = endTermElement.GetBoolean();

            if (element.TryGetProperty("Variables", out var varsElement) || element.TryGetProperty("variables", out varsElement))
            {
                foreach (var varElement in varsElement.EnumerateArray())
                {
                    entry.Variables.Add(ParseVariableFromJson(varElement));
                }
            }

            if (element.TryGetProperty("Children", out var childrenElement) || element.TryGetProperty("children", out childrenElement))
            {
                foreach (var childElement in childrenElement.EnumerateArray())
                {
                    entry.Children.Add(ParseEntryFromJson(childElement));
                }
            }

            // If no variables were found, try to treat all other properties as variables
            if (entry.Variables.Count == 0)
            {
                foreach (var prop in element.EnumerateObject())
                {
                    string name = prop.Name;
                    if (name == "Name" || name == "name" || name == "id" || name == "hash" ||
                        name == "EndTerminator" || name == "endTerminator" ||
                        name == "Variables" || name == "variables" ||
                        name == "Children" || name == "children")
                    {
                        continue;
                    }

                    var variable = new Variable { Name = name };
                    var val = prop.Value;
                    switch (val.ValueKind)
                    {
                        case JsonValueKind.String:
                            variable.Type = VariableType.String;
                            variable.Value = val.GetString();
                            break;
                        case JsonValueKind.Number:
                            if (val.TryGetInt32(out int i))
                            {
                                variable.Type = VariableType.Int;
                                variable.Value = i;
                            }
                            else
                            {
                                variable.Type = VariableType.Float;
                                variable.Value = val.GetSingle();
                            }
                            break;
                        case JsonValueKind.True:
                        case JsonValueKind.False:
                            variable.Type = VariableType.Int;
                            variable.Value = val.GetBoolean() ? 1 : 0;
                            break;
                    }
                    entry.Variables.Add(variable);
                }
            }

            return entry;
        }

        private Variable ParseVariableFromJson(JsonElement element)
        {
            var variable = new Variable();

            if (element.TryGetProperty("Name", out var nameElement) || element.TryGetProperty("name", out nameElement))
                variable.Name = nameElement.GetString();

            if (element.TryGetProperty("Type", out var typeElement) || element.TryGetProperty("type", out typeElement))
            {
                string? typeName = typeElement.GetString();
                if (typeName != null)
                {
                    switch (typeName.ToLowerInvariant())
                    {
                        case "string":
                            variable.Type = VariableType.String;
                            break;
                        case "int":
                            variable.Type = VariableType.Int;
                            break;
                        case "float":
                            variable.Type = VariableType.Float;
                            break;
                        default:
                            variable.Type = VariableType.Unknown;
                            break;
                    }
                }
            }
            if (element.TryGetProperty("Value", out var valueElement) || element.TryGetProperty("value", out valueElement))
            {
                switch (variable.Type)
                {
                    case VariableType.String:
                        variable.Value = valueElement.ValueKind == JsonValueKind.Null ? null : valueElement.GetString();
                        break;
                    case VariableType.Int:
                        if (valueElement.ValueKind == JsonValueKind.String)
                        {
                            if (int.TryParse(valueElement.GetString(), out int intVal))
                                variable.Value = intVal;
                            else
                                variable.Value = 0;
                        }
                        else
                        {
                            variable.Value = valueElement.GetInt32();
                        }
                        break;
                    case VariableType.Float:
                        if (valueElement.ValueKind == JsonValueKind.String)
                        {
                            if (float.TryParse(valueElement.GetString(), out float floatVal))
                                variable.Value = floatVal;
                            else
                                variable.Value = 0.0f;
                        }
                        else
                        {
                            variable.Value = valueElement.GetSingle();
                        }
                        break;
                    default:
                        variable.Value = valueElement.ValueKind == JsonValueKind.Number ? (object)valueElement.GetInt32() : null;
                        break;
                }

                // Update Strings dictionary for string values
                if (variable.Type == VariableType.String && variable.Value is string stringValue)
                {
                    if (!Strings.ContainsValue(stringValue))
                    {
                        int offset = Strings.Count == 0 ? 0 : Strings.Keys.Max() + Encoding.GetByteCount(stringValue) + 1;
                        Strings[offset] = stringValue;
                    }
                }
            }

            return variable;
        }

        public void PrintInfo(TextWriter output)
        {
            output.WriteLine($"Encoding: {Encoding.WebName}");
            output.WriteLine($"Total Entries: {Count(Entries)}");
            output.WriteLine($"Root Entries: {Entries.Count}");
            output.WriteLine($"Unique Strings: {GetDistinctStrings().Length}");
            output.WriteLine();
            output.WriteLine("Entry Structure:");
            foreach (var entry in Entries)
            {
                PrintEntry(output, entry, 0);
            }
        }

        private void PrintEntry(TextWriter output, Entry entry, int indent)
        {
            string indentStr = new string(' ', indent * 2);
            output.WriteLine($"{indentStr}[{entry.GetName()}] ({entry.Variables.Count} vars)");

            for (int i = 0; i < entry.Variables.Count; i++)
            {
                var v = entry.Variables[i];
                string name = v.Name ?? $"#{i}";
                output.WriteLine($"{indentStr}  {name}: {v.Type} = {FormatValue(v.Value)}");
            }

            foreach (var child in entry.Children)
            {
                PrintEntry(output, child, indent + 1);
            }
        }

        private static string FormatValue(object? value)
        {
            if (value == null) return "<null>";
            if (value is string s)
            {
                if (s.Length > 50) return $"\"{s.Substring(0, 50)}...\"";
                return $"\"{s}\"";
            }
            if (value is float f) return f.ToString("F4", CultureInfo.InvariantCulture);
            return value.ToString() ?? "<null>";
        }

        public List<Entry> FindEntry(string match)
        {
            var result = new List<Entry>();
            FindEntryRecursive(Entries, match, result);
            return result;
        }

        private void FindEntryRecursive(List<Entry> entries, string match, List<Entry> result)
        {
            foreach (var entry in entries)
            {
                if (entry.MatchEntry(match))
                {
                    result.Add(entry);
                }
                FindEntryRecursive(entry.Children, match, result);
            }
        }

        private byte GetEncodingByte()
        {
            try
            {
                if (Encoding.Equals(Encoding.GetEncoding("SHIFT-JIS")))
                    return 0;
            }
            catch { }
            return 1;
        }

        private Encoding SetEncoding(byte b)
        {
            if (b == 0)
            {
                try
                {
                    Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
                    return Encoding.GetEncoding("SHIFT-JIS");
                }
                catch
                {
                    return Encoding.UTF8;
                }
            }
            return Encoding.UTF8;
        }

        private Dictionary<int, string> ParseStrings(int stringCount, byte[] buffer)
        {
            var result = new Dictionary<int, string>();

            using (var reader = new BinaryDataReader(buffer))
            {
                for (int i = 0; i < stringCount; i++)
                {
                    int pos = (int)reader.Position;
                    if (!result.ContainsKey(pos))
                    {
                        result[pos] = reader.ReadString(Encoding);
                    }
                }
            }

            return result;
        }

        [System.Diagnostics.CodeAnalysis.RequiresUnreferencedCode("Calls ReadStruct which requires unreferenced code.")]
        private Dictionary<uint, string> ParseKeyTable(byte[] buffer)
        {
            var keyTable = new Dictionary<uint, string>();

            using (var reader = new BinaryDataReader(buffer))
            {
                var header = reader.ReadStruct<CfgBinSupport.KeyHeader>();
                byte[] keyStringBlob = reader.GetSection((uint)header.KeyStringOffset, header.KeyStringLength);

                for (int i = 0; i < header.KeyCount; i++)
                {
                    uint crc32 = reader.ReadUInt32();
                    int stringStart = reader.ReadInt32();
                    int stringEnd = Array.IndexOf(keyStringBlob, (byte)0, stringStart);
                    if (stringEnd < 0) stringEnd = keyStringBlob.Length;

                    byte[] stringBuf = new byte[stringEnd - stringStart];
                    Array.Copy(keyStringBlob, stringStart, stringBuf, 0, stringEnd - stringStart);
                    keyTable[crc32] = Encoding.GetString(stringBuf);
                }
            }

            return keyTable;
        }

        private List<Entry> ParseEntries(int entriesCount, byte[] entriesBuffer, Dictionary<uint, string> keyTable)
        {
            var temp = new List<Entry>();

            using (var reader = new BinaryDataReader(entriesBuffer))
            {
                for (int i = 0; i < entriesCount; i++)
                {
                    uint crc32 = reader.ReadUInt32();
                    string? name;
                    if (keyTable.TryGetValue(crc32, out var foundName))
                    {
                        name = foundName;
                    }
                    else
                    {
                        name = $"UNKNOWN_{crc32:X8}";
                    }

                    int paramCount = reader.ReadByte();
                    var paramTypes = new VariableType[paramCount];
                    int paramIndex = 0;

                    int typeBytes = (int)Math.Ceiling((double)paramCount / 4);
                    for (int j = 0; j < typeBytes; j++)
                    {
                        byte paramType = reader.ReadByte();
                        for (int k = 0; k < 4 && paramIndex < paramCount; k++)
                        {
                            int tag = (paramType >> (2 * k)) & 3;
                            switch (tag)
                            {
                                case 0:
                                    paramTypes[paramIndex] = VariableType.String;
                                    break;
                                case 1:
                                    paramTypes[paramIndex] = VariableType.Int;
                                    break;
                                case 2:
                                    paramTypes[paramIndex] = VariableType.Float;
                                    break;
                                default:
                                    paramTypes[paramIndex] = VariableType.Unknown;
                                    break;
                            }
                            paramIndex++;
                        }
                    }

                    // Align to 4 bytes
                    if ((typeBytes + 1) % 4 != 0)
                    {
                        reader.Seek((uint)(reader.Position + 4 - (reader.Position % 4)));
                    }

                    var variables = new List<Variable>();
                    for (int j = 0; j < paramCount; j++)
                    {
                        switch (paramTypes[j])
                        {
                            case VariableType.String:
                                int offset = reader.ReadInt32();
                                string? text = null;
                                if (offset != -1 && Strings.TryGetValue(offset, out var s))
                                {
                                    text = s;
                                }
                                variables.Add(new Variable(VariableType.String, text));
                                break;
                            case VariableType.Int:
                                variables.Add(new Variable(VariableType.Int, reader.ReadInt32()));
                                break;
                            case VariableType.Float:
                                variables.Add(new Variable(VariableType.Float, reader.ReadSingle()));
                                break;
                            default:
                                variables.Add(new Variable(VariableType.Unknown, reader.ReadInt32()));
                                break;
                        }
                    }

                    temp.Add(new Entry(name ?? string.Empty, variables, Encoding));
                }
            }
            // Rename entries with unique suffixes
            var entriesKey = new Dictionary<string, int>();
            for (int i = 0; i < temp.Count; i++)
            {
                string entryName = temp[i].Name;
                if (!entriesKey.ContainsKey(entryName))
                {
                    entriesKey[entryName] = 0;
                }
                temp[i].Name = $"{entryName}_{entriesKey[entryName]}";
                entriesKey[entryName]++;
            }

            return ProcessEntries(temp);
        }

        private List<Entry> ProcessEntries(List<Entry> entries)
        {
            var stack = new List<Entry>();
            var output = new List<Entry>();
            var depth = new Dictionary<string, int>();

            int i = 0;
            while (i < entries.Count)
            {
                string name = entries[i].Name;
                var variables = entries[i].Variables;

                string[] nameParts = name.Split('_');
                string nodeType = "";

                if (nameParts.Length >= 2)
                {
                    nodeType = nameParts[nameParts.Length - 2].ToLowerInvariant();
                }

                bool isBegin = nodeType.EndsWith("beg") || nodeType.EndsWith("begin") ||
                              nodeType.EndsWith("start") ||
                              (nodeType.EndsWith("ptree") && !name.Contains("_PTREE"));
                bool isEnd = nodeType.EndsWith("end") || name.Contains("_PTREE");

                if (isBegin)
                {
                    var newNode = new Entry(name, variables, Encoding);

                    if (stack.Count > 0)
                    {
                        string entryNameWithMaxDepth = "";
                        if (depth.Count > 0)
                        {
                            entryNameWithMaxDepth = depth.OrderByDescending(x => x.Value).First().Key;
                        }

                        if (!string.IsNullOrEmpty(entryNameWithMaxDepth))
                        {
                            if (entryNameWithMaxDepth.Contains("_LIST_BEG_"))
                            {
                                entryNameWithMaxDepth = entryNameWithMaxDepth.Replace("_LIST_BEG_", "_BEG_");
                            }

                            string[] entryNameParts = entryNameWithMaxDepth.Split('_');
                            string entryBaseName = "";
                            if (entryNameParts.Length >= 2)
                            {
                                entryBaseName = string.Join("_", entryNameParts.Take(entryNameParts.Length - 2).ToArray());
                            }
                            else
                            {
                                entryBaseName = entryNameWithMaxDepth;
                            }

                            if (name.StartsWith(entryBaseName) && (nodeType.EndsWith("beg") || nodeType.EndsWith("begin")))
                            {
                                if (stack[stack.Count - 1].Children.Count > 0)
                                {
                                    var lastEntry = stack[stack.Count - 1].Children[stack[stack.Count - 1].Children.Count - 1];
                                    lastEntry.Children.Add(newNode);
                                }
                                else
                                {
                                    stack[stack.Count - 1].Children.Add(newNode);
                                }
                            }
                            else
                            {
                                stack[stack.Count - 1].Children.Add(newNode);
                            }
                        }
                        else
                        {
                            stack[stack.Count - 1].Children.Add(newNode);
                        }
                    }
                    else
                    {
                        output.Add(newNode);
                    }

                    stack.Add(newNode);
                    depth[name] = stack.Count;
                }
                else if (isEnd)
                {
                    if (stack.Count > 0)
                    {
                        stack[stack.Count - 1].EndTerminator = true;

                        string key = "";
                        if (depth.ContainsKey(name.Replace("_END_", "_BEG_")))
                            key = name.Replace("_END_", "_BEG_");
                        else if (depth.ContainsKey(name.Replace("_END_", "_BEGIN_")))
                            key = name.Replace("_END_", "_BEGIN_");
                        else if (depth.ContainsKey(name.Replace("_END_", "_START_")))
                            key = name.Replace("_END_", "_START_");
                        else if (depth.ContainsKey(name.Replace("_PTREE", "PTREE")))
                            key = name.Replace("_PTREE", "PTREE");

                        if (depth.Count > 1 && !string.IsNullOrEmpty(key))
                        {
                            int currentDepth = depth[key];
                            int previousDepth = currentDepth - 1;

                            int popCount = currentDepth - previousDepth;
                            for (int j = 0; j < popCount && stack.Count > 0; j++)
                            {
                                stack.RemoveAt(stack.Count - 1);
                            }

                            depth.Remove(key);
                        }
                        else
                        {
                            if (stack.Count > 0)
                                stack.RemoveAt(stack.Count - 1);
                            if (!string.IsNullOrEmpty(key))
                                depth.Remove(key);
                        }
                    }
                }
                else
                {
                    if (depth.Count == 0)
                    {
                        var newNode = new Entry(name, variables, Encoding) { EndTerminator = true };
                        output.Add(newNode);
                    }
                    else
                    {
                        var newItem = new Entry(name, variables, Encoding);

                        string entryNameWithMaxDepth = "";
                        if (depth.Count > 0)
                        {
                            entryNameWithMaxDepth = depth.OrderByDescending(x => x.Value).First().Key;
                        }

                        if (!string.IsNullOrEmpty(entryNameWithMaxDepth))
                        {
                            if (entryNameWithMaxDepth.Contains("_LIST_BEG_"))
                            {
                                entryNameWithMaxDepth = entryNameWithMaxDepth.Replace("_LIST_BEG_", "_BEG_");
                            }

                            string[] entryNameParts = entryNameWithMaxDepth.Split('_');
                            string entryBaseName = "";
                            if (entryNameParts.Length >= 2)
                            {
                                entryBaseName = string.Join("_", entryNameParts.Take(entryNameParts.Length - 2).ToArray());
                            }
                            else
                            {
                                entryBaseName = entryNameWithMaxDepth;
                            }

                            if (!name.StartsWith(entryBaseName))
                            {
                                if (!entryNameWithMaxDepth.Contains("BEGIN") && !entryNameWithMaxDepth.Contains("BEG") &&
                                    !entryNameWithMaxDepth.Contains("START") && !entryNameWithMaxDepth.Contains("PTREE") &&
                                    !name.Contains("_PTREE"))
                                {
                                    if (stack.Count > 0)
                                    {
                                        stack.RemoveAt(stack.Count - 1);
                                        depth.Remove(entryNameWithMaxDepth);
                                        if (stack.Count > 0)
                                            stack[stack.Count - 1].Children.Add(newItem);
                                    }
                                }
                                else
                                {
                                    if (stack.Count > 0 && stack[stack.Count - 1].Children.Count > 0)
                                    {
                                        var lastEntry = stack[stack.Count - 1].Children[stack[stack.Count - 1].Children.Count - 1];
                                        lastEntry.Children.Add(newItem);
                                        stack.Add(newItem);
                                        depth[name] = stack.Count;
                                    }
                                    else if (stack.Count > 0)
                                    {
                                        stack[stack.Count - 1].Children.Add(newItem);
                                    }
                                }
                            }
                            else
                            {
                                if (stack.Count > 0)
                                    stack[stack.Count - 1].Children.Add(newItem);
                            }
                        }
                        else
                        {
                            // Fallback if depth is empty but stack is not (should not happen if logic is correct)
                            if (stack.Count > 0)
                                stack[stack.Count - 1].Children.Add(newItem);
                            else
                                output.Add(newItem);
                        }
                    }
                }

                i++;
            }

            return output;
        }

        private byte[] EncodeStrings()
        {
            using (var stream = new MemoryStream())
            using (var writer = new BinaryDataWriter(stream))
            {
                foreach (string s in GetDistinctStrings())
                {
                    writer.Write(Encoding.GetBytes(s));
                    writer.Write((byte)0x00);
                }

                return stream.ToArray();
            }
        }

        private Dictionary<string, int> GetStringsTable()
        {
            var output = new Dictionary<string, int>();
            int pos = 0;

            foreach (string s in GetDistinctStrings())
            {
                output[s] = pos;
                pos += Encoding.GetByteCount(s) + 1;
            }

            return output;
        }

        private string[] GetDistinctStrings()
        {
            var strings = new List<string>();
            foreach (var entry in Entries)
            {
                strings.AddRange(entry.GetDistinctStrings());
            }
            return strings.Distinct().ToArray();
        }

        private byte[] EncodeKeyTable(List<string> keyList)
        {
            using (var stream = new MemoryStream())
            using (var writer = new BinaryDataWriter(stream))
            {
                var header = new CfgBinSupport.KeyHeader
                {
                    KeyCount = keyList.Count,
                    KeyStringLength = keyList.Sum(k => Encoding.GetByteCount(k) + 1)
                };

                writer.Seek(0x10);

                int stringOffset = 0;
                foreach (var key in keyList)
                {
                    uint crc32 = Crc32.Compute(Encoding.GetBytes(key));
                    writer.Write(crc32);
                    writer.Write(stringOffset);
                    stringOffset += Encoding.GetByteCount(key) + 1;
                }

                writer.WriteAlignment(0x10, 0xFF);
                header.KeyStringOffset = (int)writer.Position;

                foreach (var key in keyList)
                {
                    writer.Write(Encoding.GetBytes(key));
                    writer.Write((byte)0);
                }

                writer.WriteAlignment(0x10, 0xFF);
                header.KeyLength = (int)writer.Position;
                writer.Seek(0x00);
                writer.WriteStruct(header);

                return stream.ToArray();
            }
        }

        private static long RoundUp(long n, int exp)
        {
            return ((n + exp - 1) / exp) * exp;
        }

        private int Count(List<Entry> entries)
        {
            int total = 0;
            foreach (var entry in entries)
            {
                total += entry.Count();
            }
            return total;
        }
    }
}
