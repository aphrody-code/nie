//! Thread-local output capture for in-process CLI adapters.

use std::cell::RefCell;
use std::fmt;
use std::io::Write as _;

use serde::Serialize;

#[derive(Debug, Default)]
pub(crate) struct CapturedOutput {
    stdout: String,
    stderr: String,
    truncated: bool,
}

/// Stable response envelope returned by native MCP command tools.
#[derive(Debug, Serialize, schemars::JsonSchema)]
pub struct CapturedCommand {
    /// Whether the command completed without an error.
    pub success: bool,
    /// Text the CLI wrote to stdout.
    pub stdout: String,
    /// Diagnostic text the CLI wrote to stderr.
    pub stderr: String,
    /// Display-safe error chain when the command failed.
    pub error: Option<String>,
    /// Whether stdout or stderr exceeded the bounded MCP response buffer.
    pub truncated: bool,
}

impl CapturedCommand {
    pub(crate) fn from_result(result: Result<(), String>, captured: CapturedOutput) -> Self {
        match result {
            Ok(()) => Self {
                success: true,
                stdout: captured.stdout,
                stderr: captured.stderr,
                error: None,
                truncated: captured.truncated,
            },
            Err(error) => Self {
                success: false,
                stdout: captured.stdout,
                stderr: captured.stderr,
                error: Some(error),
                truncated: captured.truncated,
            },
        }
    }

    pub(crate) fn failed(error: impl Into<String>) -> Self {
        Self {
            success: false,
            stdout: String::new(),
            stderr: String::new(),
            error: Some(error.into()),
            truncated: false,
        }
    }
}

thread_local! {
    static CAPTURE: RefCell<Option<CapturedOutput>> = const { RefCell::new(None) };
}

pub(crate) fn capture<T>(operation: impl FnOnce() -> T) -> (T, CapturedOutput) {
    CAPTURE.with(|slot| {
        assert!(slot.borrow().is_none(), "nested CLI output capture");
        *slot.borrow_mut() = Some(CapturedOutput::default());
    });
    let result = operation();
    let captured = CAPTURE.with(|slot| slot.borrow_mut().take().unwrap_or_default());
    (result, captured)
}

const MAX_CAPTURE_BYTES: usize = 8 * 1024 * 1024;

fn append(target: &mut String, args: fmt::Arguments<'_>, newline: bool) -> bool {
    if target.len() >= MAX_CAPTURE_BYTES {
        return true;
    }
    let mut fragment = args.to_string();
    if newline {
        fragment.push('\n');
    }
    let remaining = MAX_CAPTURE_BYTES - target.len();
    if fragment.len() <= remaining {
        target.push_str(&fragment);
        false
    } else {
        let boundary = fragment
            .char_indices()
            .take_while(|(index, _)| *index <= remaining)
            .map(|(index, _)| index)
            .last()
            .unwrap_or(0);
        target.push_str(&fragment[..boundary]);
        true
    }
}

pub(crate) fn write_stdout(args: fmt::Arguments<'_>, newline: bool) {
    let captured = CAPTURE.with(|slot| {
        let mut slot = slot.borrow_mut();
        if let Some(output) = slot.as_mut() {
            output.truncated |= append(&mut output.stdout, args, newline);
            true
        } else {
            false
        }
    });
    if !captured {
        let stdout = std::io::stdout();
        let mut lock = stdout.lock();
        lock.write_fmt(args).expect("failed to write stdout");
        if newline {
            lock.write_all(b"\n").expect("failed to write stdout");
        }
    }
}

pub(crate) fn write_stderr(args: fmt::Arguments<'_>, newline: bool) {
    let captured = CAPTURE.with(|slot| {
        let mut slot = slot.borrow_mut();
        if let Some(output) = slot.as_mut() {
            output.truncated |= append(&mut output.stderr, args, newline);
            true
        } else {
            false
        }
    });
    if !captured {
        let stderr = std::io::stderr();
        let mut lock = stderr.lock();
        lock.write_fmt(args).expect("failed to write stderr");
        if newline {
            lock.write_all(b"\n").expect("failed to write stderr");
        }
    }
}
