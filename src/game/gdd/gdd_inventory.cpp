/// @file gdd_inventory.cpp
/// Implementation de l'inventaire — ajout, retrait, recherche, tri.

#include "iecode/game/gdd/gdd_inventory.h"

#include <spdlog/spdlog.h>

#include <algorithm>
#include <numeric>

namespace game {

/// Limite par defaut du nombre de slots d'inventaire.
inline constexpr uint32_t DEFAULT_MAX_SLOTS = 999;

/// Limite par defaut de la quantite par slot (stack).
inline constexpr uint32_t DEFAULT_MAX_STACK = 99;

/// Ajoute un item a un inventaire. Empile si l'item existe deja.
/// @param items  Vecteur d'items de l'inventaire.
/// @param item_id ID de l'item a ajouter.
/// @param quantity Quantite a ajouter.
/// @param max_stack Quantite maximale par slot.
/// @param max_slots Nombre maximum de slots.
/// @return Quantite effectivement ajoutee.
[[nodiscard]] uint32_t add_item(
    std::vector<InventorySlot>& items,
    uint32_t item_id,
    uint32_t quantity,
    uint32_t max_stack,
    uint32_t max_slots)
{
    if (item_id == 0 || quantity == 0) {
        return 0;
    }

    uint32_t remaining = quantity;

    // Chercher un slot existant avec de la place
    for (auto& slot : items) {
        if (slot.item_id == item_id && slot.quantity < max_stack) {
            const uint32_t space = max_stack - slot.quantity;
            const uint32_t to_add = std::min(remaining, space);
            slot.quantity += to_add;
            remaining -= to_add;
            if (remaining == 0) {
                return quantity;
            }
        }
    }

    // Ajouter de nouveaux slots si necessaire
    while (remaining > 0 && items.size() < max_slots) {
        const uint32_t to_add = std::min(remaining, max_stack);
        items.push_back(InventorySlot{
            .item_id  = item_id,
            .quantity = to_add,
            .is_new   = true,
        });
        remaining -= to_add;
    }

    const uint32_t added = quantity - remaining;
    if (remaining > 0) {
        spdlog::warn("add_item: inventaire plein, {} items non ajoutes (item_id={})",
                     remaining, item_id);
    }

    return added;
}

/// Retire un item de l'inventaire.
/// @return Quantite effectivement retiree.
[[nodiscard]] uint32_t remove_item(
    std::vector<InventorySlot>& items,
    uint32_t item_id,
    uint32_t quantity)
{
    if (item_id == 0 || quantity == 0) {
        return 0;
    }

    uint32_t remaining = quantity;

    // Retirer en partant de la fin (LIFO)
    for (auto it = items.rbegin(); it != items.rend() && remaining > 0; ++it) {
        if (it->item_id == item_id) {
            const uint32_t to_remove = std::min(remaining, it->quantity);
            it->quantity -= to_remove;
            remaining -= to_remove;
        }
    }

    // Nettoyer les slots vides
    items.erase(
        std::remove_if(items.begin(), items.end(),
                       [](const InventorySlot& s) { return s.quantity == 0; }),
        items.end());

    return quantity - remaining;
}

/// Retourne la quantite totale d'un item dans l'inventaire.
[[nodiscard]] uint32_t count_item(
    const std::vector<InventorySlot>& items,
    uint32_t item_id)
{
    uint32_t total = 0;
    for (const auto& slot : items) {
        if (slot.item_id == item_id) {
            total += slot.quantity;
        }
    }
    return total;
}

/// Verifie si l'inventaire contient au moins `quantity` d'un item.
[[nodiscard]] bool has_item(
    const std::vector<InventorySlot>& items,
    uint32_t item_id,
    uint32_t quantity)
{
    return count_item(items, item_id) >= quantity;
}

/// Trie l'inventaire par item_id.
void sort_by_id(std::vector<InventorySlot>& items) {
    std::sort(items.begin(), items.end(),
              [](const InventorySlot& a, const InventorySlot& b) {
                  return a.item_id < b.item_id;
              });
}

/// Trie l'inventaire par quantite (decroissant).
void sort_by_quantity(std::vector<InventorySlot>& items) {
    std::sort(items.begin(), items.end(),
              [](const InventorySlot& a, const InventorySlot& b) {
                  return a.quantity > b.quantity;
              });
}

/// Marque tous les items comme "vus" (is_new = false).
void mark_all_seen(std::vector<InventorySlot>& items) {
    for (auto& slot : items) {
        slot.is_new = false;
    }
}

/// Retourne le nombre de slots utilises.
[[nodiscard]] uint32_t used_slots(const std::vector<InventorySlot>& items) {
    return static_cast<uint32_t>(items.size());
}

/// Retourne la quantite totale de tous les items.
[[nodiscard]] uint32_t total_quantity(const std::vector<InventorySlot>& items) {
    return std::accumulate(items.begin(), items.end(), 0u,
                           [](uint32_t sum, const InventorySlot& s) { return sum + s.quantity; });
}

} // namespace game
