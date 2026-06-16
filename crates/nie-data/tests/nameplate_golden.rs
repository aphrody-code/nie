#![allow(clippy::pedantic)]
//! Tests golden `nameplate` — nœud réel extrait du VFS IEVR :
//! `data/common/gamedata/user_name_plate/user_name_plate_config_1.03.50.00.cfg.bin`
//! (RDBN `lists`, 1 liste `m_userNamePlateInfoList` / `typeName` `USER_NAME_PLATE_INFO`,
//! **54 entrées**).
//!
//! Port 1:1 d'inagle `packages/inagle/src/parsers/nameplate-config.ts`. Les valeurs ci-dessous
//! sont extraites telles quelles du dump (via `nie_formats::cfgbin::read_values` →
//! `nie-game --example probe_rdbn user_name_plate_config`), aucune inventée.

use nie_data::hash::HashId;
use nie_data::nameplate::{find_by_id, parse_nameplate_config};
use serde_json::{json, Value};

/// 2 premières entrées réelles de `m_userNamePlateInfoList` (index 0..1 du dump).
fn nameplates_head() -> Vec<Value> {
    vec![
        json!({
            "userNamePlateId": "0x0976673C", "userNamePlateNameId": "0x011D2282",
            "sortNo": 1,
            "textureFileNameText": "#/menu/200_icon/25_icon_nameplate/nm00001.g4tx",
            "textureFileNameCrc": "0xAF3937FF", "mainTextureNameCrc": "0xA892B3C2",
            "shadowTextureNameCrc": "0x319BE278", "nameFontStyle": "0x66A0930A",
            "flagIndex": 0, "enableCond": "0xFFFFFFFF"
        }),
        json!({
            "userNamePlateId": "0x907F3686", "userNamePlateNameId": "0x98147338",
            "sortNo": 2,
            "textureFileNameText": "#/menu/200_icon/25_icon_nameplate/nm00002.g4tx",
            "textureFileNameCrc": "0x29AD4551", "mainTextureNameCrc": "0xBA271C2C",
            "shadowTextureNameCrc": "0x232E4D96", "nameFontStyle": "0x66A0930A",
            "flagIndex": 1, "enableCond": "AAAAABgFNRftNPcACgEoAAYCNJB/NoYyAAAAAXg="
        }),
    ]
}

fn fixture() -> Value {
    json!({
        "version": 100,
        "lists": [{
            "name": "m_userNamePlateInfoList",
            "typeName": "USER_NAME_PLATE_INFO",
            "values": nameplates_head()
        }]
    })
}

#[test]
fn parses_real_nameplate_head() {
    let plates = parse_nameplate_config(&fixture());
    assert_eq!(plates.len(), 2, "2 entrées dans la fixture");

    let p0 = &plates[0];
    assert_eq!(p0.user_name_plate_id, HashId(0x0976_673C));
    assert_eq!(p0.user_name_plate_name_id, HashId(0x011D_2282));
    assert_eq!(p0.sort_no, 1);
    assert_eq!(p0.texture_file_name_text, "#/menu/200_icon/25_icon_nameplate/nm00001.g4tx");
    assert_eq!(p0.texture_file_name_crc, HashId(0xAF39_37FF));
    assert_eq!(p0.main_texture_name_crc, HashId(0xA892_B3C2));
    assert_eq!(p0.shadow_texture_name_crc, HashId(0x319B_E278));
    assert_eq!(p0.name_font_style, HashId(0x66A0_930A));
    assert_eq!(p0.flag_index, 0);
    assert_eq!(p0.enable_cond, "0xFFFFFFFF");
    // Plaque par défaut : débloquée sans condition.
    assert!(p0.is_unconditional());

    let p1 = &plates[1];
    assert_eq!(p1.user_name_plate_id, HashId(0x907F_3686));
    assert_eq!(p1.sort_no, 2);
    assert_eq!(p1.flag_index, 1);
    // Condition de déblocage réelle (blob base64) → PAS inconditionnelle.
    assert_eq!(p1.enable_cond, "AAAAABgFNRftNPcACgEoAAYCNJB/NoYyAAAAAXg=");
    assert!(!p1.is_unconditional());
}

#[test]
fn find_by_id_locates_plate() {
    let plates = parse_nameplate_config(&fixture());
    let found = find_by_id(&plates, HashId(0x907F_3686)).expect("plaque présente");
    assert_eq!(found.sort_no, 2);
    assert!(find_by_id(&plates, HashId(0xDEAD_BEEF)).is_none());
}
