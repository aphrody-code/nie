//! Standalone asynchronous WebSocket multiplayer game server.
//!
//! Coordinates Inacode room creation, matchmaking queues, and authoritative
//! tick synchronization for online football matches.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use anyhow::Context as _;
use futures_util::{SinkExt, StreamExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{RwLock, mpsc};
use tokio_tungstenite::tungstenite::Message;
use tracing::{error, info, warn};

use crate::kizuna::KizunaHub;
use crate::lobby::LobbyHub;
use crate::matchmaker::{MatchmakingQueue, QueueTicket};
use crate::protocol::{
    Inacode, KizunaAvatar, MatchMode, NET_PROTOCOL_VERSION, NetMessage, PlayerSlot,
    PlayerTickInput, RoomConfig, SessionType, TICK_RATE_HZ, TownVisitor, UtSquadSummary,
};
use crate::session::NetMatchSession;

type Tx = mpsc::Sender<Message>;

/// Information on a connected network client.
struct ConnectedClient {
    pub _player_id: String,
    pub player_name: String,
    pub tx: Tx,
}

/// Active match instance running on the server.
struct ServerMatch {
    session: NetMatchSession,
    player_ids: [String; 2],
    last_tick_inputs: HashMap<String, PlayerTickInput>,
}

/// Central state shared across all server tasks.
pub struct ServerState {
    pub lobby: RwLock<LobbyHub>,
    pub matchmaker: RwLock<MatchmakingQueue>,
    pub kizuna: RwLock<KizunaHub>,
    pub avatars: RwLock<HashMap<String, KizunaAvatar>>,
    pub squads: RwLock<HashMap<String, UtSquadSummary>>,
    clients: RwLock<HashMap<String, ConnectedClient>>,
    matches: RwLock<HashMap<String, ServerMatch>>,
}

impl ServerState {
    #[must_use]
    pub fn new() -> Self {
        Self {
            lobby: RwLock::new(LobbyHub::new()),
            matchmaker: RwLock::new(MatchmakingQueue::new()),
            kizuna: RwLock::new(KizunaHub::new()),
            avatars: RwLock::new(HashMap::new()),
            squads: RwLock::new(HashMap::new()),
            clients: RwLock::new(HashMap::new()),
            matches: RwLock::new(HashMap::new()),
        }
    }

    /// Broadcasts a message to all members of a given room.
    pub async fn broadcast_to_room(&self, inacode: &Inacode, msg: &NetMessage) {
        let lobby = self.lobby.read().await;
        if let Some(room) = lobby.get_room(inacode) {
            let json = match serde_json::to_string(msg) {
                Ok(j) => j,
                Err(e) => {
                    error!("Failed to serialize broadcast message: {e}");
                    return;
                }
            };
            let clients = self.clients.read().await;
            for member in &room.members {
                if let Some(client) = clients.get(&member.id) {
                    let _ = client.tx.try_send(Message::Text(json.clone().into()));
                }
            }
        }
    }

    /// Broadcasts a message to all visitors of a given Kizuna Town instance.
    pub async fn broadcast_to_town(
        &self,
        town_owner_id: &str,
        msg: &NetMessage,
        exclude_player_id: Option<&str>,
    ) {
        let kizuna = self.kizuna.read().await;
        if let Some(town) = kizuna.get_town(town_owner_id) {
            let json = match serde_json::to_string(msg) {
                Ok(j) => j,
                Err(e) => {
                    error!("Failed to serialize town broadcast message: {e}");
                    return;
                }
            };
            let clients = self.clients.read().await;
            for visitor in town.visitors.values() {
                if let Some(exclude) = exclude_player_id
                    && visitor.player_id == exclude
                {
                    continue;
                }
                if let Some(client) = clients.get(&visitor.player_id) {
                    let _ = client.tx.try_send(Message::Text(json.clone().into()));
                }
            }
        }
    }

    /// Sends a direct message to a single connected player.
    pub async fn send_to_player(&self, player_id: &str, msg: &NetMessage) {
        let clients = self.clients.read().await;
        if let Some(client) = clients.get(player_id)
            && let Ok(json) = serde_json::to_string(msg)
        {
            let _ = client.tx.try_send(Message::Text(json.into()));
        }
    }
}

impl Default for ServerState {
    fn default() -> Self {
        Self::new()
    }
}

/// Default bind address of the standalone multiplayer server.
///
/// Loopback only, and on a port no catalogued service uses: `127.0.0.1:8085` (the former
/// default) is `nie-site`'s own port, so `nie net server` on a host running the site either
/// failed to bind or, started first, took the site's place. Exposing the server beyond the
/// machine is an explicit `--bind`, never a default.
pub const DEFAULT_BIND: &str = "127.0.0.1:8796";

/// Asynchronous network server runner.
pub struct NetServer {
    state: Arc<ServerState>,
    addr: SocketAddr,
}

impl NetServer {
    /// Creates a new server bound to a specific socket address.
    #[must_use]
    pub fn new(addr: SocketAddr) -> Self {
        Self {
            state: Arc::new(ServerState::new()),
            addr,
        }
    }

    /// Access reference to the server state.
    #[must_use]
    pub fn state(&self) -> Arc<ServerState> {
        Arc::clone(&self.state)
    }

    /// Starts the server listener and internal tick synchronization loops.
    pub async fn run(&self) -> anyhow::Result<()> {
        let listener = TcpListener::bind(self.addr).await?;
        info!("nie-net multiplayer server listening on ws://{}", self.addr);
        self.run_on_listener(listener).await
    }

    /// Starts the server on an existing listener (e.g. for testing with ephemeral ports).
    pub async fn run_on_listener(&self, listener: TcpListener) -> anyhow::Result<()> {
        // Spawn background matchmaker worker
        let mm_state = Arc::clone(&self.state);
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_millis(500));
            loop {
                interval.tick().await;
                let matches = {
                    let mut mm = mm_state.matchmaker.write().await;
                    mm.poll_matches()
                };

                for match_found in matches {
                    info!(
                        "Matchmaker paired {} vs {} (seed: {})",
                        match_found.player_home.player_id,
                        match_found.player_away.player_id,
                        match_found.seed
                    );

                    let room_cfg = RoomConfig {
                        name: "Ranked Match".to_string(),
                        mode: match_found.player_home.mode,
                        ..Default::default()
                    };

                    let mut lobby = mm_state.lobby.write().await;
                    if let Ok((inacode, _room_info)) = lobby.create_room(
                        match_found.player_home.player_id.clone(),
                        match_found.player_home.player_name.clone(),
                        room_cfg,
                    ) {
                        let _ = lobby.join_room(
                            &inacode,
                            match_found.player_away.player_id.clone(),
                            match_found.player_away.player_name.clone(),
                            None,
                        );

                        let match_id = format!("match_{inacode}");
                        let start_msg = NetMessage::MatchStart {
                            match_id: match_id.clone(),
                            seed: match_found.seed,
                            home_player_id: match_found.player_home.player_id.clone(),
                            away_player_id: match_found.player_away.player_id.clone(),
                        };

                        let session = NetMatchSession::new(
                            match_id.clone(),
                            match_found.seed,
                            PlayerSlot::Home,
                        );

                        drop(lobby);
                        {
                            let mut matches = mm_state.matches.write().await;
                            matches.insert(
                                match_id,
                                ServerMatch {
                                    session,
                                    player_ids: [
                                        match_found.player_home.player_id.clone(),
                                        match_found.player_away.player_id.clone(),
                                    ],
                                    last_tick_inputs: HashMap::new(),
                                },
                            );
                        }

                        mm_state.broadcast_to_room(&inacode, &start_msg).await;
                    }
                }
            }
        });

        // Spawn 60Hz authoritative tick loop
        let tick_state = Arc::clone(&self.state);
        tokio::spawn(async move {
            let tick_interval_micros = 1_000_000 / u64::from(TICK_RATE_HZ);
            let mut interval = tokio::time::interval(Duration::from_micros(tick_interval_micros));
            loop {
                interval.tick().await;
                let mut matches = tick_state.matches.write().await;
                for match_data in matches.values_mut() {
                    let next_tick = match_data.session.current_tick + 1;

                    let home_input = match_data
                        .last_tick_inputs
                        .get(&match_data.player_ids[0])
                        .copied()
                        .unwrap_or(PlayerTickInput {
                            tick: next_tick,
                            ..Default::default()
                        });

                    let away_input = match_data
                        .last_tick_inputs
                        .get(&match_data.player_ids[1])
                        .copied()
                        .unwrap_or(PlayerTickInput {
                            tick: next_tick,
                            ..Default::default()
                        });

                    match_data.session.queue_local_input(home_input);
                    match_data.session.receive_remote_input(away_input);

                    if let Ok(confirmed) = match_data.session.advance_tick() {
                        let hash = match_data.session.current_state_hash();
                        let sync_msg = NetMessage::TickSync {
                            tick: confirmed,
                            inputs: [home_input, away_input],
                            state_hash: hash,
                        };

                        let clients = tick_state.clients.read().await;
                        if let Ok(json) = serde_json::to_string(&sync_msg) {
                            let text_msg = Message::Text(json.into());
                            for pid in &match_data.player_ids {
                                if let Some(client) = clients.get(pid) {
                                    let _ = client.tx.try_send(text_msg.clone());
                                }
                            }
                        }
                    }
                }
            }
        });

        // Connection accept loop
        loop {
            let (stream, peer) = listener.accept().await?;
            let state = Arc::clone(&self.state);
            tokio::spawn(async move {
                if let Err(e) = handle_connection(state, stream, peer).await {
                    warn!("Connection error for peer {peer}: {e}");
                }
            });
        }
    }
}

async fn handle_connection(
    state: Arc<ServerState>,
    stream: TcpStream,
    peer: SocketAddr,
) -> anyhow::Result<()> {
    let ws_stream = tokio::time::timeout(
        Duration::from_secs(10),
        tokio_tungstenite::accept_async(stream),
    )
    .await
    .context("WebSocket handshake timed out")??;
    let (mut ws_sender, mut ws_receiver) = ws_stream.split();
    let (tx, mut rx) = mpsc::channel::<Message>(512);

    // Forward outbound messages from channel to websocket sink
    let forward_task = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if ws_sender.send(msg).await.is_err() {
                break;
            }
        }
    });

    let mut current_player_id = None;

    while let Some(msg_result) = ws_receiver.next().await {
        let msg = match msg_result {
            Ok(m) => m,
            Err(_) => break,
        };

        if msg.is_close() {
            break;
        }

        let text = match msg.to_text() {
            Ok(t) => t,
            Err(_) => continue,
        };

        let net_msg: NetMessage = match serde_json::from_str(text) {
            Ok(m) => m,
            Err(e) => {
                let err_msg = NetMessage::Error {
                    message: format!("Malformed packet: {e}"),
                };
                if let Ok(json) = serde_json::to_string(&err_msg) {
                    let _ = tx.try_send(Message::Text(json.into()));
                }
                continue;
            }
        };

        match net_msg {
            NetMessage::Hello {
                client_version: _,
                player_name,
            } => {
                let pid = format!("p_{}", uuid::Uuid::new_v4().simple());
                current_player_id = Some(pid.clone());

                let welcome = NetMessage::Welcome {
                    server_version: NET_PROTOCOL_VERSION.to_string(),
                    player_id: pid.clone(),
                };

                let mut clients = state.clients.write().await;
                clients.insert(
                    pid.clone(),
                    ConnectedClient {
                        _player_id: pid.clone(),
                        player_name,
                        tx: tx.clone(),
                    },
                );

                if let Ok(json) = serde_json::to_string(&welcome) {
                    let _ = tx.try_send(Message::Text(json.into()));
                }
            }

            NetMessage::CreateRoom { config } => {
                if let Some(ref pid) = current_player_id {
                    let name = {
                        let clients = state.clients.read().await;
                        clients
                            .get(pid)
                            .map(|c| c.player_name.clone())
                            .unwrap_or_else(|| "Player".to_string())
                    };

                    let mut lobby = state.lobby.write().await;
                    match lobby.create_room(pid.clone(), name, config.clone()) {
                        Ok((inacode, _room)) => {
                            let resp = NetMessage::RoomCreated { inacode, config };
                            if let Ok(json) = serde_json::to_string(&resp) {
                                let _ = tx.try_send(Message::Text(json.into()));
                            }
                        }
                        Err(e) => {
                            let err_msg = NetMessage::Error {
                                message: format!("Create room failed: {e}"),
                            };
                            if let Ok(json) = serde_json::to_string(&err_msg) {
                                let _ = tx.try_send(Message::Text(json.into()));
                            }
                        }
                    }
                }
            }

            NetMessage::JoinRoom { inacode, password } => {
                if let Some(ref pid) = current_player_id {
                    let name = {
                        let clients = state.clients.read().await;
                        clients
                            .get(pid)
                            .map(|c| c.player_name.clone())
                            .unwrap_or_else(|| "Player".to_string())
                    };

                    let mut lobby = state.lobby.write().await;
                    match lobby.join_room(&inacode, pid.clone(), name, password) {
                        Ok((slot, room_info)) => {
                            let resp = NetMessage::RoomJoined {
                                inacode: inacode.clone(),
                                slot,
                                room: room_info.clone(),
                            };
                            if let Ok(json) = serde_json::to_string(&resp) {
                                let _ = tx.try_send(Message::Text(json.into()));
                            }

                            let update_msg = NetMessage::RoomUpdate { room: room_info };
                            drop(lobby);
                            state.broadcast_to_room(&inacode, &update_msg).await;
                        }
                        Err(e) => {
                            let err_msg = NetMessage::Error {
                                message: format!("Join room failed: {e}"),
                            };
                            if let Ok(json) = serde_json::to_string(&err_msg) {
                                let _ = tx.try_send(Message::Text(json.into()));
                            }
                        }
                    }
                }
            }

            NetMessage::SetReady { ready } => {
                if let Some(ref pid) = current_player_id {
                    let mut lobby = state.lobby.write().await;
                    if let Ok((inacode, all_ready)) = lobby.set_ready(pid, ready)
                        && let Some(room) = lobby.get_room(&inacode)
                    {
                        let update_msg = NetMessage::RoomUpdate {
                            room: room.to_info(),
                        };
                        let host_id = room.host_id.clone();
                        let members = room.members.clone();

                        if all_ready
                            && members.len() >= 2
                            && let Ok((seed, home_id, away_id)) =
                                lobby.start_match(&inacode, &host_id)
                        {
                            let match_id = format!("match_{inacode}");
                            let start_msg = NetMessage::MatchStart {
                                match_id: match_id.clone(),
                                seed,
                                home_player_id: home_id.clone(),
                                away_player_id: away_id.clone(),
                            };

                            let session =
                                NetMatchSession::new(match_id.clone(), seed, PlayerSlot::Home);

                            drop(lobby);
                            {
                                let mut matches = state.matches.write().await;
                                matches.insert(
                                    match_id,
                                    ServerMatch {
                                        session,
                                        player_ids: [home_id, away_id],
                                        last_tick_inputs: HashMap::new(),
                                    },
                                );
                            }

                            state.broadcast_to_room(&inacode, &start_msg).await;
                            continue;
                        }

                        drop(lobby);
                        state.broadcast_to_room(&inacode, &update_msg).await;
                    }
                }
            }

            NetMessage::InputTick { tick: _, input } => {
                if let Some(ref pid) = current_player_id {
                    let mut matches = state.matches.write().await;
                    for match_data in matches.values_mut() {
                        if match_data.player_ids.contains(pid) {
                            match_data.last_tick_inputs.insert(pid.clone(), input);
                            break;
                        }
                    }
                }
            }

            NetMessage::Ping {
                seq,
                client_time_ms,
            } => {
                let pong = NetMessage::Pong {
                    seq,
                    client_time_ms,
                    server_time_ms: std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map(|d| d.as_millis() as u64)
                        .unwrap_or(0),
                };
                if let Ok(json) = serde_json::to_string(&pong) {
                    let _ = tx.try_send(Message::Text(json.into()));
                }
            }

            NetMessage::QueueMatch { mode, rank_points } => {
                if let Some(ref pid) = current_player_id {
                    let name = {
                        let clients = state.clients.read().await;
                        clients
                            .get(pid)
                            .map(|c| c.player_name.clone())
                            .unwrap_or_else(|| "Player".to_string())
                    };
                    let ticket = QueueTicket {
                        player_id: pid.clone(),
                        player_name: name,
                        mode,
                        rank_points,
                        wait_ticks: 0,
                    };
                    let mut mm = state.matchmaker.write().await;
                    mm.enqueue(ticket);
                }
            }

            NetMessage::CancelQueue => {
                if let Some(ref pid) = current_player_id {
                    let mut mm = state.matchmaker.write().await;
                    mm.cancel(pid);
                }
            }

            // --- Kizuna Town & Avatar Message Handlers ---
            NetMessage::UpdateAvatar { avatar } => {
                if let Some(ref pid) = current_player_id {
                    let mut avatars = state.avatars.write().await;
                    avatars.insert(pid.clone(), avatar);
                }
            }

            NetMessage::JoinKizunaTown { town_owner_id } => {
                if let Some(ref pid) = current_player_id {
                    let name = {
                        let clients = state.clients.read().await;
                        clients
                            .get(pid)
                            .map(|c| c.player_name.clone())
                            .unwrap_or_else(|| "Player".to_string())
                    };

                    let avatar = {
                        let avatars = state.avatars.read().await;
                        avatars.get(pid).cloned().unwrap_or_else(|| KizunaAvatar {
                            name: name.clone(),
                            ..Default::default()
                        })
                    };

                    let target_owner = town_owner_id.unwrap_or_else(|| pid.clone());
                    let ut_squad = {
                        let squads = state.squads.read().await;
                        squads.get(pid).cloned()
                    };

                    let visitor = TownVisitor {
                        player_id: pid.clone(),
                        player_name: name.clone(),
                        avatar,
                        ut_squad,
                        position: [0.0, 0.0, 0.0],
                        velocity: [0.0, 0.0, 0.0],
                        yaw: 0.0,
                        active_emote: None,
                    };

                    let snapshot = {
                        let mut kizuna = state.kizuna.write().await;
                        kizuna.join_town(&target_owner, visitor.clone())
                    };

                    let sync_msg = NetMessage::KizunaTownSnapshotSync { snapshot };
                    if let Ok(json) = serde_json::to_string(&sync_msg) {
                        let _ = tx.try_send(Message::Text(json.into()));
                    }

                    // Notify existing visitors
                    let join_notify = NetMessage::TownMoveSync {
                        player_id: pid.clone(),
                        position: visitor.position,
                        velocity: visitor.velocity,
                        yaw: visitor.yaw,
                    };
                    state
                        .broadcast_to_town(&target_owner, &join_notify, Some(pid))
                        .await;
                }
            }

            NetMessage::TownMove {
                position,
                velocity,
                yaw,
            } => {
                if let Some(ref pid) = current_player_id {
                    let town_id = {
                        let mut kizuna = state.kizuna.write().await;
                        if let Some(tid) = kizuna.current_town_of(pid).map(String::from) {
                            if let Some(town) = kizuna.get_town_mut(&tid) {
                                town.update_visitor_transform(pid, position, velocity, yaw);
                            }
                            Some(tid)
                        } else {
                            None
                        }
                    };

                    if let Some(ref tid) = town_id {
                        let move_msg = NetMessage::TownMoveSync {
                            player_id: pid.clone(),
                            position,
                            velocity,
                            yaw,
                        };
                        state.broadcast_to_town(tid, &move_msg, Some(pid)).await;
                    }
                }
            }

            NetMessage::TownEmote { stamp_id } => {
                if let Some(ref pid) = current_player_id {
                    let town_id = {
                        let mut kizuna = state.kizuna.write().await;
                        if let Some(tid) = kizuna.current_town_of(pid).map(String::from) {
                            if let Some(town) = kizuna.get_town_mut(&tid) {
                                town.set_visitor_emote(pid, Some(stamp_id));
                            }
                            Some(tid)
                        } else {
                            None
                        }
                    };

                    if let Some(ref tid) = town_id {
                        let emote_msg = NetMessage::TownEmoteSync {
                            player_id: pid.clone(),
                            stamp_id,
                        };
                        state.broadcast_to_town(tid, &emote_msg, None).await;
                    }
                }
            }

            NetMessage::TownChat { message } => {
                if let Some(ref pid) = current_player_id {
                    let town_id = {
                        let kizuna = state.kizuna.read().await;
                        kizuna.current_town_of(pid).map(String::from)
                    };
                    let name = {
                        let clients = state.clients.read().await;
                        clients
                            .get(pid)
                            .map(|c| c.player_name.clone())
                            .unwrap_or_else(|| "Player".to_string())
                    };

                    if let Some(ref tid) = town_id {
                        let chat_msg = NetMessage::TownChatSync {
                            player_id: pid.clone(),
                            sender_name: name,
                            message,
                        };
                        state.broadcast_to_town(tid, &chat_msg, None).await;
                    }
                }
            }

            NetMessage::TownPlaceObject { object } => {
                if let Some(ref pid) = current_player_id {
                    let mut kizuna = state.kizuna.write().await;
                    let town = kizuna.get_or_create_town(pid, "Player");
                    let instance_id = object.instance_id.clone();
                    town.place_object(object);
                    let resp = NetMessage::TownObjectPlaced { instance_id };
                    if let Ok(json) = serde_json::to_string(&resp) {
                        let _ = tx.try_send(Message::Text(json.into()));
                    }
                }
            }

            NetMessage::TownRemoveObject { instance_id } => {
                if let Some(ref pid) = current_player_id {
                    let mut kizuna = state.kizuna.write().await;
                    if let Some(town) = kizuna.get_town_mut(pid) {
                        town.remove_object(&instance_id);
                    }
                }
            }

            NetMessage::TownPlaceCharacter { character } => {
                if let Some(ref pid) = current_player_id {
                    let mut kizuna = state.kizuna.write().await;
                    let town = kizuna.get_or_create_town(pid, "Player");
                    let instance_id = character.instance_id.clone();
                    town.place_character(character);
                    let resp = NetMessage::TownCharacterPlaced { instance_id };
                    if let Ok(json) = serde_json::to_string(&resp) {
                        let _ = tx.try_send(Message::Text(json.into()));
                    }
                }
            }

            NetMessage::TownRemoveCharacter { instance_id } => {
                if let Some(ref pid) = current_player_id {
                    let mut kizuna = state.kizuna.write().await;
                    if let Some(town) = kizuna.get_town_mut(pid) {
                        town.remove_character(&instance_id);
                    }
                }
            }

            NetMessage::TownChallenge {
                target_player_id,
                mode,
            } => {
                if let Some(ref pid) = current_player_id {
                    let name = {
                        let clients = state.clients.read().await;
                        clients
                            .get(pid)
                            .map(|c| c.player_name.clone())
                            .unwrap_or_else(|| "Player".to_string())
                    };
                    let challenge_msg = NetMessage::TownChallengeReceived {
                        from_player_id: pid.clone(),
                        from_player_name: name,
                        mode,
                    };
                    state
                        .send_to_player(&target_player_id, &challenge_msg)
                        .await;
                }
            }

            NetMessage::TownChallengeResponse {
                from_player_id,
                accept,
            } => {
                if let Some(ref pid) = current_player_id {
                    if accept {
                        let room_cfg = RoomConfig {
                            name: "Défi Kizuna Town".to_string(),
                            mode: MatchMode::Casual,
                            session_type: SessionType::Game,
                            ..Default::default()
                        };

                        let p1_name = {
                            let clients = state.clients.read().await;
                            clients
                                .get(&from_player_id)
                                .map(|c| c.player_name.clone())
                                .unwrap_or_else(|| "Player 1".to_string())
                        };
                        let p2_name = {
                            let clients = state.clients.read().await;
                            clients
                                .get(pid)
                                .map(|c| c.player_name.clone())
                                .unwrap_or_else(|| "Player 2".to_string())
                        };

                        let mut lobby = state.lobby.write().await;
                        if let Ok((inacode, _room)) =
                            lobby.create_room(from_player_id.clone(), p1_name, room_cfg)
                        {
                            let _ = lobby.join_room(&inacode, pid.clone(), p2_name, None);
                            let seed = 42_000_123;
                            let match_id = format!("match_{inacode}");

                            let start_msg = NetMessage::MatchStart {
                                match_id: match_id.clone(),
                                seed,
                                home_player_id: from_player_id.clone(),
                                away_player_id: pid.clone(),
                            };

                            let session =
                                NetMatchSession::new(match_id.clone(), seed, PlayerSlot::Home);

                            drop(lobby);
                            {
                                let mut matches = state.matches.write().await;
                                matches.insert(
                                    match_id,
                                    ServerMatch {
                                        session,
                                        player_ids: [from_player_id.clone(), pid.clone()],
                                        last_tick_inputs: HashMap::new(),
                                    },
                                );
                            }

                            state.broadcast_to_room(&inacode, &start_msg).await;
                        }
                    } else {
                        let decline_msg = NetMessage::Error {
                            message: "Le défi a été refusé.".to_string(),
                        };
                        state.send_to_player(&from_player_id, &decline_msg).await;
                    }
                }
            }

            NetMessage::UpdateSquadSummary { squad } => {
                if let Some(ref pid) = current_player_id {
                    let mut squads = state.squads.write().await;
                    squads.insert(pid.clone(), squad);
                }
            }

            NetMessage::TownInspectSquad { target_player_id } => {
                let squad = {
                    let squads = state.squads.read().await;
                    squads.get(&target_player_id).cloned()
                };
                let resp = NetMessage::TownSquadInspected {
                    player_id: target_player_id,
                    squad,
                };
                if let Ok(json) = serde_json::to_string(&resp) {
                    let _ = tx.try_send(Message::Text(json.into()));
                }
            }

            _ => {}
        }
    }

    // Client cleanup on disconnect
    if let Some(ref pid) = current_player_id {
        info!("Client disconnected: {pid} (peer {peer})");
        {
            let mut mm = state.matchmaker.write().await;
            mm.cancel(pid);
        }
        {
            let mut kizuna = state.kizuna.write().await;
            let _ = kizuna.leave_town(pid);
        }
        let mut lobby = state.lobby.write().await;
        if let Ok(Some(inacode)) = lobby.leave_room(pid)
            && let Some(room) = lobby.get_room(&inacode)
        {
            let update = NetMessage::RoomUpdate {
                room: room.to_info(),
            };
            drop(lobby);
            state.broadcast_to_room(&inacode, &update).await;
        }
        let mut clients = state.clients.write().await;
        clients.remove(pid);
    }

    forward_task.abort();
    Ok(())
}

#[cfg(test)]
mod default_bind_tests {
    use super::DEFAULT_BIND;
    use std::net::SocketAddr;

    #[test]
    fn default_bind_is_loopback_and_not_the_site_port() {
        let addr: SocketAddr = DEFAULT_BIND.parse().expect("valid socket address");
        assert!(addr.ip().is_loopback(), "never 0.0.0.0 by default");
        assert_ne!(addr.port(), 8085, "nie-site's port");
        assert_ne!(addr.port(), 8790, "nie-model-serve's port");
    }
}
