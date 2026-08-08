using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using IECODE.Core.Formats.Level5.CfgBin.Tools;

namespace IECODE.Core.Formats.Level5.CfgBin.Logic
{
    /// <summary>
    /// Represents an entry in a cfg.bin file.
    /// </summary>
    public sealed class Entry
    {
        public string Name { get; set; } = string.Empty;
        public string? CustomName { get; set; }
        public bool EndTerminator { get; set; }
        public Encoding Encoding { get; set; } = Encoding.UTF8;
        public List<Variable> Variables { get; set; } = new List<Variable>();
        public List<Entry> Children { get; set; } = new List<Entry>();

        public Entry()
        {
        }

        public Entry(string name, List<Variable> variables, Encoding encoding)
        {
            Name = name;
            Variables = variables;
            Encoding = encoding;
            Children = new List<Entry>();
        }

        public Entry(string name, List<Variable> variables, Encoding encoding, bool endTerminator)
            : this(name, variables, encoding)
        {
            EndTerminator = endTerminator;
        }

        public string GetName()
        {
            var parts = Name.Split('_');
            return string.Join("_", parts.Take(parts.Length - 1));
        }

        public Entry Clone()
        {
            var clonedVariables = Variables.Select(v => new Variable(v)).ToList();
            var clonedChildren = Children.Select(child => child.Clone()).ToList();

            return new Entry(Name, clonedVariables, Encoding)
            {
                EndTerminator = EndTerminator,
                Children = clonedChildren
            };
        }

        public int Count()
        {
            int totalCount = 1 + (EndTerminator ? 1 : 0);
            foreach (var child in Children)
            {
                totalCount += child.Count();
            }
            return totalCount;
        }

        public string[] GetDistinctStrings()
        {
            var distinctStrings = new List<string>();
            CollectStringsRecursive(distinctStrings);
            return distinctStrings.Distinct().ToArray();
        }

        private void CollectStringsRecursive(List<string> strings)
        {
            foreach (var variable in Variables.Where(v => v.Type == VariableType.String && v.Value != null))
            {
                strings.Add(variable.Value!.ToString()!);
            }
            foreach (var child in Children)
            {
                child.CollectStringsRecursive(strings);
            }
        }

        public List<string> GetUniqueKeys()
        {
            var uniqueNames = new HashSet<string>();
            CollectUniqueKeysRecursive(uniqueNames);
            return uniqueNames.ToList();
        }

        private void CollectUniqueKeysRecursive(HashSet<string> names)
        {
            string currentName = GetName();
            names.Add(currentName);

            foreach (var child in Children)
            {
                child.CollectUniqueKeysRecursive(names);
            }

            if (EndTerminator)
            {
                string endTerminatorName = currentName.StartsWith("PTREE")
                    ? "_PTREE"
                    : GetName().Replace("BEGIN", "END").Replace("BEG", "END");
                names.Add(endTerminatorName);
            }
        }

        public byte[] EncodeEntry(Dictionary<string, int> stringsTable)
        {
            using var memoryStream = new MemoryStream();
            using var writer = new BinaryDataWriter(memoryStream);

            string entryName = GetName();
            writer.Write(Crc32.Compute(Encoding.GetBytes(entryName)));

            writer.Write((byte)Variables.Count);
            var types = Variables.Select(x => x.Type).ToList();
            writer.Write(EncodeTypes(types));

            foreach (var variable in Variables)
            {
                WriteVariable(writer, variable, stringsTable);
            }

            foreach (var child in Children)
            {
                writer.Write(child.EncodeEntry(stringsTable));
            }

            if (EndTerminator)
            {
                string endTerminatorName = entryName.StartsWith("PTREE")
                    ? "_PTREE"
                    : GetName().Replace("BEGIN", "END").Replace("BEG", "END");

                writer.Write(Crc32.Compute(Encoding.GetBytes(endTerminatorName)));
                writer.Write(new byte[] { 0x00, 0xFF, 0xFF, 0xFF });
            }

            return memoryStream.ToArray();
        }

        private void WriteVariable(BinaryDataWriter writer, Variable variable, Dictionary<string, int> stringsTable)
        {
            switch (variable.Type)
            {
                case VariableType.String:
                    string? valueString = variable.Value?.ToString();
                    if (valueString != null && stringsTable.TryGetValue(valueString, out int offset))
                    {
                        writer.Write(offset);
                    }
                    else
                    {
                        writer.Write(-1);
                    }
                    break;
                case VariableType.Int:
                    writer.Write(Convert.ToInt32(variable.Value));
                    break;
                case VariableType.Float:
                    writer.Write(Convert.ToSingle(variable.Value));
                    break;
                default:
                    writer.Write(Convert.ToInt32(variable.Value));
                    break;
            }
        }

        private static byte[] EncodeTypes(List<VariableType> types)
        {
            var byteArray = new List<byte>();

            for (int i = 0; i < Math.Ceiling((double)types.Count / 4); i++)
            {
                int typeDesc = 0;
                for (int j = 4 * i; j < Math.Min(4 * (i + 1), types.Count); j++)
                {
                    int tagValue = types[j] switch
                    {
                        VariableType.String => 0,
                        VariableType.Int => 1,
                        VariableType.Float => 2,
                        _ => 0
                    };
                    typeDesc |= tagValue << ((j % 4) * 2);
                }
                byteArray.Add((byte)typeDesc);
            }

            while ((byteArray.Count + 1) % 4 != 0)
            {
                byteArray.Add(0xFF);
            }

            return byteArray.ToArray();
        }

        public byte GetEncodingByte()
        {
            try
            {
                if (Encoding.Equals(Encoding.GetEncoding("SHIFT-JIS")))
                    return 0;
            }
            catch { }
            return 1;
        }

        public void ReplaceString(string oldString, string newString)
        {
            foreach (var variable in Variables.Where(x => x.Type == VariableType.String))
            {
                if (variable.Value?.ToString() == oldString)
                {
                    variable.Value = newString;
                }
            }
        }

        public bool MatchEntry(string match)
        {
            match = match.ToLowerInvariant();

            if (GetName().ToLowerInvariant() == match || GetName().ToLowerInvariant().StartsWith(match))
            {
                return true;
            }

            foreach (var variable in Variables)
            {
                if (variable.Name != null &&
                    (variable.Name.ToLowerInvariant() == match || variable.Name.ToLowerInvariant().StartsWith(match)))
                {
                    return true;
                }

                if (variable.Type == VariableType.String)
                {
                    string? valueString = variable.Value?.ToString()?.ToLowerInvariant();
                    if (valueString == match || (valueString?.StartsWith(match) ?? false))
                    {
                        return true;
                    }
                }
                else if (variable.Type == VariableType.Int)
                {
                    if (int.TryParse(match, out int matchInt) && matchInt == Convert.ToInt32(variable.Value))
                    {
                        return true;
                    }
                }
                else if (variable.Type == VariableType.Float)
                {
                    if (float.TryParse(match, out float matchFloat) &&
                        Math.Abs(matchFloat - Convert.ToSingle(variable.Value)) < 0.0001f)
                    {
                        return true;
                    }
                }
            }

            return false;
        }
    }
}

