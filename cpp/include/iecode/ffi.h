#pragma once

/// @file ffi.h
/// API FFI C pour l'integration avec bun:ffi (inagle) et autres runtimes.
///
/// Toutes les fonctions exportent via IECODE_EXPORT et utilisent extern "C"
/// pour compatibilite C ABI. Les buffers sont alloues par iecode et liberes
/// par l'appelant via iecode_free().
///
/// Usage depuis Bun (inagle) :
/// ```typescript
/// import { dlopen, FFIType, ptr, toArrayBuffer, CString } from "bun:ffi";
///
/// const lib = dlopen("libiecode.so", {
///   iecode_version:      { args: [], returns: FFIType.cstring },
///   iecode_cfgbin_parse: { args: [FFIType.ptr, FFIType.u32], returns: FFIType.ptr },
///   iecode_result_json:  { args: [FFIType.ptr], returns: FFIType.cstring },
///   iecode_result_free:  { args: [FFIType.ptr], returns: FFIType.void },
///   iecode_g4tx_parse:   { args: [FFIType.ptr, FFIType.u32], returns: FFIType.ptr },
///   iecode_g4tx_count:   { args: [FFIType.ptr], returns: FFIType.i32 },
///   iecode_g4tx_export_png: { args: [FFIType.ptr, FFIType.i32, FFIType.cstring], returns: FFIType.bool },
///   iecode_lz10_decompress: { args: [FFIType.ptr, FFIType.u32, FFIType.ptr], returns: FFIType.u32 },
///   iecode_free:         { args: [FFIType.ptr], returns: FFIType.void },
/// });
/// ```

#include "iecode/export.h"
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

// ── Lifecycle ───────────────────────────────────────────────────────

/// Retourne la version d'iecode (string statique, ne pas liberer).
IECODE_EXPORT const char* iecode_version(void);

/// Libere un buffer alloue par iecode.
IECODE_EXPORT void iecode_free(void* ptr);

// ── Opaque handles ──────────────────────────────────────────────────

/// Handle opaque pour un resultat de parsing.
typedef struct iecode_result iecode_result_t;

/// Handle opaque pour un fichier G4TX parse.
typedef struct iecode_g4tx iecode_g4tx_t;

/// Handle opaque pour un CPK ouvert.
typedef struct iecode_cpk iecode_cpk_t;

// ── cfg.bin ─────────────────────────────────────────────────────────

/// Parse un buffer cfg.bin (T2B ou RDBN, detection auto).
/// @param data buffer brut (peut etre chiffre XorShift)
/// @param size taille en octets
/// @return handle vers le resultat, ou NULL en cas d'erreur. Liberer avec iecode_result_free().
IECODE_EXPORT iecode_result_t* iecode_cfgbin_parse(const uint8_t* data, uint32_t size);

/// Retourne le JSON du resultat (string statique liee au handle, ne pas liberer).
IECODE_EXPORT const char* iecode_result_json(const iecode_result_t* result);

/// Retourne le format detecte : "t2b", "rdbn", ou "unknown".
IECODE_EXPORT const char* iecode_result_format(const iecode_result_t* result);

/// Libere un handle de resultat.
IECODE_EXPORT void iecode_result_free(iecode_result_t* result);

// ── G4TX (textures) ─────────────────────────────────────────────────

/// Parse un fichier G4TX.
/// @return handle, ou NULL. Liberer avec iecode_g4tx_free().
IECODE_EXPORT iecode_g4tx_t* iecode_g4tx_parse(const uint8_t* data, uint32_t size);

/// Nombre de textures dans le G4TX.
IECODE_EXPORT int32_t iecode_g4tx_count(const iecode_g4tx_t* g4tx);

/// Exporte la texture d'index `idx` en PNG.
/// @return true si succes.
IECODE_EXPORT int iecode_g4tx_export_png(const iecode_g4tx_t* g4tx, int32_t idx,
                                           const char* output_path);

/// Exporte la texture d'index `idx` en WebP.
IECODE_EXPORT int iecode_g4tx_export_webp(const iecode_g4tx_t* g4tx, int32_t idx,
                                            const char* output_path, int quality);

/// Decode la texture d'index `idx` en RGBA8.
/// @param out_size recoit la taille du buffer retourne
/// @return buffer RGBA8 (width*height*4 octets). Liberer avec iecode_free().
IECODE_EXPORT uint8_t* iecode_g4tx_decode_rgba(const iecode_g4tx_t* g4tx, int32_t idx,
                                                 int32_t* out_width, int32_t* out_height);

/// Info sur une texture (JSON statique lie au handle).
IECODE_EXPORT const char* iecode_g4tx_info(const iecode_g4tx_t* g4tx, int32_t idx);

/// Donnees de surface brutes pour upload GPU direct (D3D11/WebGPU).
typedef struct {
    const uint8_t* data;       ///< Donnees BCn compressees (PAS decodees). Ne pas liberer — possede par le handle g4tx.
    uint32_t       data_size;  ///< Taille en octets des donnees BCn.
    int32_t        width;      ///< Largeur de la texture en pixels.
    int32_t        height;     ///< Hauteur de la texture en pixels.
    int32_t        format;     ///< Format BCn (1=BC1, 3=BC3, 7=BC7, 0x1F=RGBA8). Correspond aux valeurs G4txFormat.
    int32_t        mip_count;  ///< Nombre de niveaux de mip.
    uint32_t       block_size; ///< Octets par bloc 4x4 (8 pour BC1/BC4, 16 pour BC3/BC5/BC7, 4 pour RGBA8).
} iecode_surface_t;

/// Recupere les donnees de surface brutes (BCn) pour la texture d'index `idx`.
/// Retourne les donnees compressees directement — pas de decompression CPU.
/// Le pointeur retourne est valide tant que le handle g4tx est vivant.
/// @return 0 en cas de succes, -1 en cas d'erreur.
IECODE_EXPORT int iecode_g4tx_get_surface(const iecode_g4tx_t* g4tx, int32_t idx,
                                           iecode_surface_t* out_surface);

/// Convertit un format BCn iecode vers une valeur DXGI_FORMAT pour D3D11/WebGPU.
/// @return 0 (DXGI_FORMAT_UNKNOWN) pour les formats inconnus.
IECODE_EXPORT uint32_t iecode_bcn_to_dxgi(int32_t bcn_format);

/// Libere un handle G4TX.
IECODE_EXPORT void iecode_g4tx_free(iecode_g4tx_t* g4tx);

// ── Compression ─────────────────────────────────────────────────────

/// Decompresse LZ10. Retourne la taille decompresee, 0 si erreur.
/// @param out_buf recoit un pointeur vers le buffer alloue. Liberer avec iecode_free().
IECODE_EXPORT uint32_t iecode_lz10_decompress(const uint8_t* data, uint32_t size,
                                                uint8_t** out_buf);

/// Decompresse CRILAYLA. Retourne la taille, 0 si erreur.
IECODE_EXPORT uint32_t iecode_crilayla_decompress(const uint8_t* data, uint32_t size,
                                                    uint8_t** out_buf);

/// Decompresse LZ4 block. Retourne la taille, 0 si erreur.
IECODE_EXPORT uint32_t iecode_lz4_decompress(const uint8_t* data, uint32_t size,
                                               uint32_t decompressed_size,
                                               uint8_t** out_buf);

// ── Crypto ──────────────────────────────────────────────────────────

/// CRC32 d'un buffer.
IECODE_EXPORT uint32_t iecode_crc32(const uint8_t* data, uint32_t size);

/// Dechiffre/chiffre un buffer CRI in-place (XOR symetrique).
IECODE_EXPORT void iecode_cri_decrypt(uint8_t* data, uint32_t size, uint32_t key);

/// Derive la cle CRI depuis un nom de fichier.
IECODE_EXPORT uint32_t iecode_cri_derive_key(const char* filename);

// ── CPK ─────────────────────────────────────────────────────────────

/// Ouvre un fichier CPK depuis un buffer memoire.
/// @return handle, ou NULL. Liberer avec iecode_cpk_free().
IECODE_EXPORT iecode_cpk_t* iecode_cpk_open(const uint8_t* data, uint32_t size);

/// Nombre de fichiers dans le CPK.
IECODE_EXPORT int32_t iecode_cpk_count(const iecode_cpk_t* cpk);

/// Nom du fichier d'index `idx` (string statique liee au handle).
IECODE_EXPORT const char* iecode_cpk_filename(const iecode_cpk_t* cpk, int32_t idx);

/// Extrait un fichier du CPK par index.
/// @param out_size recoit la taille du buffer retourne
/// @return buffer extrait. Liberer avec iecode_free().
IECODE_EXPORT uint8_t* iecode_cpk_extract(const iecode_cpk_t* cpk, int32_t idx,
                                            uint32_t* out_size);

/// Libere un handle CPK.
IECODE_EXPORT void iecode_cpk_free(iecode_cpk_t* cpk);

/// Ouvre un CPK depuis un fichier (memory-mapped, zero-copy).
/// @return handle, ou NULL. Liberer avec iecode_cpk_free().
IECODE_EXPORT iecode_cpk_t* iecode_cpk_open_file(const char* path);

/// Lit un fichier specifique par chemin interne (ex: "common/chara/chr001.g4tx").
/// @param out_size recoit la taille du buffer retourne.
/// @return buffer dechiffre/decompresse. Liberer avec iecode_free(). NULL si non trouve.
IECODE_EXPORT uint8_t* iecode_cpk_read_file(iecode_cpk_t* cpk, const char* internal_path,
                                              uint32_t* out_size);

/// Cherche une entree par chemin interne. Retourne l'index (>= 0) ou -1 si non trouve.
IECODE_EXPORT int32_t iecode_cpk_find_entry(iecode_cpk_t* cpk, const char* internal_path);

/// Taille compressée (sur disque) d'une entree par index.
IECODE_EXPORT uint32_t iecode_cpk_entry_size(iecode_cpk_t* cpk, int32_t index);

/// Taille decompressée d'une entree par index.
IECODE_EXPORT uint32_t iecode_cpk_entry_extract_size(iecode_cpk_t* cpk, int32_t index);

/// Retourne 1 si l'entree est compressee, 0 sinon, -1 si index invalide.
IECODE_EXPORT int32_t iecode_cpk_entry_is_compressed(iecode_cpk_t* cpk, int32_t index);

/// Repertoire d'une entree (string liee au handle, ne pas liberer).
IECODE_EXPORT const char* iecode_cpk_entry_directory(iecode_cpk_t* cpk, int32_t index);

/// Patche un fichier dans un CPK existant (in-place).
/// Le nouveau fichier doit tenir dans l'espace de l'ancien (new_size <= original).
/// @return 0 si succes, -1 si erreur.
IECODE_EXPORT int32_t iecode_cpk_patch(const char* cpk_path, const char* internal_path,
                                        const uint8_t* new_data, uint32_t new_size);

/// Reconstruit un CPK complet a partir d'un JSON d'entrees.
/// entries_json = JSON array : [{"filename":"...", "directory":"...", "file_path":"...", "compress":false}, ...]
/// Chaque entree doit avoir un "file_path" pointant vers le fichier source sur disque.
/// @return 0 si succes, -1 si erreur.
IECODE_EXPORT int32_t iecode_cpk_rebuild(const char* output_path, const char* entries_json);

/// Reconstruit un CPK en remplacant certains fichiers.
/// Ouvre le CPK source, remplace les fichiers specifies, ecrit dans output_path.
/// mods_json = JSON array : [{"internal_path":"...", "file_path":"...", "compress":false}, ...]
/// @return 0 si succes, -1 si erreur.
IECODE_EXPORT int32_t iecode_cpk_rebuild_with_mods(const char* source_cpk_path,
                                                     const char* output_path,
                                                     const char* mods_json);

// ── Game Database ───────────────────────────────────────────────────

/// Handle opaque pour une GameDatabase chargee.
typedef struct iecode_gamedb iecode_gamedb_t;

/// Charge une base de donnees complete du jeu.
/// @param data_root chemin vers la racine des donnees (contient common/gamedata/, common/text/)
/// @param load_text si != 0, charge les textes localises (9 locales, plus lent)
/// @return handle, ou NULL. Liberer avec iecode_gamedb_free().
IECODE_EXPORT iecode_gamedb_t* iecode_gamedb_load(const char* data_root, int load_text);

/// Nombre de personnages.
IECODE_EXPORT int32_t iecode_gamedb_chara_count(const iecode_gamedb_t* db);

/// Nombre de skills.
IECODE_EXPORT int32_t iecode_gamedb_skill_count(const iecode_gamedb_t* db);

/// Nombre d'equipes.
IECODE_EXPORT int32_t iecode_gamedb_team_count(const iecode_gamedb_t* db);

/// JSON complet de la base (cache, ne pas liberer).
IECODE_EXPORT const char* iecode_gamedb_json(const iecode_gamedb_t* db);

/// JSON d'un personnage par index.
IECODE_EXPORT const char* iecode_gamedb_chara_json(const iecode_gamedb_t* db, int32_t idx);

/// JSON d'un skill par index.
IECODE_EXPORT const char* iecode_gamedb_skill_json(const iecode_gamedb_t* db, int32_t idx);

/// Cherche un personnage par charaParamId ("0xABCD1234").
/// Retourne l'index, ou -1 si non trouve.
IECODE_EXPORT int32_t iecode_gamedb_find_chara(const iecode_gamedb_t* db, const char* chara_param_id);

/// Cherche un skill par skillId.
IECODE_EXPORT int32_t iecode_gamedb_find_skill(const iecode_gamedb_t* db, const char* skill_id);

/// Nombre d'items.
IECODE_EXPORT int32_t iecode_gamedb_item_count(const iecode_gamedb_t* db);

/// JSON d'un item par index.
IECODE_EXPORT const char* iecode_gamedb_item_json(const iecode_gamedb_t* db, int32_t idx);

/// Cherche un item par itemId ("0xABCD1234").
IECODE_EXPORT int32_t iecode_gamedb_find_item(const iecode_gamedb_t* db, const char* item_id);

/// Nombre de skills passifs.
IECODE_EXPORT int32_t iecode_gamedb_passive_count(const iecode_gamedb_t* db);

/// JSON d'un skill passif par index.
IECODE_EXPORT const char* iecode_gamedb_passive_json(const iecode_gamedb_t* db, int32_t idx);

/// Cherche un passif par passiveId.
IECODE_EXPORT int32_t iecode_gamedb_find_passive(const iecode_gamedb_t* db, const char* passive_id);

/// Nombre de quetes.
IECODE_EXPORT int32_t iecode_gamedb_quest_count(const iecode_gamedb_t* db);

/// JSON d'une quete par index.
IECODE_EXPORT const char* iecode_gamedb_quest_json(const iecode_gamedb_t* db, int32_t idx);

/// Nombre de tactiques speciales.
IECODE_EXPORT int32_t iecode_gamedb_tactic_count(const iecode_gamedb_t* db);

/// JSON d'une tactique speciale par index.
IECODE_EXPORT const char* iecode_gamedb_tactic_json(const iecode_gamedb_t* db, int32_t idx);

/// Cherche une tactique par tacticsId.
IECODE_EXPORT int32_t iecode_gamedb_find_tactic(const iecode_gamedb_t* db, const char* tactic_id);

/// Nombre de formations.
IECODE_EXPORT int32_t iecode_gamedb_formation_count(const iecode_gamedb_t* db);

/// JSON d'une formation par index.
IECODE_EXPORT const char* iecode_gamedb_formation_json(const iecode_gamedb_t* db, int32_t idx);

/// Nombre d'equipes adverses.
IECODE_EXPORT int32_t iecode_gamedb_opponent_count(const iecode_gamedb_t* db);

/// JSON d'une equipe adverse par index.
IECODE_EXPORT const char* iecode_gamedb_opponent_json(const iecode_gamedb_t* db, int32_t idx);

/// Nombre de shops.
IECODE_EXPORT int32_t iecode_gamedb_shop_count(const iecode_gamedb_t* db);

/// JSON d'un shop par index.
IECODE_EXPORT const char* iecode_gamedb_shop_json(const iecode_gamedb_t* db, int32_t idx);

/// JSON complet des tables de croissance (cache).
IECODE_EXPORT const char* iecode_gamedb_growth_json(const iecode_gamedb_t* db);

/// Nombre de personnages enrichis.
IECODE_EXPORT int32_t iecode_gamedb_enriched_count(const iecode_gamedb_t* db);

/// JSON d'un personnage enrichi par index (avec noms, stats, skills resolus).
IECODE_EXPORT const char* iecode_gamedb_enriched_json(const iecode_gamedb_t* db, int32_t idx);

/// Cherche un personnage enrichi par charaParamId.
IECODE_EXPORT int32_t iecode_gamedb_find_enriched(const iecode_gamedb_t* db, const char* chara_param_id);

/// Libere la base de donnees.
IECODE_EXPORT void iecode_gamedb_free(iecode_gamedb_t* db);

// ── Batch conversion ────────────────────────────────────────────────

/// Convertit tous les G4TX d'un dossier en PNG/WebP/DDS.
/// @param input_dir dossier source
/// @param output_dir dossier destination
/// @param format "png", "webp", ou "dds"
/// @param threads nombre de threads (0 = auto)
/// @param recursive 1 = recherche recursive
/// @param flat 1 = sortie a plat (pas de sous-dossiers)
/// @return nombre de fichiers convertis
IECODE_EXPORT int32_t iecode_batch_convert(const char* input_dir,
                                            const char* output_dir,
                                            const char* format,
                                            int32_t threads,
                                            int recursive,
                                            int flat);

// ── AWB (AFS2) ─────────────────────────────────────────────────────

/// Handle opaque pour un fichier AWB parse.
typedef struct iecode_awb iecode_awb_t;

/// Parse un fichier AWB depuis un buffer memoire.
/// @return handle, ou NULL. Liberer avec iecode_awb_free().
IECODE_EXPORT iecode_awb_t* iecode_awb_open(const uint8_t* data, uint32_t size);

/// Nombre d'entrees dans le AWB.
IECODE_EXPORT int32_t iecode_awb_count(const iecode_awb_t* awb);

/// Info JSON d'une entree (cue_id, offset, size). String statique liee au handle.
IECODE_EXPORT const char* iecode_awb_entry_info(const iecode_awb_t* awb, int32_t idx);

/// Extrait toutes les pistes vers un repertoire.
/// @return nombre de fichiers extraits.
IECODE_EXPORT int32_t iecode_awb_extract_all(const iecode_awb_t* awb, const char* output_dir);

/// Libere un handle AWB.
IECODE_EXPORT void iecode_awb_free(iecode_awb_t* awb);

// ── ACB ─────────────────────────────────────────────────────────────

/// Info JSON d'un fichier ACB (name, cue_count, has_embedded_awb, cue_names).
/// Le buffer retourne est alloue par iecode. Liberer avec iecode_free().
IECODE_EXPORT const char* iecode_acb_info(const uint8_t* data, uint32_t size);

/// Extrait le AWB embarque d'un ACB.
/// @param out_size recoit la taille du buffer retourne.
/// @return buffer AWB. Liberer avec iecode_free().
IECODE_EXPORT uint8_t* iecode_acb_extract_awb(const uint8_t* data, uint32_t size,
                                                uint32_t* out_size);

// ── USM (video CRI Sofdec2) ────────────────────────────────────────

/// Retourne les metadonnees d'un fichier USM (JSON).
/// Le buffer retourne est alloue par iecode. Liberer avec iecode_free().
IECODE_EXPORT const char* iecode_usm_info(const uint8_t* data, uint32_t size);

/// Demuxe un fichier USM vers un repertoire.
/// @return nombre d'octets ecrits, 0 si erreur.
IECODE_EXPORT uint64_t iecode_usm_demux(const uint8_t* data, uint32_t size,
                                          const char* output_dir);

// ── G4MD (model metadata) ──────────────────────────────────────────

/// Parse un buffer G4MD et retourne les metadonnees en JSON.
/// Le buffer retourne est alloue par iecode. Liberer avec iecode_free().
IECODE_EXPORT const char* iecode_g4md_parse(const uint8_t* data, uint32_t size);

// ── G4CM (character model container) ───────────────────────────────

/// Liste les sous-fichiers d'un conteneur G4CM.
/// Retourne un JSON array [{type, name, offset, size}, ...].
/// Le buffer retourne est alloue par iecode. Liberer avec iecode_free().
IECODE_EXPORT const char* iecode_g4cm_list(const uint8_t* data, uint32_t size);

/// Extrait tous les sous-fichiers d'un G4CM vers un repertoire.
/// @return nombre de fichiers extraits.
IECODE_EXPORT int32_t iecode_g4cm_extract(const uint8_t* data, uint32_t size,
                                           const char* output_dir);

// ── Level-5 Compression (dispatcher unifie) ────────────────────────

/// Decompresse des donnees Level-5 avec dispatch automatique par methode.
/// Retourne la taille decompresee, 0 si erreur.
/// @param out_buf recoit un pointeur vers le buffer alloue. Liberer avec iecode_free().
IECODE_EXPORT uint32_t iecode_level5_decompress(const uint8_t* data, uint32_t size,
                                                 uint8_t** out_buf);

/// Detecte la methode de compression Level-5 depuis le premier octet.
/// @return methode : 0=NONE, 1=LZ10, 2=HUFFMAN4, 3=HUFFMAN8, 4=RLE, 5=ZLIB
IECODE_EXPORT uint8_t iecode_level5_detect_method(const uint8_t* data, uint32_t size);

/// Lit la taille decompressée depuis le header Level-5.
IECODE_EXPORT uint32_t iecode_level5_decompressed_size(const uint8_t* data, uint32_t size);

// ── InazumaLZSS ────────────────────────────────────────────────────

/// Detecte si les donnees utilisent la compression InazumaLZSS (magic "SSZL").
/// @return 1 si oui, 0 sinon.
IECODE_EXPORT int iecode_is_inazuma_lzss(const uint8_t* data, uint32_t size);

/// Decompresse des donnees InazumaLZSS. Retourne la taille, 0 si erreur.
/// @param out_buf recoit un pointeur vers le buffer alloue. Liberer avec iecode_free().
IECODE_EXPORT uint32_t iecode_inazuma_lzss_decompress(const uint8_t* data, uint32_t size,
                                                       uint8_t** out_buf);

// ── Huffman ────────────────────────────────────────────────────────

/// Decompresse des donnees Huffman 4-bit (methode Level-5 #2).
/// @param out_buf recoit un pointeur vers le buffer alloue. Liberer avec iecode_free().
IECODE_EXPORT uint32_t iecode_huffman4_decompress(const uint8_t* data, uint32_t size,
                                                    uint8_t** out_buf);

/// Decompresse des donnees Huffman 8-bit (methode Level-5 #3).
/// @param out_buf recoit un pointeur vers le buffer alloue. Liberer avec iecode_free().
IECODE_EXPORT uint32_t iecode_huffman8_decompress(const uint8_t* data, uint32_t size,
                                                    uint8_t** out_buf);

// ── RLE ────────────────────────────────────────────────────────────

/// Decompresse des donnees RLE (methode Level-5 #4).
/// @param out_buf recoit un pointeur vers le buffer alloue. Liberer avec iecode_free().
IECODE_EXPORT uint32_t iecode_rle_decompress(const uint8_t* data, uint32_t size,
                                               uint8_t** out_buf);

// ── ZLib ───────────────────────────────────────────────────────────

/// Decompresse des donnees ZLib/deflate (methode Level-5 #5).
/// @param out_buf recoit un pointeur vers le buffer alloue. Liberer avec iecode_free().
IECODE_EXPORT uint32_t iecode_zlib_decompress(const uint8_t* data, uint32_t size,
                                                uint8_t** out_buf);

// ── DDS ────────────────────────────────────────────────────────────

/// Detecte si les donnees sont un fichier DDS valide (magic "DDS ").
/// @return 1 si oui, 0 sinon.
IECODE_EXPORT int iecode_dds_is_valid(const uint8_t* data, uint32_t size);

/// Retourne les metadonnees DDS en JSON (width, height, format, mips, etc.).
/// Le buffer retourne est alloue par iecode. Liberer avec iecode_free().
IECODE_EXPORT const char* iecode_dds_info(const uint8_t* data, uint32_t size);

// ── Format detection ───────────────────────────────────────────────

/// Detecte le format d'un fichier a partir de ses magic bytes.
/// Retourne un nom lisible ("CPK", "G4TX", "RDBN", etc.) ou "Unknown".
/// Le buffer retourne est alloue par iecode. Liberer avec iecode_free().
IECODE_EXPORT const char* iecode_detect_format(const uint8_t* data, uint32_t size);

// ── cfg.bin RDBN write ─────────────────────────────────────────────

/// Serialise un CfgBinFile en binaire (format original Level-5).
/// @param result handle obtenu via iecode_cfgbin_parse()
/// @param out_buf recoit un pointeur vers le buffer alloue. Liberer avec iecode_free().
/// @return taille du buffer, 0 si erreur.
IECODE_EXPORT uint32_t iecode_cfgbin_write(const iecode_result_t* result, uint8_t** out_buf);

// ── G4PK ───────────────────────────────────────────────────────────

/// Handle opaque pour un G4PK parse.
typedef struct iecode_g4pk iecode_g4pk_t;

/// Parse un fichier G4PK depuis un buffer memoire.
/// @return handle, ou NULL. Liberer avec iecode_g4pk_free().
IECODE_EXPORT iecode_g4pk_t* iecode_g4pk_open(const uint8_t* data, uint32_t size);

/// Nombre de fichiers dans le G4PK.
IECODE_EXPORT int32_t iecode_g4pk_count(const iecode_g4pk_t* g4pk);

/// Nom du fichier d'index `idx` (string statique liee au handle).
IECODE_EXPORT const char* iecode_g4pk_entry_name(const iecode_g4pk_t* g4pk, int32_t idx);

/// Extrait un fichier du G4PK par index.
/// @param out_size recoit la taille du buffer retourne
/// @return buffer extrait. Liberer avec iecode_free().
IECODE_EXPORT uint8_t* iecode_g4pk_extract(const iecode_g4pk_t* g4pk, int32_t idx,
                                            uint32_t* out_size);

/// Libere un handle G4PK.
IECODE_EXPORT void iecode_g4pk_free(iecode_g4pk_t* g4pk);

// ── FNT (font) ─────────────────────────────────────────────────────

/// Retourne les metadonnees d'un fichier FNT en JSON.
/// Le buffer retourne est alloue par iecode. Liberer avec iecode_free().
IECODE_EXPORT const char* iecode_fnt_info(const uint8_t* data, uint32_t size);

// ── ANMx (animation) ──────────────────────────────────────────────

/// Detecte si les donnees sont un fichier ANMx valide.
/// @return 1 si oui, 0 sinon.
IECODE_EXPORT int iecode_anm_is_valid(const uint8_t* data, uint32_t size);

/// Retourne les metadonnees ANMx en JSON.
/// Le buffer retourne est alloue par iecode. Liberer avec iecode_free().
IECODE_EXPORT const char* iecode_anm_info(const uint8_t* data, uint32_t size);

// ── EventText ──────────────────────────────────────────────────────

/// Extrait les textes evenementiels depuis un buffer cfg.bin brut.
/// Retourne un JSON array des entrees. Liberer avec iecode_free().
IECODE_EXPORT const char* iecode_event_text_extract(const uint8_t* data, uint32_t size);

// ── Steam API ────────────────────────────────────────────────────────
//
// Wrapper Steam API via chargement dynamique de steam_api64.dll.
// Handle opaque RAII — initialise et shutdown automatiquement.

/// Handle opaque vers le contexte Steam.
typedef struct iecode_steam iecode_steam_t;

/// Initialise l'API Steam. Retourne nullptr si Steam n'est pas lance.
IECODE_EXPORT iecode_steam_t* iecode_steam_init(void);

/// Initialise avec verification AppID (RestartAppIfNecessary).
IECODE_EXPORT iecode_steam_t* iecode_steam_init_app(uint32_t app_id);

/// Shutdown et libere le contexte Steam.
IECODE_EXPORT void iecode_steam_shutdown(iecode_steam_t* ctx);

/// Verifie si Steam est en cours d'execution.
IECODE_EXPORT int iecode_steam_is_running(const iecode_steam_t* ctx);

/// Retourne le SteamID 64 bits de l'utilisateur courant.
IECODE_EXPORT uint64_t iecode_steam_get_id(const iecode_steam_t* ctx);

/// Verifie si l'utilisateur est connecte.
IECODE_EXPORT int iecode_steam_is_logged_on(const iecode_steam_t* ctx);

/// Retourne le niveau Steam du joueur.
IECODE_EXPORT int iecode_steam_get_level(const iecode_steam_t* ctx);

/// Verifie si l'utilisateur possede l'app.
IECODE_EXPORT int iecode_steam_is_subscribed(const iecode_steam_t* ctx);

/// Verifie si l'utilisateur possede une app specifique.
IECODE_EXPORT int iecode_steam_is_subscribed_app(const iecode_steam_t* ctx, uint32_t app_id);

/// Verifie si l'acces est via Family Sharing.
IECODE_EXPORT int iecode_steam_is_family_sharing(const iecode_steam_t* ctx);

/// Verifie si un DLC est installe.
IECODE_EXPORT int iecode_steam_is_dlc_installed(const iecode_steam_t* ctx, uint32_t dlc_app_id);

/// Retourne la langue du jeu (ex: "french"). Liberer avec iecode_free().
IECODE_EXPORT const char* iecode_steam_get_language(const iecode_steam_t* ctx);

/// Retourne le build ID Steam.
IECODE_EXPORT int iecode_steam_get_build_id(const iecode_steam_t* ctx);

/// Retourne le repertoire d'installation. Liberer avec iecode_free().
IECODE_EXPORT const char* iecode_steam_get_install_dir(const iecode_steam_t* ctx, uint32_t app_id);

/// Traite les callbacks Steam en attente.
IECODE_EXPORT void iecode_steam_run_callbacks(const iecode_steam_t* ctx);

// ── Steam Cloud ─────────────────────────────────────────────────────

/// Verifie si le Cloud Steam est active pour le compte.
/// @return 1 si active, 0 sinon.
IECODE_EXPORT int iecode_steam_cloud_enabled(const iecode_steam_t* ctx);

/// Verifie si le Cloud Steam est active pour l'application.
/// @return 1 si active, 0 sinon.
IECODE_EXPORT int iecode_steam_cloud_enabled_app(const iecode_steam_t* ctx);

/// Retourne le quota Cloud (total et disponible en octets).
/// @return 1 si succes, 0 si echec.
IECODE_EXPORT int iecode_steam_cloud_quota(const iecode_steam_t* ctx,
                                            uint64_t* total, uint64_t* available);

/// Retourne le nombre de fichiers dans le Cloud.
IECODE_EXPORT int iecode_steam_cloud_file_count(const iecode_steam_t* ctx);

/// Retourne le nom du fichier Cloud a l'index donne.
/// @param size_out recoit la taille du fichier en octets.
/// @return nom (alloue par iecode). Liberer avec iecode_free().
IECODE_EXPORT const char* iecode_steam_cloud_file_name(const iecode_steam_t* ctx,
                                                        int index, int32_t* size_out);

/// Verifie si un fichier existe dans le Cloud.
/// @return 1 si existe, 0 sinon.
IECODE_EXPORT int iecode_steam_cloud_exists(const iecode_steam_t* ctx, const char* name);

/// Retourne la taille d'un fichier Cloud en octets.
IECODE_EXPORT int32_t iecode_steam_cloud_file_size(const iecode_steam_t* ctx, const char* name);

/// Lit le contenu d'un fichier Cloud.
/// @param out_size recoit la taille du buffer retourne.
/// @return buffer alloue par iecode. Liberer avec iecode_free(). NULL si echec.
IECODE_EXPORT uint8_t* iecode_steam_cloud_read(const iecode_steam_t* ctx,
                                                const char* name, uint32_t* out_size);

/// Ecrit des donnees dans un fichier Cloud.
/// @return 1 si succes, 0 si echec.
IECODE_EXPORT int iecode_steam_cloud_write(const iecode_steam_t* ctx,
                                            const char* name,
                                            const uint8_t* data, uint32_t size);

/// Supprime un fichier du Cloud.
/// @return 1 si succes, 0 si echec.
IECODE_EXPORT int iecode_steam_cloud_delete(const iecode_steam_t* ctx, const char* name);

// ── Encrypted App Tickets ───────────────────────────────────────────
//
// Wrapper sdkencryptedappticket64.dll — validation de tickets DRM Steam.
// Handle opaque RAII — charge et decharge la DLL automatiquement.

/// Handle opaque vers un ticket Steam.
typedef struct iecode_ticket iecode_ticket_t;

/// Charge la DLL sdkencryptedappticket64.dll. Retourne NULL si non trouvee.
IECODE_EXPORT iecode_ticket_t* iecode_ticket_load(void);

/// Libere le handle ticket.
IECODE_EXPORT void iecode_ticket_free(iecode_ticket_t* ticket);

/// Dechiffre un ticket. Alloue *out_buf via new[] (liberer avec iecode_free()).
/// @return 1 si succes, 0 si echec.
IECODE_EXPORT int iecode_ticket_decrypt(const iecode_ticket_t* t,
                                         const uint8_t* encrypted, uint32_t enc_size,
                                         const uint8_t* key, uint32_t key_size,
                                         uint8_t** out_buf, uint32_t* out_size);

/// Verifie si le ticket correspond a l'App ID donne.
IECODE_EXPORT int iecode_ticket_is_for_app(const iecode_ticket_t* t,
                                            const uint8_t* decrypted, uint32_t size,
                                            uint32_t app_id);

/// Verifie si la licence est empruntee (Family Sharing).
IECODE_EXPORT int iecode_ticket_is_borrowed(const iecode_ticket_t* t,
                                             const uint8_t* decrypted, uint32_t size);

/// Verifie si la licence est temporaire (Free Weekend).
IECODE_EXPORT int iecode_ticket_is_temporary(const iecode_ticket_t* t,
                                              const uint8_t* decrypted, uint32_t size);

/// Verifie si l'utilisateur a un ban VAC.
IECODE_EXPORT int iecode_ticket_is_vac_banned(const iecode_ticket_t* t,
                                               const uint8_t* decrypted, uint32_t size);

/// Retourne le SteamID 64 bits du ticket (0 si erreur).
IECODE_EXPORT uint64_t iecode_ticket_get_steam_id(const iecode_ticket_t* t,
                                                    const uint8_t* decrypted, uint32_t size);

/// Retourne l'App ID du ticket (0 si erreur).
IECODE_EXPORT uint32_t iecode_ticket_get_app_id(const iecode_ticket_t* t,
                                                  const uint8_t* decrypted, uint32_t size);

/// Retourne le timestamp d'emission Unix (0 si erreur).
IECODE_EXPORT uint32_t iecode_ticket_get_issue_time(const iecode_ticket_t* t,
                                                      const uint8_t* decrypted, uint32_t size);

/// Retourne un JSON avec toutes les informations du ticket dechiffre.
/// Le buffer retourne est alloue par iecode. Liberer avec iecode_free().
IECODE_EXPORT const char* iecode_ticket_info_json(const iecode_ticket_t* t,
                                                    const uint8_t* decrypted, uint32_t size);

// ── Memory Editor (Windows uniquement) ───────────────────────────────
//
// API d'edition memoire pour nie.exe — lecture/ecriture, pointer chains,
// AOB scan. Tous les handles sont opaques et doivent etre liberes.

#ifdef _WIN32

/// Handle opaque vers un processus externe.
typedef struct iecode_process iecode_process_t;

/// Handle opaque vers une connexion nie.exe.
typedef struct iecode_nie iecode_nie_t;

// ── Process generique ────────────────────────────────────────────────

/// Attache a un processus par nom d'executable.
/// Retourne nullptr si le processus n'est pas trouve.
IECODE_EXPORT iecode_process_t* iecode_process_attach(const char* exe_name);

/// Attache a un processus par PID.
IECODE_EXPORT iecode_process_t* iecode_process_attach_pid(uint32_t pid);

/// Detache et libere le handle.
IECODE_EXPORT void iecode_process_detach(iecode_process_t* proc);

/// Verifie si le processus est encore actif.
IECODE_EXPORT int iecode_process_is_valid(const iecode_process_t* proc);

/// Retourne l'adresse de base du module principal.
IECODE_EXPORT uint64_t iecode_process_base_address(const iecode_process_t* proc);

/// Retourne le PID du processus.
IECODE_EXPORT uint32_t iecode_process_pid(const iecode_process_t* proc);

/// Lit un bloc memoire. Retourne 1 en cas de succes, 0 en cas d'echec.
IECODE_EXPORT int iecode_mem_read(const iecode_process_t* proc, uint64_t addr,
                                   uint8_t* buf, uint32_t size);

/// Ecrit un bloc memoire. Retourne 1 en cas de succes, 0 en cas d'echec.
IECODE_EXPORT int iecode_mem_write(const iecode_process_t* proc, uint64_t addr,
                                    const uint8_t* data, uint32_t size);

/// Lit un int32 depuis la memoire.
IECODE_EXPORT int iecode_mem_read_i32(const iecode_process_t* proc, uint64_t addr,
                                       int32_t* out);

/// Ecrit un int32 dans la memoire.
IECODE_EXPORT int iecode_mem_write_i32(const iecode_process_t* proc, uint64_t addr,
                                        int32_t value);

/// Lit un int16 depuis la memoire.
IECODE_EXPORT int iecode_mem_read_i16(const iecode_process_t* proc, uint64_t addr,
                                       int16_t* out);

/// Ecrit un int16 dans la memoire.
IECODE_EXPORT int iecode_mem_write_i16(const iecode_process_t* proc, uint64_t addr,
                                        int16_t value);

/// Lit un uint32 depuis la memoire.
IECODE_EXPORT int iecode_mem_read_u32(const iecode_process_t* proc, uint64_t addr,
                                       uint32_t* out);

/// Ecrit un uint32 dans la memoire.
IECODE_EXPORT int iecode_mem_write_u32(const iecode_process_t* proc, uint64_t addr,
                                        uint32_t value);

/// Resout une chaine de pointeurs.
/// Retourne l'adresse finale, ou 0 en cas d'echec.
IECODE_EXPORT uint64_t iecode_mem_resolve_chain(const iecode_process_t* proc,
                                                 uint64_t base,
                                                 const uint64_t* offsets,
                                                 uint32_t count);

/// Scanne la memoire pour un pattern AOB (ex: "48 8B 45 ?? ?? 48 8B").
/// Retourne l'adresse de la premiere occurrence, ou 0 si non trouve.
IECODE_EXPORT uint64_t iecode_aob_scan(const iecode_process_t* proc,
                                        const char* pattern);

/// Scanne un range specifique.
IECODE_EXPORT uint64_t iecode_aob_scan_range(const iecode_process_t* proc,
                                              const char* pattern,
                                              uint64_t start, uint32_t size);

// ── nie.exe helpers ──────────────────────────────────────────────────

/// Attache a nie.exe directement.
IECODE_EXPORT iecode_nie_t* iecode_nie_attach(void);

/// Detache et libere le handle nie.exe.
IECODE_EXPORT void iecode_nie_detach(iecode_nie_t* nie);

/// Rebase une adresse statique vers l'adresse runtime (ASLR).
IECODE_EXPORT uint64_t iecode_nie_rebase(const iecode_nie_t* nie, uint64_t static_addr);

/// Lit la structure Player[index] (0..21) brute.
/// Retourne un buffer new[]-alloue de PLAYER_STRUCT_SIZE octets. Liberer avec iecode_free().
IECODE_EXPORT uint8_t* iecode_nie_read_player(const iecode_nie_t* nie, uint32_t index,
                                               uint32_t* out_size);

/// Lit les 8 stats (int16[8]) d'un personnage a l'adresse donnee.
/// Ordre : kick, guard, catch, body, control, speed, stamina, luck.
IECODE_EXPORT int iecode_nie_read_chara_stats(const iecode_nie_t* nie,
                                               uint64_t chara_addr,
                                               int16_t stats_out[8]);

/// Ecrit les 8 stats d'un personnage.
IECODE_EXPORT int iecode_nie_write_chara_stats(const iecode_nie_t* nie,
                                                uint64_t chara_addr,
                                                const int16_t stats_in[8]);

/// Lit les 6 techniques equipees (uint32[6]).
IECODE_EXPORT int iecode_nie_read_skills(const iecode_nie_t* nie,
                                          uint64_t chara_addr,
                                          uint32_t skills_out[6]);

/// Ecrit une technique dans un slot (0..5).
IECODE_EXPORT int iecode_nie_write_skill(const iecode_nie_t* nie,
                                          uint64_t chara_addr,
                                          uint32_t slot, uint32_t skill_id);

/// Lit le level et l'exp d'un personnage.
IECODE_EXPORT int iecode_nie_read_level(const iecode_nie_t* nie,
                                         uint64_t chara_addr,
                                         uint32_t* level_out, uint32_t* exp_out);

/// Ecrit le level et l'exp d'un personnage.
IECODE_EXPORT int iecode_nie_write_level(const iecode_nie_t* nie,
                                          uint64_t chara_addr,
                                          uint32_t level, uint32_t exp);

/// Recherche un pattern AOB dans le module principal de nie.exe.
IECODE_EXPORT uint64_t iecode_nie_find_pattern(const iecode_nie_t* nie,
                                                const char* pattern);

/// Resout un pointeur RIP-relatif depuis un resultat AOB.
IECODE_EXPORT uint64_t iecode_nie_resolve_rip(const iecode_nie_t* nie,
                                               const char* pattern,
                                               uint32_t rip_offset,
                                               uint32_t instr_len);

#endif // _WIN32

// ── Dump Service ───────────────────────────────────────────────────

/// Handle opaque pour le service de dump.
typedef struct iecode_dump iecode_dump_t;

/// Cree un service de dump pour le repertoire de jeu donne.
/// @param game_path chemin vers la racine du jeu (contient data/packs/)
/// @return handle, ou NULL si game_path invalide. Liberer avec iecode_dump_free().
IECODE_EXPORT iecode_dump_t* iecode_dump_create(const char* game_path);

/// Libere un handle dump.
IECODE_EXPORT void iecode_dump_free(iecode_dump_t* d);

/// Lance le dump (bloquant). Retourne un JSON avec le resultat.
/// @param output_path repertoire de sortie
/// @param smart_dump 1 = reprise intelligente via manifest
/// @param max_parallelism nombre de workers (1-16)
/// @param on_progress callback optionnelle appelee avec un JSON de progression
/// @param userdata donnees utilisateur passees au callback
/// @return JSON du resultat (cache dans le handle, ne pas liberer). NULL si erreur.
IECODE_EXPORT const char* iecode_dump_run(
    iecode_dump_t* d,
    const char* output_path,
    int smart_dump,
    int max_parallelism,
    void (*on_progress)(const char* json_progress, void* userdata),
    void* userdata);

/// Demande l'annulation du dump en cours.
IECODE_EXPORT void iecode_dump_cancel(iecode_dump_t* d);

// ── IevrGame (facade jeu) ──────────────────────────────────────────

/// Handle opaque pour la facade IevrGame.
typedef struct iecode_game iecode_game_t;

/// Cree une facade IevrGame depuis un chemin explicite.
/// @param game_path chemin vers le dossier d'installation du jeu
/// @return handle, ou NULL si allocation echouee. Liberer avec iecode_game_free().
IECODE_EXPORT iecode_game_t* iecode_game_create(const char* game_path);

/// Auto-detection via Steam (steam_helper::detect_game_path).
/// @return handle, ou NULL si le jeu n'est pas trouve. Liberer avec iecode_game_free().
IECODE_EXPORT iecode_game_t* iecode_game_detect(void);

/// Libere un handle IevrGame.
IECODE_EXPORT void iecode_game_free(iecode_game_t* g);

/// Verifie si le jeu est valide (nie.exe + data/ presents).
/// @return 1 si valide, 0 sinon
IECODE_EXPORT int iecode_game_is_valid(const iecode_game_t* g);

/// Chemin racine du jeu. Valide jusqu'a iecode_game_free().
IECODE_EXPORT const char* iecode_game_path(const iecode_game_t* g);

/// Chemin data/. Valide jusqu'a l'appel suivant sur ce handle.
IECODE_EXPORT const char* iecode_game_data_path(iecode_game_t* g);

/// Chemin data/packs/. Valide jusqu'a l'appel suivant sur ce handle.
IECODE_EXPORT const char* iecode_game_packs_path(iecode_game_t* g);

/// Retourne les infos d'analyse en JSON.
/// Cache dans le handle, ne pas liberer.
IECODE_EXPORT const char* iecode_game_info_json(iecode_game_t* g);

/// Desactive EAC via le sous-systeme integre.
/// @return 1 si succes, 0 si echec
IECODE_EXPORT int iecode_game_eac_disable(iecode_game_t* g);

/// Restaure EAC via le sous-systeme integre.
/// @return 1 si succes, 0 si echec
IECODE_EXPORT int iecode_game_eac_restore(iecode_game_t* g);

/// Verifie si EAC est desactive.
/// @return 1 si desactive, 0 sinon
IECODE_EXPORT int iecode_game_eac_is_disabled(const iecode_game_t* g);

// ── EAC Service ────────────────────────────────────────────────────

/// Handle opaque pour le service EAC.
typedef struct iecode_eac iecode_eac_t;

/// Cree un service EAC pour le repertoire de jeu donne.
/// @param game_dir chemin vers le dossier d'installation du jeu
/// @return handle, ou NULL si game_dir invalide. Liberer avec iecode_eac_free().
IECODE_EXPORT iecode_eac_t* iecode_eac_create(const char* game_dir);

/// Libere un handle EAC.
IECODE_EXPORT void iecode_eac_free(iecode_eac_t* eac);

/// Desactive EAC (modifie l'INI + backup du launcher).
/// @return 1 si succes, 0 si echec
IECODE_EXPORT int iecode_eac_disable(iecode_eac_t* eac);

/// Restaure EAC (revert INI + restaure launcher).
/// @return 1 si succes, 0 si echec
IECODE_EXPORT int iecode_eac_restore(iecode_eac_t* eac);

/// Verifie si EAC est actuellement desactive.
/// @return 1 si desactive, 0 si actif
IECODE_EXPORT int iecode_eac_is_disabled(const iecode_eac_t* eac);

/// Retourne le statut EAC complet en JSON.
/// Format : {"ini_modified":bool,"launcher_backed_up":bool,"launcher_missing":bool}
/// La string est cachee dans le handle, ne pas liberer.
IECODE_EXPORT const char* iecode_eac_status_json(const iecode_eac_t* eac);

// ── VFS (Virtual File System) ───────────────────────────────────────

/// Initialise le VFS depuis le dossier data/ du jeu.
/// Charge cpk_list.cfg.bin, dechiffre, parse, construit l'index.
/// @param game_data_dir chemin vers le dossier "data/" du jeu
/// @return handle opaque, ou NULL en cas d'erreur. Liberer avec iecode_vfs_shutdown().
IECODE_EXPORT void* iecode_vfs_init(const char* game_data_dir);

/// Ferme le VFS et libere toutes les ressources.
IECODE_EXPORT void iecode_vfs_shutdown(void* vfs);

/// Trouve quel CPK contient un asset.
/// @param vfs handle retourne par iecode_vfs_init()
/// @param path chemin interne (ex: "data/common/chr/.../file.g4md")
/// @param cpk_out buffer de sortie pour le nom du CPK
/// @param cpk_out_size taille du buffer cpk_out
/// @return taille du fichier (>0 si trouve), 0 si non trouve, -1 si erreur
IECODE_EXPORT int32_t iecode_vfs_find(void* vfs, const char* path,
                                       char* cpk_out, uint32_t cpk_out_size);

/// Lit un fichier directement depuis le bon CPK.
/// @param vfs handle retourne par iecode_vfs_init()
/// @param path chemin interne
/// @param out_size pointeur pour recevoir la taille des donnees
/// @return buffer alloue (liberer avec iecode_free()), ou NULL si erreur
IECODE_EXPORT uint8_t* iecode_vfs_read(void* vfs, const char* path,
                                        uint32_t* out_size);

/// Retourne le nombre d'assets indexes dans le VFS.
IECODE_EXPORT uint32_t iecode_vfs_asset_count(void* vfs);

// ── Pipeline 3D : Texture / Mesh / Anim / Model ─────────────────────

/// Handle opaque pour une texture chargee depuis un fichier G4TX.
typedef struct iecode_texture iecode_texture_t;

/// Handle opaque pour un mesh charge depuis un fichier G4MG.
typedef struct iecode_mesh iecode_mesh_t;

/// Handle opaque pour une animation chargee depuis un fichier G4RA.
typedef struct iecode_anim iecode_anim_t;

/// Handle opaque pour un modele de personnage complet (G4MD+G4MG+G4SK+G4RA).
typedef struct iecode_model iecode_model_t;

// ── Texture ─────────────────────────────────────────────────────────

/// Charge un fichier G4TX depuis un chemin disque.
/// @return handle opaque, ou NULL en cas d'erreur. Liberer avec iecode_texture_destroy().
IECODE_EXPORT iecode_texture_t* iecode_texture_load_g4tx(const char* path);

/// Libere un handle texture.
IECODE_EXPORT void iecode_texture_destroy(iecode_texture_t* tex);

/// Largeur de la premiere texture (0 si invalide).
IECODE_EXPORT uint16_t iecode_texture_width(iecode_texture_t* tex);

/// Hauteur de la premiere texture (0 si invalide).
IECODE_EXPORT uint16_t iecode_texture_height(iecode_texture_t* tex);

// ── Mesh ────────────────────────────────────────────────────────────

/// Charge un fichier G4MG depuis un chemin disque.
/// @return handle opaque, ou NULL. Liberer avec iecode_mesh_destroy().
IECODE_EXPORT iecode_mesh_t* iecode_mesh_load_g4mg(const char* path);

/// Libere un handle mesh.
IECODE_EXPORT void iecode_mesh_destroy(iecode_mesh_t* mesh);

/// Nombre total de vertices (tous sous-meshes confondus).
IECODE_EXPORT uint32_t iecode_mesh_vertex_count(iecode_mesh_t* mesh);

/// Nombre total d'indices (tous sous-meshes confondus).
IECODE_EXPORT uint32_t iecode_mesh_index_count(iecode_mesh_t* mesh);

// ── Animation ───────────────────────────────────────────────────────

/// Charge un fichier G4RA depuis un chemin disque.
/// @return handle opaque, ou NULL. Liberer avec iecode_anim_destroy().
IECODE_EXPORT iecode_anim_t* iecode_anim_load_g4ra(const char* path);

/// Libere un handle anim.
IECODE_EXPORT void iecode_anim_destroy(iecode_anim_t* anim);

/// Duree totale de l'animation en secondes (0.0 si le clip n'a pas pu etre reconstruit).
IECODE_EXPORT float iecode_anim_duration(iecode_anim_t* anim);

/// Nombre de pistes (une piste = un os). Si le clip n'est pas dispo,
/// retourne le nombre d'entrees de l'archive G4RA brute.
IECODE_EXPORT uint32_t iecode_anim_track_count(iecode_anim_t* anim);

// ── Model ───────────────────────────────────────────────────────────

/// Charge un modele de personnage complet depuis `<data_root>/common/chr/<chara_id>/`.
/// Charge G4MD + G4MG + G4SK + G4RA si presents. Les fichiers manquants sont ignores.
/// @return handle opaque, ou NULL en cas d'erreur critique. Liberer avec iecode_model_destroy().
IECODE_EXPORT iecode_model_t* iecode_model_load(const char* data_root,
                                                 const char* chara_id);

/// Libere un handle modele.
IECODE_EXPORT void iecode_model_destroy(iecode_model_t* model);

/// Avance l'animation interne du modele de `dt` secondes. No-op si pas d'anim.
IECODE_EXPORT void iecode_model_update(iecode_model_t* model, float dt);

// ── G4RA (archive de ressources, API buffer) ────────────────────────

/// Handle opaque pour une archive G4RA parsee depuis un buffer memoire.
typedef struct iecode_g4ra iecode_g4ra_t;

/// Parse une archive G4RA depuis un buffer. Le buffer est copie en interne.
/// @return handle ou NULL. Liberer avec iecode_g4ra_free().
IECODE_EXPORT iecode_g4ra_t* iecode_g4ra_open(const uint8_t* data, size_t size);

/// Libere un handle G4RA.
IECODE_EXPORT void iecode_g4ra_free(iecode_g4ra_t* ra);

/// Nombre d'entrees dans l'archive.
IECODE_EXPORT uint32_t iecode_g4ra_entry_count(iecode_g4ra_t* ra);

/// Nom de l'entree d'index `idx` (string statique liee au handle, ne pas liberer).
IECODE_EXPORT const char* iecode_g4ra_entry_name(iecode_g4ra_t* ra, uint32_t idx);

/// Extrait les donnees brutes d'une entree. Le buffer retourne dans `out`
/// est alloue et doit etre libere par l'appelant via iecode_free().
/// @return 0 en cas de succes, -1 en cas d'erreur.
IECODE_EXPORT int iecode_g4ra_extract(iecode_g4ra_t* ra, uint32_t idx,
                                       uint8_t** out, size_t* out_size);

// ── Modding : scanner / conflict / installer / profile ─────────────

/// Handle opaque pour une liste de mods scannes.
typedef struct iecode_mod_list iecode_mod_list_t;

/// Handle opaque pour un rapport de conflits entre mods.
typedef struct iecode_conflict_result iecode_conflict_result_t;

/// Scanne un dossier de mods et retourne la liste detectee.
/// @return handle ou NULL. Liberer avec iecode_mod_list_free().
IECODE_EXPORT iecode_mod_list_t* iecode_mod_scan(const char* mods_dir);

/// Libere un handle de liste de mods.
IECODE_EXPORT void iecode_mod_list_free(iecode_mod_list_t* list);

/// Nombre de mods dans la liste.
IECODE_EXPORT uint32_t iecode_mod_list_count(iecode_mod_list_t* list);

/// Nom affichable du mod d'index `idx` (string liee au handle).
IECODE_EXPORT const char* iecode_mod_list_name(iecode_mod_list_t* list, uint32_t idx);

/// Identifiant (dossier) du mod d'index `idx` (string liee au handle).
IECODE_EXPORT const char* iecode_mod_list_id(iecode_mod_list_t* list, uint32_t idx);

/// Verifie les conflits entre les mods actives de la liste.
/// @return handle ou NULL. Liberer avec iecode_conflict_result_free().
IECODE_EXPORT iecode_conflict_result_t* iecode_mod_check_conflicts(
    const char* game_path, iecode_mod_list_t* mods);

/// Libere un handle de rapport de conflits.
IECODE_EXPORT void iecode_conflict_result_free(iecode_conflict_result_t* r);

/// Retourne 1 si au moins un conflit est present, 0 sinon.
IECODE_EXPORT int iecode_conflict_result_has_conflicts(iecode_conflict_result_t* r);

/// Retourne le rapport de conflits au format JSON (string liee au handle).
IECODE_EXPORT const char* iecode_conflict_result_json(iecode_conflict_result_t* r);

/// Installe un mod (fusion + pack + copie).
/// @return 1 si succes, 0 sinon.
IECODE_EXPORT int iecode_mod_install(const char* game_path, const char* mod_path,
                                      const char* cpklist_path);

/// Desinstalle un mod par son identifiant.
/// @return 1 si succes, 0 sinon.
IECODE_EXPORT int iecode_mod_uninstall(const char* game_path, const char* mod_id);

/// Liste les profils de mods au format JSON (string allouee, liberer via iecode_free()).
IECODE_EXPORT const char* iecode_profile_list_json(const char* profiles_dir);

/// Applique un profil nomme au dossier du jeu.
/// @return 1 si succes, 0 sinon.
IECODE_EXPORT int iecode_profile_apply(const char* game_path, const char* profile_name,
                                        const char* profiles_dir);

// ── UTF parser (CriWare) ────────────────────────────────────────────

/// Handle opaque pour une table @UTF parsee.
typedef struct iecode_utf iecode_utf_t;

/// Parse une table @UTF depuis un buffer.
/// @return handle ou NULL. Liberer avec iecode_utf_free().
IECODE_EXPORT iecode_utf_t* iecode_utf_parse(const uint8_t* data, size_t size);

/// Libere un handle UTF.
IECODE_EXPORT void iecode_utf_free(iecode_utf_t* utf);

/// Nombre de lignes.
IECODE_EXPORT uint32_t iecode_utf_row_count(iecode_utf_t* utf);

/// Nombre de colonnes.
IECODE_EXPORT uint32_t iecode_utf_col_count(iecode_utf_t* utf);

/// Nom de la colonne `col` (string liee au handle).
IECODE_EXPORT const char* iecode_utf_col_name(iecode_utf_t* utf, uint32_t col);

/// Valeur string a (row, col) — retourne NULL si la cellule n'est pas une string.
IECODE_EXPORT const char* iecode_utf_get_string(iecode_utf_t* utf, uint32_t row, uint32_t col);

/// Valeur entiere a (row, col) — retourne 0 si la cellule n'est pas numerique.
IECODE_EXPORT int32_t iecode_utf_get_int(iecode_utf_t* utf, uint32_t row, uint32_t col);

/// Convertit la table complete en JSON.
/// `out_json` recoit un buffer alloue (liberer via iecode_free()).
/// @return 0 en cas de succes, -1 en cas d'erreur.
IECODE_EXPORT int iecode_utf_to_json(iecode_utf_t* utf, char** out_json);

// ── Tagged binary (clobin / linb / ptlb) ────────────────────────────

/// Handle opaque pour un conteneur tagge (clobin / linb / ptlb).
typedef struct iecode_tagged_bin iecode_tagged_bin_t;

/// Parse un conteneur tagge. Le buffer est copie en interne.
/// @return handle ou NULL. Liberer avec iecode_tagged_bin_free().
IECODE_EXPORT iecode_tagged_bin_t* iecode_tagged_bin_parse(const uint8_t* data, size_t size);

/// Libere un handle tagged_bin.
IECODE_EXPORT void iecode_tagged_bin_free(iecode_tagged_bin_t* tb);

/// Nombre d'entrees declare dans le header.
IECODE_EXPORT uint32_t iecode_tagged_bin_count(iecode_tagged_bin_t* tb);

/// Type hash du conteneur (distingue clobin / linb / ptlb).
IECODE_EXPORT uint32_t iecode_tagged_bin_type_hash(iecode_tagged_bin_t* tb);

/// Pointeur vers les entrees brutes (non possede, lie au handle).
IECODE_EXPORT const uint8_t* iecode_tagged_bin_raw_entries(iecode_tagged_bin_t* tb,
                                                            size_t* out_size);

// ── G4LA / G4MA / G4VS (pattern G4xx generique) ─────────────────────

/// Handle opaque pour un conteneur G4xx (G4LA / G4MA / G4VS).
typedef struct iecode_g4xx iecode_g4xx_t;

/// Parse un fichier G4LA.
IECODE_EXPORT iecode_g4xx_t* iecode_g4la_parse(const uint8_t* data, size_t size);

/// Parse un fichier G4MA.
IECODE_EXPORT iecode_g4xx_t* iecode_g4ma_parse(const uint8_t* data, size_t size);

/// Parse un fichier G4VS.
IECODE_EXPORT iecode_g4xx_t* iecode_g4vs_parse(const uint8_t* data, size_t size);

/// Libere un handle G4xx.
IECODE_EXPORT void iecode_g4xx_free(iecode_g4xx_t* g);

/// Taille de la section data declaree dans le header.
IECODE_EXPORT uint32_t iecode_g4xx_data_size(iecode_g4xx_t* g);

/// Donnees brutes du conteneur (non possede, lie au handle).
IECODE_EXPORT const uint8_t* iecode_g4xx_raw_data(iecode_g4xx_t* g, size_t* out_size);

// ── G4MT (material / motion table) ──────────────────────────────────

/// Handle opaque pour un fichier G4MT.
typedef struct iecode_g4mt iecode_g4mt_t;

/// Parse un fichier G4MT depuis un buffer.
IECODE_EXPORT iecode_g4mt_t* iecode_g4mt_parse(const uint8_t* data, size_t size);

/// Libere un handle G4MT.
IECODE_EXPORT void iecode_g4mt_free(iecode_g4mt_t* mt);

/// Retourne les infos du G4MT en JSON (string liee au handle).
IECODE_EXPORT const char* iecode_g4mt_info_json(iecode_g4mt_t* mt);

// ── map_block_list (parser texte) ───────────────────────────────────

/// Handle opaque pour une liste de blocs de carte parsee.
typedef struct iecode_map_blocks iecode_map_blocks_t;

/// Parse un bloc BLOCK_LIST_BEG..BLOCK_LIST_END depuis un texte.
IECODE_EXPORT iecode_map_blocks_t* iecode_map_blocks_parse(const char* text);

/// Libere un handle map_blocks.
IECODE_EXPORT void iecode_map_blocks_free(iecode_map_blocks_t* mb);

/// Nombre de blocs.
IECODE_EXPORT uint32_t iecode_map_blocks_count(iecode_map_blocks_t* mb);

/// Nom CRC du bloc d'index `idx` (string liee au handle).
IECODE_EXPORT const char* iecode_map_blocks_name(iecode_map_blocks_t* mb, uint32_t idx);

/// Convertit la liste en JSON. `out_json` recoit un buffer alloue (iecode_free()).
/// @return 0 en cas de succes, -1 en cas d'erreur.
IECODE_EXPORT int iecode_map_blocks_to_json(iecode_map_blocks_t* mb, char** out_json);

#ifdef __cplusplus
} // extern "C"
#endif
