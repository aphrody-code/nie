using SteamKit2.Authentication;

namespace IECODE.Core.Steam.Content;

/// <summary>
/// <see cref="IAuthenticator"/> SteamKit2 délégant la saisie des codes Steam Guard
/// à un <see cref="ISteamGuardProvider"/> (console/env côté CLI, callback côté Bun).
/// <see cref="AcceptDeviceConfirmationAsync"/> renvoie true : autorise aussi la
/// validation via l'app mobile (le code et l'approbation se font la course).
/// </summary>
internal sealed class CallbackAuthenticator(ISteamGuardProvider provider, CancellationToken ct) : IAuthenticator
{
    public Task<string> GetDeviceCodeAsync(bool previousCodeWasIncorrect)
        => provider.GetCodeAsync(SteamGuardKind.Device, null, previousCodeWasIncorrect, ct);

    public Task<string> GetEmailCodeAsync(string email, bool previousCodeWasIncorrect)
        => provider.GetCodeAsync(SteamGuardKind.Email, email, previousCodeWasIncorrect, ct);

    public Task<bool> AcceptDeviceConfirmationAsync() => Task.FromResult(true);
}
