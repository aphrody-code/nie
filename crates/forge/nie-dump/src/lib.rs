//! Windows minidump reader for `nie.exe`.
//!
//! The generic reader (modules, memory regions, reads by virtual address, AOB scans, MSVC RTTI
//! names, vtable census) lives in `aphrody-os` as `aphrody_re::minidump` since 2026-09-26; this
//! crate re-exports it unchanged and only adds what is specific to the game: its PE image base
//! and the [`NieStatic`] translation of a hit to a static `nie.exe` address.
//!
//! Kept as a separate crate from `nie-re` (which re-exports it as `nie_re::dump`) because it is
//! the only part of the RE engine `inacord` can link: it pulls neither `rusqlite` (through
//! `nie-index`) nor the rest of the RE stack.
#![forbid(unsafe_code)]
#![warn(missing_docs)]

pub use aphrody_os_re::minidump::*;

/// Static image base of `nie.exe` (PE `ImageBase`), to translate an RVA into an r2 address.
pub const NIE_IMAGE_BASE: u64 = 0x1_4000_0000;

/// File name of the game module inside a dump.
pub const NIE_MODULE: &str = "nie.exe";

/// Translation of a scan [`Hit`] to a static `nie.exe` address.
pub trait NieStatic {
    /// Static r2 address when the hit lies in `nie.exe` (`NIE_IMAGE_BASE + rva`).
    fn nie_static(&self) -> Option<u64>;
}

impl NieStatic for Hit {
    fn nie_static(&self) -> Option<u64> {
        self.static_address(NIE_MODULE, NIE_IMAGE_BASE)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nie_static_address() {
        let h = Hit {
            va: 0,
            module: Some("nie.exe".to_string()),
            rva: Some(0xD7_2145),
        };
        assert_eq!(h.nie_static(), Some(0x1_40D7_2145));
        let other = Hit {
            va: 0,
            module: Some("steam_api64.dll".to_string()),
            rva: Some(1),
        };
        assert_eq!(other.nie_static(), None);
    }

    #[test]
    fn reexports_the_generic_pattern_parser() {
        let p = Pattern::parse("44 8B ?? 10").unwrap();
        assert_eq!(p.mask, vec![true, true, false, true]);
    }
}
