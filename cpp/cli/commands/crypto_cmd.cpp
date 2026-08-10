/// @file crypto_cmd.cpp
/// Commande CLI 'crypto' — chiffrement/dechiffrement de fichiers.
///
/// Sous-commandes :
///   iecode crypto encrypt <file> -o <output> [--type cri|xorshift] [--key hex]
///   iecode crypto decrypt <file> -o <output> [--type cri|xorshift] [--key hex]
///
/// Types :
///   - cri      : XOR CRI Middleware (cle 32 bits, derivee du nom si pas specifiee)
///   - xorshift : XorShift Level-5 (seed 32 bits extraite du fichier ou specifiee)

#include "commands.h"
#include "cli_helpers.h"

#include "iecode/crypto/cri_crypto.h"
#include "iecode/crypto/xorshift.h"
#include "iecode/crypto/crc32.h"

#include <CLI/CLI.hpp>
#include <spdlog/spdlog.h>

#include <cstdlib>
#include <filesystem>
#include <string>

namespace fs = std::filesystem;
using json = nlohmann::json;

namespace iecode::cli {

// ── Parsing de la cle hexadecimale ─────────────────────────────────

static uint32_t parse_hex_key(const std::string& key_str) {
    if (key_str.empty()) return 0;
    // Accepter "0x1234" ou "1234"
    return static_cast<uint32_t>(std::strtoul(key_str.c_str(), nullptr, 16));
}

// ── CRI encrypt/decrypt ────────────────────────────────────────────

static void cmd_cri_process(const std::string& input_path,
                            const std::string& output_path,
                            const std::string& key_str,
                            bool is_encrypt) {
    const fs::path path(input_path);
    auto data = read_file(path);
    if (data.empty()) {
        emit_error(fmt::format("impossible de lire '{}'", input_path));
        return;
    }

    // Cle : specifiee ou derivee du nom de fichier
    uint32_t key;
    if (!key_str.empty()) {
        key = parse_hex_key(key_str);
    } else {
        key = crypto::cri_derive_key(path.filename().string());
    }

    spdlog::debug("crypto cri: cle = 0x{:08X}, taille = {} octets", key, data.size());

    // XOR est symetrique — encrypt et decrypt sont la meme operation
    crypto::cri_decrypt(std::span<uint8_t>(data), key);

    // Determiner le chemin de sortie
    fs::path out_path;
    if (output_path.empty()) {
        out_path = path;
        out_path.replace_extension(
            is_encrypt ? (path.extension().string() + ".enc")
                       : (path.extension().string() + ".dec"));
    } else {
        out_path = fs::path(output_path);
    }

    if (!write_file(out_path, data)) {
        emit_error(fmt::format("impossible d'ecrire '{}'", out_path.string()));
        return;
    }

    emit(json{
        {"ok", true},
        {"type", "cri"},
        {"operation", is_encrypt ? "encrypt" : "decrypt"},
        {"key", fmt::format("0x{:08X}", key)},
        {"size", data.size()},
        {"input", path.filename().string()},
        {"output", out_path.string()},
    });
}

// ── XorShift encrypt/decrypt ───────────────────────────────────────

static void cmd_xorshift_process(const std::string& input_path,
                                  const std::string& output_path,
                                  const std::string& key_str,
                                  bool is_encrypt) {
    const fs::path path(input_path);
    auto data = read_file(path);
    if (data.empty()) {
        emit_error(fmt::format("impossible de lire '{}'", input_path));
        return;
    }

    if (is_encrypt) {
        // Chiffrement : seed requise
        if (key_str.empty()) {
            emit_error("xorshift encrypt necessite une cle (--key)");
            return;
        }
        const uint32_t seed = parse_hex_key(key_str);
        spdlog::debug("crypto xorshift encrypt: seed = 0x{:08X}", seed);
        crypto::xorshift_encrypt(std::span<uint8_t>(data), seed);
    } else {
        // Dechiffrement : seed extraite des 4 derniers octets ou specifiee
        if (!key_str.empty()) {
            // Si cle specifiee, l'utiliser comme seed d'encrypt (et re-decrypt)
            const uint32_t seed = parse_hex_key(key_str);
            spdlog::debug("crypto xorshift decrypt: seed specifiee = 0x{:08X}", seed);
            crypto::xorshift_encrypt(std::span<uint8_t>(data), seed);
        } else {
            spdlog::debug("crypto xorshift decrypt: seed auto-extraite du footer");
            crypto::xorshift_decrypt(std::span<uint8_t>(data));
        }
    }

    // Determiner le chemin de sortie
    fs::path out_path;
    if (output_path.empty()) {
        out_path = path;
        out_path.replace_extension(
            is_encrypt ? (path.extension().string() + ".enc")
                       : (path.extension().string() + ".dec"));
    } else {
        out_path = fs::path(output_path);
    }

    if (!write_file(out_path, data)) {
        emit_error(fmt::format("impossible d'ecrire '{}'", out_path.string()));
        return;
    }

    emit(json{
        {"ok", true},
        {"type", "xorshift"},
        {"operation", is_encrypt ? "encrypt" : "decrypt"},
        {"size", data.size()},
        {"input", path.filename().string()},
        {"output", out_path.string()},
    });
}

// ── Dispatch ───────────────────────────────────────────────────────

static void cmd_crypto(const std::string& input_path,
                       const std::string& output_path,
                       const std::string& type,
                       const std::string& key_str,
                       bool is_encrypt) {
    const fs::path path(input_path);
    if (!fs::exists(path) || !fs::is_regular_file(path)) {
        emit_error(fmt::format("fichier introuvable : '{}'", input_path));
        return;
    }

    if (type == "cri") {
        cmd_cri_process(input_path, output_path, key_str, is_encrypt);
    } else if (type == "xorshift") {
        cmd_xorshift_process(input_path, output_path, key_str, is_encrypt);
    } else {
        emit_error(fmt::format("type inconnu '{}' — utiliser cri|xorshift", type));
    }
}

// ── Registration ───────────────────────────────────────────────────

void register_crypto_command(CLI::App& app) {
    auto* cmd = app.add_subcommand("crypto", "Chiffrer/dechiffrer des fichiers CRI ou cfg.bin");

    // Sous-commande : encrypt
    auto* enc_cmd = cmd->add_subcommand("encrypt", "Chiffrer un fichier");
    static std::string enc_input;
    static std::string enc_output;
    static std::string enc_type;
    static std::string enc_key;
    enc_cmd->add_option("input", enc_input, "Fichier d'entree")->required();
    enc_cmd->add_option("-o,--output", enc_output, "Fichier de sortie");
    enc_cmd->add_option("--type", enc_type, "Type de chiffrement : cri|xorshift")->default_val("cri");
    enc_cmd->add_option("--key", enc_key, "Cle hexadecimale (ex: 1717E18E)");
    enc_cmd->callback([]() {
        cmd_crypto(enc_input, enc_output, enc_type, enc_key, true);
    });

    // Sous-commande : decrypt
    auto* dec_cmd = cmd->add_subcommand("decrypt", "Dechiffrer un fichier");
    static std::string dec_input;
    static std::string dec_output;
    static std::string dec_type;
    static std::string dec_key;
    dec_cmd->add_option("input", dec_input, "Fichier d'entree")->required();
    dec_cmd->add_option("-o,--output", dec_output, "Fichier de sortie");
    dec_cmd->add_option("--type", dec_type, "Type de dechiffrement : cri|xorshift")->default_val("cri");
    dec_cmd->add_option("--key", dec_key, "Cle hexadecimale (ex: 1717E18E)");
    dec_cmd->callback([]() {
        cmd_crypto(dec_input, dec_output, dec_type, dec_key, false);
    });

    cmd->require_subcommand(1);
}

} // namespace iecode::cli
