/// @file gdd_shop_flag.cpp
/// Implementation des donnees de boutique et flags globaux —
/// CGDDShopStatus, CGDDFlagStatus, CGDDRandStatus.

#include "iecode/game/gdd/gdd_shop_flag.h"

#include <spdlog/spdlog.h>

namespace game {

// ── Fonctions utilitaires pour CGDDFlagStatus ──────────────────────

/// Compte le nombre de flags actifs.
[[nodiscard]] uint32_t count_active_flags(const CGDDFlagStatus& flags) {
    uint32_t count = 0;
    for (const auto word : flags.flags) {
        // Population count — compter les bits a 1
        uint32_t v = word;
        while (v != 0) {
            v &= (v - 1);
            ++count;
        }
    }
    return count;
}

/// Remet tous les flags a zero.
void clear_all_flags(CGDDFlagStatus& flags) {
    flags.flags.fill(0);
}

// ── Fonctions utilitaires pour CGDDShopStatus ──────────────────────

/// Debloque une boutique.
void unlock_shop(CGDDShopStatus& shop) {
    if (!shop.is_unlocked) {
        shop.is_unlocked = true;
        spdlog::debug("unlock_shop: boutique {} debloquee", shop.shop_id);
    }
}

/// Enregistre une visite a la boutique avec restock.
void visit_shop(CGDDShopStatus& shop, uint64_t timestamp) {
    shop.last_visit_ts = timestamp;
    ++shop.restock_count;
}

} // namespace game
