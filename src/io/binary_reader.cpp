#include "iecode/io/binary_reader.h"

#include "iecode/types.h"
#include <algorithm>
#include <bit>
#include <cstring>

namespace iecode::io {

BinaryReader::BinaryReader(std::span<const uint8_t> data) noexcept
    : data_(data) {}

// ── Lecture little-endian ───────────────────────────────────────

uint8_t BinaryReader::read_u8() noexcept {
    if (position_ >= data_.size()) return 0;
    return data_[position_++];
}

uint16_t BinaryReader::read_u16_le() noexcept {
    if (position_ + 2 > data_.size()) return 0;
    auto val = iecode::read_u16_le(data_.data() + position_);
    position_ += 2;
    return val;
}

uint32_t BinaryReader::read_u32_le() noexcept {
    if (position_ + 4 > data_.size()) return 0;
    auto val = iecode::read_u32_le(data_.data() + position_);
    position_ += 4;
    return val;
}

uint64_t BinaryReader::read_u64_le() noexcept {
    if (position_ + 8 > data_.size()) return 0;
    auto val = iecode::read_u64_le(data_.data() + position_);
    position_ += 8;
    return val;
}

int16_t BinaryReader::read_i16_le() noexcept {
    return static_cast<int16_t>(read_u16_le());
}

int32_t BinaryReader::read_i32_le() noexcept {
    return static_cast<int32_t>(read_u32_le());
}

float BinaryReader::read_f32_le() noexcept {
    const auto bits = read_u32_le();
    return std::bit_cast<float>(bits);
}

// ── Lecture big-endian ──────────────────────────────────────────

uint16_t BinaryReader::read_u16_be() noexcept {
    if (position_ + 2 > data_.size()) return 0;
    auto val = iecode::read_u16_be(data_.data() + position_);
    position_ += 2;
    return val;
}

uint32_t BinaryReader::read_u32_be() noexcept {
    if (position_ + 4 > data_.size()) return 0;
    auto val = iecode::read_u32_be(data_.data() + position_);
    position_ += 4;
    return val;
}

uint64_t BinaryReader::read_u64_be() noexcept {
    if (position_ + 8 > data_.size()) return 0;
    auto val = iecode::read_u64_be(data_.data() + position_);
    position_ += 8;
    return val;
}

int16_t BinaryReader::read_i16_be() noexcept {
    return static_cast<int16_t>(read_u16_be());
}

int32_t BinaryReader::read_i32_be() noexcept {
    return static_cast<int32_t>(read_u32_be());
}

float BinaryReader::read_f32_be() noexcept {
    const auto bits = read_u32_be();
    return std::bit_cast<float>(bits);
}

// ── Lecture de donnees brutes ───────────────────────────────────

std::span<const uint8_t> BinaryReader::read_bytes(size_t count) noexcept {
    if (position_ + count > data_.size()) {
        count = data_.size() - position_;
    }
    auto result = data_.subspan(position_, count);
    position_ += count;
    return result;
}

std::string BinaryReader::read_string(size_t length) {
    auto bytes = read_bytes(length);
    return std::string(reinterpret_cast<const char*>(bytes.data()), bytes.size());
}

std::string BinaryReader::read_null_terminated_string() {
    std::string result;
    while (position_ < data_.size()) {
        const auto c = data_[position_++];
        if (c == 0) break;
        result.push_back(static_cast<char>(c));
    }
    return result;
}

// ── Navigation ─────────────────────────────────────────────────

void BinaryReader::seek(size_t position) noexcept {
    position_ = std::min(position, data_.size());
}

void BinaryReader::skip(size_t count) noexcept {
    position_ = std::min(position_ + count, data_.size());
}

void BinaryReader::align(size_t alignment) noexcept {
    if (alignment == 0) return;
    const auto remainder = position_ % alignment;
    if (remainder != 0) {
        skip(alignment - remainder);
    }
}

// ── Etat ───────────────────────────────────────────────────────

size_t BinaryReader::remaining() const noexcept {
    return (position_ < data_.size()) ? data_.size() - position_ : 0;
}

bool BinaryReader::eof() const noexcept {
    return position_ >= data_.size();
}

std::span<const uint8_t> BinaryReader::remaining_span() const noexcept {
    if (position_ >= data_.size()) return {};
    return data_.subspan(position_);
}

} // namespace iecode::io
