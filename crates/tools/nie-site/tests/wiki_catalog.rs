//! HTTP contract guard for the character catalogue delegated to `nie-wiki`.

#[tokio::test]
#[ignore = "requires frozen historical location responses and licensed mirror"]
async fn legacy_locations_http_matches_complete_historical_json() {
    let mirror = std::env::var("NIE_LEGACY_PARITY_MIRROR").expect("mirror path");
    let fixture = std::env::var("NIE_LOCATIONS_PARITY_FIXTURE").expect("fixture path");
    let cases: Vec<serde_json::Value> =
        serde_json::from_slice(&std::fs::read(fixture).unwrap()).unwrap();
    let router = nie_site::routeur(EtatSite::pour_tests(
        Config {
            db: mirror.into(),
            statique: "/nonexistent/dist".into(),
            ..Config::default()
        },
        IndexVfs::depuis(Vec::new()),
    ));
    let encode = |value: &str| {
        value
            .bytes()
            .map(|byte| format!("%{byte:02X}"))
            .collect::<String>()
    };
    let mut count = 0;
    for case in cases {
        let kind = case["kind"].as_str().unwrap();
        let uri = match kind {
            "shops" => "/api/shops?q=ignored&limit=1&page=2".into(),
            "shop" => format!(
                "/api/shops/{}",
                encode(case["request"]["id"].as_str().unwrap())
            ),
            "stadiums" => format!(
                "/api/stadiums?q={}&limit=1&page=2",
                encode(case["request"]["q"].as_str().unwrap_or(""))
            ),
            "stadium" => format!(
                "/api/stadiums/{}",
                encode(case["request"]["id"].as_str().unwrap())
            ),
            _ => panic!("unknown fixture"),
        };
        let response = router
            .clone()
            .oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap())
            .await
            .unwrap();
        let expected = if case["expected"].is_null() {
            assert_eq!(response.status(), StatusCode::NOT_FOUND);
            let name = if kind == "shop" { "boutique" } else { "stade" };
            serde_json::json!({"error":format!("{name} introuvable")})
        } else {
            assert_eq!(response.status(), StatusCode::OK);
            case["expected"].clone()
        };
        let actual: serde_json::Value =
            serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes())
                .unwrap();
        assert!(
            actual == expected,
            "location HTTP contract differs for {kind} {}",
            case["request"]
        );
        count += 1;
    }
    assert_eq!(count, 112);
}

#[tokio::test]
#[ignore = "requires frozen historical team responses and licensed mirror"]
async fn legacy_teams_http_matches_complete_historical_json() {
    let mirror = std::env::var("NIE_LEGACY_PARITY_MIRROR").expect("mirror path");
    let fixture = std::env::var("NIE_ENTITIES_PARITY_FIXTURE").expect("fixture path");
    let cases: Vec<serde_json::Value> =
        serde_json::from_slice(&std::fs::read(fixture).unwrap()).unwrap();
    let router = nie_site::routeur(EtatSite::pour_tests(
        Config {
            db: mirror.into(),
            statique: "/nonexistent/dist".into(),
            ..Config::default()
        },
        IndexVfs::depuis(Vec::new()),
    ));
    let encode = |value: &str| {
        value
            .bytes()
            .map(|byte| format!("%{byte:02X}"))
            .collect::<String>()
    };
    let mut count = 0;
    for case in cases {
        let uri = match case["kind"].as_str().unwrap() {
            "teams" => "/api/teams?q=ignored&limit=1&page=2".into(),
            "team" => format!(
                "/api/teams/{}",
                encode(case["request"]["id"].as_str().unwrap())
            ),
            _ => continue,
        };
        let response = router
            .clone()
            .oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap())
            .await
            .unwrap();
        let expected = if case["expected"].is_null() {
            assert_eq!(response.status(), StatusCode::NOT_FOUND);
            serde_json::json!({"error":"équipe introuvable"})
        } else {
            assert_eq!(response.status(), StatusCode::OK);
            case["expected"].clone()
        };
        let actual: serde_json::Value =
            serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes())
                .unwrap();
        assert!(
            actual == expected,
            "team HTTP contract differs for {}",
            case["request"]
        );
        count += 1;
    }
    assert_eq!(count, 210);
}

#[tokio::test]
#[ignore = "requires frozen historical staff responses and licensed mirror"]
async fn legacy_coaches_http_matches_complete_historical_json() {
    let mirror = std::env::var("NIE_LEGACY_PARITY_MIRROR").expect("mirror path");
    let fixture = std::env::var("NIE_ENTITIES_PARITY_FIXTURE").expect("fixture path");
    let cases: Vec<serde_json::Value> =
        serde_json::from_slice(&std::fs::read(fixture).unwrap()).unwrap();
    let router = nie_site::routeur(EtatSite::pour_tests(
        Config {
            db: mirror.into(),
            statique: "/nonexistent/dist".into(),
            ..Config::default()
        },
        IndexVfs::depuis(Vec::new()),
    ));
    let encode = |value: &str| {
        value
            .bytes()
            .map(|byte| format!("%{byte:02X}"))
            .collect::<String>()
    };
    let mut count = 0;
    for case in cases {
        let uri = match case["kind"].as_str().unwrap() {
            "coaches" => format!(
                "/api/coaches?q={}&role=ignored&limit=1",
                encode(case["request"]["q"].as_str().unwrap_or(""))
            ),
            "coach" => format!(
                "/api/coaches/{}",
                encode(case["request"]["id"].as_str().unwrap())
            ),
            _ => continue,
        };
        let response = router
            .clone()
            .oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap())
            .await
            .unwrap();
        let expected = if case["expected"].is_null() {
            assert_eq!(response.status(), StatusCode::NOT_FOUND);
            serde_json::json!({"error":"coach introuvable"})
        } else {
            assert_eq!(response.status(), StatusCode::OK);
            case["expected"].clone()
        };
        let actual: serde_json::Value =
            serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes())
                .unwrap();
        assert!(
            actual == expected,
            "staff HTTP contract differs for {}",
            case["request"]
        );
        count += 1;
    }
    assert_eq!(count, 115);
}

#[tokio::test]
#[ignore = "requires licensed mirror for browser/native roster parity"]
async fn browser_roster_and_skills_use_native_operation_contracts() {
    let mirror = std::env::var("NIE_LEGACY_PARITY_MIRROR").expect("mirror path");
    let connection =
        rusqlite::Connection::open_with_flags(&mirror, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .unwrap();
    let router = nie_site::routeur(EtatSite::pour_tests(
        Config {
            db: mirror.into(),
            statique: "/nonexistent/dist".into(),
            ..Config::default()
        },
        IndexVfs::depuis(Vec::new()),
    ));
    let mut requests = vec![(
        "/api/v1/wiki/roster".to_owned(),
        "load_roster",
        serde_json::json!({}),
    )];
    requests.push((
        "/api/v1/wiki/staff".into(),
        "load_staff",
        serde_json::json!({}),
    ));
    for id in ["0x12B74634", "0xA2957757"] {
        requests.push((
            format!("/api/v1/wiki/characters/{id}/skills"),
            "character_skills",
            serde_json::json!({"id":id}),
        ));
    }
    for (uri, operation, args) in requests {
        let expected = nie_wiki::desktop::execute(&connection, operation, &args).unwrap();
        assert!(
            !expected.as_array().unwrap().is_empty(),
            "meaningful {operation}"
        );
        if operation == "load_roster" {
            let rows = expected.as_array().unwrap();
            let byron = rows
                .iter()
                .find(|row| row["id"] == "0x12B74634")
                .expect("Byron BASARA");
            let stats = [
                "stat_frappe",
                "stat_controle",
                "stat_technique",
                "stat_pression",
                "stat_physique",
                "stat_agilite",
                "stat_intelligence",
            ];
            assert_eq!(
                stats
                    .iter()
                    .map(|field| byron[field].as_i64().expect("numeric stat"))
                    .sum::<i64>(),
                1592
            );
            for row in rows {
                for field in stats {
                    assert!(row[field].is_null() || row[field].is_i64());
                }
            }
        } else if operation == "load_staff" {
            assert!(
                expected
                    .as_array()
                    .unwrap()
                    .iter()
                    .all(|row| row["id"].is_i64())
            );
        }
        let response = router
            .clone()
            .oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let actual: serde_json::Value =
            serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes())
                .unwrap();
        assert!(
            actual == expected,
            "native/browser mismatch for {operation}"
        );
    }
    let response = router
        .oneshot(
            Request::builder()
                .uri("/api/v1/wiki/characters/unknown-player/skills")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
#[ignore = "requires fresh-process historical character detail responses and licensed mirror"]
async fn legacy_character_detail_http_matches_isolated_historical_json() {
    let fixture =
        std::env::var("NIE_CHARACTER_DETAIL_PARITY_FIXTURE").expect("isolated fixture path");
    let mirror = std::env::var("NIE_LEGACY_PARITY_MIRROR").expect("mirror path");
    let cases: Vec<serde_json::Value> =
        serde_json::from_slice(&std::fs::read(fixture).unwrap()).unwrap();
    assert!(cases.len() >= 22);
    let router = nie_site::routeur(EtatSite::pour_tests(
        Config {
            db: mirror.into(),
            statique: "/nonexistent/dist".into(),
            ..Config::default()
        },
        IndexVfs::depuis(Vec::new()),
    ));
    for (index, case) in cases.iter().enumerate() {
        let id = case["input"]
            .as_str()
            .unwrap()
            .bytes()
            .map(|byte| {
                if byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.') {
                    (byte as char).to_string()
                } else {
                    format!("%{byte:02X}")
                }
            })
            .collect::<String>();
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri(format!("/api/characters/{id}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        if case["expected"].is_null() {
            assert_eq!(
                response.status(),
                StatusCode::NOT_FOUND,
                "detail fixture {index}"
            );
            let body: serde_json::Value =
                serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes())
                    .unwrap();
            assert_eq!(body, serde_json::json!({"error":"personnage introuvable"}));
        } else {
            assert_eq!(response.status(), StatusCode::OK, "detail fixture {index}");
            let body: serde_json::Value =
                serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes())
                    .unwrap();
            assert!(
                body == case["expected"],
                "character detail HTTP contract differs at fixture {index}"
            );
        }
    }
}

#[tokio::test]
#[ignore = "requires captured historical gallery responses and the same licensed mirror"]
async fn legacy_gallery_http_matches_captured_historical_json() {
    let fixture = std::env::var("NIE_GALLERY_PARITY_FIXTURE").expect("fixture path");
    let mirror = std::env::var("NIE_LEGACY_PARITY_MIRROR").expect("mirror path");
    let cases: Vec<serde_json::Value> =
        serde_json::from_slice(&std::fs::read(fixture).unwrap()).unwrap();
    assert!(cases.len() >= 20);
    let router = nie_site::routeur(EtatSite::pour_tests(
        Config {
            db: mirror.into(),
            statique: "/nonexistent/dist".into(),
            ..Config::default()
        },
        IndexVfs::depuis(Vec::new()),
    ));
    for (index, case) in cases.iter().enumerate() {
        let query = case["input"]
            .as_object()
            .unwrap()
            .iter()
            .map(|(key, value)| {
                let value = value
                    .as_str()
                    .map(str::to_owned)
                    .unwrap_or_else(|| value.to_string());
                let encoded = value
                    .bytes()
                    .map(|byte| {
                        if byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.') {
                            (byte as char).to_string()
                        } else {
                            format!("%{byte:02X}")
                        }
                    })
                    .collect::<String>();
                format!("{key}={encoded}")
            })
            .collect::<Vec<_>>()
            .join("&");
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri(format!("/api/gallery?{query}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK, "gallery fixture {index}");
        let body: serde_json::Value =
            serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes())
                .unwrap();
        assert!(
            body == case["expected"],
            "gallery HTTP contract differs at fixture {index}"
        );
    }
    let response = router
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/gallery?limit=301")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body: serde_json::Value =
        serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert_eq!(body["limit"], 300);
    assert_eq!(body["total"], 360);
    assert_eq!(body["data"].as_array().unwrap().len(), 300);
    let response = router
        .oneshot(
            Request::builder()
                .uri("/api/v1/wiki/gallery?view=editorial")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body: serde_json::Value =
        serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert_eq!(body["total"], 3939);
    assert_eq!(
        body["categories"]
            .as_array()
            .unwrap()
            .iter()
            .map(|category| category["count"].as_u64().unwrap())
            .sum::<u64>(),
        3939
    );
}

#[tokio::test]
#[ignore = "requires ignored historical equipment responses and the same licensed mirror"]
async fn legacy_equipment_http_matches_captured_historical_json() {
    let fixture = std::env::var("NIE_EQUIPMENT_PARITY_FIXTURE").expect("fixture path");
    let mirror = std::env::var("NIE_LEGACY_PARITY_MIRROR").expect("mirror path");
    let cases: Vec<serde_json::Value> =
        serde_json::from_slice(&std::fs::read(fixture).unwrap()).unwrap();
    assert!(cases.len() >= 17);
    let router = nie_site::routeur(EtatSite::pour_tests(
        Config {
            db: mirror.into(),
            statique: "/nonexistent/dist".into(),
            ..Config::default()
        },
        IndexVfs::depuis(Vec::new()),
    ));
    let encode = |value: &str| {
        value
            .bytes()
            .map(|byte| {
                if byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.') {
                    (byte as char).to_string()
                } else {
                    format!("%{byte:02X}")
                }
            })
            .collect::<String>()
    };
    for (index, case) in cases.iter().enumerate() {
        let family = case["family"].as_str().unwrap();
        let uri = if let Some(family) = family.strip_suffix("_detail") {
            format!("/api/{family}/{}", encode(case["id"].as_str().unwrap()))
        } else {
            let query = case["input"]
                .as_object()
                .unwrap()
                .iter()
                .map(|(key, value)| {
                    let value = value
                        .as_str()
                        .map(str::to_owned)
                        .unwrap_or_else(|| value.to_string());
                    format!("{}={}", encode(key), encode(&value))
                })
                .collect::<Vec<_>>()
                .join("&");
            format!("/api/{family}?{query}")
        };
        let response = router
            .clone()
            .oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK, "fixture {index}");
        let actual: serde_json::Value =
            serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes())
                .unwrap();
        assert!(
            actual == case["expected"],
            "equipment HTTP contract differs at fixture {index}"
        );
    }
    for (uri, status) in [
        ("/api/items?limit=201", StatusCode::OK),
        ("/api/skills?power_min=invalid", StatusCode::BAD_REQUEST),
        ("/api/items?category=absent&page=2&limit=1", StatusCode::OK),
        ("/api/items/unknown-exact-id", StatusCode::NOT_FOUND),
        ("/api/skills/unknown-exact-id", StatusCode::NOT_FOUND),
    ] {
        let response = router
            .clone()
            .oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), status, "{uri}");
        if uri == "/api/items?limit=201" {
            let body: serde_json::Value =
                serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes())
                    .unwrap();
            assert_eq!(body["limit"], 200);
            assert_eq!(body["data"].as_array().unwrap().len(), 200);
        } else if status == StatusCode::NOT_FOUND {
            let body: serde_json::Value =
                serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes())
                    .unwrap();
            let resource = if uri.starts_with("/api/items/") {
                "objet"
            } else {
                "technique"
            };
            assert_eq!(
                body,
                serde_json::json!({"error":format!("{resource} introuvable")})
            );
        }
    }
}

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt as _;
use nie_site::config::Config;
use nie_site::state::EtatSite;
use nie_site::vfs_index::IndexVfs;
use tower::ServiceExt as _;

#[tokio::test]
async fn character_catalog_keeps_filters_facets_order_and_pagination() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("mirror.sqlite");
    let connection = rusqlite::Connection::open(&database).unwrap();
    connection
        .execute_batch(
            "CREATE TABLE inagle_characters (
                internal_code TEXT, chara_id TEXT, base_slug TEXT,
                name_fr TEXT, name_en TEXT, name_ja TEXT,
                element TEXT, position TEXT, rarity TEXT, series TEXT,
                model_id TEXT, zukan_order INTEGER
            );
            INSERT INTO inagle_characters VALUES
                ('c3', NULL, 'three', '100%_a', NULL, NULL, 'Feu', 'Attaquant', 'SSR', 'GO', NULL, 3),
                ('c1', NULL, 'one', 'Mark', NULL, NULL, 'Vent', 'Gardien', 'SR', 'OG', NULL, 1),
                ('c2', NULL, 'two', 'Axel', NULL, NULL, 'Feu', 'Attaquant', 'SSR', 'OG', NULL, 2);",
        )
        .unwrap();
    drop(connection);

    let config = Config {
        db: database,
        statique: "/nonexistent/dist".into(),
        amont: "http://127.0.0.1:1".to_owned(),
        ..Config::default()
    };
    let state = EtatSite::pour_tests(config, IndexVfs::depuis(Vec::new()));
    let response = nie_site::routeur(state)
        .oneshot(
            Request::builder()
                .uri("/api/v1/chara?page=2&per_page=1&element__in=Feu,Vent&position=Attaquant&tri=nom_fr&ordre=desc")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();

    assert_eq!(body["total"], 2);
    assert_eq!(body["pages"], 2);
    assert_eq!(body["page"], 2);
    assert_eq!(body["per_page"], 1);
    assert_eq!(body["elements"].as_array().unwrap().len(), 1);
    assert_eq!(body["elements"][0]["internal_code"], "c3");
    assert_eq!(body["filtres"]["position"], "Attaquant");
    assert_eq!(body["filtres"]["tri"], "nom_fr");
    assert_eq!(body["filtres"]["ordre"], "desc");
    assert_eq!(
        body["filtres"]["listes"]["element__in"],
        serde_json::json!(["Feu", "Vent"])
    );
    assert_eq!(
        body["facettes"]["element"],
        serde_json::json!([{"valeur": "Feu", "total": 2}])
    );
    assert_eq!(
        body["facettes"]["position"],
        serde_json::json!([
            {"valeur": "Attaquant", "total": 2},
            {"valeur": "Gardien", "total": 1}
        ])
    );
}

#[tokio::test]
async fn extended_character_filters_survive_http_and_project_exact_variant_identity() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("mirror.sqlite");
    let connection = rusqlite::Connection::open(&database).unwrap();
    connection
        .execute_batch(
            "CREATE TABLE inagle_characters (
        internal_code TEXT, chara_id TEXT, base_slug TEXT, name_fr TEXT, name_en TEXT,
        name_ja TEXT, element TEXT, position TEXT, rarity TEXT, series TEXT,
        model_id TEXT, zukan_order TEXT, id TEXT, gender TEXT, sheet_data TEXT,
        age_group TEXT, school_year TEXT, team_id TEXT, is_controllable TEXT
    ); INSERT INTO inagle_characters VALUES
        ('c1','h1','byron','Byron','Byron',NULL,'Forêt','Milieu','Normal','IE',NULL,'10',
        'v1','M','{\"playstyle\":\"Freedom\"}','Middle School','Grade 7','team1','t'),
        ('c2','h2','other','Other','Other',NULL,'Feu','Gardien','Normal','IE',NULL,'2',
        'v2','F','\\\\N','Adult',NULL,'team2','f');",
        )
        .unwrap();
    drop(connection);
    let state = EtatSite::pour_tests(
        Config {
            db: database,
            statique: "/nonexistent/dist".into(),
            ..Config::default()
        },
        IndexVfs::depuis(Vec::new()),
    );
    let response = nie_site::routeur(state).oneshot(Request::builder()
        .uri("/api/v1/chara?gender=1&playstyle=Breach&ageGroup=Middle%20School&schoolYear=Grade%207&team=team1&playable=true&incomplete=false&per_page=1")
        .body(Body::empty()).unwrap()).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body: serde_json::Value =
        serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert_eq!(body["total"], 1);
    assert_eq!(body["elements"][0]["id"], "v1");
    assert_eq!(body["elements"][0]["playstyle"], "Freedom");
    assert_eq!(body["elements"][0]["playable"], true);
    assert_eq!(body["elements"][0]["incomplete"], false);
    assert_eq!(
        body["filtres"]["attributes"]["age_group"],
        serde_json::json!(["Middle School"])
    );
    assert_eq!(body["facettes"]["gender"][0]["valeur"], "M");
}

#[tokio::test]
async fn cross_legacy_and_canonical_routes_share_safe_library_projections() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("mirror.sqlite");
    let mut connection = rusqlite::Connection::open(&database).unwrap();
    let documents = std::collections::BTreeMap::from([
        (
            "masterdata-schema".into(),
            serde_json::json!({"Game.Player": {"file":"player.bin", "fullName":"Game.Player", "extends": null,"columns":[{"name":"id","kind":"ref"}]}}),
        ),
        (
            "catalog-stats".into(),
            serde_json::json!({"generated":"2026-09-20", "source":"/private/extraction", "totals":{"objects":1}, "by_asset_type":{}, "by_row_type":{}, "by_bundle_top60":[], "localization":{}, "audio_cri":{}, "skit_timeline":{}}),
        ),
    ]);
    nie_wiki::cross::import(&mut connection, std::io::Cursor::new(
        "{\"kind\":\"asset\",\"guid\":\"g1\",\"key\":\"player\",\"type\":\"Sprite\",\"bundle\":\"b1\",\"size\":1,\"n_deps\":0,\"deps\":[]}\n"
    ), &documents, &nie_wiki::cross::Provenance { source: "fixture".into(), sha256: "a".repeat(64) }).unwrap();
    drop(connection);
    let state = EtatSite::pour_tests(
        Config {
            db: database,
            statique: "/nonexistent/dist".into(),
            ..Config::default()
        },
        IndexVfs::depuis(Vec::new()),
    );
    let router = nie_site::routeur(state);
    for suffix in ["tables", "stats"] {
        let mut bodies = Vec::new();
        for prefix in ["/api/cross", "/api/v1/wiki/cross"] {
            let response = router
                .clone()
                .oneshot(
                    Request::builder()
                        .uri(format!("{prefix}/{suffix}"))
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK);
            let bytes = response.into_body().collect().await.unwrap().to_bytes();
            let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
            assert!(!String::from_utf8_lossy(&bytes).contains("/private/extraction"));
            bodies.push(body);
        }
        assert_eq!(bodies[0], bodies[1]);
        if suffix == "tables" {
            assert_eq!(bodies[0].as_array().unwrap().len(), 1);
        } else {
            assert_eq!(bodies[0]["totals"]["objects"], 1);
        }
    }
    let response = router
        .oneshot(
            Request::builder()
                .uri("/api/v1/wiki/cross/catalog?q=player&limit=1")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body: serde_json::Value =
        serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert_eq!(body["total"], 1);
    assert_eq!(body["assets"][0]["key"], "player");
}

#[tokio::test]
#[ignore = "requires ignored historical responses captured from the same licensed mirror"]
async fn legacy_player_http_matches_captured_historical_json() {
    let fixture = std::env::var("NIE_LEGACY_PARITY_FIXTURE").expect("fixture path");
    let mirror = std::env::var("NIE_LEGACY_PARITY_MIRROR").expect("mirror path");
    let cases: Vec<serde_json::Value> =
        serde_json::from_slice(&std::fs::read(fixture).unwrap()).unwrap();
    assert!(!cases.is_empty());
    let router = nie_site::routeur(EtatSite::pour_tests(
        Config {
            db: mirror.into(),
            statique: "/nonexistent/dist".into(),
            ..Config::default()
        },
        IndexVfs::depuis(Vec::new()),
    ));
    for case in cases {
        let encode = |value: &str| {
            value
                .bytes()
                .map(|byte| {
                    if byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.') {
                        (byte as char).to_string()
                    } else {
                        format!("%{byte:02X}")
                    }
                })
                .collect::<String>()
        };
        let query = case["input"]
            .as_object()
            .unwrap()
            .iter()
            .map(|(key, value)| {
                let value = value
                    .as_str()
                    .map(str::to_owned)
                    .unwrap_or_else(|| value.to_string());
                format!("{}={}", encode(key), encode(&value))
            })
            .collect::<Vec<_>>()
            .join("&");
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri(format!("/api/characters?{query}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            response.status(),
            StatusCode::OK,
            "request: {}",
            case["input"]
        );
        let actual: serde_json::Value =
            serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes())
                .unwrap();
        assert!(
            actual == case["expected"],
            "historical HTTP JSON differs for {}",
            case["input"]
        );
        if case["input"].get("role").is_some() || case["input"]["position"] == "COACH" {
            let response = router
                .clone()
                .oneshot(
                    Request::builder()
                        .uri(format!("/api/coordinators?{query}"))
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK);
            let direct: serde_json::Value =
                serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes())
                    .unwrap();
            assert!(
                direct == case["expected"],
                "direct coordinator contract differs"
            );
        }
    }
}
