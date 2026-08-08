using System.CommandLine;
using IECODE.Core.Audio;
using IECODE.Core.Formats.Criware;

namespace IECODE.CLI.Commands;

/// <summary>
/// Commande audio CRI : parse/extrait les fichiers ACB (@UTF) et AWB (AFS2),
/// liste les cues, extrait les blocs HCA bruts, et décode en WAV via vgmstream.
/// </summary>
public static class AudioCommand
{
    public static Command Create()
    {
        var command = new Command("audio", "Outils audio CRI (ACB/AWB/HCA/ADX)");
        command.AddCommand(InfoCommand());
        command.AddCommand(ListCommand());
        command.AddCommand(ExtractCommand());
        command.AddCommand(DecodeCommand());
        command.AddCommand(AdxCommand());
        return command;
    }

    // ---- info : métadonnées ACB ou AWB ----
    private static Command InfoCommand()
    {
        var cmd = new Command("info", "Métadonnées d'un fichier ACB ou AWB");
        var fileArg = new Argument<string>("file", "Chemin du .acb ou .awb");
        cmd.AddArgument(fileArg);
        cmd.SetHandler((string file) => Info(file), fileArg);
        return cmd;
    }

    private static void Info(string file)
    {
        if (!File.Exists(file)) { Console.WriteLine($"Fichier introuvable: {file}"); return; }
        var data = File.ReadAllBytes(file);

        if (AdxDecoder.IsAdx(data))
        {
            Console.Write(AdxDecoder.FromBytes(data).GetSummary());
        }
        else if (AwbReader.IsAwb(data))
        {
            var h = AwbReader.ParseHeader(data);
            var entries = AwbReader.ParseEntries(data);
            Console.WriteLine($"AWB (AFS2): {Path.GetFileName(file)}");
            Console.WriteLine($"  version={h.Version} offset_size={h.OffsetSize} align=0x{h.Align:X} subkey={h.Subkey}");
            Console.WriteLine($"  blocs={h.EntryCount}");
            int hca = 0;
            foreach (var e in entries)
                if (e.Size >= 4 && HcaDecoder.IsHca(data.AsSpan((int)e.Offset, Math.Min(4, e.Size)))) hca++;
            Console.WriteLine($"  blocs HCA détectés={hca}");
        }
        else if (UtfTable.IsUtf(data))
        {
            var acb = new AcbReader(data);
            var cues = acb.GetCues();
            Console.WriteLine($"ACB (@UTF): {Path.GetFileName(file)}");
            Console.WriteLine($"  Name={acb.Name}");
            Console.WriteLine($"  Version={acb.VersionString}");
            Console.WriteLine($"  cues={cues.Count}");
            var awb = acb.InternalAwb;
            Console.WriteLine($"  AWB interne: {(awb.Size > 0 ? $"{awb.Size} octets @0x{awb.Offset:X}" : "aucun (AWB externe)")}");
        }
        else
        {
            Console.WriteLine($"Format non reconnu (ni @UTF ni AFS2): {Path.GetFileName(file)}");
        }
    }

    // ---- list : cues d'un ACB ----
    private static Command ListCommand()
    {
        var cmd = new Command("list", "Liste les cues d'un fichier ACB");
        var fileArg = new Argument<string>("acb", "Chemin du .acb");
        cmd.AddArgument(fileArg);
        cmd.SetHandler((string file) => List(file), fileArg);
        return cmd;
    }

    private static void List(string file)
    {
        if (!File.Exists(file)) { Console.WriteLine($"Fichier introuvable: {file}"); return; }
        var acb = AcbReader.FromFile(file);
        var cues = acb.GetCues();
        Console.WriteLine($"{cues.Count} cue(s) dans {Path.GetFileName(file)}:");
        foreach (var c in cues)
            Console.WriteLine($"  [{c.CueIndex,3}] {c.Name}  wf={c.WaveformIndex} awbId={c.AwbId} {c.EncodeType} {c.NumChannels}ch {c.SamplingRate}Hz {c.NumSamples}smp{(c.Streaming ? " stream" : " mem")}");
    }

    // ---- extract : blocs HCA bruts d'un AWB ----
    private static Command ExtractCommand()
    {
        var cmd = new Command("extract", "Extrait les blocs HCA bruts d'un AWB");
        var fileArg = new Argument<string>("awb", "Chemin du .awb");
        var outOpt = new Option<string>(["--output", "-o"], () => "out_hca", "Répertoire de sortie");
        var acbOpt = new Option<string?>(["--acb"], "ACB associé (pour nommer les fichiers par cue)");
        cmd.AddArgument(fileArg);
        cmd.AddOption(outOpt);
        cmd.AddOption(acbOpt);
        cmd.SetHandler((string file, string outDir, string? acbFile) => Extract(file, outDir, acbFile), fileArg, outOpt, acbOpt);
        return cmd;
    }

    private static void Extract(string file, string outDir, string? acbFile)
    {
        if (!File.Exists(file)) { Console.WriteLine($"Fichier introuvable: {file}"); return; }
        var data = File.ReadAllBytes(file);
        if (!AwbReader.IsAwb(data)) { Console.WriteLine("Pas un AWB (AFS2)"); return; }

        var entries = AwbReader.ParseEntries(data);
        Directory.CreateDirectory(outDir);

        // Mapping optionnel awbId -> nom de cue.
        Dictionary<int, string>? names = null;
        if (acbFile is not null && File.Exists(acbFile))
        {
            names = new Dictionary<int, string>();
            foreach (var c in AcbReader.FromFile(acbFile).GetCues())
                if (c.AwbId >= 0) names[c.AwbId] = c.Name;
        }

        int written = 0;
        foreach (var e in entries)
        {
            string baseName = names is not null && names.TryGetValue((int)e.Id, out var n) ? n : $"{e.Index:D5}_id{e.Id}";
            string ext = HcaDecoder.IsHca(data.AsSpan((int)e.Offset, Math.Min(4, e.Size))) ? ".hca" : ".bin";
            string path = Path.Combine(outDir, baseName + ext);
            File.WriteAllBytes(path, AwbReader.ExtractBlock(data, e));
            written++;
        }
        Console.WriteLine($"{written} bloc(s) extrait(s) dans {outDir}");
    }

    // ---- decode : HCA -> WAV via vgmstream ----
    private static Command DecodeCommand()
    {
        var cmd = new Command("decode", "Décode les blocs HCA d'un AWB en WAV (via vgmstream)");
        var fileArg = new Argument<string>("awb", "Chemin du .awb");
        var outOpt = new Option<string>(["--output", "-o"], () => "out_wav", "Répertoire de sortie");
        var acbOpt = new Option<string?>(["--acb"], "ACB associé (nommage par cue)");
        cmd.AddArgument(fileArg);
        cmd.AddOption(outOpt);
        cmd.AddOption(acbOpt);
        cmd.SetHandler((string file, string outDir, string? acbFile) => Decode(file, outDir, acbFile), fileArg, outOpt, acbOpt);
        return cmd;
    }

    private static void Decode(string file, string outDir, string? acbFile)
    {
        if (!File.Exists(file)) { Console.WriteLine($"Fichier introuvable: {file}"); return; }
        var data = File.ReadAllBytes(file);
        if (!AwbReader.IsAwb(data)) { Console.WriteLine("Pas un AWB (AFS2)"); return; }

        bool hasVgm = HcaDecoder.VgmstreamAvailable(out var exe);
        if (!hasVgm)
            Console.WriteLine("vgmstream-cli absent : extraction HCA brute + métadonnées seulement (pas de WAV).");

        var entries = AwbReader.ParseEntries(data);
        Directory.CreateDirectory(outDir);
        var tmp = Path.Combine(outDir, "_tmp.hca");

        int decoded = 0, headers = 0;
        foreach (var e in entries)
        {
            if (e.Size < 8) continue;
            var block = AwbReader.ExtractBlock(data, e);
            if (!HcaDecoder.IsHca(block)) continue;

            var info = HcaDecoder.ParseHeader(block);
            headers++;
            Console.WriteLine($"  id{e.Id}: HCA v{info.Version >> 8}.{info.Version & 0xFF} {info.Channels}ch {info.SampleRate}Hz {info.FrameCount}fr cipher={info.Cipher}");

            if (hasVgm)
            {
                File.WriteAllBytes(tmp, block);
                var wav = Path.Combine(outDir, $"{e.Index:D5}_id{e.Id}.wav");
                if (HcaDecoder.DecodeToWavViaVgmstream(tmp, wav)) decoded++;
            }
        }
        if (File.Exists(tmp)) File.Delete(tmp);
        Console.WriteLine($"En-têtes HCA parsés={headers}, WAV décodés={decoded}");
    }

    // ---- adx : info + décodage natif ADX-ADPCM (type 0x02) -> WAV ----
    private static Command AdxCommand()
    {
        var cmd = new Command("adx", "Métadonnées d'un .adx (CRI ADX) + décodage PCM natif (type 0x02)");
        var fileArg = new Argument<string>("file", "Chemin du .adx");
        var outOpt = new Option<string?>(["--output", "-o"], "Écrit un WAV PCM16 décodé (type 0x02 uniquement)");
        cmd.AddArgument(fileArg);
        cmd.AddOption(outOpt);
        cmd.SetHandler((string file, string? outWav) => Adx(file, outWav), fileArg, outOpt);
        return cmd;
    }

    private static void Adx(string file, string? outWav)
    {
        if (!File.Exists(file)) { Console.WriteLine($"Fichier introuvable: {file}"); return; }
        var data = File.ReadAllBytes(file);
        if (!AdxDecoder.IsAdx(data)) { Console.WriteLine("Pas un ADX (magic 0x8000 absent)"); return; }

        var dec = AdxDecoder.FromBytes(data);
        Console.Write(dec.GetSummary());

        if (string.IsNullOrEmpty(outWav)) return;
        if (!dec.Info.IsDecodable)
        {
            Console.WriteLine($"Décodage PCM impossible : encodingType 0x{(byte)dec.Info.EncodingType:X2} (seul 0x02 ADX-ADPCM l'est).");
            return;
        }

        var pcm = dec.DecodePcm16();
        WriteWav(outWav, pcm, dec.Info.ChannelCount, dec.Info.SampleRate);
        Console.WriteLine($"WAV écrit : {outWav} ({pcm.Length} échantillons, {dec.Info.ChannelCount}ch, {dec.Info.SampleRate}Hz)");
    }

    // Écrit un WAV PCM16 entrelacé (RIFF/WAVE) minimal.
    private static void WriteWav(string path, short[] samples, int channels, int sampleRate)
    {
        int dataBytes = samples.Length * 2;
        using var fs = File.Create(path);
        using var w = new BinaryWriter(fs);
        w.Write("RIFF"u8.ToArray());
        w.Write(36 + dataBytes);
        w.Write("WAVE"u8.ToArray());
        w.Write("fmt "u8.ToArray());
        w.Write(16);                                  // taille du sous-bloc fmt
        w.Write((short)1);                            // PCM
        w.Write((short)channels);
        w.Write(sampleRate);
        w.Write(sampleRate * channels * 2);           // byte rate
        w.Write((short)(channels * 2));               // block align
        w.Write((short)16);                           // bits/échantillon
        w.Write("data"u8.ToArray());
        w.Write(dataBytes);
        foreach (var s in samples) w.Write(s);
    }
}
