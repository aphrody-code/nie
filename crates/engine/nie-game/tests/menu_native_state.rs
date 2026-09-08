//! Explicit reference-VFS gate for the observed native-state input binding.

use std::process::Command;

#[test]
#[ignore = "requires the local reference game VFS; uses synthetic observation bytes"]
fn observed_native_state_reaches_real_menu_callbacks_without_hiding_missing_inputs() {
    let game = nie_formats::vfs::resolve_game_dir();
    assert!(nie_formats::vfs::donnees_disponibles(game.join("data")));
    let directory =
        std::env::temp_dir().join(format!("nie-native-state-gate-{}", std::process::id()));
    std::fs::create_dir_all(&directory).unwrap();
    let input = directory.join("synthetic-observations.json");
    std::fs::write(
        &input,
        r#"{"context_69c8_field_2cac6f":2,"context_69a8_field_9f10":0,"context_69a8_field_9f13":0}"#,
    )
    .unwrap();
    let mut reports = Vec::new();
    for inject in [false, true] {
        let output = directory.join(if inject {
            "injected.json"
        } else {
            "absent.json"
        });
        let mut command = Command::new(env!("CARGO_BIN_EXE_nie-game"));
        command
            .arg("--game-dir")
            .arg(&game)
            .args(["--menu", "main_menu", "--runtime", "--export-layout"])
            .arg(&output)
            .env("RUST_LOG", "error");
        if inject {
            command.arg("--menu-native-state").arg(&input);
        }
        assert!(command.status().unwrap().success());
        let document: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&output).unwrap()).unwrap();
        let report = document["runtimeSummary"].clone();
        assert!(report["menuEventsDispatched"].as_u64().unwrap() > 0);
        assert_eq!(
            report["menuEventsDispatched"],
            report["menuEventsSucceeded"]
        );
        reports.push(report);
        std::fs::remove_file(output).unwrap();
    }
    let ids = ["0x1953DBC1", "0xB314C568", "0xEF7BC853", "0xDD5C4CD4"];
    assert_eq!(reports[0]["observedNativeFields"], 0);
    assert_eq!(reports[1]["observedNativeFields"], 3);
    for id in ids {
        assert!(
            reports[0]["unknownGeneralCmds"]
                .as_array()
                .unwrap()
                .iter()
                .any(|entry| entry["cmdId"] == id)
        );
        assert!(
            !reports[1]["unknownGeneralCmds"]
                .as_array()
                .unwrap()
                .iter()
                .any(|entry| entry["cmdId"] == id)
        );
    }
    // The injected branch need not invoke all four getters; require actual dispatch,
    // while the library tests exercise every getter and both byte-selection branches.
    let resolved_calls: u64 = reports[1]["knownCmdsByName"]
        .as_object()
        .unwrap()
        .iter()
        .filter(|(name, _)| name.starts_with("ObservedNativeState("))
        .map(|(_, count)| count.as_u64().unwrap())
        .sum();
    assert!(resolved_calls > 0);
    std::fs::remove_file(input).unwrap();
    std::fs::remove_dir(directory).unwrap();
}
