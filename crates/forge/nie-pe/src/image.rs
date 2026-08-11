//! Parsing et **ré-émission** des en-têtes PE64.
//!
//! Le point critique : [`PeImage::emit_headers`] reconstruit la région d'en-tête
//! **depuis les structures parsées** (pas une recopie du tampon d'origine) et doit
//! rendre exactement les mêmes octets que l'original. C'est le premier maillon
//! « généré par Rust » de la forge, et il est vérifié par test sur le vrai
//! `nie.exe` (`tests/roundtrip_nie_exe.rs`).

use crate::{PeError, Result, rd_u16, rd_u32, rd_u64};

/// Signature `MZ`.
pub const DOS_MAGIC: u16 = 0x5A4D;
/// Signature `PE\0\0`.
pub const PE_SIGNATURE: u32 = 0x0000_4550;
/// Magic de l'en-tête optionnel PE32+.
pub const OPT_MAGIC_PE32PLUS: u16 = 0x020B;
/// Taille d'une entrée de la table des sections.
pub const SECTION_HEADER_SIZE: usize = 40;

/// En-tête COFF (fichier objet / image).
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct CoffHeader {
    /// Machine cible (`0x8664` = x86-64).
    pub machine: u16,
    /// Nombre de sections.
    pub n_sections: u16,
    /// Horodatage de link (secondes Unix).
    pub timestamp: u32,
    /// Offset de la table des symboles (0 dans une image liée).
    pub ptr_symbol_table: u32,
    /// Nombre de symboles (0 dans une image liée).
    pub n_symbols: u32,
    /// Taille de l'en-tête optionnel.
    pub size_optional: u16,
    /// Caractéristiques de l'image.
    pub characteristics: u16,
}

/// Entrée du répertoire de données.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct DataDirectory {
    /// RVA de la table pointée (0 si absente).
    pub rva: u32,
    /// Taille en octets.
    pub size: u32,
}

/// En-tête optionnel PE32+.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct OptionalHeader64 {
    /// Magic (`0x20b`).
    pub magic: u16,
    /// Version majeure du linker.
    pub major_linker: u8,
    /// Version mineure du linker.
    pub minor_linker: u8,
    /// Somme des tailles des sections de code.
    pub size_code: u32,
    /// Somme des tailles des sections de données initialisées.
    pub size_init_data: u32,
    /// Somme des tailles des sections non initialisées.
    pub size_uninit_data: u32,
    /// RVA du point d'entrée.
    pub entry_point: u32,
    /// RVA de la base du code.
    pub base_of_code: u32,
    /// Base de chargement préférée.
    pub image_base: u64,
    /// Alignement des sections en mémoire.
    pub section_alignment: u32,
    /// Alignement des sections dans le fichier.
    pub file_alignment: u32,
    /// Version majeure d'OS requise.
    pub major_os: u16,
    /// Version mineure d'OS requise.
    pub minor_os: u16,
    /// Version majeure de l'image.
    pub major_image: u16,
    /// Version mineure de l'image.
    pub minor_image: u16,
    /// Version majeure du sous-système.
    pub major_subsystem: u16,
    /// Version mineure du sous-système.
    pub minor_subsystem: u16,
    /// Champ réservé (`Win32VersionValue`).
    pub win32_version: u32,
    /// Taille de l'image en mémoire.
    pub size_image: u32,
    /// Taille de la région d'en-tête dans le fichier.
    pub size_headers: u32,
    /// Somme de contrôle (0 pour la plupart des exécutables).
    pub checksum: u32,
    /// Sous-système (2 = GUI Windows).
    pub subsystem: u16,
    /// Caractéristiques DLL (ASLR/DEP/CFG…).
    pub dll_characteristics: u16,
    /// Réserve de pile.
    pub stack_reserve: u64,
    /// Commit de pile.
    pub stack_commit: u64,
    /// Réserve de tas.
    pub heap_reserve: u64,
    /// Commit de tas.
    pub heap_commit: u64,
    /// Drapeaux du loader (obsolète).
    pub loader_flags: u32,
    /// Nombre d'entrées du répertoire de données.
    pub n_rva_and_sizes: u32,
    /// Répertoire de données (`n_rva_and_sizes` entrées).
    pub directories: Vec<DataDirectory>,
    /// Octets résiduels de l'en-tête optionnel au-delà du répertoire de données.
    ///
    /// MSVC n'en produit pas, mais `size_optional` fait autorité : on préserve
    /// tout excédent pour rester byte-exact quel que soit le producteur.
    pub tail: Vec<u8>,
}

/// En-tête de section d'une image.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct SectionHeader {
    /// Nom brut (8 octets, complété de `\0`).
    pub name: [u8; 8],
    /// Taille en mémoire.
    pub virtual_size: u32,
    /// RVA de la section.
    pub virtual_address: u32,
    /// Taille des données dans le fichier.
    pub size_raw: u32,
    /// Offset des données dans le fichier.
    pub ptr_raw: u32,
    /// Offset des relocations (0 dans une image).
    pub ptr_relocations: u32,
    /// Offset des numéros de ligne (0 dans une image).
    pub ptr_line_numbers: u32,
    /// Nombre de relocations (0 dans une image).
    pub n_relocations: u16,
    /// Nombre de numéros de ligne (0 dans une image).
    pub n_line_numbers: u16,
    /// Caractéristiques (lecture/écriture/exécution…).
    pub characteristics: u32,
}

impl SectionHeader {
    /// Nom de section décodé (sans les `\0` de complément).
    #[must_use]
    pub fn name_str(&self) -> String {
        let end = self.name.iter().position(|&c| c == 0).unwrap_or(8);
        String::from_utf8_lossy(&self.name[..end]).into_owned()
    }

    /// Étendue fichier `[ptr_raw, ptr_raw + size_raw)`.
    #[must_use]
    pub fn file_range(&self) -> core::ops::Range<usize> {
        let s = self.ptr_raw as usize;
        s..s + self.size_raw as usize
    }

    /// Vrai si le RVA tombe dans l'étendue virtuelle de la section.
    #[must_use]
    pub fn contains_rva(&self, rva: u32) -> bool {
        rva >= self.virtual_address
            && u64::from(rva)
                < u64::from(self.virtual_address) + u64::from(self.virtual_size.max(self.size_raw))
    }
}

/// Image PE64 parsée, adossée au tampon fichier complet.
#[derive(Debug, Clone)]
pub struct PeImage {
    /// Tampon fichier intégral.
    pub bytes: Vec<u8>,
    /// Octets `[0, e_lfanew)` : en-tête DOS + stub, conservés verbatim.
    pub dos_stub: Vec<u8>,
    /// Offset de la signature `PE\0\0`.
    pub pe_offset: usize,
    /// En-tête COFF.
    pub coff: CoffHeader,
    /// En-tête optionnel.
    pub opt: OptionalHeader64,
    /// Table des sections.
    pub sections: Vec<SectionHeader>,
    /// Bourrage entre la fin de la table des sections et `size_headers`.
    pub header_padding: Vec<u8>,
}

impl PeImage {
    /// Parse une image PE64 complète.
    ///
    /// # Erreurs
    /// Retourne une erreur si les signatures manquent, si l'en-tête optionnel
    /// n'est pas PE32+, ou si le fichier est tronqué.
    pub fn parse(bytes: Vec<u8>) -> Result<Self> {
        let dos_magic = rd_u16(&bytes, 0)?;
        if dos_magic != DOS_MAGIC {
            return Err(PeError::NoDosMagic(dos_magic));
        }
        let pe_offset = rd_u32(&bytes, 0x3c)? as usize;
        if rd_u32(&bytes, pe_offset)? != PE_SIGNATURE {
            return Err(PeError::NoPeSignature(pe_offset));
        }
        let dos_stub = bytes
            .get(..pe_offset)
            .ok_or(PeError::Truncated {
                at: 0,
                need: pe_offset,
                len: bytes.len(),
            })?
            .to_vec();

        let c = pe_offset + 4;
        let coff = CoffHeader {
            machine: rd_u16(&bytes, c)?,
            n_sections: rd_u16(&bytes, c + 2)?,
            timestamp: rd_u32(&bytes, c + 4)?,
            ptr_symbol_table: rd_u32(&bytes, c + 8)?,
            n_symbols: rd_u32(&bytes, c + 12)?,
            size_optional: rd_u16(&bytes, c + 16)?,
            characteristics: rd_u16(&bytes, c + 18)?,
        };

        let o = c + 20;
        let magic = rd_u16(&bytes, o)?;
        if magic != OPT_MAGIC_PE32PLUS {
            return Err(PeError::NotPe32Plus(magic));
        }
        let n_rva_and_sizes = rd_u32(&bytes, o + 108)?;
        let mut directories = Vec::with_capacity(n_rva_and_sizes as usize);
        for i in 0..n_rva_and_sizes as usize {
            let at = o + 112 + i * 8;
            directories.push(DataDirectory {
                rva: rd_u32(&bytes, at)?,
                size: rd_u32(&bytes, at + 4)?,
            });
        }
        let dirs_end = 112 + n_rva_and_sizes as usize * 8;
        let tail = if (coff.size_optional as usize) > dirs_end {
            bytes
                .get(o + dirs_end..o + coff.size_optional as usize)
                .ok_or(PeError::Truncated {
                    at: o + dirs_end,
                    need: coff.size_optional as usize - dirs_end,
                    len: bytes.len(),
                })?
                .to_vec()
        } else {
            Vec::new()
        };

        let opt = OptionalHeader64 {
            magic,
            major_linker: bytes[o + 2],
            minor_linker: bytes[o + 3],
            size_code: rd_u32(&bytes, o + 4)?,
            size_init_data: rd_u32(&bytes, o + 8)?,
            size_uninit_data: rd_u32(&bytes, o + 12)?,
            entry_point: rd_u32(&bytes, o + 16)?,
            base_of_code: rd_u32(&bytes, o + 20)?,
            image_base: rd_u64(&bytes, o + 24)?,
            section_alignment: rd_u32(&bytes, o + 32)?,
            file_alignment: rd_u32(&bytes, o + 36)?,
            major_os: rd_u16(&bytes, o + 40)?,
            minor_os: rd_u16(&bytes, o + 42)?,
            major_image: rd_u16(&bytes, o + 44)?,
            minor_image: rd_u16(&bytes, o + 46)?,
            major_subsystem: rd_u16(&bytes, o + 48)?,
            minor_subsystem: rd_u16(&bytes, o + 50)?,
            win32_version: rd_u32(&bytes, o + 52)?,
            size_image: rd_u32(&bytes, o + 56)?,
            size_headers: rd_u32(&bytes, o + 60)?,
            checksum: rd_u32(&bytes, o + 64)?,
            subsystem: rd_u16(&bytes, o + 68)?,
            dll_characteristics: rd_u16(&bytes, o + 70)?,
            stack_reserve: rd_u64(&bytes, o + 72)?,
            stack_commit: rd_u64(&bytes, o + 80)?,
            heap_reserve: rd_u64(&bytes, o + 88)?,
            heap_commit: rd_u64(&bytes, o + 96)?,
            loader_flags: rd_u32(&bytes, o + 104)?,
            n_rva_and_sizes,
            directories,
            tail,
        };

        let sec_off = o + coff.size_optional as usize;
        let mut sections = Vec::with_capacity(coff.n_sections as usize);
        for i in 0..coff.n_sections as usize {
            let at = sec_off + i * SECTION_HEADER_SIZE;
            let raw = bytes
                .get(at..at + SECTION_HEADER_SIZE)
                .ok_or(PeError::Truncated {
                    at,
                    need: SECTION_HEADER_SIZE,
                    len: bytes.len(),
                })?;
            let mut name = [0u8; 8];
            name.copy_from_slice(&raw[..8]);
            sections.push(SectionHeader {
                name,
                virtual_size: rd_u32(raw, 8)?,
                virtual_address: rd_u32(raw, 12)?,
                size_raw: rd_u32(raw, 16)?,
                ptr_raw: rd_u32(raw, 20)?,
                ptr_relocations: rd_u32(raw, 24)?,
                ptr_line_numbers: rd_u32(raw, 28)?,
                n_relocations: rd_u16(raw, 32)?,
                n_line_numbers: rd_u16(raw, 34)?,
                characteristics: rd_u32(raw, 36)?,
            });
        }

        let table_end = sec_off + sections.len() * SECTION_HEADER_SIZE;
        let headers_end = (opt.size_headers as usize).max(table_end);
        let header_padding = bytes
            .get(table_end..headers_end)
            .ok_or(PeError::Truncated {
                at: table_end,
                need: headers_end - table_end,
                len: bytes.len(),
            })?
            .to_vec();

        Ok(Self {
            bytes,
            dos_stub,
            pe_offset,
            coff,
            opt,
            sections,
            header_padding,
        })
    }

    /// Fin (exclusive) de la région d'en-tête dans le fichier.
    #[must_use]
    pub fn headers_end(&self) -> usize {
        let table_end = self.pe_offset
            + 4
            + 20
            + self.coff.size_optional as usize
            + self.sections.len() * SECTION_HEADER_SIZE;
        table_end + self.header_padding.len()
    }

    /// **Ré-émet** la région d'en-tête `[0, headers_end)` depuis les structures.
    ///
    /// Aucun octet n'est recopié depuis `bytes`, hormis le stub DOS et le bourrage
    /// (données opaques par nature : code 16 bits et remplissage du linker).
    #[must_use]
    pub fn emit_headers(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(self.headers_end());
        out.extend_from_slice(&self.dos_stub);
        out.extend_from_slice(&PE_SIGNATURE.to_le_bytes());

        let c = &self.coff;
        out.extend_from_slice(&c.machine.to_le_bytes());
        out.extend_from_slice(&c.n_sections.to_le_bytes());
        out.extend_from_slice(&c.timestamp.to_le_bytes());
        out.extend_from_slice(&c.ptr_symbol_table.to_le_bytes());
        out.extend_from_slice(&c.n_symbols.to_le_bytes());
        out.extend_from_slice(&c.size_optional.to_le_bytes());
        out.extend_from_slice(&c.characteristics.to_le_bytes());

        let h = &self.opt;
        out.extend_from_slice(&h.magic.to_le_bytes());
        out.push(h.major_linker);
        out.push(h.minor_linker);
        out.extend_from_slice(&h.size_code.to_le_bytes());
        out.extend_from_slice(&h.size_init_data.to_le_bytes());
        out.extend_from_slice(&h.size_uninit_data.to_le_bytes());
        out.extend_from_slice(&h.entry_point.to_le_bytes());
        out.extend_from_slice(&h.base_of_code.to_le_bytes());
        out.extend_from_slice(&h.image_base.to_le_bytes());
        out.extend_from_slice(&h.section_alignment.to_le_bytes());
        out.extend_from_slice(&h.file_alignment.to_le_bytes());
        out.extend_from_slice(&h.major_os.to_le_bytes());
        out.extend_from_slice(&h.minor_os.to_le_bytes());
        out.extend_from_slice(&h.major_image.to_le_bytes());
        out.extend_from_slice(&h.minor_image.to_le_bytes());
        out.extend_from_slice(&h.major_subsystem.to_le_bytes());
        out.extend_from_slice(&h.minor_subsystem.to_le_bytes());
        out.extend_from_slice(&h.win32_version.to_le_bytes());
        out.extend_from_slice(&h.size_image.to_le_bytes());
        out.extend_from_slice(&h.size_headers.to_le_bytes());
        out.extend_from_slice(&h.checksum.to_le_bytes());
        out.extend_from_slice(&h.subsystem.to_le_bytes());
        out.extend_from_slice(&h.dll_characteristics.to_le_bytes());
        out.extend_from_slice(&h.stack_reserve.to_le_bytes());
        out.extend_from_slice(&h.stack_commit.to_le_bytes());
        out.extend_from_slice(&h.heap_reserve.to_le_bytes());
        out.extend_from_slice(&h.heap_commit.to_le_bytes());
        out.extend_from_slice(&h.loader_flags.to_le_bytes());
        out.extend_from_slice(&h.n_rva_and_sizes.to_le_bytes());
        for d in &h.directories {
            out.extend_from_slice(&d.rva.to_le_bytes());
            out.extend_from_slice(&d.size.to_le_bytes());
        }
        out.extend_from_slice(&h.tail);

        for s in &self.sections {
            out.extend_from_slice(&s.name);
            out.extend_from_slice(&s.virtual_size.to_le_bytes());
            out.extend_from_slice(&s.virtual_address.to_le_bytes());
            out.extend_from_slice(&s.size_raw.to_le_bytes());
            out.extend_from_slice(&s.ptr_raw.to_le_bytes());
            out.extend_from_slice(&s.ptr_relocations.to_le_bytes());
            out.extend_from_slice(&s.ptr_line_numbers.to_le_bytes());
            out.extend_from_slice(&s.n_relocations.to_le_bytes());
            out.extend_from_slice(&s.n_line_numbers.to_le_bytes());
            out.extend_from_slice(&s.characteristics.to_le_bytes());
        }
        out.extend_from_slice(&self.header_padding);
        out
    }

    /// Section contenant un RVA.
    #[must_use]
    pub fn section_of_rva(&self, rva: u32) -> Option<&SectionHeader> {
        self.sections.iter().find(|s| s.contains_rva(rva))
    }

    /// Section par nom.
    #[must_use]
    pub fn section(&self, name: &str) -> Option<&SectionHeader> {
        self.sections.iter().find(|s| s.name_str() == name)
    }

    /// Traduit un RVA en offset fichier, si la donnée est présente sur disque.
    #[must_use]
    pub fn rva_to_offset(&self, rva: u32) -> Option<usize> {
        let s = self.section_of_rva(rva)?;
        let delta = rva - s.virtual_address;
        if delta >= s.size_raw {
            return None; // zone `.bss` : présente en mémoire, absente du fichier
        }
        Some(s.ptr_raw as usize + delta as usize)
    }

    /// Traduit une adresse virtuelle absolue en offset fichier.
    #[must_use]
    pub fn va_to_offset(&self, va: u64) -> Option<usize> {
        let rva = va.checked_sub(self.opt.image_base)?;
        self.rva_to_offset(u32::try_from(rva).ok()?)
    }

    /// Tranche fichier correspondant à `[rva, rva+len)`.
    #[must_use]
    pub fn slice_rva(&self, rva: u32, len: usize) -> Option<&[u8]> {
        let off = self.rva_to_offset(rva)?;
        self.bytes.get(off..off + len)
    }

    /// Tranche fichier correspondant à `[va, va+len)`.
    #[must_use]
    pub fn slice_va(&self, va: u64, len: usize) -> Option<&[u8]> {
        let off = self.va_to_offset(va)?;
        self.bytes.get(off..off + len)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Construit une image PE64 minimale mais structurellement valide.
    fn synth() -> Vec<u8> {
        let pe_off = 0x80usize;
        let opt_size = 240usize;
        let n_sec = 1usize;
        let headers = 0x200usize;
        let mut b = vec![0u8; headers + 0x200];
        b[0..2].copy_from_slice(&DOS_MAGIC.to_le_bytes());
        b[0x3c..0x40].copy_from_slice(&u32::try_from(pe_off).unwrap().to_le_bytes());
        b[pe_off..pe_off + 4].copy_from_slice(&PE_SIGNATURE.to_le_bytes());
        let c = pe_off + 4;
        b[c..c + 2].copy_from_slice(&0x8664u16.to_le_bytes());
        b[c + 2..c + 4].copy_from_slice(&u16::try_from(n_sec).unwrap().to_le_bytes());
        b[c + 16..c + 18].copy_from_slice(&u16::try_from(opt_size).unwrap().to_le_bytes());
        let o = c + 20;
        b[o..o + 2].copy_from_slice(&OPT_MAGIC_PE32PLUS.to_le_bytes());
        b[o + 24..o + 32].copy_from_slice(&0x1_4000_0000u64.to_le_bytes());
        b[o + 32..o + 36].copy_from_slice(&0x1000u32.to_le_bytes());
        b[o + 36..o + 40].copy_from_slice(&0x200u32.to_le_bytes());
        b[o + 60..o + 64].copy_from_slice(&u32::try_from(headers).unwrap().to_le_bytes());
        b[o + 108..o + 112].copy_from_slice(&16u32.to_le_bytes());
        let s = o + opt_size;
        b[s..s + 5].copy_from_slice(b".text");
        b[s + 8..s + 12].copy_from_slice(&0x180u32.to_le_bytes()); // virtual_size
        b[s + 12..s + 16].copy_from_slice(&0x1000u32.to_le_bytes()); // virtual_address
        b[s + 16..s + 20].copy_from_slice(&0x200u32.to_le_bytes()); // size_raw
        b[s + 20..s + 24].copy_from_slice(&u32::try_from(headers).unwrap().to_le_bytes());
        // charge utile reconnaissable
        b[headers..headers + 4].copy_from_slice(&[0xCC, 0xC3, 0x90, 0x90]);
        b
    }

    #[test]
    fn parse_puis_reemet_les_entetes_a_l_identique() {
        let raw = synth();
        let img = PeImage::parse(raw.clone()).expect("parse");
        assert_eq!(img.sections.len(), 1);
        assert_eq!(img.sections[0].name_str(), ".text");
        let emitted = img.emit_headers();
        assert_eq!(emitted.len(), img.headers_end());
        assert_eq!(&emitted[..], &raw[..img.headers_end()]);
    }

    #[test]
    fn traduction_rva_et_va() {
        let img = PeImage::parse(synth()).expect("parse");
        assert_eq!(img.rva_to_offset(0x1000), Some(0x200));
        assert_eq!(img.va_to_offset(0x1_4000_1000), Some(0x200));
        assert_eq!(img.slice_va(0x1_4000_1000, 2), Some(&[0xCCu8, 0xC3][..]));
        // hors section
        assert_eq!(img.rva_to_offset(0x9000), None);
    }

    #[test]
    fn refuse_les_signatures_invalides() {
        let mut raw = synth();
        raw[0] = 0;
        assert!(matches!(
            PeImage::parse(raw).unwrap_err(),
            PeError::NoDosMagic(_)
        ));
    }
}

/// Ré-émission des **tables structurées** du binaire.
///
/// Certaines sections ne sont pas des données opaques mais des tableaux dont le
/// format est entièrement connu : `.pdata` (voir [`crate::pdata::emit`]) et
/// `.reloc`. Les reconstruire depuis leurs entrées est de même nature que la
/// ré-émission des en-têtes — la structure est comprise, pas recopiée en bloc.
pub mod tables {
    use super::PeImage;
    use alloc_shim::Vec;
    mod alloc_shim {
        pub use std::vec::Vec;
    }

    /// Ré-émet la section `.reloc` depuis ses blocs de relocation.
    ///
    /// Chaque bloc : `page_rva: u32`, `block_size: u32`, puis
    /// `(block_size - 8) / 2` entrées de 16 bits (`type:4 | offset:12`).
    ///
    /// Retourne `None` si la section est absente, si un bloc est incohérent, ou
    /// si le bourrage de fin n'est pas nul — mieux vaut retomber sur la
    /// référence que supposer.
    #[must_use]
    pub fn emit_reloc(img: &PeImage) -> Option<Vec<u8>> {
        let sec = img.section(".reloc")?;
        let dir = img.opt.directories.get(5).copied()?;
        if dir.rva != sec.virtual_address {
            return None;
        }
        let table = img.slice_rva(dir.rva, dir.size as usize)?;
        let raw = sec.size_raw as usize;

        let mut out = Vec::with_capacity(raw);
        let mut pos = 0usize;
        while pos + 8 <= table.len() {
            let page =
                u32::from_le_bytes([table[pos], table[pos + 1], table[pos + 2], table[pos + 3]]);
            let size = u32::from_le_bytes([
                table[pos + 4],
                table[pos + 5],
                table[pos + 6],
                table[pos + 7],
            ]) as usize;
            if size < 8 || pos + size > table.len() || !size.is_multiple_of(2) {
                return None;
            }
            out.extend_from_slice(&page.to_le_bytes());
            out.extend_from_slice(&(size as u32).to_le_bytes());
            for e in table[pos + 8..pos + size].chunks_exact(2) {
                let v = u16::from_le_bytes([e[0], e[1]]);
                out.extend_from_slice(&v.to_le_bytes());
            }
            pos += size;
        }
        if pos != table.len() || out.len() > raw {
            return None;
        }
        let tail = sec.ptr_raw as usize + out.len();
        if img
            .bytes
            .get(tail..sec.ptr_raw as usize + raw)?
            .iter()
            .any(|b| *b != 0)
        {
            return None;
        }
        out.resize(raw, 0);
        Some(out)
    }

    /// Charge utile régénérée d'une section de table, si elle en est une.
    #[must_use]
    pub fn emit_for(img: &PeImage, section: &str) -> Option<Vec<u8>> {
        match section {
            ".pdata" => crate::pdata::emit(img),
            ".reloc" => emit_reloc(img),
            _ => None,
        }
    }
}
