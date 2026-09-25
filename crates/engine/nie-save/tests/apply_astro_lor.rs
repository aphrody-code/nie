//! Apply Astro Lor as the player's avatar in a real save.
//!
//! Astro Lor OG (`0x9983CCE2`) goes to slot 0, the active avatar, and Astro Lor VR
//! (`0x0C78B74B`) to slot 12; the previous slot-0 character moves to slot 13, so every owned
//! character survives.
//!
//! Two tests, two blast radii:
//!
//! - `apply_and_verify_astro_lor_avatar` runs under a plain `cargo test`. It reads a player save
//!   the operator dropped under `var/save_work/` and writes the patched copy into a temporary
//!   directory — never anywhere else, not even back into `var/save_work/`.
//! - `install_astro_lor_avatar_into_live_save` is `#[ignore]`d AND needs `NIE_SAVE_LIVE_DEST` to
//!   name the live save file. It is the only path that replaces a save outside the repository,
//!   it validates the patched bytes before writing, and it keeps the previous bytes in a backup
//!   that no later run can overwrite.
//!
//! No install path or account id lives in this file: the destination always comes from the
//! operator.
//!
//! ```text
//! NIE_SAVE_LIVE_DEST=<steam>/userdata/<account>/<app>/remote/002AB8F4-USERDATALIVE \
//!   cargo test -p nie-save --test apply_astro_lor -- --ignored --nocapture
//! ```

use std::{
    fs,
    io::Write as _,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use nie_save::{
    BlobSubtype, LivesContainer,
    body::{CharaId, parse_autosave_roster},
    io::{read_save, write_save},
};

const ASTRO_LOR_OG_ID: u32 = 0x9983_CCE2;
const ASTRO_LOR_VR_ID: u32 = 0x0C78_B74B;

/// Slot name of the player save; the decryption key is derived from it (CRC-32).
const SLOT: &str = "002AB8F4-USERDATALIVE";

/// Roster TLV hash `0xBA162C11`, little-endian as it appears in the AUTOSAVE body.
const ROSTER_TLV_HASH: [u8; 4] = [0x11, 0x2C, 0x16, 0xBA];

/// Environment variable naming the live save file the opt-in test may replace.
const LIVE_DEST_ENV: &str = "NIE_SAVE_LIVE_DEST";

/// Where the patch landed, so the re-read save can be checked against it.
struct Patch {
    roster_data_pos: usize,
    old_slot0: u32,
}

fn workspace_root() -> &'static Path {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(3)
        .expect("workspace root")
}

/// Rewrites the roster of the AUTOSAVE blob in place.
fn apply_astro_lor(container: &mut LivesContainer) -> Patch {
    let autosave_idx = container
        .entries
        .iter()
        .position(|e| e.filename == "AUTOSAVE_data.bin")
        .expect("AUTOSAVE_data.bin absent");
    let autosave = &mut container.blobs[autosave_idx];
    assert_eq!(autosave.header.subtype, BlobSubtype::Autosave);

    let roster_hash_pos = autosave
        .body
        .windows(4)
        .position(|w| w == ROSTER_TLV_HASH)
        .expect("roster TLV not found in AUTOSAVE");
    let roster_data_pos = roster_hash_pos + 8; // hash (4) + length (4)
    assert!(
        roster_data_pos + 24_000 <= autosave.body.len(),
        "roster overflows the AUTOSAVE body"
    );

    let old_slot0 = read_u32(&autosave.body, roster_data_pos);
    eprintln!("previous slot-0 avatar: 0x{old_slot0:08X}");

    write_u32(&mut autosave.body, roster_data_pos, ASTRO_LOR_OG_ID);
    write_u32(
        &mut autosave.body,
        roster_data_pos + 12 * 4,
        ASTRO_LOR_VR_ID,
    );
    if old_slot0 != 0 && old_slot0 != ASTRO_LOR_OG_ID && old_slot0 != ASTRO_LOR_VR_ID {
        write_u32(&mut autosave.body, roster_data_pos + 13 * 4, old_slot0);
        eprintln!("previous avatar moved to slot 13");
    }

    Patch {
        roster_data_pos,
        old_slot0,
    }
}

/// Checks a re-read save against the patch and returns the number of owned characters.
fn verify(container: &LivesContainer, patch: &Patch) -> usize {
    let autosave = container
        .blob_by_subtype(BlobSubtype::Autosave)
        .expect("AUTOSAVE absent after reload");
    let roster = parse_autosave_roster(&autosave.body).expect("roster of the patched save");

    assert!(
        roster.owned.contains(&CharaId(ASTRO_LOR_OG_ID)),
        "Astro Lor OG (0x{ASTRO_LOR_OG_ID:08X}) must be in the roster"
    );
    assert!(
        roster.owned.contains(&CharaId(ASTRO_LOR_VR_ID)),
        "Astro Lor VR (0x{ASTRO_LOR_VR_ID:08X}) must be in the roster"
    );
    if patch.old_slot0 != 0 && patch.old_slot0 != ASTRO_LOR_OG_ID {
        assert!(
            roster.owned.contains(&CharaId(patch.old_slot0)),
            "the previous avatar (0x{:08X}) must be preserved",
            patch.old_slot0
        );
    }
    assert_eq!(
        read_u32(&autosave.body, patch.roster_data_pos),
        ASTRO_LOR_OG_ID,
        "slot 0 must be Astro Lor OG"
    );
    roster.owned.len()
}

fn read_u32(body: &[u8], pos: usize) -> u32 {
    u32::from_le_bytes(body[pos..pos + 4].try_into().expect("4 bytes"))
}

fn write_u32(body: &mut [u8], pos: usize, value: u32) {
    body[pos..pos + 4].copy_from_slice(&value.to_le_bytes());
}

#[test]
fn apply_and_verify_astro_lor_avatar() {
    let work = workspace_root().join("var/save_work");
    // The `.bak` wins: earlier revisions of this test patched the plain file in place, so on a
    // machine that ran them the plain file is no longer the player's original.
    let Some(source) = [work.join(format!("{SLOT}.bak")), work.join(SLOT)]
        .into_iter()
        .find(|path| path.is_file())
    else {
        // A real player save is local state git does not track. Without it there is nothing to
        // check, and the skip is announced — a silent skip would read exactly like a pass.
        eprintln!("skip apply_and_verify_astro_lor_avatar: var/save_work/{SLOT} absent");
        return;
    };

    let original = fs::read(&source).expect("read the source save");
    let mut container = nie_save::parse(&original, SLOT).expect("decrypt the source save");
    assert_eq!(container.slot_name, SLOT);
    let patch = apply_astro_lor(&mut container);

    // The patched save only ever exists inside this directory, which is removed on drop.
    let out_dir = tempfile::tempdir().expect("temporary directory");
    let out = out_dir.path().join(SLOT);
    write_save(&container, &out).expect("re-encrypt and write the patched save");
    let owned = verify(&read_save(&out).expect("re-read the patched save"), &patch);

    assert_eq!(
        fs::read(&source).expect("re-read the source save"),
        original,
        "the source save must not be modified"
    );
    eprintln!(
        "ok: Astro Lor set as avatar (slot 0: 0x{ASTRO_LOR_OG_ID:08X}, slot 12: \
         0x{ASTRO_LOR_VR_ID:08X}, owned: {owned}) in {}",
        out.display()
    );
}

#[test]
#[ignore = "replaces a live save: set NIE_SAVE_LIVE_DEST to its path and pass --ignored"]
fn install_astro_lor_avatar_into_live_save() {
    let dest = std::env::var_os(LIVE_DEST_ENV)
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            panic!("{LIVE_DEST_ENV} must name the live {SLOT} file to patch; nothing was written")
        });
    assert_eq!(
        dest.file_name().and_then(|name| name.to_str()),
        Some(SLOT),
        "{LIVE_DEST_ENV} must point at a file named {SLOT}: the decryption key derives from it"
    );

    // Patch what is installed now, not an older copy: installing a stale snapshot would erase
    // every hour played since it was taken.
    let original = fs::read(&dest).expect("read the live save");
    let mut container = nie_save::parse(&original, SLOT).expect("decrypt the live save");
    let patch = apply_astro_lor(&mut container);
    let patched = container.encrypt().expect("re-encrypt the patched save");
    // Validated in memory before a single byte reaches the destination directory.
    verify(
        &nie_save::parse(&patched, SLOT).expect("decrypt the patched save"),
        &patch,
    );

    // `create_new` makes the backup name unique by construction: a second install can never
    // overwrite the backup of the first.
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock after 1970")
        .as_secs();
    let backup = dest.with_file_name(format!("{SLOT}.bak-{stamp}"));
    fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&backup)
        .and_then(|mut file| file.write_all(&original))
        .expect("back up the live save");

    // Write beside the destination, then rename over it: an interruption leaves either the old
    // save or the new one, never half of each.
    let staging = dest.with_file_name(format!("{SLOT}.nie-staging"));
    fs::write(&staging, &patched).expect("write the staged save");
    fs::rename(&staging, &dest).expect("replace the live save");

    let owned = verify(&read_save(&dest).expect("re-read the live save"), &patch);
    eprintln!(
        "installed: {} (owned: {owned}); previous bytes kept in {}",
        dest.display(),
        backup.display()
    );
}
