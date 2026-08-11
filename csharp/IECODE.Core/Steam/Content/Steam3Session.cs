using System.Collections.ObjectModel;
using SteamKit2;
using SteamKit2.Authentication;

namespace IECODE.Core.Steam.Content;

/// <summary>
/// Session Steam3 : connexion au CM, authentification (refresh token caché +
/// Steam Guard 2FA), et requêtes PICS / clés de depot / codes de manifest.
/// Adapté/simplifié de DepotDownloader (Steam3Session), SteamKit2 3.4.
/// </summary>
internal sealed class Steam3Session : IDisposable
{
    public readonly SteamClient SteamClient;
    public readonly SteamUser SteamUser;
    public readonly SteamApps SteamApps;
    public readonly SteamContent SteamContent;

    public bool IsLoggedOn { get; private set; }
    public ReadOnlyCollection<SteamApps.LicenseListCallback.License>? Licenses { get; private set; }

    public Dictionary<uint, ulong> AppTokens { get; } = [];
    public Dictionary<uint, ulong> PackageTokens { get; } = [];
    public Dictionary<uint, byte[]> DepotKeys { get; } = [];
    public Dictionary<uint, SteamApps.PICSProductInfoCallback.PICSProductInfo?> AppInfo { get; } = [];
    public Dictionary<uint, SteamApps.PICSProductInfoCallback.PICSProductInfo?> PackageInfo { get; } = [];

    private readonly CallbackManager _callbacks;
    private readonly SteamUser.LogOnDetails _logonDetails;
    private readonly bool _anonymous;
    private readonly string? _password;
    private readonly SteamTokenStore _tokenStore;
    private readonly ISteamGuardProvider? _guardProvider;
    private readonly Action<string> _log;
    private readonly CancellationToken _ct;

    private readonly TaskCompletionSource<bool> _loginTcs = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private bool _licensesReceived;
    private bool _usedCachedToken;
    private AuthSession? _authSession;
    private Task? _pump;

    public Steam3Session(
        SteamDownloadOptions options,
        SteamTokenStore tokenStore,
        Action<string> log,
        CancellationToken ct)
    {
        _password = options.Password;
        _tokenStore = tokenStore;
        _guardProvider = options.GuardProvider;
        _log = log;
        _ct = ct;
        _anonymous = string.IsNullOrEmpty(options.Username);

        var cachedToken = _anonymous ? null : _tokenStore.Get(options.Username!).RefreshToken;
        _usedCachedToken = cachedToken != null;

        _logonDetails = new SteamUser.LogOnDetails
        {
            Username = options.Username,
            Password = cachedToken == null ? options.Password : null,
            ShouldRememberPassword = true,
            AccessToken = cachedToken,
            LoginID = 0x49454344, // "IECD"
        };

        SteamClient = new SteamClient();
        SteamUser = SteamClient.GetHandler<SteamUser>()!;
        SteamApps = SteamClient.GetHandler<SteamApps>()!;
        SteamContent = SteamClient.GetHandler<SteamContent>()!;

        _callbacks = new CallbackManager(SteamClient);
        _callbacks.Subscribe<SteamClient.ConnectedCallback>(OnConnected);
        _callbacks.Subscribe<SteamClient.DisconnectedCallback>(OnDisconnected);
        _callbacks.Subscribe<SteamUser.LoggedOnCallback>(OnLoggedOn);
        _callbacks.Subscribe<SteamApps.LicenseListCallback>(OnLicenseList);
    }

    /// <summary>Connecte et authentifie. Lève sur échec ; complète quand loggé + licences reçues.</summary>
    public async Task LoginAsync()
    {
        _pump = Task.Run(PumpAsync);
        _log("Connexion à Steam3…");
        SteamClient.Connect();

        await using var reg = _ct.Register(() => _loginTcs.TrySetCanceled(_ct));
        await _loginTcs.Task;

        // Pour un compte authentifié, attendre la liste des licences (nécessaire au check d'accès).
        if (!_anonymous)
        {
            var deadline = DateTime.UtcNow.AddSeconds(15);
            while (!_licensesReceived && DateTime.UtcNow < deadline)
            {
                await Task.Delay(100, _ct);
            }
        }
    }

    private async Task PumpAsync()
    {
        try
        {
            while (!_ct.IsCancellationRequested)
            {
                await _callbacks.RunWaitCallbackAsync(_ct);
            }
        }
        catch (OperationCanceledException) { /* arrêt normal */ }
    }

    private async void OnConnected(SteamClient.ConnectedCallback _)
    {
        _log("Connecté.");

        if (_anonymous)
        {
            _log("Login anonyme…");
            SteamUser.LogOnAnonymous();
            return;
        }

        // Refresh token caché → login direct, sans 2FA.
        if (_logonDetails.AccessToken != null)
        {
            SteamUser.LogOn(_logonDetails);
            return;
        }

        // Sinon : authentification par identifiants (avec 2FA via provider).
        if (_authSession == null && _logonDetails.Username != null && _password != null)
        {
            try
            {
                var guardData = _tokenStore.Get(_logonDetails.Username).GuardData;
                _authSession = await SteamClient.Authentication.BeginAuthSessionViaCredentialsAsync(new AuthSessionDetails
                {
                    DeviceFriendlyName = "iecode",
                    Username = _logonDetails.Username,
                    Password = _password,
                    IsPersistentSession = true,
                    GuardData = guardData,
                    Authenticator = new CallbackAuthenticator(
                        _guardProvider ?? ThrowingGuardProvider.Instance, _ct),
                });
            }
            catch (Exception ex)
            {
                Fail($"Échec de l'authentification Steam : {ex.Message}");
                return;
            }
        }

        if (_authSession != null)
        {
            try
            {
                var result = await _authSession.PollingWaitForResultAsync(_ct);

                _logonDetails.Username = result.AccountName;
                _logonDetails.Password = null;
                _logonDetails.AccessToken = result.RefreshToken;

                _tokenStore.Set(result.AccountName, result.RefreshToken, result.NewGuardData);
                _authSession = null;
            }
            catch (OperationCanceledException)
            {
                return;
            }
            catch (Exception ex)
            {
                Fail($"Échec de l'authentification Steam : {ex.Message}");
                return;
            }

            SteamUser.LogOn(_logonDetails);
        }
    }

    private void OnDisconnected(SteamClient.DisconnectedCallback cb)
    {
        if (_loginTcs.Task.IsCompleted || _ct.IsCancellationRequested) return;

        // Reconnexion best-effort tant que le login n'a pas abouti/échoué.
        if (!cb.UserInitiated)
        {
            Thread.Sleep(1000);
            if (!_ct.IsCancellationRequested) SteamClient.Connect();
        }
    }

    private void OnLoggedOn(SteamUser.LoggedOnCallback cb)
    {
        // Refresh token rejeté → on purge et on retente par mot de passe (si dispo).
        var tokenRejected = _usedCachedToken && cb.Result is
            EResult.InvalidPassword or EResult.InvalidSignature or EResult.AccessDenied
            or EResult.Expired or EResult.Revoked;

        if (tokenRejected)
        {
            _usedCachedToken = false;
            _logonDetails.AccessToken = null;
            _logonDetails.Password = _password;
            _tokenStore.Set(_logonDetails.Username!, "", null);

            if (_password == null)
            {
                Fail("Le refresh token caché a été rejeté et aucun mot de passe n'est fourni. Relancez avec STEAM_PASSWORD.");
                return;
            }
            _log("Refresh token rejeté, nouvelle authentification par mot de passe…");
            SteamClient.Disconnect();
            return; // OnDisconnected relancera Connect()
        }

        if (cb.Result == EResult.TryAnotherCM)
        {
            SteamClient.Disconnect();
            return;
        }

        if (cb.Result != EResult.OK)
        {
            Fail($"Échec du login Steam3 : {cb.Result}" +
                (cb.Result is EResult.AccountLogonDenied or EResult.AccountLoginDeniedNeedTwoFactor
                    ? " (Steam Guard requis — fournissez un code 2FA)"
                    : ""));
            return;
        }

        _log("Login réussi.");
        IsLoggedOn = true;

        if (_anonymous) _licensesReceived = true; // pas de LicenseList en anonyme
        _loginTcs.TrySetResult(true);
    }

    private void OnLicenseList(SteamApps.LicenseListCallback cb)
    {
        if (cb.Result != EResult.OK)
        {
            _log($"Impossible de récupérer la liste des licences : {cb.Result}");
            _licensesReceived = true;
            return;
        }

        Licenses = cb.LicenseList;
        foreach (var license in cb.LicenseList)
        {
            if (license.AccessToken > 0)
            {
                PackageTokens.TryAdd(license.PackageID, license.AccessToken);
            }
        }
        _log($"{cb.LicenseList.Count} licence(s) sur le compte.");
        _licensesReceived = true;
    }

    private void Fail(string message)
    {
        _log(message);
        _loginTcs.TrySetException(new InvalidOperationException(message));
    }

    // ─── PICS / clés / manifests ────────────────────────────────────────────

    public async Task RequestAppInfoAsync(uint appId, bool force = false)
    {
        if (AppInfo.ContainsKey(appId) && !force) return;

        var tokens = await SteamApps.PICSGetAccessTokens([appId], []);
        foreach (var kv in tokens.AppTokens) AppTokens[kv.Key] = kv.Value;

        var request = new SteamApps.PICSRequest(appId);
        if (AppTokens.TryGetValue(appId, out var token)) request.AccessToken = token;

        var result = await SteamApps.PICSGetProductInfo([request], []);
        if (result.Results == null) return;

        foreach (var productInfo in result.Results)
        {
            foreach (var app in productInfo.Apps) AppInfo[app.Key] = app.Value;
            foreach (var app in productInfo.UnknownApps) AppInfo[app] = null;
        }
    }

    public async Task RequestPackageInfoAsync(IEnumerable<uint> packageIds)
    {
        var packages = packageIds.Where(p => !PackageInfo.ContainsKey(p)).ToList();
        if (packages.Count == 0) return;

        var requests = packages.Select(p =>
        {
            var r = new SteamApps.PICSRequest(p);
            if (PackageTokens.TryGetValue(p, out var token)) r.AccessToken = token;
            return r;
        }).ToList();

        var result = await SteamApps.PICSGetProductInfo([], requests);
        if (result.Results == null) return;

        foreach (var productInfo in result.Results)
        {
            foreach (var pkg in productInfo.Packages) PackageInfo[pkg.Key] = pkg.Value;
            foreach (var pkg in productInfo.UnknownPackages) PackageInfo[pkg] = null;
        }
    }

    public async Task<byte[]?> RequestDepotKeyAsync(uint depotId, uint appId)
    {
        if (DepotKeys.TryGetValue(depotId, out var cached)) return cached;

        var result = await SteamApps.GetDepotDecryptionKey(depotId, appId);
        if (result.Result != EResult.OK)
        {
            _log($"Pas de clé de depot pour {depotId} (résultat : {result.Result}).");
            return null;
        }

        DepotKeys[result.DepotID] = result.DepotKey;
        return result.DepotKey;
    }

    public async Task<ulong> GetManifestRequestCodeAsync(uint depotId, uint appId, ulong manifestId, string branch)
        => await SteamContent.GetManifestRequestCode(depotId, appId, manifestId, branch);

    public async Task<bool> AccountHasAccessAsync(uint appId, uint depotId)
    {
        if (SteamUser.SteamID == null) return false;

        IEnumerable<uint> licenseQuery = SteamUser.SteamID.AccountType == EAccountType.AnonUser
            ? [17906u]
            : Licenses?.Select(x => x.PackageID).Distinct() ?? [];

        await RequestPackageInfoAsync(licenseQuery);

        foreach (var package in licenseQuery)
        {
            if (!PackageInfo.TryGetValue(package, out var info) || info == null) continue;

            if (info.KeyValues["appids"].Children.Any(c => c.AsUnsignedInteger() == depotId)) return true;
            if (info.KeyValues["depotids"].Children.Any(c => c.AsUnsignedInteger() == depotId)) return true;
        }

        return false;
    }

    public void Dispose()
    {
        try
        {
            if (IsLoggedOn) SteamUser.LogOff();
            SteamClient.Disconnect();
        }
        catch { /* best effort */ }
    }

    /// <summary>Provider 2FA qui échoue clairement quand aucun n'a été fourni.</summary>
    private sealed class ThrowingGuardProvider : ISteamGuardProvider
    {
        public static readonly ThrowingGuardProvider Instance = new();
        public Task<string> GetCodeAsync(SteamGuardKind kind, string? email, bool previousIncorrect, CancellationToken ct)
            => throw new InvalidOperationException(
                "Steam Guard (2FA) requis mais aucun fournisseur de code n'a été configuré. " +
                "Passez --guard <code> ou définissez STEAM_GUARD_CODE.");
    }
}
