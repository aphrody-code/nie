using IECODE.Core.Steam.Content;
using Xunit;

namespace IECODE.Core.Tests;

/// <summary>Round-trip JSON du cache de jetons Steam (refresh token + guard data).</summary>
public class SteamTokenStoreTests
{
    [Fact]
    public void SetThenLoad_PersistsTokenAndGuardData()
    {
        var path = Path.Combine(Path.GetTempPath(), $"iecode-tokens-{Guid.NewGuid():N}.json");
        try
        {
            var store = SteamTokenStore.Load(path);
            store.Set("darksasuke971", "refresh-abc", "guard-xyz");

            var reloaded = SteamTokenStore.Load(path);
            var tokens = reloaded.Get("darksasuke971");
            Assert.Equal("refresh-abc", tokens.RefreshToken);
            Assert.Equal("guard-xyz", tokens.GuardData);
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public void Get_UnknownAccount_ReturnsEmpty()
    {
        var store = SteamTokenStore.Load(null); // pas de persistance
        var tokens = store.Get("inconnu");
        Assert.Null(tokens.RefreshToken);
        Assert.Null(tokens.GuardData);
    }

    [Fact]
    public void Set_IsCaseInsensitiveOnAccountName()
    {
        var path = Path.Combine(Path.GetTempPath(), $"iecode-tokens-{Guid.NewGuid():N}.json");
        try
        {
            var store = SteamTokenStore.Load(path);
            store.Set("Account", "tok", null);
            Assert.Equal("tok", store.Get("account").RefreshToken);
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public void NullPath_DoesNotPersistButDoesNotThrow()
    {
        var store = SteamTokenStore.Load(null);
        store.Set("acc", "tok", "guard"); // no-op silencieux
        Assert.Null(store.Get("acc").RefreshToken);
    }
}
