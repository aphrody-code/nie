#pragma once

/// @file res_base.h
/// Systeme de ressources du moteur Level-5 (lives::CRes*).
/// 34 types de ressources identifies via RTTI dans nie.exe.

#include "../core/object.h"
#include "../hash/hash_types.h"
#include <cstdint>
#include <string>
#include <string_view>

namespace lives {

/// Etat de chargement d'une ressource.
enum class ResState : uint8_t {
    UNLOADED = 0,
    LOADING  = 1,
    LOADED   = 2,
    FAILED   = 3,
};

/// Classe de base de toutes les ressources (CResBase).
/// Le moteur indexe les ressources par hash CRC32 du chemin VFS.
struct CResBase : CObject {
    hash32      name_hash_;
    std::string path_;
    ResState    state_     = ResState::UNLOADED;
    uint32_t    res_ref_count_ = 0;

    [[nodiscard]] virtual std::string_view res_type_name() const { return "CResBase"; }
    [[nodiscard]] bool is_loaded() const { return state_ == ResState::LOADED; }
    [[nodiscard]] std::string_view get_class_name() const override { return "CResBase"; }
};

// ── Declarations anticipees de tous les types de ressources ───────

// CResTexture : alias defini dans texture_manager.h
// CResMesh    : alias defini dans model_manager.h
struct CResShMesh;                          // shared mesh
struct CResSkeleton;                        // G4SK
struct CResBlendShape;                      // blend shape data
struct CResAnime;                           // animation clip
struct CResSimpleAnime;
struct CResRefAnime;
struct CResDynamicAnime;
struct CResDecalAnime;
struct CResSound;                           // CRI ACB/AWB
struct CResLua;                             // .lua.bin script
struct CResText;                            // table de textes
struct CResBinString;
// CResBinary : alias defini dans config_manager.h
struct CResFont;                            // donnees de police
struct CResObject;                          // objet scene
struct CResPack;                            // .g4pk/.g4pkm
struct CResProperty;
struct CResParticleSet;                     // .vfxo
struct CResParticleLifeTimeSyncProperty;
struct CResEffectBase;                      // .pfxo
struct CResLineEff;
struct CResLineLifeTimeSyncProperty;
struct CResComputeShader;                   // .cfxo
struct CResPhysxCol;                        // .col
struct CResPxCollection;
struct CResExternalCameraData;
struct CResInputCtrl;
struct CResLipSync;                         // .p3lip
struct CResMotEvent;                        // .mevbin
struct CResMenuData;                        // menu layout
struct CResNaviMesh;                        // .g4nv
struct CResObjectLoadListener;

} // namespace lives
