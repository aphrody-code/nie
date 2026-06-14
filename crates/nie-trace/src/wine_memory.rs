//! Lecture/écriture de la mémoire d'un processus **Wine** depuis Linux, sans `ptrace`
//! (pas de stop du processus), via `process_vm_readv(2)` / `process_vm_writev(2)`.
//!
//! ## Pourquoi ça marche pour le jeu Windows sous Wine
//!
//! Wine ne virtualise pas : il charge le PE dans l'**espace d'adressage Linux du même
//! processus**. Une adresse virtuelle « Windows » *est* une adresse virtuelle Linux réelle.
//! Donc lire la mémoire du module PE = lire des plages de `/proc/<pid>/maps`. Aucune
//! traduction d'adresse.
//!
//! ## Contrainte ptrace (Yama)
//!
//! Avec `kernel.yama.ptrace_scope=1` (cas du VPS), `process_vm_readv` n'est autorisé que si
//! l'appelant est un **ancêtre** du processus cible, ou détient `CAP_SYS_PTRACE`. D'où
//! l'architecture « le lanceur *lance* le jeu » : en étant le parent, on lit la mémoire
//! **sans aucune capability** ni `setcap` (ce qui éviterait de casser l'environnement Vulkan —
//! `AT_SECURE` ignore `VK_DRIVER_FILES`). Si le lecteur n'est pas ancêtre, il faut
//! `CAP_SYS_PTRACE` sur le lecteur, ou `ptrace_scope=0`.
//!
//! ## Portabilité
//!
//! La FFI `process_vm_readv`/`writev` est **Linux-only** ; sur les autres cibles les fonctions
//! renvoient [`WineMemoryError::Unsupported`]. La lecture de `/proc` (maps, status…) compile
//! partout mais échoue naturellement hors Linux.

use std::fs;

use thiserror::Error;

/// Une plage mappée de `/proc/<pid>/maps`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MapEntry {
    pub start: u64,
    pub end: u64,
    pub perms: String,
    pub offset: u64,
    pub path: String,
}

impl MapEntry {
    #[must_use]
    pub fn size(&self) -> u64 {
        self.end.saturating_sub(self.start)
    }
    #[must_use]
    pub fn is_readable(&self) -> bool {
        self.perms.as_bytes().first() == Some(&b'r')
    }
    #[must_use]
    pub fn is_writable(&self) -> bool {
        self.perms.as_bytes().get(1) == Some(&b'w')
    }
    #[must_use]
    pub fn is_executable(&self) -> bool {
        self.perms.as_bytes().get(2) == Some(&b'x')
    }
}

/// Échec d'un appel mémoire (`process_vm_readv`/`writev`), errno décodé.
#[derive(Debug, Error)]
pub enum WineMemoryError {
    #[error("{op} a échoué pid={pid} addr=0x{addr:x} len={len} errno={errno}{hint}")]
    Syscall { op: &'static str, pid: i32, addr: u64, len: usize, errno: i32, hint: &'static str },
    #[error("{op} lecture partielle pid={pid} addr=0x{addr:x} demandé={requested} lu={got}")]
    Partial { op: &'static str, pid: i32, addr: u64, requested: usize, got: usize },
    #[error("process_vm_readv/writev indisponible sur cette plateforme (Linux-only)")]
    Unsupported,
}

impl WineMemoryError {
    // Construit à partir d'errno après un appel `process_vm_*` raté — donc Linux-only
    // (hors Linux, `read`/`write` renvoient directement `Unsupported`).
    #[cfg(target_os = "linux")]
    fn from_errno(pid: i32, addr: u64, len: usize, is_write: bool) -> Self {
        let errno = std::io::Error::last_os_error().raw_os_error().unwrap_or(0);
        let op = if is_write { "process_vm_writev" } else { "process_vm_readv" };
        let hint = match errno {
            1 => " (EPERM — ptrace_scope refuse : pas ancêtre et pas CAP_SYS_PTRACE)",
            3 => " (ESRCH — pid inexistant)",
            14 => " (EFAULT — adresse/plage non mappée côté cible)",
            _ => "",
        };
        WineMemoryError::Syscall { op, pid, addr, len, errno, hint }
    }
}

// ─── FFI process_vm_readv / process_vm_writev (Linux-only) ────────────────────────

/// Lit jusqu'à `dest.len()` octets à l'adresse virtuelle `remote_address` du processus
/// `pid`. Ne stoppe pas la cible. Renvoie le nombre d'octets effectivement lus (peut être
/// `< dest.len()` si la plage chevauche un trou non mappé).
#[cfg(target_os = "linux")]
pub fn read(pid: i32, remote_address: u64, dest: &mut [u8]) -> Result<usize, WineMemoryError> {
    if dest.is_empty() {
        return Ok(0);
    }
    let local = libc::iovec {
        iov_base: dest.as_mut_ptr().cast::<libc::c_void>(),
        iov_len: dest.len(),
    };
    let remote = libc::iovec {
        iov_base: remote_address as usize as *mut libc::c_void,
        iov_len: dest.len(),
    };
    // SAFETY: `local.iov_base` pointe sur `dest` (valide pour écriture, `iov_len` == dest.len()).
    // `remote` n'est qu'une (adresse, longueur) transmise au noyau, jamais déréférencée ici ;
    // le noyau copie au plus `dest.len()` octets depuis la cible vers `dest`.
    let n = unsafe { libc::process_vm_readv(pid, &local, 1, &remote, 1, 0) };
    if n < 0 {
        return Err(WineMemoryError::from_errno(pid, remote_address, dest.len(), false));
    }
    Ok(n as usize)
}

#[cfg(not(target_os = "linux"))]
pub fn read(_pid: i32, _remote_address: u64, _dest: &mut [u8]) -> Result<usize, WineMemoryError> {
    Err(WineMemoryError::Unsupported)
}

/// Écrit `src` à l'adresse virtuelle `remote_address`. Mêmes contraintes ptrace que [`read`] ;
/// la page doit être inscriptible côté cible. À utiliser avec parcimonie (RE / patch live).
#[cfg(target_os = "linux")]
pub fn write(pid: i32, remote_address: u64, src: &[u8]) -> Result<usize, WineMemoryError> {
    if src.is_empty() {
        return Ok(0);
    }
    let local = libc::iovec {
        iov_base: src.as_ptr() as *mut libc::c_void,
        iov_len: src.len(),
    };
    let remote = libc::iovec {
        iov_base: remote_address as usize as *mut libc::c_void,
        iov_len: src.len(),
    };
    // SAFETY: `local.iov_base` pointe sur `src` (valide pour lecture, `iov_len` == src.len()) ;
    // process_vm_writev ne lit que `src` côté local et écrit au plus src.len() octets côté cible.
    let n = unsafe { libc::process_vm_writev(pid, &local, 1, &remote, 1, 0) };
    if n < 0 {
        return Err(WineMemoryError::from_errno(pid, remote_address, src.len(), true));
    }
    Ok(n as usize)
}

#[cfg(not(target_os = "linux"))]
pub fn write(_pid: i32, _remote_address: u64, _src: &[u8]) -> Result<usize, WineMemoryError> {
    Err(WineMemoryError::Unsupported)
}

/// Lit exactement `length` octets ou échoue (lecture partielle = échec). Pratique pour
/// déréférencer une struct / un pointeur.
pub fn read_exact(pid: i32, remote_address: u64, length: usize) -> Result<Vec<u8>, WineMemoryError> {
    let mut buf = vec![0u8; length];
    let got = read(pid, remote_address, &mut buf)?;
    if got != length {
        return Err(WineMemoryError::Partial {
            op: "process_vm_readv",
            pid,
            addr: remote_address,
            requested: length,
            got,
        });
    }
    Ok(buf)
}

/// Lit un `u32` little-endian (x86-64) à l'adresse donnée.
pub fn read_u32(pid: i32, remote_address: u64) -> Result<u32, WineMemoryError> {
    let b = read_exact(pid, remote_address, 4)?;
    Ok(u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
}

/// Lit un `u64` little-endian (x86-64) à l'adresse donnée.
pub fn read_u64(pid: i32, remote_address: u64) -> Result<u64, WineMemoryError> {
    let b = read_exact(pid, remote_address, 8)?;
    Ok(u64::from_le_bytes([b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7]]))
}

// ─── Résolution de modules via /proc/<pid>/maps ───────────────────────────────────

/// Parse pure (testable) d'une ligne de `/proc/<pid>/maps`. Renvoie `None` si malformée.
///
/// Une ligne ressemble à :
/// `7f..-7f.. r-xp 00000000 08:01 12345  /path/to/file`
#[must_use]
pub fn parse_map_line(line: &str) -> Option<MapEntry> {
    let mut parts = line.split_whitespace();
    let range = parts.next()?;
    let perms = parts.next()?;
    let offset_s = parts.next()?;
    let _dev = parts.next()?;
    let _inode = parts.next()?;
    // pathname (reste) peut contenir des espaces → on rejoint.
    let path = {
        let rest: Vec<&str> = parts.collect();
        rest.join(" ")
    };

    let dash = range.find('-')?;
    let start = u64::from_str_radix(&range[..dash], 16).ok()?;
    let end = u64::from_str_radix(&range[dash + 1..], 16).ok()?;
    let offset = u64::from_str_radix(offset_s, 16).ok()?;

    Some(MapEntry { start, end, perms: perms.to_owned(), offset, path })
}

/// Parse toutes les lignes de `/proc/<pid>/maps`.
pub fn read_maps(pid: i32) -> std::io::Result<Vec<MapEntry>> {
    let content = fs::read_to_string(format!("/proc/{pid}/maps"))?;
    Ok(content.lines().filter_map(parse_map_line).collect())
}

/// Adresse de chargement (base) d'un module dont le chemin contient `fragment`
/// (insensible à la casse). Retourne le **plus petit `start`** parmi les plages du fichier —
/// c'est la base réelle dont les RVA du PE sont relatifs. Variante pure sur une liste déjà lue.
#[must_use]
pub fn find_module_base_in(maps: &[MapEntry], fragment: &str) -> Option<u64> {
    let needle = fragment.to_lowercase();
    let mut best: Option<u64> = None;
    for m in maps {
        if m.path.is_empty() {
            continue;
        }
        if m.path.to_lowercase().contains(&needle) {
            best = Some(best.map_or(m.start, |b| b.min(m.start)));
        }
    }
    best
}

/// [`find_module_base_in`] en lisant `/proc/<pid>/maps`.
pub fn find_module_base(pid: i32, fragment: &str) -> Option<u64> {
    find_module_base_in(&read_maps(pid).ok()?, fragment)
}

/// Toutes les plages d'un module (base + sections), triées par adresse.
pub fn find_module_regions(pid: i32, fragment: &str) -> Vec<MapEntry> {
    let needle = fragment.to_lowercase();
    let mut list: Vec<MapEntry> = read_maps(pid)
        .unwrap_or_default()
        .into_iter()
        .filter(|m| m.path.to_lowercase().contains(&needle))
        .collect();
    list.sort_by_key(|m| m.start);
    list
}

// ─── ptrace_scope / généalogie ────────────────────────────────────────────────────

/// Valeur de `kernel.yama.ptrace_scope` (0–3). `-1` si illisible.
#[must_use]
pub fn read_ptrace_scope() -> i32 {
    fs::read_to_string("/proc/sys/kernel/yama/ptrace_scope")
        .ok()
        .and_then(|s| s.trim().parse::<i32>().ok())
        .unwrap_or(-1)
}

/// `ancestor_pid` est-il un ancêtre (parent transitif) de `pid` ? Remonte la chaîne PPid.
#[must_use]
pub fn is_ancestor_of(pid: i32, ancestor_pid: i32) -> bool {
    let mut cur = pid;
    let mut i = 0;
    while i < 4096 && cur > 1 {
        let ppid = read_ppid(cur);
        if ppid <= 0 {
            return false;
        }
        if ppid == ancestor_pid {
            return true;
        }
        cur = ppid;
        i += 1;
    }
    false
}

fn read_ppid(pid: i32) -> i32 {
    let Ok(status) = fs::read_to_string(format!("/proc/{pid}/status")) else {
        return -1;
    };
    for line in status.lines() {
        if let Some(rest) = line.strip_prefix("PPid:") {
            return rest.trim().parse::<i32>().unwrap_or(-1);
        }
    }
    -1
}

/// Indique si `process_vm_readv` sur `pid` est *probablement* permis depuis le processus
/// courant, vu `ptrace_scope`. Heuristique non-bloquante (la seule vérité = tenter un Read).
#[must_use]
pub fn likely_permitted(pid: i32) -> bool {
    let scope = read_ptrace_scope();
    if scope <= 0 {
        return true; // 0 = classic ptrace, ou illisible (-1) → on tente
    }
    if scope == 1 {
        return is_ancestor_of(pid, std::process::id() as i32);
    }
    false // 2 (admin-only) / 3 (no attach) : nécessite CAP_SYS_PTRACE
}

/// Trouve le premier pid dont `/proc/<pid>/comm` vaut `comm`.
#[must_use]
pub fn find_pid_by_comm(comm: &str) -> Option<i32> {
    for entry in fs::read_dir("/proc").ok()?.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        let Ok(pid) = name.parse::<i32>() else { continue };
        if let Ok(c) = fs::read_to_string(format!("/proc/{pid}/comm"))
            && c.trim() == comm
        {
            return Some(pid);
        }
    }
    None
}

/// Étendue VA `[base, base + SizeOfImage)` du module, via l'en-tête PE lu en mémoire.
/// Retourne `(base, base)` si l'en-tête est illisible/incohérent (fallback : juste la base).
pub fn module_image_range(pid: i32, fragment: &str) -> Option<(u64, u64)> {
    let base = find_module_base(pid, fragment)?;
    // En-tête DOS : e_lfanew @ +0x3c.
    let dos = match read_exact(pid, base, 0x40) {
        Ok(d) => d,
        Err(_) => return Some((base, base)),
    };
    let lfanew = i32::from_le_bytes([dos[0x3c], dos[0x3d], dos[0x3e], dos[0x3f]]);
    if lfanew <= 0 || lfanew > 0x1000 {
        return Some((base, base));
    }
    // PE32/PE32+ : OptionalHeader.SizeOfImage à l'offset 0x50 après e_lfanew.
    match read_u32(pid, base + lfanew as u64 + 0x50) {
        Ok(0) | Err(_) => Some((base, base)),
        Ok(size) => Some((base, base + u64::from(size))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_map_line_basic() {
        let line = "00400000-00452000 r-xp 00000000 08:01 1234 /path/to/nie.exe";
        let e = parse_map_line(line).expect("ligne valide");
        assert_eq!(e.start, 0x0040_0000);
        assert_eq!(e.end, 0x0045_2000);
        assert_eq!(e.perms, "r-xp");
        assert_eq!(e.offset, 0);
        assert_eq!(e.path, "/path/to/nie.exe");
        assert!(e.is_readable());
        assert!(!e.is_writable());
        assert!(e.is_executable());
        assert_eq!(e.size(), 0x52000);
    }

    #[test]
    fn parse_map_line_anonymous_and_spaces() {
        // Plage anonyme (pas de chemin).
        let anon = parse_map_line("7ffd0000-7ffd1000 rw-p 00000000 00:00 0").expect("valide");
        assert_eq!(anon.path, "");
        assert!(anon.is_writable());
        // Chemin avec espace.
        let spaced =
            parse_map_line("140000000-140001000 r--p 00000000 fd:01 42 /home/u/My Games/nie.exe")
                .expect("valide");
        assert_eq!(spaced.path, "/home/u/My Games/nie.exe");
    }

    #[test]
    fn parse_map_line_rejects_malformed() {
        assert!(parse_map_line("").is_none());
        assert!(parse_map_line("garbage").is_none());
        assert!(parse_map_line("nodash r-xp 0 0:0 0").is_none());
    }

    #[test]
    fn find_module_base_picks_smallest_start_case_insensitive() {
        let maps = vec![
            MapEntry { start: 0x1_4000_5000, end: 0x1_4000_6000, perms: "rw-p".into(), offset: 0, path: "/g/NIE.exe".into() },
            MapEntry { start: 0x1_4000_0000, end: 0x1_4000_1000, perms: "r--p".into(), offset: 0, path: "/g/nie.exe".into() },
            MapEntry { start: 0x7f00_0000, end: 0x7f00_1000, perms: "r-xp".into(), offset: 0, path: "/lib/libc.so".into() },
        ];
        assert_eq!(find_module_base_in(&maps, "nie.exe"), Some(0x1_4000_0000));
        assert_eq!(find_module_base_in(&maps, "introuvable"), None);
    }

    #[test]
    fn ptrace_scope_reads_or_minus_one() {
        // Ne doit jamais paniquer, quelle que soit la plateforme.
        let s = read_ptrace_scope();
        assert!((-1..=3).contains(&s));
    }

    #[test]
    fn read_rejects_invalid_pid() {
        // pid 0 / inexistant → erreur (ou Unsupported hors Linux), jamais de panique.
        let mut buf = [0u8; 16];
        let r = read(-1, 0x1000, &mut buf);
        assert!(r.is_err());
    }
}
