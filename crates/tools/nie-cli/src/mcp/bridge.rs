//! Optional loopback WebSocket bridge between the MCP server and Inacord.

use std::{
    collections::HashMap,
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};

use futures_util::{SinkExt as _, StreamExt as _, stream::SplitSink};
use serde_json::{Value, json};
use tokio::{
    net::{TcpListener, TcpStream},
    sync::{Mutex, RwLock, oneshot},
};
use tokio_tungstenite::{
    WebSocketStream, accept_hdr_async,
    tungstenite::{
        Message,
        handshake::server::{ErrorResponse, Request, Response},
    },
};

const DEFAULT_PORT: u16 = 8791;
const PATH: &str = "/bridge";
const PROTOCOL: u64 = 1;
const COMMAND_TIMEOUT: Duration = Duration::from_secs(5);

type Sender = SplitSink<WebSocketStream<TcpStream>, Message>;
type PendingSender = oneshot::Sender<Result<Value, String>>;

#[derive(Debug, Clone)]
struct Peer {
    app: String,
    version: String,
    since: Instant,
    generation: u64,
}

#[derive(Debug, Clone)]
struct Connection {
    generation: u64,
    sender: Arc<Mutex<Sender>>,
}

#[derive(Debug)]
struct Inner {
    port: u16,
    listening: AtomicBool,
    next_id: AtomicU64,
    generation: AtomicU64,
    connection: RwLock<Option<Connection>>,
    peer: RwLock<Option<Peer>>,
    pending: Mutex<HashMap<u64, PendingSender>>,
}

/// Cloneable control handle shared by all MCP requests.
#[derive(Debug, Clone)]
pub(super) struct BridgeControl {
    inner: Arc<Inner>,
}

impl Default for BridgeControl {
    fn default() -> Self {
        let port = std::env::var("NIERS_BRIDGE_PORT")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(DEFAULT_PORT);
        Self {
            inner: Arc::new(Inner {
                port,
                listening: AtomicBool::new(false),
                next_id: AtomicU64::new(1),
                generation: AtomicU64::new(1),
                connection: RwLock::new(None),
                peer: RwLock::new(None),
                pending: Mutex::new(HashMap::new()),
            }),
        }
    }
}

impl BridgeControl {
    /// Bind only to loopback. Failure is non-fatal because the MCP tools that do
    /// not control the explorer remain useful when another process owns the port.
    pub(super) async fn start(&self) {
        if self.inner.listening.load(Ordering::Acquire) {
            return;
        }
        let address = (std::net::Ipv4Addr::LOCALHOST, self.inner.port);
        let listener = match TcpListener::bind(address).await {
            Ok(listener) => listener,
            Err(error) => {
                eprintln!(
                    "[niers-game] explorer bridge unavailable on {}: {error}",
                    self.url()
                );
                return;
            }
        };
        self.inner.listening.store(true, Ordering::Release);
        eprintln!("[niers-game] explorer bridge listening on {}", self.url());
        let control = self.clone();
        tokio::spawn(async move {
            while let Ok((stream, _)) = listener.accept().await {
                let control = control.clone();
                tokio::spawn(async move {
                    if let Err(error) = control.accept(stream).await {
                        eprintln!("[niers-game] explorer bridge connection failed: {error}");
                    }
                });
            }
            control.inner.listening.store(false, Ordering::Release);
        });
    }

    pub(super) async fn status(&self) -> Value {
        let peer = self.inner.peer.read().await.clone();
        json!({
            "listening": self.inner.listening.load(Ordering::Acquire),
            "url": self.url(),
            "connected": peer.is_some(),
            "app": peer.as_ref().map(|peer| &peer.app),
            "version": peer.as_ref().map(|peer| &peer.version),
            "connected_for_s": peer.map(|peer| peer.since.elapsed().as_secs())
        })
    }

    pub(super) async fn send(&self, command: Value) -> Result<Value, String> {
        if !self.inner.listening.load(Ordering::Acquire) {
            return Err(format!(
                "explorer bridge is not listening on port {}",
                self.inner.port
            ));
        }
        let peer = self
            .inner
            .peer
            .read()
            .await
            .clone()
            .ok_or_else(|| "no explorer is connected to the bridge".to_owned())?;
        let connection = self
            .inner
            .connection
            .read()
            .await
            .clone()
            .filter(|connection| connection.generation == peer.generation)
            .ok_or_else(|| "explorer bridge connection was lost".to_owned())?;
        let id = self.inner.next_id.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();
        self.inner.pending.lock().await.insert(id, tx);
        let frame = json!({ "type": "request", "id": id, "command": command }).to_string();
        if let Err(error) = connection
            .sender
            .lock()
            .await
            .send(Message::Text(frame.into()))
            .await
        {
            self.inner.pending.lock().await.remove(&id);
            return Err(format!("could not send explorer command: {error}"));
        }
        match tokio::time::timeout(COMMAND_TIMEOUT, rx).await {
            Ok(Ok(Ok(state))) => Ok(json!({ "ok": true, "app": peer.app, "state": state })),
            Ok(Ok(Err(error))) => Err(error),
            Ok(Err(_)) => Err("explorer bridge disconnected before replying".to_owned()),
            Err(_) => {
                self.inner.pending.lock().await.remove(&id);
                Err("explorer did not reply within 5000 ms".to_owned())
            }
        }
    }

    async fn accept(&self, stream: TcpStream) -> anyhow::Result<()> {
        let websocket = accept_hdr_async(stream, |request: &Request, response: Response| {
            if request.uri().path() == PATH {
                Ok(response)
            } else {
                let mut rejected = ErrorResponse::new(Some("not found".to_owned()));
                *rejected.status_mut() =
                    tokio_tungstenite::tungstenite::http::StatusCode::NOT_FOUND;
                Err(rejected)
            }
        })
        .await?;
        let generation = self.inner.generation.fetch_add(1, Ordering::Relaxed);
        let (sender, mut receiver) = websocket.split();
        let connection = Connection {
            generation,
            sender: Arc::new(Mutex::new(sender)),
        };
        self.fail_pending("explorer bridge connection was replaced")
            .await;
        *self.inner.connection.write().await = Some(connection);
        *self.inner.peer.write().await = None;

        while let Some(message) = receiver.next().await {
            let message = message?;
            let text = match message {
                Message::Text(text) => text,
                Message::Binary(bytes) => match String::from_utf8(bytes.to_vec()) {
                    Ok(text) => text.into(),
                    Err(_) => continue,
                },
                Message::Close(_) => break,
                _ => continue,
            };
            let Ok(frame) = serde_json::from_str::<Value>(&text) else {
                continue;
            };
            match frame.get("type").and_then(Value::as_str) {
                Some("hello") => {
                    let hello = &frame["hello"];
                    let protocol = hello.get("protocol").and_then(Value::as_u64);
                    let Some(app) = hello.get("app").and_then(Value::as_str) else {
                        continue;
                    };
                    let Some(version) = hello.get("version").and_then(Value::as_str) else {
                        continue;
                    };
                    if protocol != Some(PROTOCOL) {
                        continue;
                    }
                    *self.inner.peer.write().await = Some(Peer {
                        app: app.to_owned(),
                        version: version.to_owned(),
                        since: Instant::now(),
                        generation,
                    });
                }
                Some("response") => {
                    let Some(id) = frame.get("id").and_then(Value::as_u64) else {
                        continue;
                    };
                    let Some(pending) = self.inner.pending.lock().await.remove(&id) else {
                        continue;
                    };
                    let result = if frame.get("ok").and_then(Value::as_bool) == Some(true) {
                        Ok(frame.get("state").cloned().unwrap_or(Value::Null))
                    } else {
                        Err(frame
                            .get("error")
                            .and_then(Value::as_str)
                            .unwrap_or("explorer command failed")
                            .to_owned())
                    };
                    let _ = pending.send(result);
                }
                _ => {}
            }
        }

        if self
            .inner
            .connection
            .read()
            .await
            .as_ref()
            .is_some_and(|connection| connection.generation == generation)
        {
            *self.inner.connection.write().await = None;
            *self.inner.peer.write().await = None;
            self.fail_pending("explorer bridge disconnected").await;
        }
        Ok(())
    }

    async fn fail_pending(&self, message: &str) {
        for (_, sender) in self.inner.pending.lock().await.drain() {
            let _ = sender.send(Err(message.to_owned()));
        }
    }

    fn url(&self) -> String {
        format!("ws://127.0.0.1:{}{PATH}", self.inner.port)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn free_port() -> u16 {
        std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .expect("reserve loopback port")
            .local_addr()
            .expect("loopback address")
            .port()
    }

    fn control(port: u16) -> BridgeControl {
        BridgeControl {
            inner: Arc::new(Inner {
                port,
                listening: AtomicBool::new(false),
                next_id: AtomicU64::new(1),
                generation: AtomicU64::new(1),
                connection: RwLock::new(None),
                peer: RwLock::new(None),
                pending: Mutex::new(HashMap::new()),
            }),
        }
    }

    #[tokio::test]
    async fn bridge_round_trip_preserves_the_existing_client_protocol() {
        let bridge = control(free_port());
        bridge.start().await;
        let (mut client, _) = tokio_tungstenite::connect_async(bridge.url())
            .await
            .expect("connect bridge client");
        client
            .send(Message::Text(
                json!({
                    "type": "hello",
                    "hello": { "app": "test-explorer", "version": "1", "protocol": PROTOCOL }
                })
                .to_string()
                .into(),
            ))
            .await
            .expect("send hello");

        let reply = tokio::spawn(async move {
            let request = client
                .next()
                .await
                .expect("bridge request")
                .expect("valid frame");
            let request: Value =
                serde_json::from_str(request.to_text().expect("text frame")).expect("request JSON");
            assert_eq!(request["command"]["cmd"], "state");
            client
                .send(Message::Text(
                    json!({
                        "type": "response",
                        "id": request["id"],
                        "ok": true,
                        "state": { "tab": "explorer", "prefix": "data", "selected": null, "externalPath": null }
                    })
                    .to_string()
                    .into(),
                ))
                .await
                .expect("send response");
        });

        tokio::time::timeout(Duration::from_secs(1), async {
            while !bridge.status().await["connected"]
                .as_bool()
                .unwrap_or(false)
            {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("hello accepted");
        let result = bridge
            .send(json!({ "cmd": "state" }))
            .await
            .expect("bridge response");
        assert_eq!(result["app"], "test-explorer");
        assert_eq!(result["state"]["prefix"], "data");
        reply.await.expect("client task");
    }
}
