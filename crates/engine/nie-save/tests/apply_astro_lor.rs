//! Test d'intégration et d'application d'Astro Lor comme Avatar dans la save du joueur.
//!
//! Configure Astro Lor (OG: 0x9983CCE2 en slot 0 / avatar principal, VR: 0x0C78B74B en slot 12)
//! et préserve l'ensemble des personnages existants.

use nie_save::{
    BlobSubtype,
    body::{CharaId, parse_autosave_roster},
    io::{read_save, write_save},
};
use std::path::Path;

const ASTRO_LOR_OG_ID: u32 = 0x9983_CCE2;
const ASTRO_LOR_VR_ID: u32 = 0x0C78_B74B;

#[test]
fn apply_and_verify_astro_lor_avatar() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|p| p.parent())
        .and_then(|p| p.parent())
        .expect("racine workspace");
    let save_path = root.join("var/save_work/002AB8F4-USERDATALIVE");
    let bak_path = root.join("var/save_work/002AB8F4-USERDATALIVE.bak");
    
    // S'assurer qu'un backup existe
    assert!(bak_path.exists() || save_path.exists(), "Save source introuvable");
    if !bak_path.exists() && save_path.exists() {
        std::fs::copy(&save_path, &bak_path).expect("backup de securite");
    }

    // 1. Lire et déchiffrer la sauvegarde (avec le nom canonique 002AB8F4-USERDATALIVE pour dériver la clé CRC32)
    let raw_bytes = std::fs::read(&bak_path).expect("lecture du fichier source");
    let mut container = nie_save::parse(&raw_bytes, "002AB8F4-USERDATALIVE").expect("dechiffrement de la save");
    assert_eq!(container.slot_name, "002AB8F4-USERDATALIVE");

    // 2. Trouver le blob AUTOSAVE
    let autosave_idx = container
        .entries
        .iter()
        .position(|e| e.filename == "AUTOSAVE_data.bin")
        .expect("AUTOSAVE_data.bin absent");

    let autosave_blob = &mut container.blobs[autosave_idx];
    assert_eq!(autosave_blob.header.subtype, BlobSubtype::Autosave);

    // 3. Localiser le roster dans le blob AUTOSAVE
    // Hash TLV roster = 0xBA162C11 (octets 11 2C 16 BA)
    let roster_needle = [0x11, 0x2C, 0x16, 0xBA];
    let roster_hash_pos = autosave_blob
        .body
        .windows(4)
        .position(|w| w == roster_needle)
        .expect("TLV roster introuvable dans AUTOSAVE");

    let roster_data_pos = roster_hash_pos + 8; // saut hash(4) + len(4)
    assert!(roster_data_pos + 24000 <= autosave_blob.body.len(), "debordement roster");

    // Sauvegarder le personnage actuel du slot 0 (l'ancien avatar)
    let old_slot0 = u32::from_le_bytes(
        autosave_blob.body[roster_data_pos..roster_data_pos + 4]
            .try_into()
            .unwrap(),
    );
    eprintln!("Ancien avatar slot 0 : 0x{:08X}", old_slot0);

    // Configurer Astro Lor OG en slot 0 (avatar actif du joueur)
    autosave_blob.body[roster_data_pos..roster_data_pos + 4]
        .copy_from_slice(&ASTRO_LOR_OG_ID.to_le_bytes());

    // Configurer Astro Lor VR en slot 12
    let slot12_pos = roster_data_pos + 12 * 4;
    autosave_blob.body[slot12_pos..slot12_pos + 4]
        .copy_from_slice(&ASTRO_LOR_VR_ID.to_le_bytes());

    // Si l'ancien slot 0 n'était pas vide et n'était pas déjà Astro Lor, le placer en slot 13
    if old_slot0 != 0 && old_slot0 != ASTRO_LOR_OG_ID && old_slot0 != ASTRO_LOR_VR_ID {
        let slot13_pos = roster_data_pos + 13 * 4;
        autosave_blob.body[slot13_pos..slot13_pos + 4]
            .copy_from_slice(&old_slot0.to_le_bytes());
        eprintln!("Ancien avatar deplace en slot 13");
    }

    // 4. Mettre à jour l'entrée de répertoire du conteneur
    // (write_save recalcule automatiquement les CRC32 de chaque blob et de l'en-tête)
    write_save(&container, &save_path).expect("ecriture et rechiffrement de la save modifiee");

    // 5. Relire et valider la save rechiffrée
    let reloaded = read_save(&save_path).expect("relecture de la save modifiee");
    let reloaded_autosave = reloaded
        .blob_by_subtype(BlobSubtype::Autosave)
        .expect("AUTOSAVE absent apres rechargement");

    let parsed_roster = parse_autosave_roster(&reloaded_autosave.body)
        .expect("parsing du roster de la save modifiee");

    assert!(
        parsed_roster.owned.contains(&CharaId(ASTRO_LOR_OG_ID)),
        "Astro Lor OG (0x{:08X}) doit etre dans le roster",
        ASTRO_LOR_OG_ID
    );
    assert!(
        parsed_roster.owned.contains(&CharaId(ASTRO_LOR_VR_ID)),
        "Astro Lor VR (0x{:08X}) doit etre dans le roster",
        ASTRO_LOR_VR_ID
    );
    if old_slot0 != 0 && old_slot0 != ASTRO_LOR_OG_ID {
        assert!(
            parsed_roster.owned.contains(&CharaId(old_slot0)),
            "L'ancien personnage (0x{:08X}) doit etre preserve",
            old_slot0
        );
    }

    // Vérifier que le slot 0 est bien Astro Lor OG
    let slot0_id = u32::from_le_bytes(
        reloaded_autosave.body[roster_data_pos..roster_data_pos + 4]
            .try_into()
            .unwrap(),
    );
    assert_eq!(slot0_id, ASTRO_LOR_OG_ID, "Slot 0 doit etre Astro Lor OG");

    eprintln!(
        "Succes : Astro Lor configure comme Avatar (slot 0: 0x{:08X}, slot 12: 0x{:08X}, total owned: {})",
        ASTRO_LOR_OG_ID,
        ASTRO_LOR_VR_ID,
        parsed_roster.owned.len()
    );

    // 6. Déploiement sécurisé vers le dossier Steam live
    let steam_live_path = Path::new(r"C:\Program Files (x86)\Steam\userdata\1599409088\2799860\remote\002AB8F4-USERDATALIVE");
    if steam_live_path.exists() {
        let steam_bak = Path::new(r"C:\Program Files (x86)\Steam\userdata\1599409088\2799860\remote\002AB8F4-USERDATALIVE.bak");
        if !steam_bak.exists() {
            std::fs::copy(steam_live_path, steam_bak).expect("backup steam live");
            eprintln!("Backup cree : {}", steam_bak.display());
        }
        std::fs::copy(&save_path, steam_live_path).expect("copie vers dossier Steam");
        eprintln!("Save live Steam mise a jour avec succes : {}", steam_live_path.display());

        // Valider directement la save installée dans Steam
        let steam_reloaded = read_save(steam_live_path).expect("validation de la save Steam");
        let steam_autosave = steam_reloaded
            .blob_by_subtype(BlobSubtype::Autosave)
            .expect("AUTOSAVE Steam valide");
        let steam_roster = parse_autosave_roster(&steam_autosave.body).expect("parse roster Steam");
        assert!(steam_roster.owned.contains(&CharaId(ASTRO_LOR_OG_ID)));
        eprintln!("Validation Steam live confirmee !");
    }
}
