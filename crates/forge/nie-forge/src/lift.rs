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
//! [`nie_asm::encode_at`] : les octets sont **produits**, pas recopiés.

use iced_x86::{Decoder, DecoderOptions, Mnemonic, OpKind, Register};
use nie_asm::{Alu, Cond, Insn, Mem, Reg, Rm, ShiftOp, Size, UnOp};

/// Traduit un registre iced-x86 en `(registre nie-asm, taille)`.
fn reg_of(r: Register) -> Option<(Reg, Size)> {
    let size = match r.size() {
        1 => Size::B,
        2 => Size::W,
        4 => Size::D,
        8 => Size::Q,
        _ => return None,
    };
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
    if i.segment_prefix() != Register::None {
        return None;
    }
    if i.is_ip_rel_memory_operand() {
        // Adresse absolue de la cible : l'encodeur recalculera le déplacement.
        return Some(Mem::rip(i.ip_rel_memory_address()));
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
        return None; // adresse absolue non relogeable dans ce dialecte
    }
    let disp = i32::try_from(i.memory_displacement64() as i64).ok()?;
    Some(Mem {
        base,
        index,
        disp,
        rip: None,
    })
}

/// Taille d'un opérande mémoire.
fn mem_size(i: &iced_x86::Instruction) -> Option<Size> {
    match i.memory_size().size() {
        1 => Some(Size::B),
        2 => Some(Size::W),
        4 => Some(Size::D),
        8 => Some(Size::Q),
        _ => None,
    }
}


/// Opérande `r/m` d'une instruction, quel que soit son emplacement.
fn rm_of(i: &iced_x86::Instruction, op: u32) -> Option<Rm> {
    match i.op_kind(op) {
        OpKind::Register => Some(Rm::R(reg_of(i.op_register(op))?.0)),
        OpKind::Memory => Some(Rm::M(mem_of(i)?)),
        _ => None,
    }
}

/// Taille effective de l'opérande `r/m` (registre ou mémoire).
fn rm_size(i: &iced_x86::Instruction, op: u32) -> Option<Size> {
    match i.op_kind(op) {
        OpKind::Register => Some(reg_of(i.op_register(op))?.1),
        OpKind::Memory => mem_size(i),
        _ => None,
    }
}

/// Immédiat 32 bits d'une instruction, motif de bits conservé.
fn imm32_of(i: &iced_x86::Instruction) -> Option<i32> {
    let v = i.immediate32to64();
    i32::try_from(v).ok().or_else(|| u32::try_from(v).ok().map(|x| x as i32))
}

/// Groupe ALU correspondant au mnémonique.
fn alu_of(m: Mnemonic) -> Option<Alu> {
    Some(match m {
        Mnemonic::Add => Alu::Add,
        Mnemonic::Or => Alu::Or,
        Mnemonic::Adc => Alu::Adc,
        Mnemonic::Sbb => Alu::Sbb,
        Mnemonic::And => Alu::And,
        Mnemonic::Sub => Alu::Sub,
        Mnemonic::Xor => Alu::Xor,
        Mnemonic::Cmp => Alu::Cmp,
        _ => return None,
    })
}

/// Condition d'un `jcc`/`setcc` à partir du mnémonique.
fn cond_of(m: Mnemonic) -> Option<Cond> {
    Some(match m {
        Mnemonic::Jo | Mnemonic::Seto => Cond::O,
        Mnemonic::Jno | Mnemonic::Setno => Cond::No,
        Mnemonic::Jb | Mnemonic::Setb => Cond::B,
        Mnemonic::Jae | Mnemonic::Setae => Cond::Ae,
        Mnemonic::Je | Mnemonic::Sete => Cond::E,
        Mnemonic::Jne | Mnemonic::Setne => Cond::Ne,
        Mnemonic::Jbe | Mnemonic::Setbe => Cond::Be,
        Mnemonic::Ja | Mnemonic::Seta => Cond::A,
        Mnemonic::Js | Mnemonic::Sets => Cond::S,
        Mnemonic::Jns | Mnemonic::Setns => Cond::Ns,
        Mnemonic::Jp | Mnemonic::Setp => Cond::P,
        Mnemonic::Jnp | Mnemonic::Setnp => Cond::Np,
        Mnemonic::Jl | Mnemonic::Setl => Cond::L,
        Mnemonic::Jge | Mnemonic::Setge => Cond::Ge,
        Mnemonic::Jle | Mnemonic::Setle => Cond::Le,
        Mnemonic::Jg | Mnemonic::Setg => Cond::G,
        _ => return None,
    })
}

/// Traduit une instruction décodée dans le dialecte `nie-asm`.
#[allow(clippy::too_many_lines)]
fn insn_of(i: &iced_x86::Instruction) -> Option<Insn> {
    // Groupe ALU : quatre formes d'opérandes.
    if let Some(op) = alu_of(i.mnemonic()) {
        return match (i.op_kind(0), i.op_kind(1)) {
            (OpKind::Register, OpKind::Register) => {
                let (a, sa) = reg_of(i.op_register(0))?;
                let (b, sb) = reg_of(i.op_register(1))?;
                (sa == sb).then_some(Insn::AluRR(op, sa, a, b))
            }
            (OpKind::Register, OpKind::Memory) => {
                let (a, sa) = reg_of(i.op_register(0))?;
                Some(Insn::AluRM(op, sa, a, mem_of(i)?))
            }
            (OpKind::Memory, OpKind::Register) => {
                let (b, sb) = reg_of(i.op_register(1))?;
                Some(Insn::AluMR(op, sb, mem_of(i)?, b))
            }
            (OpKind::Register, _) => {
                let (a, sa) = reg_of(i.op_register(0))?;
                Some(Insn::AluRI(op, sa, a, imm32_of(i)?))
            }
            (OpKind::Memory, _) => Some(Insn::AluI(
                op,
                mem_size(i)?,
                Rm::M(mem_of(i)?),
                imm32_of(i)?,
            )),
            _ => None,
        };
    }
    if let Some(c) = cond_of(i.mnemonic()) {
        return match i.op_kind(0) {
            OpKind::NearBranch64 => Some(Insn::Jcc(c, i.near_branch_target(), i.len() <= 2)),
            OpKind::Register => Some(Insn::Setcc(c, reg_of(i.op_register(0))?.0)),
            _ => None,
        };
    }

    match i.mnemonic() {
        Mnemonic::Ret => match i.op_count() {
            0 => Some(Insn::Ret),
            1 => Some(Insn::RetImm(i.immediate16())),
            _ => None,
        },
        Mnemonic::Int3 => Some(Insn::Int3),
        Mnemonic::Nop => Some(Insn::Nop(u8::try_from(i.len()).ok()?)),
        Mnemonic::Push => match i.op_kind(0) {
            OpKind::Register => Some(Insn::Push(reg_of(i.op_register(0))?.0)),
            OpKind::Memory => Some(Insn::Un(UnOp::PushRm, Size::D, Rm::M(mem_of(i)?))),
            _ => None,
        },
        Mnemonic::Pop if i.op_kind(0) == OpKind::Register => {
            Some(Insn::Pop(reg_of(i.op_register(0))?.0))
        }
        Mnemonic::Call if i.op_kind(0) == OpKind::NearBranch64 => {
            Some(Insn::Call(i.near_branch_target()))
        }
        Mnemonic::Jmp => match i.op_kind(0) {
            OpKind::NearBranch64 => Some(Insn::Jmp(i.near_branch_target(), i.len() <= 2)),
            OpKind::Register => Some(Insn::JmpReg(reg_of(i.op_register(0))?.0)),
            OpKind::Memory => Some(Insn::Un(UnOp::JmpInd, Size::D, Rm::M(mem_of(i)?))),
            _ => None,
        },
        Mnemonic::Test if i.op_kind(0) == OpKind::Register && i.op_kind(1) == OpKind::Register => {
            let (a, sa) = reg_of(i.op_register(0))?;
            let (b, sb) = reg_of(i.op_register(1))?;
            (sa == sb).then_some(Insn::TestRR(sa, a, b))
        }
        Mnemonic::Shl | Mnemonic::Shr | Mnemonic::Sar
            if i.op_kind(0) == OpKind::Register && i.op_kind(1) == OpKind::Immediate8 =>
        {
            let (r, sz) = reg_of(i.op_register(0))?;
            let op = match i.mnemonic() {
                Mnemonic::Shl => ShiftOp::Shl,
                Mnemonic::Shr => ShiftOp::Shr,
                _ => ShiftOp::Sar,
            };
            Some(Insn::Shift(op, sz, r, i.immediate8()))
        }
        Mnemonic::Movzx => {
            let (dst, dsz) = reg_of(i.op_register(0))?;
            (dsz == Size::D).then_some(())?;
            match i.op_kind(1) {
                OpKind::Register => {
                    let (src, ssz) = reg_of(i.op_register(1))?;
                    Some(Insn::MovzxR(ssz, dst, src))
                }
                OpKind::Memory => Some(Insn::MovzxM(mem_size(i)?, dst, mem_of(i)?)),
                _ => None,
            }
        }
        Mnemonic::Movsxd if i.op_kind(1) == OpKind::Register => Some(Insn::Movsxd(
            reg_of(i.op_register(0))?.0,
            reg_of(i.op_register(1))?.0,
        )),
        Mnemonic::Inc => Some(Insn::Un(UnOp::Inc, rm_size(i, 0)?, rm_of(i, 0)?)),
        Mnemonic::Lea => {
            let (r, sz) = reg_of(i.op_register(0))?;
            match sz {
                Size::Q => Some(Insn::Lea(r, mem_of(i)?)),
                Size::D => Some(Insn::LeaD(r, mem_of(i)?)),
                _ => None,
            }
        }
        // Appels et sauts indirects : `call qword [rip …]` (imports), `jmp [rax]` (vtables).
        Mnemonic::Call => Some(Insn::Un(UnOp::CallInd, Size::D, rm_of(i, 0)?)),
        Mnemonic::Dec => Some(Insn::Un(UnOp::Dec, rm_size(i, 0)?, rm_of(i, 0)?)),
        Mnemonic::Not => Some(Insn::Un(UnOp::Not, rm_size(i, 0)?, rm_of(i, 0)?)),
        Mnemonic::Neg => Some(Insn::Un(UnOp::Neg, rm_size(i, 0)?, rm_of(i, 0)?)),
        Mnemonic::Test => match i.op_kind(1) {
            OpKind::Register => {
                let (r, rsz) = reg_of(i.op_register(1))?;
                Some(Insn::Test(rsz, rm_of(i, 0)?, r))
            }
            _ => Some(Insn::TestI(rm_size(i, 0)?, rm_of(i, 0)?, imm32_of(i)?)),
        },
        Mnemonic::Imul if i.op_count() == 2 => {
            let (r, sz) = reg_of(i.op_register(0))?;
            Some(Insn::Imul(sz, r, rm_of(i, 1)?))
        }
        Mnemonic::Imul if i.op_count() == 3 => {
            let (r, sz) = reg_of(i.op_register(0))?;
            Some(Insn::ImulI(sz, r, rm_of(i, 1)?, imm32_of(i)?))
        }
        Mnemonic::Movsx => {
            let (r, dsz) = reg_of(i.op_register(0))?;
            let ssz = match i.op_kind(1) {
                OpKind::Register => reg_of(i.op_register(1))?.1,
                OpKind::Memory => mem_size(i)?,
                _ => return None,
            };
            Some(Insn::Movsx(ssz, dsz, r, rm_of(i, 1)?))
        }
        Mnemonic::Mov => match (i.op_kind(0), i.op_kind(1)) {
            (OpKind::Memory, OpKind::Register) => {
                let (r, sz) = reg_of(i.op_register(1))?;
                Some(Insn::Store(sz, mem_of(i)?, r))
            }
            (OpKind::Register, OpKind::Memory) => {
                let (r, sz) = reg_of(i.op_register(0))?;
                Some(Insn::Load(sz, r, mem_of(i)?))
            }
            (OpKind::Register, OpKind::Register) => {
                let (a, sa) = reg_of(i.op_register(0))?;
                let (b, sb) = reg_of(i.op_register(1))?;
                (sa == sb).then_some(Insn::MovRR(sa, a, b))
            }
            (OpKind::Register, OpKind::Immediate8) => {
                let (r, sz) = reg_of(i.op_register(0))?;
                (sz == Size::B).then_some(Insn::MovRegImm8(r, i.immediate8()))
            }
            (OpKind::Register, OpKind::Immediate32) => {
                let (r, sz) = reg_of(i.op_register(0))?;
                (sz == Size::D).then_some(Insn::MovRegImm32(r, i.immediate32()))
            }
            (OpKind::Register, OpKind::Immediate64) => {
                let (r, sz) = reg_of(i.op_register(0))?;
                (sz == Size::Q).then_some(Insn::MovRegImm64(r, i.immediate64()))
            }
            (_, OpKind::Immediate8 | OpKind::Immediate16 | OpKind::Immediate32)
                if i.op_kind(0) == OpKind::Memory =>
            {
                Some(Insn::MovI(mem_size(i)?, Rm::M(mem_of(i)?), imm32_of(i)?))
            }
            (OpKind::Register, OpKind::Immediate32to64) => {
                let (r, sz) = reg_of(i.op_register(0))?;
                (sz == Size::Q).then_some(Insn::MovI(sz, Rm::R(r), imm32_of(i).unwrap_or_default()))
            }
            _ => None,
        },
        _ => None,
    }
}

/// Relève un corps de fonction en source assembleur régénérable.
///
/// Retourne `None` dès qu'une instruction sort du dialecte, ou si le ré-encodage
/// **à l'adresse réelle du corps** ne redonne pas exactement les octets d'origine.
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
    if nie_asm::encode_at(&out, va) != bytes {
        return None;
    }
    // Le relevé n'est acquis que si la **source textuelle** se relit et redonne
    // les mêmes octets : c'est elle qui sera commitée et rejouée, pas la
    // structure en mémoire. Sans ce tour complet, un corps pourrait entrer dans
    // la source sans pouvoir en ressortir.
    let line = nie_asm::to_line(&out);
    let back = nie_asm::parse_line(&line).ok()?;
    (nie_asm::encode_at(&back, va) == bytes).then_some(out)
}

/// Ce qui empêche un corps d'être relevé — la liste de courses du prochain lot.
///
/// Retourne la **première** cause rencontrée : soit une instruction hors
/// dialecte (`"movss"`, `"cvtss2si"`…), soit `"encodage"` quand toutes les
/// instructions sont traduites mais que le ré-encodage ne redonne pas les octets
/// d'origine (MSVC a choisi une autre forme — information de RE précieuse, pas un
/// échec silencieux).
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
            None => return Some(format!("{:?}", i.mnemonic()).to_lowercase()),
        }
    }
    if consumed != bytes.len() {
        return Some("tronque".into());
    }
    (nie_asm::encode_at(&out, va) != bytes).then(|| "encodage".to_string())
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
        // Instruction SSE hors dialecte.
        assert_eq!(
            blocking_reason(&[0xF3, 0x0F, 0x10, 0x01, 0xC3], 0x140_0000).as_deref(),
            Some("movss")
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
            assert_eq!(nie_asm::encode_at(&insns, va), bytes);
            let line = nie_asm::to_line(&insns);
            let back = nie_asm::parse_line(&line).expect("relecture");
            assert_eq!(nie_asm::encode_at(&back, va), bytes, "aller-retour de `{line}`");
        }
    }

    /// Un vrai prologue/épilogue MSVC avec appel et saut : le cas qui bloquait
    /// tout le `.text` avant l'extension du dialecte.
    #[test]
    fn releve_une_fonction_avec_prologue_appel_et_saut() {
        // mov [rsp+8],rbx ; push rdi ; sub rsp,0x20 ; mov rbx,rcx ;
        // call +0x1000 ; test rax,rax ; je +6 ; lea rcx,[rip+0x1000] ;
        // add rsp,0x20 ; pop rdi ; ret
        let bytes: &[u8] = &[
            0x48, 0x89, 0x5C, 0x24, 0x08, 0x57, 0x48, 0x83, 0xEC, 0x20, 0x48, 0x8B, 0xD9, 0xE8,
            0x00, 0x10, 0x00, 0x00, 0x48, 0x85, 0xC0, 0x74, 0x07, 0x48, 0x8D, 0x0D, 0x00, 0x10,
            0x00, 0x00, 0x48, 0x83, 0xC4, 0x20, 0x5F, 0xC3,
        ];
        let va = 0x1_4000_1000;
        let insns = lift_body(bytes, va).expect("relevé du prologue complet");
        assert_eq!(nie_asm::encode_at(&insns, va), bytes);
        let line = nie_asm::to_line(&insns);
        assert!(line.contains("push rdi"), "{line}");
        assert!(line.contains("sub rsp, 0x20"), "{line}");
        assert!(line.contains("call 0x140002012"), "{line}");
        assert!(line.contains("lea rcx, [rip 0x14000201e]"), "{line}");
        // Aller-retour texte, encodé à la même adresse.
        let back = nie_asm::parse_line(&line).expect("relecture");
        assert_eq!(nie_asm::encode_at(&back, va), bytes);
    }

    #[test]
    fn refuse_ce_qui_ne_se_regenere_pas() {
        assert!(lift_body(&[0x48, 0x89, 0xC8, 0xC3], 0x140_0000).is_none());
        assert!(lift_body(&[0xFF, 0xFF, 0xFF], 0x140_0000).is_none());
    }
}
