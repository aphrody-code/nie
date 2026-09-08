//! End-to-end protocol smoke test for the standalone native server.

use std::io::BufReader;
use std::process::{Command, Stdio};

fn request(stdin: &mut impl std::io::Write, value: serde_json::Value) {
    serde_json::to_writer(&mut *stdin, &value).expect("serialize JSON-RPC request");
    stdin.write_all(b"\n").expect("write JSON-RPC delimiter");
    stdin.flush().expect("flush JSON-RPC request");
}

fn response_for(reader: &mut impl std::io::BufRead, id: u64) -> serde_json::Value {
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

fn text_content(response: &serde_json::Value) -> &str {
    response["result"]["content"][0]["text"]
        .as_str()
        .expect("text tool result")
}

#[test]
fn initialize_list_and_call_stay_on_clean_stdio() {
    let mut child = Command::new(env!("CARGO_BIN_EXE_nie-mcp"))
        .env("NIERS_GAME_EXE", "missing-native-smoke-game.exe")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .expect("start native MCP server");
    let mut stdin = child.stdin.take().expect("server stdin");
    let stdout = child.stdout.take().expect("server stdout");
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
                "clientInfo": { "name": "native-smoke", "version": "1" }
            }
        }),
    );
    let initialized = response_for(&mut reader, 1);
    assert_eq!(initialized["result"]["serverInfo"]["name"], "niers-game");

    request(
        &mut stdin,
        serde_json::json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }),
    );
    request(
        &mut stdin,
        serde_json::json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {} }),
    );
    let listed = response_for(&mut reader, 2);
    let tools = listed["result"]["tools"].as_array().expect("tools array");
    assert_eq!(tools.len(), 56);
    assert!(tools.iter().any(|tool| tool["name"] == "cli_info"));
    for compatibility_name in [
        "aphrody_api_health",
        "vfs_list",
        "vfs_search",
        "vfs_stat",
        "vfs_cat",
        "asset_get",
        "re_query",
        "re_function",
        "re_coverage",
        "repo_read",
        "explorer_status",
        "explorer_navigate",
        "explorer_open",
        "explorer_tab",
        "explorer_toast",
        "game_launch",
    ] {
        assert!(
            tools.iter().any(|tool| tool["name"] == compatibility_name),
            "missing compatibility tool {compatibility_name}"
        );
    }

    request(
        &mut stdin,
        serde_json::json!({
            "jsonrpc": "2.0",
            "id": 3,
            "method": "tools/call",
            "params": { "name": "cli_info", "arguments": { "args": ["--json"] } }
        }),
    );
    let called = response_for(&mut reader, 3);
    assert_eq!(
        called["result"]["structuredContent"]["success"], true,
        "unexpected CLI tool result: {called}"
    );
    assert!(
        called["result"]["structuredContent"]["stdout"]
            .as_str()
            .is_some_and(|stdout| stdout.contains("\"binaire\""))
    );

    request(
        &mut stdin,
        serde_json::json!({
            "jsonrpc": "2.0",
            "id": 4,
            "method": "tools/call",
            "params": { "name": "repo_read", "arguments": { "path": "Cargo.toml", "maxBytes": 4096 } }
        }),
    );
    let repository = response_for(&mut reader, 4);
    let repository: serde_json::Value =
        serde_json::from_str(text_content(&repository)).expect("repo_read JSON");
    assert_eq!(repository["path"], "Cargo.toml");
    assert_eq!(repository["binary"], false);

    request(
        &mut stdin,
        serde_json::json!({
            "jsonrpc": "2.0",
            "id": 5,
            "method": "tools/call",
            "params": { "name": "explorer_status", "arguments": {} }
        }),
    );
    let bridge = response_for(&mut reader, 5);
    let bridge: serde_json::Value =
        serde_json::from_str(text_content(&bridge)).expect("explorer_status JSON");
    assert!(
        bridge["url"]
            .as_str()
            .is_some_and(|url| url.ends_with("/bridge"))
    );

    request(
        &mut stdin,
        serde_json::json!({
            "jsonrpc": "2.0",
            "id": 6,
            "method": "tools/call",
            "params": { "name": "game_launch", "arguments": { "args": [] } }
        }),
    );
    let launch = response_for(&mut reader, 6);
    assert_eq!(launch["result"]["isError"], true);
    let launch: serde_json::Value =
        serde_json::from_str(text_content(&launch)).expect("game_launch error JSON");
    assert!(
        launch["error"]
            .as_str()
            .is_some_and(|error| error.contains("not found"))
    );

    request(
        &mut stdin,
        serde_json::json!({
            "jsonrpc": "2.0",
            "id": 7,
            "method": "tools/call",
            "params": { "name": "cli_info", "arguments": { "args": ["--not-a-real-option"] } }
        }),
    );
    let invalid_cli = response_for(&mut reader, 7);
    assert_eq!(invalid_cli["result"]["structuredContent"]["success"], false);

    drop(stdin);
    let status = child.wait().expect("wait for native MCP server");
    assert!(status.success(), "server exited with {status}");
}
