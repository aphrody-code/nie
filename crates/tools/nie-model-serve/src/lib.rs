//! Portable model-catalog and menu-compositing core shared by the HTTP binding and WebAssembly.
//!
//! The `host` feature (enabled by default) contains the executable's filesystem, SQLite and TCP
//! bindings. Disable default features to consume only deterministic, byte-backed operations.

#![forbid(unsafe_code)]
#![allow(clippy::pedantic)]

pub mod catalog;
pub mod menu;
