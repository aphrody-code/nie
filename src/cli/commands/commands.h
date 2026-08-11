#pragma once

/**
 * @file commands.h
 * Declarations de toutes les commandes CLI.
 *
 * Chaque commande est une fonction libre qui recoit l'app CLI11
 * et y ajoute sa sous-commande. Le main() appelle chaque fonction
 * d'enregistrement au demarrage.
 */

namespace CLI { class App; }

namespace iecode::cli {

/// Enregistre la commande 'extract' (extraction CPK).
void register_extract_command(CLI::App& app);

/// Enregistre la commande 'dump' (extraction massive).
void register_dump_command(CLI::App& app);

/// Enregistre la commande 'config' (cfg.bin <-> JSON).
void register_config_command(CLI::App& app);

/// Enregistre la commande 'crypto' (chiffrement/dechiffrement).
void register_crypto_command(CLI::App& app);

/// Enregistre la commande 'pipeline' (batch extract + convert).
void register_pipeline_command(CLI::App& app);

/// Enregistre la commande 'g4tx' (textures G4TX).
void register_g4tx_command(CLI::App& app);

/// Enregistre la commande 'g4mg' (meshes G4MG).
void register_g4mg_command(CLI::App& app);

/// Enregistre la commande 'info' (informations fichier).
void register_info_command(CLI::App& app);

/// Enregistre la commande 'analyze' (analyse RE).
void register_analyze_command(CLI::App& app);

/// Enregistre la commande 'format' (detection de format).
void register_format_command(CLI::App& app);

#ifdef IECODE_HAS_GAME
/// Enregistre la commande 'passive' (competences passives — necessite iecode_game).
void register_passive_command(CLI::App& app);
#endif

/// Enregistre la commande 'dump-gamedata' (export donnees de jeu).
void register_dump_gamedata_command(CLI::App& app);

/// Enregistre la commande 'search' (recherche personnages, skills, equipes).
void register_search_command(CLI::App& app);

/// Enregistre la commande 'benchmark' (benchmarks crypto/compression).
void register_benchmark_command(CLI::App& app);

/// Enregistre la commande 'g4md' (modeles G4MD).
void register_g4md_command(CLI::App& app);

/// Enregistre la commande 'g4cm' (conteneurs G4CM character model).
void register_g4cm_command(CLI::App& app);

/// Enregistre la commande 'g4ra' (animations G4RA).
void register_g4ra_command(CLI::App& app);

/// Enregistre la commande 'g4pk' (packs G4PK).
void register_g4pk_command(CLI::App& app);

/// Enregistre la commande 'g4sk' (squelettes G4SK).
void register_g4sk_command(CLI::App& app);

/// Enregistre la commande 'utf' (tables @UTF CRI).
void register_utf_command(CLI::App& app);

/// Enregistre la commande 'convert' (conversion unifiee multi-format).
void register_convert_command(CLI::App& app);

/// Enregistre la commande 'pack' (packaging mod CPK).
void register_pack_command(CLI::App& app);

/// Enregistre la commande 'merge' (fusion de dossiers de mods).
void register_merge_command(CLI::App& app);

/// Enregistre la commande 'prepare-menu' (preparation donnees menu).
void register_prepare_menu_command(CLI::App& app);

/// Enregistre la commande 'push' (push donnees vers Supabase).
void register_push_command(CLI::App& app);


/// Enregistre la commande 'nie' (indexation/recherche nie.c decompilation Ghidra).
void register_nie_command(CLI::App& app);


/// Enregistre la commande 'dump-playstyle' (export systeme PlayStyle en JSON).
void register_dump_playstyle_command(CLI::App& app);

/// Enregistre la commande 'mod' (gestion complete des mods).
void register_mod_command(CLI::App& app);

/// Enregistre la commande 'audio' (operations ACB/AWB CRI ADX2).
void register_audio_command(CLI::App& app);

/// Enregistre la commande 'usm' (demuxage videos USM CRI Sofdec2).
void register_usm_command(CLI::App& app);

/// Enregistre la commande 'bin' (dispatcher intelligent .bin).
void register_bin_command(CLI::App& app);

/// Enregistre la commande 'scene' (parseurs OBJBIN/COL/G4NV).
void register_scene_command(CLI::App& app);

/// Enregistre la commande 'vfx' (inspection VFXO/PFXO/FXBIN/PTLB).
void register_vfx_command(CLI::App& app);

/// Enregistre la commande 'mevbin' (Motion Event Binary).
void register_mevbin_command(CLI::App& app);

/// Enregistre la commande 'p3lip' (lip-sync P3LIP).
void register_p3lip_command(CLI::App& app);

/// Enregistre la commande 'serve' (serveur HTTP REST API).
void register_serve_command(CLI::App& app);

/// Enregistre la commande 'vfs' (systeme de fichiers virtuel).
void register_vfs_command(CLI::App& app);

/// Enregistre la commande 'archive' (exploration .tar.zst en streaming).
void register_archive_command(CLI::App& app);

#ifdef IECODE_HAS_ENGINE
/// Enregistre la commande 'render' (pipeline 3D/2D : textures, meshes, anims, modeles — necessite iecode_engine).
void register_render_command(CLI::App& app);
#endif

} // namespace iecode::cli
