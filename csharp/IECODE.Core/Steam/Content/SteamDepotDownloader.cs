using System.Buffers;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Net;
using SteamKit2;
using SteamKit2.CDN;

namespace IECODE.Core.Steam.Content;

/// <summary>
/// Téléchargeur natif de contenu Steam (depots → disque), équivalent allégé de
/// DepotDownloader bâti sur SteamKit2. Remplace le shell-out vers <c>steamcmd</c> :
/// connexion CM + login (2FA), résolution des depots/manifests, téléchargement et
/// déchiffrement des chunks depuis le CDN, écrits au format d'install Steam.
/// </summary>
public sealed class SteamDepotDownloader(Action<string>? logger = null)
{
    private const ulong InvalidManifest = 0;
    private readonly Action<string> _log = logger ?? (_ => { });

    public async Task<SteamDownloadResult> DownloadAppAsync(
        SteamDownloadOptions options,
        IProgress<SteamDownloadProgress>? progress = null,
        CancellationToken ct = default)
    {
        var sw = Stopwatch.StartNew();
        var tokenStore = SteamTokenStore.Load(options.TokenStorePath);
        using var session = new Steam3Session(options, tokenStore, _log, ct);

        try
        {
            progress?.Report(new(SteamDownloadPhase.Connecting, "Connexion à Steam…", 0, 0));
            await session.LoginAsync();

            progress?.Report(new(SteamDownloadPhase.FetchingAppInfo, "Récupération des infos de l'app…", 0, 0));
            await session.RequestAppInfoAsync(options.AppId);

            if (!session.AppInfo.TryGetValue(options.AppId, out var appInfo) || appInfo == null)
            {
                throw new InvalidOperationException($"Impossible de récupérer les infos de l'app {options.AppId} (compte sans accès ?).");
            }

            progress?.Report(new(SteamDownloadPhase.FetchingManifests, "Résolution des manifests…", 0, 0));
            var depots = await BuildDepotPlansAsync(session, options, appInfo);

            var pool = new CdnClientPool(session.SteamClient, session.SteamContent, options.AppId);
            await pool.UpdateServerListAsync();

            Directory.CreateDirectory(options.InstallDir);
            var counter = new DownloadCounter();

            foreach (var depot in depots)
            {
                await DownloadDepotAsync(session, pool, depot, options, counter, progress, ct);
            }

            progress?.Report(new(SteamDownloadPhase.Completed, "Téléchargement terminé.", counter.Downloaded, counter.Total));

            return new SteamDownloadResult
            {
                Success = true,
                AppId = options.AppId,
                InstallDir = Path.GetFullPath(options.InstallDir),
                Depots = depots.Select(d => d.DepotId).ToList(),
                DownloadedBytes = counter.Downloaded,
                FileCount = counter.Files,
                Duration = sw.Elapsed,
            };
        }
        catch (Exception ex)
        {
            progress?.Report(new(SteamDownloadPhase.Error, ex.Message, 0, 0));
            return new SteamDownloadResult
            {
                Success = false,
                Error = ex.Message,
                AppId = options.AppId,
                InstallDir = Path.GetFullPath(options.InstallDir),
                Duration = sw.Elapsed,
            };
        }
    }

    /// <summary>
    /// Récupère uniquement le <c>buildid</c> de la branche (login + app info, AUCUN
    /// téléchargement de manifest/CDN) — check de mise à jour rapide. 0 si introuvable.
    /// </summary>
    public async Task<uint> GetBuildIdAsync(SteamDownloadOptions options, CancellationToken ct = default)
    {
        var tokenStore = SteamTokenStore.Load(options.TokenStorePath);
        using var session = new Steam3Session(options, tokenStore, _log, ct);
        await session.LoginAsync();
        await session.RequestAppInfoAsync(options.AppId);
        if (!session.AppInfo.TryGetValue(options.AppId, out var appInfo) || appInfo == null)
        {
            throw new InvalidOperationException($"Impossible de récupérer les infos de l'app {options.AppId}.");
        }
        return SteamDepotResolver.ReadBranchBuildId(appInfo.KeyValues["depots"], options.Branch);
    }

    /// <summary>
    /// Inspecte (sans télécharger) : login + résolution des depots + manifests, puis
    /// renvoie le buildid de la branche et, pour chaque depot, son ID, manifest,
    /// nombre de fichiers et taille totale. Idéal avant un pull multi-Go.
    /// </summary>
    public async Task<IReadOnlyList<SteamDepotInfo>> ListDepotsAsync(
        SteamDownloadOptions options, CancellationToken ct = default)
    {
        var tokenStore = SteamTokenStore.Load(options.TokenStorePath);
        using var session = new Steam3Session(options, tokenStore, _log, ct);

        await session.LoginAsync();
        await session.RequestAppInfoAsync(options.AppId);
        if (!session.AppInfo.TryGetValue(options.AppId, out var appInfo) || appInfo == null)
        {
            throw new InvalidOperationException($"Impossible de récupérer les infos de l'app {options.AppId}.");
        }

        var plans = await BuildDepotPlansAsync(session, options, appInfo);
        var pool = new CdnClientPool(session.SteamClient, session.SteamContent, options.AppId);
        await pool.UpdateServerListAsync();

        var depotsKv = appInfo.KeyValues["depots"];
        var infos = new List<SteamDepotInfo>();
        foreach (var plan in plans)
        {
            ct.ThrowIfCancellationRequested();
            var requestCode = await session.GetManifestRequestCodeAsync(plan.DepotId, plan.AppId, plan.ManifestId, plan.Branch);
            var manifest = await DownloadManifestAsync(session, pool, plan, requestCode, ct);
            if (manifest?.Files == null) continue;

            long total = 0;
            var files = 0;
            foreach (var f in manifest.Files)
            {
                if (f.Flags.HasFlag(EDepotFileFlag.Directory)) continue;
                total += (long)f.TotalSize;
                files++;
            }

            infos.Add(new SteamDepotInfo
            {
                DepotId = plan.DepotId,
                ManifestId = plan.ManifestId,
                Name = depotsKv[plan.DepotId.ToString()]["name"].Value,
                FileCount = files,
                TotalBytes = total,
            });
        }
        return infos;
    }

    // ─── Résolution des depots (logique pure dans SteamDepotResolver) ────────

    /// <summary>Login déjà fait : résout accès + manifest + clé pour chaque depot éligible.</summary>
    private async Task<List<DepotPlan>> BuildDepotPlansAsync(
        Steam3Session session, SteamDownloadOptions options,
        SteamApps.PICSProductInfoCallback.PICSProductInfo appInfo)
    {
        var targets = ResolveDepots(options, appInfo.KeyValues["depots"]);
        if (targets.Count == 0)
        {
            throw new InvalidOperationException(
                $"Aucun depot éligible pour l'app {options.AppId} (branche '{options.Branch}', os '{options.Os}').");
        }

        var depots = new List<DepotPlan>();
        foreach (var depotId in targets)
        {
            if (!await session.AccountHasAccessAsync(options.AppId, depotId))
            {
                _log($"Depot {depotId} non accessible depuis ce compte — ignoré.");
                continue;
            }

            var manifestId = await ResolveManifestAsync(session, options.AppId, depotId, options.Branch);
            if (manifestId == InvalidManifest)
            {
                _log($"Depot {depotId} : pas de manifest pour la branche '{options.Branch}' — ignoré.");
                continue;
            }

            var key = await session.RequestDepotKeyAsync(depotId, options.AppId);
            if (key == null)
            {
                _log($"Depot {depotId} : clé de déchiffrement indisponible — ignoré.");
                continue;
            }

            depots.Add(new DepotPlan(depotId, options.AppId, manifestId, options.Branch, key));
        }

        if (depots.Count == 0)
        {
            throw new InvalidOperationException("Aucun depot téléchargeable (accès/manifest/clé manquants).");
        }
        return depots;
    }

    private static List<uint> ResolveDepots(SteamDownloadOptions options, KeyValue depotsSection)
        => SteamDepotResolver.SelectDepotIds(
            depotsSection, options.DepotIds, options.AllPlatforms, options.Os, options.Arch, options.Language);

    private async Task<ulong> ResolveManifestAsync(Steam3Session session, uint appId, uint depotId, string branch)
    {
        if (!session.AppInfo.TryGetValue(appId, out var app) || app == null) return InvalidManifest;

        var depotChild = app.KeyValues["depots"][depotId.ToString()];
        if (depotChild == KeyValue.Invalid) return InvalidManifest;

        // Depot partagé proxié vers une autre app : on résout chez l'app cible.
        var proxyApp = SteamDepotResolver.ProxiedFromApp(depotChild);
        if (proxyApp != 0 && proxyApp != appId)
        {
            await session.RequestAppInfoAsync(proxyApp);
            return await ResolveManifestAsync(session, proxyApp, depotId, branch);
        }

        return SteamDepotResolver.ReadManifestGid(depotChild, branch);
    }

    // ─── Téléchargement d'un depot ──────────────────────────────────────────

    private async Task DownloadDepotAsync(
        Steam3Session session,
        CdnClientPool pool,
        DepotPlan depot,
        SteamDownloadOptions options,
        DownloadCounter counter,
        IProgress<SteamDownloadProgress>? progress,
        CancellationToken ct)
    {
        _log($"Depot {depot.DepotId} : manifest {depot.ManifestId}…");

        var requestCode = await session.GetManifestRequestCodeAsync(depot.DepotId, depot.AppId, depot.ManifestId, depot.Branch);
        var manifest = await DownloadManifestAsync(session, pool, depot, requestCode, ct)
            ?? throw new InvalidOperationException($"Impossible de télécharger le manifest {depot.ManifestId} (depot {depot.DepotId}).");

        // Pré-création des dossiers + allocation des fichiers, skip de ceux déjà complets.
        var toDownload = new List<DepotManifest.FileData>();
        foreach (var file in manifest.Files!)
        {
            ct.ThrowIfCancellationRequested();
            var finalPath = Path.Combine(options.InstallDir, file.FileName);

            if (file.Flags.HasFlag(EDepotFileFlag.Directory))
            {
                Directory.CreateDirectory(finalPath);
                continue;
            }

            Directory.CreateDirectory(Path.GetDirectoryName(finalPath)!);

            // Resume : fichier déjà présent à la bonne taille ⇒ on saute (équivalent validate partiel).
            if (File.Exists(finalPath) && new FileInfo(finalPath).Length == (long)file.TotalSize)
            {
                continue;
            }

            // Pré-alloue à la taille finale (écriture par offset ensuite).
            using (var fs = File.Open(finalPath, FileMode.Create, FileAccess.Write))
            {
                fs.SetLength((long)file.TotalSize);
            }

            counter.Total += (long)file.TotalSize;
            counter.Files++;
            if (file.Chunks.Count > 0) toDownload.Add(file);
        }

        // Flatten (fichier, chunk) → téléchargement parallèle.
        var streams = new ConcurrentDictionary<string, FileWriter>();
        var workItems = toDownload
            .SelectMany(f => f.Chunks.Select(c => (file: f, chunk: c)))
            .ToList();

        await Parallel.ForEachAsync(
            workItems,
            new ParallelOptions { MaxDegreeOfParallelism = Math.Max(1, options.MaxDownloads), CancellationToken = ct },
            async (item, token) =>
            {
                var writer = streams.GetOrAdd(item.file.FileName, name =>
                    new FileWriter(Path.Combine(options.InstallDir, name), item.file.Chunks.Count));

                var written = await DownloadChunkAsync(session, pool, depot, item.chunk, token);
                await writer.WriteAsync((long)item.chunk.Offset, written, token);

                ArrayPool<byte>.Shared.Return(written.Array!);

                var done = counter.Add(written.Count);
                if (counter.Total > 0)
                {
                    progress?.Report(new(SteamDownloadPhase.Downloading,
                        $"Depot {depot.DepotId}", done, counter.Total));
                }

                if (writer.ChunkCompleted()) writer.Dispose();
            });

        foreach (var w in streams.Values) w.Dispose();
    }

    private async Task<DepotManifest?> DownloadManifestAsync(
        Steam3Session session, CdnClientPool pool, DepotPlan depot, ulong requestCode, CancellationToken ct)
    {
        for (var attempt = 0; attempt < 8; attempt++)
        {
            ct.ThrowIfCancellationRequested();
            var server = pool.GetConnection();
            try
            {
                var cdnToken = await GetCdnTokenAsync(session, depot, server, ct);
                return await pool.CdnClient.DownloadManifestAsync(
                    depot.DepotId, depot.ManifestId, requestCode, server, depot.DepotKey, pool.ProxyServer, cdnToken);
            }
            catch (SteamKitWebRequestException e) when (e.StatusCode == HttpStatusCode.Forbidden)
            {
                await GetCdnTokenAsync(session, depot, server, ct, force: true);
            }
            catch (Exception e)
            {
                _log($"Manifest {depot.ManifestId} : erreur ({e.Message}), nouveau serveur…");
                pool.ReturnBrokenConnection(server);
            }
        }
        return null;
    }

    private async Task<ArraySegment<byte>> DownloadChunkAsync(
        Steam3Session session, CdnClientPool pool, DepotPlan depot, DepotManifest.ChunkData chunk, CancellationToken ct)
    {
        var buffer = ArrayPool<byte>.Shared.Rent((int)chunk.UncompressedLength);
        for (var attempt = 0; ; attempt++)
        {
            ct.ThrowIfCancellationRequested();
            var server = pool.GetConnection();
            try
            {
                var cdnToken = await GetCdnTokenAsync(session, depot, server, ct);
                var written = await pool.CdnClient.DownloadDepotChunkAsync(
                    depot.DepotId, chunk, server, buffer, depot.DepotKey, pool.ProxyServer, cdnToken);
                return new ArraySegment<byte>(buffer, 0, written);
            }
            catch (SteamKitWebRequestException e) when (e.StatusCode == HttpStatusCode.Forbidden)
            {
                await GetCdnTokenAsync(session, depot, server, ct, force: true);
            }
            catch (Exception e)
            {
                pool.ReturnBrokenConnection(server);
                if (attempt >= 10)
                {
                    ArrayPool<byte>.Shared.Return(buffer);
                    throw new InvalidOperationException(
                        $"Échec du chunk {Convert.ToHexString(chunk.ChunkID!)} (depot {depot.DepotId}) : {e.Message}");
                }
            }
        }
    }

    private readonly ConcurrentDictionary<(uint, string), string?> _cdnTokens = new();

    private async Task<string?> GetCdnTokenAsync(
        Steam3Session session, DepotPlan depot, Server server, CancellationToken ct, bool force = false)
    {
        var key = (depot.DepotId, server.Host!);

        // Cas normal : la plupart des CDN SteamPipe ne demandent pas de jeton. On
        // n'en requiert un que sur 403 (force=true), puis on le réutilise (cache).
        if (!force)
        {
            return _cdnTokens.TryGetValue(key, out var cached) ? cached : null;
        }

        try
        {
            var result = await session.SteamContent.GetCDNAuthToken(depot.AppId, depot.DepotId, server.Host!);
            var token = result.Result == EResult.OK ? result.Token : null;
            _cdnTokens[key] = token;
            return token;
        }
        catch
        {
            return null;
        }
    }

    private sealed record DepotPlan(uint DepotId, uint AppId, ulong ManifestId, string Branch, byte[] DepotKey);

    private sealed class DownloadCounter
    {
        private long _downloaded;
        public long Total;
        public int Files;
        public long Downloaded => Interlocked.Read(ref _downloaded);
        public long Add(int n) => Interlocked.Add(ref _downloaded, n);
    }

    /// <summary>Écriture concurrente d'un fichier par offset, avec fermeture au dernier chunk.</summary>
    private sealed class FileWriter : IDisposable
    {
        private readonly FileStream _stream;
        private readonly SemaphoreSlim _lock = new(1, 1);
        private int _remaining;

        public FileWriter(string path, int chunkCount)
        {
            _stream = File.Open(path, FileMode.Open, FileAccess.Write, FileShare.Write);
            _remaining = chunkCount;
        }

        public async Task WriteAsync(long offset, ArraySegment<byte> data, CancellationToken ct)
        {
            await _lock.WaitAsync(ct);
            try
            {
                _stream.Seek(offset, SeekOrigin.Begin);
                await _stream.WriteAsync(data.AsMemory(), ct);
            }
            finally
            {
                _lock.Release();
            }
        }

        public bool ChunkCompleted() => Interlocked.Decrement(ref _remaining) == 0;

        public void Dispose()
        {
            try { _stream.Dispose(); } catch { /* déjà fermé */ }
        }
    }
}
