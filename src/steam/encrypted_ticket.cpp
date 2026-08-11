/// @file encrypted_ticket.cpp
/// Implementation du wrapper sdkencryptedappticket64.dll.
///
/// Chargement dynamique des 12 symboles exportes par la DLL Steam.
/// Les helpers haut-niveau (parse_ticket, validate_save_ticket, decrypt_and_parse)
/// combinent les appels bas-niveau pour simplifier l'usage.

#include "iecode/steam/encrypted_ticket.h"
#include "iecode/steam/dll_loader.h"

#include <spdlog/spdlog.h>

namespace iecode::steam {

using detail::load_dll;
using detail::free_dll;
using detail::load_fn;

namespace {
/// Taille initiale du buffer de dechiffrement.
inline constexpr uint32_t DECRYPT_BUFFER_SIZE = 1024;
} // namespace

// ── EncryptedTicket lifecycle ────────────────────────────────────────

EncryptedTicket::~EncryptedTicket() {
    close();
}

EncryptedTicket::EncryptedTicket(EncryptedTicket&& other) noexcept
    : lib_handle_(other.lib_handle_)
    , fn_decrypt_(other.fn_decrypt_)
    , fn_is_for_app_(other.fn_is_for_app_)
    , fn_get_app_value_(other.fn_get_app_value_)
    , fn_is_borrowed_(other.fn_is_borrowed_)
    , fn_is_temporary_(other.fn_is_temporary_)
    , fn_is_signed_(other.fn_is_signed_)
    , fn_is_vac_banned_(other.fn_is_vac_banned_)
    , fn_user_owns_app_(other.fn_user_owns_app_)
    , fn_get_app_id_(other.fn_get_app_id_)
    , fn_get_issue_time_(other.fn_get_issue_time_)
    , fn_get_steam_id_(other.fn_get_steam_id_)
    , fn_get_user_data_(other.fn_get_user_data_) {
    other.lib_handle_ = nullptr;
}

EncryptedTicket& EncryptedTicket::operator=(EncryptedTicket&& other) noexcept {
    if (this != &other) {
        close();
        lib_handle_      = other.lib_handle_;
        fn_decrypt_      = other.fn_decrypt_;
        fn_is_for_app_   = other.fn_is_for_app_;
        fn_get_app_value_ = other.fn_get_app_value_;
        fn_is_borrowed_  = other.fn_is_borrowed_;
        fn_is_temporary_ = other.fn_is_temporary_;
        fn_is_signed_    = other.fn_is_signed_;
        fn_is_vac_banned_ = other.fn_is_vac_banned_;
        fn_user_owns_app_ = other.fn_user_owns_app_;
        fn_get_app_id_   = other.fn_get_app_id_;
        fn_get_issue_time_ = other.fn_get_issue_time_;
        fn_get_steam_id_ = other.fn_get_steam_id_;
        fn_get_user_data_ = other.fn_get_user_data_;
        other.lib_handle_ = nullptr;
    }
    return *this;
}

void EncryptedTicket::close() noexcept {
    if (lib_handle_) {
        free_dll(lib_handle_);
        lib_handle_ = nullptr;
        spdlog::debug("encrypted_ticket: DLL dechargee");
    }
}

// ── Chargement ──────────────────────────────────────────────────────

std::optional<EncryptedTicket> EncryptedTicket::load() {
    EncryptedTicket ticket;

    // Tenter de charger la DLL depuis le repertoire courant ou le PATH
#ifdef _WIN32
    ticket.lib_handle_ = load_dll("sdkencryptedappticket64.dll");
#else
    ticket.lib_handle_ = load_dll("libsdkencryptedappticket.so");
#endif

    if (!ticket.lib_handle_) {
        spdlog::warn("encrypted_ticket: impossible de charger la DLL");
        return std::nullopt;
    }

    spdlog::debug("encrypted_ticket: DLL chargee avec succes");

    // Resoudre les 12 symboles — tous obligatoires
    bool ok = true;
    ok &= load_fn(ticket.lib_handle_,
                  "SteamEncryptedAppTicket_BDecryptTicket",
                  ticket.fn_decrypt_);
    ok &= load_fn(ticket.lib_handle_,
                  "SteamEncryptedAppTicket_BIsTicketForApp",
                  ticket.fn_is_for_app_);
    ok &= load_fn(ticket.lib_handle_,
                  "SteamEncryptedAppTicket_BGetAppDefinedValue",
                  ticket.fn_get_app_value_);
    ok &= load_fn(ticket.lib_handle_,
                  "SteamEncryptedAppTicket_BIsLicenseBorrowed",
                  ticket.fn_is_borrowed_);
    ok &= load_fn(ticket.lib_handle_,
                  "SteamEncryptedAppTicket_BIsLicenseTemporary",
                  ticket.fn_is_temporary_);
    ok &= load_fn(ticket.lib_handle_,
                  "SteamEncryptedAppTicket_BIsTicketSigned",
                  ticket.fn_is_signed_);
    ok &= load_fn(ticket.lib_handle_,
                  "SteamEncryptedAppTicket_BUserIsVacBanned",
                  ticket.fn_is_vac_banned_);
    ok &= load_fn(ticket.lib_handle_,
                  "SteamEncryptedAppTicket_BUserOwnsAppInTicket",
                  ticket.fn_user_owns_app_);
    ok &= load_fn(ticket.lib_handle_,
                  "SteamEncryptedAppTicket_GetTicketAppID",
                  ticket.fn_get_app_id_);
    ok &= load_fn(ticket.lib_handle_,
                  "SteamEncryptedAppTicket_GetTicketIssueTime",
                  ticket.fn_get_issue_time_);
    ok &= load_fn(ticket.lib_handle_,
                  "SteamEncryptedAppTicket_GetTicketSteamID",
                  ticket.fn_get_steam_id_);
    ok &= load_fn(ticket.lib_handle_,
                  "SteamEncryptedAppTicket_GetUserVariableData",
                  ticket.fn_get_user_data_);

    if (!ok) {
        spdlog::error("encrypted_ticket: symboles manquants — DLL incompatible");
        free_dll(ticket.lib_handle_);
        ticket.lib_handle_ = nullptr;
        return std::nullopt;
    }

    spdlog::info("encrypted_ticket: 12 symboles resolus");
    return ticket;
}

// ── 12 fonctions DLL ────────────────────────────────────────────────

bool EncryptedTicket::decrypt(std::span<const uint8_t> encrypted,
                              std::span<const uint8_t> key32,
                              std::vector<uint8_t>& out) const {
    if (!fn_decrypt_ || encrypted.empty()) return false;
    if (key32.size() != 32) {
        spdlog::error("encrypted_ticket: la cle doit faire 32 octets (recu {})",
                      key32.size());
        return false;
    }

    // Allouer un buffer initial — la DLL ecrit la taille reelle dans out_size
    out.resize(DECRYPT_BUFFER_SIZE);
    auto out_size = static_cast<uint32_t>(out.size());

    const bool success = fn_decrypt_(
        encrypted.data(), static_cast<uint32_t>(encrypted.size()),
        out.data(), &out_size,
        key32.data(), static_cast<int>(key32.size()));

    if (!success) {
        out.clear();
        spdlog::debug("encrypted_ticket: echec du dechiffrement");
        return false;
    }

    // Redimensionner au contenu reel
    out.resize(out_size);
    spdlog::debug("encrypted_ticket: ticket dechiffre ({} octets)", out_size);
    return true;
}

bool EncryptedTicket::is_ticket_for_app(std::span<const uint8_t> decrypted,
                                        uint32_t app_id) const {
    if (!fn_is_for_app_ || decrypted.empty()) return false;
    return fn_is_for_app_(decrypted.data(),
                          static_cast<uint32_t>(decrypted.size()),
                          app_id);
}

std::optional<uint32_t> EncryptedTicket::get_app_defined_value(
    std::span<const uint8_t> decrypted) const {
    if (!fn_get_app_value_ || decrypted.empty()) return std::nullopt;

    uint32_t value = 0;
    if (!fn_get_app_value_(decrypted.data(),
                           static_cast<uint32_t>(decrypted.size()),
                           &value)) {
        return std::nullopt;
    }
    return value;
}

bool EncryptedTicket::is_license_borrowed(std::span<const uint8_t> decrypted) const {
    if (!fn_is_borrowed_ || decrypted.empty()) return false;
    return fn_is_borrowed_(decrypted.data(),
                           static_cast<uint32_t>(decrypted.size()));
}

bool EncryptedTicket::is_license_temporary(std::span<const uint8_t> decrypted) const {
    if (!fn_is_temporary_ || decrypted.empty()) return false;
    return fn_is_temporary_(decrypted.data(),
                            static_cast<uint32_t>(decrypted.size()));
}

bool EncryptedTicket::is_ticket_signed(std::span<const uint8_t> decrypted,
                                       std::span<const uint8_t> rsa_key) const {
    if (!fn_is_signed_ || decrypted.empty() || rsa_key.empty()) return false;
    return fn_is_signed_(decrypted.data(),
                         static_cast<uint32_t>(decrypted.size()),
                         rsa_key.data(),
                         static_cast<uint32_t>(rsa_key.size()));
}

bool EncryptedTicket::is_vac_banned(std::span<const uint8_t> decrypted) const {
    if (!fn_is_vac_banned_ || decrypted.empty()) return false;
    return fn_is_vac_banned_(decrypted.data(),
                             static_cast<uint32_t>(decrypted.size()));
}

bool EncryptedTicket::user_owns_app(std::span<const uint8_t> decrypted,
                                    uint32_t app_id) const {
    if (!fn_user_owns_app_ || decrypted.empty()) return false;
    return fn_user_owns_app_(decrypted.data(),
                             static_cast<uint32_t>(decrypted.size()),
                             app_id);
}

uint32_t EncryptedTicket::get_app_id(std::span<const uint8_t> decrypted) const {
    if (!fn_get_app_id_ || decrypted.empty()) return 0;
    return fn_get_app_id_(decrypted.data(),
                          static_cast<uint32_t>(decrypted.size()));
}

uint32_t EncryptedTicket::get_issue_time(std::span<const uint8_t> decrypted) const {
    if (!fn_get_issue_time_ || decrypted.empty()) return 0;
    return fn_get_issue_time_(decrypted.data(),
                              static_cast<uint32_t>(decrypted.size()));
}

uint64_t EncryptedTicket::get_steam_id(std::span<const uint8_t> decrypted) const {
    if (!fn_get_steam_id_ || decrypted.empty()) return 0;

    uint64_t steam_id = 0;
    fn_get_steam_id_(decrypted.data(),
                     static_cast<uint32_t>(decrypted.size()),
                     &steam_id);
    return steam_id;
}

std::span<const uint8_t> EncryptedTicket::get_user_variable_data(
    std::span<const uint8_t> decrypted) const {
    if (!fn_get_user_data_ || decrypted.empty()) return {};

    uint32_t data_size = 0;
    const uint8_t* ptr = fn_get_user_data_(
        decrypted.data(),
        static_cast<uint32_t>(decrypted.size()),
        &data_size);

    if (!ptr || data_size == 0) return {};
    return {ptr, data_size};
}

// ── Helpers haut-niveau ─────────────────────────────────────────────

std::optional<TicketInfo> EncryptedTicket::parse_ticket(
    std::span<const uint8_t> decrypted) const {
    if (decrypted.empty()) return std::nullopt;

    return TicketInfo{
        .steam_id    = get_steam_id(decrypted),
        .app_id      = get_app_id(decrypted),
        .issue_time  = get_issue_time(decrypted),
        .is_vac_banned = is_vac_banned(decrypted),
        .is_borrowed   = is_license_borrowed(decrypted),
        .is_temporary  = is_license_temporary(decrypted),
    };
}

bool EncryptedTicket::validate_save_ticket(std::span<const uint8_t> encrypted,
                                           std::span<const uint8_t> key32,
                                           uint32_t app_id,
                                           uint64_t expected_steam_id) const {
    std::vector<uint8_t> decrypted;
    if (!decrypt(encrypted, key32, decrypted)) {
        spdlog::debug("encrypted_ticket: validate_save_ticket — echec dechiffrement");
        return false;
    }

    const std::span<const uint8_t> dec_span(decrypted);

    // Verifier l'App ID
    if (!is_ticket_for_app(dec_span, app_id)) {
        spdlog::debug("encrypted_ticket: validate_save_ticket — app_id {} ne correspond pas",
                      app_id);
        return false;
    }

    // Verifier le SteamID
    const uint64_t ticket_steam_id = get_steam_id(dec_span);
    if (ticket_steam_id != expected_steam_id) {
        spdlog::debug("encrypted_ticket: validate_save_ticket — steam_id {} != attendu {}",
                      ticket_steam_id, expected_steam_id);
        return false;
    }

    return true;
}

std::optional<TicketInfo> EncryptedTicket::decrypt_and_parse(
    std::span<const uint8_t> encrypted,
    std::span<const uint8_t> key32) const {
    std::vector<uint8_t> decrypted;
    if (!decrypt(encrypted, key32, decrypted)) {
        return std::nullopt;
    }

    return parse_ticket(decrypted);
}

} // namespace iecode::steam
