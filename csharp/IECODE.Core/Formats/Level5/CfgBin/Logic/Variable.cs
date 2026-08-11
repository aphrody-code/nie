using System;

namespace IECODE.Core.Formats.Level5.CfgBin.Logic
{
    /// <summary>
    /// Represents a variable in a cfg.bin entry.
    /// </summary>
    public sealed class Variable
    {
        public VariableType Type { get; set; }
        public object? Value { get; set; }
        public string? Name { get; set; }

        public Variable()
        {
        }

        public Variable(VariableType type, object? value)
        {
            Type = type;
            Value = value;
        }

        public Variable(Variable other)
        {
            Type = other.Type;
            Value = other.Value;
            Name = other.Name;
        }

        public int GetInt32() => Convert.ToInt32(Value);
        public float GetSingle() => Convert.ToSingle(Value);
        public string? GetString() => Value?.ToString();
    }
}
