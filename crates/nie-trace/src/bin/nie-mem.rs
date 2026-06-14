//! `nie-mem` — lecteur mémoire autonome d'`nie.exe`.
//!
//! Cross-compilé depuis WSL (`cargo build -p nie-trace --bin nie-mem --target x86_64-pc-windows-gnu`)
//! et lancé via l'interop WSL→Windows pour inspecter le **vrai jeu Windows natif** :
//! `nie-mem.exe maps`, `... scan wstr:Title`, `... read nie.exe+0xF600CA -n 64`, etc.
//! Compile aussi sous Linux (backend Wine/process_vm_readv).
//!
//! Parsing d'arguments minimal (pas de clap) pour un binaire léger et un cross-compile sans surface.

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::ExitCode;

use nie_trace::{
    dump_regions, find_module_base, find_pid_by_name, module_regions, patch_eac, read_exact,
    scan_regions,
};

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match run(&args) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("erreur: {e}");
            ExitCode::FAILURE
        }
    }
}

const USAGE: &str = "\
nie-mem — lecteur mémoire d'nie.exe (Windows natif via ReadProcessMemory, ou Wine via process_vm_readv)

USAGE:
  nie-mem find-pid [nom=nie.exe]
  nie-mem maps   [--pid N] [--module nie.exe] [--all]
  nie-mem base   [--pid N] [--module nie.exe]
  nie-mem read   <0xADDR | module+0xRVA> [--len N=256] [--pid N] [--out FICHIER]
  nie-mem dump   [--pid N] [--module nie.exe] [--all] [--out DOSSIER=./memdump]
  nie-mem scan   <hex '48 8B 0D' | str:Texte | wstr:Titre> [--pid N] [--module nie.exe] [--all] [--limit N=20]
  nie-mem patch-eac <src nie.exe> <dst nie_eacpatched.exe>

--pid 0 (défaut) auto-détecte nie.exe.";

fn run(args: &[String]) -> Result<(), String> {
    let Some(cmd) = args.first() else {
        println!("{USAGE}");
        return Ok(());
    };
    let (positionals, flags) = parse(&args[1..]);

    match cmd.as_str() {
        "help" | "-h" | "--help" => {
            println!("{USAGE}");
            Ok(())
        }
        "find-pid" => {
            let name = positionals.first().map_or("nie.exe", String::as_str);
            match find_pid_by_name(name) {
                Some(pid) => {
                    println!("{name} → pid {pid}");
                    Ok(())
                }
                None => Err(format!("{name} introuvable (le jeu tourne-t-il ?)")),
            }
        }
        "maps" => {
            let pid = resolve_pid(&flags)?;
            let module = module_of(&flags);
            let all = flags.contains_key("all");
            let regions = module_regions(pid, &module, all);
            let mut total = 0u64;
            for m in &regions {
                total += m.size();
                println!("  0x{:012x}-0x{:012x}  {}  {:>12}  {}", m.start, m.end, m.perms, m.size(), m.path);
            }
            let suffix = if all { String::new() } else { format!(" (module « {module} »)") };
            println!("\n  {} plage(s), {total} octets{suffix}", regions.len());
            Ok(())
        }
        "base" => {
            let pid = resolve_pid(&flags)?;
            let module = module_of(&flags);
            match find_module_base(pid, &module) {
                Some(b) => println!("  {module} @ 0x{b:x} (pid {pid})"),
                None => return Err(format!("module « {module} » introuvable (pid {pid})")),
            }
            Ok(())
        }
        "read" => {
            let pid = resolve_pid(&flags)?;
            let addr_s = positionals.first().ok_or("adresse manquante")?;
            let addr = resolve_addr(addr_s, pid)?;
            let len: usize = flag_num(&flags, "len").unwrap_or(256);
            let buf = read_exact(pid, addr, len).map_err(|e| e.to_string())?;
            match flags.get("out").and_then(|v| v.clone()) {
                Some(path) => {
                    std::fs::write(&path, &buf).map_err(|e| e.to_string())?;
                    println!("  {} octets @ 0x{addr:x} → {path}", buf.len());
                }
                None => hexdump(&buf, addr),
            }
            Ok(())
        }
        "dump" => {
            let pid = resolve_pid(&flags)?;
            let module = module_of(&flags);
            let all = flags.contains_key("all");
            let out = flags.get("out").and_then(Clone::clone).unwrap_or_else(|| "./memdump".to_owned());
            let regions = module_regions(pid, &module, all);
            let stats = dump_regions(pid, &regions, &PathBuf::from(&out)).map_err(|e| e.to_string())?;
            println!("  {} plage(s) dumpée(s), {} octets → {out}", stats.regions, stats.bytes);
            Ok(())
        }
        "scan" => {
            let pid = resolve_pid(&flags)?;
            let module = module_of(&flags);
            let all = flags.contains_key("all");
            let limit: usize = flag_num(&flags, "limit").unwrap_or(20);
            let pattern = positionals.first().ok_or("motif manquant")?;
            let (needle, label) = parse_pattern(pattern)?;
            let regions = module_regions(pid, &module, all);
            let base = find_module_base(pid, &module);
            let hits = scan_regions(pid, &regions, base, &needle, limit);
            for h in &hits {
                let rva = h.rva.map(|r| format!(" ({module}+0x{r:x})")).unwrap_or_default();
                println!("  0x{:012x}{rva}  [{}]", h.addr, h.perms);
            }
            let capped = if hits.len() >= limit { format!(" (limité à {limit})") } else { String::new() };
            println!("\n  {} hit(s) pour {label}{capped}", hits.len());
            Ok(())
        }
        "patch-eac" => {
            let src = positionals.first().ok_or("src manquant")?;
            let dst = positionals.get(1).ok_or("dst manquant")?;
            let r = patch_eac(&PathBuf::from(src), &PathBuf::from(dst)).map_err(|e| e.to_string())?;
            println!(
                "  OK  offset 0x{:X}: {} -> {}  ({} octets)  {dst}",
                r.offset,
                hexs(&r.original),
                hexs(&r.patched),
                r.dst_len
            );
            Ok(())
        }
        other => Err(format!("commande inconnue « {other} »\n\n{USAGE}")),
    }
}

/// Sépare positionnels et flags. `--k v` (valeur) ou `--k` (booléen → valeur None).
fn parse(args: &[String]) -> (Vec<String>, HashMap<String, Option<String>>) {
    let mut pos = Vec::new();
    let mut flags: HashMap<String, Option<String>> = HashMap::new();
    let mut i = 0;
    while i < args.len() {
        let a = &args[i];
        if let Some(key) = a.strip_prefix("--").or_else(|| a.strip_prefix('-')).filter(|_| a.starts_with('-')) {
            // booléens connus sans valeur
            if key == "all" {
                flags.insert("all".to_owned(), None);
            } else if i + 1 < args.len() && !args[i + 1].starts_with('-') {
                flags.insert(normalize(key), Some(args[i + 1].clone()));
                i += 1;
            } else {
                flags.insert(normalize(key), None);
            }
        } else {
            pos.push(a.clone());
        }
        i += 1;
    }
    (pos, flags)
}

fn normalize(key: &str) -> String {
    match key {
        "p" => "pid",
        "m" => "module",
        "n" => "len",
        "o" => "out",
        "l" => "limit",
        k => k,
    }
    .to_owned()
}

fn resolve_pid(flags: &HashMap<String, Option<String>>) -> Result<i32, String> {
    let pid = flag_num::<i32>(flags, "pid").unwrap_or(0);
    if pid > 0 {
        return Ok(pid);
    }
    find_pid_by_name("nie.exe").ok_or_else(|| "nie.exe introuvable — lance le jeu, ou précise --pid".to_owned())
}

fn module_of(flags: &HashMap<String, Option<String>>) -> String {
    flags.get("module").and_then(Clone::clone).unwrap_or_else(|| "nie.exe".to_owned())
}

fn flag_num<T: std::str::FromStr>(flags: &HashMap<String, Option<String>>, key: &str) -> Option<T> {
    flags.get(key).and_then(Clone::clone).and_then(|v| v.parse::<T>().ok())
}

/// `0x…` (absolu) ou `module+0xRVA`.
fn resolve_addr(addr: &str, pid: i32) -> Result<u64, String> {
    let s = addr.trim();
    if let Some(plus) = s.find('+') {
        let module = &s[..plus];
        let rva = parse_hex(&s[plus + 1..])?;
        let base = find_module_base(pid, module).ok_or_else(|| format!("module « {module} » introuvable"))?;
        return Ok(base + rva);
    }
    parse_hex(s)
}

fn parse_hex(s: &str) -> Result<u64, String> {
    let s = s.trim();
    let s = s.strip_prefix("0x").or_else(|| s.strip_prefix("0X")).unwrap_or(s);
    u64::from_str_radix(s, 16).map_err(|_| format!("adresse hex invalide: {s}"))
}

/// `wstr:` (UTF-16LE), `str:` (UTF-8), ou octets hex.
fn parse_pattern(pattern: &str) -> Result<(Vec<u8>, String), String> {
    if let Some(t) = pattern.strip_prefix("wstr:") {
        let n: Vec<u8> = t.encode_utf16().flat_map(u16::to_le_bytes).collect();
        if n.is_empty() {
            return Err("motif wstr: vide".to_owned());
        }
        return Ok((n, format!("wstr \"{t}\"")));
    }
    if let Some(t) = pattern.strip_prefix("str:") {
        if t.is_empty() {
            return Err("motif str: vide".to_owned());
        }
        return Ok((t.as_bytes().to_vec(), format!("\"{t}\"")));
    }
    let hex: String = pattern.chars().filter(|c| !c.is_whitespace() && *c != '-').collect();
    if hex.is_empty() || !hex.len().is_multiple_of(2) {
        return Err("motif hex de longueur impaire/vide".to_owned());
    }
    let mut bytes = Vec::with_capacity(hex.len() / 2);
    for i in (0..hex.len()).step_by(2) {
        bytes.push(u8::from_str_radix(&hex[i..i + 2], 16).map_err(|_| format!("octet hex invalide à {i}"))?);
    }
    let label = format!("hex {}", hexs_join(&bytes));
    Ok((bytes, label))
}

fn hexdump(data: &[u8], base: u64) {
    for (i, line) in data.chunks(16).enumerate() {
        let off = base + (i * 16) as u64;
        let mut hex = String::new();
        for j in 0..16 {
            if j < line.len() {
                hex.push_str(&format!("{:02x} ", line[j]));
            } else {
                hex.push_str("   ");
            }
        }
        let ascii: String = line.iter().map(|&b| if (0x20..0x7f).contains(&b) { b as char } else { '.' }).collect();
        println!("  0x{off:012x}  {hex} {ascii}");
    }
}

fn hexs(b: &[u8; 5]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn hexs_join(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02X}")).collect::<Vec<_>>().join("-")
}
