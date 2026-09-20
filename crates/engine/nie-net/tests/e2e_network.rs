use std::time::Duration;
use tokio::net::TcpListener;

use nie_net::{
    Inacode, KizunaAvatar, MatchMode, NetClient, NetMessage, NetServer, PlacedTownCharacter,
    PlacedTownObject, PlayerTickInput, RoomConfig,
};

#[tokio::test]
async fn test_full_multiplayer_lifecycle_e2e() -> anyhow::Result<()> {
    // 1. Start Server on ephemeral port
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let local_addr = listener.local_addr()?;
    let server = NetServer::new(local_addr);

    let server_task = tokio::spawn(async move {
        let _ = server.run_on_listener(listener).await;
    });

    let ws_url = format!("ws://{}", local_addr);

    // 2. Connect Client 1 ("Endou")
    let mut client1 = NetClient::connect(&ws_url, "Endou").await?;
    let pid1 = client1
        .player_id()
        .expect("Client 1 must have player_id")
        .to_string();
    assert!(!pid1.is_empty());

    // 3. Connect Client 2 ("Gouenji")
    let mut client2 = NetClient::connect(&ws_url, "Gouenji").await?;
    let pid2 = client2
        .player_id()
        .expect("Client 2 must have player_id")
        .to_string();
    assert!(!pid2.is_empty());
    assert_ne!(pid1, pid2);

    // 4. Client 1 creates a room
    let room_cfg = RoomConfig {
        name: "Raimon Match".to_string(),
        ..Default::default()
    };
    client1.create_room(room_cfg)?;

    // Receive RoomCreated on Client 1
    let assigned_inacode: Inacode = loop {
        let msg = tokio::time::timeout(Duration::from_secs(2), client1.next_message())
            .await?
            .expect("Expected message");
        if let NetMessage::RoomCreated { inacode, .. } = msg {
            break inacode;
        }
    };

    // 5. Client 2 joins the room via Inacode
    client2.join_room(assigned_inacode.clone(), None)?;

    // Client 2 should receive RoomJoined
    loop {
        let msg = tokio::time::timeout(Duration::from_secs(2), client2.next_message())
            .await?
            .expect("Expected message");
        if let NetMessage::RoomJoined { inacode, .. } = msg {
            assert_eq!(inacode, assigned_inacode);
            break;
        }
    }

    // Client 1 should receive RoomUpdate with 2 members
    loop {
        let msg = tokio::time::timeout(Duration::from_secs(2), client1.next_message())
            .await?
            .expect("Expected message");
        if let NetMessage::RoomUpdate { room } = msg
            && room.members.len() == 2
        {
            assert!(room.members.iter().any(|m| m.id == pid2));
            break;
        }
    }

    // 6. Both players set ready
    client1.set_ready(true)?;
    client2.set_ready(true)?;

    // 7. Both players must receive MatchStart
    let match_start_c1 = loop {
        let msg = tokio::time::timeout(Duration::from_secs(2), client1.next_message())
            .await?
            .expect("Expected message");
        if let NetMessage::MatchStart {
            match_id,
            seed,
            home_player_id,
            away_player_id,
        } = msg
        {
            break (match_id, seed, home_player_id, away_player_id);
        }
    };

    let match_start_c2 = loop {
        let msg = tokio::time::timeout(Duration::from_secs(2), client2.next_message())
            .await?
            .expect("Expected message");
        if let NetMessage::MatchStart {
            match_id,
            seed,
            home_player_id,
            away_player_id,
        } = msg
        {
            break (match_id, seed, home_player_id, away_player_id);
        }
    };

    assert_eq!(match_start_c1.0, match_start_c2.0);
    assert_eq!(match_start_c1.1, match_start_c2.1);
    assert_eq!(match_start_c1.2, pid1);
    assert_eq!(match_start_c1.3, pid2);

    // 8. Stream inputs and verify TickSync reception
    client1.send_input(
        1,
        PlayerTickInput {
            tick: 1,
            dx: 1.0,
            dy: 0.0,
            shoot: true,
            pass: false,
            skill_id: None,
        },
    )?;

    client2.send_input(
        1,
        PlayerTickInput {
            tick: 1,
            dx: -1.0,
            dy: 0.0,
            shoot: false,
            pass: true,
            skill_id: None,
        },
    )?;

    // Wait for at least one TickSync on Client 1
    let sync_received = loop {
        let msg = tokio::time::timeout(Duration::from_secs(2), client1.next_message())
            .await?
            .expect("Expected message");
        if let NetMessage::TickSync {
            tick,
            inputs,
            state_hash,
        } = msg
        {
            assert!(tick >= 1);
            assert_ne!(state_hash, 0);
            assert_eq!(inputs.len(), 2);
            break true;
        }
    };
    assert!(sync_received);

    // 9. Ping test
    client1.ping(42)?;
    let pong_received = loop {
        let msg = tokio::time::timeout(Duration::from_secs(2), client1.next_message())
            .await?
            .expect("Expected message");
        if let NetMessage::Pong { seq, .. } = msg {
            assert_eq!(seq, 42);
            break true;
        }
    };
    assert!(pong_received);

    server_task.abort();
    Ok(())
}

#[tokio::test]
async fn test_matchmaker_e2e() -> anyhow::Result<()> {
    // 1. Start Server on ephemeral port
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let local_addr = listener.local_addr()?;
    let server = NetServer::new(local_addr);

    let server_task = tokio::spawn(async move {
        let _ = server.run_on_listener(listener).await;
    });

    let ws_url = format!("ws://{}", local_addr);

    // 2. Connect Client 1 ("Fubuki") and Client 2 ("Kidou")
    let mut client1 = NetClient::connect(&ws_url, "Fubuki").await?;
    let mut client2 = NetClient::connect(&ws_url, "Kidou").await?;

    let pid1 = client1.player_id().unwrap().to_string();
    let pid2 = client2.player_id().unwrap().to_string();

    // 3. Queue both players for Ranked match (close rank points)
    client1.queue_match(MatchMode::Ranked, 1500)?;
    client2.queue_match(MatchMode::Ranked, 1520)?;

    // 4. Background matchmaker worker runs at 500ms intervals, should pair them
    let start_c1 = loop {
        let msg = tokio::time::timeout(Duration::from_secs(3), client1.next_message())
            .await?
            .expect("Expected matchmaker message");
        if let NetMessage::MatchStart {
            match_id,
            seed,
            home_player_id,
            away_player_id,
        } = msg
        {
            break (match_id, seed, home_player_id, away_player_id);
        }
    };

    let start_c2 = loop {
        let msg = tokio::time::timeout(Duration::from_secs(3), client2.next_message())
            .await?
            .expect("Expected matchmaker message");
        if let NetMessage::MatchStart {
            match_id,
            seed,
            home_player_id,
            away_player_id,
        } = msg
        {
            break (match_id, seed, home_player_id, away_player_id);
        }
    };

    assert_eq!(start_c1.0, start_c2.0);
    assert_eq!(start_c1.1, start_c2.1);
    assert_eq!(start_c1.2, pid1);
    assert_eq!(start_c1.3, pid2);

    server_task.abort();
    Ok(())
}

#[tokio::test]
async fn test_kizuna_town_multiplayer_e2e() -> anyhow::Result<()> {
    // 1. Start Server on ephemeral port
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let local_addr = listener.local_addr()?;
    let server = NetServer::new(local_addr);

    let server_task = tokio::spawn(async move {
        let _ = server.run_on_listener(listener).await;
    });

    let ws_url = format!("ws://{}", local_addr);

    // 2. Connect Tenma and Tsurugi
    let mut tenma = NetClient::connect(&ws_url, "Tenma").await?;
    let mut tsurugi = NetClient::connect(&ws_url, "Tsurugi").await?;

    let tenma_pid = tenma.player_id().unwrap().to_string();
    let tsurugi_pid = tsurugi.player_id().unwrap().to_string();

    // 3. Tenma updates avatar
    let tenma_avatar = KizunaAvatar {
        name: "Matsukaze Tenma".to_string(),
        kit_id: 10,
        position: "MF".to_string(),
        element: "Wind".to_string(),
        favorite_chara_id: Some("c02000010".to_string()),
        ..Default::default()
    };
    tenma.update_avatar(tenma_avatar.clone())?;

    // 4. Tenma enters their own Kizuna Town
    tenma.join_kizuna_town(None)?;

    let snap_tenma = loop {
        let msg = tokio::time::timeout(Duration::from_secs(2), tenma.next_message())
            .await?
            .expect("Expected snapshot");
        if let NetMessage::KizunaTownSnapshotSync { snapshot } = msg {
            assert_eq!(snapshot.owner_id, tenma_pid);
            assert_eq!(snapshot.visitors.len(), 1);
            break snapshot;
        }
    };
    assert_eq!(snap_tenma.visitors[0].player_id, tenma_pid);

    // 5. Tenma places a pitch object and a recruited character in town
    let pitch = PlacedTownObject {
        instance_id: "pitch_raimon_01".to_string(),
        item_id: 5001,
        position: [0.0, 0.0, 0.0],
        yaw: 0.0,
    };
    tenma.place_town_object(pitch)?;

    loop {
        let msg = tokio::time::timeout(Duration::from_secs(2), tenma.next_message())
            .await?
            .expect("Expected object placed ACK");
        if let NetMessage::TownObjectPlaced { instance_id } = msg {
            assert_eq!(instance_id, "pitch_raimon_01");
            break;
        }
    }

    let chara = PlacedTownCharacter {
        instance_id: "chara_shinsuke_01".to_string(),
        chara_id: "c02000030".to_string(),
        name: "Nishizono Shinsuke".to_string(),
        position: [2.0, 0.0, 1.0],
        yaw: std::f32::consts::PI,
        greeting: "Salut Capitaine Tenma !".to_string(),
    };
    tenma.place_town_character(chara)?;

    loop {
        let msg = tokio::time::timeout(Duration::from_secs(2), tenma.next_message())
            .await?
            .expect("Expected chara placed ACK");
        if let NetMessage::TownCharacterPlaced { instance_id } = msg {
            assert_eq!(instance_id, "chara_shinsuke_01");
            break;
        }
    }

    // 6. Tsurugi visits Tenma's Kizuna Town
    tsurugi.join_kizuna_town(Some(tenma_pid.clone()))?;

    // Tsurugi receives snapshot with Tenma and placed objects
    let snap_tsurugi = loop {
        let msg = tokio::time::timeout(Duration::from_secs(2), tsurugi.next_message())
            .await?
            .expect("Expected snapshot");
        if let NetMessage::KizunaTownSnapshotSync { snapshot } = msg {
            assert_eq!(snapshot.owner_id, tenma_pid);
            assert_eq!(snapshot.objects.len(), 1);
            assert_eq!(snapshot.characters.len(), 1);
            assert_eq!(snapshot.visitors.len(), 2);
            break snapshot;
        }
    };
    assert_eq!(snap_tsurugi.objects[0].instance_id, "pitch_raimon_01");

    // Tenma receives notification of Tsurugi's arrival
    loop {
        let msg = tokio::time::timeout(Duration::from_secs(2), tenma.next_message())
            .await?
            .expect("Expected arrival message");
        if let NetMessage::TownMoveSync { player_id, .. } = msg
            && player_id == tsurugi_pid
        {
            break;
        }
    }

    // 7. Tsurugi moves in town -> Tenma receives move sync
    tsurugi.send_town_move([10.0, 0.0, 5.0], [1.0, 0.0, 0.0], 1.2)?;
    loop {
        let msg = tokio::time::timeout(Duration::from_secs(2), tenma.next_message())
            .await?
            .expect("Expected move message");
        if let NetMessage::TownMoveSync {
            player_id,
            position,
            ..
        } = msg
            && player_id == tsurugi_pid
        {
            assert_eq!(position, [10.0, 0.0, 5.0]);
            break;
        }
    }

    // 8. Tsurugi sends an emote stamp -> Tenma receives emote sync
    tsurugi.send_town_emote(77)?;
    loop {
        let msg = tokio::time::timeout(Duration::from_secs(2), tenma.next_message())
            .await?
            .expect("Expected emote message");
        if let NetMessage::TownEmoteSync {
            player_id,
            stamp_id,
        } = msg
            && player_id == tsurugi_pid
        {
            assert_eq!(stamp_id, 77);
            break;
        }
    }

    // 9. Tenma sends chat message -> Tsurugi receives chat sync
    tenma.send_town_chat("Bienvenue dans ma Ville Kizuna !")?;
    loop {
        let msg = tokio::time::timeout(Duration::from_secs(2), tsurugi.next_message())
            .await?
            .expect("Expected chat message");
        if let NetMessage::TownChatSync {
            player_id, message, ..
        } = msg
            && player_id == tenma_pid
        {
            assert_eq!(message, "Bienvenue dans ma Ville Kizuna !");
            break;
        }
    }

    // 10. Tsurugi challenges Tenma to a match
    tsurugi.challenge_town_player(&tenma_pid, MatchMode::Casual)?;

    // Tenma receives challenge notification
    loop {
        let msg = tokio::time::timeout(Duration::from_secs(2), tenma.next_message())
            .await?
            .expect("Expected challenge message");
        if let NetMessage::TownChallengeReceived { from_player_id, .. } = msg {
            assert_eq!(from_player_id, tsurugi_pid);
            break;
        }
    }

    // Tenma accepts challenge
    tenma.respond_town_challenge(&tsurugi_pid, true)?;

    // Both players receive MatchStart!
    let match_c1 = loop {
        let msg = tokio::time::timeout(Duration::from_secs(2), tenma.next_message())
            .await?
            .expect("Expected match start");
        if let NetMessage::MatchStart { match_id, seed, .. } = msg {
            break (match_id, seed);
        }
    };

    let match_c2 = loop {
        let msg = tokio::time::timeout(Duration::from_secs(2), tsurugi.next_message())
            .await?
            .expect("Expected match start");
        if let NetMessage::MatchStart { match_id, seed, .. } = msg {
            break (match_id, seed);
        }
    };

    assert_eq!(match_c1.0, match_c2.0);
    assert_eq!(match_c1.1, match_c2.1);

    server_task.abort();
    Ok(())
}
