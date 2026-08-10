#pragma once

/// @file object.h
/// Base de tous les objets du moteur Level-5 (lives::CObject).

#include <cstdint>
#include <string_view>

namespace lives {

/// Base de tous les objets du moteur (CObject).
/// Adresse vftable nie.exe : DAT_141c1f8b0
struct CObject {
    virtual ~CObject() noexcept;

    CObject() = default;
    CObject(const CObject&) = default;
    CObject& operator=(const CObject&) = default;
    CObject(CObject&&) noexcept = default;
    CObject& operator=(CObject&&) noexcept = default;

    virtual void initialize() {}
    virtual void finalize() {}
    [[nodiscard]] virtual std::string_view get_class_name() const { return "CObject"; }

    uint32_t ref_count_ = 0;
};

/// Type de composant (CComponentType).
enum class ComponentType : uint32_t {
    UNKNOWN    = 0,
    RENDER     = 1,
    PHYSICS    = 2,
    ANIMATION  = 3,
    AUDIO      = 4,
    INPUT      = 5,
    SCRIPT     = 6,
    UI         = 7,
    EFFECT     = 8,
    CAMERA     = 9,
    NAVIGATION = 10,
};

/// Composant attachable a un CObject (CComponent).
struct CComponent : CObject {
    CObject*       owner_   = nullptr;
    ComponentType  type_    = ComponentType::UNKNOWN;
    bool           enabled_ = true;
};

/// Lien de reference faible (CObjectLink).
struct CObjectLink {
    CObject* target_ = nullptr;

    [[nodiscard]] bool is_valid() const { return target_ != nullptr; }
};

} // namespace lives
