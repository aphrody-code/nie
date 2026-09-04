use nie_aphrody::{BUNDLED_ATLAS_PNG, BUNDLED_ATLAS_WEBP, Pet, sha256_hex};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let pet = Pet::bundled()?;
    let report = pet.diagnose();
    println!(
        "pet={} version={} animations={} frames={} integrity={} png_sha256={} webp_sha256={}",
        pet.pet.id,
        pet.pet.sprite_version_number,
        pet.manifest.animation_count,
        report.checked_frames,
        report.ok(),
        sha256_hex(BUNDLED_ATLAS_PNG),
        sha256_hex(BUNDLED_ATLAS_WEBP),
    );
    if !report.ok() {
        return Err(report.errors.join("; ").into());
    }
    Ok(())
}
