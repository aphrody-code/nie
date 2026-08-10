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
use nie_asm::{Alu, BitOp, Cond, CvtOp, Insn, Mem, NoOp, Reg, Rm, ShiftOp, Size, SseOp, UnOp, Xmm, XmmRm};

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


/// Traduit un registre vectoriel iced-x86.
fn xmm_of(r: Register) -> Option<Xmm> {
    r.is_xmm().then(|| u8::try_from(r.number()).ok())?.map(Xmm)
}

/// Opération SSE correspondant au mnémonique.
fn sse_of(m: Mnemonic) -> Option<SseOp> {
    Some(match m {
        Mnemonic::Movaps => SseOp::Movaps,
        Mnemonic::Movapd => SseOp::Movapd,
        Mnemonic::Movups => SseOp::Movups,
        Mnemonic::Movupd => SseOp::Movupd,
        Mnemonic::Movss => SseOp::Movss,
        Mnemonic::Movsd => SseOp::Movsd,
        Mnemonic::Movdqa => SseOp::Movdqa,
        Mnemonic::Movdqu => SseOp::Movdqu,
        Mnemonic::Xorps => SseOp::Xorps,
        Mnemonic::Xorpd => SseOp::Xorpd,
        Mnemonic::Andps => SseOp::Andps,
        Mnemonic::Andpd => SseOp::Andpd,
        Mnemonic::Andnps => SseOp::Andnps,
        Mnemonic::Orps => SseOp::Orps,
        Mnemonic::Addps => SseOp::Addps,
        Mnemonic::Addss => SseOp::Addss,
        Mnemonic::Addsd => SseOp::Addsd,
        Mnemonic::Subps => SseOp::Subps,
        Mnemonic::Subss => SseOp::Subss,
        Mnemonic::Subsd => SseOp::Subsd,
        Mnemonic::Mulps => SseOp::Mulps,
        Mnemonic::Mulss => SseOp::Mulss,
        Mnemonic::Mulsd => SseOp::Mulsd,
        Mnemonic::Divps => SseOp::Divps,
        Mnemonic::Divss => SseOp::Divss,
        Mnemonic::Divsd => SseOp::Divsd,
        Mnemonic::Minps => SseOp::Minps,
        Mnemonic::Minss => SseOp::Minss,
        Mnemonic::Maxps => SseOp::Maxps,
        Mnemonic::Maxss => SseOp::Maxss,
        Mnemonic::Sqrtps => SseOp::Sqrtps,
        Mnemonic::Sqrtss => SseOp::Sqrtss,
        Mnemonic::Comiss => SseOp::Comiss,
        Mnemonic::Comisd => SseOp::Comisd,
        Mnemonic::Ucomiss => SseOp::Ucomiss,
        Mnemonic::Ucomisd => SseOp::Ucomisd,
        Mnemonic::Unpcklps => SseOp::Unpcklps,
        Mnemonic::Unpckhps => SseOp::Unpckhps,
        Mnemonic::Cvtss2sd => SseOp::Cvtss2sd,
        Mnemonic::Cvtsd2ss => SseOp::Cvtsd2ss,
        Mnemonic::Rcpss => SseOp::Rcpss,
        Mnemonic::Rsqrtss => SseOp::Rsqrtss,
        Mnemonic::Shufps => SseOp::Shufps,
        Mnemonic::Shufpd => SseOp::Shufpd,
        Mnemonic::Pshufd => SseOp::Pshufd,
        Mnemonic::Movlhps => SseOp::Movlhps,
        Mnemonic::Movhlps => SseOp::Movhlps,
        Mnemonic::Movlps => SseOp::Movlps,
        Mnemonic::Movhps => SseOp::Movhps,
        Mnemonic::Insertps => SseOp::Insertps,
        Mnemonic::Blendps => SseOp::Blendps,
        Mnemonic::Cvtdq2ps => SseOp::Cvtdq2ps,
        Mnemonic::Cvtps2dq => SseOp::Cvtps2dq,
        Mnemonic::Cvttps2dq => SseOp::Cvttps2dq,
        Mnemonic::Cvtps2pd => SseOp::Cvtps2pd,
        Mnemonic::Cvtpd2ps => SseOp::Cvtpd2ps,
        Mnemonic::Cvtdq2pd => SseOp::Cvtdq2pd,
        Mnemonic::Haddps => SseOp::Haddps,
        Mnemonic::Hsubps => SseOp::Hsubps,
        Mnemonic::Pxor => SseOp::Pxor,
        Mnemonic::Por => SseOp::Por,
        Mnemonic::Pand => SseOp::Pand,
        Mnemonic::Unpcklpd => SseOp::Unpcklpd,
        _ => return None,
    })
}


/// Conversion SSE correspondant au mnémonique.
fn cvt_of(m: Mnemonic) -> Option<CvtOp> {
    Some(match m {
        Mnemonic::Cvtsi2ss => CvtOp::Cvtsi2ss,
        Mnemonic::Cvtsi2sd => CvtOp::Cvtsi2sd,
        Mnemonic::Cvttss2si => CvtOp::Cvttss2si,
        Mnemonic::Cvttsd2si => CvtOp::Cvttsd2si,
        Mnemonic::Cvtss2si => CvtOp::Cvtss2si,
        Mnemonic::Cvtsd2si => CvtOp::Cvtsd2si,
        _ => return None,
    })
}

/// Condition d'un `cmovcc`.
fn cmov_cond(m: Mnemonic) -> Option<Cond> {
    Some(match m {
        Mnemonic::Cmovo => Cond::O,
        Mnemonic::Cmovno => Cond::No,
        Mnemonic::Cmovb => Cond::B,
        Mnemonic::Cmovae => Cond::Ae,
        Mnemonic::Cmove => Cond::E,
        Mnemonic::Cmovne => Cond::Ne,
        Mnemonic::Cmovbe => Cond::Be,
        Mnemonic::Cmova => Cond::A,
        Mnemonic::Cmovs => Cond::S,
        Mnemonic::Cmovns => Cond::Ns,
        Mnemonic::Cmovp => Cond::P,
        Mnemonic::Cmovnp => Cond::Np,
        Mnemonic::Cmovl => Cond::L,
        Mnemonic::Cmovge => Cond::Ge,
        Mnemonic::Cmovle => Cond::Le,
        Mnemonic::Cmovg => Cond::G,
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



/// Vrai si l'immédiat de l'instruction est encodé sur sa forme **longue**
/// (`81 /n id`) alors qu'une forme courte aurait suffi.
///
/// iced distingue `Immediate8to32`/`Immediate8to64` (forme `83`) de
/// `Immediate32`/`Immediate32to64` (forme `81`) : c'est exactement le choix que
/// la source doit conserver pour redonner les octets de MSVC.
fn imm_is_wide(i: &iced_x86::Instruction) -> bool {
    matches!(
        i.op_kind(1),
        OpKind::Immediate32 | OpKind::Immediate32to64 | OpKind::Immediate16
    )
}

/// Forme `bt`/`bts`/`btr`/`btc`, registre ou immédiat.
fn bit_insn(i: &iced_x86::Instruction, op: BitOp) -> Option<Insn> {
    let sz = rm_size(i, 0)?;
    let rm = rm_of(i, 0)?;
    match i.op_kind(1) {
        OpKind::Register => Some(Insn::BitRm(op, sz, rm, reg_of(i.op_register(1))?.0)),
        OpKind::Immediate8 => Some(Insn::BitImm(op, sz, rm, i.immediate8())),
        _ => None,
    }
}

/// Traduit une instruction décodée dans le dialecte `nie-asm`.
#[allow(clippy::too_many_lines)]
fn insn_of(i: &iced_x86::Instruction) -> Option<Insn> {
    if let Some(c) = cmov_cond(i.mnemonic()) {
        let (r, sz) = reg_of(i.op_register(0))?;
        return Some(Insn::Cmov(c, sz, r, rm_of(i, 1)?));
    }
    if let Some(op) = cvt_of(i.mnemonic()) {
        return if i.op_register(0).is_xmm() {
            let sz = rm_size(i, 1)?;
            Some(Insn::CvtToXmm(op, xmm_of(i.op_register(0))?, rm_of(i, 1)?, sz))
        } else {
            let (r, sz) = reg_of(i.op_register(0))?;
            let src = match i.op_kind(1) {
                OpKind::Register => XmmRm::X(xmm_of(i.op_register(1))?),
                OpKind::Memory => XmmRm::M(mem_of(i)?),
                _ => return None,
            };
            Some(Insn::CvtToReg(op, r, src, sz))
        };
    }
    // SSE à immédiat (`shufps xmm0, xmm1, 0x4e`).
    if let Some(op) = sse_of(i.mnemonic())
        && i.op_count() == 3
    {
        let src = match i.op_kind(1) {
            OpKind::Register => XmmRm::X(xmm_of(i.op_register(1))?),
            OpKind::Memory => XmmRm::M(mem_of(i)?),
            _ => return None,
        };
        return Some(Insn::SseI(op, xmm_of(i.op_register(0))?, src, i.immediate8()));
    }
    // SSE : `xmm ← xmm/m` ou `[mem] ← xmm`.
    if let Some(op) = sse_of(i.mnemonic()) {
        return match (i.op_kind(0), i.op_kind(1)) {
            (OpKind::Register, OpKind::Register) => Some(Insn::Sse(
                op,
                xmm_of(i.op_register(0))?,
                XmmRm::X(xmm_of(i.op_register(1))?),
            )),
            (OpKind::Register, OpKind::Memory) => Some(Insn::Sse(
                op,
                xmm_of(i.op_register(0))?,
                XmmRm::M(mem_of(i)?),
            )),
            (OpKind::Memory, OpKind::Register) => {
                Some(Insn::SseStore(op, mem_of(i)?, xmm_of(i.op_register(1))?))
            }
            _ => None,
        };
    }
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
                Some(Insn::AluRI(op, sa, a, imm32_of(i)?, imm_is_wide(i)))
            }
            (OpKind::Memory, _) => Some(Insn::AluI(
                op,
                mem_size(i)?,
                Rm::M(mem_of(i)?),
                imm32_of(i)?,
                imm_is_wide(i),
            )),
            _ => None,
        };
    }
    if let Some(c) = cond_of(i.mnemonic()) {
        return match i.op_kind(0) {
            OpKind::NearBranch64 => Some(Insn::Jcc(c, i.near_branch_target(), i.len() <= 2)),
            OpKind::Register | OpKind::Memory => Some(Insn::SetccRm(c, rm_of(i, 0)?)),
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
        Mnemonic::Cwde => Some(Insn::NoOperand(NoOp::Cwde)),
        Mnemonic::Cdqe => Some(Insn::NoOperand(NoOp::Cdqe)),
        Mnemonic::Cdq => Some(Insn::NoOperand(NoOp::Cdq)),
        Mnemonic::Cqo => Some(Insn::NoOperand(NoOp::Cqo)),
        Mnemonic::Leave => Some(Insn::NoOperand(NoOp::Leave)),
        Mnemonic::Bt => Some(bit_insn(i, BitOp::Bt)?),
        Mnemonic::Bts => Some(bit_insn(i, BitOp::Bts)?),
        Mnemonic::Btr => Some(bit_insn(i, BitOp::Btr)?),
        Mnemonic::Btc => Some(bit_insn(i, BitOp::Btc)?),
        Mnemonic::Shl | Mnemonic::Shr | Mnemonic::Sar
            if i.op_kind(1) == OpKind::Register =>
        {
            let op = match i.mnemonic() {
                Mnemonic::Shl => ShiftOp::Shl,
                Mnemonic::Shr => ShiftOp::Shr,
                _ => ShiftOp::Sar,
            };
            (i.op_register(1) == Register::CL).then_some(())?;
            Some(Insn::ShiftCl(op, rm_size(i, 0)?, rm_of(i, 0)?))
        }
        Mnemonic::Movzx => {
            let (dst, dsz) = reg_of(i.op_register(0))?;
            Some(Insn::MovzxRm(rm_size(i, 1)?, dsz, dst, rm_of(i, 1)?))
        }
        Mnemonic::Movsxd => Some(Insn::MovsxdRm(reg_of(i.op_register(0))?.0, rm_of(i, 1)?)),
        Mnemonic::Mul => Some(Insn::Un(UnOp::Mul, rm_size(i, 0)?, rm_of(i, 0)?)),
        Mnemonic::Div => Some(Insn::Un(UnOp::Div, rm_size(i, 0)?, rm_of(i, 0)?)),
        Mnemonic::Idiv => Some(Insn::Un(UnOp::Idiv, rm_size(i, 0)?, rm_of(i, 0)?)),
        Mnemonic::Movd => {
            if i.op_register(0).is_xmm() {
                Some(Insn::MovdToXmm(xmm_of(i.op_register(0))?, rm_of(i, 1)?, Size::D))
            } else {
                Some(Insn::MovdToRm(rm_of(i, 0)?, xmm_of(i.op_register(1))?, Size::D))
            }
        }
        Mnemonic::Movq if i.op_register(0).is_xmm() != i.op_register(1).is_xmm() => {
            if i.op_register(0).is_xmm() {
                Some(Insn::MovdToXmm(xmm_of(i.op_register(0))?, rm_of(i, 1)?, Size::Q))
            } else {
                Some(Insn::MovdToRm(rm_of(i, 0)?, xmm_of(i.op_register(1))?, Size::Q))
            }
        }
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
        Mnemonic::Imul if i.op_count() == 1 => {
            Some(Insn::Un(UnOp::Imul1, rm_size(i, 0)?, rm_of(i, 0)?))
        }
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
            Some(Insn::MovsxRm(rm_size(i, 1)?, dsz, r, rm_of(i, 1)?))
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
            // `mov qword ptr [rsp+28h], 0` : iced classe l'immédiat en
            // `Immediate32to64` (étendu en signe), pas `Immediate32`. L'oublier
            // laissait 6,6 Mo de `.text` hors du dialecte.
            (
                OpKind::Memory,
                OpKind::Immediate8
                | OpKind::Immediate16
                | OpKind::Immediate32
                | OpKind::Immediate32to64,
            ) => Some(Insn::MovI(mem_size(i)?, Rm::M(mem_of(i)?), imm32_of(i)?)),
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
    blocking_detail(bytes, va).map(|d| d.cause)
}

/// Diagnostic complet d'un blocage : la cause **et** l'instruction fautive
/// désassemblée.
///
/// Le mnémonique seul ne suffit pas à cibler le prochain lot : `mov` peut
/// désigner dix formes différentes. Rendre l'instruction exacte transforme la
/// liste de courses en instructions à implémenter, sans deviner.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Blockage {
    /// Mnémonique fautif, ou `encodage` / `invalide` / `tronque`.
    pub cause: String,
    /// Instruction désassemblée (syntaxe Intel), pour cibler l'implémentation.
    pub sample: String,
}

/// Analyse un corps et rend le premier obstacle rencontré, s'il y en a un.
#[must_use]
pub fn blocking_detail(bytes: &[u8], va: u64) -> Option<Blockage> {
    use iced_x86::{Formatter, IntelFormatter};

    if bytes.is_empty() {
        return Some(Blockage {
            cause: "vide".into(),
            sample: String::new(),
        });
    }
    let mut fmt = IntelFormatter::new();
    let mut show = |i: &iced_x86::Instruction| {
        let mut s = String::new();
        fmt.format(i, &mut s);
        s
    };

    let mut d = Decoder::with_ip(64, bytes, va, DecoderOptions::NONE);
    let mut out = Vec::new();
    let mut consumed = 0usize;
    while d.can_decode() {
        let i = d.decode();
        if i.is_invalid() {
            return Some(Blockage {
                cause: "invalide".into(),
                sample: String::new(),
            });
        }
        consumed += i.len();
        match insn_of(&i) {
            Some(x) => out.push(x),
            None => {
                return Some(Blockage {
                    cause: format!("{:?}", i.mnemonic()).to_lowercase(),
                    sample: show(&i),
                });
            }
        }
    }
    if consumed != bytes.len() {
        return Some(Blockage {
            cause: "tronque".into(),
            sample: String::new(),
        });
    }
    // Toutes les instructions sont traduites : c'est le ré-encodage qui diverge.
    // On isole l'instruction fautive en comparant octet par octet.
    let got = nie_asm::encode_at(&out, va);
    if got == bytes {
        return None;
    }
    let mut d = Decoder::with_ip(64, bytes, va, DecoderOptions::NONE);
    let mut off = 0usize;
    for insn in &out {
        let i = d.decode();
        let mine = nie_asm::encode_at(core::slice::from_ref(insn), va + off as u64);
        if bytes.get(off..off + i.len()) != Some(&mine[..]) {
            return Some(Blockage {
                cause: "encodage".into(),
                sample: show(&i),
            });
        }
        off += i.len();
    }
    Some(Blockage {
        cause: "encodage".into(),
        sample: String::new(),
    })
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
        // `movss xmm0, [rcx] ; ret` : desormais DANS le dialecte.
        assert_eq!(blocking_reason(&[0xF3, 0x0F, 0x10, 0x01, 0xC3], 0x140_0000), None);
        // `cvttss2si eax, xmm0 ; ret` : desormais dans le dialecte.
        assert_eq!(blocking_reason(&[0xF3, 0x0F, 0x2C, 0xC0, 0xC3], 0x140_0000), None);
        // SSE2 entier : toujours hors dialecte (`paddw xmm0, xmm1`).
        assert_eq!(
            blocking_reason(&[0x66, 0x0F, 0xFD, 0xC1, 0xC3], 0x140_0000).as_deref(),
            Some("paddw")
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
