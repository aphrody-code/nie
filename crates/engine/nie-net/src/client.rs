//! Asynchronous WebSocket client for nie online multiplayer.

use futures_util::{SinkExt, StreamExt};
use tokio::sync::mpsc;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::Message;

use crate::protocol::{
    Inacode, KizunaAvatar, MatchMode, NetMessage, PlacedTownCharacter, PlacedTownObject,
    PlayerTickInput, RoomConfig, UtSquadSummary, NET_PROTOCOL_VERSION,
};

/// Active network multiplayer client session.
pub struct NetClient {
    tx: mpsc::UnboundedSender<NetMessage>,
    rx: mpsc::UnboundedReceiver<NetMessage>,
    player_id: Option<String>,
}

impl NetClient {
    /// Connects to a nie-net multiplayer server at given WebSocket URL (e.g. `ws://127.0.0.1:8088`).
    pub async fn connect(url: &str, player_name: &str) -> anyhow::Result<Self> {
        let (ws_stream, _) = connect_async(url).await?;
        let (mut ws_sender, mut ws_receiver) = ws_stream.split();

        let (inbound_tx, inbound_rx) = mpsc::unbounded_channel::<NetMessage>();
        let (outbound_tx, mut outbound_rx) = mpsc::unbounded_channel::<NetMessage>();

        // Outbound send task
        tokio::spawn(async move {
            while let Some(msg) = outbound_rx.recv().await {
                if let Ok(json) = serde_json::to_string(&msg)
                    && ws_sender.send(Message::Text(json.into())).await.is_err()
                {
                    break;
                }
            }
        });

        // Inbound receive task
        let client_inbound = inbound_tx.clone();
        tokio::spawn(async move {
            while let Some(msg_res) = ws_receiver.next().await {
                if let Ok(Message::Text(text)) = msg_res
                    && let Ok(net_msg) = serde_json::from_str::<NetMessage>(&text)
                    && client_inbound.send(net_msg).is_err()
                {
                    break;
                }
            }
        });

        // Handshake
        let hello = NetMessage::Hello {
            client_version: NET_PROTOCOL_VERSION.to_string(),
            player_name: player_name.to_string(),
        };
        outbound_tx.send(hello)?;

        let mut client = Self {
            tx: outbound_tx,
            rx: inbound_rx,
            player_id: None,
        };

        // Wait for Welcome
        if let Some(NetMessage::Welcome { player_id, .. }) = client.next_message().await {
            client.player_id = Some(player_id);
        }

        Ok(client)
    }

    /// Returns assigned player ID.
    #[must_use]
    pub fn player_id(&self) -> Option<&str> {
        self.player_id.as_deref()
    }

    /// Sends a protocol message to the server.
    pub fn send(&self, msg: NetMessage) -> Result<(), mpsc::error::SendError<NetMessage>> {
        self.tx.send(msg)
    }

    /// Awaits the next incoming protocol message from the server.
    pub async fn next_message(&mut self) -> Option<NetMessage> {
        self.rx.recv().await
    }

    /// Requests creation of a new room with configuration.
    pub fn create_room(&self, config: RoomConfig) -> Result<(), mpsc::error::SendError<NetMessage>> {
        self.send(NetMessage::CreateRoom { config })
    }

    /// Requests joining an existing room by Inacode.
    pub fn join_room(&self, inacode: Inacode, password: Option<String>) -> Result<(), mpsc::error::SendError<NetMessage>> {
        self.send(NetMessage::JoinRoom { inacode, password })
    }

    /// Toggles ready state in current room.
    pub fn set_ready(&self, ready: bool) -> Result<(), mpsc::error::SendError<NetMessage>> {
        self.send(NetMessage::SetReady { ready })
    }

    /// Sends player tick input.
    pub fn send_input(&self, tick: u64, input: PlayerTickInput) -> Result<(), mpsc::error::SendError<NetMessage>> {
        self.send(NetMessage::InputTick { tick, input })
    }

    /// Sends ping measurement.
    pub fn ping(&self, seq: u64) -> Result<(), mpsc::error::SendError<NetMessage>> {
        let client_time_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        self.send(NetMessage::Ping { seq, client_time_ms })
    }

    /// Enqueues for automated matchmaking.
    pub fn queue_match(&self, mode: MatchMode, rank_points: u32) -> Result<(), mpsc::error::SendError<NetMessage>> {
        self.send(NetMessage::QueueMatch { mode, rank_points })
    }

    /// Cancels matchmaking queue.
    pub fn cancel_queue(&self) -> Result<(), mpsc::error::SendError<NetMessage>> {
        self.send(NetMessage::CancelQueue)
    }

    /// Updates custom player avatar.
    pub fn update_avatar(&self, avatar: KizunaAvatar) -> Result<(), mpsc::error::SendError<NetMessage>> {
        self.send(NetMessage::UpdateAvatar { avatar })
    }

    /// Enters a Kizuna Town (own town if `None`, or friend's town).
    pub fn join_kizuna_town(&self, town_owner_id: Option<String>) -> Result<(), mpsc::error::SendError<NetMessage>> {
        self.send(NetMessage::JoinKizunaTown { town_owner_id })
    }

    /// Synchronizes avatar movement inside Kizuna Town.
    pub fn send_town_move(&self, position: [f32; 3], velocity: [f32; 3], yaw: f32) -> Result<(), mpsc::error::SendError<NetMessage>> {
        self.send(NetMessage::TownMove { position, velocity, yaw })
    }

    /// Displays a stamp/emote in Kizuna Town.
    pub fn send_town_emote(&self, stamp_id: u32) -> Result<(), mpsc::error::SendError<NetMessage>> {
        self.send(NetMessage::TownEmote { stamp_id })
    }

    /// Sends a chat message to all players visiting the current Kizuna Town.
    pub fn send_town_chat(&self, message: &str) -> Result<(), mpsc::error::SendError<NetMessage>> {
        self.send(NetMessage::TownChat { message: message.to_string() })
    }

    /// Places a decoration/pitch object in own Kizuna Town.
    pub fn place_town_object(&self, object: PlacedTownObject) -> Result<(), mpsc::error::SendError<NetMessage>> {
        self.send(NetMessage::TownPlaceObject { object })
    }

    /// Removes a placed object in own Kizuna Town.
    pub fn remove_town_object(&self, instance_id: &str) -> Result<(), mpsc::error::SendError<NetMessage>> {
        self.send(NetMessage::TownRemoveObject { instance_id: instance_id.to_string() })
    }

    /// Places a recruited character in own Kizuna Town.
    pub fn place_town_character(&self, character: PlacedTownCharacter) -> Result<(), mpsc::error::SendError<NetMessage>> {
        self.send(NetMessage::TownPlaceCharacter { character })
    }

    /// Removes a recruited character in own Kizuna Town.
    pub fn remove_town_character(&self, instance_id: &str) -> Result<(), mpsc::error::SendError<NetMessage>> {
        self.send(NetMessage::TownRemoveCharacter { instance_id: instance_id.to_string() })
    }

    /// Challenges a visiting friend in Kizuna Town to a direct match.
    pub fn challenge_town_player(&self, target_player_id: &str, mode: MatchMode) -> Result<(), mpsc::error::SendError<NetMessage>> {
        self.send(NetMessage::TownChallenge {
            target_player_id: target_player_id.to_string(),
            mode,
        })
    }

    /// Responds to an incoming match challenge from another player in Kizuna Town.
    pub fn respond_town_challenge(&self, from_player_id: &str, accept: bool) -> Result<(), mpsc::error::SendError<NetMessage>> {
        self.send(NetMessage::TownChallengeResponse {
            from_player_id: from_player_id.to_string(),
            accept,
        })
    }

    /// Updates player's Ultimate Team squad summary in the persistent hub.
    pub fn update_squad_summary(&self, squad: UtSquadSummary) -> Result<(), mpsc::error::SendError<NetMessage>> {
        self.send(NetMessage::UpdateSquadSummary { squad })
    }

    /// Requests to inspect another player's Ultimate Team squad in town.
    pub fn inspect_player_squad(&self, target_player_id: &str) -> Result<(), mpsc::error::SendError<NetMessage>> {
        self.send(NetMessage::TownInspectSquad {
            target_player_id: target_player_id.to_string(),
        })
    }
}
