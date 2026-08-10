//! `nie-asm` — encodeur x86-64 **dialecte MSVC**, pur Rust.
//!
//! ## Pourquoi ce crate existe
//!
//! `nie.exe` est produit par MSVC 14.44. Deux compilateurs qui émettent la même
//! instruction ne choisissent pas le même encodage : `mov rax, rcx` s'écrit
//! `48 8b c1` chez MSVC (opcode `8B`, direction registre←r/m) et `48 89 c8` chez
//! LLVM. Attendre de `rustc` qu'il reproduise les octets de MSVC est donc
//! structurellement vain — c'était le plafond invisible du projet.
//!
//! La forge le contourne en **assemblant elle-même** : le dépôt commite une
//! source symbolique (`push rbx ; sub rsp, 0x20 ; call 0x140123456`), et ce crate
//! la traduit en octets selon les conventions d'encodage de MSVC. Le binaire
//! n'est plus recopié : il est **produit**, depuis une source lisible.
//!
//! ## Encodage conscient de l'adresse
//!
//! Les branchements et les opérandes relatifs au pointeur d'instruction sont
//! écrits en **adresse absolue** dans la source (`call 0x140123456`,
//! `lea rax, [rip 0x1401f2340]`) ; [`encode_at`] calcule le déplacement depuis
//! l'adresse de l'instruction courante — le travail normal d'un assembleur. La
//! source reste donc lisible et vérifiable, sans dépendre d'un état de linker.
//!
//! ## Falsifiabilité
//!
//! L'encodeur ne « colle » pas aux octets d'origine : il applique des règles
//! canoniques. Si MSVC a choisi une autre forme, le résultat diffère et la forge
//! refuse l'unité. Aucun faux positif possible : la comparaison est byte-à-byte
//! contre le binaire réel.
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

/// Registre général 64 bits (les formes 8/16/32 bits partagent l'encodage).
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
}

/// Taille d'opérande.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[allow(missing_docs)]
pub enum Size {
    /// 8 bits.
    B,
    /// 16 bits (préfixe `66`).
    W,
    /// 32 bits.
    D,
    /// 64 bits (REX.W).
    Q,
}

impl Size {
    /// Largeur en octets.
    #[must_use]
    pub fn bytes(self) -> u8 {
        match self {
            Self::B => 1,
            Self::W => 2,
            Self::D => 4,
            Self::Q => 8,
        }
    }

    /// Vrai si l'opérande impose REX.W.
    #[must_use]
    pub fn rex_w(self) -> bool {
        self == Self::Q
    }
}

/// Opération arithmétique/logique du groupe 1 (`/n` du ModRM).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[allow(missing_docs)]
pub enum Alu {
    Add,
    Or,
    Adc,
    Sbb,
    And,
    Sub,
    Xor,
    Cmp,
}

impl Alu {
    /// Champ `/n` (aussi la base d'opcode : `op*8`).
    #[must_use]
    pub fn digit(self) -> u8 {
        self as u8
    }
}

/// Condition d'un `jcc` / `setcc` (numérotation architecturale `tttn`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[allow(missing_docs)]
pub enum Cond {
    O,
    No,
    B,
    Ae,
    E,
    Ne,
    Be,
    A,
    S,
    Ns,
    P,
    Np,
    L,
    Ge,
    Le,
    G,
}

impl Cond {
    /// Code `tttn` 0..15.
    #[must_use]
    pub fn code(self) -> u8 {
        self as u8
    }
}

/// Décalage du groupe 2.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[allow(missing_docs)]
pub enum ShiftOp {
    Shl,
    Shr,
    Sar,
}

impl ShiftOp {
    /// Champ `/n`.
    #[must_use]
    pub fn digit(self) -> u8 {
        match self {
            Self::Shl => 4,
            Self::Shr => 5,
            Self::Sar => 7,
        }
    }
}

/// Opérande mémoire `[base + index*scale + disp]`, ou `[rip → cible absolue]`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct Mem {
    /// Registre de base.
    pub base: Option<Reg>,
    /// Registre d'index et facteur d'échelle (1, 2, 4 ou 8).
    pub index: Option<(Reg, u8)>,
    /// Déplacement signé.
    pub disp: i32,
    /// Cible **absolue** d'un adressage relatif au pointeur d'instruction.
    ///
    /// Quand ce champ est renseigné, `base`/`index`/`disp` sont ignorés et
    /// l'encodeur calcule `cible - adresse_de_l_instruction_suivante`.
    pub rip: Option<u64>,
}

impl Mem {
    /// `[base]`.
    #[must_use]
    pub fn base(base: Reg) -> Self {
        Self {
            base: Some(base),
            ..Self::default()
        }
    }

    /// `[base + disp]`.
    #[must_use]
    pub fn base_disp(base: Reg, disp: i32) -> Self {
        Self {
            base: Some(base),
            disp,
            ..Self::default()
        }
    }

    /// `[rip → cible]`.
    #[must_use]
    pub fn rip(target: u64) -> Self {
        Self {
            rip: Some(target),
            ..Self::default()
        }
    }
}

/// Opérande « registre ou mémoire » (le `r/m` de l'encodage x86).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[allow(missing_docs)]
pub enum Rm {
    R(Reg),
    M(Mem),
}

/// Opération unaire du groupe `FF` / `F7`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[allow(missing_docs)]
pub enum UnOp {
    /// `inc` (`FF /0`)
    Inc,
    /// `dec` (`FF /1`)
    Dec,
    /// `call r/m` (`FF /2`) — appel indirect (imports, vtables)
    CallInd,
    /// `jmp r/m` (`FF /4`)
    JmpInd,
    /// `push r/m` (`FF /6`)
    PushRm,
    /// `not` (`F7 /2`)
    Not,
    /// `neg` (`F7 /3`)
    Neg,
}

impl UnOp {
    /// Champ `/n`.
    #[must_use]
    pub fn digit(self) -> u8 {
        match self {
            Self::Inc => 0,
            Self::Dec => 1,
            Self::CallInd | Self::Not => 2,
            Self::Neg => 3,
            Self::JmpInd => 4,
            Self::PushRm => 6,
        }
    }

    /// Vrai si l'opération appartient au groupe `F7` (sinon `FF`).
    #[must_use]
    pub fn is_f7(self) -> bool {
        matches!(self, Self::Not | Self::Neg)
    }
}

/// Instruction supportée par l'encodeur.
///
/// Le jeu est restreint aux formes réellement présentes dans `nie.exe` : chaque
/// ajout est justifié par les unités qu'il fait basculer, et validé contre leurs
/// octets.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[allow(missing_docs)]
pub enum Insn {
    /// `ret`
    Ret,
    /// `ret imm16`
    RetImm(u16),
    /// `int3`
    Int3,
    /// `nop` multi-octets de longueur `n` (1..=15), forme canonique.
    Nop(u8),
    /// `push r64`
    Push(Reg),
    /// `pop r64`
    Pop(Reg),
    /// `mov r8, imm8` (opcode `B0+rb`)
    MovRegImm8(Reg, u8),
    /// `mov r32, imm32` (opcode `B8+rd`)
    MovRegImm32(Reg, u32),
    /// `mov r64, imm64` (REX.W + `B8+rd`)
    MovRegImm64(Reg, u64),
    /// `mov r, r` — MSVC encode `8B /r`
    MovRR(Size, Reg, Reg),
    /// `mov r, [mem]` (`8B /r`)
    Load(Size, Reg, Mem),
    /// `mov [mem], r` (`89 /r`)
    Store(Size, Mem, Reg),
    /// `mov dword/qword [mem], imm32` (`C7 /0`)
    StoreImm32(Size, Mem, i32),
    /// `lea r64, [mem]` (`48 8D /r`)
    Lea(Reg, Mem),
    /// `<alu> r, r` — MSVC encode `op*8+3` (registre ← r/m)
    AluRR(Alu, Size, Reg, Reg),
    /// `<alu> r, [mem]` (`op*8+3`)
    AluRM(Alu, Size, Reg, Mem),
    /// `<alu> [mem], r` (`op*8+1`)
    AluMR(Alu, Size, Mem, Reg),
    /// `<alu> r, imm` (`83 /n ib` si l'immédiat tient sur 8 bits signés, sinon `81 /n id`)
    AluRI(Alu, Size, Reg, i32),
    /// `test r, r` (`85 /r`, `84 /r` en 8 bits)
    TestRR(Size, Reg, Reg),
    /// `<shift> r, imm8` (`C1 /n ib`)
    Shift(ShiftOp, Size, Reg, u8),
    /// `movzx r32, r/m8|16` (`0F B6` / `0F B7`)
    MovzxR(Size, Reg, Reg),
    /// `movzx r32, [mem]` en 8 ou 16 bits source
    MovzxM(Size, Reg, Mem),
    /// `movsxd r64, r32` (`63 /r`)
    Movsxd(Reg, Reg),
    /// `setcc r8` (`0F 90+cc`)
    Setcc(Cond, Reg),
    /// `inc dword [mem]` (`FF /0`)
    IncMem32(Mem),
    /// `jmp r64` (`FF /4`)
    JmpReg(Reg),
    /// `call <cible absolue>` (`E8 rel32`)
    Call(u64),
    /// `jmp <cible absolue>` ; `short` choisit `EB rel8` plutôt que `E9 rel32`
    Jmp(u64, bool),
    /// `jcc <cible absolue>` ; `short` choisit `7x rel8` plutôt que `0F 8x rel32`
    Jcc(Cond, u64, bool),
    /// `<alu> r/m, imm` (`80/81/83 /n`) — couvre `cmp dword [rcx], 5`
    AluI(Alu, Size, Rm, i32),
    /// `mov r/m, imm` (`C6 /0` en 8 bits, `C7 /0` sinon)
    MovI(Size, Rm, i32),
    /// `test r/m, r`
    Test(Size, Rm, Reg),
    /// `test r/m, imm` (`F6 /0` / `F7 /0`)
    TestI(Size, Rm, i32),
    /// `<unop> r/m` (groupes `FF` et `F7`)
    Un(UnOp, Size, Rm),
    /// `imul r, r/m` (`0F AF /r`)
    Imul(Size, Reg, Rm),
    /// `imul r, r/m, imm` (`69 /r id` ou `6B /r ib`)
    ImulI(Size, Reg, Rm, i32),
    /// `movsx r32/r64, r/m8|16` (`0F BE` / `0F BF`)
    Movsx(Size, Size, Reg, Rm),
    /// `lea r32, [mem]` (sans REX.W)
    LeaD(Reg, Mem),
}

/// Encode une suite d'instructions à l'adresse `0` (formes sans adresse).
#[must_use]
pub fn encode(insns: &[Insn]) -> Vec<u8> {
    encode_at(insns, 0)
}

/// Encode une suite d'instructions placée à l'adresse virtuelle `va`.
///
/// Les branchements et les opérandes `[rip …]` sont résolus par rapport à
/// l'adresse réelle de chaque instruction.
#[must_use]
pub fn encode_at(insns: &[Insn], va: u64) -> Vec<u8> {
    let mut out = Vec::new();
    for i in insns {
        let here = va.wrapping_add(out.len() as u64);
        encode_one(*i, here, &mut out);
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

/// Préfixe de taille d'opérande 16 bits.
fn opsize(out: &mut Vec<u8>, size: Size) {
    if size == Size::W {
        out.push(0x66);
    }
}

/// Émet ModRM (+ SIB + déplacement) pour un opérande mémoire.
///
/// `at` (adresse de l'instruction), `base` (sa position dans `out`) et `imm_len`
/// servent au cas `[rip …]`, dont le déplacement est relatif à la **fin** de
/// l'instruction, immédiat compris.
///
/// Piège corrigé ici : `out` est le tampon de **tout le corps**, pas de la seule
/// instruction — sans `base`, le déplacement se calculerait depuis le début du
/// corps et serait faux dès la deuxième instruction.
fn modrm_mem(out: &mut Vec<u8>, reg: u8, m: Mem, at: u64, base: usize, imm_len: usize) {
    if let Some(target) = m.rip {
        out.push((reg & 7) << 3 | 0b101); // mod=00, rm=101 → rip-relatif
        let emitted = (out.len() - base) as u64;
        let end = at.wrapping_add(emitted + 4 + imm_len as u64);
        let rel = target.wrapping_sub(end) as i32;
        out.extend_from_slice(&rel.to_le_bytes());
        return;
    }
    let base = m.base;
    let need_sib = m.index.is_some() || base.is_some_and(|b| b.lo() == 4);
    // rbp/r13 en mod=00 signifierait « rip-relatif » : forcer un disp8 nul.
    let force_disp8 = base.is_some_and(|b| b.lo() == 5) && m.disp == 0;
    let mode = if base.is_none() || (m.disp == 0 && !force_disp8) {
        0b00
    } else if i8::try_from(m.disp).is_ok() {
        0b01
    } else {
        0b10
    };
    let rm = if need_sib { 4 } else { base.map_or(4, Reg::lo) };
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

/// Bits REX portés par un opérande mémoire.
fn mem_rex(m: Mem) -> (u8, u8) {
    (
        m.index.map_or(0, |(r, _)| r.hi()),
        m.base.map_or(0, Reg::hi),
    )
}

/// Instruction registre↔mémoire.
fn mem_form(out: &mut Vec<u8>, size: Size, opcode: u8, reg: Reg, m: Mem, at: u64, imm: usize) {
    let base = out.len();
    opsize(out, size);
    let (x, b) = mem_rex(m);
    rex(out, size.rex_w(), reg.hi(), x, b);
    out.push(opcode);
    modrm_mem(out, reg.lo(), m, at, base, imm);
}

/// Instruction registre↔registre (`mod=11`).
fn reg_form(out: &mut Vec<u8>, size: Size, opcode: u8, reg: Reg, rm: Reg) {
    opsize(out, size);
    rex(out, size.rex_w(), reg.hi(), 0, rm.hi());
    out.push(opcode);
    out.push(0xC0 | (reg.lo() << 3) | rm.lo());
}

/// Émet une instruction à opérande `r/m` : préfixes, opcode(s), ModRM, immédiat.
///
/// `reg` est le champ `/r` (numéro de registre ou extension d'opcode `/n`).
/// `imm` est écrit après le ModRM, sa largeur servant aussi au calcul du
/// déplacement `[rip …]`.
#[allow(clippy::too_many_arguments)] // encodage x86 : chaque champ est un champ du format
fn rm_form(
    out: &mut Vec<u8>,
    size: Size,
    opcodes: &[u8],
    reg: u8,
    reg_hi: u8,
    rm: Rm,
    at: u64,
    imm: &[u8],
) {
    let base = out.len();
    opsize(out, size);
    match rm {
        Rm::R(r) => {
            rex(out, size.rex_w(), reg_hi, 0, r.hi());
            out.extend_from_slice(opcodes);
            out.push(0xC0 | ((reg & 7) << 3) | r.lo());
        }
        Rm::M(m) => {
            let (x, b) = mem_rex(m);
            rex(out, size.rex_w(), reg_hi, x, b);
            out.extend_from_slice(opcodes);
            modrm_mem(out, reg, m, at, base, imm.len());
        }
    }
    out.extend_from_slice(imm);
}

/// Immédiat d'une opération ALU/`mov` selon la taille d'opérande.
fn imm_bytes(size: Size, v: i32, force_wide: bool) -> (Vec<u8>, bool) {
    if size == Size::B {
        return (alloc::vec![v as u8], false);
    }
    if !force_wide && i8::try_from(v).is_ok() {
        return (alloc::vec![v as u8], true); // forme courte `83 /n ib`
    }
    match size {
        Size::W => (v.to_le_bytes()[..2].to_vec(), false),
        _ => (v.to_le_bytes().to_vec(), false),
    }
}

/// Opcode « registre ← r/m » du groupe ALU (`03`, `0B`, `23`, `2B`, `33`, `3B`…).
fn alu_rm_op(op: Alu, size: Size) -> u8 {
    op.digit() * 8 + if size == Size::B { 2 } else { 3 }
}

/// Opcode « r/m ← registre » du groupe ALU (`01`, `09`, `21`, `29`, `31`, `39`…).
fn alu_mr_op(op: Alu, size: Size) -> u8 {
    op.digit() * 8 + u8::from(size != Size::B)
}

fn encode_one(i: Insn, at: u64, out: &mut Vec<u8>) {
    match i {
        Insn::Ret => out.push(0xC3),
        Insn::RetImm(n) => {
            out.push(0xC2);
            out.extend_from_slice(&n.to_le_bytes());
        }
        Insn::Int3 => out.push(0xCC),
        Insn::Nop(n) => nop(out, n),
        Insn::Push(r) => {
            rex(out, false, 0, 0, r.hi());
            out.push(0x50 + r.lo());
        }
        Insn::Pop(r) => {
            rex(out, false, 0, 0, r.hi());
            out.push(0x58 + r.lo());
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
        Insn::MovRegImm64(r, imm) => {
            rex(out, true, 0, 0, r.hi());
            out.push(0xB8 + r.lo());
            out.extend_from_slice(&imm.to_le_bytes());
        }
        Insn::MovRR(size, dst, src) => {
            reg_form(out, size, if size == Size::B { 0x8A } else { 0x8B }, dst, src);
        }
        Insn::Load(size, r, m) => {
            mem_form(out, size, if size == Size::B { 0x8A } else { 0x8B }, r, m, at, 0);
        }
        Insn::Store(size, m, r) => {
            mem_form(out, size, if size == Size::B { 0x88 } else { 0x89 }, r, m, at, 0);
        }
        Insn::StoreImm32(size, m, imm) => {
            let base = out.len();
            opsize(out, size);
            let (x, b) = mem_rex(m);
            rex(out, size.rex_w(), 0, x, b);
            out.push(0xC7);
            modrm_mem(out, 0, m, at, base, 4);
            out.extend_from_slice(&imm.to_le_bytes());
        }
        Insn::Lea(r, m) => mem_form(out, Size::Q, 0x8D, r, m, at, 0),
        Insn::AluRR(op, size, dst, src) => reg_form(out, size, alu_rm_op(op, size), dst, src),
        Insn::AluRM(op, size, dst, m) => mem_form(out, size, alu_rm_op(op, size), dst, m, at, 0),
        Insn::AluMR(op, size, m, src) => mem_form(out, size, alu_mr_op(op, size), src, m, at, 0),
        Insn::AluRI(op, size, r, imm) => {
            opsize(out, size);
            rex(out, size.rex_w(), 0, 0, r.hi());
            if let Ok(i8v) = i8::try_from(imm) {
                out.push(if size == Size::B { 0x80 } else { 0x83 });
                out.push(0xC0 | (op.digit() << 3) | r.lo());
                out.push(i8v as u8);
            } else {
                out.push(0x81);
                out.push(0xC0 | (op.digit() << 3) | r.lo());
                out.extend_from_slice(&imm.to_le_bytes());
            }
        }
        Insn::TestRR(size, a, b) => {
            reg_form(out, size, if size == Size::B { 0x84 } else { 0x85 }, b, a);
        }
        Insn::Shift(op, size, r, imm) => {
            opsize(out, size);
            rex(out, size.rex_w(), 0, 0, r.hi());
            out.push(if size == Size::B { 0xC0 } else { 0xC1 });
            out.push(0xC0 | (op.digit() << 3) | r.lo());
            out.push(imm);
        }
        Insn::MovzxR(src_size, dst, src) => {
            rex(out, false, dst.hi(), 0, src.hi());
            out.push(0x0F);
            out.push(if src_size == Size::B { 0xB6 } else { 0xB7 });
            out.push(0xC0 | (dst.lo() << 3) | src.lo());
        }
        Insn::MovzxM(src_size, dst, m) => {
            let base = out.len();
            let (x, b) = mem_rex(m);
            rex(out, false, dst.hi(), x, b);
            out.push(0x0F);
            out.push(if src_size == Size::B { 0xB6 } else { 0xB7 });
            modrm_mem(out, dst.lo(), m, at, base, 0);
        }
        Insn::Movsxd(dst, src) => reg_form(out, Size::Q, 0x63, dst, src),
        Insn::Setcc(c, r) => {
            rex(out, false, 0, 0, r.hi());
            out.push(0x0F);
            out.push(0x90 + c.code());
            out.push(0xC0 | r.lo());
        }
        Insn::IncMem32(m) => {
            let base = out.len();
            let (x, b) = mem_rex(m);
            rex(out, false, 0, x, b);
            out.push(0xFF);
            modrm_mem(out, 0, m, at, base, 0);
        }
        Insn::JmpReg(r) => {
            rex(out, false, 0, 0, r.hi());
            out.push(0xFF);
            out.push(0xE0 | r.lo());
        }
        Insn::Call(target) => {
            out.push(0xE8);
            let rel = target.wrapping_sub(at.wrapping_add(5)) as i32;
            out.extend_from_slice(&rel.to_le_bytes());
        }
        Insn::Jmp(target, short) => {
            if short {
                out.push(0xEB);
                out.push(target.wrapping_sub(at.wrapping_add(2)) as u8);
            } else {
                out.push(0xE9);
                let rel = target.wrapping_sub(at.wrapping_add(5)) as i32;
                out.extend_from_slice(&rel.to_le_bytes());
            }
        }
        Insn::Jcc(c, target, short) => {
            if short {
                out.push(0x70 + c.code());
                out.push(target.wrapping_sub(at.wrapping_add(2)) as u8);
            } else {
                out.push(0x0F);
                out.push(0x80 + c.code());
                let rel = target.wrapping_sub(at.wrapping_add(6)) as i32;
                out.extend_from_slice(&rel.to_le_bytes());
            }
        }
        Insn::AluI(op, size, rm, v) => {
            let (imm, short) = imm_bytes(size, v, false);
            let opcode = if size == Size::B {
                0x80
            } else if short {
                0x83
            } else {
                0x81
            };
            rm_form(out, size, &[opcode], op.digit(), 0, rm, at, &imm);
        }
        Insn::MovI(size, rm, v) => {
            let (imm, _) = imm_bytes(size, v, true);
            let opcode = if size == Size::B { 0xC6 } else { 0xC7 };
            rm_form(out, size, &[opcode], 0, 0, rm, at, &imm);
        }
        Insn::Test(size, rm, r) => {
            let opcode = if size == Size::B { 0x84 } else { 0x85 };
            rm_form(out, size, &[opcode], r.lo(), r.hi(), rm, at, &[]);
        }
        Insn::TestI(size, rm, v) => {
            let (imm, _) = imm_bytes(size, v, true);
            let opcode = if size == Size::B { 0xF6 } else { 0xF7 };
            rm_form(out, size, &[opcode], 0, 0, rm, at, &imm);
        }
        Insn::Un(op, size, rm) => {
            let opcode = if op.is_f7() {
                if size == Size::B { 0xF6 } else { 0xF7 }
            } else if size == Size::B {
                0xFE
            } else {
                0xFF
            };
            // `call`/`jmp`/`push` indirects sont toujours 64 bits implicites :
            // pas de REX.W, l'opérande fait déjà la taille d'un pointeur.
            let sz = match op {
                UnOp::CallInd | UnOp::JmpInd | UnOp::PushRm => Size::D,
                _ => size,
            };
            rm_form(out, sz, &[opcode], op.digit(), 0, rm, at, &[]);
        }
        Insn::Imul(size, r, rm) => rm_form(out, size, &[0x0F, 0xAF], r.lo(), r.hi(), rm, at, &[]),
        Insn::ImulI(size, r, rm, v) => {
            let (imm, short) = imm_bytes(size, v, false);
            let opcode = if short { 0x6B } else { 0x69 };
            rm_form(out, size, &[opcode], r.lo(), r.hi(), rm, at, &imm);
        }
        Insn::Movsx(src, dst_size, r, rm) => {
            let opcode = if src == Size::B { 0xBE } else { 0xBF };
            rm_form(out, dst_size, &[0x0F, opcode], r.lo(), r.hi(), rm, at, &[]);
        }
        Insn::LeaD(r, m) => mem_form(out, Size::D, 0x8D, r, m, at, 0),
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
        assert_eq!(encode(&[Insn::Ret]), vec![0xC3]);
        assert_eq!(encode(&[Insn::RetImm(0)]), vec![0xC2, 0x00, 0x00]);
        // `mov al, 1 ; ret` — 320 unités (gestionnaires « return true »)
        assert_eq!(
            encode(&[Insn::MovRegImm8(Reg::Rax, 1), Insn::Ret]),
            vec![0xB0, 0x01, 0xC3]
        );
        // `xor eax, eax ; ret` — 163 unités (dialecte MSVC : 33, pas 31)
        assert_eq!(
            encode(&[Insn::AluRR(Alu::Xor, Size::D, Reg::Rax, Reg::Rax), Insn::Ret]),
            vec![0x33, 0xC0, 0xC3]
        );
        // `xor al, al ; ret` — 163 unités
        assert_eq!(
            encode(&[Insn::AluRR(Alu::Xor, Size::B, Reg::Rax, Reg::Rax), Insn::Ret]),
            vec![0x32, 0xC0, 0xC3]
        );
        // `mov rax, rcx ; ret` — 178 unités (MSVC : 8B, pas 89)
        assert_eq!(
            encode(&[Insn::MovRR(Size::Q, Reg::Rax, Reg::Rcx), Insn::Ret]),
            vec![0x48, 0x8B, 0xC1, 0xC3]
        );
        // `mov [rcx], rdx ; mov rax, rcx ; mov [rcx+8], r8 ; ret` — 125 unités
        assert_eq!(
            encode(&[
                Insn::Store(Size::Q, Mem::base(Reg::Rcx), Reg::Rdx),
                Insn::MovRR(Size::Q, Reg::Rax, Reg::Rcx),
                Insn::Store(Size::Q, Mem::base_disp(Reg::Rcx, 8), Reg::R8),
                Insn::Ret
            ]),
            vec![0x48, 0x89, 0x11, 0x48, 0x8B, 0xC1, 0x4C, 0x89, 0x41, 0x08, 0xC3]
        );
        // `lea rax, [rcx+8] ; ret` — 265 unités
        assert_eq!(
            encode(&[Insn::Lea(Reg::Rax, Mem::base_disp(Reg::Rcx, 8)), Insn::Ret]),
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
                Insn::Load(Size::D, Reg::Rax, Mem::base(Reg::Rdx)),
                Insn::Store(Size::D, Mem::base(Reg::Rcx), Reg::Rax),
                Insn::MovRR(Size::Q, Reg::Rax, Reg::Rcx),
                Insn::Ret
            ]),
            vec![0x8B, 0x02, 0x89, 0x01, 0x48, 0x8B, 0xC1, 0xC3]
        );
        // Forme SIB imposée par rsp.
        assert_eq!(
            encode(&[Insn::Load(Size::Q, Reg::Rax, Mem::base_disp(Reg::Rsp, 0x28))]),
            vec![0x48, 0x8B, 0x44, 0x24, 0x28]
        );
        assert_eq!(encode(&[Insn::IncMem32(Mem::base(Reg::Rcx))]), vec![0xFF, 0x01]);
        // `and rax, -1 ; shl rdx, 0x20 ; or rax, rdx ; ret`
        assert_eq!(
            encode(&[
                Insn::AluRI(Alu::And, Size::Q, Reg::Rax, -1),
                Insn::Shift(ShiftOp::Shl, Size::Q, Reg::Rdx, 0x20),
                Insn::AluRR(Alu::Or, Size::Q, Reg::Rax, Reg::Rdx),
                Insn::Ret
            ]),
            vec![0x48, 0x83, 0xE0, 0xFF, 0x48, 0xC1, 0xE2, 0x20, 0x48, 0x0B, 0xC2, 0xC3]
        );
        assert_eq!(encode(&[Insn::JmpReg(Reg::Rax)]), vec![0xFF, 0xE0]);
        assert_eq!(
            encode(&[Insn::Nop(10)]),
            vec![0x66, 0x66, 0x0F, 0x1F, 0x84, 0x00, 0x00, 0x00, 0x00, 0x00]
        );
    }

    #[test]
    fn prologue_et_epilogue_msvc() {
        // Séquence d'ouverture typique : mov [rsp+8],rbx ; push rdi ; sub rsp,0x20
        assert_eq!(
            encode(&[
                Insn::Store(Size::Q, Mem::base_disp(Reg::Rsp, 8), Reg::Rbx),
                Insn::Push(Reg::Rdi),
                Insn::AluRI(Alu::Sub, Size::Q, Reg::Rsp, 0x20),
            ]),
            vec![0x48, 0x89, 0x5C, 0x24, 0x08, 0x57, 0x48, 0x83, 0xEC, 0x20]
        );
        // Fermeture : add rsp,0x20 ; pop rdi ; ret
        assert_eq!(
            encode(&[
                Insn::AluRI(Alu::Add, Size::Q, Reg::Rsp, 0x20),
                Insn::Pop(Reg::Rdi),
                Insn::Ret
            ]),
            vec![0x48, 0x83, 0xC4, 0x20, 0x5F, 0xC3]
        );
        // Registres étendus : push r14 / pop r14 portent REX.B
        assert_eq!(encode(&[Insn::Push(Reg::R14)]), vec![0x41, 0x56]);
        assert_eq!(encode(&[Insn::Pop(Reg::R14)]), vec![0x41, 0x5E]);
        // sub rsp, 0x108 → immédiat 32 bits
        assert_eq!(
            encode(&[Insn::AluRI(Alu::Sub, Size::Q, Reg::Rsp, 0x108)]),
            vec![0x48, 0x81, 0xEC, 0x08, 0x01, 0x00, 0x00]
        );
    }

    #[test]
    fn branchements_resolus_depuis_l_adresse_courante() {
        // `call 0x140001000` placé en 0x140000000 → rel32 = 0x1000 - 5
        assert_eq!(
            encode_at(&[Insn::Call(0x1_4000_1000)], 0x1_4000_0000),
            vec![0xE8, 0xFB, 0x0F, 0x00, 0x00]
        );
        // saut arrière court
        assert_eq!(
            encode_at(&[Insn::Jmp(0x1_4000_0000, true)], 0x1_4000_0010),
            vec![0xEB, 0xEE]
        );
        // jcc near
        assert_eq!(
            encode_at(&[Insn::Jcc(Cond::E, 0x1_4000_0100, false)], 0x1_4000_0000),
            vec![0x0F, 0x84, 0xFA, 0x00, 0x00, 0x00]
        );
        // jcc court
        assert_eq!(
            encode_at(&[Insn::Jcc(Cond::Ne, 0x1_4000_0020, true)], 0x1_4000_0000),
            vec![0x75, 0x1E]
        );
        // `lea rax, [rip → 0x140002000]` depuis 0x140001000
        assert_eq!(
            encode_at(&[Insn::Lea(Reg::Rax, Mem::rip(0x1_4000_2000))], 0x1_4000_1000),
            vec![0x48, 0x8D, 0x05, 0xF9, 0x0F, 0x00, 0x00]
        );
        // `mov rax, [rip → cible]` : le déplacement part de la fin de l'instruction
        assert_eq!(
            encode_at(&[Insn::Load(Size::Q, Reg::Rax, Mem::rip(0x1_4000_2000))], 0x1_4000_1000),
            vec![0x48, 0x8B, 0x05, 0xF9, 0x0F, 0x00, 0x00]
        );
        // Immédiat après un opérande rip : le rel32 doit en tenir compte.
        assert_eq!(
            encode_at(
                &[Insn::StoreImm32(Size::D, Mem::rip(0x1_4000_2000), 7)],
                0x1_4000_1000
            ),
            vec![0xC7, 0x05, 0xF6, 0x0F, 0x00, 0x00, 0x07, 0x00, 0x00, 0x00]
        );
    }

    #[test]
    fn formes_de_comparaison_et_conversion() {
        assert_eq!(
            encode(&[Insn::TestRR(Size::Q, Reg::Rax, Reg::Rax)]),
            vec![0x48, 0x85, 0xC0]
        );
        assert_eq!(
            encode(&[Insn::TestRR(Size::B, Reg::Rax, Reg::Rax)]),
            vec![0x84, 0xC0]
        );
        assert_eq!(
            encode(&[Insn::AluRI(Alu::Cmp, Size::D, Reg::Rax, 5)]),
            vec![0x83, 0xF8, 0x05]
        );
        assert_eq!(
            encode(&[Insn::Setcc(Cond::E, Reg::Rax)]),
            vec![0x0F, 0x94, 0xC0]
        );
        assert_eq!(
            encode(&[Insn::MovzxR(Size::B, Reg::Rax, Reg::Rcx)]),
            vec![0x0F, 0xB6, 0xC1]
        );
        assert_eq!(
            encode(&[Insn::Movsxd(Reg::Rax, Reg::Rcx)]),
            vec![0x48, 0x63, 0xC1]
        );
        assert_eq!(
            encode(&[Insn::MovRegImm64(Reg::Rax, 0x1234_5678_9abc_def0)]),
            vec![0x48, 0xB8, 0xF0, 0xDE, 0xBC, 0x9A, 0x78, 0x56, 0x34, 0x12]
        );
        assert_eq!(encode(&[Insn::Int3]), vec![0xCC]);
    }

    #[test]
    fn registres_etendus_portent_rex() {
        assert_eq!(
            encode(&[Insn::MovRR(Size::Q, Reg::R8, Reg::R9)]),
            vec![0x4D, 0x8B, 0xC1]
        );
        assert_eq!(
            encode(&[Insn::Store(Size::Q, Mem::base(Reg::R12), Reg::Rax)]),
            vec![0x49, 0x89, 0x04, 0x24]
        );
        assert_eq!(
            encode(&[Insn::Load(Size::Q, Reg::Rax, Mem::base(Reg::Rbp))]),
            vec![0x48, 0x8B, 0x45, 0x00]
        );
    }

    #[test]
    fn deplacement_32_bits_quand_disp8_ne_suffit_pas() {
        assert_eq!(
            encode(&[Insn::Load(Size::Q, Reg::Rax, Mem::base_disp(Reg::Rcx, 0x1234))]),
            vec![0x48, 0x8B, 0x81, 0x34, 0x12, 0x00, 0x00]
        );
    }
}
