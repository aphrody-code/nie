// SPDX-License-Identifier: Apache-2.0

use nie_aphrody::{probe_surfaces, resolve_aphrody_dir, BUNDLED_FAVICON_ICO, BUNDLED_ICON_SVG};

#[test]
fn test_aphrody_surfaces_probe() {
    let surfaces = probe_surfaces();
    let state_dir = resolve_aphrody_dir();
    assert_eq!(surfaces.state_dir, state_dir.display().to_string());
    assert!(!surfaces.state_dir.is_empty());

    // Brand assets are non-empty
    assert_eq!(BUNDLED_FAVICON_ICO.len(), 9126);
    assert!(BUNDLED_ICON_SVG.contains("<svg"));
    assert!(BUNDLED_ICON_SVG.contains("Aphrody"));

    // Check surfaces contracts
    assert_eq!(surfaces.web.origin, "https://aphrody.com");
    assert_eq!(surfaces.web.bind, "127.0.0.1:8083");
    assert_eq!(surfaces.mcp.default_tools_count, 38);
    assert_eq!(surfaces.redis.port, 6379);
    assert_eq!(surfaces.ssh.port, 22);
    assert_eq!(surfaces.rag.default_model, "all-minilm-l6-v2");
}
