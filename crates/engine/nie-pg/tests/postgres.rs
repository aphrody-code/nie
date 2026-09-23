//! Integration test against a real PostgreSQL. Set `NIE_PG_TEST_URL` to a disposable
//! database, e.g. `host=127.0.0.1 port=55432 user=postgres password=... dbname=nie`;
//! without it the test skips loudly instead of passing silently.

use nie_pg::{ImportOutcome, decode, migrate, store_file};
use tokio_postgres::NoTls;

const FIXTURE: &[u8] = include_bytes!("../../nie-formats/tests/fixtures/font_color.cfg.bin");
const PATH: &str = "test/nie-pg/font_color.cfg.bin";

#[tokio::test]
async fn import_is_idempotent_and_readers_cannot_write() {
    let Ok(url) = std::env::var("NIE_PG_TEST_URL") else {
        eprintln!("SKIPPED: NIE_PG_TEST_URL is not set");
        return;
    };
    let (mut client, connection) = tokio_postgres::connect(&url, NoTls).await.unwrap();
    tokio::spawn(connection);

    migrate(&mut client).await.unwrap();
    assert!(
        migrate(&mut client).await.unwrap().is_empty(),
        "migrations must be replayable"
    );
    client
        .execute("DELETE FROM nie.cfgbin_file WHERE path = $1", &[&PATH])
        .await
        .unwrap();

    let decoded = decode(FIXTURE).unwrap();
    assert_eq!(
        store_file(&mut client, PATH, &decoded).await.unwrap(),
        ImportOutcome::Written { rows: 448 }
    );
    assert_eq!(
        store_file(&mut client, PATH, &decoded).await.unwrap(),
        ImportOutcome::Unchanged
    );

    let row = client
        .query_one(
            "SELECT count(*), count(DISTINCT v.row_idx) FROM nie.rdbn_value v
             JOIN nie.rdbn_list l ON l.id = v.list_id JOIN nie.cfgbin_file f ON f.id = l.file_id
             WHERE f.path = $1",
            &[&PATH],
        )
        .await
        .unwrap();
    assert_eq!((row.get::<_, i64>(0), row.get::<_, i64>(1)), (448, 64));

    // Azalée boundary: the reader role sees the data and cannot change it.
    let tx = client.transaction().await.unwrap();
    tx.batch_execute("SET LOCAL ROLE nie_reader").await.unwrap();
    let seen: i64 = tx
        .query_one("SELECT count(*) FROM nie.cfgbin_file", &[])
        .await
        .unwrap()
        .get(0);
    assert!(seen >= 1);
    let denied = tx
        .execute("DELETE FROM nie.cfgbin_file WHERE path = $1", &[&PATH])
        .await;
    assert!(denied.is_err(), "nie_reader must not be able to write");
    drop(tx);

    client
        .execute("DELETE FROM nie.cfgbin_file WHERE path = $1", &[&PATH])
        .await
        .unwrap();
}
