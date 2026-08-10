#pragma once

/// @file compute_device.h
/// Abstraction du device de compute (CComputeDevice / CComputeDeviceDX11).
/// Le moteur utilise D3D11 avec 5 compute shaders pour le rendu differe tuile.
/// Shaders : cs_tilebase, cs_light_tile, cs_cubemap_tile, cs_culling, cs_morph.
///
/// Decouvertes nie.c :
///   - Singleton global : DAT_1423afc88 (pointeur vers CComputeDevice)
///   - CComputeDeviceDX11 herite de CComputeDevice
///   - CComputeDevice est en realite un sous-objet positionne a l'offset
///     +0x258 d'une classe parente (render manager). L'acces au device
///     se fait donc via parent_ptr + 0x258.

#include "../core/object.h"
#include <cstdint>
#include <string_view>

namespace lives {

/// Unite logique de device (CDeviceUnit).
/// Encapsule un device graphique avec son contexte.
struct CDeviceUnit : CObject {
    uint32_t device_id_   = 0;
    bool     initialized_ = false;

    [[nodiscard]] std::string_view get_class_name() const override { return "CDeviceUnit"; }
};

/// Specialisation DX11 (CDeviceUnitDX11).
/// DAT_142043588 + 0x200 = pointeur vers le wrapper ID3D11Device.
/// DAT_142043588 + 0x218 = pointeur vers le wrapper IDXGIFactory.
struct CDeviceUnitDX11 : CDeviceUnit {
    // Pointeurs opaques — les vrais types sont ID3D11Device* et ID3D11DeviceContext*.
    void* d3d11_device_  = nullptr;
    void* d3d11_context_ = nullptr;
    void* dxgi_factory_  = nullptr;

    [[nodiscard]] std::string_view get_class_name() const override { return "CDeviceUnitDX11"; }
};

/// Device de calcul GPU (CComputeDevice).
/// Sous-objet positionne a +0x258 d'un render manager parent (observe dans nie.c).
/// Singleton accessible via DAT_1423afc88.
struct CComputeDevice : CObject {
    /// Offset du sous-objet CComputeDevice dans sa classe parente (render manager).
    static constexpr std::uintptr_t PARENT_SUBOBJECT_OFFSET = 0x258;

    CDeviceUnit* device_unit_ = nullptr;

    /// Retourne le singleton global (lu depuis DAT_1423afc88 dans le runtime cible).
    /// Dans iecode on expose une pair setter/getter — les bindings nie.exe
    /// branchent la vraie valeur au demarrage.
    [[nodiscard]] static CComputeDevice* instance() noexcept { return s_instance_; }
    static void set_instance(CComputeDevice* ptr) noexcept { s_instance_ = ptr; }

    [[nodiscard]] std::string_view get_class_name() const override { return "CComputeDevice"; }

private:
    inline static CComputeDevice* s_instance_ = nullptr;  ///< miroir de DAT_1423afc88
};

/// Specialisation DX11 du compute device (CComputeDeviceDX11).
/// Feature levels tentes : 11.0 -> 10.1 -> 10.0.
/// Herite directement de CComputeDevice.
struct CComputeDeviceDX11 : CComputeDevice {
    // Pointeur opaque vers ID3D11ComputeShader*.
    void* compute_shader_ = nullptr;

    [[nodiscard]] std::string_view get_class_name() const override { return "CComputeDeviceDX11"; }
};

} // namespace lives
