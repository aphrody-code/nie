//! Forme **textuelle** des instructions : la source assembleur du dépôt.
//!
//! Ce module donne aux corps régénérés une représentation lisible et
//! diff-able — `mov eax, 0xefec8a0d ; ret` — plutôt qu'un tas d'octets. C'est
//! elle qui est commitée dans `forge/asm/*.s` : le binaire se reconstruit **à
//! partir de cette source**, jamais à partir du fichier d'origine.
//!
//! Le couple [`Insn::to_text`] / [`parse_insn`] est un aller-retour strict :
//! tout ce qui s'écrit se relit, et le test de propriété le vérifie.

use crate::{Insn, Mem, Reg};
use alloc::format;
use alloc::string::{String, ToString};
use alloc::vec::Vec;

/// Erreur d'analyse d'une ligne assembleur.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParseError(pub String);

impl core::fmt::Display for ParseError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        write!(f, "assembleur : {}", self.0)
    }
}

const R64: [&str; 16] = [
    "rax", "rcx", "rdx", "rbx", "rsp", "rbp", "rsi", "rdi", "r8", "r9", "r10", "r11", "r12", "r13",
    "r14", "r15",
];
const R32: [&str; 16] = [
    "eax", "ecx", "edx", "ebx", "esp", "ebp", "esi", "edi", "r8d", "r9d", "r10d", "r11d", "r12d",
    "r13d", "r14d", "r15d",
];
const R8: [&str; 16] = [
    "al", "cl", "dl", "bl", "spl", "bpl", "sil", "dil", "r8b", "r9b", "r10b", "r11b", "r12b",
    "r13b", "r14b", "r15b",
];

const REGS: [Reg; 16] = [
    Reg::Rax,
    Reg::Rcx,
    Reg::Rdx,
    Reg::Rbx,
    Reg::Rsp,
    Reg::Rbp,
    Reg::Rsi,
    Reg::Rdi,
    Reg::R8,
    Reg::R9,
    Reg::R10,
    Reg::R11,
    Reg::R12,
    Reg::R13,
    Reg::R14,
    Reg::R15,
];

fn reg_name(r: Reg, size: u8) -> &'static str {
    let i = r.num() as usize;
    match size {
        1 => R8[i],
        4 => R32[i],
        _ => R64[i],
    }
}

/// Résout un nom de registre en `(registre, taille en octets)`.
fn reg_of(name: &str) -> Option<(Reg, u8)> {
    let n = name.trim();
    if let Some(i) = R64.iter().position(|x| *x == n) {
        return Some((REGS[i], 8));
    }
    if let Some(i) = R32.iter().position(|x| *x == n) {
        return Some((REGS[i], 4));
    }
    if let Some(i) = R8.iter().position(|x| *x == n) {
        return Some((REGS[i], 1));
    }
    None
}

fn fmt_disp(d: i32) -> String {
    if d == 0 {
        String::new()
    } else if d > 0 {
        format!("+{d:#x}")
    } else {
        format!("-{:#x}", d.unsigned_abs())
    }
}

fn mem_text(m: Mem) -> String {
    let mut s = String::from("[");
    if let Some(b) = m.base {
        s.push_str(reg_name(b, 8));
    }
    if let Some((i, sc)) = m.index {
        if m.base.is_some() {
            s.push('+');
        }
        s.push_str(reg_name(i, 8));
        s.push_str(&format!("*{sc}"));
    }
    s.push_str(&fmt_disp(m.disp));
    s.push(']');
    s
}

fn parse_int(s: &str) -> Option<i64> {
    let t = s.trim();
    let (neg, t) = t.strip_prefix('-').map_or((false, t), |r| (true, r));
    let v = if let Some(h) = t.strip_prefix("0x").or_else(|| t.strip_prefix("0X")) {
        i64::from_str_radix(h, 16).ok()?
    } else {
        t.parse::<i64>().ok()?
    };
    Some(if neg { -v } else { v })
}

fn parse_mem(s: &str) -> Option<Mem> {
    let inner = s.trim().strip_prefix('[')?.strip_suffix(']')?;
    let mut m = Mem::default();
    let mut rest = inner;
    // Premier terme : base ou index.
    let mut first = true;
    while !rest.is_empty() {
        let (sign, term_start) = if first {
            (1i32, 0usize)
        } else {
            match rest.as_bytes()[0] {
                b'+' => (1, 1),
                b'-' => (-1, 1),
                _ => return None,
            }
        };
        let body = &rest[term_start..];
        let stop = body
            .find(['+', '-'])
            .unwrap_or(body.len());
        let term = &body[..stop];
        rest = &body[stop..];
        first = false;

        if let Some((r, scale)) = term.split_once('*') {
            let (reg, _) = reg_of(r)?;
            m.index = Some((reg, scale.trim().parse::<u8>().ok()?));
        } else if let Some((reg, _)) = reg_of(term) {
            if m.base.is_none() {
                m.base = Some(reg);
            } else {
                m.index = Some((reg, 1));
            }
        } else {
            let v = parse_int(term)?;
            m.disp = i32::try_from(v * i64::from(sign)).ok()?;
        }
    }
    Some(m)
}

impl Insn {
    /// Rend l'instruction en syntaxe Intel canonique.
    #[must_use]
    pub fn to_text(self) -> String {
        match self {
            Self::Ret => "ret".to_string(),
            Self::RetImm(n) => format!("ret {n:#x}"),
            Self::MovRegImm8(r, i) => format!("mov {}, {i:#x}", reg_name(r, 1)),
            Self::MovRegImm32(r, i) => format!("mov {}, {i:#x}", reg_name(r, 4)),
            Self::XorReg32(a, b) => format!("xor {}, {}", reg_name(a, 4), reg_name(b, 4)),
            Self::XorReg8(a, b) => format!("xor {}, {}", reg_name(a, 1), reg_name(b, 1)),
            Self::MovReg64(a, b) => format!("mov {}, {}", reg_name(a, 8), reg_name(b, 8)),
            Self::MovReg32(a, b) => format!("mov {}, {}", reg_name(a, 4), reg_name(b, 4)),
            Self::OrReg64(a, b) => format!("or {}, {}", reg_name(a, 8), reg_name(b, 8)),
            Self::Store64(m, r) => format!("mov {}, {}", mem_text(m), reg_name(r, 8)),
            Self::Store32(m, r) => format!("mov {}, {}", mem_text(m), reg_name(r, 4)),
            Self::Load64(r, m) => format!("mov {}, {}", reg_name(r, 8), mem_text(m)),
            Self::Load32(r, m) => format!("mov {}, {}", reg_name(r, 4), mem_text(m)),
            Self::Lea64(r, m) => format!("lea {}, {}", reg_name(r, 8), mem_text(m)),
            Self::IncMem32(m) => format!("inc dword {}", mem_text(m)),
            Self::AndRegImm8(r, i) => format!("and {}, {i}", reg_name(r, 8)),
            Self::ShlRegImm8(r, i) => format!("shl {}, {i:#x}", reg_name(r, 8)),
            Self::JmpReg(r) => format!("jmp {}", reg_name(r, 8)),
            Self::Nop(n) => format!("nop {n}"),
        }
    }
}

/// Analyse une instruction en syntaxe Intel canonique.
///
/// # Erreurs
/// Retourne une erreur si la ligne n'appartient pas au dialecte supporté.
pub fn parse_insn(line: &str) -> Result<Insn, ParseError> {
    let line = line.trim();
    let (mnem, args) = line.split_once(' ').unwrap_or((line, ""));
    let args = args.trim();
    let err = || ParseError(format!("instruction non supportée : `{line}`"));

    let split2 = || -> Result<(String, String), ParseError> {
        let (a, b) = args.split_once(',').ok_or_else(err)?;
        Ok((a.trim().to_string(), b.trim().to_string()))
    };

    match mnem {
        "ret" if args.is_empty() => Ok(Insn::Ret),
        "ret" => Ok(Insn::RetImm(
            u16::try_from(parse_int(args).ok_or_else(err)?).map_err(|_| err())?,
        )),
        "jmp" => Ok(Insn::JmpReg(reg_of(args).ok_or_else(err)?.0)),
        "nop" => Ok(Insn::Nop(
            u8::try_from(parse_int(args).ok_or_else(err)?).map_err(|_| err())?,
        )),
        "inc" => {
            let m = args.strip_prefix("dword").ok_or_else(err)?;
            Ok(Insn::IncMem32(parse_mem(m).ok_or_else(err)?))
        }
        "and" => {
            let (d, s) = split2()?;
            let (r, _) = reg_of(&d).ok_or_else(err)?;
            Ok(Insn::AndRegImm8(
                r,
                i8::try_from(parse_int(&s).ok_or_else(err)?).map_err(|_| err())?,
            ))
        }
        "shl" => {
            let (d, s) = split2()?;
            let (r, _) = reg_of(&d).ok_or_else(err)?;
            Ok(Insn::ShlRegImm8(
                r,
                u8::try_from(parse_int(&s).ok_or_else(err)?).map_err(|_| err())?,
            ))
        }
        "or" => {
            let (d, s) = split2()?;
            let (a, _) = reg_of(&d).ok_or_else(err)?;
            let (b, _) = reg_of(&s).ok_or_else(err)?;
            Ok(Insn::OrReg64(a, b))
        }
        "xor" => {
            let (d, s) = split2()?;
            let (a, sz) = reg_of(&d).ok_or_else(err)?;
            let (b, _) = reg_of(&s).ok_or_else(err)?;
            match sz {
                1 => Ok(Insn::XorReg8(a, b)),
                4 => Ok(Insn::XorReg32(a, b)),
                _ => Err(err()),
            }
        }
        "lea" => {
            let (d, s) = split2()?;
            let (r, _) = reg_of(&d).ok_or_else(err)?;
            Ok(Insn::Lea64(r, parse_mem(&s).ok_or_else(err)?))
        }
        "mov" => {
            let (d, s) = split2()?;
            if d.starts_with('[') {
                let m = parse_mem(&d).ok_or_else(err)?;
                let (r, sz) = reg_of(&s).ok_or_else(err)?;
                return match sz {
                    4 => Ok(Insn::Store32(m, r)),
                    8 => Ok(Insn::Store64(m, r)),
                    _ => Err(err()),
                };
            }
            let (r, sz) = reg_of(&d).ok_or_else(err)?;
            if s.starts_with('[') {
                let m = parse_mem(&s).ok_or_else(err)?;
                return match sz {
                    4 => Ok(Insn::Load32(r, m)),
                    8 => Ok(Insn::Load64(r, m)),
                    _ => Err(err()),
                };
            }
            if let Some((b, sz2)) = reg_of(&s) {
                return match (sz, sz2) {
                    (4, 4) => Ok(Insn::MovReg32(r, b)),
                    (8, 8) => Ok(Insn::MovReg64(r, b)),
                    _ => Err(err()),
                };
            }
            let v = parse_int(&s).ok_or_else(err)?;
            match sz {
                1 => Ok(Insn::MovRegImm8(r, u8::try_from(v).map_err(|_| err())?)),
                4 => Ok(Insn::MovRegImm32(r, u32::try_from(v).map_err(|_| err())?)),
                _ => Err(err()),
            }
        }
        _ => Err(err()),
    }
}

/// Rend une suite d'instructions en une ligne (`a ; b ; c`).
#[must_use]
pub fn to_line(insns: &[Insn]) -> String {
    insns
        .iter()
        .map(|i| i.to_text())
        .collect::<Vec<_>>()
        .join(" ; ")
}

/// Analyse une ligne d'instructions séparées par `;`.
///
/// # Erreurs
/// Retourne une erreur si une des instructions n'est pas supportée.
pub fn parse_line(line: &str) -> Result<Vec<Insn>, ParseError> {
    line.split(';')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(parse_insn)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::encode;
    use alloc::vec;

    #[test]
    fn aller_retour_texte_sur_les_corps_reels() {
        let cases: Vec<Vec<Insn>> = vec![
            vec![Insn::Ret],
            vec![Insn::RetImm(0)],
            vec![Insn::MovRegImm8(Reg::Rax, 1), Insn::Ret],
            vec![Insn::XorReg32(Reg::Rax, Reg::Rax), Insn::Ret],
            vec![Insn::XorReg8(Reg::Rax, Reg::Rax), Insn::Ret],
            vec![Insn::MovReg64(Reg::Rax, Reg::Rcx), Insn::Ret],
            vec![
                Insn::Store64(Mem::base(Reg::Rcx), Reg::Rdx),
                Insn::MovReg64(Reg::Rax, Reg::Rcx),
                Insn::Store64(Mem::base_disp(Reg::Rcx, 8), Reg::R8),
                Insn::Ret,
            ],
            vec![Insn::Lea64(Reg::Rax, Mem::base_disp(Reg::Rcx, 8)), Insn::Ret],
            vec![Insn::MovRegImm32(Reg::Rax, 0xefec_8a0d), Insn::Ret],
            vec![Insn::Load64(Reg::Rax, Mem::base_disp(Reg::Rsp, 0x28))],
            vec![Insn::IncMem32(Mem::base(Reg::Rcx))],
            vec![
                Insn::AndRegImm8(Reg::Rax, -1),
                Insn::ShlRegImm8(Reg::Rdx, 0x20),
                Insn::OrReg64(Reg::Rax, Reg::Rdx),
                Insn::Ret,
            ],
            vec![Insn::JmpReg(Reg::Rax)],
            vec![Insn::Nop(10)],
        ];
        for c in cases {
            let text = to_line(&c);
            let back = parse_line(&text).unwrap_or_else(|e| panic!("`{text}` : {e}"));
            assert_eq!(back, c, "aller-retour de `{text}`");
            assert_eq!(encode(&back), encode(&c));
        }
    }

    #[test]
    fn texte_canonique_lisible() {
        assert_eq!(
            to_line(&[Insn::MovRegImm32(Reg::Rax, 0xefec_8a0d), Insn::Ret]),
            "mov eax, 0xefec8a0d ; ret"
        );
        assert_eq!(
            to_line(&[Insn::Store64(Mem::base_disp(Reg::Rcx, 8), Reg::R8)]),
            "mov [rcx+0x8], r8"
        );
        assert_eq!(
            to_line(&[Insn::Load64(
                Reg::Rax,
                Mem {
                    base: Some(Reg::Rdx),
                    index: Some((Reg::Rcx, 4)),
                    disp: -16
                }
            )]),
            "mov rax, [rdx+rcx*4-0x10]"
        );
    }

    #[test]
    fn instruction_hors_dialecte_est_rejetee() {
        assert!(parse_insn("vfmadd231ps xmm0, xmm1, xmm2").is_err());
        assert!(parse_insn("mov rax, [rip+0x10]").is_err());
    }
}
