using System;
using IECODE.Core.Formats.Level5;

namespace IECODE.CLI.Commands;

public static class TestG4sk
{
    public static void Run(string path)
    {
        if (!System.IO.File.Exists(path))
        {
            Console.WriteLine($"File not found: {path}");
            return;
        }

        var parser = new G4skParser();
        parser.Parse(path);

        Console.WriteLine($"Magic: {parser.Header.Magic:X8}");
        Console.WriteLine($"Bone Count: {parser.Header.BoneCount}");

        foreach (var bone in parser.Bones)
        {
            Console.WriteLine($"Bone: {bone.Name} (Parent: {bone.ParentIndex})");
        }
    }
}
