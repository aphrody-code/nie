use nie_aphrody::{
    BUNDLED_ATLAS_PNG, BUNDLED_ATLAS_WEBP, BUNDLED_PET_JSON, CELL_HEIGHT, CELL_WIDTH, Pet,
    sha256_hex,
};

#[test]
fn package_aphrody_v2_est_charge_et_reconstruit_pixel_exact() {
    let pet = Pet::bundled().expect("package Aphrody embarqué valide");
    let disk = Pet::load(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("assets/aphrody"))
        .expect("package Aphrody vendored chargeable depuis le dépôt");
    assert!(disk.diagnose().ok());
    assert_eq!(disk.rgba, pet.rgba);
    assert_eq!(pet.pet.id, "aphrody");
    assert_eq!(pet.pet.sprite_version_number, 2);
    assert_eq!(pet.pet.spritesheet_path, "spritesheet.webp");
    assert_eq!(pet.manifest.animation_count, 11);
    assert_eq!(pet.manifest.exported_frame_count, 74);

    let report = pet.diagnose();
    assert!(report.ok(), "diagnostic: {:?}", report.errors);
    assert_eq!(report.checked_frames, 74);
    assert_eq!(
        sha256_hex(BUNDLED_ATLAS_PNG),
        "bc48f3e2a4d3086234062b9175d58f2caaec39f6afeb53ab8b222513fe964037"
    );
    assert_eq!(
        sha256_hex(BUNDLED_ATLAS_WEBP),
        "93238150de5b86b5977f8409800a91637dfcc3b70b3b0d6d617f6563fa54389b"
    );
    assert_eq!(
        sha256_hex(BUNDLED_PET_JSON.as_bytes()),
        "93b3af384a3ab44e6a0882f05458a9999bd9e8f2e42ac32a620eec7246e69cee"
    );

    for (degrees, label) in [
        (0.0, "up"),
        (90.0, "right"),
        (180.0, "down"),
        (270.0, "left"),
    ] {
        let frame = pet.direction(degrees).expect("direction cardinale");
        assert_eq!(frame.direction.as_deref(), Some(label));
    }

    let width = pet.manifest.atlas.width as usize;
    let mut rebuilt = vec![0u8; pet.rgba.len()];
    for animation in pet.manifest.animations.values() {
        for frame in &animation.frames {
            let cell = pet.extract(frame).expect("extraction RGBA lossless");
            assert_eq!(cell.len(), (CELL_WIDTH * CELL_HEIGHT * 4) as usize);
            let row_bytes = CELL_WIDTH as usize * 4;
            for row in 0..CELL_HEIGHT as usize {
                let source = row * row_bytes;
                let destination =
                    ((frame.atlas_rect.y as usize + row) * width + frame.atlas_rect.x as usize) * 4;
                rebuilt[destination..destination + row_bytes]
                    .copy_from_slice(&cell[source..source + row_bytes]);
            }
        }
    }
    assert_eq!(
        rebuilt, pet.rgba,
        "les 74 cellules reconstruisent l'atlas RGBA"
    );
    assert_eq!(sha256_hex(&rebuilt), pet.manifest.atlas.rgba_sha256);
}
