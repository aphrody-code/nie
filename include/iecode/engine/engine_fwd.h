#pragma once

/// @file engine_fwd.h
/// Declarations anticipees de tous les types lives:: (moteur Level-5).

#include <cstdint>

namespace lives {

// ── core ──────────────────────────────────────────────────────────
struct CObject;
struct CComponent;
struct CObjectLink;
enum class ComponentType : uint32_t;

// ── allocator ─────────────────────────────────────────────────────
struct IAllocator;
struct CMemNodeManagerBase;

// ── hash ──────────────────────────────────────────────────────────
struct hash32;
struct hash64;
struct REF16;
struct REF32;

// ── res (34 types de ressource) ───────────────────────────────────
struct CResBase;
// CResTexture / CResMesh : alias dans res/texture_manager.h et res/model_manager.h
struct CResShMesh;
struct CResSkeleton;
struct CResBlendShape;
struct CResAnime;
struct CResSimpleAnime;
struct CResRefAnime;
struct CResDynamicAnime;
struct CResDecalAnime;
struct CResSound;
struct CResLua;
struct CResText;
struct CResBinString;
// CResBinary : alias dans res/config_manager.h
struct CResFont;
struct CResObject;
struct CResPack;
struct CResProperty;
struct CResParticleSet;
struct CResParticleLifeTimeSyncProperty;
struct CResEffectBase;
struct CResLineEff;
struct CResLineLifeTimeSyncProperty;
struct CResComputeShader;
struct CResPhysxCol;
struct CResPxCollection;
struct CResExternalCameraData;
struct CResInputCtrl;
struct CResLipSync;
struct CResMotEvent;
struct CResMenuData;
struct CResNaviMesh;
struct CResObjectLoadListener;

// ── render ────────────────────────────────────────────────────────
enum class DrawPass : uint32_t;
struct CComputeDevice;
struct CComputeDeviceDX11;
struct CDeviceUnit;
struct CDeviceUnitDX11;
struct IShaderLibrary;
struct RenderFeature;
struct RenderPassConfig;
class RenderPipeline;
class SceneRenderer;
class DebugDraw;

// ── menu ──────────────────────────────────────────────────────────
struct MenuLayout;
struct CMenuObject;
struct IMenuController;
struct IMenuTextInfo;
struct CMenuRender;
struct CMenuRenderComponent;
struct CMenuListView;
struct CMenuLayerGroup;
struct CMenuLayerObject;
struct CMenuAnimation;
struct CMenuSimpleAnimation;
struct CMenuRateAnimeCtrl;
struct CMenuRateAnimeCompetitionCtrl;

// ── input ─────────────────────────────────────────────────────────
struct CPad;
struct CPadArray;
struct CPadSteam;
struct CKeyboard;
struct CKeyboardWin;
struct CMouse;
struct CMouseVirtualInput;

// ── camera ────────────────────────────────────────────────────────
struct CCamera;
struct CCameraAnimeCtrl;

// ── scripting ─────────────────────────────────────────────────────
struct CLuaScript;

// ── physics ───────────────────────────────────────────────────────
struct CPhysicsRigidbodyComponent;
struct CPhysicsClothComponent;
struct CPhysxStepper;
struct CPxMapMeshCollider;

// ── sound ─────────────────────────────────────────────────────────
struct ISoundController;
struct CCriSoundController;

// ── gmd ───────────────────────────────────────────────────────────
struct gmdCAnimation;
struct gmdCAnimationAsync;
struct gmdCObjModelComponent;
struct gmdCObjModelLodInfo;

// ── effect ────────────────────────────────────────────────────────
struct CEffectObjComponent;
struct CParticleRootComponent;
struct CLineEffRootComponent;

// ── ecs ──────────────────────────────────────────────────────────────
namespace ecs {
class Actor;
class Component;
class Behaviour;
struct Transform;
} // namespace ecs

} // namespace lives
