// Auto-generated via advanced AST semantic transpilation
#![allow(non_snake_case, non_camel_case_types, unused_variables, unused_mut, unused_assignments)]
use std::ffi::c_void;
use std::sync::atomic::{AtomicI32, Ordering};
use crate::stubs::*;

#[inline(always)]
unsafe fn read_vfn(this: *mut i64, byte_off: usize) -> usize {
    let vtbl = *(this as *const *const u8);
    *(vtbl.add(byte_off) as *const usize)
}

pub unsafe fn FUN_1404f6a30(param_1: i64, param_2: i64, param_3: *mut i64) -> u64 {
    if param_2 == 0 || param_3.is_null() {
        return 0;
    }

    type VFnI32 = unsafe extern "C" fn(*mut i64) -> i32;
    type VFnI8 = unsafe extern "C" fn(*mut i64) -> i8;

    let fn18: VFnI32 = std::mem::transmute(read_vfn(param_3, 0x18));
    let iVar6: i32 = fn18(param_3);

    if iVar6 == 0 || iVar6 == 1 {
        let cc = *((param_1 + 0xcc) as *const u8);
        let lVar7 = FUN_140097510(param_2, cc as i32) as i64;
        if lVar7 != 0 {
            let lVar4 = *param_3.offset(8);
            let p3_11 = *(param_3.offset(0x11) as *const i8);
            let p3_9 = *param_3.offset(9);
            let r = FUN_1404ba600(
                lVar7 + 0x70,
                cc as i32,
                p3_11 as i32,
                1i32,
                1i32,
                p3_9,
                lVar4,
                8i32,
                0i32,
            );
            let cVar5 = (r as usize) as u8;
            if cVar5 != 0 {
                if lVar4 != 0 {
                    let uVar8 = FUN_14005aaa0(param_2, 1i32) as i64;
                    FUN_1404b1a20(uVar8, lVar4);
                }
                return 1;
            }
        }
        return 0;
    }

    if iVar6 != 2 {
        return 1;
    }

    let plVar3 = (*param_3.offset(10)) as *mut i64;
    if plVar3.is_null() {
        return 0;
    }

    let fn10: VFnI8 = std::mem::transmute(read_vfn(plVar3, 0x10));
    if fn10(plVar3) == 0 {
        return 0;
    }

    let fn20: VFnI8 = std::mem::transmute(read_vfn(plVar3, 0x20));
    if fn20(plVar3) != 0 {
        return 0;
    }

    let uVar1 = *((param_1 + 0xcb) as *const u8);
    let uVar2 = *((param_1 + 0xca) as *const u8);
    *((param_2 + 0xf8) as *mut *mut i64) = plVar3;

    // LOCK(); *(int*)(plVar3 + 0xc) += 1; UNLOCK()
    let refcount = (plVar3 as *mut u8).add(0xc) as *mut AtomicI32;
    (*refcount).fetch_add(1, Ordering::SeqCst);

    let lVar7 = FUN_140097330(param_2, 0i32) as i64;
    if lVar7 == 0 {
        *((param_2 + 0x7a) as *mut u8) = uVar2;
        *((param_2 + 0x7b) as *mut u8) = uVar1;
    } else {
        *((lVar7 + 0x332) as *mut u8) = uVar2;
        *((lVar7 + 0x333) as *mut u8) = uVar1;
    }

    if fn10(plVar3) != 0 {
        let r = FUN_1404ebd70(param_2, plVar3) as usize as u8;
        if r == 0 {
            return 0;
        }
        return 1;
    }

    let b_79 = *((param_2 + 0x79) as *const u8);
    let lVar7 = FUN_1402ce490(param_2, b_79 as i32) as i64;
    if lVar7 == 0 {
        return 0;
    }
    *((lVar7 + 0x60) as *mut u64) = 0;
    1
}

pub unsafe fn FUN_1404f6bc0(
    param_1: i64,
    param_2: i64,
    param_3: *mut i64,
    param_4: u64,
    param_5: i8,
) -> u64 {
    let mut param_2 = param_2;

    if param_2 == 0 || param_3.is_null() {
        return 0;
    }

    type VFnI32 = unsafe extern "C" fn(*mut i64) -> i32;
    type CbFn = unsafe extern "C" fn(*mut *mut i64, i32);

    let uVar10_init = *((param_2 + 8) as *const u64);
    let local_1b0 = param_2;
    let local_1a8 = param_1;
    let local_1a0 = param_3;
    let local_198 = uVar10_init;
    let mut uVar10 = uVar10_init;

    let fn18: VFnI32 = std::mem::transmute(read_vfn(param_3, 0x18));
    let iVar7: i32 = fn18(param_3);
    let mut local_1d8: u64 = param_4;

    if iVar7 == 0 || iVar7 == 1 {
        let lVar8 = FUN_14005aaa0(uVar10, 0i32) as i64;
        if lVar8 == 0 {
            return 0;
        }
        // FUN_1404f6f20() was called here in original C with args lost by Ghidra
        // decompilation. The function writes to local_1c8 — leaving it at 0 is the
        // safest faithful fallback (matches default-init behavior).
        let local_1c8: i8 = 0;
        *((param_2 + 0xc5) as *mut i8) = local_1c8;
    } else if iVar7 == 2 {
        let mut local_1c8: i8 = 0;
        *((param_2 + 0xc5) as *mut i8) = local_1c8;
        let lVar8_init = FUN_14005aaa0(uVar10, 0i32) as i64;
        if lVar8_init != 0 && param_5 != 0 {
            let lVar8 = FUN_1404b1d90(lVar8_init, 5i32) as i64;
            if lVar8 != 0 {
                let mut uVar9: u64 = 0;
                let mut local_1c4: u32 = 0;
                loop {
                    local_1c8 = 1;
                    let uVar3 = *(((param_2 + 0x7c) + ((uVar9 & 0xff) as i64) * 0xc) as *const u32);
                    if uVar3 != 0 {
                        let uVar1_init = *((lVar8 + 0x30) as *const u16);
                        let lvar8_32 = *((lVar8 + 0x32) as *const i16);
                        if lvar8_32 != 0 {
                            let mut uVar1: u16 = uVar1_init;
                            let mut uVar13: u32 = 0;
                            let mut local_1c0: u16 = 0;

                            'middle: loop {
                                let lvar8_28 = *((lVar8 + 0x28) as *const i64);
                                let mut lVar12: i64 = 0;
                                if uVar1 < *((lvar8_28 + 0x24) as *const u16) {
                                    lVar12 = *((lvar8_28 + 8) as *const i64)
                                        + (uVar1 as i64) * 0x28;
                                }
                                local_1c0 =
                                    FUN_1404b7430(lVar8, uVar1 as u64) as usize as u16;
                                lVar12 = *((lVar12 + 8) as *const i64);
                                let mut uVar14: u32 = 0;
                                let mut plVar11 = *((lVar12 + 0x28) as *const *mut i64);
                                let lvar12_20 = *((lVar12 + 0x20) as *const i64);
                                if *((lvar12_20 + 0x20) as *const i16) != 0 {
                                    loop {
                                        let plVar4 = (*plVar11) as *mut i64;
                                        if !plVar4.is_null() {
                                            let fn18p4: VFnI32 =
                                                std::mem::transmute(read_vfn(plVar4, 0x18));
                                            let iv = fn18p4(plVar4);
                                            if iv == 0x544d3447i32 {
                                                let lVar5 = *plVar4.offset(4);
                                                let sVar2 = *((lVar5 + 0x20) as *const i16);
                                                local_1d8 = (local_1d8 & !0xffffu64)
                                                    | (sVar2 as u16 as u64);
                                                let mut local_1b8: [u32; 2] = [uVar3, 0];
                                                let off_2a =
                                                    *((lVar5 + 0x2a) as *const u16) as i64;
                                                let off_2e =
                                                    *((lVar5 + 0x2e) as *const u16) as i64;
                                                let off_0a =
                                                    *((lVar5 + 0xa) as *const u16) as i64;
                                                let arg2 = lVar5 + (off_2a + off_0a) * 4;
                                                let arg3 = lVar5 + (off_2e + off_0a) * 4;
                                                let sVar6 = FUN_1404b86f0(
                                                    local_1b8.as_mut_ptr(),
                                                    arg2,
                                                    arg3,
                                                )
                                                    as usize as i16;
                                                local_1c8 = if sVar6 != sVar2 { 1 } else { 0 };
                                                if local_1c8 != 0 {
                                                    break;
                                                }
                                            }
                                        }
                                        uVar14 = uVar14.wrapping_add(1);
                                        plVar11 = plVar11.offset(1);
                                        let lvar12_20b = *((lVar12 + 0x20) as *const i64);
                                        if uVar14
                                            >= *((lvar12_20b + 0x20) as *const u16) as u32
                                        {
                                            break;
                                        }
                                    }
                                }
                                param_2 = local_1b0;
                                if local_1c8 != 0 {
                                    break 'middle;
                                }
                                uVar13 = uVar13.wrapping_add(1);
                                uVar1 = local_1c0;
                                if uVar13 >= *((lVar8 + 0x32) as *const u16) as u32 {
                                    // Middle loop exhausted without early break — Not Exist Anime
                                    let cb_ptr = *((local_1a8 + 0xb8) as *const usize);
                                    if cb_ptr == 0 {
                                        FUN_1400abf50(
                                            0i64,
                                            b"gmdCAnimation::PlayAnime Not Exist Anime\n effect name [%s] motion index[%02u]\0".as_ptr() as *const i8,
                                        );
                                        param_2 = local_1b0;
                                    } else {
                                        let cb: CbFn = std::mem::transmute(cb_ptr);
                                        let mut local_188: *mut i64 = local_1a0.offset(0xd);
                                        cb(&mut local_188 as *mut *mut i64, 3i32);
                                        param_2 = local_1b0;
                                    }
                                    break 'middle;
                                }
                            }
                        }
                    }
                    // LAB_1404f6e74:
                    local_1c4 = local_1c4.wrapping_add(1);
                    uVar9 = local_1c4 as u64;
                    uVar10 = local_198;
                    if local_1c4 >= 3 {
                        break;
                    }
                }
            }
        }
        let lVar8 = FUN_14027d7f0(uVar10, 0i32) as i64;
        if lVar8 != 0 {
            let flag: i8 = if *((lVar8 + 0x38) as *const i8) != 0 { 1 } else { 0 };
            *((param_2 + 0xc4) as *mut i8) = flag + 1;
            return 1;
        }
    }

    1
}

pub unsafe fn FUN_1404f6f20(
    _param_1: u64,
    param_2: *mut u8,
    param_3: i64,
    param_4: i64,
    param_5: i64,
) -> c_void {
    let mut bVar2: u8 = 0;

    let s_68 = *((param_5 + 0x68) as *const i32);
    let s_74 = *((param_5 + 0x74) as *const i32);
    let s_80 = *((param_5 + 0x80) as *const i32);

    if s_68 == 0 && s_74 == 0 && s_80 == 0 {
        let mut puVar4 = (param_4 + 0x20) as *const u32;
        let mut puVar3 = (param_3 + 0x7c) as *mut u8;
        bVar2 = 0;
        loop {
            let uVar1 = *puVar4;
            // CONCAT44(CONCAT31(_,bVar2), uVar1) — u32 uVar1 at low, slot index byte at +4
            std::ptr::write_unaligned(puVar3 as *mut u32, uVar1);
            std::ptr::write_unaligned(puVar3.add(4), bVar2);
            // *(puVar3 + 8) = 0 (undefined4)
            std::ptr::write_unaligned(puVar3.add(8) as *mut u32, 0u32);
            puVar4 = puVar4.add(1);
            bVar2 = bVar2.wrapping_add(1);
            puVar3 = puVar3.add(0xc);
            if bVar2 >= 3 {
                break;
            }
        }
    } else {
        // Three-slot init when at least one of s_68/s_74/s_80 is non-zero.
        // Slot 0 at +0x7c: u32 s_68, byte 0 at +0x80, padding [0x81..0x84] untouched
        // *(param_3 + 0x84) (u32) = 0
        // Slot 1 at +0x88: u32 s_74, byte 1 at +0x8c
        // *(param_3 + 0x90) (u32) = 0
        // Slot 2 at +0x94: u32 s_80, byte 2 at +0x98
        // *(param_3 + 0x9c) (u32) = 0
        std::ptr::write_unaligned((param_3 + 0x7c) as *mut u32, s_68 as u32);
        std::ptr::write_unaligned((param_3 + 0x80) as *mut u8, 0u8);
        std::ptr::write_unaligned((param_3 + 0x84) as *mut u32, 0u32);
        std::ptr::write_unaligned((param_3 + 0x88) as *mut u32, s_74 as u32);
        std::ptr::write_unaligned((param_3 + 0x8c) as *mut u8, 1u8);
        std::ptr::write_unaligned((param_3 + 0x90) as *mut u32, 0u32);
        std::ptr::write_unaligned((param_3 + 0x94) as *mut u32, s_80 as u32);
        std::ptr::write_unaligned((param_3 + 0x98) as *mut u8, 2u8);
        std::ptr::write_unaligned((param_3 + 0x9c) as *mut u32, 0u32);
    }

    bVar2 = *((param_5 + 0x8c) as *const u8);
    if (bVar2 as i8) < 0 {
        bVar2 = 0;
        while *(((param_3 + 0x7c) + (bVar2 as i64) * 0xc) as *const i32) == 0 {
            bVar2 = bVar2.wrapping_add(1);
            if bVar2 > 2 {
                return std::mem::zeroed();
            }
        }
    }
    *param_2 = bVar2;
    std::mem::zeroed()
}
