#include <gtest/gtest.h>

#include "iecode/steam/encrypted_ticket.h"

#include <array>
#include <cstring>
#include <vector>

using iecode::steam::EncryptedTicket;
using iecode::steam::TicketInfo;

/// La DLL sdkencryptedappticket64.dll n'est pas presente en CI,
/// donc on teste principalement la degradation gracieuse (load() retourne
/// nullopt) et les structures de donnees.

// ── TicketInfo struct ────────────────────────────────────────────────

TEST(EncryptedTicketTest, TicketInfoDefaultValues) {
    const TicketInfo info{};
    EXPECT_EQ(info.steam_id, 0u);
    EXPECT_EQ(info.app_id, 0u);
    EXPECT_EQ(info.issue_time, 0u);
    EXPECT_FALSE(info.is_vac_banned);
    EXPECT_FALSE(info.is_borrowed);
    EXPECT_FALSE(info.is_temporary);
}

TEST(EncryptedTicketTest, TicketInfoDesignatedInit) {
    const TicketInfo info{
        .steam_id    = 76561198000000000ULL,
        .app_id      = 2799860,
        .issue_time  = 1700000000,
        .is_vac_banned = false,
        .is_borrowed   = true,
        .is_temporary  = false,
    };

    EXPECT_EQ(info.steam_id, 76561198000000000ULL);
    EXPECT_EQ(info.app_id, 2799860u);
    EXPECT_EQ(info.issue_time, 1700000000u);
    EXPECT_FALSE(info.is_vac_banned);
    EXPECT_TRUE(info.is_borrowed);
    EXPECT_FALSE(info.is_temporary);
}

// ── Callback IDs ────────────────────────────────────────────────────

TEST(EncryptedTicketTest, CallbackIdsValues) {
    using namespace iecode::steam::callback_ids;
    EXPECT_EQ(USER_ACHIEVEMENT_STORED, 0x44e);
    EXPECT_EQ(USER_STATS_STORED, 0x44f);
    EXPECT_EQ(OVERLAY_ACTIVATED, 0x14b);
    EXPECT_EQ(GAME_OVERLAY_ACTIVATED, 0xa8);
    EXPECT_EQ(USER_STATS_RECEIVED, 0x2ca);
}

// ── Chargement DLL ──────────────────────────────────────────────────

TEST(EncryptedTicketTest, LoadReturnsSomethingOrNullopt) {
    // En CI la DLL n'est pas disponible — on verifie que load()
    // ne crashe pas et retourne nullopt proprement.
    auto ticket = EncryptedTicket::load();

    if (ticket) {
        EXPECT_TRUE(ticket->is_loaded());
    } else {
        // Degradation gracieuse — pas de crash
        SUCCEED();
    }
}

// ── Methodes sur instance invalide ──────────────────────────────────

TEST(EncryptedTicketTest, DecryptWithEmptyInputReturnsFalse) {
    auto ticket = EncryptedTicket::load();
    if (!ticket) {
        GTEST_SKIP() << "DLL non disponible";
    }

    std::vector<uint8_t> out;
    const std::span<const uint8_t> empty;
    const std::array<uint8_t, 32> key{};

    // Buffer vide -> echec
    EXPECT_FALSE(ticket->decrypt(empty, key, out));
    EXPECT_TRUE(out.empty());
}

TEST(EncryptedTicketTest, DecryptWithBadKeySizeReturnsFalse) {
    auto ticket = EncryptedTicket::load();
    if (!ticket) {
        GTEST_SKIP() << "DLL non disponible";
    }

    std::vector<uint8_t> out;
    const std::array<uint8_t, 16> bad_key{};  // 16 octets au lieu de 32
    const std::array<uint8_t, 64> fake_encrypted{};

    EXPECT_FALSE(ticket->decrypt(fake_encrypted, bad_key, out));
    EXPECT_TRUE(out.empty());
}

TEST(EncryptedTicketTest, ParseTicketEmptyReturnsNullopt) {
    auto ticket = EncryptedTicket::load();
    if (!ticket) {
        GTEST_SKIP() << "DLL non disponible";
    }

    const std::span<const uint8_t> empty;
    auto info = ticket->parse_ticket(empty);
    EXPECT_FALSE(info.has_value());
}

TEST(EncryptedTicketTest, ValidateSaveTicketEmptyReturnsFalse) {
    auto ticket = EncryptedTicket::load();
    if (!ticket) {
        GTEST_SKIP() << "DLL non disponible";
    }

    const std::span<const uint8_t> empty;
    const std::array<uint8_t, 32> key{};

    EXPECT_FALSE(ticket->validate_save_ticket(empty, key, 2799860, 0));
}

TEST(EncryptedTicketTest, DecryptAndParseEmptyReturnsNullopt) {
    auto ticket = EncryptedTicket::load();
    if (!ticket) {
        GTEST_SKIP() << "DLL non disponible";
    }

    const std::span<const uint8_t> empty;
    const std::array<uint8_t, 32> key{};

    auto info = ticket->decrypt_and_parse(empty, key);
    EXPECT_FALSE(info.has_value());
}

// ── Move semantics ──────────────────────────────────────────────────

TEST(EncryptedTicketTest, MoveConstructor) {
    auto ticket = EncryptedTicket::load();
    if (!ticket) {
        GTEST_SKIP() << "DLL non disponible";
    }

    const bool was_loaded = ticket->is_loaded();
    auto moved = std::move(*ticket);

    EXPECT_EQ(moved.is_loaded(), was_loaded);
    // Apres move, l'original ne doit plus etre charge
    EXPECT_FALSE(ticket->is_loaded());
}

TEST(EncryptedTicketTest, MoveAssignment) {
    auto ticket = EncryptedTicket::load();
    if (!ticket) {
        GTEST_SKIP() << "DLL non disponible";
    }

    auto ticket2 = EncryptedTicket::load();
    if (!ticket2) {
        GTEST_SKIP() << "DLL non disponible (second load)";
    }

    const bool was_loaded = ticket->is_loaded();
    *ticket2 = std::move(*ticket);

    EXPECT_EQ(ticket2->is_loaded(), was_loaded);
    EXPECT_FALSE(ticket->is_loaded());
}
