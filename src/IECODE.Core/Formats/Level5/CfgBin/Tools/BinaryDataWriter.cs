using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;

namespace IECODE.Core.Formats.Level5.CfgBin.Tools
{
    /// <summary>
    /// Binary data writer compatible with netstandard2.0 and net8.0.
    /// </summary>
    public sealed class BinaryDataWriter : IDisposable
    {
        private readonly Stream _stream;
        private bool _disposed;

        public bool BigEndian { get; set; }
        public long Length => _stream.Length;
        public Stream BaseStream => _stream;
        public long Position => _stream.Position;

        public BinaryDataWriter(Stream stream)
        {
            _stream = stream;
        }

        public BinaryDataWriter(byte[] data)
        {
            _stream = new MemoryStream(data);
        }

        public void Dispose()
        {
            if (!_disposed)
            {
                _stream.Dispose();
                _disposed = true;
            }
        }

        public void Skip(uint size)
        {
            _stream.Seek(size, SeekOrigin.Current);
        }

        public void Seek(uint position)
        {
            _stream.Seek(position, SeekOrigin.Begin);
        }

        public void Write(byte[] data)
        {
            _stream.Write(data, 0, data.Length);
        }

        public void Write(byte value)
        {
            _stream.WriteByte(value);
        }

        public void Write(sbyte value)
        {
            _stream.WriteByte((byte)value);
        }

        public void Write(short value)
        {
            byte[] buffer = BitConverter.GetBytes(value);
            if (BigEndian) Array.Reverse(buffer);
            _stream.Write(buffer, 0, buffer.Length);
        }

        public void Write(ushort value)
        {
            byte[] buffer = BitConverter.GetBytes(value);
            if (BigEndian) Array.Reverse(buffer);
            _stream.Write(buffer, 0, buffer.Length);
        }

        public void Write(int value)
        {
            byte[] buffer = BitConverter.GetBytes(value);
            if (BigEndian) Array.Reverse(buffer);
            _stream.Write(buffer, 0, buffer.Length);
        }

        public void Write(uint value)
        {
            byte[] buffer = BitConverter.GetBytes(value);
            if (BigEndian) Array.Reverse(buffer);
            _stream.Write(buffer, 0, buffer.Length);
        }

        public void Write(long value)
        {
            byte[] buffer = BitConverter.GetBytes(value);
            if (BigEndian) Array.Reverse(buffer);
            _stream.Write(buffer, 0, buffer.Length);
        }

        public void Write(ulong value)
        {
            byte[] buffer = BitConverter.GetBytes(value);
            if (BigEndian) Array.Reverse(buffer);
            _stream.Write(buffer, 0, buffer.Length);
        }

        public void Write(float value)
        {
            byte[] buffer = BitConverter.GetBytes(value);
            if (BigEndian) Array.Reverse(buffer);
            _stream.Write(buffer, 0, buffer.Length);
        }

        public void Write(double value)
        {
            byte[] buffer = BitConverter.GetBytes(value);
            if (BigEndian) Array.Reverse(buffer);
            _stream.Write(buffer, 0, buffer.Length);
        }

        public void WriteAlignment(int alignment = 16, byte alignmentByte = 0x0)
        {
            var remainder = BaseStream.Position % alignment;
            if (remainder <= 0) return;
            for (var i = 0; i < alignment - remainder; i++)
                Write(alignmentByte);
        }

        public void WriteAlignment()
        {
            Write((byte)0x00);
            WriteAlignment(16, 0xFF);
        }

        public void WriteStruct<T>(T structure) where T : unmanaged
        {
            int size = Marshal.SizeOf<T>();
            byte[] buffer = new byte[size];
            IntPtr ptr = Marshal.AllocHGlobal(size);
            try
            {
                Marshal.StructureToPtr(structure, ptr, false);
                Marshal.Copy(ptr, buffer, 0, size);
            }
            finally
            {
                Marshal.FreeHGlobal(ptr);
            }
            _stream.Write(buffer, 0, buffer.Length);
        }

        public void WriteMultipleStruct<T>(IEnumerable<T> structures) where T : unmanaged
        {
            foreach (var structure in structures)
            {
                WriteStruct(structure);
            }
        }
    }
}
