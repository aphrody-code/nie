#include "iecode/formats/level5/g4tx.h"

#include "iecode/formats/level5/nxtch.h"
#include "iecode/types.h"
#include <spdlog/spdlog.h>
#include <algorithm>
#include <cstring>

namespace iecode::level5 {

// ── Constantes internes ─────────────────────────────────────────────

/// Magic G4TX en little-endian ("G4TX" lu comme u32 LE = 0x58543447).
static constexpr uint32_t G4TX_MAGIC_LE = 0x58543447;

/// Taille du header G4TX = 0x60.
static constexpr size_t G4TX_HEADER_SIZE = 0x60;

/// Taille d'une entree dans la table des textures.
static constexpr size_t G4TX_ENTRY_SIZE = 0x30;

/// Taille d'une sous-entree (sub-texture / atlas region).
static constexpr size_t G4TX_SUB_ENTRY_SIZE = 0x18;

/// Magic DDS " SDD" en little-endian.
static constexpr uint32_t DDS_MAGIC = 0x20534444;

/// Magic DDS alternatif " SD@" utilise par certains G4TX (sub-chunks internes).
static constexpr uint32_t DDS_MAGIC_ALT = 0x20534440;

/// Masque pour detecter toute variante de magic DDS Level-5 :
/// les 3 octets de poids fort sont " SD" ("DS " en bytes), le 4eme octet
/// (octet 0 dans le fichier) sert de flag/indicateur (0x44='D', 0x40='@', 0x02, 0x00...).
static constexpr uint32_t DDS_MAGIC_MASK    = 0xFFFFFF00;
static constexpr uint32_t DDS_MAGIC_PATTERN = 0x20534400;

/// FourCC "DX10" pour le header etendu DX10.
static constexpr uint32_t DDS_FOURCC_DX10 = 0x30315844;

// ── Constantes DXGI ─────────────────────────────────────────────────
static constexpr uint32_t DXGI_FORMAT_R8G8B8A8_UNORM = 28;
static constexpr uint32_t DXGI_FORMAT_BC1_UNORM       = 71;
static constexpr uint32_t DXGI_FORMAT_BC2_UNORM       = 74;
static constexpr uint32_t DXGI_FORMAT_BC3_UNORM       = 77;
static constexpr uint32_t DXGI_FORMAT_BC4_UNORM       = 80;
static constexpr uint32_t DXGI_FORMAT_BC5_UNORM       = 83;
static constexpr uint32_t DXGI_FORMAT_BC7_UNORM       = 98;

// ── FourCC DXT ──────────────────────────────────────────────────────
static constexpr uint32_t DDS_FOURCC_DXT1 = 0x31545844;
static constexpr uint32_t DDS_FOURCC_DXT3 = 0x33545844;
static constexpr uint32_t DDS_FOURCC_DXT5 = 0x35545844;
static constexpr uint32_t DDS_FOURCC_ATI1 = 0x31495441;
static constexpr uint32_t DDS_FOURCC_ATI2 = 0x32495441;

/// Convertit un FourCC DDS en G4txFormat.
static G4txFormat fourcc_to_format(uint32_t fourcc) {
    switch (fourcc) {
        case DDS_FOURCC_DXT1: return G4txFormat::BC1;
        case DDS_FOURCC_DXT3: return G4txFormat::BC2;
        case DDS_FOURCC_DXT5: return G4txFormat::BC3;
        case DDS_FOURCC_ATI1: return G4txFormat::BC4;
        case DDS_FOURCC_ATI2: return G4txFormat::BC5;
        default:              return G4txFormat::Unknown;
    }
}

/// Convertit un format DXGI en G4txFormat.
static G4txFormat dxgi_to_format(uint32_t dxgi) {
    switch (dxgi) {
        case DXGI_FORMAT_BC1_UNORM:       return G4txFormat::BC1;
        case DXGI_FORMAT_BC2_UNORM:       return G4txFormat::BC2;
        case DXGI_FORMAT_BC3_UNORM:       return G4txFormat::BC3;
        case DXGI_FORMAT_BC4_UNORM:       return G4txFormat::BC4;
        case DXGI_FORMAT_BC5_UNORM:       return G4txFormat::BC5;
        case DXGI_FORMAT_BC7_UNORM:       return G4txFormat::BC7;
        case DXGI_FORMAT_R8G8B8A8_UNORM:  return G4txFormat::RGBA8;
        default:                          return G4txFormat::Unknown;
    }
}

// ── Helpers de validation ───────────────────────────────────────────

/// Verifie que [offset, offset+len) est dans les bornes de data.
static bool bounds_check(std::span<const uint8_t> data, size_t offset, size_t len) {
    return offset + len <= data.size() && offset + len >= offset; // overflow check
}

/// Compte le nombre total de blocs BC pour une texture avec mip chain complete.
/// La chaine s'arrete quand la dimension la plus petite passerait sous 4 au
/// niveau suivant (un bloc BC fait au minimum 4x4 pixels).
static size_t total_bc_blocks_with_mips(uint32_t w, uint32_t h) {
    size_t total = 0;
    while (w >= 4 && h >= 4) {
        total += static_cast<size_t>(w / 4) * static_cast<size_t>(h / 4);
        if (w / 2 < 4 || h / 2 < 4) break;
        w /= 2;
        h /= 2;
    }
    return total;
}

/// Resultat de la detection de format BC par taille.
struct BcSizeMatch {
    bool match = false;
    size_t header_size = 128;
    size_t bytes_per_block = 16;
    bool has_mips = false;
};

/// Verifie si chunk_size correspond a un layout DDS BC pour width x height.
/// Teste : header de 128 ou 148 octets, BC8 ou BC16, single mip ou mip chain.
static BcSizeMatch detect_bc_size(size_t chunk_size, uint32_t w, uint32_t h) {
    BcSizeMatch r;
    if (w == 0 || h == 0) return r;
    const size_t blocks_lvl0 = static_cast<size_t>((w + 3) / 4) *
                                static_cast<size_t>((h + 3) / 4);
    const size_t blocks_mips = total_bc_blocks_with_mips(w, h);
    for (size_t hdr : {size_t{148}, size_t{128}}) {
        if (chunk_size < hdr) continue;
        const size_t pixel_bytes = chunk_size - hdr;
        for (size_t bpp : {size_t{16}, size_t{8}}) {
            if (pixel_bytes == blocks_lvl0 * bpp) {
                r.match = true;
                r.header_size = hdr;
                r.bytes_per_block = bpp;
                r.has_mips = false;
                return r;
            }
            if (blocks_mips > 0 && pixel_bytes == blocks_mips * bpp) {
                r.match = true;
                r.header_size = hdr;
                r.bytes_per_block = bpp;
                r.has_mips = true;
                return r;
            }
        }
    }
    return r;
}

// ── Implementation principale ───────────────────────────────────────

std::optional<G4txFile> g4tx_parse(std::span<const uint8_t> data) {
    // Verification taille minimale
    if (data.size() < G4TX_HEADER_SIZE) {
        spdlog::error("g4tx_parse: donnees trop courtes ({} octets, minimum {})",
                      data.size(), G4TX_HEADER_SIZE);
        return std::nullopt;
    }

    const auto* base = data.data();

    // Verification du magic (little-endian sur PC)
    const uint32_t magic = iecode::read_u32_le(base);
    if (magic != G4TX_MAGIC_LE) {
        spdlog::error("g4tx_parse: magic invalide ({:#010x}, attendu {:#010x})",
                      magic, G4TX_MAGIC_LE);
        return std::nullopt;
    }

    // Lecture du header
    const auto header_size  = static_cast<uint16_t>(iecode::read_u16_le(base + 0x04));
    const auto file_type    = static_cast<uint16_t>(iecode::read_u16_le(base + 0x06));
    const auto table_size   = iecode::read_i32_le(base + 0x0C);
    const auto texture_count     = iecode::read_i16_le(base + 0x20);
    const auto total_count       = iecode::read_i16_le(base + 0x22);
    const auto sub_texture_count = static_cast<uint8_t>(base[0x25]);
    spdlog::debug("g4tx_parse: header_size={:#x} file_type={:#x} table_size={} "
                  "textures={} sub_textures={} total={}",
                  header_size, file_type, table_size,
                  texture_count, sub_texture_count, total_count);

    if (texture_count <= 0) {
        spdlog::warn("g4tx_parse: aucune texture dans le fichier");
        return G4txFile{.version = file_type, .textures = {}};
    }

    // ── 1. Parser les entrees de textures (texture_count x 0x30) ────
    const size_t entries_offset = header_size;
    const size_t entries_end = entries_offset +
                               static_cast<size_t>(texture_count) * G4TX_ENTRY_SIZE;

    if (!bounds_check(data, entries_offset, static_cast<size_t>(texture_count) * G4TX_ENTRY_SIZE)) {
        spdlog::error("g4tx_parse: table d'entrees depasse la taille du fichier");
        return std::nullopt;
    }

    // Structure temporaire pour les entrees brutes
    struct RawEntry {
        int32_t unk1 = 0;
        int32_t nxtch_offset = 0;
        int32_t nxtch_size = 0;
        int32_t unk2 = 0;
        int32_t unk3 = 0;
        int32_t unk4 = 0;
        int16_t width = 0;
        int16_t height = 0;
        int32_t const2 = 0;
    };

    std::vector<RawEntry> raw_entries;
    raw_entries.reserve(static_cast<size_t>(texture_count));

    const auto entry_is_sane = [&data](const RawEntry& e) -> bool {
        if (e.nxtch_offset < 0 || e.nxtch_size <= 0) return false;
        if (e.width <= 0 || e.height <= 0) return false;
        if (e.width > 8192 || e.height > 8192) return false;
        const auto fs_sz = static_cast<int64_t>(data.size());
        if (static_cast<int64_t>(e.nxtch_offset) +
            static_cast<int64_t>(e.nxtch_size) > fs_sz) return false;
        return true;
    };

    for (int16_t i = 0; i < texture_count; ++i) {
        const auto off = entries_offset + static_cast<size_t>(i) * G4TX_ENTRY_SIZE;
        const auto* p = base + off;
        RawEntry e;
        e.unk1         = iecode::read_i32_le(p + 0x00);
        e.nxtch_offset = iecode::read_i32_le(p + 0x04);
        e.nxtch_size   = iecode::read_i32_le(p + 0x08);
        e.unk2         = iecode::read_i32_le(p + 0x0C);
        e.unk3         = iecode::read_i32_le(p + 0x10);
        e.unk4         = iecode::read_i32_le(p + 0x14);
        e.width        = iecode::read_i16_le(p + 0x18);
        e.height       = iecode::read_i16_le(p + 0x1A);
        e.const2       = iecode::read_i32_le(p + 0x1C);

        // Validation : si l'entree contient des valeurs impossibles, on
        // considere que la table est tronquee et on s'arrete. Les fichiers
        // corrompus ont parfois texture_count > nombre reel d'entrees, suivi
        // de donnees aleatoires (string pool, sub-textures...).
        if (!entry_is_sane(e)) {
            spdlog::debug("g4tx_parse: entree {} invalide, table tronquee a {}",
                          i, raw_entries.size());
            break;
        }

        raw_entries.push_back(e);
    }

    // ── 2. Parser les sous-entrees (sub_texture_count x 0x18) ───────
    const size_t sub_entries_offset = entries_end;
    std::vector<G4txSubTexture> all_sub_textures;

    if (sub_texture_count > 0) {
        if (!bounds_check(data, sub_entries_offset,
                          static_cast<size_t>(sub_texture_count) * G4TX_SUB_ENTRY_SIZE)) {
            spdlog::error("g4tx_parse: table de sous-entrees depasse la taille du fichier");
            return std::nullopt;
        }

        all_sub_textures.reserve(sub_texture_count);
        for (uint8_t i = 0; i < sub_texture_count; ++i) {
            const auto off = sub_entries_offset + static_cast<size_t>(i) * G4TX_SUB_ENTRY_SIZE;
            const auto* p = base + off;
            G4txSubTexture sub;
            sub.entry_id = iecode::read_i16_le(p + 0x00);
            sub.unk1     = iecode::read_i16_le(p + 0x02);
            sub.x        = iecode::read_i16_le(p + 0x04);
            sub.y        = iecode::read_i16_le(p + 0x06);
            sub.width    = iecode::read_i16_le(p + 0x08);
            sub.height   = iecode::read_i16_le(p + 0x0A);
            sub.unk2     = iecode::read_i32_le(p + 0x0C);
            sub.unk3     = iecode::read_i32_le(p + 0x10);
            sub.unk4     = iecode::read_i32_le(p + 0x14);
            all_sub_textures.push_back(sub);
        }
    }

    const size_t sub_entries_end = sub_entries_offset +
                                   static_cast<size_t>(sub_texture_count) * G4TX_SUB_ENTRY_SIZE;

    // ── 3. Table de hash (total_count * 4, alignee sur 0x10) ────────
    const size_t hash_table_offset = (sub_entries_end + 0x0F) & ~static_cast<size_t>(0x0F);
    const size_t hash_table_size = static_cast<size_t>(total_count) * 4;
    const size_t hash_table_end = hash_table_offset + hash_table_size;

    // ── 4. IDs (total_count octets) ─────────────────────────────────
    const size_t ids_offset = hash_table_end;
    const size_t ids_end = ids_offset + static_cast<size_t>(total_count);

    if (!bounds_check(data, ids_offset, static_cast<size_t>(total_count))) {
        spdlog::warn("g4tx_parse: table d'IDs hors limites, IDs ignores");
    }

    // Lire les IDs
    std::vector<uint8_t> ids(static_cast<size_t>(total_count), 0);
    if (bounds_check(data, ids_offset, static_cast<size_t>(total_count))) {
        std::memcpy(ids.data(), base + ids_offset, static_cast<size_t>(total_count));
    }

    // ── 5. Offsets de chaines (total_count * 2, aligne sur 4) ───────
    const size_t string_offsets_start = (ids_end + 3) & ~static_cast<size_t>(3);
    const size_t string_offsets_size = static_cast<size_t>(total_count) * 2;
    const size_t string_offsets_end = string_offsets_start + string_offsets_size;

    // ── 6. Pool de chaines ──────────────────────────────────────────
    const size_t string_pool_start = string_offsets_end;

    // Lire les noms des textures
    std::vector<std::string> names(static_cast<size_t>(total_count));
    if (bounds_check(data, string_offsets_start, string_offsets_size) &&
        string_pool_start < data.size()) {
        for (int16_t i = 0; i < total_count; ++i) {
            const auto str_rel = iecode::read_u16_le(
                base + string_offsets_start + static_cast<size_t>(i) * 2);
            const size_t str_abs = string_pool_start + str_rel;
            if (str_abs < data.size()) {
                // Lire une chaine null-terminee
                const auto* str_ptr = reinterpret_cast<const char*>(base + str_abs);
                const size_t max_len = data.size() - str_abs;
                const size_t len = strnlen(str_ptr, max_len);
                names[static_cast<size_t>(i)] = std::string(str_ptr, len);
            }
        }
    }

    // ── 7. Base NXTCH ───────────────────────────────────────────────
    const size_t nxtch_base = (static_cast<size_t>(header_size) +
                               static_cast<size_t>(table_size) + 0x0F) &
                              ~static_cast<size_t>(0x0F);

    spdlog::debug("g4tx_parse: nxtch_base={:#x}", nxtch_base);

    // ── 8. Construire les textures ──────────────────────────────────
    G4txFile result;
    result.version = file_type;
    result.textures.reserve(raw_entries.size());

    const auto valid_entries = static_cast<int16_t>(raw_entries.size());
    for (int16_t i = 0; i < valid_entries; ++i) {
        const auto& entry = raw_entries[static_cast<size_t>(i)];
        G4txTexture tex;

        // ID et nom
        if (static_cast<size_t>(i) < ids.size()) {
            tex.id = ids[static_cast<size_t>(i)];
        }
        if (static_cast<size_t>(i) < names.size()) {
            tex.name = names[static_cast<size_t>(i)];
        }
        if (tex.name.empty()) {
            tex.name = fmt::format("texture_{}", i);
        }

        // Dimensions depuis l'entree (valeurs par defaut)
        tex.width  = static_cast<uint16_t>(entry.width);
        tex.height = static_cast<uint16_t>(entry.height);

        // Localiser le chunk NXTCH/DDS
        const size_t chunk_offset = nxtch_base + static_cast<size_t>(entry.nxtch_offset);
        const size_t chunk_size = static_cast<size_t>(entry.nxtch_size);

        if (!bounds_check(data, chunk_offset, chunk_size) || chunk_size < 4) {
            spdlog::debug("g4tx_parse: chunk texture {} hors limites (offset={:#x}, size={})",
                          i, chunk_offset, chunk_size);
            continue;
        }

        const auto* chunk = base + chunk_offset;
        const uint32_t chunk_magic = iecode::read_u32_le(chunk);

        // Detection DDS standard ou variante Level-5.
        // Level-5 brouille parfois les premiers octets du magic mais conserve
        // "DX10" (FourCC) en +0x54 et la taille de donnees coherente avec un
        // BCx de width*height. Trois signaux peuvent identifier un chunk DDS :
        //   1. Magic mask (octet 0 modifie, "DS " preserve)
        //   2. "DX10" en +0x54 (FourCC DXT10 preserve)
        //   3. chunk_size = header + BC blocks (single mip ou mip chain complete)
        const bool magic_match = (chunk_magic & DDS_MAGIC_MASK) == DDS_MAGIC_PATTERN;
        const uint32_t fourcc_at_54 = (chunk_size >= 0x58)
            ? iecode::read_u32_le(chunk + 0x54) : 0;
        const bool dx10_marker = (fourcc_at_54 == DDS_FOURCC_DX10);

        const BcSizeMatch bc_match = detect_bc_size(
            chunk_size,
            static_cast<uint32_t>(entry.width),
            static_cast<uint32_t>(entry.height));

        const bool is_dds_chunk = magic_match || dx10_marker || bc_match.match;

        if (is_dds_chunk) {
            // ── Chunk DDS (standard ou variante L5) ─────────────────
            tex.is_dds = true;

            // Variante L5 : header partiellement corrompu (magic non-standard).
            // Les champs DDS apres le magic ne sont pas fiables, mais "DX10"
            // (offset 0x54) et la taille des donnees restent exploitables.
            const bool is_l5_variant = (chunk_magic != DDS_MAGIC) &&
                                       (chunk_magic != DDS_MAGIC_ALT);

            if (chunk_size < 128) {
                spdlog::error("g4tx_parse: header DDS trop court pour texture {}", i);
                continue;
            }

            // Lire les dimensions depuis le header DDS et valider.
            // Si invalides ou si variante L5 -> conserver les valeurs de l'entree.
            const uint16_t dds_h = static_cast<uint16_t>(iecode::read_u32_le(chunk + 0x0C));
            const uint16_t dds_w = static_cast<uint16_t>(iecode::read_u32_le(chunk + 0x10));
            if (!is_l5_variant && dds_w > 0 && dds_w <= 8192 && dds_h > 0 && dds_h <= 8192) {
                tex.height = dds_h;
                tex.width  = dds_w;
            }
            // (sinon : tex.width/tex.height conservent les valeurs de l'entree)

            if (!is_l5_variant) {
                const uint32_t mip_count_dds = iecode::read_u32_le(chunk + 0x1C);
                tex.mip_count = static_cast<uint8_t>(std::max(mip_count_dds, 1u));
            } else {
                tex.mip_count = 1;
            }

            // Pixel format : verifier FourCC (champs +0x50/+0x54 souvent fiables
            // meme dans les variantes L5 — au moins pour detecter "DX10").
            const uint32_t pf_flags = iecode::read_u32_le(chunk + 0x50);
            const uint32_t fourcc   = iecode::read_u32_le(chunk + 0x54);

            size_t data_offset = 128;

            const bool has_dx10 = (fourcc == DDS_FOURCC_DX10);
            const bool fourcc_valid = ((pf_flags & 0x4) != 0) || is_l5_variant;

            if (fourcc_valid) {
                if (has_dx10) {
                    if (chunk_size < 148) {
                        spdlog::error("g4tx_parse: header DX10 trop court pour texture {}", i);
                        continue;
                    }
                    if (!is_l5_variant) {
                        const uint32_t dxgi_format = iecode::read_u32_le(chunk + 0x80);
                        tex.format = dxgi_to_format(dxgi_format);
                        spdlog::debug("g4tx_parse: texture {} DDS+DX10, dxgi_format={}",
                                      i, dxgi_format);
                    }
                    // Pour les variantes L5 : DXGI au +0x80 souvent corrompu;
                    // laisser tex.format=Unknown pour declencher l'heuristique.
                    data_offset = 148;
                } else if (!is_l5_variant) {
                    tex.format = fourcc_to_format(fourcc);
                    spdlog::debug("g4tx_parse: texture {} DDS FourCC={:#010x}", i, fourcc);
                }

                // Fallback : inferer le format par la taille des donnees.
                // Niveau-5 reutilise/corrompt parfois les champs DXGI/FourCC.
                // Teste single-mip et mip chain complete via detect_bc_size.
                if (tex.format == G4txFormat::Unknown && tex.width > 0 && tex.height > 0) {
                    const auto m = detect_bc_size(chunk_size, tex.width, tex.height);
                    if (m.match) {
                        tex.format = (m.bytes_per_block == 16)
                                     ? G4txFormat::BC3
                                     : G4txFormat::BC1;
                        data_offset = m.header_size;
                        if (m.has_mips) {
                            // Note : mipCount reel inconnu, marqueur > 1.
                            tex.mip_count = std::max<uint8_t>(tex.mip_count, 2);
                        }
                    }
                }
            } else {
                // Format non-compresse — verifier les masques RGBA
                const uint32_t rgb_bit_count = iecode::read_u32_le(chunk + 0x58);
                if (rgb_bit_count == 32) {
                    tex.format = G4txFormat::RGBA8;
                } else {
                    tex.format = G4txFormat::Unknown;
                }
            }

            // Extraire les donnees texture (apres le header DDS)
            if (data_offset < chunk_size) {
                const size_t tex_data_size = chunk_size - data_offset;
                tex.data.assign(chunk + data_offset, chunk + data_offset + tex_data_size);
            }

        } else if (nxtch_is_valid(chunk, chunk_size)) {
            // ── Chunk NXTCH ─────────────────────────────────────────
            tex.is_dds = false;

            if (chunk_size < NXTCH_HEADER_SIZE) {
                spdlog::error("g4tx_parse: header NXTCH trop court pour texture {}", i);
                continue;
            }

            // Lire le header NXTCH (little-endian sur PC)
            tex.width     = static_cast<uint16_t>(iecode::read_i32_le(chunk + 0x14));
            tex.height    = static_cast<uint16_t>(iecode::read_i32_le(chunk + 0x18));
            const auto fmt_val = static_cast<uint32_t>(iecode::read_i32_le(chunk + 0x24));
            tex.format    = static_cast<G4txFormat>(fmt_val);
            tex.mip_count = static_cast<uint8_t>(
                std::max(iecode::read_i32_le(chunk + 0x28), 1));

            spdlog::debug("g4tx_parse: texture {} NXTCH {}x{} format={:#x} mips={}",
                          i, tex.width, tex.height, fmt_val, tex.mip_count);

            // Donnees texture apres le header NXTCH
            if (NXTCH_HEADER_SIZE < chunk_size) {
                const size_t tex_data_size = chunk_size - NXTCH_HEADER_SIZE;
                tex.data.assign(chunk + NXTCH_HEADER_SIZE,
                                chunk + NXTCH_HEADER_SIZE + tex_data_size);
            }

        } else {
            spdlog::warn("g4tx_parse: texture {} — chunk ni DDS ni NXTCH (magic={:#010x})",
                         i, chunk_magic);
            // Copier les donnees brutes quand meme
            tex.data.assign(chunk, chunk + chunk_size);
        }

        // ── Associer les sous-textures ──────────────────────────────
        for (const auto& sub : all_sub_textures) {
            if (sub.entry_id == i) {
                tex.sub_textures.push_back(sub);
            }
        }

        result.textures.push_back(std::move(tex));
    }

    spdlog::info("g4tx_parse: {} texture(s) parsee(s) avec succes", result.textures.size());
    return result;
}

} // namespace iecode::level5
