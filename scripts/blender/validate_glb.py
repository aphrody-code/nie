"""
validate_glb.py — Validation headless de fichiers GLB via Blender.

Usage:
    blender --background --python validate_glb.py -- input.glb

Verifie qu'un fichier GLB est importable dans Blender sans erreur.
Retourne un code 0 si OK, 1 si erreur.
"""

import sys
import os


def main():
    # Les arguments apres "--" sont passes au script
    argv = sys.argv
    separator = argv.index("--") if "--" in argv else -1
    if separator < 0 or separator + 1 >= len(argv):
        print("Usage: blender --background --python validate_glb.py -- <fichier.glb>")
        sys.exit(1)

    glb_path = argv[separator + 1]

    if not os.path.isfile(glb_path):
        print(f"ERREUR: fichier introuvable: {glb_path}")
        sys.exit(1)

    try:
        import bpy  # type: ignore

        # Nettoyer la scene par defaut
        bpy.ops.object.select_all(action='SELECT')
        bpy.ops.object.delete()

        # Importer le GLB
        bpy.ops.import_scene.gltf(filepath=glb_path)

        # Verifier qu'au moins un objet a ete importe
        objects = [obj for obj in bpy.data.objects if obj.type == 'MESH']
        if not objects:
            print(f"AVERTISSEMENT: aucun mesh importe depuis {glb_path}")
            sys.exit(1)

        print(f"OK: {len(objects)} mesh(es) importe(s) depuis {glb_path}")
        for obj in objects:
            verts = len(obj.data.vertices)
            faces = len(obj.data.polygons)
            print(f"  - {obj.name}: {verts} vertices, {faces} faces")

        sys.exit(0)

    except Exception as e:
        print(f"ERREUR: import GLB echoue: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
