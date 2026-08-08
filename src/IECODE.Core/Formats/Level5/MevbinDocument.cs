using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using System.Text.Json;

namespace IECODE.Core.Formats.Level5;

// ── Types sémantiques MEVBIN ──────────────────────────────────────────────────

/// <summary>
/// Un événement déclenché à un instant donné de l'animation (Motion Event).
/// Provient d'un record <c>EVENT_n</c> du cfg.bin sous-jacent (3 champs).
/// </summary>
public sealed class MevbinEvent
{
    /// <summary>Instant de déclenchement, en secondes (champ <c>#0</c>, float).</summary>
    public float Time { get; init; }

    /// <summary>
    /// Type / second paramètre de l'événement (champ <c>#1</c>).
    /// Selon l'événement, c'est soit un flottant (durée, intensité), soit un
    /// hash CRC-32 LEVEL-5 (catégorie d'événement) — la valeur brute est
    /// conservée dans <see cref="TypeRaw"/> et son interprétation dans
    /// <see cref="TypeIsFloat"/>.
    /// </summary>
    public uint TypeRaw { get; init; }

    /// <summary><c>true</c> si le champ <c>#1</c> a été décodé comme flottant.</summary>
    public bool TypeIsFloat { get; init; }

    /// <summary>Valeur flottante du champ <c>#1</c> si <see cref="TypeIsFloat"/>.</summary>
    public float TypeFloat { get; init; }

    /// <summary>
    /// Troisième paramètre (champ <c>#2</c>) : index, drapeau on/off, ou hash.
    /// Valeur brute 32 bits conservée telle quelle.
    /// </summary>
    public uint ParamRaw { get; init; }

    /// <summary><c>true</c> si le champ <c>#2</c> a été décodé comme flottant.</summary>
    public bool ParamIsFloat { get; init; }

    /// <summary>Valeur flottante du champ <c>#2</c> si <see cref="ParamIsFloat"/>.</summary>
    public float ParamFloat { get; init; }
}

/// <summary>
/// Groupe d'événements rattachés à une animation/motion donnée.
/// Provient d'un record <c>MOT_n</c> (un hash) suivi de ses <c>EVENT_n</c>.
/// </summary>
public sealed class MevbinMotion
{
    /// <summary>Hash CRC-32 LEVEL-5 de la motion (champ unique du record <c>MOT_n</c>).</summary>
    public uint Hash { get; init; }

    /// <summary>Événements déclenchés durant cette motion, dans l'ordre du fichier.</summary>
    public IReadOnlyList<MevbinEvent> Events { get; init; } = Array.Empty<MevbinEvent>();
}

/// <summary>
/// Document MEVBIN — Motion Event Binary.
///
/// <para>Wrapper sémantique au-dessus de <see cref="CfgBinDocument"/> : un
/// <c>.mevbin</c> est un cfg.bin T2B (footer <c>01 74 32 62</c>) dont les records
/// décrivent les événements synchronisés à l'animation d'un personnage
/// (<c>data/common/chr/cXXXXXX/cXXXXXX_pNNN.mevbin</c>).</para>
///
/// <para>Structure des records (plate, dans l'ordre) :</para>
/// <list type="bullet">
///   <item><c>COUNT_0</c> — 2 champs : nombre de motions, nombre total d'événements.</item>
///   <item><c>MOT_n</c> — 1 champ : hash CRC-32 de l'animation.</item>
///   <item><c>EVENT_n</c> — 3 champs : time (float), type, param.</item>
/// </list>
///
/// <para>Chaque <c>MOT_n</c> ouvre un groupe ; les <c>EVENT_n</c> suivants lui sont
/// rattachés jusqu'au prochain <c>MOT_n</c>.</para>
/// </summary>
public sealed class MevbinDocument
{
    /// <summary>Nombre de motions déclaré par l'en-tête <c>COUNT_0.#0</c>.</summary>
    public int MotionCount { get; init; }

    /// <summary>Nombre total d'événements déclaré par l'en-tête <c>COUNT_0.#1</c>.</summary>
    public int EventCount { get; init; }

    /// <summary>Motions et leurs événements, dans l'ordre du fichier.</summary>
    public IReadOnlyList<MevbinMotion> Motions { get; init; } = Array.Empty<MevbinMotion>();

    /// <summary>Nombre d'événements effectivement extraits (somme sur les motions).</summary>
    public int ParsedEventCount
    {
        get
        {
            int n = 0;
            foreach (var m in Motions) n += m.Events.Count;
            return n;
        }
    }

    // ── Point d'entrée ────────────────────────────────────────────────────────

    /// <summary>
    /// Décode un <c>.mevbin</c> en document sémantique.
    /// Le déchiffrement éventuel et le parsing T2B sont délégués à
    /// <see cref="CfgBinDocument.Decode(byte[], string?, IReadOnlyDictionary{uint,string})"/>.
    /// </summary>
    /// <param name="data">Octets bruts du fichier <c>.mevbin</c>.</param>
    /// <param name="fileNameKey">Nom du fichier (clé de déchiffrement éventuel).</param>
    /// <exception cref="InvalidDataException">Le fichier n'est pas un cfg.bin T2B MEVBIN valide.</exception>
    [System.Diagnostics.CodeAnalysis.RequiresUnreferencedCode(
        "Utilise CfgBinDocument.Decode qui repose sur CfgBin.Open.")]
    public static MevbinDocument Decode(byte[] data, string? fileNameKey = null)
    {
        var doc = CfgBinDocument.Decode(data, fileNameKey);

        if (doc.Format != "T2B")
            throw new InvalidDataException(
                $"MEVBIN attendu en T2B, format décodé : {doc.Format}.");

        int motCountHeader = 0;
        int eventCountHeader = 0;
        var motions = new List<MevbinMotion>();
        List<MevbinEvent>? currentEvents = null;
        uint currentHash = 0;
        bool haveMotion = false;

        void Flush()
        {
            if (haveMotion)
            {
                motions.Add(new MevbinMotion
                {
                    Hash = currentHash,
                    Events = currentEvents ?? (IReadOnlyList<MevbinEvent>)Array.Empty<MevbinEvent>(),
                });
            }
        }

        foreach (var record in doc.Records)
        {
            var name = record.Name;

            if (name.StartsWith("COUNT", StringComparison.Ordinal))
            {
                if (record.Fields.Count >= 1) motCountHeader = AsInt(record.Fields[0]);
                if (record.Fields.Count >= 2) eventCountHeader = AsInt(record.Fields[1]);
            }
            else if (name.StartsWith("MOT", StringComparison.Ordinal))
            {
                // Nouvelle motion : on clôt la précédente.
                Flush();
                currentHash = record.Fields.Count >= 1 ? AsUInt(record.Fields[0]) : 0u;
                currentEvents = new List<MevbinEvent>();
                haveMotion = true;
            }
            else if (name.StartsWith("EVENT", StringComparison.Ordinal))
            {
                var ev = BuildEvent(record);
                // Si un EVENT précède tout MOT (rare), on crée un groupe implicite.
                if (currentEvents is null)
                {
                    currentEvents = new List<MevbinEvent>();
                    haveMotion = true;
                    currentHash = 0u;
                }
                currentEvents.Add(ev);
            }
        }

        Flush();

        return new MevbinDocument
        {
            MotionCount = motCountHeader,
            EventCount = eventCountHeader,
            Motions = motions,
        };
    }

    [System.Diagnostics.CodeAnalysis.RequiresUnreferencedCode("Utilise Decode.")]
    public static MevbinDocument DecodeFile(string filePath)
    {
        var data = File.ReadAllBytes(filePath);
        return Decode(data, Path.GetFileName(filePath));
    }

    private static MevbinEvent BuildEvent(CfgBinRecord record)
    {
        float time = 0f;
        uint typeRaw = 0; bool typeIsFloat = false; float typeFloat = 0f;
        uint paramRaw = 0; bool paramIsFloat = false; float paramFloat = 0f;

        if (record.Fields.Count >= 1)
            time = AsFloat(record.Fields[0]);

        if (record.Fields.Count >= 2)
        {
            var f = record.Fields[1];
            typeIsFloat = f.Kind == CfgBinValueKind.Float;
            typeFloat = typeIsFloat ? AsFloat(f) : 0f;
            typeRaw = AsUInt(f);
        }

        if (record.Fields.Count >= 3)
        {
            var f = record.Fields[2];
            paramIsFloat = f.Kind == CfgBinValueKind.Float;
            paramFloat = paramIsFloat ? AsFloat(f) : 0f;
            paramRaw = AsUInt(f);
        }

        return new MevbinEvent
        {
            Time = time,
            TypeRaw = typeRaw, TypeIsFloat = typeIsFloat, TypeFloat = typeFloat,
            ParamRaw = paramRaw, ParamIsFloat = paramIsFloat, ParamFloat = paramFloat,
        };
    }

    // ── Lecture typée robuste d'un champ cfg.bin ───────────────────────────────

    private static int AsInt(CfgBinValue v) => v.Value switch
    {
        int i => i,
        uint u => unchecked((int)u),
        float f => (int)f,
        short s => s,
        byte b => b,
        _ => 0,
    };

    private static uint AsUInt(CfgBinValue v) => v.Value switch
    {
        int i => unchecked((uint)i),
        uint u => u,
        float f => unchecked((uint)BitConverter.SingleToInt32Bits(f)),
        short s => unchecked((uint)s),
        byte b => b,
        _ => 0u,
    };

    private static float AsFloat(CfgBinValue v) => v.Value switch
    {
        float f => f,
        int i => BitConverter.Int32BitsToSingle(i),
        uint u => BitConverter.Int32BitsToSingle(unchecked((int)u)),
        short s => s,
        byte b => b,
        _ => 0f,
    };

    // ── Sérialisation JSON ────────────────────────────────────────────────────

    /// <summary>
    /// Sérialise le document en JSON :
    /// <c>{ format, motionCount, eventCount, parsedEventCount, motions: [ { hash, events: [ { time, type, param } ] } ] }</c>.
    /// Les hashes sont écrits en hexadécimal (<c>0xXXXXXXXX</c>).
    /// </summary>
    public string ToJson(bool indented = true)
    {
        using var ms = new MemoryStream();
        var opts = new JsonWriterOptions
        {
            Indented = indented,
            Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        };
        using var w = new Utf8JsonWriter(ms, opts);

        w.WriteStartObject();
        w.WriteString("format", "MEVBIN");
        w.WriteNumber("motionCount", MotionCount);
        w.WriteNumber("eventCount", EventCount);
        w.WriteNumber("parsedEventCount", ParsedEventCount);

        w.WritePropertyName("motions");
        w.WriteStartArray();
        foreach (var m in Motions)
        {
            w.WriteStartObject();
            w.WriteString("hash", Hex(m.Hash));
            w.WritePropertyName("events");
            w.WriteStartArray();
            foreach (var ev in m.Events)
            {
                w.WriteStartObject();
                w.WriteNumber("time", ev.Time);

                if (ev.TypeIsFloat)
                    w.WriteNumber("type", ev.TypeFloat);
                else
                    w.WriteString("type", Hex(ev.TypeRaw));

                if (ev.ParamIsFloat)
                    w.WriteNumber("param", ev.ParamFloat);
                else
                {
                    // Petit entier => écrit en décimal ; sinon hash en hex.
                    if (ev.ParamRaw <= 0xFFFF)
                        w.WriteNumber("param", ev.ParamRaw);
                    else
                        w.WriteString("param", Hex(ev.ParamRaw));
                }

                w.WriteEndObject();
            }
            w.WriteEndArray();
            w.WriteEndObject();
        }
        w.WriteEndArray();

        w.WriteEndObject();
        w.Flush();
        return Encoding.UTF8.GetString(ms.ToArray());
    }

    private static string Hex(uint v) => "0x" + v.ToString("X8", CultureInfo.InvariantCulture);
}
