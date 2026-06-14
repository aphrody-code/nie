//! Backend **Windows natif** : lecture de la mémoire d'un `nie.exe` réel (Steam) depuis un process
//! Windows, via `OpenProcess` + `ReadProcessMemory` (Toolhelp32 pour PID/modules, `VirtualQueryEx`
//! pour les plages). Cross-compilé depuis WSL (`x86_64-pc-windows-gnu`) et lancé via l'interop.
//!
//! Module `cfg(windows)` (dispatché par `lib.rs`).

use std::ffi::c_void;

use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, HANDLE, INVALID_HANDLE_VALUE};
use windows_sys::Win32::System::Diagnostics::Debug::ReadProcessMemory;
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, MODULEENTRY32W, Module32FirstW, Module32NextW, PROCESSENTRY32W,
    Process32FirstW, Process32NextW, TH32CS_SNAPMODULE, TH32CS_SNAPMODULE32, TH32CS_SNAPPROCESS,
};
use windows_sys::Win32::System::Memory::{
    MEM_COMMIT, MEMORY_BASIC_INFORMATION, PAGE_EXECUTE, PAGE_EXECUTE_READ, PAGE_EXECUTE_READWRITE,
    PAGE_EXECUTE_WRITECOPY, PAGE_GUARD, PAGE_NOACCESS, PAGE_READONLY, PAGE_READWRITE,
    PAGE_WRITECOPY, VirtualQueryEx,
};
use windows_sys::Win32::System::Threading::{
    OpenProcess, PROCESS_QUERY_INFORMATION, PROCESS_VM_READ,
};

use crate::{MapEntry, MemError};

/// Garde RAII : ferme un HANDLE à la sortie de portée.
struct Handle(HANDLE);
impl Drop for Handle {
    fn drop(&mut self) {
        if !self.0.is_null() && self.0 != INVALID_HANDLE_VALUE {
            // SAFETY: handle valide (vérifié non-null/non-invalide), fermé une seule fois (Drop).
            unsafe { CloseHandle(self.0) };
        }
    }
}

/// Ouvre la cible en lecture mémoire (`PROCESS_VM_READ | PROCESS_QUERY_INFORMATION`).
fn open_read(pid: i32) -> Option<Handle> {
    // SAFETY: appel FFI pur ; renvoie un handle (null en échec).
    let h = unsafe { OpenProcess(PROCESS_VM_READ | PROCESS_QUERY_INFORMATION, 0, pid as u32) };
    if h.is_null() { None } else { Some(Handle(h)) }
}

fn last_error_hint(code: u32) -> &'static str {
    match code {
        5 => " (ERROR_ACCESS_DENIED — EAC actif ? lance nie.exe directement sans EACLauncher, ou en admin)",
        87 => " (ERROR_INVALID_PARAMETER — plage partiellement non mappée)",
        299 => " (ERROR_PARTIAL_COPY — la plage chevauche un trou non mappé)",
        _ => "",
    }
}

/// Lit jusqu'à `dest.len()` octets à `addr` du process `pid`.
pub fn read(pid: i32, addr: u64, dest: &mut [u8]) -> Result<usize, MemError> {
    if dest.is_empty() {
        return Ok(0);
    }
    let Some(h) = open_read(pid) else {
        // SAFETY: appel FFI pur.
        let code = unsafe { GetLastError() };
        return Err(MemError::Win {
            op: "OpenProcess",
            pid,
            addr,
            len: dest.len(),
            code,
            hint: last_error_hint(code),
        });
    };
    let mut read_n: usize = 0;
    // SAFETY: `h.0` est un handle valide (PROCESS_VM_READ). `dest` est inscriptible sur `dest.len()`.
    // ReadProcessMemory écrit au plus `dest.len()` octets et renseigne `read_n`.
    let ok = unsafe {
        ReadProcessMemory(h.0, addr as *const c_void, dest.as_mut_ptr().cast::<c_void>(), dest.len(), &mut read_n)
    };
    if ok == 0 && read_n == 0 {
        // SAFETY: appel FFI pur.
        let code = unsafe { GetLastError() };
        return Err(MemError::Win {
            op: "ReadProcessMemory",
            pid,
            addr,
            len: dest.len(),
            code,
            hint: last_error_hint(code),
        });
    }
    Ok(read_n)
}

/// Convertit un nom large NUL-terminé (`[u16]`) en `String`.
fn wide_to_string(w: &[u16]) -> String {
    let len = w.iter().position(|&c| c == 0).unwrap_or(w.len());
    String::from_utf16_lossy(&w[..len])
}

/// PID du premier process dont `szExeFile` vaut `name` (insensible à la casse).
pub fn find_pid_by_name(name: &str) -> Option<i32> {
    // SAFETY: snapshot des process ; INVALID_HANDLE_VALUE en échec.
    let snap = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if snap == INVALID_HANDLE_VALUE {
        return None;
    }
    let _guard = Handle(snap);
    let mut entry: PROCESSENTRY32W = unsafe { core::mem::zeroed() };
    entry.dwSize = core::mem::size_of::<PROCESSENTRY32W>() as u32;
    let needle = name.to_lowercase();

    // SAFETY: `snap` valide, `entry.dwSize` renseigné.
    let mut ok = unsafe { Process32FirstW(snap, &mut entry) };
    while ok != 0 {
        if wide_to_string(&entry.szExeFile).to_lowercase() == needle {
            return Some(entry.th32ProcessID as i32);
        }
        // SAFETY: idem.
        ok = unsafe { Process32NextW(snap, &mut entry) };
    }
    None
}

/// `(base, taille, chemin)` du module de `pid` dont `szModule`/`szExePath` contient `fragment`.
fn module_entry(pid: i32, fragment: &str) -> Option<(u64, u64, String)> {
    // SAFETY: snapshot des modules du pid ; on tente 32+64 bits.
    let snap = unsafe {
        CreateToolhelp32Snapshot(TH32CS_SNAPMODULE | TH32CS_SNAPMODULE32, pid as u32)
    };
    if snap == INVALID_HANDLE_VALUE {
        return None;
    }
    let _guard = Handle(snap);
    let mut entry: MODULEENTRY32W = unsafe { core::mem::zeroed() };
    entry.dwSize = core::mem::size_of::<MODULEENTRY32W>() as u32;
    let needle = fragment.to_lowercase();

    // SAFETY: `snap` valide, `entry.dwSize` renseigné.
    let mut ok = unsafe { Module32FirstW(snap, &mut entry) };
    while ok != 0 {
        let module = wide_to_string(&entry.szModule).to_lowercase();
        let path = wide_to_string(&entry.szExePath);
        if module.contains(&needle) || path.to_lowercase().contains(&needle) {
            return Some((entry.modBaseAddr as u64, u64::from(entry.modBaseSize), path));
        }
        // SAFETY: idem.
        ok = unsafe { Module32NextW(snap, &mut entry) };
    }
    None
}

/// Base de chargement du module.
pub fn find_module_base(pid: i32, fragment: &str) -> Option<u64> {
    module_entry(pid, fragment).map(|(base, _, _)| base)
}

/// Étendue VA `[base, base+modBaseSize)` du module.
pub fn module_range(pid: i32, fragment: &str) -> Option<(u64, u64)> {
    module_entry(pid, fragment).map(|(base, size, _)| (base, base + size))
}

/// `Protect` Win32 → chaîne de perms `rwx` normalisée.
fn protect_to_perms(protect: u32) -> String {
    if protect & PAGE_GUARD != 0 || protect == PAGE_NOACCESS {
        return "---".to_owned();
    }
    let base = protect & 0xFF;
    let (r, w, x) = match base {
        x if x == PAGE_READONLY => (true, false, false),
        x if x == PAGE_READWRITE => (true, true, false),
        x if x == PAGE_WRITECOPY => (true, true, false),
        x if x == PAGE_EXECUTE => (false, false, true),
        x if x == PAGE_EXECUTE_READ => (true, false, true),
        x if x == PAGE_EXECUTE_READWRITE => (true, true, true),
        x if x == PAGE_EXECUTE_WRITECOPY => (true, true, true),
        _ => (false, false, false),
    };
    let mut s = String::with_capacity(3);
    s.push(if r { 'r' } else { '-' });
    s.push(if w { 'w' } else { '-' });
    s.push(if x { 'x' } else { '-' });
    s
}

/// Toutes les plages committées du process (via `VirtualQueryEx`), annotées du module les contenant.
pub fn enumerate_regions(pid: i32) -> Vec<MapEntry> {
    let Some(h) = open_read(pid) else {
        return Vec::new();
    };
    // Liste des modules pour annoter les plages (base, end, nom).
    let modules = module_list(pid);

    let mut out = Vec::new();
    let mut addr: u64 = 0;
    loop {
        let mut mbi: MEMORY_BASIC_INFORMATION = unsafe { core::mem::zeroed() };
        // SAFETY: `h.0` valide ; VirtualQueryEx remplit `mbi` (taille passée). 0 = fin/erreur.
        let n = unsafe {
            VirtualQueryEx(
                h.0,
                addr as *const c_void,
                &mut mbi,
                core::mem::size_of::<MEMORY_BASIC_INFORMATION>(),
            )
        };
        if n == 0 {
            break;
        }
        let base = mbi.BaseAddress as u64;
        let size = mbi.RegionSize as u64;
        let next = base.saturating_add(size);
        if next <= addr {
            break; // pas de progrès → stop
        }
        if mbi.State == MEM_COMMIT {
            let perms = protect_to_perms(mbi.Protect);
            let path = modules
                .iter()
                .find(|(mb, me, _)| base >= *mb && base < *me)
                .map(|(_, _, name)| name.clone())
                .unwrap_or_default();
            out.push(MapEntry { start: base, end: next, perms, offset: 0, path });
        }
        addr = next;
    }
    out
}

/// `(base, end, nom)` de tous les modules du process.
fn module_list(pid: i32) -> Vec<(u64, u64, String)> {
    // SAFETY: snapshot modules ; INVALID_HANDLE_VALUE en échec.
    let snap = unsafe {
        CreateToolhelp32Snapshot(TH32CS_SNAPMODULE | TH32CS_SNAPMODULE32, pid as u32)
    };
    if snap == INVALID_HANDLE_VALUE {
        return Vec::new();
    }
    let _guard = Handle(snap);
    let mut entry: MODULEENTRY32W = unsafe { core::mem::zeroed() };
    entry.dwSize = core::mem::size_of::<MODULEENTRY32W>() as u32;
    let mut out = Vec::new();
    // SAFETY: `snap` valide, `entry.dwSize` renseigné.
    let mut ok = unsafe { Module32FirstW(snap, &mut entry) };
    while ok != 0 {
        let base = entry.modBaseAddr as u64;
        let size = u64::from(entry.modBaseSize);
        out.push((base, base + size, wide_to_string(&entry.szModule)));
        // SAFETY: idem.
        ok = unsafe { Module32NextW(snap, &mut entry) };
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wide_to_string_stops_at_nul() {
        let w: Vec<u16> = "nie.exe\0garbage".encode_utf16().collect();
        assert_eq!(wide_to_string(&w), "nie.exe");
    }

    #[test]
    fn protect_perms_mapping() {
        assert_eq!(protect_to_perms(PAGE_EXECUTE_READ), "r-x");
        assert_eq!(protect_to_perms(PAGE_READWRITE), "rw-");
        assert_eq!(protect_to_perms(PAGE_READONLY), "r--");
        assert_eq!(protect_to_perms(PAGE_NOACCESS), "---");
    }
}
