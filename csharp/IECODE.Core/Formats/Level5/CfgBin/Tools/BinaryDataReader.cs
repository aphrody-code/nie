using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Diagnostics.CodeAnalysis;

namespace IECODE.Core.Formats.Level5.CfgBin.Tools
{
    /// <summary>
    /// Binary data reader compatible with netstandard2.0 and net8.0.
    /// </summary>
    public sealed class BinaryDataReader : IDisposable
    {
        private readonly Stream _stream;
        private bool _disposed;

        public bool BigEndian { get; set; }
        public long Length => _stream.Length;
        public Stream BaseStream => _stream;
        public long Position => _stream.Position;

        public BinaryDataReader(byte[] data)
        {
            _stream = new MemoryStream(data);
        }

        public BinaryDataReader(Stream stream)
        {
            _stream = stream;
        }

        public void Dispose()
        {
            if (!_disposed)
            {
                _stream.Dispose();
                _disposed = true;
            }
        }

        private void ReadExactly(byte[] buffer, int offset, int count)
        {
            int totalRead = 0;
            while (totalRead < count)
            {
                int read = _stream.Read(buffer, offset + totalRead, count - totalRead);
                if (read == 0) throw new EndOfStreamException();
                totalRead += read;
            }
        }

        public byte ReadByte()
        {
            int b = _stream.ReadByte();
            if (b < 0) throw new EndOfStreamException();
            return (byte)b;
        }

        public sbyte ReadSByte() => (sbyte)ReadByte();

        public short ReadInt16()
        {
            byte[] buffer = new byte[2];
            ReadExactly(buffer, 0, 2);
            if (BigEndian) Array.Reverse(buffer);
            return BitConverter.ToInt16(buffer, 0);
        }

        public ushort ReadUInt16()
        {
            byte[] buffer = new byte[2];
            ReadExactly(buffer, 0, 2);
            if (BigEndian) Array.Reverse(buffer);
            return BitConverter.ToUInt16(buffer, 0);
        }

        public int ReadInt32()
        {
            byte[] buffer = new byte[4];
            ReadExactly(buffer, 0, 4);
            if (BigEndian) Array.Reverse(buffer);
            return BitConverter.ToInt32(buffer, 0);
        }

        public uint ReadUInt32()
        {
            byte[] buffer = new byte[4];
            ReadExactly(buffer, 0, 4);
            if (BigEndian) Array.Reverse(buffer);
            return BitConverter.ToUInt32(buffer, 0);
        }

        public long ReadInt64()
        {
            byte[] buffer = new byte[8];
            ReadExactly(buffer, 0, 8);
            if (BigEndian) Array.Reverse(buffer);
            return BitConverter.ToInt64(buffer, 0);
        }

        public ulong ReadUInt64()
        {
            byte[] buffer = new byte[8];
            ReadExactly(buffer, 0, 8);
            if (BigEndian) Array.Reverse(buffer);
            return BitConverter.ToUInt64(buffer, 0);
        }

        public float ReadSingle()
        {
            byte[] buffer = new byte[4];
            ReadExactly(buffer, 0, 4);
            if (BigEndian) Array.Reverse(buffer);
            return BitConverter.ToSingle(buffer, 0);
        }

        public double ReadDouble()
        {
            byte[] buffer = new byte[8];
            ReadExactly(buffer, 0, 8);
            if (BigEndian) Array.Reverse(buffer);
            return BitConverter.ToDouble(buffer, 0);
        }

        [RequiresUnreferencedCode("Calls System.Runtime.InteropServices.Marshal.PtrToStructure<T>(IntPtr)")]
        public T ReadValue<[DynamicallyAccessedMembers(DynamicallyAccessedMemberTypes.PublicConstructors | DynamicallyAccessedMemberTypes.NonPublicConstructors)] T>() where T : struct
        {
            int size = Marshal.SizeOf<T>();
            byte[] buffer = new byte[size];
            ReadExactly(buffer, 0, size);
            if (BigEndian) Array.Reverse(buffer);

            GCHandle handle = GCHandle.Alloc(buffer, GCHandleType.Pinned);
            try
            {
                return Marshal.PtrToStructure<T>(handle.AddrOfPinnedObject());
            }
            finally
            {
                handle.Free();
            }
        }

        [RequiresUnreferencedCode("Calls ReadValue<T> which requires unreferenced code.")]
        public T[] ReadMultipleValue<[DynamicallyAccessedMembers(DynamicallyAccessedMemberTypes.PublicConstructors | DynamicallyAccessedMemberTypes.NonPublicConstructors)] T>(int count) where T : struct
        {
            var result = new T[count];
            for (int i = 0; i < count; i++)
            {
                result[i] = ReadValue<T>();
            }
            return result;
        }

        public string ReadString(Encoding encoding)
        {
            var bytes = new List<byte>();
            int b;

            while ((b = _stream.ReadByte()) > 0 && _stream.Position <= _stream.Length)
            {
                bytes.Add((byte)b);
            }

            return encoding.GetString(bytes.ToArray());
        }

        public void Skip(uint size)
        {
            _stream.Seek(size, SeekOrigin.Current);
        }

        public void Seek(uint position)
        {
            _stream.Seek(position, SeekOrigin.Begin);
        }

        public byte[] GetSection(int size)
        {
            byte[] data = new byte[size];
            ReadExactly(data, 0, size);
            return data;
        }

        public byte[] GetSection(uint offset, int size)
        {
            long temp = _stream.Position;
            Seek(offset);
            byte[] data = new byte[size];
            ReadExactly(data, 0, size);
            Seek((uint)temp);
            return data;
        }

        [RequiresUnreferencedCode("Calls ReadValue<T> which requires unreferenced code.")]
        public T ReadStruct<[DynamicallyAccessedMembers(DynamicallyAccessedMemberTypes.PublicConstructors | DynamicallyAccessedMemberTypes.NonPublicConstructors)] T>() where T : struct // Removed unmanaged constraint as ReadValue has struct constraint
        {
            return ReadValue<T>();
        }

        [RequiresUnreferencedCode("Calls ReadValue<T> which requires unreferenced code.")]
        public T[] ReadMultipleStruct<[DynamicallyAccessedMembers(DynamicallyAccessedMemberTypes.PublicConstructors | DynamicallyAccessedMemberTypes.NonPublicConstructors)] T>(int count) where T : struct
        {
            return ReadMultipleValue<T>(count);
        }
    }
}
