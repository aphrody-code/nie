//! HTTP contract guard for the character catalogue delegated to `nie-wiki`.

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
