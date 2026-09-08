//! Standalone binary binding for the native niers MCP server.

fn main() -> anyhow::Result<()> {
    nie_cli::main_entry_with(["niers", "mcp"])
}
