//! Reusable inspection operations for game Lua chunks.
//!
//! This module deliberately owns data that can be consumed by the CLI, HTTP,
//! MCP, desktop, and WebAssembly bindings.  Host-specific serialisation types
//! belong in those bindings.

use serde::Serialize;

/// Header and structural statistics for a decoded Lua chunk.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ChunkInfo {
    pub version: u32,
    pub little_endian: bool,
    pub size_size_t: u32,
    pub num_params: u32,
    pub instructions: u32,
    pub total_instructions: u32,
    pub total_protos: u32,
    pub constants: u32,
    pub upvalues: u32,
    pub source: String,
    pub has_debug_info: bool,
    pub strings: Vec<String>,
}

/// An execution result suitable for a host-neutral inspector.
#[cfg(feature = "vm")]
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ExecutionResult {
    pub stdout: Vec<String>,
    pub error: Option<String>,
    pub returned: Vec<String>,
    pub missing_host_calls: Vec<String>,
    pub duration_ms: u32,
}

/// A Lua global exposed by the values inspector.
#[cfg(feature = "vm")]
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Global {
    pub name: String,
    pub type_name: String,
    pub value: String,
    pub len: Option<u32>,
}

/// Decode a Lua 5.2 chunk and return its structural information.
pub fn chunk_info(data: &[u8]) -> Result<ChunkInfo, crate::bytecode::BytecodeError> {
    let chunk = crate::bytecode::parse(data)?;
    let main = &chunk.main;

    let mut strings = Vec::new();
    collect_strings(main, &mut strings);
    strings.sort_unstable();
    strings.dedup();

    Ok(ChunkInfo {
        version: u32::from(chunk.header.version),
        little_endian: chunk.header.little_endian,
        size_size_t: u32::from(chunk.header.size_size_t),
        num_params: u32::from(main.num_params),
        instructions: main.code.len() as u32,
        total_instructions: main.total_instructions() as u32,
        total_protos: main.total_protos() as u32,
        constants: main.constants.len() as u32,
        upvalues: main.upvalues.len() as u32,
        source: main.source.clone(),
        has_debug_info: !main.line_info.is_empty() || !main.loc_vars.is_empty(),
        strings,
    })
}

/// Disassemble a Lua 5.2 chunk.
pub fn disassemble(data: &[u8]) -> Result<String, crate::bytecode::BytecodeError> {
    let chunk = crate::bytecode::parse(data)?;
    Ok(crate::bytecode::disassemble(&chunk))
}

fn collect_strings(prototype: &crate::bytecode::Prototype, output: &mut Vec<String>) {
    for constant in &prototype.constants {
        if let crate::bytecode::Constant::String(bytes) = constant {
            let value = String::from_utf8_lossy(bytes).trim().to_string();
            if !value.is_empty() {
                output.push(value);
            }
        }
    }
    for nested in &prototype.protos {
        collect_strings(nested, output);
    }
}

/// Execute source or game bytecode in a new VM for inspection.
#[cfg(feature = "vm")]
pub fn execute(
    data: &[u8],
    chunk_name: &str,
    with_menu_host: bool,
    instruction_limit: Option<u32>,
) -> Result<ExecutionResult, crate::LuaError> {
    let options = crate::runtime::ExecOptions {
        chunk_name: chunk_name.to_string(),
        instruction_limit,
        with_menu_host,
        context: crate::runtime::RuntimeContext::default(),
    };
    let output = crate::runtime::execute(data, &options)?;
    Ok(ExecutionResult {
        stdout: output.stdout,
        error: output.error,
        returned: output.returned,
        missing_host_calls: output.missing_host_calls,
        duration_ms: output.duration_ms as u32,
    })
}

/// Execute a chunk in a new VM, then list the globals it left behind.
#[cfg(feature = "vm")]
pub fn globals_after_run(
    data: &[u8],
    chunk_name: &str,
    with_menu_host: bool,
    overrides: &[(String, String)],
    include_stdlib: bool,
) -> Result<Vec<Global>, crate::LuaError> {
    let lua = crate::new_vm();
    let sink = std::rc::Rc::new(std::cell::RefCell::new(Vec::new()));
    crate::runtime::install_print_capture(&lua, sink)?;
    if with_menu_host {
        crate::install_menu_host(&lua)?;
    }

    for (name, expression) in overrides {
        let assignment = format!("{name} = {expression}");
        lua.load(&assignment)
            .set_name("=override")
            .exec()
            .map_err(|error| {
                crate::LuaError::Vm(mlua::Error::RuntimeError(format!(
                    "override {name} = {expression}: {error}"
                )))
            })?;
    }

    crate::runtime::install_host_stubs(&lua)?;
    let mode = if crate::is_lua52_bytecode(data) {
        crate::ChunkMode::Binary
    } else {
        crate::ChunkMode::Text
    };
    let _ = lua
        .load(data)
        .set_name(chunk_name.to_string())
        .set_mode(mode)
        .exec();

    Ok(crate::runtime::list_globals(&lua, include_stdlib)
        .into_iter()
        .map(|global| Global {
            name: global.name,
            type_name: global.type_name,
            value: global.value,
            len: global.len,
        })
        .collect())
}

/// Evaluate an expression after a source or bytecode chunk ran in a new VM.
#[cfg(feature = "vm")]
pub fn eval(
    data: &[u8],
    chunk_name: &str,
    expression: &str,
    with_menu_host: bool,
) -> Result<String, crate::LuaError> {
    let lua = crate::new_vm();
    let sink = std::rc::Rc::new(std::cell::RefCell::new(Vec::new()));
    crate::runtime::install_print_capture(&lua, sink)?;
    if with_menu_host {
        crate::install_menu_host(&lua)?;
    }
    crate::runtime::install_host_stubs(&lua)?;

    if !data.is_empty() {
        let mode = if crate::is_lua52_bytecode(data) {
            crate::ChunkMode::Binary
        } else {
            crate::ChunkMode::Text
        };
        let _ = lua
            .load(data)
            .set_name(chunk_name.to_string())
            .set_mode(mode)
            .exec();
    }

    crate::runtime::eval_expression(&lua, expression)
}

#[cfg(all(test, feature = "vm"))]
mod tests {
    use super::*;

    #[test]
    fn inspection_preserves_bytecode_and_runtime_results() {
        let lua = crate::new_vm();
        let dumped = lua
            .load("local x = 1 print('hello') return x")
            .into_function()
            .expect("compile")
            .dump(false);
        let info = chunk_info(&dumped).expect("info");
        assert_eq!(info.version, 0x52);
        assert!(info.strings.iter().any(|value| value == "hello"));
        assert!(
            disassemble(&dumped)
                .expect("disassemble")
                .contains("function main")
        );

        let output =
            execute(b"print('hello') return 5", "test", false, Some(1_000_000)).expect("execute");
        assert_eq!(output.stdout, ["hello"]);
        assert_eq!(output.returned, ["5"]);
    }

    #[test]
    fn globals_and_expression_share_the_same_inspection_contract() {
        let globals = globals_after_run(b"hp = 10", "test", false, &[], false).expect("globals");
        assert_eq!(
            globals
                .iter()
                .find(|entry| entry.name == "hp")
                .map(|entry| entry.value.as_str()),
            Some("10")
        );
        assert_eq!(
            eval(b"total = 6 * 7", "test", "total", false).expect("eval"),
            "42"
        );
    }
}
