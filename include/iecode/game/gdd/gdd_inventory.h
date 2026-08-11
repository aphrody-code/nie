#pragma once

/// @file gdd_inventory.h
/// Inventaires runtime — consommables, equipements, collections.
/// Chaque type d'inventaire est une specialisation de CGDDSerialize.

#include "gdd_serialize.h"
#include <vector>
#include <cstdint>

namespace game {

/// Slot d'inventaire generique.
struct InventorySlot {
    uint32_t item_id  = 0;
    uint32_t quantity = 0;
    bool     is_new   = false;
};

/// Inventaire consommables — CGDDInventoryConsume.
struct CGDDInventoryConsume : CGDDSerialize {
    std::vector<InventorySlot> items;

    [[nodiscard]] std::string_view gdd_type_name() const override { return "CGDDInventoryConsume"; }
    bool serialize(std::vector<uint8_t>&) const override { return true; }
    bool deserialize(const std::vector<uint8_t>&) override { return true; }
};

/// Inventaire equipements — CGDDInventoryEquipment.
struct CGDDInventoryEquipment : CGDDSerialize {
    std::vector<InventorySlot> items;

    [[nodiscard]] std::string_view gdd_type_name() const override { return "CGDDInventoryEquipment"; }
    bool serialize(std::vector<uint8_t>&) const override { return true; }
    bool deserialize(const std::vector<uint8_t>&) override { return true; }
};

/// Inventaire animaux — CGDDInventoryAnimal.
struct CGDDInventoryAnimal : CGDDSerialize {
    std::vector<InventorySlot> items;

    [[nodiscard]] std::string_view gdd_type_name() const override { return "CGDDInventoryAnimal"; }
    bool serialize(std::vector<uint8_t>&) const override { return true; }
    bool deserialize(const std::vector<uint8_t>&) override { return true; }
};

/// Inventaire collection — CGDDInventoryCollection.
struct CGDDInventoryCollection : CGDDSerialize {
    std::vector<InventorySlot> items;

    [[nodiscard]] std::string_view gdd_type_name() const override { return "CGDDInventoryCollection"; }
    bool serialize(std::vector<uint8_t>&) const override { return true; }
    bool deserialize(const std::vector<uint8_t>&) override { return true; }
};

/// Inventaire objets craft — CGDDInventoryCraftObj.
struct CGDDInventoryCraftObj : CGDDSerialize {
    std::vector<InventorySlot> items;

    [[nodiscard]] std::string_view gdd_type_name() const override { return "CGDDInventoryCraftObj"; }
    bool serialize(std::vector<uint8_t>&) const override { return true; }
    bool deserialize(const std::vector<uint8_t>&) override { return true; }
};

/// Inventaire liens kizuna — CGDDInventoryKizunaLink.
struct CGDDInventoryKizunaLink : CGDDSerialize {
    std::vector<InventorySlot> items;

    [[nodiscard]] std::string_view gdd_type_name() const override { return "CGDDInventoryKizunaLink"; }
    bool serialize(std::vector<uint8_t>&) const override { return true; }
    bool deserialize(const std::vector<uint8_t>&) override { return true; }
};

/// Inventaire name plates — CGDDInventoryNamePlate.
struct CGDDInventoryNamePlate : CGDDSerialize {
    std::vector<InventorySlot> items;

    [[nodiscard]] std::string_view gdd_type_name() const override { return "CGDDInventoryNamePlate"; }
    bool serialize(std::vector<uint8_t>&) const override { return true; }
    bool deserialize(const std::vector<uint8_t>&) override { return true; }
};

/// Inventaire performances — CGDDInventoryPerformance.
struct CGDDInventoryPerformance : CGDDSerialize {
    std::vector<InventorySlot> items;

    [[nodiscard]] std::string_view gdd_type_name() const override { return "CGDDInventoryPerformance"; }
    bool serialize(std::vector<uint8_t>&) const override { return true; }
    bool deserialize(const std::vector<uint8_t>&) override { return true; }
};

/// Inventaire competences — CGDDInventorySkill.
struct CGDDInventorySkill : CGDDSerialize {
    std::vector<InventorySlot> items;

    [[nodiscard]] std::string_view gdd_type_name() const override { return "CGDDInventorySkill"; }
    bool serialize(std::vector<uint8_t>&) const override { return true; }
    bool deserialize(const std::vector<uint8_t>&) override { return true; }
};

/// Inventaire statuts — CGDDInventoryStatus.
struct CGDDInventoryStatus : CGDDSerialize {
    std::vector<InventorySlot> items;

    [[nodiscard]] std::string_view gdd_type_name() const override { return "CGDDInventoryStatus"; }
    bool serialize(std::vector<uint8_t>&) const override { return true; }
    bool deserialize(const std::vector<uint8_t>&) override { return true; }
};

/// Inventaire objets d'equipe — CGDDInventoryTeamItem.
struct CGDDInventoryTeamItem : CGDDSerialize {
    std::vector<InventorySlot> items;

    [[nodiscard]] std::string_view gdd_type_name() const override { return "CGDDInventoryTeamItem"; }
    bool serialize(std::vector<uint8_t>&) const override { return true; }
    bool deserialize(const std::vector<uint8_t>&) override { return true; }
};

/// Inventaire titres — CGDDInventoryTitle.
struct CGDDInventoryTitle : CGDDSerialize {
    std::vector<InventorySlot> items;

    [[nodiscard]] std::string_view gdd_type_name() const override { return "CGDDInventoryTitle"; }
    bool serialize(std::vector<uint8_t>&) const override { return true; }
    bool deserialize(const std::vector<uint8_t>&) override { return true; }
};

} // namespace game
