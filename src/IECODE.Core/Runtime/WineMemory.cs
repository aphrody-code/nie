using System.Buffers;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;

namespace IECODE.Core.Runtime;

/// <summary>
/// Lecture/écriture de la mémoire d'un processus Wine depuis Linux, sans <c>ptrace</c>
/// (pas de stop du processus) via <c>process_vm_readv(2)</c> / <c>process_vm_writev(2)</c>.
///
/// <para><b>Pourquoi ça marche pour le jeu Windows sous Wine.</b> Wine ne virtualise pas :
/// il charge le PE dans l'<i>espace d'adressage Linux du même processus</i>. Une adresse
/// virtuelle « Windows » <i>est</i> une adresse virtuelle Linux réelle. Donc lire la mémoire
/// du module PE = lire des plages de <c>/proc/&lt;pid&gt;/maps</c>. Aucune traduction d'adresse.</para>
///
/// <para><b>Contrainte ptrace (Yama).</b> Avec <c>kernel.yama.ptrace_scope=1</c> (cas du VPS),
/// <c>process_vm_readv</c> n'est autorisé que si l'appelant est un <b>ancêtre</b> du processus
/// cible, ou détient <c>CAP_SYS_PTRACE</c>. C'est la justification de l'architecture
/// « le worker C# <i>lance</i> le jeu » (cf. <see cref="GameSession"/> côté Bun et la note
/// AT_SECURE) : en étant le parent, on lit la mémoire <b>sans aucune capability</b> et sans
/// <c>setcap</c> — ce qui éviterait de casser l'environnement Vulkan (AT_SECURE ignore
/// <c>VK_DRIVER_FILES</c>). Si le lanceur n'est pas ancêtre, il faut <c>CAP_SYS_PTRACE</c>
/// sur le <i>lecteur</i> (binaire séparé qui ne fait PAS de Vulkan), ou
/// <c>ptrace_scope=0</c>.</para>
///
/// <para>Linux-only. Sur Windows/macOS les <c>[DllImport("libc")]</c> n'existent pas ;
/// la classe est gardée <see cref="SupportedOSPlatformAttribute"/>.</para>
/// </summary>
[SupportedOSPlatform("linux")]
public static class WineMemory
{
    // ─── P/Invoke libc ───────────────────────────────────────────────────────────
    // ssize_t process_vm_readv(pid_t pid,
    //                          const struct iovec *local_iov, unsigned long liovcnt,
    //                          const struct iovec *remote_iov, unsigned long riovcnt,
    //                          unsigned long flags);
    [StructLayout(LayoutKind.Sequential)]
    private struct IoVec
    {
        public nint Base;   // void*
        public nuint Len;   // size_t
    }

    [DllImport("libc", SetLastError = true)]
    private static extern nint process_vm_readv(
        int pid,
        ref IoVec localIov, nuint liovcnt,
        ref IoVec remoteIov, nuint riovcnt,
        nuint flags);

    [DllImport("libc", SetLastError = true)]
    private static extern nint process_vm_writev(
        int pid,
        ref IoVec localIov, nuint liovcnt,
        ref IoVec remoteIov, nuint riovcnt,
        nuint flags);

    /// <summary>
    /// Lit <paramref name="length"/> octets à l'adresse virtuelle <paramref name="remoteAddress"/>
    /// du processus <paramref name="pid"/> dans <paramref name="destination"/>. Ne stoppe pas
    /// la cible. Renvoie le nombre d'octets effectivement lus (peut être &lt; length si la plage
    /// chevauche un trou non mappé). Lève <see cref="WineMemoryException"/> si l'appel échoue.
    /// </summary>
    public static unsafe int Read(int pid, ulong remoteAddress, Span<byte> destination)
    {
        if (destination.IsEmpty)
            return 0;

        fixed (byte* local = destination)
        {
            var localIov = new IoVec { Base = (nint)local, Len = (nuint)destination.Length };
            var remoteIov = new IoVec { Base = (nint)remoteAddress, Len = (nuint)destination.Length };
            var n = process_vm_readv(pid, ref localIov, 1, ref remoteIov, 1, 0);
            if (n < 0)
                throw WineMemoryException.FromErrno(pid, remoteAddress, destination.Length, isWrite: false);
            return (int)n;
        }
    }

    /// <summary>
    /// Lit exactement <paramref name="length"/> octets ou lève (lecture partielle = échec).
    /// Pratique pour déréférencer une struct/pointeur.
    /// </summary>
    public static byte[] ReadExact(int pid, ulong remoteAddress, int length)
    {
        var buf = new byte[length];
        var got = Read(pid, remoteAddress, buf);
        if (got != length)
            throw new WineMemoryException(
                $"process_vm_readv lecture partielle pid={pid} addr=0x{remoteAddress:x} " +
                $"demandé={length} lu={got}");
        return buf;
    }

    /// <summary>Lit une valeur non managée (int, long, struct POD…) à l'adresse donnée.</summary>
    public static unsafe T ReadStruct<T>(int pid, ulong remoteAddress) where T : unmanaged
    {
        var size = sizeof(T);
        var rented = ArrayPool<byte>.Shared.Rent(size);
        try
        {
            var span = rented.AsSpan(0, size);
            var got = Read(pid, remoteAddress, span);
            if (got != size)
                throw new WineMemoryException(
                    $"ReadStruct<{typeof(T).Name}> partielle pid={pid} addr=0x{remoteAddress:x} " +
                    $"taille={size} lu={got}");
            return MemoryMarshal.Read<T>(span);
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(rented);
        }
    }

    /// <summary>
    /// Écrit <paramref name="source"/> à l'adresse virtuelle <paramref name="remoteAddress"/>.
    /// Mêmes contraintes ptrace que <see cref="Read"/>. La page doit être inscriptible côté cible.
    /// Renvoie le nombre d'octets écrits. À utiliser avec parcimonie (RE/patch live).
    /// </summary>
    public static unsafe int Write(int pid, ulong remoteAddress, ReadOnlySpan<byte> source)
    {
        if (source.IsEmpty)
            return 0;

        fixed (byte* local = source)
        {
            var localIov = new IoVec { Base = (nint)local, Len = (nuint)source.Length };
            var remoteIov = new IoVec { Base = (nint)remoteAddress, Len = (nuint)source.Length };
            var n = process_vm_writev(pid, ref localIov, 1, ref remoteIov, 1, 0);
            if (n < 0)
                throw WineMemoryException.FromErrno(pid, remoteAddress, source.Length, isWrite: true);
            return (int)n;
        }
    }

    // ─── Résolution de la base d'un module via /proc/<pid>/maps ───────────────────

    /// <summary>
    /// Une plage mappée de <c>/proc/&lt;pid&gt;/maps</c>.
    /// </summary>
    public readonly record struct MapEntry(
        ulong Start,
        ulong End,
        string Perms,
        ulong Offset,
        string Path)
    {
        public ulong Size => End - Start;
        public bool IsExecutable => Perms.Length >= 3 && Perms[2] == 'x';
        public bool IsReadable => Perms.Length >= 1 && Perms[0] == 'r';
        public bool IsWritable => Perms.Length >= 2 && Perms[1] == 'w';
    }

    /// <summary>
    /// Parse toutes les lignes de <c>/proc/&lt;pid&gt;/maps</c>. Une ligne ressemble à :
    /// <c>00400000-00452000 r-xp 00000000 08:01 1234  /path/to/file</c>.
    /// </summary>
    public static IReadOnlyList<MapEntry> ReadMaps(int pid)
    {
        var path = $"/proc/{pid}/maps";
        var result = new List<MapEntry>(256);
        foreach (var line in File.ReadLines(path))
        {
            var entry = ParseMapLine(line);
            if (entry is { } e)
                result.Add(e);
        }
        return result;
    }

    /// <summary>
    /// Parse pure (testable) d'une ligne de maps. Renvoie <c>null</c> si la ligne est malformée.
    /// </summary>
    internal static MapEntry? ParseMapLine(string line)
    {
        // address           perms offset  dev   inode      pathname
        // 7f...-7f...        r-xp  00000.. 08:01 12345      /lib/x.so
        var parts = line.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length < 5)
            return null;

        var dash = parts[0].IndexOf('-');
        if (dash <= 0)
            return null;

        if (!ulong.TryParse(parts[0].AsSpan(0, dash), NumberStyles.HexNumber, CultureInfo.InvariantCulture, out var start))
            return null;
        if (!ulong.TryParse(parts[0].AsSpan(dash + 1), NumberStyles.HexNumber, CultureInfo.InvariantCulture, out var end))
            return null;
        if (!ulong.TryParse(parts[2], NumberStyles.HexNumber, CultureInfo.InvariantCulture, out var offset))
            return null;

        // pathname (parts[5..]) peut contenir des espaces ; reconstitue le reste.
        var pathName = parts.Length >= 6 ? string.Join(' ', parts[5..]) : string.Empty;
        return new MapEntry(start, end, parts[1], offset, pathName);
    }

    /// <summary>
    /// Adresse de chargement (base) d'un module dont le chemin <c>/proc/pid/maps</c> contient
    /// <paramref name="moduleNameFragment"/> (insensible à la casse). On retourne le
    /// <b>plus petit Start</b> parmi toutes les plages du fichier — c'est la base réelle dont
    /// les RVA du PE sont relatifs. Renvoie <c>null</c> si le module n'est pas trouvé.
    /// </summary>
    public static ulong? FindModuleBase(int pid, string moduleNameFragment)
        => FindModuleBase(ReadMaps(pid), moduleNameFragment);

    /// <summary>Variante pure (testable) sur une liste de maps déjà lue.</summary>
    internal static ulong? FindModuleBase(IReadOnlyList<MapEntry> maps, string moduleNameFragment)
    {
        ulong? best = null;
        foreach (var m in maps)
        {
            if (m.Path.Length == 0)
                continue;
            if (m.Path.Contains(moduleNameFragment, StringComparison.OrdinalIgnoreCase))
                best = best is { } b ? Math.Min(b, m.Start) : m.Start;
        }
        return best;
    }

    /// <summary>
    /// Toutes les plages d'un module donné (base + sections : .text r-x, .data rw-, …),
    /// triées par adresse. Utile pour scanner / borner un read.
    /// </summary>
    public static IReadOnlyList<MapEntry> FindModuleRegions(int pid, string moduleNameFragment)
    {
        var list = new List<MapEntry>();
        foreach (var m in ReadMaps(pid))
        {
            if (m.Path.Contains(moduleNameFragment, StringComparison.OrdinalIgnoreCase))
                list.Add(m);
        }
        list.Sort(static (a, b) => a.Start.CompareTo(b.Start));
        return list;
    }

    /// <summary>
    /// Indique si <c>process_vm_readv</c> sur <paramref name="pid"/> est <i>probablement</i>
    /// permis depuis le processus courant, vu <c>ptrace_scope</c>. Heuristique non-bloquante :
    /// scope 0 → ok ; scope 1 → ok si le courant est ancêtre du pid ; scope ≥ 2/3 → faux sans
    /// capability. Ne remplace pas un vrai essai (la seule vérité = tenter un Read court).
    /// </summary>
    public static bool LikelyPermitted(int pid)
    {
        var scope = ReadPtraceScope();
        if (scope <= 0)
            return true;
        if (scope == 1)
            return IsAncestorOf(pid, Environment.ProcessId);
        return false; // 2 (admin-only) / 3 (no attach) : nécessite CAP_SYS_PTRACE
    }

    /// <summary>Valeur de <c>kernel.yama.ptrace_scope</c> (0–3). <c>-1</c> si illisible.</summary>
    public static int ReadPtraceScope()
    {
        try
        {
            var s = File.ReadAllText("/proc/sys/kernel/yama/ptrace_scope").Trim();
            return int.TryParse(s, out var v) ? v : -1;
        }
        catch
        {
            return -1;
        }
    }

    /// <summary>
    /// <paramref name="ancestorPid"/> est-il un ancêtre (parent transitif) de
    /// <paramref name="pid"/> ? Remonte la chaîne PPid via <c>/proc/&lt;pid&gt;/status</c>.
    /// </summary>
    public static bool IsAncestorOf(int pid, int ancestorPid)
    {
        var cur = pid;
        for (var i = 0; i < 4096 && cur > 1; i++)
        {
            var ppid = ReadPPid(cur);
            if (ppid <= 0)
                return false;
            if (ppid == ancestorPid)
                return true;
            cur = ppid;
        }
        return false;
    }

    private static int ReadPPid(int pid)
    {
        try
        {
            foreach (var line in File.ReadLines($"/proc/{pid}/status"))
            {
                if (line.StartsWith("PPid:", StringComparison.Ordinal))
                {
                    var v = line.AsSpan(5).Trim();
                    return int.TryParse(v, out var p) ? p : -1;
                }
            }
        }
        catch
        {
            // process disparu
        }
        return -1;
    }
}

/// <summary>Échec d'un appel mémoire (process_vm_readv/writev), avec errno décodé.</summary>
public sealed class WineMemoryException : Exception
{
    public int Errno { get; }

    public WineMemoryException(string message, int errno = 0) : base(message) => Errno = errno;

    internal static WineMemoryException FromErrno(int pid, ulong addr, int len, bool isWrite)
    {
        var errno = Marshal.GetLastPInvokeError();
        var op = isWrite ? "process_vm_writev" : "process_vm_readv";
        var hint = errno switch
        {
            1 => " (EPERM — ptrace_scope refuse : pas ancêtre et pas CAP_SYS_PTRACE)",
            3 => " (ESRCH — pid inexistant)",
            14 => " (EFAULT — adresse/plage non mappée côté cible)",
            _ => string.Empty,
        };
        return new WineMemoryException(
            $"{op} a échoué pid={pid} addr=0x{addr:x} len={len} errno={errno}{hint}", errno);
    }
}
