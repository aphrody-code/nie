using System.Text.Json;
using System.Text.Json.Serialization;

namespace IECODE.Core.Scripting.Lua;

/// <summary>
/// État d'un objet (widget) d'un layer de menu, muté par les commandes <c>funcLuaMenuCommand</c>.
/// Les champs nullables ne sont émis dans le JSON que lorsqu'une commande les a touchés
/// (un consommateur comme azalee n'applique que ce qui a changé).
/// </summary>
public sealed class MenuObjectState
{
    /// <summary>Hash CRC32 de l'objet (clé dans le layer).</summary>
    public uint Id { get; init; }

    /// <summary>Nom résolu de l'objet (ou hex).</summary>
    public string? Name { get; set; }

    /// <summary>Visibilité (SetObjectVisible). Défaut : visible.</summary>
    public bool Visible { get; set; } = true;

    /// <summary>Actif/interactif (SetObjectActive). Défaut : actif.</summary>
    public bool Active { get; set; } = true;

    /// <summary>Hash de texture du sprite (SetSprite / SetIconTexture).</summary>
    public uint? SpriteTextureHash { get; set; }

    /// <summary>Index de frame dans l'atlas (SetSprite).</summary>
    public int? Frame { get; set; }

    /// <summary>Teinte couleur (SetSprite / SetColorTint), hash de palette.</summary>
    public uint? ColorHash { get; set; }

    /// <summary>Couleur RGBA explicite (SetObjectColorRGBA), packée 0xRRGGBBAA.</summary>
    public uint? ColorRgba { get; set; }

    /// <summary>Texte affiché (SetText), déjà résolu en chaîne lisible.</summary>
    public string? Text { get; set; }

    /// <summary>Valeur numérique (SetNumericDisplay / SetObjectNum).</summary>
    public int? Number { get; set; }

    /// <summary>Index de défilement (SetScrollIndex).</summary>
    public int? ScrollIndex { get; set; }

    /// <summary>Échelle (SetObjectScale).</summary>
    public float? Scale { get; set; }

    /// <summary>Valeur de badge/pastille (SetBadge).</summary>
    public int? Badge { get; set; }

    /// <summary>Valeur de barre de progression (SetProgressBar).</summary>
    public float? Progress { get; set; }
}

/// <summary>
/// État d'un layer de menu (fenêtre/écran logique). Contient ses objets mutés.
/// </summary>
public sealed class MenuLayerState
{
    /// <summary>Hash CRC32 du layer.</summary>
    public uint Id { get; init; }

    /// <summary>Nom résolu du layer (ou hex).</summary>
    public string? Name { get; set; }

    /// <summary>Visibilité du layer (SetLayerVisible). Défaut : visible.</summary>
    public bool Visible { get; set; } = true;

    /// <summary>Activé (SetLayerEnabled). Défaut : activé.</summary>
    public bool Enabled { get; set; } = true;

    /// <summary>Index focus courant (SetFocus).</summary>
    public int? Focus { get; set; }

    /// <summary>Item courant sélectionné (SetCurrentItem).</summary>
    public int? CurrentItem { get; set; }

    /// <summary>Objets du layer, par hash.</summary>
    public Dictionary<uint, MenuObjectState> Objects { get; } = [];

    /// <summary>Récupère ou crée l'état d'un objet.</summary>
    public MenuObjectState Obj(uint objectId, Func<uint, string?>? resolver = null)
    {
        if (!Objects.TryGetValue(objectId, out var o))
        {
            o = new MenuObjectState { Id = objectId, Name = resolver?.Invoke(objectId) };
            Objects[objectId] = o;
        }
        return o;
    }
}

/// <summary>
/// État de menu reconstruit en exécutant la logique Lua du jeu via <see cref="GameLuaHost"/>.
/// C'est l'équivalent iecode de l'état que nie.exe construit en mémoire — consommé par azalee
/// (<c>@rose-griffon/menu-render</c>) pour rendre un menu INTERACTIF piloté par les vrais scripts.
/// </summary>
public sealed class MenuState
{
    /// <summary>Layers par hash, dans l'ordre d'apparition.</summary>
    public Dictionary<uint, MenuLayerState> Layers { get; } = [];

    /// <summary>Visibilité par groupe (SetGroupVisible).</summary>
    public Dictionary<uint, bool> Groups { get; } = [];

    /// <summary>Récupère ou crée l'état d'un layer.</summary>
    public MenuLayerState Layer(uint layerId, Func<uint, string?>? resolver = null)
    {
        if (!Layers.TryGetValue(layerId, out var l))
        {
            l = new MenuLayerState { Id = layerId, Name = resolver?.Invoke(layerId) };
            Layers[layerId] = l;
        }
        return l;
    }

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        WriteIndented = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    /// <summary>Sérialise l'état en JSON (camelCase, champs null omis).</summary>
    public string ToJson()
    {
        // Projette les dictionnaires (clé uint) en listes ordonnées pour un JSON stable.
        var model = new
        {
            layers = Layers.Values.Select(l => new
            {
                id = l.Id,
                name = l.Name,
                visible = l.Visible,
                enabled = l.Enabled,
                focus = l.Focus,
                currentItem = l.CurrentItem,
                objects = l.Objects.Values,
            }),
            groups = Groups.Select(g => new { id = g.Key, visible = g.Value }),
        };
        return JsonSerializer.Serialize(model, JsonOpts);
    }
}
