namespace IECODE.Core.Formats.Lua;

/// <summary>
/// Modèle objet d'un chunk Lua 5.2 (résultat du parsing de lundump.c).
/// </summary>

// ── En-tête ──────────────────────────────────────────────────────────────────
/// <summary>En-tête global du fichier bytecode Lua 5.2.</summary>
public sealed record LuaHeader(
    byte Version,
    byte Format,
    bool IsLittleEndian,
    byte IntSize,
    byte SizeTSize,
    byte InstructionSize,
    byte NumberSize,
    bool IsFloat   // NumberIntegral == 0
);

// ── Instruction ──────────────────────────────────────────────────────────────
/// <summary>
/// Instruction Lua 5.2 (32 bits, format iABC / iABx / iAsBx).
/// Champs pré-décodés pour faciliter l'inspection.
/// </summary>
public sealed record LuaInstruction(
    uint Raw,
    LuaConstants.Opcode Opcode,
    int A,
    int B,
    int C,
    int Bx,
    int sBx,
    int Ax   // pour EXTRAARG
)
{
    /// <summary>Crée une instruction à partir d'un uint32 little-endian.</summary>
    public static LuaInstruction Decode(uint raw)
    {
        int op   = (int)(raw & LuaConstants.OpcodeMask);
        int a    = (int)((raw >> LuaConstants.AShift)  & LuaConstants.AMask);
        int c    = (int)((raw >> LuaConstants.CShift)  & LuaConstants.CMask);
        int b    = (int)((raw >> LuaConstants.BShift)  & LuaConstants.BMask);
        int bx   = (b << 9) | c;
        int sbx  = bx - LuaConstants.SBxBias;
        int ax   = (int)(raw >> 6);   // bits 6..31

        return new LuaInstruction(
            Raw: raw,
            Opcode: (LuaConstants.Opcode)op,
            A: a,
            B: b,
            C: c,
            Bx: bx,
            sBx: sbx,
            Ax: ax
        );
    }

    /// <summary>Format lisible type <c>luac -l</c>.</summary>
    public string ToDisasm() => LuaDisassembler.FormatInstruction(this);
}

// ── Constante ─────────────────────────────────────────────────────────────────
/// <summary>Constante Lua : nil / bool / double / string.</summary>
public abstract record LuaConstant
{
    public record Nil    : LuaConstant { public override string ToString() => "nil"; }
    public record Bool   (bool Value)   : LuaConstant { public override string ToString() => Value ? "true" : "false"; }
    public record Number (double Value) : LuaConstant { public override string ToString() => Value.ToString("G"); }
    public record String (string Value) : LuaConstant
    {
        public override string ToString() => $"\"{Value.Replace("\\", "\\\\").Replace("\"", "\\\"")}\"";
    }
}

// ── Upvalue ───────────────────────────────────────────────────────────────────
/// <summary>Descripteur d'upvalue (Lua 5.2 : 2 octets par upvalue avant debug).</summary>
public sealed record LuaUpvalue(bool InStack, int Idx, string? Name = null);

// ── Local variable ────────────────────────────────────────────────────────────
/// <summary>Variable locale de la section debug (nom + plage de validité).</summary>
public sealed record LuaLocal(string Name, int PcStart, int PcEnd);

// ── Proto / Function ─────────────────────────────────────────────────────────
/// <summary>
/// Prototype de fonction Lua 5.2 (= "LFunction" dans unluac).
/// Correspond à un Proto dans lobject.h de Lua 5.2.
/// </summary>
public sealed class LuaProto
{
    /// <summary>Nom de source (section debug, ex. "@qrcode_menu.lua").</summary>
    public string? Source { get; init; }
    /// <summary>Première ligne dans la source (0 si inconnu).</summary>
    public int LineDefined { get; init; }
    /// <summary>Dernière ligne dans la source.</summary>
    public int LastLineDefined { get; init; }
    /// <summary>Nombre de paramètres fixes.</summary>
    public int NumParams { get; init; }
    /// <summary>1 si vararg, 0 sinon.</summary>
    public int IsVararg { get; init; }
    /// <summary>Taille du registre nécessaire.</summary>
    public int MaxStackSize { get; init; }

    /// <summary>Code compilé (instructions).</summary>
    public IReadOnlyList<LuaInstruction> Code { get; init; } = [];
    /// <summary>Table de constantes.</summary>
    public IReadOnlyList<LuaConstant> Constants { get; init; } = [];
    /// <summary>Upvalues (Lua 5.2 : instack + idx, nom dans debug).</summary>
    public IReadOnlyList<LuaUpvalue> Upvalues { get; init; } = [];
    /// <summary>Protos enfants (closures).</summary>
    public IReadOnlyList<LuaProto> Protos { get; init; } = [];

    // ── Section debug ──────────────────────────────────────────────────────
    /// <summary>Correspondance PC → ligne source (longueur = Code.Count).</summary>
    public IReadOnlyList<int> LineInfo { get; init; } = [];
    /// <summary>Variables locales.</summary>
    public IReadOnlyList<LuaLocal> LocVars { get; init; } = [];

    /// <summary>Vrai si la section debug a été strippée.</summary>
    public bool IsStripped => LineInfo.Count == 0 && LocVars.Count == 0;
}

// ── Chunk ─────────────────────────────────────────────────────────────────────
/// <summary>Chunk Lua complet (en-tête + proto principal).</summary>
public sealed record LuaChunk(LuaHeader Header, LuaProto Main);
