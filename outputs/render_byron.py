import bpy, math, sys
from mathutils import Vector

sys.path.insert(0, r'C:\Users\aphro\nie\plugins\niers-blender')
try:
    import __init__ as niers_blender
    niers_blender.register()
except Exception as exc:
    print('NIERS_ADDON_REGISTER', repr(exc))

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=r'C:\Users\aphro\nie\outputs\byron-current.glb')
objs = [o for o in bpy.context.scene.objects if o.type in {'MESH','ARMATURE'}]
meshes = [o for o in objs if o.type == 'MESH']
for o in meshes:
    o.select_set(True)

scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x = 600
scene.render.resolution_y = 800
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.film_transparent = False
world = bpy.data.worlds.new('Byron World') if not scene.world else scene.world
scene.world = world
world.color = (0.025, 0.025, 0.025)

root = bpy.data.objects.new('Byron_Rotation_Root', None)
bpy.context.collection.objects.link(root)
for o in objs:
    o.parent = root

cam_data = bpy.data.cameras.new('Camera')
cam = bpy.data.objects.new('Camera', cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
cam.location = (0, -4.0, 0.82)
target = Vector((0, 0.0, 0.82))
direction = target - cam.location
cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
cam.data.lens = 58

for name, angle in [('front', 0), ('side', math.radians(90)), ('back', math.radians(180))]:
    root.rotation_euler[2] = angle
    scene.render.filepath = rf'C:\Users\aphro\nie\outputs\byron-{name}.png'
    bpy.ops.render.render(write_still=True)
    print('RENDERED', name, scene.render.filepath)

scene.render.filepath = r'C:\Users\aphro\nie\outputs\byron-rotation.blend'
bpy.ops.wm.save_as_mainfile(filepath=scene.render.filepath)
print('IMPORTED_OBJECTS', len(objs), 'MESHES', len(meshes), 'ARMATURES', len([o for o in objs if o.type=='ARMATURE']))
