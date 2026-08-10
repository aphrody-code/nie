#include "iecode/game/save/save_crypto.h"

#include <array>
#include <cstdint>
#include <gtest/gtest.h>
#include <vector>

using namespace iecode::game;

namespace {

constexpr std::array<uint8_t, 16> TEST_KEY = {
    0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
    0x08, 0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x0E, 0x0F,
};

} // namespace

TEST(SaveCrypto, RoundtripEncryptDecrypt) {
#ifdef _WIN32
    // Plaintext de 32 bytes — aligne sur un bloc AES mais necessite
    // un bloc de padding PKCS7 supplementaire.
    std::vector<uint8_t> plaintext(32);
    for (size_t i = 0; i < plaintext.size(); ++i) {
        plaintext[i] = static_cast<uint8_t>(i * 7 + 3);
    }

    auto encrypted = save_encrypt(plaintext, std::span<const uint8_t, 16>(TEST_KEY));
    ASSERT_TRUE(encrypted.has_value());

    // IV(16) + ciphertext(32 + 16 pad) = 64
    EXPECT_EQ(encrypted->size(), 16u + 32u + 16u);

    auto decrypted = save_decrypt(*encrypted, std::span<const uint8_t, 16>(TEST_KEY));
    ASSERT_TRUE(decrypted.has_value());
    EXPECT_EQ(*decrypted, plaintext);
#else
    GTEST_SKIP() << "save_crypto necessite Windows CNG (bcrypt)";
#endif
}

TEST(SaveCrypto, InvalidIVTooShort) {
    std::vector<uint8_t> too_short(16, 0xAB); // 16 bytes — pas assez
    auto result = save_decrypt(too_short, std::span<const uint8_t, 16>(TEST_KEY));
    EXPECT_FALSE(result.has_value());

    std::vector<uint8_t> empty;
    auto result2 = save_decrypt(empty, std::span<const uint8_t, 16>(TEST_KEY));
    EXPECT_FALSE(result2.has_value());
}
