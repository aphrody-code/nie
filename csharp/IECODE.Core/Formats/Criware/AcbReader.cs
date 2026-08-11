// Format: ACB (.acb) — CRI Audio Cue Bank (table @UTF racine)
// Source: RE des ACB réels (ev48_*.acb). Colonnes racine : CueNameTable, CueTable,
//   WaveformTable, AwbFile, StreamAwbAfs2Header. Validé : 10 cues / 10 waveforms,
//   mapping CueName -> CueIndex -> WaveformIndex -> StreamAwbId (index AWB).

using System;
using System.Collections.Generic;
using System.IO;

namespace IECODE.Core.Formats.Criware;

/// <summary>Type d'encodage audio d'un waveform (champ EncodeType de la WaveformTable).</summary>
public enum AcbEncodeType : int
{
    Adx = 0,
    Hca = 2,
    HcaMx = 4,
    Vag = 7,
    AtracX = 8,
    Bcwav = 9,
    Nintendo = 13,
    Unknown = -1
}

/// <summary>Description d'une piste audio (cue) résolue jusqu'à son bloc AWB.</summary>
public readonly record struct AcbCue(
    string Name,
    int CueIndex,
    int WaveformIndex,
    int AwbId,          // StreamAwbId / MemoryAwbId : index attendu dans l'AWB
    bool Streaming,     // true => bloc dans l'AWB externe, false => MemoryAwb interne
    AcbEncodeType EncodeType,
    int NumChannels,
    int SamplingRate,
    long NumSamples
);

/// <summary>
/// Lecteur ACB : extrait la liste des cues et leur mapping vers les blocs AWB.
/// </summary>
public sealed class AcbReader
{
    private readonly byte[] _data;
    private readonly UtfTable _root;

    public AcbReader(byte[] data)
    {
        _data = data;
        if (!UtfTable.IsUtf(data))
            throw new InvalidDataException("ACB invalide : magic @UTF absent");
        _root = new UtfTable(data, 0);
    }

    public static AcbReader FromFile(string path) => new(File.ReadAllBytes(path));

    /// <summary>Nom interne de l'ACB (colonne Name).</summary>
    public string Name => _root.GetString(0, "Name");

    /// <summary>Version CRI (colonne VersionString).</summary>
    public string VersionString => _root.GetString(0, "VersionString");

    /// <summary>
    /// AWB interne embarqué (StreamAwbAfs2Header / AwbFile) si présent : (offset, taille).
    /// </summary>
    public UtfBlob InternalAwb
    {
        get
        {
            var awb = _root.GetBlob(0, "AwbFile");
            if (awb.Size > 0) return awb;
            return _root.GetBlob(0, "StreamAwbAfs2Header");
        }
    }

    /// <summary>
    /// Résout toutes les cues de l'ACB jusqu'à leur index AWB.
    /// </summary>
    public IReadOnlyList<AcbCue> GetCues()
    {
        var result = new List<AcbCue>();

        var cueNameTable = _root.GetSubTable(0, "CueNameTable");
        var cueTable = _root.GetSubTable(0, "CueTable");
        var waveformTable = _root.GetSubTable(0, "WaveformTable");

        if (cueNameTable is null || waveformTable is null)
            return result;

        // Pré-charge les waveforms.
        int wfCount = waveformTable.RowCount;
        var waveforms = new (int awbId, bool streaming, AcbEncodeType enc, int ch, int sr, long ns)[wfCount];
        for (int w = 0; w < wfCount; w++)
        {
            bool streaming = waveformTable.GetInt(w, "Streaming") != 0;
            int awbId = streaming
                ? (waveformTable.HasColumn("StreamAwbId") ? waveformTable.GetInt(w, "StreamAwbId") : waveformTable.GetInt(w, "Id"))
                : (waveformTable.HasColumn("MemoryAwbId") ? waveformTable.GetInt(w, "MemoryAwbId") : waveformTable.GetInt(w, "Id"));
            var enc = (AcbEncodeType)waveformTable.GetInt(w, "EncodeType");
            int ch = waveformTable.GetInt(w, "NumChannels");
            int sr = waveformTable.GetInt(w, "SamplingRate");
            long ns = waveformTable.GetLong(w, "NumSamples");
            waveforms[w] = (awbId, streaming, enc, ch, sr, ns);
        }

        // Parcourt les noms de cues -> CueIndex -> Cue (WaveformIndex via Synth/Sequence).
        for (int n = 0; n < cueNameTable.RowCount; n++)
        {
            string name = cueNameTable.GetString(n, "CueName");
            int cueIndex = cueNameTable.GetInt(n, "CueIndex");

            int waveformIndex = ResolveWaveformIndex(cueTable, cueIndex);
            // Fallback : si non résolu et autant de waveforms que de cues, mapping direct.
            if (waveformIndex < 0 && cueIndex >= 0 && cueIndex < wfCount)
                waveformIndex = cueIndex;

            if (waveformIndex < 0 || waveformIndex >= wfCount)
            {
                result.Add(new AcbCue(name, cueIndex, -1, -1, false, AcbEncodeType.Unknown, 0, 0, 0));
                continue;
            }

            var wf = waveforms[waveformIndex];
            result.Add(new AcbCue(name, cueIndex, waveformIndex, wf.awbId, wf.streaming, wf.enc, wf.ch, wf.sr, wf.ns));
        }

        return result;
    }

    /// <summary>
    /// Résout l'index du waveform pour une cue donnée en suivant la chaîne
    /// CueTable -> SequenceTable/SynthTable -> WaveformIndex. Retourne -1 si non résolu.
    /// </summary>
    private int ResolveWaveformIndex(UtfTable? cueTable, int cueIndex)
    {
        if (cueTable is null || cueIndex < 0 || cueIndex >= cueTable.RowCount)
            return -1;

        // ReferenceType : 1=Cue->Waveform direct, 2=Cue->Synth, 3=Cue->Sequence.
        int referenceType = cueTable.GetInt(cueIndex, "ReferenceType");
        int referenceIndex = cueTable.GetInt(cueIndex, "ReferenceIndex");

        switch (referenceType)
        {
            case 1: // direct -> waveform
                return referenceIndex;
            case 2: // -> Synth
                return ResolveFromSynth(referenceIndex);
            case 3: // -> Sequence -> Track -> Command -> Synth -> Waveform
                return ResolveFromSequence(referenceIndex);
            default:
                return -1;
        }
    }

    private int ResolveFromSynth(int synthIndex)
    {
        var synthTable = _root.GetSubTable(0, "SynthTable");
        if (synthTable is null || synthIndex < 0 || synthIndex >= synthTable.RowCount)
            return -1;
        // ReferenceItems : tableau [type(u16), index(u16)] ; on lit le premier waveform.
        var blob = synthTable.GetBlob(synthIndex, "ReferenceItems");
        if (blob.Size >= 4)
        {
            int type = (_data[blob.Offset] << 8) | _data[blob.Offset + 1];
            int index = (_data[blob.Offset + 2] << 8) | _data[blob.Offset + 3];
            if (type is 1 or 2) // 1=Waveform, 2=Synth
                return index;
        }
        return -1;
    }

    private int ResolveFromSequence(int sequenceIndex)
    {
        var sequenceTable = _root.GetSubTable(0, "SequenceTable");
        if (sequenceTable is null || sequenceIndex < 0 || sequenceIndex >= sequenceTable.RowCount)
            return -1;
        // TrackIndex : tableau d'u16 ; on suit la première piste vers son synth/waveform.
        var blob = sequenceTable.GetBlob(sequenceIndex, "TrackIndex");
        if (blob.Size >= 2)
        {
            int trackIndex = (_data[blob.Offset] << 8) | _data[blob.Offset + 1];
            return ResolveFromTrack(trackIndex);
        }
        return -1;
    }

    private int ResolveFromTrack(int trackIndex)
    {
        var trackTable = _root.GetSubTable(0, "TrackTable");
        if (trackTable is null || trackIndex < 0 || trackIndex >= trackTable.RowCount)
            return -1;
        int eventIndex = trackTable.GetInt(trackIndex, "EventIndex");
        // Résolution complète Track->Command->Synth non triviale ; on tente Synth direct.
        return ResolveFromSynth(eventIndex);
    }
}
