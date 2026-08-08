using System;
using System.Collections.Generic;
using System.IO;
using System.Text;

namespace IECODE.Core.Formats.Shader
{
    /// <summary>
    /// Lecteur du conteneur DXBC (DirectX Byte Code) — le format réel des fichiers
    /// `.vfxo` (vertex shaders) et `.pfxo` (pixel shaders) d'IEVR, qui démarrent par
    /// le magic ASCII "DXBC".
    ///
    /// Disposition (documentée par Microsoft, little-endian) :
    ///   +0x00  char[4]  magic = "DXBC"
    ///   +0x04  byte[16] digest MD5 (checksum DXBC du contenu)
    ///   +0x14  uint32   version (1.0 = 0x00000001)
    ///   +0x18  uint32   taille totale du conteneur en octets
    ///   +0x1C  uint32   nombre de chunks
    ///   +0x20  uint32[] table des offsets de chunks (absolus depuis le début)
    /// Chaque chunk :
    ///   +0x00  char[4]  fourcc (RDEF / ISGN / OSGN / SHEX / SHDR / STAT / RD11 ...)
    ///   +0x04  uint32   taille du contenu (hors en-tête de 8 octets)
    ///   +0x08  byte[]   données
    /// </summary>
    public sealed class DxbcReader
    {
        public const uint Magic = 0x43425844; // 'D''X''B''C' en little-endian

        public byte[] Digest { get; } = new byte[16];
        public uint Version { get; private set; }
        public uint TotalSize { get; private set; }
        public IReadOnlyList<DxbcChunk> Chunks => _chunks;

        private readonly List<DxbcChunk> _chunks = new();

        /// <summary>Type de programme déduit du chunk SHEX/SHDR (token de version).</summary>
        public DxbcProgramType ProgramType { get; private set; } = DxbcProgramType.Unknown;
        public int ShaderModelMajor { get; private set; }
        public int ShaderModelMinor { get; private set; }

        /// <summary>Compilateur HLSL extrait du chunk RDEF (ex. "Microsoft (R) HLSL Shader Compiler ...").</summary>
        public string? Creator { get; private set; }

        public static bool IsDxbc(ReadOnlySpan<byte> data)
            => data.Length >= 4 && data[0] == (byte)'D' && data[1] == (byte)'X' && data[2] == (byte)'B' && data[3] == (byte)'C';

        public static DxbcReader Parse(string path) => Parse(File.ReadAllBytes(path));

        public static DxbcReader Parse(byte[] data)
        {
            if (!IsDxbc(data))
                throw new InvalidDataException("Pas un conteneur DXBC (magic 'DXBC' attendu).");
            if (data.Length < 0x20)
                throw new InvalidDataException("Fichier DXBC tronqué (en-tête < 0x20).");

            var r = new DxbcReader();
            Buffer.BlockCopy(data, 0x04, r.Digest, 0, 16);
            r.Version = ReadU32(data, 0x14);
            r.TotalSize = ReadU32(data, 0x18);
            uint chunkCount = ReadU32(data, 0x1C);

            if (chunkCount > 64)
                throw new InvalidDataException($"Nombre de chunks DXBC invraisemblable ({chunkCount}).");

            for (uint i = 0; i < chunkCount; i++)
            {
                int tableOff = 0x20 + (int)(i * 4);
                if (tableOff + 4 > data.Length)
                    throw new InvalidDataException("Table des offsets de chunks tronquée.");
                uint chunkOff = ReadU32(data, tableOff);
                if (chunkOff + 8 > data.Length)
                    throw new InvalidDataException($"Offset de chunk #{i} hors limites.");

                string fourcc = Encoding.ASCII.GetString(data, (int)chunkOff, 4);
                uint size = ReadU32(data, (int)chunkOff + 4);
                int dataStart = (int)chunkOff + 8;
                if (dataStart + (long)size > data.Length)
                    throw new InvalidDataException($"Chunk {fourcc} déborde du fichier.");

                var payload = new byte[size];
                Buffer.BlockCopy(data, dataStart, payload, 0, (int)size);
                r._chunks.Add(new DxbcChunk(fourcc, (uint)chunkOff, size, payload));

                if (fourcc is "SHEX" or "SHDR")
                    r.DecodeProgramToken(payload);
                else if (fourcc == "RDEF")
                    r.DecodeRdefCreator(payload);
            }

            return r;
        }

        private void DecodeProgramToken(byte[] payload)
        {
            if (payload.Length < 4) return;
            uint token = ReadU32(payload, 0);
            // Bits 31..16 : type de programme ; bits 7..4 major ; bits 3..0 minor.
            int type = (int)(token >> 16);
            ShaderModelMajor = (int)((token >> 4) & 0xF);
            ShaderModelMinor = (int)(token & 0xF);
            ProgramType = type switch
            {
                0 => DxbcProgramType.Pixel,
                1 => DxbcProgramType.Vertex,
                2 => DxbcProgramType.Geometry,
                3 => DxbcProgramType.Hull,
                4 => DxbcProgramType.Domain,
                5 => DxbcProgramType.Compute,
                _ => DxbcProgramType.Unknown,
            };
        }

        private void DecodeRdefCreator(byte[] payload)
        {
            // RDEF : +0x18 = offset (relatif au début du chunk) vers la chaîne "Creator".
            // (+0x1C porte la signature étendue "RD11" sur les shaders SM5, pas le créateur.)
            if (payload.Length < 0x20) return;
            uint creatorOff = ReadU32(payload, 0x18);
            if (creatorOff == 0 || creatorOff >= payload.Length) return;
            int end = (int)creatorOff;
            while (end < payload.Length && payload[end] != 0) end++;
            Creator = Encoding.ASCII.GetString(payload, (int)creatorOff, end - (int)creatorOff);
        }

        public DxbcChunk? FindChunk(string fourcc)
        {
            foreach (var c in _chunks)
                if (c.FourCc == fourcc) return c;
            return null;
        }

        private static uint ReadU32(byte[] d, int o)
            => (uint)(d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24));
    }

    public enum DxbcProgramType
    {
        Unknown = -1,
        Pixel = 0,
        Vertex = 1,
        Geometry = 2,
        Hull = 3,
        Domain = 4,
        Compute = 5,
    }

    public sealed class DxbcChunk
    {
        public string FourCc { get; }
        public uint Offset { get; }
        public uint Size { get; }
        public byte[] Data { get; }

        public DxbcChunk(string fourCc, uint offset, uint size, byte[] data)
        {
            FourCc = fourCc;
            Offset = offset;
            Size = size;
            Data = data;
        }
    }
}
