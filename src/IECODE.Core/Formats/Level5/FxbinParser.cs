using System;
using System.Collections.Generic;
using System.Diagnostics.CodeAnalysis;
using System.IO;
using System.Linq;
using IECODE.Core.Formats.Level5.CfgBin;
using IECODE.Core.Formats.Level5.CfgBin.Logic;

namespace IECODE.Core.Formats.Level5
{
    /// <summary>
    /// Parseur des fichiers `.fxbin` d'IEVR — la table de liaison « ShaderFX » qui
    /// décrit, pour un effet de shader donné, ses techniques et passes ainsi que les
    /// shaders DXBC associés (les `.vfxo` = vertex, `.pfxo` = pixel).
    ///
    /// DÉCOUVERTE (corrige le plan initial) : un `.fxbin` n'est PAS un binaire « brut »
    /// sans footer cfg.bin — c'est un conteneur cfg.bin / T2B Level-5 complet : il se
    /// termine par le footer `01 74 32 62 FE` (`\x01t2b\xFE`) et son arbre d'entrées
    /// porte les clés sémantiques :
    ///   SHADERFX_MEMB_NUM, TEC_BGN, PASS_BGN, VS, PS, PASS_END, TEC_END.
    /// On réutilise donc le lecteur <see cref="CfgBin"/> existant (zéro RE binaire) et
    /// on en extrait un modèle de techniques/passes.
    /// </summary>
    public sealed class FxbinParser
    {
        public string SourceName { get; init; } = string.Empty;
        public int MemberCount { get; private set; }
        public List<FxbinTechnique> Techniques { get; } = new();

        /// <summary>Référence sémantique (CRC ↔ chaîne) brute, pour inspection.</summary>
        public List<FxbinReference> References { get; } = new();

        public static bool LooksLikeFxbin(byte[] data) => CfgBin.CfgBin.HasValidFooter(data);

        [RequiresUnreferencedCode("Calls CfgBin.Open which requires unreferenced code.")]
        public static FxbinParser Parse(string path)
        {
            var p = Parse(File.ReadAllBytes(path));
            return new FxbinParser
            {
                SourceName = Path.GetFileNameWithoutExtension(path),
                MemberCount = p.MemberCount,
            }.CopyFrom(p);
        }

        [RequiresUnreferencedCode("Calls CfgBin.Open which requires unreferenced code.")]
        public static FxbinParser Parse(byte[] data)
        {
            if (!CfgBin.CfgBin.HasValidFooter(data))
                throw new InvalidDataException("Pas un .fxbin valide (footer cfg.bin 't2b' absent).");

            var cfg = new CfgBin.CfgBin();
            cfg.Open(data);

            var parser = new FxbinParser();

            // Toutes les chaînes résolues (clés + valeurs) servent de table de référence.
            foreach (var kv in cfg.Strings)
                parser.References.Add(new FxbinReference(kv.Key, kv.Value));

            // Parcours plat de l'arbre d'entrées pour reconstruire techniques/passes.
            FxbinTechnique? currentTech = null;
            FxbinPass? currentPass = null;

            void Walk(Entry e)
            {
                string name = e.GetName();
                switch (name)
                {
                    case "SHADERFX_MEMB_NUM":
                        parser.MemberCount = FirstInt(e, parser.MemberCount);
                        break;
                    case "TEC_BGN":
                        currentTech = new FxbinTechnique { Name = FirstString(e) ?? $"tec{parser.Techniques.Count}" };
                        parser.Techniques.Add(currentTech);
                        break;
                    case "PASS_BGN":
                        currentPass = new FxbinPass { Name = FirstString(e) ?? $"pass{currentTech?.Passes.Count ?? 0}" };
                        currentTech?.Passes.Add(currentPass);
                        break;
                    case "VS":
                        if (currentPass != null) currentPass.VertexShader = FirstString(e) ?? currentPass.VertexShader;
                        break;
                    case "PS":
                        if (currentPass != null) currentPass.PixelShader = FirstString(e) ?? currentPass.PixelShader;
                        break;
                    case "PASS_END":
                        currentPass = null;
                        break;
                    case "TEC_END":
                        currentTech = null;
                        break;
                }

                foreach (var child in e.Children)
                    Walk(child);
            }

            foreach (var entry in cfg.Entries)
                Walk(entry);

            return parser;
        }

        private FxbinParser CopyFrom(FxbinParser other)
        {
            MemberCount = other.MemberCount;
            Techniques.AddRange(other.Techniques);
            References.AddRange(other.References);
            return this;
        }

        private static string? FirstString(Entry e)
        {
            foreach (var v in e.Variables)
                if (v.Type == VariableType.String && v.Value != null)
                    return v.Value.ToString();
            return null;
        }

        private static int FirstInt(Entry e, int fallback)
        {
            foreach (var v in e.Variables)
                if (v.Type == VariableType.Int && v.Value != null)
                    return Convert.ToInt32(v.Value);
            return fallback;
        }
    }

    public sealed class FxbinTechnique
    {
        public string Name { get; set; } = string.Empty;
        public List<FxbinPass> Passes { get; } = new();
    }

    public sealed class FxbinPass
    {
        public string Name { get; set; } = string.Empty;
        public string VertexShader { get; set; } = string.Empty;
        public string PixelShader { get; set; } = string.Empty;
    }

    public readonly record struct FxbinReference(int Offset, string Value);
}
