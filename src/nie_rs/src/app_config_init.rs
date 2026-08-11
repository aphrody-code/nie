// Auto-generated via advanced AST semantic transpilation
#![allow(non_snake_case, non_camel_case_types, unused_variables, unused_mut, unused_assignments)]
use std::ffi::c_void;
use std::ffi::CString;
use crate::stubs::*;

pub unsafe fn FUN_140ae76b0(param_1: u64, param_2: i64) {
    let path = CString::new("common/system/app_config_5.00.24.00.cfg.bin").unwrap();
    FUN_140468ee0(path.as_ptr());

    let base = param_2 as *mut u8;
    let mut lvar1: i64 = -1;
    loop {
        lvar1 = lvar1.wrapping_add(1);
        let c = *base.offset(lvar1 as isize);
        if c == 0 {
            break;
        }
    }
    let idx = (lvar1 as i32) as isize;
    *base.offset(idx) = 0;
}
