using System.Buffers.Binary;
using System.Text;

namespace IECODE.Core.Formats.Lua;

/// <summary>
/// Parseur bytecode Lua 5.2 natif C#.
/// Implémente le format décrit dans lundump.c de Lua 5.2.1 et validé
/// contre unluac (référence Java).
///
/// Format Lua 5.2 (little-endian, x64) :
///   1. En-tête global (18 octets) :
///      \x1bLua  — signature (4)
///      0x52     — version (1)
///      0x00     — format (1)
///      0x01     — endianness (1 = LE)
///      0x04     — int_size (1)
///      0x08     — size_t size (1)
///      0x04     — instruction size (1)
///      0x08     — lua_Number size (1)
///      0x00     — integral flag (1)
///      0x19 0x93 0x0D 0x0A 0x1A 0x0A  — LUAC_TAIL (6)
///   2. Proto principal (LFunction52) :
///      lineDefined (int), lastLineDefined (int),
///      numParams (byte), isVararg (byte), maxStackSize (byte),
///      code[], constants[], upvalues[], protos[],
///      debug (source string, lineinfo[], locvars[], upvalue names[])
/// </summary>
public static class LuaParser
{
    // ── Vérification rapide ───────────────────────────────────────────────────
    /// <summary>Retourne true si les 5 premiers octets indiquent un chunk Lua 5.2.</summary>
    public static bool IsLua52(ReadOnlySpan<byte> data)
    {
        if (data.Length < 5) return false;
        return data[0] == 0x1B
            && data[1] == 0x4C  // 'L'
            && data[2] == 0x75  // 'u'
            && data[3] == 0x61  // 'a'
            && data[4] == LuaConstants.Version52;
    }

    // ── Point d'entrée ────────────────────────────────────────────────────────
    /// <summary>Parse un chunk Lua 5.2 depuis un tableau d'octets.</summary>
    /// <exception cref="LuaParseException">Si le format est invalide.</exception>
    public static LuaChunk Parse(byte[] data) => Parse(data.AsSpan());

    /// <inheritdoc cref="Parse(byte[])"/>
    public static LuaChunk Parse(ReadOnlySpan<byte> data)
    {
        var reader = new SpanReader(data);
        var header = ParseHeader(ref reader);
        var main   = ParseProto(ref reader);
        return new LuaChunk(header, main);
    }

    // ── En-tête ───────────────────────────────────────────────────────────────
    private static LuaHeader ParseHeader(ref SpanReader r)
    {
        // Signature \x1bLua
        foreach (var b in LuaConstants.Signature)
        {
            if (r.ReadByte() != b)
                throw new LuaParseException("Signature Lua invalide.");
        }

        // Version
        byte version = r.ReadByte();
        if (version != LuaConstants.Version52)
            throw new LuaParseException($"Version non supportée : 0x{version:X2} (attendu 0x52).");

        // Après version : format, endianness, int_size, size_t_size, instruction_size, number_size, integral_flag, tail
        byte format      = r.ReadByte();
        if (format != LuaConstants.FormatOfficial)
            throw new LuaParseException($"Format non standard : {format}.");

        byte endianness  = r.ReadByte();
        bool isLE        = endianness == 1;

        byte intSize     = r.ReadByte();
        byte sizeTSize   = r.ReadByte();
        byte instrSize   = r.ReadByte();
        byte numSize     = r.ReadByte();
        byte integralFlg = r.ReadByte();

        // LUAC_TAIL (6 octets)
        foreach (var b in LuaConstants.LuacTail)
        {
            if (r.ReadByte() != b)
                throw new LuaParseException("LUAC_TAIL invalide ou fichier corrompu.");
        }

        return new LuaHeader(
            Version:         version,
            Format:          format,
            IsLittleEndian:  isLE,
            IntSize:         intSize,
            SizeTSize:       sizeTSize,
            InstructionSize: instrSize,
            NumberSize:      numSize,
            IsFloat:         integralFlg == 0
        );
    }

    // ── Proto (LFunction52) ───────────────────────────────────────────────────
    private static LuaProto ParseProto(ref SpanReader r)
    {
        // Lua 5.2 (LFunctionType52.parse_main) :
        //   lineBegin (int), lineEnd (int),
        //   numParams (byte), isVararg (byte), maxStackSize (byte),
        //   code[], constants[], upvalues[], protos[],
        //   [debug : source (string), lineinfo[], locvars[], upvalue-names[]]

        int lineDefined     = r.ReadInt32LE();
        int lastLineDefined = r.ReadInt32LE();
        byte numParams      = r.ReadByte();
        byte isVararg       = r.ReadByte();
        byte maxStackSize   = r.ReadByte();

        // Code
        var code = ParseCode(ref r);

        // Lua 5.2 (LFunctionType52) : constants → sub-protos → upvalues
        // Conforme à parse_constants() d'unluac qui lit constants puis functions,
        // suivi de parse_upvalues() séparé.
        var constants = ParseConstants(ref r);
        var protos    = ParseProtos(ref r);
        var upvalues  = ParseUpvalues(ref r);

        // Debug (source name, lineinfo, locvars, upvalue names)
        var (source, lineInfo, locVars, upvalueNames) = ParseDebug(ref r, upvalues.Count);

        // Patch upvalue names
        var namedUpvalues = upvalues
            .Select((uv, i) => uv with { Name = i < upvalueNames.Count ? upvalueNames[i] : uv.Name })
            .ToList();

        // Si pas de debug info → première upvalue = _ENV (convention Lua 5.2)
        if (namedUpvalues.Count >= 1 && string.IsNullOrEmpty(namedUpvalues[0].Name))
            namedUpvalues[0] = namedUpvalues[0] with { Name = "_ENV" };

        return new LuaProto
        {
            Source          = source,
            LineDefined     = lineDefined,
            LastLineDefined = lastLineDefined,
            NumParams       = numParams,
            IsVararg        = isVararg,
            MaxStackSize    = maxStackSize,
            Code            = code,
            Constants       = constants,
            Upvalues        = namedUpvalues,
            Protos          = protos,
            LineInfo        = lineInfo,
            LocVars         = locVars,
        };
    }

    // ── Code ──────────────────────────────────────────────────────────────────
    private static List<LuaInstruction> ParseCode(ref SpanReader r)
    {
        int count = r.ReadInt32LE();
        var list  = new List<LuaInstruction>(count);
        for (int i = 0; i < count; i++)
        {
            uint raw = r.ReadUInt32LE();
            list.Add(LuaInstruction.Decode(raw));
        }
        return list;
    }

    // ── Constants ─────────────────────────────────────────────────────────────
    private static List<LuaConstant> ParseConstants(ref SpanReader r)
    {
        int count = r.ReadInt32LE();
        var list  = new List<LuaConstant>(count);
        for (int i = 0; i < count; i++)
            list.Add(ParseOneConstant(ref r));
        return list;
    }

    private static LuaConstant ParseOneConstant(ref SpanReader r)
    {
        byte type = r.ReadByte();
        return type switch
        {
            LuaConstants.ConstNil     => new LuaConstant.Nil(),
            LuaConstants.ConstBoolean => new LuaConstant.Bool(r.ReadByte() != 0),
            LuaConstants.ConstNumber  => new LuaConstant.Number(r.ReadDoubleLE()),
            LuaConstants.ConstString  => new LuaConstant.String(ReadLuaString(ref r)),
            _ => throw new LuaParseException($"Type de constante inconnu : {type}.")
        };
    }

    // ── Upvalues ──────────────────────────────────────────────────────────────
    private static List<LuaUpvalue> ParseUpvalues(ref SpanReader r)
    {
        int count = r.ReadInt32LE();
        var list  = new List<LuaUpvalue>(count);
        for (int i = 0; i < count; i++)
        {
            bool inStack = r.ReadByte() != 0;
            int  idx     = r.ReadByte();
            list.Add(new LuaUpvalue(inStack, idx));
        }
        return list;
    }

    // ── Sub-protos ────────────────────────────────────────────────────────────
    private static List<LuaProto> ParseProtos(ref SpanReader r)
    {
        int count = r.ReadInt32LE();
        var list  = new List<LuaProto>(count);
        for (int i = 0; i < count; i++)
            list.Add(ParseProto(ref r));
        return list;
    }

    // ── Section debug ─────────────────────────────────────────────────────────
    private static (string? source, List<int> lineInfo, List<LuaLocal> locVars, List<string> upvalueNames)
        ParseDebug(ref SpanReader r, int numUpvalues)
    {
        // Lua 5.2 : source (string), lineinfo (int[]), locvars, upvalue names
        string? source = ReadLuaStringNullable(ref r);

        // lineinfo
        int lineCount = r.ReadInt32LE();
        var lineInfo  = new List<int>(lineCount);
        for (int i = 0; i < lineCount; i++)
            lineInfo.Add(r.ReadInt32LE());

        // locvars
        int locCount = r.ReadInt32LE();
        var locVars  = new List<LuaLocal>(locCount);
        for (int i = 0; i < locCount; i++)
        {
            string name = ReadLuaString(ref r);
            int start   = r.ReadInt32LE();
            int end     = r.ReadInt32LE();
            locVars.Add(new LuaLocal(name, start, end));
        }

        // upvalue names
        int uvCount     = r.ReadInt32LE();
        var upvalNames  = new List<string>(uvCount);
        for (int i = 0; i < uvCount; i++)
            upvalNames.Add(ReadLuaString(ref r));

        return (source, lineInfo, locVars, upvalNames);
    }

    // ── Lecture de chaîne Lua (size_t = 8 octets, puis octets raw + \0) ───────
    private static string ReadLuaString(ref SpanReader r)
    {
        long size = r.ReadInt64LE();   // size_t (8 octets en x64)
        if (size == 0) return string.Empty;
        // La chaîne inclut le \0 terminal → on lit (size) octets puis on ignore le dernier
        var bytes = r.ReadBytes((int)size);
        // Lua stocke les octets bruts (Latin-1) ; on décode en UTF-8 best-effort
        return Encoding.Latin1.GetString(bytes[..((int)size - 1)]); // exclure le \0
    }

    private static string? ReadLuaStringNullable(ref SpanReader r)
    {
        long size = r.ReadInt64LE();
        if (size == 0) return null;
        var bytes = r.ReadBytes((int)size);
        return Encoding.Latin1.GetString(bytes[..((int)size - 1)]);
    }

    // ── Lecteur de span ──────────────────────────────────────────────────────
    private ref struct SpanReader
    {
        private ReadOnlySpan<byte> _data;
        private int _pos;

        public SpanReader(ReadOnlySpan<byte> data) { _data = data; _pos = 0; }

        public int Position => _pos;

        public byte ReadByte()
        {
            EnsureAvailable(1);
            return _data[_pos++];
        }

        public int ReadInt32LE()
        {
            EnsureAvailable(4);
            int v = BinaryPrimitives.ReadInt32LittleEndian(_data[_pos..]);
            _pos += 4;
            return v;
        }

        public uint ReadUInt32LE()
        {
            EnsureAvailable(4);
            uint v = BinaryPrimitives.ReadUInt32LittleEndian(_data[_pos..]);
            _pos += 4;
            return v;
        }

        public long ReadInt64LE()
        {
            EnsureAvailable(8);
            long v = BinaryPrimitives.ReadInt64LittleEndian(_data[_pos..]);
            _pos += 8;
            return v;
        }

        public double ReadDoubleLE()
        {
            EnsureAvailable(8);
            double v = BitConverter.Int64BitsToDouble(
                BinaryPrimitives.ReadInt64LittleEndian(_data[_pos..]));
            _pos += 8;
            return v;
        }

        public ReadOnlySpan<byte> ReadBytes(int count)
        {
            EnsureAvailable(count);
            var slice = _data.Slice(_pos, count);
            _pos += count;
            return slice;
        }

        private void EnsureAvailable(int n)
        {
            if (_pos + n > _data.Length)
                throw new LuaParseException(
                    $"Fin de fichier inattendue à l'offset 0x{_pos:X} (besoin de {n} octets).");
        }
    }
}

/// <summary>Exception levée lors d'une erreur de parsing Lua.</summary>
public sealed class LuaParseException(string message) : Exception(message);
