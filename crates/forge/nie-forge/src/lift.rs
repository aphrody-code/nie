//! Relevé : des octets d'origine vers la **source assembleur** du dépôt.
//!
//! C'est l'étape de reverse-engineering, isolée et explicite : on désassemble un
//! corps du binaire (iced-x86), on le traduit dans le dialecte de [`nie_asm`],
//! puis — c'est le point non négociable — on **ré-encode** et on exige l'égalité
//! byte-à-byte avec l'original. Si l'encodeur ne retrouve pas exactement les
//! octets de MSVC, le relevé est rejeté : rien n'entre dans la source qui ne se
//! régénère à l'identique.
//!
//! Une fois la source écrite, la construction du binaire n'utilise plus que
//! [`nie_asm::encode`] : les octets sont **produits**, pas recopiés.

use iced_x86::{Decoder, DecoderOptions, Mnemonic, OpKind, Register};
use nie_asm::{Insn, Mem, Reg};

/// Traduit un registre iced-x86 en `(registre nie-asm, taille en octets)`.
fn reg_of(r: Register) -> Option<(Reg, u8)> {
    let size = u8::try_from(r.size()).ok()?;
    let full = match r.full_register() {
        Register::RAX => Reg::Rax,
        Register::RCX => Reg::Rcx,
        Register::RDX => Reg::Rdx,
        Register::RBX => Reg::Rbx,
        Register::RSP => Reg::Rsp,
        Register::RBP => Reg::Rbp,
        Register::RSI => Reg::Rsi,
        Register::RDI => Reg::Rdi,
        Register::R8 => Reg::R8,
        Register::R9 => Reg::R9,
        Register::R10 => Reg::R10,
        Register::R11 => Reg::R11,
        Register::R12 => Reg::R12,
        Register::R13 => Reg::R13,
        Register::R14 => Reg::R14,
        Register::R15 => Reg::R15,
        _ => return None,
    };
    Some((full, size))
}

/// Traduit l'opérande mémoire d'une instruction.
fn mem_of(i: &iced_x86::Instruction) -> Option<Mem> {
    if i.is_ip_rel_memory_operand() || i.segment_prefix() != Register::None {
        return None; // dépend de l'adresse : hors du domaine régénérable sans liens
    }
    let base = match i.memory_base() {
        Register::None => None,
        r => Some(reg_of(r)?.0),
    };
    let index = match i.memory_index() {
        Register::None => None,
        r => Some((reg_of(r)?.0, u8::try_from(i.memory_index_scale()).ok()?)),
    };
    if base.is_none() && index.is_none() {
        return None; // adresse absolue
    }
    let disp = i32::try_from(i.memory_displacement64() as i64).ok()?;
    Some(Mem { base, index, disp })
}

/// Traduit une instruction décodée dans le dialecte `nie-asm`.
fn insn_of(i: &iced_x86::Instruction) -> Option<Insn> {
    match i.mnemonic() {
        Mnemonic::Ret => match i.op_count() {
            0 => Some(Insn::Ret),
            1 => Some(Insn::RetImm(i.immediate16())),
            _ => None,
        },
        Mnemonic::Nop => Some(Insn::Nop(u8::try_from(i.len()).ok()?)),
        Mnemonic::Jmp if i.op_kind(0) == OpKind::Register => {
            Some(Insn::JmpReg(reg_of(i.op_register(0))?.0))
        }
        Mnemonic::Inc if i.op_kind(0) == OpKind::Memory && i.memory_size().size() == 4 => {
            Some(Insn::IncMem32(mem_of(i)?))
        }
        Mnemonic::And if i.op_kind(0) == OpKind::Register => {
            let (r, sz) = reg_of(i.op_register(0))?;
            (sz == 8).then_some(())?;
            Some(Insn::AndRegImm8(r, i8::try_from(i.immediate32to64()).ok()?))
        }
        Mnemonic::Shl if i.op_kind(0) == OpKind::Register => {
            let (r, sz) = reg_of(i.op_register(0))?;
            (sz == 8).then_some(())?;
            Some(Insn::ShlRegImm8(r, i.immediate8()))
        }
        Mnemonic::Or if i.op_kind(0) == OpKind::Register && i.op_kind(1) == OpKind::Register => {
            let (a, sa) = reg_of(i.op_register(0))?;
            let (b, sb) = reg_of(i.op_register(1))?;
            (sa == 8 && sb == 8).then_some(())?;
            Some(Insn::OrReg64(a, b))
        }
        Mnemonic::Xor if i.op_kind(0) == OpKind::Register && i.op_kind(1) == OpKind::Register => {
            let (a, sa) = reg_of(i.op_register(0))?;
            let (b, sb) = reg_of(i.op_register(1))?;
            match (sa, sb) {
                (1, 1) => Some(Insn::XorReg8(a, b)),
                (4, 4) => Some(Insn::XorReg32(a, b)),
                _ => None,
            }
        }
        Mnemonic::Lea => {
            let (r, sz) = reg_of(i.op_register(0))?;
            (sz == 8).then_some(())?;
            Some(Insn::Lea64(r, mem_of(i)?))
        }
        Mnemonic::Mov => match (i.op_kind(0), i.op_kind(1)) {
            (OpKind::Memory, OpKind::Register) => {
                let m = mem_of(i)?;
                let (r, sz) = reg_of(i.op_register(1))?;
                match sz {
                    4 => Some(Insn::Store32(m, r)),
                    8 => Some(Insn::Store64(m, r)),
                    _ => None,
                }
            }
            (OpKind::Register, OpKind::Memory) => {
                let m = mem_of(i)?;
                let (r, sz) = reg_of(i.op_register(0))?;
                match sz {
                    4 => Some(Insn::Load32(r, m)),
                    8 => Some(Insn::Load64(r, m)),
                    _ => None,
                }
            }
            (OpKind::Register, OpKind::Register) => {
                let (a, sa) = reg_of(i.op_register(0))?;
                let (b, sb) = reg_of(i.op_register(1))?;
                match (sa, sb) {
                    (4, 4) => Some(Insn::MovReg32(a, b)),
                    (8, 8) => Some(Insn::MovReg64(a, b)),
                    _ => None,
                }
            }
            (OpKind::Register, OpKind::Immediate8) => {
                let (r, sz) = reg_of(i.op_register(0))?;
                (sz == 1).then_some(())?;
                Some(Insn::MovRegImm8(r, i.immediate8()))
            }
            (OpKind::Register, OpKind::Immediate32) => {
                let (r, sz) = reg_of(i.op_register(0))?;
                (sz == 4).then_some(())?;
                Some(Insn::MovRegImm32(r, i.immediate32()))
            }
            _ => None,
        },
        _ => None,
    }
}

/// Relève un corps de fonction en source assembleur régénérable.
///
/// Retourne `None` dès qu'une instruction sort du dialecte, ou si le ré-encodage
/// ne redonne pas **exactement** les octets d'origine.
#[must_use]
pub fn lift_body(bytes: &[u8], va: u64) -> Option<Vec<Insn>> {
    if bytes.is_empty() {
        return None;
    }
    let mut d = Decoder::with_ip(64, bytes, va, DecoderOptions::NONE);
    let mut out = Vec::new();
    let mut consumed = 0usize;
    while d.can_decode() {
        let i = d.decode();
        if i.is_invalid() {
            return None;
        }
        consumed += i.len();
        out.push(insn_of(&i)?);
    }
    if consumed != bytes.len() {
        return None;
    }
    (nie_asm::encode(&out) == bytes).then_some(out)
}

/// Ce qui empêche un corps d'être relevé — la liste de courses du prochain lot.
///
/// Retourne la **première** cause rencontrée : soit une instruction hors
/// dialecte (`"mov"`, `"call"`, `"cvtss2si"`…), soit `"encodage"` quand toutes
/// les instructions sont traduites mais que le ré-encodage ne redonne pas les
/// octets d'origine (MSVC a choisi une autre forme — c'est une information de RE
/// précieuse, pas un échec silencieux).
#[must_use]
pub fn blocking_reason(bytes: &[u8], va: u64) -> Option<String> {
    if bytes.is_empty() {
        return Some("vide".into());
    }
    let mut d = Decoder::with_ip(64, bytes, va, DecoderOptions::NONE);
    let mut out = Vec::new();
    let mut consumed = 0usize;
    while d.can_decode() {
        let i = d.decode();
        if i.is_invalid() {
            return Some("invalide".into());
        }
        consumed += i.len();
        match insn_of(&i) {
            Some(x) => out.push(x),
            // Le nom de variante du mnémonique iced-x86 est l'identifiant lisible.
            None => return Some(format!("{:?}", i.mnemonic()).to_lowercase()),
        }
    }
    if consumed != bytes.len() {
        return Some("tronque".into());
    }
    (nie_asm::encode(&out) != bytes).then(|| "encodage".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diagnostique_les_causes_de_blocage() {
        // Encodage LLVM de `mov rax, rcx` : traduit, mais ré-encodé différemment.
        assert_eq!(
            blocking_reason(&[0x48, 0x89, 0xC8, 0xC3], 0x140_0000).as_deref(),
            Some("encodage")
        );
        // `call rel32` : instruction hors dialecte.
        assert_eq!(
            blocking_reason(&[0xE8, 0, 0, 0, 0, 0xC3], 0x140_0000).as_deref(),
            Some("call")
        );
        // `push rbp` : hors dialecte lui aussi, mais nommé précisément.
        assert_eq!(
            blocking_reason(&[0x55, 0xC3], 0x140_0000).as_deref(),
            Some("push")
        );
        // Corps relevable : aucune cause.
        assert_eq!(blocking_reason(&[0xB0, 0x01, 0xC3], 0x140_0000), None);
    }

    /// Corps réels de `nie.exe` : relevés puis ré-encodés à l'identique.
    #[test]
    fn releve_les_corps_reels() {
        let cases: [(&[u8], u64); 8] = [
            (&[0xB0, 0x01, 0xC3], 0x1_4004_d750),
            (&[0x33, 0xC0, 0xC3], 0x1_4004_d770),
            (&[0x32, 0xC0, 0xC3], 0x1_4004_d780),
            (&[0xC2, 0x00, 0x00], 0x1_4004_d760),
            (&[0x48, 0x89, 0x11, 0x48, 0x8B, 0xC1, 0xC3], 0x1_4028_7b00),
            (&[0x48, 0x8D, 0x41, 0x08, 0xC3], 0x1_401b_8020),
            (&[0xB8, 0x0D, 0x8A, 0xEC, 0xEF, 0xC3], 0x1_4111_94b0),
            (&[0x8B, 0x02, 0x89, 0x01, 0x48, 0x8B, 0xC1, 0xC3], 0x1_4004_eab0),
        ];
        for (bytes, va) in cases {
            let insns = lift_body(bytes, va)
                .unwrap_or_else(|| panic!("relevé impossible pour {bytes:02x?}"));
            assert_eq!(nie_asm::encode(&insns), bytes, "ré-encodage de {bytes:02x?}");
            // La source textuelle doit elle aussi refaire les mêmes octets.
            let line = nie_asm::to_line(&insns);
            let back = nie_asm::parse_line(&line).expect("relecture");
            assert_eq!(nie_asm::encode(&back), bytes, "aller-retour texte de `{line}`");
        }
    }

    #[test]
    fn refuse_ce_qui_ne_se_regenere_pas() {
        // `mov rax, rcx` encodé par LLVM (`48 89 C8`) : notre encodeur canonique
        // produit `48 8B C1` → le relevé DOIT échouer plutôt que mentir.
        assert!(lift_body(&[0x48, 0x89, 0xC8, 0xC3], 0x140_0000).is_none());
        // `call rel32` : dépend de la disposition.
        assert!(lift_body(&[0xE8, 0x00, 0x00, 0x00, 0x00, 0xC3], 0x140_0000).is_none());
        // `lea rax, [rip+0]` : adresse relative au pointeur d'instruction.
        assert!(lift_body(&[0x48, 0x8D, 0x05, 0x00, 0x00, 0x00, 0x00], 0x140_0000).is_none());
        // Octets invalides.
        assert!(lift_body(&[0xFF, 0xFF, 0xFF], 0x140_0000).is_none());
    }
}
