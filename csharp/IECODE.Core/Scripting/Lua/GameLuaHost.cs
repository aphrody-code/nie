using IECODE.Core.Util;

namespace IECODE.Core.Scripting.Lua;

/// <summary>
/// Host Lua <b>fidèle</b> : interprète les commandes <c>funcLuaMenuCommand</c> reversées
/// (<see cref="FuncLuaCommands"/>) en mutations d'un <see cref="MenuState"/> — l'équivalent iecode
/// de l'état que nie.exe construit en mémoire quand un script de menu tourne.
///
/// Exécuter un vrai <c>.lua.bin</c> de menu via <see cref="LuaRuntime"/> avec ce host produit donc
/// un état (layers/objets : visibilité, sprites, textes, nombres…) que azalee
/// (<c>@rose-griffon/menu-render</c>) consomme pour rendre un menu <b>interactif piloté par la vraie
/// logique du jeu</b>, et non un layout statique.
///
/// Hérite de <see cref="DefaultLuaHost"/> : la trace et la résolution de hash restent disponibles ;
/// seules les commandes à effet visible mutent l'état, les autres sont simplement journalisées.
/// </summary>
public sealed class GameLuaHost : DefaultLuaHost
{
    private readonly FuncLuaCommands _cmds;

    /// <summary>État de menu reconstruit (consommé par azalee / exporté en JSON).</summary>
    public MenuState State { get; } = new();

    /// <summary>(slot, locale) → texte affiché. Optionnel ; sinon le hash texte est résolu via le dico.</summary>
    public Func<uint, string?>? TextResolver { get; set; }

    /// <summary>
    /// Crée un host fidèle.
    /// </summary>
    /// <param name="dictionary">Dico hash→nom (résout layers/objets/textes).</param>
    /// <param name="commands">Table sémantique <c>funclua-cmdids.json</c> (cmdId → nom inféré).</param>
    /// <param name="trace">Si true, journalise chaque appel sur Console.Error.</param>
    public GameLuaHost(Level5HashDictionary? dictionary, FuncLuaCommands? commands, bool trace = false)
        : base(dictionary, trace)
    {
        _cmds = commands ?? FuncLuaCommands.LoadDefault();
    }

    /// <inheritdoc/>
    public override object? MenuCommand(uint cmdId, uint layerId, object?[] args)
    {
        // Journalise + enregistre via la base (trace inchangée).
        base.MenuCommand(cmdId, layerId, args);

        // Interprète la sémantique reversée.
        string? name = _cmds.MenuCommandName(cmdId);
        if (name is null) return (double)0;   // commande non reversée : trace seulement

        // SetGroupVisible : le 1er arg est un groupId, PAS un layerId — traité avant la création
        // du layer pour ne pas insérer un MenuLayerState fantôme keyé par le groupId.
        if (name == "SetGroupVisible")
        {
            State.Groups[layerId] = Bool(args, 0, true);
            return (double)0;
        }

        var layer = State.Layer(layerId, ResolveOrNull);

        switch (name)
        {
            // ── Layer ──────────────────────────────────────────────────────────
            case "SetLayerVisible":   layer.Visible = Bool(args, 0, true); break;
            case "SetLayerEnabled":   layer.Enabled = Bool(args, 0, true); break;
            case "SetFocus":          layer.Focus = Int(args, 0); break;
            case "SetCurrentItem":    layer.CurrentItem = Int(args, 0); break;
            case "ClearLayer":        layer.Objects.Clear(); break;

            // ── Objet : visibilité / état ───────────────────────────────────────
            case "SetObjectVisible":  Obj(layer, args, 0).Visible = Bool(args, 1, true); break;
            case "SetObjectActive":   Obj(layer, args, 0).Active = Bool(args, 1, true); break;
            case "SetObjectFlag":     Obj(layer, args, 0).Visible = Bool(args, 1, true); break;
            case "SetButtonEnabled":  Obj(layer, args, 0).Active = Bool(args, 1, true); break;

            // ── Objet : sprite / couleur / icône ────────────────────────────────
            case "SetSprite":
            {
                var o = Obj(layer, args, 0);
                o.SpriteTextureHash = UInt(args, 1);
                o.Frame             = Int(args, 2);
                o.ColorHash         = UIntOrNull(args, 3);
                break;
            }
            case "SetIconTexture":    Obj(layer, args, 0).SpriteTextureHash = UInt(args, 1); break;
            case "SetColorTint":      Obj(layer, args, 0).ColorHash = UInt(args, 1); break;
            case "SetObjectColorRGBA":
                Obj(layer, args, 0).ColorRgba =
                    ((uint)Int(args, 1) << 24) | ((uint)Int(args, 2) << 16) |
                    ((uint)Int(args, 3) << 8)  |  (uint)Int(args, 4);
                break;

            // ── Objet : texte / nombre ──────────────────────────────────────────
            case "SetText":           Obj(layer, args, 0).Text   = TextValue(args, 1); break;
            case "SetTextMulti":      Obj(layer, args, 0).Text   = TextValue(args, 1); break;
            case "SetNumericDisplay": Obj(layer, args, 0).Number = Int(args, 1); break;
            case "SetObjectNum":      Obj(layer, args, 0).Number = Int(args, 1); break;
            case "SetBadge":          Obj(layer, args, 0).Badge  = Int(args, 1); break;
            case "SetProgressBar":    Obj(layer, args, 0).Progress = Float(args, 1); break;

            // ── Objet : transform / liste ───────────────────────────────────────
            case "SetObjectScale":    Obj(layer, args, 0).Scale = Float(args, 1); break;
            case "SetScrollIndex":    Obj(layer, args, 0).ScrollIndex = Int(args, 1); break;

            // Autres (RegisterLayer, PlayAnimation, LoadSubLayer, SetSortKey,
            // SetObjectParam, SetObjectPosition, SetListItemData) : journalisées,
            // pas d'effet visuel direct à modéliser pour l'instant.
            default: break;
        }
        return (double)0;
    }

    // ── Helpers d'accès aux arguments (les nombres Lua arrivent en double) ────────

    private MenuObjectState Obj(MenuLayerState layer, object?[] args, int idx)
        => layer.Obj(UInt(args, idx), ResolveOrNull);

    private string? TextValue(object?[] args, int idx)
    {
        if (idx >= args.Length) return null;
        return args[idx] switch
        {
            string s => s,
            double d => TextResolver?.Invoke((uint)(long)d) ?? ResolveOrNull((uint)(long)d) ?? $"0x{(uint)(long)d:X8}",
            _        => null,
        };
    }

    private static uint UInt(object?[] a, int i)
        => i < a.Length && a[i] is double d ? (uint)(long)d : 0u;

    private static uint? UIntOrNull(object?[] a, int i)
        => i < a.Length && a[i] is double d ? (uint)(long)d : null;

    private static int Int(object?[] a, int i)
        => i < a.Length && a[i] is double d ? (int)d : 0;

    private static float Float(object?[] a, int i)
        => i < a.Length && a[i] is double d ? (float)d : 0f;

    private static bool Bool(object?[] a, int i, bool dflt)
    {
        if (i >= a.Length) return dflt;
        return a[i] switch
        {
            bool b   => b,
            double d => d != 0,   // Lua : 0 = faux par convention de ces commandes
            _        => dflt,
        };
    }
}
