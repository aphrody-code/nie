//! Identifiants hash 32 bits Level-5.
//!
//! Les dumps `cfg.bin.json` stockent les hash de deux façons :
//! - en chaîne hex non signée : `"0x63BDA8A4"` (champs `skillID`, `partner1`, …) ;
//! - en entier décimal **signé** : `"604761586"` ou `"-357386801"` (variables CfgBin brutes).
//!
//! Côté TS, `inagle` convertit systématiquement par `n >>> 0` (cast en u32 non signé) avant
//! comparaison/clé de map. On reproduit cette sémantique exacte ici : un `i32` lu depuis le
//! dump devient un `u32` par réinterprétation des bits (pas par saturation).
//!
//! Source de vérité : `packages/inagle/src/skills/mapper.ts` (`toUnsigned = n >>> 0`),
//! `packages/inagle/src/skills/mapper-aura.ts` (`toHex`), `parsers/chara-param.ts` (`toHex`).

use alloc::string::String;
use core::fmt;

/// Identifiant hash 32 bits non signé (équivalent du `>>> 0` de JS).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(transparent))]
pub struct HashId(pub u32);

impl HashId {
    /// Hash nul (`0x00000000`) — sentinelle « pas de valeur » dans les dumps.
    pub const ZERO: HashId = HashId(0);

    /// Construit depuis un `i32` signé lu dans le dump (réinterprétation des bits, = `>>> 0`).
    #[inline]
    #[must_use]
    pub const fn from_signed(v: i32) -> Self {
        HashId(v as u32)
    }

    /// Construit depuis un `i64` (les `serde_json::Number` décimaux arrivent en i64).
    /// On garde les 32 bits de poids faible, exactement comme `>>> 0` en JS.
    #[inline]
    #[must_use]
    pub const fn from_i64(v: i64) -> Self {
        HashId(v as u32)
    }

    /// `true` si le hash est nul.
    #[inline]
    #[must_use]
    pub const fn is_zero(self) -> bool {
        self.0 == 0
    }

    /// Parse une représentation textuelle : soit `"0x..."` (hex non signé), soit un entier
    /// décimal signé (`"-357386801"`). Renvoie `None` si non parsable.
    #[must_use]
    pub fn parse(s: &str) -> Option<Self> {
        let t = s.trim();
        if let Some(hex) = t.strip_prefix("0x").or_else(|| t.strip_prefix("0X")) {
            u32::from_str_radix(hex, 16).ok().map(HashId)
        } else if let Ok(v) = t.parse::<i64>() {
            Some(HashId::from_i64(v))
        } else {
            None
        }
    }

    /// Parse une représentation **hexadécimale nue**, préfixe `0x`/`0X` optionnel et casse libre
    /// (`"CB189152"`, `"0xcb189152"`). Refuse tout ce qui n'est pas hexadécimal et tout ce qui
    /// dépasse 8 chiffres.
    ///
    /// Distinct de [`HashId::parse`], qui lit d'abord un décimal **signé** : `"1654568798"` y est
    /// un entier, ici ce serait un hex invalide (`5`, `4`, `6`… sont hex, mais `"nope"` non).
    /// Parité avec `Level5Hash.TryParseHex` de IECODE.
    #[must_use]
    pub fn parse_hex(s: &str) -> Option<Self> {
        let t = s.trim();
        let hex = t
            .strip_prefix("0x")
            .or_else(|| t.strip_prefix("0X"))
            .unwrap_or(t);
        if hex.is_empty() || hex.len() > 8 {
            return None;
        }
        u32::from_str_radix(hex, 16).ok().map(HashId)
    }

    /// Sérialise en `0xXXXXXXXX` (hex majuscule, 8 chiffres, padding zéro) — format `toHex` inagle.
    #[must_use]
    pub fn to_hex(self) -> String {
        alloc::format!("{self}")
    }

    /// Sérialise en `XXXXXXXX` **sans** préfixe `0x` — parité avec le `ToString("X8")` de
    /// `Level5Hash.ToHex` de IECODE, qui est le format des tables de hash Level-5.
    #[must_use]
    pub fn to_hex_x8(self) -> String {
        alloc::format!("{:08X}", self.0)
    }

    /// Valeur u32 brute.
    #[inline]
    #[must_use]
    pub const fn get(self) -> u32 {
        self.0
    }
}

impl fmt::Display for HashId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // `0x` + 8 hexa majuscules zéro-padés, identique à inagle (toHex).
        write!(f, "0x{:08X}", self.0)
    }
}

impl From<i32> for HashId {
    fn from(v: i32) -> Self {
        HashId::from_signed(v)
    }
}

impl From<u32> for HashId {
    fn from(v: u32) -> Self {
        HashId(v)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signe_vers_non_signe_comme_js() {
        // -357386801 >>> 0 === 3937580495 === 0xEAB2B5CF (var0 de CHARA_PARAM_INFO_1, dump réel).
        // Source : /home/ubuntu/niers/data/common/gamedata/character/chara_param_1.03.66.00.cfg.bin.json
        assert_eq!(HashId::from_signed(-357386801).get(), 3_937_580_495);
        assert_eq!(HashId::from_signed(-357386801).to_hex(), "0xEAB2B5CF");
    }

    #[test]
    fn format_hex_pad_8() {
        // skillID whs00010 = 0x63BDA8A4 (skill_config_4.00.17.00, première valeur de m_skillInfoList).
        assert_eq!(HashId(0x63BD_A8A4).to_hex(), "0x63BDA8A4");
        // partner1 whs00010 = 0xAB97A3D2.
        assert_eq!(HashId(0xAB97_A3D2).to_hex(), "0xAB97A3D2");
        // padding sur petites valeurs.
        assert_eq!(HashId(1).to_hex(), "0x00000001");
    }

    #[test]
    fn parse_hex_et_decimal() {
        assert_eq!(HashId::parse("0x63BDA8A4"), Some(HashId(0x63BD_A8A4)));
        assert_eq!(HashId::parse("0x07ADF4B1"), Some(HashId(0x07AD_F4B1)));
        // décimal signé → réinterprétation bits.
        assert_eq!(HashId::parse("-357386801"), Some(HashId(0xEAB2_B5CF)));
        assert_eq!(HashId::parse("604761586"), Some(HashId(604_761_586)));
        assert_eq!(HashId::parse("nope"), None);
    }

    #[test]
    fn parse_hex_accepte_le_prefixe_optionnel_et_la_casse() {
        // Les trois formes du même hash de table Level-5 (CMD_TAG_PAD_LIST_BEG).
        let attendu = Some(HashId(0xCB18_9152));
        assert_eq!(HashId::parse_hex("0xCB189152"), attendu);
        assert_eq!(HashId::parse_hex("CB189152"), attendu);
        assert_eq!(
            HashId::parse_hex("0xcb189152"),
            attendu,
            "préfixe insensible à la casse"
        );
        assert_eq!(HashId::parse_hex("  CB189152  "), attendu, "trim");
    }

    #[test]
    fn parse_hex_refuse_le_non_hexadecimal() {
        assert_eq!(HashId::parse_hex("ZZZZ"), None);
        assert_eq!(HashId::parse_hex(""), None);
        assert_eq!(HashId::parse_hex("0x"), None);
        assert_eq!(
            HashId::parse_hex("CB1891520"),
            None,
            "9 chiffres : hors u32"
        );
        // Contraste avec `parse`, qui lui accepte le décimal signé.
        assert_eq!(HashId::parse_hex("-357386801"), None);
        assert!(HashId::parse("-357386801").is_some());
    }

    #[test]
    fn to_hex_x8_est_sans_prefixe() {
        assert_eq!(HashId(0xCB18_9152).to_hex_x8(), "CB189152");
        assert_eq!(HashId::ZERO.to_hex_x8(), "00000000");
        assert_eq!(HashId(u32::MAX).to_hex_x8(), "FFFFFFFF");
        // `to_hex` garde le préfixe : les deux formats coexistent sans se marcher dessus.
        assert_eq!(HashId(0xCB18_9152).to_hex(), "0xCB189152");
    }
}
