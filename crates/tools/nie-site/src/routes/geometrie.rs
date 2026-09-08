//! Les neuf familles **géométriques** du jeu, décodées en process — lot 9.1 du plan.
//!
//! ## Pourquoi elles étaient `manquant` ou `partiel`, et ce qui change
//!
//! `docs/VFS.md` en comptait **83 753, soit 32,8 % du VFS** : 67 878 `manquant` (« le décodeur
//! existe déjà ici, aucune route ne l'appelle ») et 15 875 `.g4mg` `partiel` (servis seulement
//! pour les codes que l'amont sait assembler). La mesure du 2026-09-06 (`awk` sur
//! `var/vfs/inventaire.txt`, 255 308 lignes) les compte fichier par fichier :
//!
//! | Suffixe | Fichiers | Plus gros | Total |
//! |---|---:|---:|---:|
//! | `.g4pk` | 45 591 | 12 316 032 o | 2 549 547 328 o |
//! | `.g4mg` | 15 875 | 12 296 576 o | — |
//! | `.objbin` | 12 190 | 15 024 o | 20 942 080 o |
//! | `.g4pkm` | 6 992 | 707 232 o | 169 979 872 o |
//! | `.g4cm` | 1 217 | 129 664 o | 8 910 272 o |
//! | `.col` | 1 150 | 1 043 532 o | 15 924 452 o |
//! | `.g4sk` | 339 | 158 708 o | 1 661 568 o |
//! | `.mevbin` | 328 | 22 448 o | 1 044 032 o |
//! | `.g4mt` | 71 | 1 765 056 o | 8 206 080 o |
//!
//! **Aucune dépendance nouvelle n'a été nécessaire.** Les neuf parseurs de `nie-formats` sont
//! derrière `#[cfg(feature = "std")]`, et `std` est une feature **par défaut** — le site les
//! liait déjà sans les appeler. C'est la définition même du câblage : le décodeur était là, la
//! route manquait. Seule la feature `serde` a été ajoutée, pour que `?forme=complet` rende la
//! structure décodée au lieu d'un `Debug` — un JSON public ne se sérialise pas par `Debug`.
//!
//! ## Décoder un fichier n'est pas assembler un modèle
//!
//! `.g4mg` est servi ici **et** par `/api/v1/3d`, et ce n'est pas un doublon : la 3D catalogue
//! des **entités assemblables** (`<code>/<code>.g4mg` plus la recette de l'amont, 7 466 codes
//! sur 7 679), quand cette route décode un **fichier**, quel qu'il soit — y compris les
//! maillages de décor, d'effet et de menu que l'amont ne sait pas assembler en GLB. C'est ce
//! qui fait tomber `partiel` à zéro sans rien promettre de faux : un décor décodé n'est pas un
//! personnage jouable, et les deux routes ne disent pas la même chose.
//!
//! ## Ce que chaque famille rend, et ce qu'elle ne rend pas
//!
//! Un décodeur qui « réussit » sans rien produire est le pire des résultats : il rassure. Deux
//! familles ne livrent qu'un en-tête, et le résumé le **dit** au lieu de le laisser croire :
//!
//! - `.col` — le conteneur `PXCL` est lu, son intérieur est du PhysX *cooked* que ce dépôt
//!   n'interprète pas. Le résumé porte `interieur_interprete: false`.
//! - `.g4mt` — [`nie_formats::g4mt::parse`] ne lit que l'en-tête ; l'animation vient de
//!   `Motion::parse`, qui rend `None` sur les conteneurs qu'il ne sait pas suivre. Le résumé
//!   porte alors `animation_decodee: false` plutôt qu'un compte de clips à zéro.
//!
//! Et une famille ne se lit **pas seule** : `.g4mg` a besoin de sa description, cf.
//! [`Compagnon`]. Elle est résolue par l'appelant (`super::formats`), là où l'index et le VFS
//! sont disponibles ; le décodeur reste une fonction pure, testable sans HTTP.
//!
//! ## Deux formes, et pourquoi la borne n'est pas la même
//!
//! `?forme=resume` (défaut) rend des **comptes** ; `?forme=complet` rend la structure entière.
//! La seconde est bornée par [`super::formats::TAILLE_MAX`] (4 Mio) parce qu'un JSON dépasse
//! plusieurs fois la taille de sa source et que l'ETag cesse de condenser au-delà de 8 Mio ; la
//! première est bornée par [`TAILLE_MAX_RESUME`] (16 Mio), qui couvre le plus gros `.g4pk` du
//! jeu (12 316 032 o) — un résumé ne grossit pas avec sa source.

use crate::error::ErreurSite;

pub use nie_explore::geometry::{
    Compagnon, CompteType, Conteneur, Decodage, FAMILLES, Famille, Forme, GeometryError, Reference,
    Resume, TAILLE_MAX_RESUME, conteneur_level5, decoder, famille_au_magic,
};

impl From<GeometryError> for ErreurSite {
    fn from(error: GeometryError) -> Self {
        match error {
            GeometryError::InvalidRequest(message) => Self::Demande(message),
            GeometryError::Internal(message) => Self::Interne(message),
        }
    }
}
