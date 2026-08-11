#pragma once

/// @file shaders_3d.h
/// Hashes des shaders 3D du pipeline nie.exe (groupe `0xefb0323b`).
/// Decouverts via analyse de `CShaderLibrary` dans research/ghidra/nie.c.
///
/// Le skinning dans nie.exe est realise par un **compute shader**
/// (`0xa935f748`, type 0x19), pas dans le vertex shader — la bone palette
/// est fournie dans le render object a l'offset +0x1D98 (0x200 bytes =
/// 32 matrices mat3x4).

#include <cstdint>

namespace iecode::render::shaders3d {

/// Groupe de shaders 3D principal (type nie.exe interne).
inline constexpr uint32_t GROUP_3D = 0xefb0323bU;

/// VS/PS mesh base — types nie 0x11 (VS) / 0x12 (PS).
inline constexpr uint32_t H_BASE_MESH = 0xf2ee3972U;

/// VS/PS variante #2 — types 0x15 / 0x16.
inline constexpr uint32_t H_MESH_2 = 0x3c0e42feU;

/// VS/PS variante #3.
inline constexpr uint32_t H_MESH_3 = 0x33a9983bU;

/// VS/PS variante #4.
inline constexpr uint32_t H_MESH_4 = 0x1ea38e0aU;

/// VS/PS shadow / post-process.
inline constexpr uint32_t H_SHADOW_POST = 0x76a8fed1U;

/// Compute shader de skinning squelettique — type nie 0x19.
/// Lit la bone palette (32 mat3x4) et ecrit les positions skinnees
/// dans un dynamic vertex buffer.
inline constexpr uint32_t H_CS_SKINNING = 0xa935f748U;

/// Offset de la bone palette dans le render object nie.exe.
/// 0x200 bytes = 32 matrices mat3x4 (48 bytes chacune).
inline constexpr uint32_t BONE_PALETTE_OFFSET = 0x1D98U;

/// Taille de la bone palette en bytes.
inline constexpr uint32_t BONE_PALETTE_SIZE = 0x200U;

/// Nombre maximum d'os cote nie.exe (bone palette fixe).
inline constexpr uint32_t MAX_BONES_NIE = 32U;

} // namespace iecode::render::shaders3d
