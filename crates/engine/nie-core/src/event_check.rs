//! Détection d'événements de match — port byte-exact (en cours) de `game::CSoccerEventCheckComponent`.
//!
//! Le composant event-check est la brique qui transforme les déclencheurs physiques (ballon→filet
//! via [`crate::ball`] `BallMoveGoalnet`, etc.) en **événements de match catégorisés** (but, hors-jeu…),
//! ensuite dispatchés vers les handlers de score/scène. Sa boucle d'update est `vmethod_10`
//! (`0x141404340`, state-machine à 7 cas) qui marche une table d'entrées d'événement (stride `0x570`)
//! et, pour chaque entrée, **classe son octet de flags** via le helper `0x141453350`, puis dispatche.
//!
//! ## Ce qui est porté + VALIDÉ
//!
//! [`classify_event_flags`] = le classifieur flags→catégorie du helper `0x141453350` (bloc `+0x71..+0x9c`),
//! transcrit du désassemblage et **validé 256/256 byte-exact contre l'oracle uemu** (`scripts/uemu.py`,
//! émulation du fragment `0x1414533C1`→`0x1414533EC` sur les 256 valeurs d'entrée, 2026-06-21).
//!
//! ## Ce qui RESTE (multi-session, oracle-gated)
//!
//! La sémantique des catégories (quel handler chaque 0-5 cible) + la boucle d'update `vmethod_10` +
//! le calcul de détection de but lui-même restent à reverser depuis la boucle ECS
//! (`CSceneSoccer::update 0x1412C3BB0` → process composants). Anchors : mémoire `c3-modele-but-anchors`.

/// Classe un octet de flags d'événement de match en **catégorie de dispatch** `0..=5`.
///
/// Port **byte-exact** du classifieur du helper `0x141453350` de `nie_eacpatched.exe`
/// (binaire courant), bloc `+0x71..+0x9c` :
///
/// ```text
///   test dl,2  ; je → 0
///   test dl,4  ; je → 1
///   test dl,10h; je → 2
///   test dl,40h; je → 3
///   test dl,dl ; setns al ; add al,4   ; → bit 0x80 set ? 4 : 5
/// ```
///
/// La priorité est stricte (premier bit positionné parmi `0x02,0x04,0x10,0x40` gagne ; sinon
/// le bit de signe `0x80` départage 4 vs 5). **Validé 256/256 contre l'oracle uemu** (2026-06-21).
#[must_use]
pub fn classify_event_flags(flags: u8) -> u8 {
    if flags & 0x02 != 0 {
        0
    } else if flags & 0x04 != 0 {
        1
    } else if flags & 0x10 != 0 {
        2
    } else if flags & 0x40 != 0 {
        3
    } else if flags & 0x80 != 0 {
        4
    } else {
        5
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Vecteurs capturés depuis l'oracle uemu (émulation directe du binaire courant, 2026-06-21).
    /// Toute régression ici signale une divergence vs le jeu réel.
    #[test]
    fn classify_event_flags_oracle_vectors() {
        // Bits individuels (priorité stricte).
        assert_eq!(classify_event_flags(0x02), 0);
        assert_eq!(classify_event_flags(0x04), 1);
        assert_eq!(classify_event_flags(0x10), 2);
        assert_eq!(classify_event_flags(0x40), 3);
        // Aucun bit prioritaire → départage par le bit de signe 0x80.
        assert_eq!(classify_event_flags(0x80), 4);
        assert_eq!(classify_event_flags(0x00), 5);
        assert_eq!(classify_event_flags(0x01), 5); // bit non prioritaire, 0x80 absent
        // Priorité : 0x06 = bits 0x02+0x04 → 0x02 gagne.
        assert_eq!(classify_event_flags(0x06), 0);
        // 0x50 = 0x10+0x40 → 0x10 gagne.
        assert_eq!(classify_event_flags(0x50), 2);
        // 0xC0 = 0x40+0x80 → 0x40 gagne (prioritaire sur le départage de signe).
        assert_eq!(classify_event_flags(0xC0), 3);
    }
}
