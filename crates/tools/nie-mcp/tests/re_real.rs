//! Real reverse-engineering test over the MCP stdio surface.
//!
//! [`stdio_smoke`](../stdio_smoke.rs) proves the protocol; this proves the **answers**. It asks
//! the running server real questions about `nie.exe` and checks every answer against a source
//! the server did not produce:
//!
//! - `re_coverage` is re-derived from its own components (`classified / total`);
//! - the function starts the server hands back are corroborated against the **compiler's own
//!   `.pdata` unwind table**, read straight out of the reference binary with `nie-pe` — the
//!   ground truth `docs/RE.md` says to trust over the Ghidra index;
//!   `cli_atlas` answers are cross-read against the knowledge base through `re_query`.
//!
//! **Data-gated.** A fresh clone has neither the knowledge base nor the game binary (both are
//! excluded: the first is a 19 GB measurement, the second is © LEVEL-5). The test then reports
//! what it skipped and passes, exactly like the `nie-data` golden corpora.
//!
//! **What a failure here means.** The knowledge base is anchored on the binary it was indexed
//! from; the reference `nie.exe` may be another build. A corroboration rate that collapses is
//! not a bug in this test — it is the drift the repository must know about, and the reason the
//! rate is printed on every run instead of being hidden behind a boolean.

use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};

/// Fraction of the sampled named functions whose address is a real `.pdata` function start in
/// the reference binary.
///
/// **Measured 43.00 % on `vps-203bea89`, 2026-09-11** (172 / 400) — not a defect of this test:
/// the knowledge base is anchored on another build (`binary.sha256 = 4c2b91fb…`, 31,468,032
/// bytes) than the reference `nie.exe` (`b1fa04ea…`, 33,918,464 bytes, 55,351 `.pdata` roots
/// against the 50,674 the base indexed). The floor sits just under the measurement so a
/// further slide turns the gate red; raising it is the point of re-anchoring the base.
const PDATA_CORROBORATION_FLOOR: f64 = 0.40;

/// Fraction of the sample that lands anywhere inside a real function region (a start, or the
/// body of one). Measured 83.75 % (335 / 400): build drift moves function starts, but an index
/// that stopped describing this binary at all would fall through this floor.
const PDATA_CONTAINMENT_FLOOR: f64 = 0.75;

/// Named functions sampled from the knowledge base.
const SAMPLE: usize = 400;

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize()
        .expect("repository root")
}

fn request(stdin: &mut impl Write, value: serde_json::Value) {
    serde_json::to_writer(&mut *stdin, &value).expect("serialize JSON-RPC request");
    stdin.write_all(b"\n").expect("write JSON-RPC delimiter");
    stdin.flush().expect("flush JSON-RPC request");
}

fn response_for(reader: &mut impl BufRead, id: u64) -> serde_json::Value {
    loop {
        let mut line = String::new();
        let bytes = reader.read_line(&mut line).expect("read MCP response");
        assert_ne!(bytes, 0, "MCP server closed before response {id}");
        let value: serde_json::Value = serde_json::from_str(&line)
            .unwrap_or_else(|error| panic!("invalid MCP JSON line ({error}): {line:?}"));
        if value.get("id").and_then(serde_json::Value::as_u64) == Some(id) {
            return value;
        }
    }
}

/// One tool call, returning the parsed JSON payload the server wrapped in its text content.
fn call(
    stdin: &mut impl Write,
    reader: &mut impl BufRead,
    id: u64,
    name: &str,
    arguments: serde_json::Value,
) -> serde_json::Value {
    request(
        stdin,
        serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": "tools/call",
            "params": { "name": name, "arguments": arguments }
        }),
    );
    let response = response_for(reader, id);
    assert!(
        response.get("error").is_none(),
        "{name} failed: {}",
        response["error"]
    );
    let text = response["result"]["content"][0]["text"]
        .as_str()
        .unwrap_or_else(|| panic!("{name} returned no text content: {response}"));
    serde_json::from_str(text).unwrap_or_else(|_| serde_json::Value::String(text.to_string()))
}

struct Server {
    child: Child,
}

impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[test]
fn the_server_answers_real_questions_about_the_binary() {
    let root = repo_root();
    let kb = root.join("var/niers.sqlite");
    let exe = root.join("nie.exe");
    if !kb.is_file() || !exe.is_file() {
        eprintln!(
            "skip: knowledge base ({}) or reference binary ({}) absent — this test only runs on \
             the machine that owns both",
            kb.display(),
            exe.display()
        );
        return;
    }

    let child = Command::new(env!("CARGO_BIN_EXE_nie-mcp"))
        .current_dir(&root)
        .env("NIERS_REPO", &root)
        .env("NIERS_SQLITE", &kb)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .expect("start native MCP server");
    let mut server = Server { child };
    let mut stdin = server.child.stdin.take().expect("server stdin");
    let stdout = server.child.stdout.take().expect("server stdout");
    let mut reader = BufReader::new(stdout);

    request(
        &mut stdin,
        serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": { "name": "re-real", "version": "1" }
            }
        }),
    );
    response_for(&mut reader, 1);
    request(
        &mut stdin,
        serde_json::json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }),
    );

    // --- 1. Coverage must be internally consistent, not merely present. ---------------
    let coverage = call(&mut stdin, &mut reader, 2, "re_coverage", serde_json::json!({}));
    let total = find_number(&coverage, &["total", "total_funcs", "functions"])
        .unwrap_or_else(|| panic!("no total in coverage report: {coverage}"));
    let classified = find_number(&coverage, &["classified"])
        .unwrap_or_else(|| panic!("no classified count in coverage report: {coverage}"));
    assert!(total > 0.0, "empty knowledge base: {coverage}");
    assert!(
        classified <= total,
        "more classified than total: {classified} / {total}"
    );
    if let Some(pct) = find_number(&coverage, &["pct", "percent", "coverage_pct"]) {
        assert!(
            (pct - classified / total * 100.0).abs() < 0.05,
            "coverage percentage {pct} contradicts {classified}/{total}"
        );
    }

    // --- 2. A named function resolves, and resolves to the same address twice. --------
    let sample = call(
        &mut stdin,
        &mut reader,
        3,
        "re_query",
        serde_json::json!({
            "sql": "SELECT vaddr, name FROM function \
                    WHERE name IS NOT NULL AND name <> '' AND vaddr > 0 \
                    ORDER BY vaddr LIMIT 400",
            "limit": SAMPLE
        }),
    );
    let rows = sample["rows"].as_array().expect("re_query rows").clone();
    assert!(
        rows.len() >= 32,
        "the knowledge base holds too few named functions to test: {}",
        rows.len()
    );

    let (first_vaddr, first_name) = row_pair(&rows[0], &sample);
    let by_address = call(
        &mut stdin,
        &mut reader,
        4,
        "re_function",
        serde_json::json!({ "vaddr": format!("0x{first_vaddr:x}") }),
    );
    assert!(
        by_address.to_string().contains(&first_name),
        "re_function at 0x{first_vaddr:x} did not return {first_name}: {by_address}"
    );
    let by_name = call(
        &mut stdin,
        &mut reader,
        5,
        "re_function",
        serde_json::json!({ "name": first_name }),
    );
    let rendered = by_name.to_string();
    assert!(
        rendered.contains(&format!("0x{first_vaddr:x}")) || rendered.contains(&first_vaddr.to_string()),
        "re_function by name {first_name} lost its address 0x{first_vaddr:x}: {by_name}"
    );

    // --- 3. The real check: the compiler's own unwind table, read independently. ------
    let bytes = std::fs::read(&exe).expect("read the reference binary");
    let image = nie_pe::PeImage::parse(bytes).expect("parse the reference PE");
    let (ranges, stats) = nie_pe::pdata::scan(&image);
    assert!(stats.roots > 0, "no .pdata roots in {}", exe.display());
    let base = image.opt.image_base;
    let roots: std::collections::HashSet<u64> = ranges
        .iter()
        .filter(|range| !range.chained)
        .map(|range| base + u64::from(range.begin))
        .collect();

    let mut corroborated = 0usize;
    let mut inside_a_body = 0usize;
    for row in &rows {
        let (vaddr, _) = row_pair(row, &sample);
        if roots.contains(&vaddr) {
            corroborated += 1;
        } else if ranges
            .iter()
            .any(|r| vaddr > base + u64::from(r.begin) && vaddr < base + u64::from(r.end))
        {
            inside_a_body += 1;
        }
    }
    let rate = corroborated as f64 / rows.len() as f64;
    eprintln!(
        "re-real: {corroborated}/{} named functions start on a real .pdata root ({:.2} %), \
         {inside_a_body} fall inside a body, {} .pdata roots in the reference",
        rows.len(),
        rate * 100.0,
        stats.roots
    );
    let containment = (corroborated + inside_a_body) as f64 / rows.len() as f64;
    assert!(
        containment >= PDATA_CONTAINMENT_FLOOR,
        "only {:.2} % of the sampled addresses land in any real function region of {} — the \
         index no longer describes this binary at all",
        containment * 100.0,
        exe.display()
    );
    assert!(
        rate >= PDATA_CORROBORATION_FLOOR,
        "only {:.2} % of the knowledge base's named functions are real function starts in {} — \
         the base is anchored on another build, or the index regressed",
        rate * 100.0,
        exe.display()
    );

    // --- 4. The atlas answers, and agrees with the knowledge base it digested. --------
    let atlas = root.join("var/nie-atlas.sqlite");
    if atlas.is_file() {
        let status = call(
            &mut stdin,
            &mut reader,
            6,
            "cli_atlas",
            serde_json::json!({ "args": ["status", "--db", atlas.to_string_lossy()] }),
        );
        let line = status.to_string();
        assert!(
            line.contains("symbols=") && line.contains("units="),
            "cli_atlas status is not the measured line: {line}"
        );
        let symbols = value_after(&line, "symbols=").expect("symbols count");
        let named = find_number(&coverage, &["named"]).unwrap_or(0.0);
        assert!(
            symbols > 0.0,
            "the atlas digested no symbol while the base reports {named} named"
        );
        let gaps = call(
            &mut stdin,
            &mut reader,
            7,
            "cli_atlas",
            serde_json::json!({ "args": ["gaps", "--db", atlas.to_string_lossy(), "--json"] }),
        );
        assert!(
            gaps.is_array() || gaps.to_string().contains("area"),
            "cli_atlas gaps returned no ranked road: {gaps}"
        );
    } else {
        eprintln!("skip atlas cross-check: {} absent (just atlas)", atlas.display());
    }
}

/// First numeric value found under any of `keys`, at any depth.
fn find_number(value: &serde_json::Value, keys: &[&str]) -> Option<f64> {
    match value {
        serde_json::Value::Object(map) => {
            for key in keys {
                if let Some(found) = map.get(*key).and_then(as_number) {
                    return Some(found);
                }
            }
            map.values().find_map(|nested| find_number(nested, keys))
        }
        serde_json::Value::Array(items) => items.iter().find_map(|item| find_number(item, keys)),
        _ => None,
    }
}

/// Numbers as the server renders them. `re_query` returns the address columns of the RE
/// database as hexadecimal **strings** (`SqliteQueryOptions::re_database`), and integers beyond
/// 2^53 as decimal strings, so a plain `as_f64` sees neither.
fn as_number(value: &serde_json::Value) -> Option<f64> {
    if let Some(found) = value.as_f64() {
        return Some(found);
    }
    let text = value.as_str()?.trim();
    if let Some(hex) = text.strip_prefix("0x").or_else(|| text.strip_prefix("0X")) {
        return u64::from_str_radix(hex, 16).ok().map(|v| v as f64);
    }
    text.parse().ok()
}

/// `(vaddr, name)` of one `re_query` row, whether rows are objects or positional arrays.
fn row_pair(row: &serde_json::Value, page: &serde_json::Value) -> (u64, String) {
    if let Some(map) = row.as_object() {
        let vaddr = map.get("vaddr").and_then(as_number).expect("vaddr column") as u64;
        let name = map
            .get("name")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default()
            .to_string();
        return (vaddr, name);
    }
    let columns = page["columns"].as_array().expect("columns");
    let index = |wanted: &str| {
        columns
            .iter()
            .position(|c| c.as_str() == Some(wanted))
            .unwrap_or_else(|| panic!("column {wanted} missing from {columns:?}"))
    };
    let items = row.as_array().expect("row array");
    let vaddr = as_number(&items[index("vaddr")]).expect("vaddr value") as u64;
    let name = items[index("name")].as_str().unwrap_or_default().to_string();
    (vaddr, name)
}

/// Numeric value following `key` in a `key=value` measured line.
fn value_after(line: &str, key: &str) -> Option<f64> {
    let rest = line.split(key).nth(1)?;
    let digits: String = rest
        .chars()
        .take_while(|c| c.is_ascii_digit() || *c == '.')
        .collect();
    digits.parse().ok()
}
