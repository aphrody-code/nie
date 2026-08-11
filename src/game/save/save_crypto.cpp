#include "iecode/game/save/save_crypto.h"

#include <cstring>

#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <bcrypt.h>
#pragma comment(lib, "bcrypt.lib")

#ifndef NT_SUCCESS
#define NT_SUCCESS(Status) (((NTSTATUS)(Status)) >= 0)
#endif
#endif

namespace iecode::game {

namespace {

constexpr size_t AES_BLOCK_SIZE = 16;

#ifdef _WIN32

/// RAII wrapper pour BCRYPT_ALG_HANDLE.
class AlgHandle {
public:
    AlgHandle() = default;
    ~AlgHandle() {
        if (handle_) {
            BCryptCloseAlgorithmProvider(handle_, 0);
        }
    }
    AlgHandle(const AlgHandle&) = delete;
    AlgHandle& operator=(const AlgHandle&) = delete;

    [[nodiscard]] BCRYPT_ALG_HANDLE* out() noexcept { return &handle_; }
    [[nodiscard]] BCRYPT_ALG_HANDLE get() const noexcept { return handle_; }

private:
    BCRYPT_ALG_HANDLE handle_ = nullptr;
};

/// RAII wrapper pour BCRYPT_KEY_HANDLE.
class KeyHandle {
public:
    KeyHandle() = default;
    ~KeyHandle() {
        if (handle_) {
            BCryptDestroyKey(handle_);
        }
    }
    KeyHandle(const KeyHandle&) = delete;
    KeyHandle& operator=(const KeyHandle&) = delete;

    [[nodiscard]] BCRYPT_KEY_HANDLE* out() noexcept { return &handle_; }
    [[nodiscard]] BCRYPT_KEY_HANDLE get() const noexcept { return handle_; }

private:
    BCRYPT_KEY_HANDLE handle_ = nullptr;
};

/// Ouvre un algo AES en mode CBC et cree une cle symetrique.
[[nodiscard]] bool open_aes_cbc(AlgHandle& alg, KeyHandle& key_handle,
                                std::span<const uint8_t, 16> key) {
    NTSTATUS status = BCryptOpenAlgorithmProvider(
        alg.out(), BCRYPT_AES_ALGORITHM, nullptr, 0);
    if (!NT_SUCCESS(status)) {
        return false;
    }

    status = BCryptSetProperty(
        alg.get(), BCRYPT_CHAINING_MODE,
        reinterpret_cast<PUCHAR>(const_cast<wchar_t*>(BCRYPT_CHAIN_MODE_CBC)),
        sizeof(BCRYPT_CHAIN_MODE_CBC), 0);
    if (!NT_SUCCESS(status)) {
        return false;
    }

    status = BCryptGenerateSymmetricKey(
        alg.get(), key_handle.out(), nullptr, 0,
        // BCryptGenerateSymmetricKey ne modifie pas la cle — const_cast safe
        const_cast<PUCHAR>(key.data()),
        static_cast<ULONG>(key.size()), 0);
    return NT_SUCCESS(status);
}

#endif // _WIN32

} // namespace

std::optional<std::vector<uint8_t>>
save_decrypt(std::span<const uint8_t> data,
             std::span<const uint8_t, 16> key) {
#ifdef _WIN32
    // IV(16) + au moins 1 bloc de ciphertext
    if (data.size() < 2 * AES_BLOCK_SIZE) {
        return std::nullopt;
    }
    const size_t cipher_size = data.size() - AES_BLOCK_SIZE;
    if (cipher_size % AES_BLOCK_SIZE != 0) {
        return std::nullopt;
    }

    AlgHandle alg;
    KeyHandle key_handle;
    if (!open_aes_cbc(alg, key_handle, key)) {
        return std::nullopt;
    }

    // BCryptDecrypt modifie l'IV — copier dans un buffer local
    std::array<uint8_t, AES_BLOCK_SIZE> iv{};
    std::memcpy(iv.data(), data.data(), AES_BLOCK_SIZE);

    std::vector<uint8_t> plaintext(cipher_size);
    ULONG out_size = 0;

    // Pas de flag de padding : on gere PKCS7 manuellement pour eviter
    // les erreurs si le dernier bloc n'est pas strictement PKCS7 conforme.
    NTSTATUS status = BCryptDecrypt(
        key_handle.get(),
        const_cast<PUCHAR>(data.data() + AES_BLOCK_SIZE),
        static_cast<ULONG>(cipher_size),
        nullptr,
        iv.data(), static_cast<ULONG>(iv.size()),
        plaintext.data(), static_cast<ULONG>(plaintext.size()),
        &out_size, 0);

    if (!NT_SUCCESS(status)) {
        return std::nullopt;
    }
    plaintext.resize(out_size);

    // PKCS7 unpadding (best-effort)
    if (!plaintext.empty()) {
        const uint8_t pad = plaintext.back();
        if (pad > 0 && pad <= AES_BLOCK_SIZE && pad <= plaintext.size()) {
            bool valid = true;
            for (size_t i = plaintext.size() - pad; i < plaintext.size(); ++i) {
                if (plaintext[i] != pad) {
                    valid = false;
                    break;
                }
            }
            if (valid) {
                plaintext.resize(plaintext.size() - pad);
            }
        }
    }

    return plaintext;
#else
    (void)data;
    (void)key;
    return std::nullopt;
#endif
}

std::optional<std::vector<uint8_t>>
save_encrypt(std::span<const uint8_t> plaintext,
             std::span<const uint8_t, 16> key) {
#ifdef _WIN32
    AlgHandle alg;
    KeyHandle key_handle;
    if (!open_aes_cbc(alg, key_handle, key)) {
        return std::nullopt;
    }

    // IV aleatoire
    std::array<uint8_t, AES_BLOCK_SIZE> iv{};
    NTSTATUS status = BCryptGenRandom(
        nullptr, iv.data(), static_cast<ULONG>(iv.size()),
        BCRYPT_USE_SYSTEM_PREFERRED_RNG);
    if (!NT_SUCCESS(status)) {
        return std::nullopt;
    }

    // PKCS7 padding
    const size_t pad = AES_BLOCK_SIZE - (plaintext.size() % AES_BLOCK_SIZE);
    std::vector<uint8_t> padded(plaintext.size() + pad);
    std::memcpy(padded.data(), plaintext.data(), plaintext.size());
    std::memset(padded.data() + plaintext.size(), static_cast<int>(pad), pad);

    // BCryptEncrypt modifie l'IV — copie pour preserver l'IV dans le resultat
    std::array<uint8_t, AES_BLOCK_SIZE> iv_work = iv;

    std::vector<uint8_t> result(AES_BLOCK_SIZE + padded.size());
    std::memcpy(result.data(), iv.data(), AES_BLOCK_SIZE);

    ULONG out_size = 0;
    status = BCryptEncrypt(
        key_handle.get(),
        padded.data(), static_cast<ULONG>(padded.size()),
        nullptr,
        iv_work.data(), static_cast<ULONG>(iv_work.size()),
        result.data() + AES_BLOCK_SIZE, static_cast<ULONG>(padded.size()),
        &out_size, 0);

    if (!NT_SUCCESS(status)) {
        return std::nullopt;
    }
    result.resize(AES_BLOCK_SIZE + out_size);
    return result;
#else
    (void)plaintext;
    (void)key;
    return std::nullopt;
#endif
}

} // namespace iecode::game
