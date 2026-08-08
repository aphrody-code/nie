using System.Text;
using static IECODE.Core.Formats.Lua.LuaConstants;

namespace IECODE.Core.Formats.Lua;

/// <summary>
/// Désassembleur bytecode Lua 5.2 : génère un listing lisible type <c>luac -l</c>.
/// </summary>
public static class LuaDisassembler
{
    // ── Point d'entrée ────────────────────────────────────────────────────────
    /// <summary>
    /// Désassemble un chunk complet (proto principal + sous-protos récursifs).
    /// </summary>
    public static string Disassemble(LuaChunk chunk)
    {
        var sb = new StringBuilder();
        DisassembleProto(sb, chunk.Main, 0, "@main");
        return sb.ToString();
    }

    /// <summary>Désassemble un unique proto (sans récursion).</summary>
    public static string DisassembleProto(LuaProto proto, string label = "")
    {
        var sb = new StringBuilder();
        DisassembleProto(sb, proto, 0, label);
        return sb.ToString();
    }

    // ── Formatage d'une instruction ───────────────────────────────────────────
    /// <summary>
    /// Retourne la représentation lisible d'une instruction (colonne opcode + opérandes).
    /// Reproduit fidèlement le format de <c>luac -l</c>.
    /// </summary>
    public static string FormatInstruction(LuaInstruction instr)
    {
        return instr.Opcode switch
        {
            // iA
            Opcode.LOADKX   => $"LOADKX\t{instr.A}",
            // iABx
            Opcode.LOADK    => $"LOADK\t{instr.A}\t{instr.Bx}",
            Opcode.CLOSURE  => $"CLOSURE\t{instr.A}\t{instr.Bx}",
            // iAsBx
            Opcode.JMP      => $"JMP\t{instr.A}\t{instr.sBx}",
            Opcode.FORLOOP  => $"FORLOOP\t{instr.A}\t{instr.sBx}",
            Opcode.FORPREP  => $"FORPREP\t{instr.A}\t{instr.sBx}",
            Opcode.TFORLOOP => $"TFORLOOP\t{instr.A}\t{instr.sBx}",
            // iABC
            Opcode.MOVE     => $"MOVE\t{instr.A}\t{instr.B}",
            Opcode.LOADBOOL => $"LOADBOOL\t{instr.A}\t{instr.B}\t{instr.C}",
            Opcode.LOADNIL  => $"LOADNIL\t{instr.A}\t{instr.B}",
            Opcode.GETUPVAL => $"GETUPVAL\t{instr.A}\t{instr.B}",
            Opcode.SETUPVAL => $"SETUPVAL\t{instr.A}\t{instr.B}",
            Opcode.GETTABUP => $"GETTABUP\t{instr.A}\t{instr.B}\t{instr.C}",
            Opcode.SETTABUP => $"SETTABUP\t{instr.A}\t{instr.B}\t{instr.C}",
            Opcode.GETTABLE => $"GETTABLE\t{instr.A}\t{instr.B}\t{instr.C}",
            Opcode.SETTABLE => $"SETTABLE\t{instr.A}\t{instr.B}\t{instr.C}",
            Opcode.NEWTABLE => $"NEWTABLE\t{instr.A}\t{instr.B}\t{instr.C}",
            Opcode.SELF     => $"SELF\t{instr.A}\t{instr.B}\t{instr.C}",
            Opcode.ADD      => $"ADD\t{instr.A}\t{instr.B}\t{instr.C}",
            Opcode.SUB      => $"SUB\t{instr.A}\t{instr.B}\t{instr.C}",
            Opcode.MUL      => $"MUL\t{instr.A}\t{instr.B}\t{instr.C}",
            Opcode.DIV      => $"DIV\t{instr.A}\t{instr.B}\t{instr.C}",
            Opcode.MOD      => $"MOD\t{instr.A}\t{instr.B}\t{instr.C}",
            Opcode.POW      => $"POW\t{instr.A}\t{instr.B}\t{instr.C}",
            Opcode.UNM      => $"UNM\t{instr.A}\t{instr.B}",
            Opcode.NOT      => $"NOT\t{instr.A}\t{instr.B}",
            Opcode.LEN      => $"LEN\t{instr.A}\t{instr.B}",
            Opcode.CONCAT   => $"CONCAT\t{instr.A}\t{instr.B}\t{instr.C}",
            Opcode.EQ       => $"EQ\t{instr.A}\t{instr.B}\t{instr.C}",
            Opcode.LT       => $"LT\t{instr.A}\t{instr.B}\t{instr.C}",
            Opcode.LE       => $"LE\t{instr.A}\t{instr.B}\t{instr.C}",
            Opcode.TEST     => $"TEST\t{instr.A}\t{instr.C}",
            Opcode.TESTSET  => $"TESTSET\t{instr.A}\t{instr.B}\t{instr.C}",
            Opcode.CALL     => $"CALL\t{instr.A}\t{instr.B}\t{instr.C}",
            Opcode.TAILCALL => $"TAILCALL\t{instr.A}\t{instr.B}\t{instr.C}",
            Opcode.RETURN   => $"RETURN\t{instr.A}\t{instr.B}",
            Opcode.TFORCALL => $"TFORCALL\t{instr.A}\t{instr.C}",
            Opcode.SETLIST  => $"SETLIST\t{instr.A}\t{instr.B}\t{instr.C}",
            Opcode.VARARG   => $"VARARG\t{instr.A}\t{instr.B}",
            Opcode.EXTRAARG => $"EXTRAARG\t{instr.Ax}",
            _ => $"[OPCODE_{(byte)instr.Opcode}]\t{instr.A}\t{instr.B}\t{instr.C}",
        };
    }

    // ── Annotation constante RK ───────────────────────────────────────────────
    /// <summary>
    /// Retourne l'annotation "K(n)=val" pour un opérande B ou C qui peut
    /// référencer la table des constantes (bit 8 = 1 → RK(x) = K(x-256)).
    /// </summary>
    private static string RkHint(int rk, IReadOnlyList<LuaConstant> consts)
    {
        if ((rk & 0x100) != 0)
        {
            int idx = rk & 0xFF;
            if (idx < consts.Count)
                return $"K({idx}) = {consts[idx]}";
        }
        return string.Empty;
    }

    // ── Désassemblage récursif ────────────────────────────────────────────────
    private static void DisassembleProto(StringBuilder sb, LuaProto proto, int depth, string label)
    {
        string indent = new(' ', depth * 2);

        // En-tête du proto
        string src = proto.Source ?? "(?)";
        sb.AppendLine($"{indent}function <{src}:{proto.LineDefined},{proto.LastLineDefined}> ({proto.Code.Count} instructions at 0x?)");
        sb.AppendLine($"{indent}{proto.NumParams} param(s), {proto.IsVararg} is_vararg, {proto.MaxStackSize} slots");

        // Instructions
        for (int i = 0; i < proto.Code.Count; i++)
        {
            var instr = proto.Code[i];
            int line  = (proto.LineInfo.Count > i) ? proto.LineInfo[i] : 0;
            string lineStr = line > 0 ? $"[{line,4}]" : "[   ?]";
            string asm  = FormatInstruction(instr);

            // Annotation RK pour opérandes B/C si applicable
            var hints = new List<string>();
            switch (instr.Opcode)
            {
                case Opcode.GETTABUP:
                case Opcode.SETTABUP:
                case Opcode.GETTABLE:
                case Opcode.SETTABLE:
                case Opcode.ADD: case Opcode.SUB: case Opcode.MUL: case Opcode.DIV:
                case Opcode.MOD: case Opcode.POW: case Opcode.EQ:  case Opcode.LT: case Opcode.LE:
                    {
                        string hb = RkHint(instr.B, proto.Constants);
                        string hc = RkHint(instr.C, proto.Constants);
                        if (!string.IsNullOrEmpty(hb)) hints.Add(hb);
                        if (!string.IsNullOrEmpty(hc)) hints.Add(hc);
                    }
                    break;
                case Opcode.LOADK:
                    if (instr.Bx < proto.Constants.Count)
                        hints.Add(proto.Constants[instr.Bx].ToString());
                    break;
                case Opcode.CLOSURE:
                    if (instr.Bx < proto.Protos.Count)
                        hints.Add($"proto[{instr.Bx}]");
                    break;
            }

            string hint = hints.Count > 0 ? $"\t; {string.Join(", ", hints)}" : "";
            sb.AppendLine($"{indent}\t{i + 1,4}\t{lineStr}\t{asm}{hint}");
        }

        // Constantes
        sb.AppendLine($"{indent}constants ({proto.Constants.Count}) for 0x?:");
        for (int i = 0; i < proto.Constants.Count; i++)
            sb.AppendLine($"{indent}\t{i + 1}\t{proto.Constants[i]}");

        // Locaux
        sb.AppendLine($"{indent}locals ({proto.LocVars.Count}) for 0x?:");
        for (int i = 0; i < proto.LocVars.Count; i++)
        {
            var lv = proto.LocVars[i];
            sb.AppendLine($"{indent}\t{i}\t{lv.Name}\t{lv.PcStart + 1}\t{lv.PcEnd + 1}");
        }

        // Upvalues
        sb.AppendLine($"{indent}upvalues ({proto.Upvalues.Count}) for 0x?:");
        for (int i = 0; i < proto.Upvalues.Count; i++)
        {
            var uv = proto.Upvalues[i];
            sb.AppendLine($"{indent}\t{i}\t{uv.Name ?? "(unnamed)"}\t{(uv.InStack ? 1 : 0)}\t{uv.Idx}");
        }

        // Sous-protos
        foreach (var child in proto.Protos)
        {
            sb.AppendLine();
            DisassembleProto(sb, child, depth, child.Source ?? "");
        }
    }

    // ── Résumé compact ────────────────────────────────────────────────────────
    /// <summary>
    /// Résumé compact d'un chunk (nb protos, constantes, upvalues).
    /// Utile pour la commande <c>iecode lua info</c>.
    /// </summary>
    public static string Summary(LuaChunk chunk)
    {
        var sb = new StringBuilder();
        static void Walk(StringBuilder s, LuaProto p, int depth)
        {
            string indent = new(' ', depth * 2);
            string src  = p.Source is null or "" ? "(stripped)" : p.Source;
            s.AppendLine($"{indent}proto [{src}:{p.LineDefined}] — {p.Code.Count} instrs, {p.Constants.Count} consts, {p.Upvalues.Count} upvals, {p.Protos.Count} protos");
            foreach (var child in p.Protos) Walk(s, child, depth + 1);
        }
        sb.AppendLine($"Lua 5.2 chunk | endian=LE intSize={chunk.Header.IntSize} size_t={chunk.Header.SizeTSize} numSize={chunk.Header.NumberSize} float={chunk.Header.IsFloat}");
        Walk(sb, chunk.Main, 0);
        return sb.ToString();
    }
}
