namespace IECODE.Core.Formats.Lua;

/// <summary>
/// Constantes du format bytecode Lua 5.2 (lundump.h / lopcodes.h).
/// </summary>
public static class LuaConstants
{
    // ── En-tête ─────────────────────────────────────────────────────────────
    /// <summary>Signature : "\x1bLua"</summary>
    public static ReadOnlySpan<byte> Signature => "\x1bLua"u8;

    /// <summary>Version Lua 5.2 : 0x52</summary>
    public const byte Version52 = 0x52;

    /// <summary>Format officiel : 0</summary>
    public const byte FormatOfficial = 0x00;

    /// <summary>Marque de fin d'en-tête (LUAC_TAIL) : 0x19 0x93 \r \n \x1a \n</summary>
    public static ReadOnlySpan<byte> LuacTail => new byte[] { 0x19, 0x93, 0x0D, 0x0A, 0x1A, 0x0A };

    // ── Tailles de champs attendues pour IEVR (x64, little-endian) ─────────
    public const byte IntSize = 4;
    public const byte SizeTSize = 8;
    public const byte InstructionSize = 4;
    public const byte NumberSize = 8;
    public const byte IntegralFlag = 0;   // 0 = double flotant

    // ── Types de constantes (LUA_T*) ─────────────────────────────────────
    public const byte ConstNil     = 0;
    public const byte ConstBoolean = 1;
    public const byte ConstNumber  = 3;
    public const byte ConstString  = 4;

    // ── Format instruction (bits dans un uint32 LE) ──────────────────────
    //   bits  0- 5 : opcode (6 bits)
    //   bits  6-13 : A (8 bits)
    //   bits 14-22 : C (9 bits)
    //   bits 23-31 : B (9 bits)
    //   Bx = B<<9|C (18 bits)  sBx = Bx - 131071

    public const int OpcodeMask  = 0x3F;
    public const int OpcodeShift = 0;
    public const int AMask       = 0xFF;
    public const int AShift      = 6;
    public const int CMask       = 0x1FF;
    public const int CShift      = 14;
    public const int BMask       = 0x1FF;
    public const int BShift      = 23;
    public const int BxMax       = (1 << 18) - 1; // 262143
    public const int SBxBias     = 131071;         // Bx_MAX >> 1

    // ── Opcode Lua 5.2 (40 opcodes, index = numéro) ──────────────────────
    public enum Opcode : byte
    {
        MOVE      = 0,
        LOADK     = 1,
        LOADKX    = 2,
        LOADBOOL  = 3,
        LOADNIL   = 4,
        GETUPVAL  = 5,
        GETTABUP  = 6,
        GETTABLE  = 7,
        SETTABUP  = 8,
        SETUPVAL  = 9,
        SETTABLE  = 10,
        NEWTABLE  = 11,
        SELF      = 12,
        ADD       = 13,
        SUB       = 14,
        MUL       = 15,
        DIV       = 16,
        MOD       = 17,
        POW       = 18,
        UNM       = 19,
        NOT       = 20,
        LEN       = 21,
        CONCAT    = 22,
        JMP       = 23,
        EQ        = 24,
        LT        = 25,
        LE        = 26,
        TEST      = 27,
        TESTSET   = 28,
        CALL      = 29,
        TAILCALL  = 30,
        RETURN    = 31,
        FORLOOP   = 32,
        FORPREP   = 33,
        TFORCALL  = 34,
        TFORLOOP  = 35,
        SETLIST   = 36,
        CLOSURE   = 37,
        VARARG    = 38,
        EXTRAARG  = 39,
    }

    public static string OpcodeName(Opcode op) => op.ToString();
}
