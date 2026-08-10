#pragma once

/// @file encrypted_ticket.h
/// Wrapper RAII pour sdkencryptedappticket64.dll — validation de tickets DRM Steam.
///
/// Chargement dynamique via LoadLibrary/dlopen, sans dependance au Steamworks SDK.
/// Couvre les 12 fonctions exportees par la DLL + helpers haut-niveau pour
/// validation de sauvegardes et parsing de ticket.
///
/// Les 12 symboles sont decouverts via dumpbin /exports sur
/// sdkencryptedappticket64.dll livree avec nie.exe.

#include <cstdint>
#include <optional>
#include <span>
#include <string>
#include <vector>

namespace iecode::steam {

/// Informations extraites d'un ticket dechiffre.
struct TicketInfo {
    uint64_t steam_id    = 0;
    uint32_t app_id      = 0;
    uint32_t issue_time  = 0;  ///< Timestamp Unix
    bool is_vac_banned   = false;
    bool is_borrowed     = false;  ///< Family Sharing
    bool is_temporary    = false;  ///< Free Weekend
};

/// IDs de callbacks Steam decouverts par RE de nie.exe.
namespace callback_ids {
    inline constexpr int USER_ACHIEVEMENT_STORED = 0x44e;
    inline constexpr int USER_STATS_STORED       = 0x44f;
    inline constexpr int OVERLAY_ACTIVATED       = 0x14b;
    inline constexpr int GAME_OVERLAY_ACTIVATED  = 0xa8;
    inline constexpr int USER_STATS_RECEIVED     = 0x2ca;
} // namespace callback_ids

/// Wrapper RAII pour sdkencryptedappticket64.dll.
///
/// Usage :
/// @code
///   auto ticket = EncryptedTicket::load();
///   if (!ticket) { /* DLL non trouvee */ }
///
///   std::vector<uint8_t> decrypted;
///   if (ticket->decrypt(encrypted, key32, decrypted)) {
///       auto info = ticket->parse_ticket(decrypted);
///       if (info) spdlog::info("SteamID: {}", info->steam_id);
///   }
/// @endcode
class EncryptedTicket {
public:
    /// Charge la DLL. Retourne nullopt si non trouvee.
    [[nodiscard]] static std::optional<EncryptedTicket> load();

    ~EncryptedTicket();
    EncryptedTicket(EncryptedTicket&& other) noexcept;
    EncryptedTicket& operator=(EncryptedTicket&& other) noexcept;
    EncryptedTicket(const EncryptedTicket&) = delete;
    EncryptedTicket& operator=(const EncryptedTicket&) = delete;

    // ── 12 fonctions de la DLL ───────────────────────────────────────

    /// Dechiffre un ticket avec une cle de 32 octets.
    /// @param encrypted ticket chiffre
    /// @param key32 cle de dechiffrement (doit etre 32 octets)
    /// @param out buffer de sortie (redimensionne au contenu dechiffre)
    /// @return true si le dechiffrement reussit
    [[nodiscard]] bool decrypt(std::span<const uint8_t> encrypted,
                               std::span<const uint8_t> key32,
                               std::vector<uint8_t>& out) const;

    /// Verifie si le ticket correspond a un App ID donne.
    [[nodiscard]] bool is_ticket_for_app(std::span<const uint8_t> decrypted,
                                         uint32_t app_id) const;

    /// Retourne la valeur definie par l'application dans le ticket.
    [[nodiscard]] std::optional<uint32_t> get_app_defined_value(
        std::span<const uint8_t> decrypted) const;

    /// Verifie si la licence est empruntee (Family Sharing).
    [[nodiscard]] bool is_license_borrowed(std::span<const uint8_t> decrypted) const;

    /// Verifie si la licence est temporaire (Free Weekend, etc).
    [[nodiscard]] bool is_license_temporary(std::span<const uint8_t> decrypted) const;

    /// Verifie si le ticket a une signature RSA valide.
    [[nodiscard]] bool is_ticket_signed(std::span<const uint8_t> decrypted,
                                        std::span<const uint8_t> rsa_key) const;

    /// Verifie si l'utilisateur a un ban VAC.
    [[nodiscard]] bool is_vac_banned(std::span<const uint8_t> decrypted) const;

    /// Verifie si l'utilisateur possede une app donnee.
    [[nodiscard]] bool user_owns_app(std::span<const uint8_t> decrypted,
                                     uint32_t app_id) const;

    /// Retourne l'App ID du ticket.
    [[nodiscard]] uint32_t get_app_id(std::span<const uint8_t> decrypted) const;

    /// Retourne le timestamp d'emission du ticket (Unix).
    [[nodiscard]] uint32_t get_issue_time(std::span<const uint8_t> decrypted) const;

    /// Retourne le SteamID 64 bits de l'utilisateur.
    [[nodiscard]] uint64_t get_steam_id(std::span<const uint8_t> decrypted) const;

    /// Retourne les donnees utilisateur variables du ticket.
    /// Le span pointe dans le buffer dechiffre — ne pas liberer.
    [[nodiscard]] std::span<const uint8_t> get_user_variable_data(
        std::span<const uint8_t> decrypted) const;

    // ── Helpers haut-niveau ──────────────────────────────────────────

    /// Parse toutes les informations d'un ticket dechiffre.
    [[nodiscard]] std::optional<TicketInfo> parse_ticket(
        std::span<const uint8_t> decrypted) const;

    /// Valide un ticket chiffre pour une sauvegarde.
    /// Verifie l'App ID et le SteamID attendu.
    [[nodiscard]] bool validate_save_ticket(std::span<const uint8_t> encrypted,
                                            std::span<const uint8_t> key32,
                                            uint32_t app_id,
                                            uint64_t expected_steam_id) const;

    /// Dechiffre et parse un ticket en une seule operation.
    [[nodiscard]] std::optional<TicketInfo> decrypt_and_parse(
        std::span<const uint8_t> encrypted,
        std::span<const uint8_t> key32) const;

    /// La DLL est-elle chargee avec succes.
    [[nodiscard]] bool is_loaded() const noexcept { return lib_handle_ != nullptr; }

private:
    EncryptedTicket() = default;
    void close() noexcept;

    void* lib_handle_ = nullptr;

    // ── Typedefs pointeurs de fonctions ──────────────────────────────
    // Signatures matchant les exports de sdkencryptedappticket64.dll
    using FnDecrypt = bool(*)(const uint8_t*, uint32_t,
                              uint8_t*, uint32_t*,
                              const uint8_t*, int);
    using FnIsTicketForApp = bool(*)(const uint8_t*, uint32_t, uint32_t);
    using FnGetAppDefinedValue = bool(*)(const uint8_t*, uint32_t, uint32_t*);
    using FnBoolCheck = bool(*)(const uint8_t*, uint32_t);
    using FnIsTicketSigned = bool(*)(const uint8_t*, uint32_t,
                                    const uint8_t*, uint32_t);
    using FnUserOwnsApp = bool(*)(const uint8_t*, uint32_t, uint32_t);
    using FnGetUint32 = uint32_t(*)(const uint8_t*, uint32_t);
    using FnGetSteamID = void(*)(const uint8_t*, uint32_t, uint64_t*);
    using FnGetUserData = const uint8_t*(*)(const uint8_t*, uint32_t, uint32_t*);

    // ── Pointeurs resolus ────────────────────────────────────────────
    FnDecrypt            fn_decrypt_        = nullptr;
    FnIsTicketForApp     fn_is_for_app_     = nullptr;
    FnGetAppDefinedValue fn_get_app_value_  = nullptr;
    FnBoolCheck          fn_is_borrowed_    = nullptr;
    FnBoolCheck          fn_is_temporary_   = nullptr;
    FnIsTicketSigned     fn_is_signed_      = nullptr;
    FnBoolCheck          fn_is_vac_banned_  = nullptr;
    FnUserOwnsApp        fn_user_owns_app_  = nullptr;
    FnGetUint32          fn_get_app_id_     = nullptr;
    FnGetUint32          fn_get_issue_time_ = nullptr;
    FnGetSteamID         fn_get_steam_id_   = nullptr;
    FnGetUserData        fn_get_user_data_  = nullptr;
};

} // namespace iecode::steam
