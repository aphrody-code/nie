using SteamKit2;
using SteamKit2.CDN;

namespace IECODE.Core.Steam.Content;

/// <summary>
/// Pool de connexions vers les serveurs CDN SteamPipe, avec rotation simple et
/// éviction des serveurs cassés. Adapté de DepotDownloader (CDNClientPool).
/// </summary>
internal sealed class CdnClientPool
{
    private readonly uint _appId;
    private readonly List<Server> _servers = [];
    private readonly Lock _lock = new();
    private int _nextServer;

    public Client CdnClient { get; }
    public Server? ProxyServer { get; private set; }

    public CdnClientPool(SteamClient steamClient, SteamContent steamContent, uint appId)
    {
        _appId = appId;
        SteamContent = steamContent;
        CdnClient = new Client(steamClient);
    }

    public SteamContent SteamContent { get; }

    public async Task UpdateServerListAsync()
    {
        var servers = await SteamContent.GetServersForSteamPipe();

        ProxyServer = servers.FirstOrDefault(x => x.UseAsProxy);

        var weighted = servers
            .Where(server =>
            {
                var eligible = server.AllowedAppIds.Length == 0 || server.AllowedAppIds.Contains(_appId);
                return eligible && server.Type is "SteamCache" or "CDN";
            })
            .OrderBy(server => server.WeightedLoad);

        foreach (var server in weighted)
        {
            for (var i = 0; i < server.NumEntries; i++)
            {
                _servers.Add(server);
            }
        }

        if (_servers.Count == 0)
        {
            throw new InvalidOperationException("Aucun serveur de téléchargement Steam disponible.");
        }
    }

    public Server GetConnection()
    {
        lock (_lock)
        {
            return _servers[_nextServer % _servers.Count];
        }
    }

    public void ReturnBrokenConnection(Server? server)
    {
        if (server is null) return;
        lock (_lock)
        {
            if (_servers[_nextServer % _servers.Count] == server)
            {
                _nextServer++;
            }
        }
    }
}
