//! Compatibility facade for the menu asset layout API.
//!
//! The implementation belongs to `nie_formats::menu`, next to the Level-5 formats it composes.
//! Existing callers can keep using `nie_explore::menu_layout` while migrating to that owner.

pub use nie_formats::menu::{
    MenuAssetIndex, MenuAssetSource, choose_asset_basename, is_locale_tag, resolve_asset_basename,
};
