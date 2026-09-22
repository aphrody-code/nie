//! Standalone binary binding for the native nie MCP server.

fn main() -> anyhow::Result<()> {
    nie_cli::main_entry_with(["nie", "mcp"])
}
