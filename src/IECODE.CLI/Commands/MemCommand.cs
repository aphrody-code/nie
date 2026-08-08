using System.CommandLine;
using System.Globalization;
using System.Text;
using IECODE.Core.Runtime;

// WineMemory est [SupportedOSPlatform("linux")] ; chaque handler est gardé au runtime par
// Preflight() (OperatingSystem.IsLinux() → message + sortie). On supprime donc CA1416 ici :
// l'invocation est impossible hors Linux, et c'est volontairement une commande Linux-only.
#pragma warning disable CA1416

namespace IECODE.CLI.Commands;

/// <summary>
/// Commande <c>mem</c> — lit/scanne la mémoire LIVE d'un processus Wine (par défaut nie.exe)
/// via <see cref="WineMemory"/> (process_vm_readv, sans stopper la cible). Pour le reverse
/// engineering en direct : résolution de base de module, hex dump, dump de plages, scan de motif.
/// S'ATTACHE à un processus existant — ne lance jamais le jeu.
/// </summary>
public static class MemCommand
{
    public static Command Create()
    {
        var command = new Command("mem",
            "Lit/scanne la mémoire live d'un process Wine (nie.exe) via process_vm_readv — RE en direct");

        var pidOption = new Option<int>(["--pid", "-p"], () => 0, "PID cible (défaut : auto-détecte nie.exe)");
        var moduleOption = new Option<string>(["--module", "-m"], () => "nie.exe", "Fragment de nom de module (défaut nie.exe)");
        var allOption = new Option<bool>(["--all"], () => false, "Toutes les plages du process (pas seulement le module)");

        // ── maps ────────────────────────────────────────────────────────────────
        var mapsCmd = new Command("maps", "Liste les plages mémoire (filtrées par --module sauf --all)");
        mapsCmd.AddOption(pidOption); mapsCmd.AddOption(moduleOption); mapsCmd.AddOption(allOption);
        mapsCmd.SetHandler(Maps, pidOption, moduleOption, allOption);
        command.AddCommand(mapsCmd);

        // ── base ────────────────────────────────────────────────────────────────
        var baseCmd = new Command("base", "Affiche l'adresse de chargement (base) d'un module");
        baseCmd.AddOption(pidOption); baseCmd.AddOption(moduleOption);
        baseCmd.SetHandler(BaseAddr, pidOption, moduleOption);
        command.AddCommand(baseCmd);

        // ── read ────────────────────────────────────────────────────────────────
        var readCmd = new Command("read", "Lit des octets à une adresse (hex dump, ou -o fichier brut)");
        var addrArg = new Argument<string>("addr", "Adresse 0x… ou module-relative 'nie.exe+0xF600CA'");
        readCmd.AddArgument(addrArg);
        var lenOption = new Option<int>(["--len", "-n"], () => 256, "Nb d'octets à lire");
        var readOut = new Option<string?>(["--output", "-o"], "Écrire les octets bruts ici (sinon hex dump stdout)");
        readCmd.AddOption(lenOption); readCmd.AddOption(pidOption); readCmd.AddOption(readOut);
        readCmd.SetHandler(Read, addrArg, lenOption, pidOption, readOut);
        command.AddCommand(readCmd);

        // ── dump ────────────────────────────────────────────────────────────────
        var dumpCmd = new Command("dump", "Dumpe les plages lisibles (module ou --all) vers un dossier");
        var dumpOut = new Option<string>(["--output", "-o"], () => "./memdump", "Dossier de sortie");
        dumpCmd.AddOption(pidOption); dumpCmd.AddOption(moduleOption); dumpCmd.AddOption(allOption); dumpCmd.AddOption(dumpOut);
        dumpCmd.SetHandler(Dump, pidOption, moduleOption, allOption, dumpOut);
        command.AddCommand(dumpCmd);

        // ── scan ────────────────────────────────────────────────────────────────
        var scanCmd = new Command("scan", "Cherche un motif : hex '48 8B 0D' ou 'str:Closing application'");
        var patArg = new Argument<string>("pattern", "Motif hex ('DE AD BE EF') ou texte ('str:…')");
        var limitOpt = new Option<int>(["--limit", "-l"], () => 20, "Nb max de hits affichés");
        scanCmd.AddArgument(patArg);
        scanCmd.AddOption(pidOption); scanCmd.AddOption(moduleOption); scanCmd.AddOption(allOption); scanCmd.AddOption(limitOpt);
        scanCmd.SetHandler(Scan, patArg, pidOption, moduleOption, allOption, limitOpt);
        command.AddCommand(scanCmd);

        return command;
    }

    // ─── Handlers ────────────────────────────────────────────────────────────────

    private static void Maps(int pid, string module, bool all)
    {
        if (!Preflight(ref pid)) return;
        var maps = ModuleMaps(pid, module, all);
        long total = 0;
        foreach (var m in maps)
        {
            total += (long)m.Size;
            Console.WriteLine($"  0x{m.Start:x12}-0x{m.End:x12}  {m.Perms}  {m.Size,12:N0}  {m.Path}");
        }
        Console.WriteLine($"\n  {maps.Count} plage(s), {total:N0} octets" + (all ? "" : $" (module « {module} »)"));
    }

    private static void BaseAddr(int pid, string module)
    {
        if (!Preflight(ref pid)) return;
        var b = WineMemory.FindModuleBase(pid, module);
        if (b is { } baseAddr)
            Console.WriteLine($"  {module} @ 0x{baseAddr:x} (pid {pid})");
        else
        {
            Console.Error.WriteLine($"Module « {module} » introuvable dans /proc/{pid}/maps");
            Environment.ExitCode = 1;
        }
    }

    private static void Read(string addr, int len, int pid, string? output)
    {
        if (!Preflight(ref pid)) return;
        if (!TryResolveAddr(addr, pid, out var address)) return;

        var buf = new byte[len];
        var got = WineMemory.Read(pid, address, buf);
        if (got <= 0) { Console.Error.WriteLine("0 octet lu (plage non mappée ?)"); Environment.ExitCode = 1; return; }

        if (!string.IsNullOrEmpty(output))
        {
            File.WriteAllBytes(output, buf.AsSpan(0, got).ToArray());
            Console.WriteLine($"  {got:N0} octets @ 0x{address:x} → {Path.GetFullPath(output)}");
            return;
        }
        HexDump(buf.AsSpan(0, got), address);
    }

    private static void Dump(int pid, string module, bool all, string output)
    {
        if (!Preflight(ref pid)) return;
        Directory.CreateDirectory(output);
        var maps = ModuleMaps(pid, module, all);

        int regions = 0; long bytes = 0;
        foreach (var m in maps)
        {
            if (!m.IsReadable || m.Size == 0) continue;
            var buf = new byte[m.Size];
            int got;
            try { got = WineMemory.Read(pid, m.Start, buf); }
            catch (WineMemoryException) { continue; } // plage volatile/refusée : on saute
            if (got <= 0) continue;
            var name = $"{m.Start:x12}-{m.End:x12}.bin";
            File.WriteAllBytes(Path.Combine(output, name), buf.AsSpan(0, got).ToArray());
            regions++; bytes += got;
        }
        Console.WriteLine($"  {regions} plage(s) dumpée(s), {bytes:N0} octets → {Path.GetFullPath(output)}");
    }

    private static void Scan(string pattern, int pid, string module, bool all, int limit)
    {
        if (!Preflight(ref pid)) return;
        if (!TryParsePattern(pattern, out var needle, out var label)) return;

        var maps = ModuleMaps(pid, module, all);
        var baseAddr = WineMemory.FindModuleBase(pid, module);
        int hits = 0;
        foreach (var m in maps)
        {
            if (!m.IsReadable || m.Size == 0 || hits >= limit) continue;
            var buf = new byte[m.Size];
            int got;
            try { got = WineMemory.Read(pid, m.Start, buf); }
            catch (WineMemoryException) { continue; }
            var span = buf.AsSpan(0, got);
            int from = 0;
            while (hits < limit)
            {
                var idx = span[from..].IndexOf(needle);
                if (idx < 0) break;
                var at = m.Start + (ulong)(from + idx);
                var rva = baseAddr is { } b && at >= b ? $" ({module}+0x{at - b:x})" : "";
                Console.WriteLine($"  0x{at:x12}{rva}  [{m.Perms}]");
                hits++;
                from += idx + 1;
            }
        }
        Console.WriteLine($"\n  {hits} hit(s) pour {label}" + (hits >= limit ? $" (limité à {limit})" : ""));
    }

    // ─── Aides ──────────────────────────────────────────────────────────────────

    /// <summary>Résout/valide le pid + vérifie la permission ptrace. Renvoie false (et message) si KO.</summary>
    private static bool Preflight(ref int pid)
    {
        if (!OperatingSystem.IsLinux())
        {
            Console.Error.WriteLine("La commande mem est Linux-only (process_vm_readv).");
            Environment.ExitCode = 1;
            return false;
        }
        if (pid <= 0)
        {
            pid = FindPidByComm("nie.exe");
            if (pid <= 0)
            {
                Console.Error.WriteLine("nie.exe introuvable. Lance le jeu (boot-nie-direct.sh) ou précise --pid.");
                Environment.ExitCode = 1;
                return false;
            }
            Console.Error.WriteLine($"# nie.exe → pid {pid}");
        }
        if (!Directory.Exists($"/proc/{pid}"))
        {
            Console.Error.WriteLine($"pid {pid} inexistant.");
            Environment.ExitCode = 1;
            return false;
        }
        if (!WineMemory.LikelyPermitted(pid))
        {
            var scope = WineMemory.ReadPtraceScope();
            Console.Error.WriteLine(
                $"# Attention: ptrace_scope={scope} et le lecteur n'est pas ancêtre de {pid}. " +
                "Lecture probablement refusée (EPERM). Remède: `echo 0 | sudo tee /proc/sys/kernel/yama/ptrace_scope`.");
        }
        return true;
    }

    /// <summary>
    /// Plages pertinentes : tout le process si <paramref name="all"/>, sinon l'IMAGE COMPLÈTE du
    /// module. Sous Wine, seul l'en-tête PE porte le chemin dans <c>/proc/maps</c> ; on borne donc
    /// par <c>[base, base+SizeOfImage)</c> (lu dans l'en-tête PE en mémoire) et on garde toutes les
    /// plages qui l'intersectent — sinon un scan « module » ne verrait que la page d'en-tête.
    /// </summary>
    private static IReadOnlyList<WineMemory.MapEntry> ModuleMaps(int pid, string module, bool all)
    {
        if (all) return WineMemory.ReadMaps(pid);
        var range = ModuleImageRange(pid, module);
        if (range is not { } r || r.End <= r.Base)
            return WineMemory.FindModuleRegions(pid, module); // fallback : au moins l'en-tête
        var result = new List<WineMemory.MapEntry>();
        foreach (var m in WineMemory.ReadMaps(pid))
            if (m.Start < r.End && m.End > r.Base) // intersecte l'image
                result.Add(m);
        return result;
    }

    /// <summary>Étendue VA <c>[base, base+SizeOfImage)</c> du module, via l'en-tête PE en mémoire.</summary>
    private static (ulong Base, ulong End)? ModuleImageRange(int pid, string module)
    {
        var b = WineMemory.FindModuleBase(pid, module);
        if (b is not { } baseAddr) return null;
        try
        {
            var dos = WineMemory.ReadExact(pid, baseAddr, 0x40);
            var lfanew = BitConverter.ToInt32(dos, 0x3c);
            if (lfanew is <= 0 or > 0x1000) return (baseAddr, baseAddr);
            // PE32/PE32+ : OptionalHeader.SizeOfImage à l'offset 0x50 après e_lfanew.
            var sizeOfImage = WineMemory.ReadStruct<uint>(pid, baseAddr + (ulong)lfanew + 0x50);
            return sizeOfImage == 0 ? (baseAddr, baseAddr) : (baseAddr, baseAddr + sizeOfImage);
        }
        catch (WineMemoryException) { return (baseAddr, baseAddr); }
    }

    /// <summary>Trouve le premier pid dont <c>/proc/&lt;pid&gt;/comm</c> vaut <paramref name="comm"/>.</summary>
    private static int FindPidByComm(string comm)
    {
        foreach (var dir in Directory.EnumerateDirectories("/proc"))
        {
            var name = Path.GetFileName(dir);
            if (!int.TryParse(name, out var pid)) continue;
            try
            {
                var c = File.ReadAllText($"/proc/{pid}/comm").Trim();
                if (string.Equals(c, comm, StringComparison.Ordinal))
                    return pid;
            }
            catch { /* process disparu / non lisible */ }
        }
        return 0;
    }

    /// <summary>Parse "0x…" (absolu) ou "module+0xRVA" (résolu via la base du module).</summary>
    private static bool TryResolveAddr(string addr, int pid, out ulong address)
    {
        address = 0;
        var s = addr.Trim();
        var plus = s.IndexOf('+');
        if (plus > 0)
        {
            var mod = s[..plus];
            var rvaStr = s[(plus + 1)..];
            if (!TryParseHex(rvaStr, out var rva)) { Err($"RVA invalide: {rvaStr}"); return false; }
            var b = WineMemory.FindModuleBase(pid, mod);
            if (b is not { } baseAddr) { Err($"Module « {mod} » introuvable"); return false; }
            address = baseAddr + rva;
            return true;
        }
        if (!TryParseHex(s, out address)) { Err($"Adresse invalide: {s}"); return false; }
        return true;
    }

    private static bool TryParseHex(string s, out ulong value)
    {
        s = s.Trim();
        if (s.StartsWith("0x", StringComparison.OrdinalIgnoreCase)) s = s[2..];
        return ulong.TryParse(s, NumberStyles.HexNumber, CultureInfo.InvariantCulture, out value);
    }

    /// <summary>
    /// Parse un motif : <c>str:texte</c> (UTF-8), <c>wstr:texte</c> (UTF-16LE, cas des chaînes
    /// Windows du jeu), ou octets hex <c>48 8B 0D</c> / <c>488b0d</c>.
    /// </summary>
    private static bool TryParsePattern(string pattern, out byte[] needle, out string label)
    {
        needle = []; label = "";
        if (pattern.StartsWith("wstr:", StringComparison.Ordinal))
        {
            var text = pattern[5..];
            needle = Encoding.Unicode.GetBytes(text); // UTF-16LE
            label = $"wstr \"{text}\"";
            return needle.Length > 0 || Fail(out label);
        }
        if (pattern.StartsWith("str:", StringComparison.Ordinal))
        {
            var text = pattern[4..];
            needle = Encoding.UTF8.GetBytes(text);
            label = $"\"{text}\"";
            return needle.Length > 0 || Fail(out label);
        }
        var hex = pattern.Replace(" ", "").Replace("-", "");
        if (hex.Length == 0 || hex.Length % 2 != 0) { Err("Motif hex de longueur impaire/vide"); return false; }
        var bytes = new byte[hex.Length / 2];
        for (var i = 0; i < bytes.Length; i++)
            if (!byte.TryParse(hex.AsSpan(i * 2, 2), NumberStyles.HexNumber, CultureInfo.InvariantCulture, out bytes[i]))
            { Err($"Octet hex invalide à {i}"); return false; }
        needle = bytes;
        label = "hex " + BitConverter.ToString(bytes);
        return true;
    }

    private static bool Fail(out string label) { label = ""; Err("Motif str: vide"); return false; }

    private static void HexDump(ReadOnlySpan<byte> data, ulong baseAddr)
    {
        for (var off = 0; off < data.Length; off += 16)
        {
            var line = data.Slice(off, Math.Min(16, data.Length - off));
            var sb = new StringBuilder();
            sb.Append($"  0x{baseAddr + (ulong)off:x12}  ");
            for (var i = 0; i < 16; i++)
                sb.Append(i < line.Length ? $"{line[i]:x2} " : "   ");
            sb.Append(' ');
            foreach (var b in line)
                sb.Append(b is >= 0x20 and < 0x7f ? (char)b : '.');
            Console.WriteLine(sb.ToString());
        }
    }

    private static void Err(string msg) { Console.Error.WriteLine(msg); Environment.ExitCode = 1; }
}
