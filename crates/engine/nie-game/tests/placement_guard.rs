//! Unresolved geometry cannot enter either native paint pass, even with legacy coordinates.
use std::process::Command;

#[test]
fn unresolved_sprite_and_text_never_paint_placeholder_coordinates() {
    let directory =
        std::env::temp_dir().join(format!("nie-placement-guard-{}", std::process::id()));
    std::fs::create_dir_all(&directory).unwrap();
    let input = directory.join("layout.json");
    let output = directory.join("render.png");
    let objects: Vec<_> = [
        serde_json::json!("unresolved"),
        serde_json::json!(42),
        serde_json::Value::Null,
    ]
    .into_iter()
    .map(|source| {
        serde_json::json!({
            "name": "unresolved", "visible": true, "placementSource": source,
            "transform": {"x": 640, "y": 360, "scaleX": 1, "scaleY": 1},
            "text": "Must never be rasterized", "sprite": {"logicalPath": "missing.g4tx"}
        })
    })
    .collect();
    std::fs::write(
        &input,
        serde_json::to_vec(&serde_json::json!({"objects": objects})).unwrap(),
    )
    .unwrap();
    let result = Command::new(env!("CARGO_BIN_EXE_nie-game"))
        .arg("--game-dir")
        .arg(&directory)
        .arg("--compose-layout")
        .arg(&input)
        .arg("--capture")
        .arg(&output)
        .output()
        .unwrap();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    let data = std::fs::read(&output).unwrap();
    let mut reader = png::Decoder::new(std::io::Cursor::new(data))
        .read_info()
        .unwrap();
    let mut rgba = vec![0; reader.output_buffer_size().unwrap()];
    let info = reader.next_frame(&mut rgba).unwrap();
    assert_eq!((info.width, info.height), (1280, 720));
    assert_eq!(info.color_type, png::ColorType::Rgba);
    assert!(
        rgba[..info.buffer_size()]
            .chunks_exact(4)
            .all(|pixel| pixel[3] == 0)
    );
    std::fs::remove_file(input).unwrap();
    std::fs::remove_file(output).unwrap();
    std::fs::remove_dir(directory).unwrap();
}
