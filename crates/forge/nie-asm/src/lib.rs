//! `nie-asm` — encodeur x86-64 **dialecte MSVC**, pur Rust.
//!
//! ## Pourquoi ce crate existe
//!
//! `nie.exe` est produit par MSVC 14.44. Deux compilateurs qui émettent la même
//! instruction ne choisissent pas le même encodage : `mov rax, rcx` s'écrit
//! `48 8b c1` chez MSVC (opcode `8B`, direction registre←r/m) et `48 89 c8` chez
//! LLVM (opcode `89`). Attendre de `rustc` qu'il reproduise les octets de MSVC
//! est donc structurellement vain — et c'était le plafond invisible du projet.
//!
//! La forge contourne ce plafond en **assemblant elle-même** : le dépôt commite
//! une source symbolique (`mov eax, 0xefec8a0d` / `ret`), et ce crate la traduit
//! en octets selon les conventions d'encodage de MSVC. Le binaire n'est plus
//! recopié : il est **produit**, depuis une source lisible et modifiable.
//!
//! ## Falsifiabilité
//!
//! L'encodeur ne « colle » pas aux octets d'origine : il applique des règles
//! canoniques. Si MSVC a choisi un autre encodage pour une instruction donnée, le
//! résultat **diffère** et la forge refuse l'unité (elle reste recopiée). Aucun
//! faux positif possible : la comparaison est byte-à-byte contre le binaire réel.
//!
//! ```
//! use nie_asm::{Insn, Reg, encode};
//! // mov al, 1 ; ret  — les gestionnaires « return true » de nie.exe
//! assert_eq!(encode(&[Insn::MovRegImm8(Reg::Rax, 1), Insn::Ret]), vec![0xb0, 0x01, 0xc3]);
//! ```
#![forbid(unsafe_code)]
#![warn(missing_docs)]
#![no_std]

extern crate alloc;

pub mod text;

use alloc::vec::Vec;
pub use text::{ParseError, parse_insn, parse_line, to_line};

/// Registre général 64 bits (les formes 8/32 bits partagent l'encodage).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[allow(missing_docs)]
pub enum Reg {
    Rax,
    Rcx,
    Rdx,
    Rbx,
    Rsp,
    Rbp,
    Rsi,
    Rdi,
    R8,
    R9,
    R10,
    R11,
    R12,
    R13,
    R14,
    R15,
}

impl Reg {
    /// Numéro d'encodage 0..15.
    #[must_use]
    pub fn num(self) -> u8 {
        self as u8
    }

    /// Bit haut (bit 3), porté par REX.
    #[must_use]
    pub fn hi(self) -> u8 {
        self.num() >> 3
    }

    /// 3 bits bas, portés par ModRM/SIB.
    #[must_use]
    pub fn lo(self) -> u8 {
        self.num() & 7
    }

    /// Nom Intel 64 bits.
    #[must_use]
    pub fn name64(self) -> &'static str {
        const N: [&str; 16] = [
            "rax", "rcx", "rdx", "rbx", "rsp", "rbp", "rsi", "rdi", "r8", "r9", "r10", "r11",
            "r12", "r13", "r14", "r15",
        ];
        N[self.num() as usize]
    }
}

/// Opérande mémoire `[base + index*scale + disp]`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct Mem {
    /// Registre de base.
    pub base: Option<Reg>,
    /// Registre d'index et facteur d'échelle (1, 2, 4 ou 8).
    pub index: Option<(Reg, u8)>,
    /// Déplacement signé.
    pub disp: i32,
}

impl Mem {
    /// `[base]`.
    #[must_use]
    pub fn base(base: Reg) -> Self {
        Self {
            base: Some(base),
            index: None,
            disp: 0,
        }
    }

    /// `[base + disp]`.
    #[must_use]
    pub fn base_disp(base: Reg, disp: i32) -> Self {
        Self {
            base: Some(base),
            index: None,
            disp,
        }
    }
}

/// Instruction supportée par l'encodeur.
///
/// Le jeu est volontairement restreint aux formes réellement présentes dans les
/// corps de `nie.exe` déjà conquis : chaque ajout doit être justifié par des
/// unités réelles qu'il fait basculer, et validé contre leurs octets.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[allow(missing_docs)]
pub enum Insn {
    /// `ret`
    Ret,
    /// `ret imm16`
    RetImm(u16),
    /// `mov r8, imm8` (opcode `B0+rb`)
    MovRegImm8(Reg, u8),
    /// `mov r32, imm32` (opcode `B8+rd`)
    MovRegImm32(Reg, u32),
    /// `xor r32, r32` — MSVC encode `33 /r`
    XorReg32(Reg, Reg),
    /// `xor r8, r8` — MSVC encode `32 /r`
    XorReg8(Reg, Reg),
    /// `mov r64, r64` — MSVC encode `48 8B /r`
    MovReg64(Reg, Reg),
    /// `mov r32, r32` — MSVC encode `8B /r`
    MovReg32(Reg, Reg),
    /// `or r64, r64` — MSVC encode `48 0B /r`
    OrReg64(Reg, Reg),
    /// `mov [mem], r64` (`48 89 /r`)
    Store64(Mem, Reg),
    /// `mov [mem], r32` (`89 /r`)
    Store32(Mem, Reg),
    /// `mov r64, [mem]` (`48 8B /r`)
    Load64(Reg, Mem),
    /// `mov r32, [mem]` (`8B /r`)
    Load32(Reg, Mem),
    /// `lea r64, [mem]` (`48 8D /r`)
    Lea64(Reg, Mem),
    /// `inc dword [mem]` (`FF /0`)
    IncMem32(Mem),
    /// `and r64, imm8` étendu en signe (`48 83 /4 ib`)
    AndRegImm8(Reg, i8),
    /// `shl r64, imm8` (`48 C1 /4 ib`)
    ShlRegImm8(Reg, u8),
    /// `jmp r64` (`FF /4`)
    JmpReg(Reg),
    /// `nop` multi-octets de longueur `n` (1..=15), forme canonique MSVC.
    Nop(u8),
}

/// Encode une suite d'instructions.
#[must_use]
pub fn encode(insns: &[Insn]) -> Vec<u8> {
    let mut out = Vec::new();
    for i in insns {
        encode_one(*i, &mut out);
    }
    out
}

/// Préfixe REX si nécessaire (`w`, `r`, `x`, `b`).
fn rex(out: &mut Vec<u8>, w: bool, r: u8, x: u8, b: u8) {
    let v = 0x40 | (u8::from(w) << 3) | ((r & 1) << 2) | ((x & 1) << 1) | (b & 1);
    if v != 0x40 {
        out.push(v);
    }
}

/// Émet ModRM (+ SIB + déplacement) pour un opérande mémoire.
fn modrm_mem(out: &mut Vec<u8>, reg: u8, m: Mem) {
    let base = m.base;
    let need_sib = m.index.is_some() || base.is_some_and(|b| b.lo() == 4);
    // rbp/r13 en mod=00 signifierait « rip-relative » : forcer un disp8 nul.
    let force_disp8 = base.is_some_and(|b| b.lo() == 5) && m.disp == 0;
    let mode = if base.is_none() || (m.disp == 0 && !force_disp8) {
        0b00
    } else if i8::try_from(m.disp).is_ok() {
        0b01
    } else {
        0b10
    };
    let rm = if need_sib {
        4
    } else {
        base.map_or(4, Reg::lo)
    };
    out.push((mode << 6) | ((reg & 7) << 3) | rm);
    if need_sib {
        let (idx, scale) = m.index.map_or((4, 0u8), |(r, s)| {
            (
                r.lo(),
                match s {
                    2 => 1,
                    4 => 2,
                    8 => 3,
                    _ => 0,
                },
            )
        });
        out.push((scale << 6) | (idx << 3) | base.map_or(5, Reg::lo));
    }
    match mode {
        0b01 => out.push(m.disp as u8),
        0b10 => out.extend_from_slice(&m.disp.to_le_bytes()),
        _ if base.is_none() => out.extend_from_slice(&m.disp.to_le_bytes()),
        _ => {}
    }
}

/// Émet une instruction registre←mémoire ou mémoire←registre.
fn mem_form(out: &mut Vec<u8>, w: bool, opcode: u8, reg: Reg, m: Mem) {
    let x = m.index.map_or(0, |(r, _)| r.hi());
    rex(out, w, reg.hi(), x, m.base.map_or(0, Reg::hi));
    out.push(opcode);
    modrm_mem(out, reg.lo(), m);
}

/// Émet une instruction registre↔registre (`mod=11`).
fn reg_form(out: &mut Vec<u8>, w: bool, opcode: u8, reg: Reg, rm: Reg) {
    rex(out, w, reg.hi(), 0, rm.hi());
    out.push(opcode);
    out.push(0xC0 | (reg.lo() << 3) | rm.lo());
}

fn encode_one(i: Insn, out: &mut Vec<u8>) {
    match i {
        Insn::Ret => out.push(0xC3),
        Insn::RetImm(n) => {
            out.push(0xC2);
            out.extend_from_slice(&n.to_le_bytes());
        }
        Insn::MovRegImm8(r, imm) => {
            rex(out, false, 0, 0, r.hi());
            out.push(0xB0 + r.lo());
            out.push(imm);
        }
        Insn::MovRegImm32(r, imm) => {
            rex(out, false, 0, 0, r.hi());
            out.push(0xB8 + r.lo());
            out.extend_from_slice(&imm.to_le_bytes());
        }
        Insn::XorReg32(a, b) => reg_form(out, false, 0x33, a, b),
        Insn::XorReg8(a, b) => reg_form(out, false, 0x32, a, b),
        Insn::MovReg64(dst, src) => reg_form(out, true, 0x8B, dst, src),
        Insn::MovReg32(dst, src) => reg_form(out, false, 0x8B, dst, src),
        Insn::OrReg64(dst, src) => reg_form(out, true, 0x0B, dst, src),
        Insn::Store64(m, r) => mem_form(out, true, 0x89, r, m),
        Insn::Store32(m, r) => mem_form(out, false, 0x89, r, m),
        Insn::Load64(r, m) => mem_form(out, true, 0x8B, r, m),
        Insn::Load32(r, m) => mem_form(out, false, 0x8B, r, m),
        Insn::Lea64(r, m) => mem_form(out, true, 0x8D, r, m),
        Insn::IncMem32(m) => {
            rex(out, false, 0, m.index.map_or(0, |(r, _)| r.hi()), m.base.map_or(0, Reg::hi));
            out.push(0xFF);
            modrm_mem(out, 0, m);
        }
        Insn::AndRegImm8(r, imm) => {
            rex(out, true, 0, 0, r.hi());
            out.push(0x83);
            out.push(0xE0 | r.lo());
            out.push(imm as u8);
        }
        Insn::ShlRegImm8(r, imm) => {
            rex(out, true, 0, 0, r.hi());
            out.push(0xC1);
            out.push(0xE0 | r.lo());
            out.push(imm);
        }
        Insn::JmpReg(r) => {
            rex(out, false, 0, 0, r.hi());
            out.push(0xFF);
            out.push(0xE0 | r.lo());
        }
        Insn::Nop(n) => nop(out, n),
    }
}

/// Formes canoniques du `nop` multi-octets (identiques chez MSVC et Intel).
fn nop(out: &mut Vec<u8>, n: u8) {
    const FORMS: [&[u8]; 16] = [
        &[],
        &[0x90],
        &[0x66, 0x90],
        &[0x0F, 0x1F, 0x00],
        &[0x0F, 0x1F, 0x40, 0x00],
        &[0x0F, 0x1F, 0x44, 0x00, 0x00],
        &[0x66, 0x0F, 0x1F, 0x44, 0x00, 0x00],
        &[0x0F, 0x1F, 0x80, 0x00, 0x00, 0x00, 0x00],
        &[0x0F, 0x1F, 0x84, 0x00, 0x00, 0x00, 0x00, 0x00],
        &[0x66, 0x0F, 0x1F, 0x84, 0x00, 0x00, 0x00, 0x00, 0x00],
        &[0x66, 0x66, 0x0F, 0x1F, 0x84, 0x00, 0x00, 0x00, 0x00, 0x00],
        &[0x66, 0x66, 0x66, 0x0F, 0x1F, 0x84, 0x00, 0x00, 0x00, 0x00, 0x00],
        &[0x66, 0x66, 0x66, 0x66, 0x0F, 0x1F, 0x84, 0x00, 0x00, 0x00, 0x00, 0x00],
        &[0x66, 0x66, 0x66, 0x66, 0x66, 0x0F, 0x1F, 0x84, 0x00, 0x00, 0x00, 0x00, 0x00],
        &[0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x0F, 0x1F, 0x84, 0x00, 0x00, 0x00, 0x00, 0x00],
        &[
            0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x0F, 0x1F, 0x84, 0x00, 0x00, 0x00, 0x00,
            0x00,
        ],
    ];
    if let Some(f) = FORMS.get(n as usize) {
        out.extend_from_slice(f);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloc::vec;

    /// Chaque vecteur vient d'un **corps de fonction réel** de `nie.exe`
    /// (recensé par `nie-forge candidates`) : l'encodeur est validé contre le
    /// binaire, pas contre lui-même.
    #[test]
    fn encode_les_corps_reels_de_nie_exe() {
        // `ret` / `ret 0` — 1046 + 2 unités réelles
        assert_eq!(encode(&[Insn::Ret]), vec![0xC3]);
        assert_eq!(encode(&[Insn::RetImm(0)]), vec![0xC2, 0x00, 0x00]);
        // `mov al, 1 ; ret` — 320 unités (gestionnaires « return true »)
        assert_eq!(
            encode(&[Insn::MovRegImm8(Reg::Rax, 1), Insn::Ret]),
            vec![0xB0, 0x01, 0xC3]
        );
        // `xor eax, eax ; ret` — 163 unités
        assert_eq!(
            encode(&[Insn::XorReg32(Reg::Rax, Reg::Rax), Insn::Ret]),
            vec![0x33, 0xC0, 0xC3]
        );
        // `xor al, al ; ret` — 163 unités
        assert_eq!(
            encode(&[Insn::XorReg8(Reg::Rax, Reg::Rax), Insn::Ret]),
            vec![0x32, 0xC0, 0xC3]
        );
        // `mov rax, rcx ; ret` — 178 unités (dialecte MSVC : 8B, pas 89)
        assert_eq!(
            encode(&[Insn::MovReg64(Reg::Rax, Reg::Rcx), Insn::Ret]),
            vec![0x48, 0x8B, 0xC1, 0xC3]
        );
        // `mov [rcx], rdx ; mov rax, rcx ; ret` — 279 unités
        assert_eq!(
            encode(&[
                Insn::Store64(Mem::base(Reg::Rcx), Reg::Rdx),
                Insn::MovReg64(Reg::Rax, Reg::Rcx),
                Insn::Ret
            ]),
            vec![0x48, 0x89, 0x11, 0x48, 0x8B, 0xC1, 0xC3]
        );
        // `mov [rcx], rdx ; mov rax, rcx ; mov [rcx+8], r8 ; ret` — 125 unités
        assert_eq!(
            encode(&[
                Insn::Store64(Mem::base(Reg::Rcx), Reg::Rdx),
                Insn::MovReg64(Reg::Rax, Reg::Rcx),
                Insn::Store64(Mem::base_disp(Reg::Rcx, 8), Reg::R8),
                Insn::Ret
            ]),
            vec![0x48, 0x89, 0x11, 0x48, 0x8B, 0xC1, 0x4C, 0x89, 0x41, 0x08, 0xC3]
        );
        // `lea rax, [rcx+8] ; ret` — 265 unités
        assert_eq!(
            encode(&[Insn::Lea64(Reg::Rax, Mem::base_disp(Reg::Rcx, 8)), Insn::Ret]),
            vec![0x48, 0x8D, 0x41, 0x08, 0xC3]
        );
        // `mov eax, 0xefec8a0d ; ret` — 200 unités (accesseurs de hash/type-id)
        assert_eq!(
            encode(&[Insn::MovRegImm32(Reg::Rax, 0xefec_8a0d), Insn::Ret]),
            vec![0xB8, 0x0D, 0x8A, 0xEC, 0xEF, 0xC3]
        );
        // `mov eax, [rdx] ; mov [rcx], eax ; mov rax, rcx ; ret` — 55 unités
        assert_eq!(
            encode(&[
                Insn::Load32(Reg::Rax, Mem::base(Reg::Rdx)),
                Insn::Store32(Mem::base(Reg::Rcx), Reg::Rax),
                Insn::MovReg64(Reg::Rax, Reg::Rcx),
                Insn::Ret
            ]),
            vec![0x8B, 0x02, 0x89, 0x01, 0x48, 0x8B, 0xC1, 0xC3]
        );
        // `mov rax, [rsp+0x28]` — forme SIB (rsp impose un octet SIB)
        assert_eq!(
            encode(&[Insn::Load64(Reg::Rax, Mem::base_disp(Reg::Rsp, 0x28))]),
            vec![0x48, 0x8B, 0x44, 0x24, 0x28]
        );
        // `inc dword [rcx] ; mov eax, [rcx] ; mov [rdx], eax` — préfixe du groupe FF/01
        assert_eq!(
            encode(&[Insn::IncMem32(Mem::base(Reg::Rcx))]),
            vec![0xFF, 0x01]
        );
        // `and rax, -1 ; shl rdx, 0x20 ; or rax, rdx ; ret` — assemblage 64 bits
        assert_eq!(
            encode(&[
                Insn::AndRegImm8(Reg::Rax, -1),
                Insn::ShlRegImm8(Reg::Rdx, 0x20),
                Insn::OrReg64(Reg::Rax, Reg::Rdx),
                Insn::Ret
            ]),
            vec![0x48, 0x83, 0xE0, 0xFF, 0x48, 0xC1, 0xE2, 0x20, 0x48, 0x0B, 0xC2, 0xC3]
        );
        // `jmp rax` — thunk d'appel indirect
        assert_eq!(encode(&[Insn::JmpReg(Reg::Rax)]), vec![0xFF, 0xE0]);
        // nop 10 octets — bourrage intra-fonction réel
        assert_eq!(
            encode(&[Insn::Nop(10)]),
            vec![0x66, 0x66, 0x0F, 0x1F, 0x84, 0x00, 0x00, 0x00, 0x00, 0x00]
        );
    }

    #[test]
    fn registres_etendus_portent_rex() {
        // `mov r8, r9` → REX.WRB
        assert_eq!(
            encode(&[Insn::MovReg64(Reg::R8, Reg::R9)]),
            vec![0x4D, 0x8B, 0xC1]
        );
        // `mov [r12], rax` → base r12 impose SIB
        assert_eq!(
            encode(&[Insn::Store64(Mem::base(Reg::R12), Reg::Rax)]),
            vec![0x49, 0x89, 0x04, 0x24]
        );
        // `[rbp]` sans déplacement doit devenir `[rbp+0]` (mod=01)
        assert_eq!(
            encode(&[Insn::Load64(Reg::Rax, Mem::base(Reg::Rbp))]),
            vec![0x48, 0x8B, 0x45, 0x00]
        );
    }

    #[test]
    fn deplacement_32_bits_quand_disp8_ne_suffit_pas() {
        assert_eq!(
            encode(&[Insn::Load64(Reg::Rax, Mem::base_disp(Reg::Rcx, 0x1234))]),
            vec![0x48, 0x8B, 0x81, 0x34, 0x12, 0x00, 0x00]
        );
    }
}
