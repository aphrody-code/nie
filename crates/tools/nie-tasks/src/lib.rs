//! Orchestration de jobs asynchrones annulables/pausables, avec progression.
//!
//! Architecture inspirée du `sd-task-system` de spacedrive (`Task` + `Interrupter` +
//! `TaskSystem`, cf. `var/spacedrive/crates/task-system`), mais implémentation **originale** et
//! volontairement réduite au besoin réel de niers (dispatch d'un job par `tokio::spawn`, pas de
//! pool de workers à vol de tâches — nie-explorer n'a jamais plus d'une poignée de jobs longs
//! simultanés, contrairement à l'indexeur de fichiers massif de spacedrive) :
//! - un job (`Task`) est annulable et pausable à des points de contrôle explicites
//!   (`ctx.interrupter.check().await`) ;
//! - il peut rapporter sa progression (`ctx.progress.report(done, total, message)`) sans dépendre
//!   d'un canal spécifique à l'appelant (UI Tauri, CLI, tests…).
//!
//! Usage typique dans `nie-explorer/src-tauri` : remplacer un `#[tauri::command]` synchrone
//! bloquant de bout en bout (ex. scan complet du VFS, ~255 800 entrées) par un `Task` dispatché
//! via [`TaskSystem`], dont la progression est relayée au frontend par `app_handle.emit(...)` et
//! que l'utilisatrice peut annuler en cours de route.
#![forbid(unsafe_code)]
#![warn(missing_docs)]

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Maximum UTF-8 byte length accepted for a browser-provided task identifier.
pub const MAX_TASK_PLAN_ID_BYTES: usize = 128;
/// Maximum UTF-8 byte length accepted for a task label.
pub const MAX_TASK_PLAN_LABEL_BYTES: usize = 160;
/// Maximum UTF-8 byte length accepted for a progress message.
pub const MAX_TASK_PROGRESS_MESSAGE_BYTES: usize = 512;

/// Portable lifecycle phase for a task planned by a browser or another binding.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskPhase {
    /// The task is registered but has not started.
    Queued,
    /// The task is actively running.
    Running,
    /// The task is paused at a cooperative checkpoint.
    Paused,
    /// Cancellation was requested and awaits a cooperative checkpoint.
    CancelRequested,
    /// The task completed successfully.
    Completed,
    /// The task stopped at a cooperative cancellation checkpoint.
    Canceled,
    /// The task stopped because of an error.
    Failed,
}

/// Control action currently available to a browser caller.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskControl {
    /// Pause a running task.
    Pause,
    /// Resume a paused task.
    Resume,
    /// Request cooperative cancellation.
    Cancel,
}

/// Error returned when a portable task plan would become invalid or unbounded.
#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum TaskPlanError {
    /// The task identifier was empty.
    #[error("task identifier must not be empty")]
    EmptyId,
    /// The task identifier exceeded the documented byte limit.
    #[error("task identifier exceeds {max} UTF-8 bytes")]
    IdTooLong {
        /// Maximum accepted UTF-8 byte length.
        max: usize,
    },
    /// The task label was empty.
    #[error("task label must not be empty")]
    EmptyLabel,
    /// The task label exceeded the documented byte limit.
    #[error("task label exceeds {max} UTF-8 bytes")]
    LabelTooLong {
        /// Maximum accepted UTF-8 byte length.
        max: usize,
    },
    /// A progress message exceeded the documented byte limit.
    #[error("task progress message exceeds {max} UTF-8 bytes")]
    MessageTooLong {
        /// Maximum accepted UTF-8 byte length.
        max: usize,
    },
    /// Completed work exceeded a known non-zero total.
    #[error("task progress {done} exceeds total {total}")]
    ProgressExceedsTotal {
        /// Completed units supplied by the caller.
        done: u64,
        /// Known total supplied by the caller.
        total: u64,
    },
    /// The requested lifecycle transition is not valid from the current phase.
    #[error("task cannot transition from {from:?} to {to:?}")]
    InvalidTransition {
        /// Phase before the rejected transition.
        from: TaskPhase,
        /// Requested phase.
        to: TaskPhase,
    },
}

/// Bounded, serializable view of a task plan suitable for a browser binding.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskSnapshot {
    /// Caller-defined stable identifier.
    pub id: String,
    /// Short display label.
    pub label: String,
    /// Current lifecycle phase.
    pub phase: TaskPhase,
    /// Completed work units.
    pub done: u64,
    /// Expected work units, or zero when unknown.
    pub total: u64,
    /// Optional bounded progress detail.
    pub message: Option<String>,
    /// Controls valid for the current phase, in stable display order.
    pub available_controls: Vec<TaskControl>,
}

/// Portable task planner shared by native and WebAssembly callers.
///
/// It does not spawn work. Instead, it validates lifecycle and progress changes so a binding can
/// expose the same planning contract regardless of which executor owns the actual task.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TaskPlan {
    id: String,
    label: String,
    phase: TaskPhase,
    done: u64,
    total: u64,
    message: Option<String>,
}

impl TaskPlan {
    /// Creates a queued plan. A total of zero represents indeterminate progress.
    pub fn new(
        id: impl Into<String>,
        label: impl Into<String>,
        total: u64,
    ) -> Result<Self, TaskPlanError> {
        let id = id.into();
        let label = label.into();
        validate_required_text(&id, MAX_TASK_PLAN_ID_BYTES, true)?;
        validate_required_text(&label, MAX_TASK_PLAN_LABEL_BYTES, false)?;
        Ok(Self {
            id,
            label,
            phase: TaskPhase::Queued,
            done: 0,
            total,
            message: None,
        })
    }

    /// Marks a queued task as running.
    pub fn start(&mut self) -> Result<(), TaskPlanError> {
        self.transition(TaskPhase::Running, &[TaskPhase::Queued])
    }

    /// Marks a running task as paused.
    pub fn pause(&mut self) -> Result<(), TaskPlanError> {
        self.transition(TaskPhase::Paused, &[TaskPhase::Running])
    }

    /// Marks a paused task as running again.
    pub fn resume(&mut self) -> Result<(), TaskPlanError> {
        self.transition(TaskPhase::Running, &[TaskPhase::Paused])
    }

    /// Records a cooperative cancellation request for a non-terminal task.
    pub fn request_cancel(&mut self) -> Result<(), TaskPlanError> {
        self.transition(
            TaskPhase::CancelRequested,
            &[TaskPhase::Queued, TaskPhase::Running, TaskPhase::Paused],
        )
    }

    /// Marks a running task as successfully completed.
    pub fn complete(&mut self) -> Result<(), TaskPlanError> {
        self.transition(
            TaskPhase::Completed,
            &[TaskPhase::Running, TaskPhase::CancelRequested],
        )
    }

    /// Confirms that a cancellation request stopped the task at a cooperative checkpoint.
    pub fn confirm_canceled(&mut self) -> Result<(), TaskPlanError> {
        self.transition(TaskPhase::Canceled, &[TaskPhase::CancelRequested])
    }

    /// Marks any non-terminal task as failed.
    pub fn fail(&mut self) -> Result<(), TaskPlanError> {
        self.transition(
            TaskPhase::Failed,
            &[
                TaskPhase::Queued,
                TaskPhase::Running,
                TaskPhase::Paused,
                TaskPhase::CancelRequested,
            ],
        )
    }

    /// Updates bounded progress while work is running, paused, or awaiting cancellation.
    pub fn report(
        &mut self,
        done: u64,
        total: u64,
        message: Option<String>,
    ) -> Result<(), TaskPlanError> {
        if !matches!(
            self.phase,
            TaskPhase::Running | TaskPhase::Paused | TaskPhase::CancelRequested
        ) {
            return Err(TaskPlanError::InvalidTransition {
                from: self.phase,
                to: self.phase,
            });
        }
        if total != 0 && done > total {
            return Err(TaskPlanError::ProgressExceedsTotal { done, total });
        }
        if let Some(value) = message.as_deref()
            && value.len() > MAX_TASK_PROGRESS_MESSAGE_BYTES
        {
            return Err(TaskPlanError::MessageTooLong {
                max: MAX_TASK_PROGRESS_MESSAGE_BYTES,
            });
        }
        self.done = done;
        self.total = total;
        self.message = message;
        Ok(())
    }

    /// Returns a bounded snapshot with the controls valid in the current phase.
    #[must_use]
    pub fn snapshot(&self) -> TaskSnapshot {
        let available_controls = match self.phase {
            TaskPhase::Queued => vec![TaskControl::Cancel],
            TaskPhase::Running => vec![TaskControl::Pause, TaskControl::Cancel],
            TaskPhase::Paused => vec![TaskControl::Resume, TaskControl::Cancel],
            TaskPhase::CancelRequested
            | TaskPhase::Completed
            | TaskPhase::Canceled
            | TaskPhase::Failed => Vec::new(),
        };
        TaskSnapshot {
            id: self.id.clone(),
            label: self.label.clone(),
            phase: self.phase,
            done: self.done,
            total: self.total,
            message: self.message.clone(),
            available_controls,
        }
    }

    /// Serializes the current bounded snapshot as JSON for a browser bridge.
    pub fn snapshot_json(&self) -> serde_json::Result<String> {
        serde_json::to_string(&self.snapshot())
    }

    fn transition(
        &mut self,
        to: TaskPhase,
        allowed_from: &[TaskPhase],
    ) -> Result<(), TaskPlanError> {
        if !allowed_from.contains(&self.phase) {
            return Err(TaskPlanError::InvalidTransition {
                from: self.phase,
                to,
            });
        }
        self.phase = to;
        Ok(())
    }
}

fn validate_required_text(value: &str, max: usize, is_id: bool) -> Result<(), TaskPlanError> {
    if value.trim().is_empty() {
        return Err(if is_id {
            TaskPlanError::EmptyId
        } else {
            TaskPlanError::EmptyLabel
        });
    }
    if value.len() > max {
        return Err(if is_id {
            TaskPlanError::IdTooLong { max }
        } else {
            TaskPlanError::LabelTooLong { max }
        });
    }
    Ok(())
}

#[cfg(feature = "host")]
mod host {
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex};

    use async_trait::async_trait;
    use thiserror::Error;
    use tokio::sync::{mpsc, watch};

    /// Identifiant unique d'un job dispatché — v4 aléatoire, stable pour toute la durée de vie du job
    /// (sert de clé pour l'annulation et pour router les événements de progression côté appelant).
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
    pub struct TaskId(pub uuid::Uuid);

    impl TaskId {
        /// Génère un nouvel identifiant aléatoire.
        #[must_use]
        pub fn new() -> Self {
            Self(uuid::Uuid::new_v4())
        }
    }

    impl Default for TaskId {
        fn default() -> Self {
            Self::new()
        }
    }

    impl std::fmt::Display for TaskId {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            write!(f, "{}", self.0)
        }
    }

    /// Signal de contrôle transmis d'un [`TaskSystem`] à l'`Interrupter` d'un job en cours.
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    enum Signal {
        Run,
        Pause,
        Cancel,
    }

    /// Erreur renvoyée par [`Interrupter::check`] quand le job a été annulé — à propager immédiatement
    /// (via `?`) pour interrompre proprement `Task::run` au prochain point de contrôle.
    #[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
    #[error("job annulé")]
    pub struct Canceled;

    /// Point de contrôle pause/annulation, consulté volontairement par `Task::run` à intervalles
    /// raisonnables (ex. tous les N éléments d'une boucle) — jamais préemptif, comme dans
    /// sd-task-system : un job qui ne consulte jamais son `Interrupter` tourne simplement jusqu'au bout.
    #[derive(Debug, Clone)]
    pub struct Interrupter {
        rx: watch::Receiver<Signal>,
    }

    impl Interrupter {
        /// Point de contrôle : renvoie immédiatement si le job tourne, bloque tant qu'il est en pause,
        /// renvoie [`Canceled`] s'il a été annulé (par [`TaskHandle::cancel`] ou [`TaskSystem::cancel`]).
        ///
        /// Prend `&self` (pas `&mut self`) — clone en interne le `watch::Receiver` pour pouvoir
        /// attendre un changement (`changed()` exige `&mut`), afin que `Task::run` puisse appeler
        /// `ctx.interrupter.check()` directement sans jongler avec la mutabilité de `&TaskContext`.
        pub async fn check(&self) -> Result<(), Canceled> {
            let mut rx = self.rx.clone();
            loop {
                match *rx.borrow() {
                    Signal::Run => return Ok(()),
                    Signal::Cancel => return Err(Canceled),
                    Signal::Pause => {}
                }
                // `changed()` échoue seulement si l'émetteur (TaskSystem) a été abandonné —
                // dans ce cas le job n'a plus de superviseur, on le laisse continuer (Run implicite).
                if rx.changed().await.is_err() {
                    return Ok(());
                }
            }
        }

        /// Sonde non bloquante : `true` si une annulation a déjà été demandée, sans attendre une
        /// éventuelle pause en cours (utile en tête de boucle chaude, avant même de dériver un lot).
        #[must_use]
        pub fn is_canceled(&self) -> bool {
            *self.rx.borrow() == Signal::Cancel
        }
    }

    /// Avancement d'un job, tel que rapporté par [`ProgressReporter::report`] — forme neutre (JSON-able
    /// via `serde`) pour être relayée telle quelle par n'importe quel transport (événement Tauri, log…).
    #[derive(Debug, Clone, serde::Serialize)]
    pub struct TaskProgress {
        /// Job qui rapporte cet avancement.
        pub id: TaskId,
        /// Unités traitées jusqu'ici.
        pub done: u64,
        /// Total attendu (0 si inconnu à l'avance — l'appelant affiche alors un indicateur indéterminé).
        pub total: u64,
        /// Message humain optionnel (ex. chemin en cours de traitement).
        pub message: Option<String>,
    }

    /// Émetteur de progression capturé par le `TaskContext` d'un job — clonable, un job peut le
    /// partager entre sous-étapes sans se soucier de qui écoute côté appelant.
    #[derive(Clone)]
    pub struct ProgressReporter {
        id: TaskId,
        tx: mpsc::UnboundedSender<TaskProgress>,
    }

    impl ProgressReporter {
        /// Rapporte un avancement. Silencieux (pas de panique) si plus personne n'écoute — un job ne
        /// doit jamais planter parce que l'UI qui l'avait lancé a fermé son canal de progression.
        pub fn report(&self, done: u64, total: u64, message: impl Into<Option<String>>) {
            let _ = self.tx.send(TaskProgress {
                id: self.id,
                done,
                total,
                message: message.into(),
            });
        }
    }

    /// Contexte fourni à [`Task::run`] : point de contrôle pause/annulation + émetteur de progression.
    #[derive(Clone)]
    pub struct TaskContext {
        /// Point de contrôle pause/annulation — cf. [`Interrupter::check`].
        pub interrupter: Interrupter,
        /// Émetteur de progression — cf. [`ProgressReporter::report`].
        pub progress: ProgressReporter,
    }

    /// Résultat final d'un job qui va au bout de `Task::run` sans être annulé.
    #[derive(Debug, Clone)]
    pub enum ExecStatus {
        /// Terminé avec succès ; `output` est une charge utile JSON libre (résultat du job, ou
        /// `serde_json::Value::Null` si le job n'a rien à renvoyer au-delà de sa progression).
        Done(serde_json::Value),
    }

    /// Statut final d'un job tel que renvoyé par [`TaskHandle`], côté appelant.
    #[derive(Debug, Clone)]
    pub enum TaskStatus<E> {
        /// Le job est allé à son terme.
        Done(serde_json::Value),
        /// Le job a été annulé avant la fin (cf. [`TaskHandle::cancel`]).
        Canceled,
        /// Le job a échoué.
        Error(E),
    }

    /// Un job dispatchable par [`TaskSystem`]. `E` est le type d'erreur unifié de tous les jobs
    /// dispatchés dans une même instance de `TaskSystem` (comme sd-task-system : un seul type d'erreur
    /// par système, propre à l'appelant — ex. `String` dans `nie-explorer/src-tauri`).
    #[async_trait]
    pub trait Task<E>: Send + 'static {
        /// Identifiant stable du job (généré par l'appelant avant dispatch, pour pouvoir l'annuler
        /// depuis une commande séparée avant même que [`TaskSystem::dispatch`] ne renvoie).
        fn id(&self) -> TaskId;

        /// Exécute le job. Doit consulter `ctx.interrupter.check().await` à intervalles raisonnables
        /// et propager son erreur (`?`) pour s'arrêter proprement sur annulation.
        async fn run(&mut self, ctx: &TaskContext) -> Result<ExecStatus, E>;
    }

    /// Poignée d'un job dispatché — permet de l'annuler et d'attendre son résultat final.
    pub struct TaskHandle<E> {
        id: TaskId,
        join: tokio::task::JoinHandle<TaskStatus<E>>,
        cancel_tx: watch::Sender<Signal>,
    }

    impl<E> TaskHandle<E> {
        /// Identifiant du job.
        #[must_use]
        pub fn id(&self) -> TaskId {
            self.id
        }

        /// Demande l'annulation du job — asynchrone : le job s'arrête à son prochain point de
        /// contrôle (`Interrupter::check`), pas immédiatement.
        pub fn cancel(&self) {
            let _ = self.cancel_tx.send(Signal::Cancel);
        }

        /// Met le job en pause — il se bloquera à son prochain point de contrôle jusqu'à [`Self::resume`]
        /// ou [`Self::cancel`]. Sans effet si le job est déjà terminé.
        pub fn pause(&self) {
            let _ = self.cancel_tx.send(Signal::Pause);
        }

        /// Relance un job précédemment mis en [`Self::pause`].
        pub fn resume(&self) {
            let _ = self.cancel_tx.send(Signal::Run);
        }

        /// Attend le statut final du job (`Done`, `Canceled`, ou `Error` s'il a paniqué en interne
        /// n'est PAS couvert ici — un panic dans `Task::run` remonte comme `JoinError`, cf.
        /// [`TaskHandle::join_result`] pour le cas rare où l'appelant veut le distinguer).
        pub async fn wait(self) -> TaskStatus<E> {
            self.join.await.unwrap_or(TaskStatus::Canceled)
        }
    }

    /// Système d'orchestration : dispatche des [`Task`], route l'annulation par [`TaskId`], et
    /// centralise un unique canal de progression pour tous les jobs qu'il gère.
    pub struct TaskSystem<E> {
        cancel_senders: Arc<Mutex<HashMap<TaskId, watch::Sender<Signal>>>>,
        progress_tx: mpsc::UnboundedSender<TaskProgress>,
        _marker: std::marker::PhantomData<fn() -> E>,
    }

    impl<E: Send + 'static> TaskSystem<E> {
        /// Crée un système vide et son canal de progression partagé (à consommer côté appelant, ex.
        /// une boucle qui relaie chaque [`TaskProgress`] vers `app_handle.emit("job-progress", …)`).
        #[must_use]
        pub fn new() -> (Self, mpsc::UnboundedReceiver<TaskProgress>) {
            let (progress_tx, progress_rx) = mpsc::unbounded_channel();
            (
                Self {
                    cancel_senders: Arc::new(Mutex::new(HashMap::new())),
                    progress_tx,
                    _marker: std::marker::PhantomData,
                },
                progress_rx,
            )
        }

        /// Dispatche un job : le lance immédiatement sur le runtime tokio courant (le `TaskSystem`
        /// doit donc être utilisé depuis un contexte où un runtime tokio est déjà actif — c'est le cas
        /// de tout `#[tauri::command]` async, tauri embarquant son propre runtime).
        pub fn dispatch<T>(&self, mut task: T) -> TaskHandle<E>
        where
            T: Task<E>,
        {
            let id = task.id();
            let (cancel_tx, cancel_rx) = watch::channel(Signal::Run);
            self.cancel_senders
                .lock()
                .expect("cancel_senders mutex empoisonné")
                .insert(id, cancel_tx.clone());

            let ctx = TaskContext {
                interrupter: Interrupter { rx: cancel_rx },
                progress: ProgressReporter {
                    id,
                    tx: self.progress_tx.clone(),
                },
            };
            let cancel_senders = Arc::clone(&self.cancel_senders);

            let join = tokio::spawn(async move {
                let status = match task.run(&ctx).await {
                    Ok(ExecStatus::Done(output)) if ctx.interrupter.is_canceled() => {
                        tracing::debug!(%id, "job terminé après demande d'annulation — statut Done conservé");
                        TaskStatus::Done(output)
                    }
                    Ok(ExecStatus::Done(output)) => TaskStatus::Done(output),
                    Err(e) => TaskStatus::Error(e),
                };
                // Nettoyage du registre à la fin du job, réussite ou non — sans quoi `cancel_senders`
                // croîtrait indéfiniment sur une longue session (nie-explorer reste ouvert des heures).
                cancel_senders
                    .lock()
                    .expect("cancel_senders mutex empoisonné")
                    .remove(&id);
                status
            });

            TaskHandle {
                id,
                join,
                cancel_tx,
            }
        }

        /// Annule un job par son identifiant — no-op silencieux s'il est déjà terminé ou inconnu.
        pub fn cancel(&self, id: TaskId) {
            self.signal(id, Signal::Cancel);
        }

        /// Met en pause un job par son identifiant — no-op silencieux s'il est déjà terminé ou inconnu.
        pub fn pause(&self, id: TaskId) {
            self.signal(id, Signal::Pause);
        }

        /// Relance un job précédemment mis en pause, par son identifiant.
        pub fn resume(&self, id: TaskId) {
            self.signal(id, Signal::Run);
        }

        fn signal(&self, id: TaskId, signal: Signal) {
            if let Some(tx) = self
                .cancel_senders
                .lock()
                .expect("cancel_senders mutex empoisonné")
                .get(&id)
            {
                let _ = tx.send(signal);
            }
        }
    }

    impl<E: Send + 'static> Default for TaskSystem<E> {
        fn default() -> Self {
            Self::new().0
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        struct CountTo {
            id: TaskId,
            n: u64,
        }

        #[async_trait]
        impl Task<String> for CountTo {
            fn id(&self) -> TaskId {
                self.id
            }

            async fn run(&mut self, ctx: &TaskContext) -> Result<ExecStatus, String> {
                for i in 0..self.n {
                    ctx.interrupter
                        .check()
                        .await
                        .map_err(|_| "annulé".to_string())?;
                    ctx.progress.report(i + 1, self.n, None);
                }
                Ok(ExecStatus::Done(serde_json::json!({ "counted": self.n })))
            }
        }

        #[tokio::test]
        async fn job_va_au_bout_et_rapporte_sa_progression() {
            let (system, mut progress) = TaskSystem::<String>::new();
            let handle = system.dispatch(CountTo {
                id: TaskId::new(),
                n: 5,
            });
            let status = handle.wait().await;
            match status {
                TaskStatus::Done(v) => assert_eq!(v["counted"], 5),
                other => panic!("statut inattendu : {other:?}"),
            }
            let mut last = None;
            while let Ok(p) = progress.try_recv() {
                last = Some(p);
            }
            assert_eq!(last.unwrap().done, 5);
        }

        struct Forever {
            id: TaskId,
        }

        #[async_trait]
        impl Task<String> for Forever {
            fn id(&self) -> TaskId {
                self.id
            }

            async fn run(&mut self, ctx: &TaskContext) -> Result<ExecStatus, String> {
                let mut i: u64 = 0;
                loop {
                    ctx.interrupter
                        .check()
                        .await
                        .map_err(|_| "annulé".to_string())?;
                    i += 1;
                    if i > 10_000_000 {
                        return Ok(ExecStatus::Done(serde_json::Value::Null));
                    }
                    tokio::task::yield_now().await;
                }
            }
        }

        #[tokio::test]
        async fn cancel_interrompt_le_job_a_son_prochain_point_de_controle() {
            let (system, _progress) = TaskSystem::<String>::new();
            let id = TaskId::new();
            let handle = system.dispatch(Forever { id });
            system.cancel(id);
            let status = handle.wait().await;
            assert!(matches!(status, TaskStatus::Error(_)));
        }

        #[tokio::test]
        async fn handle_cancel_fonctionne_aussi_directement() {
            let (system, _progress) = TaskSystem::<String>::new();
            let handle = system.dispatch(Forever { id: TaskId::new() });
            handle.cancel();
            let status = handle.wait().await;
            assert!(matches!(status, TaskStatus::Error(_)));
        }
    }
}

#[cfg(feature = "host")]
pub use host::*;

#[cfg(test)]
mod portable_tests {
    use super::*;

    #[test]
    fn snapshot_tracks_progress_and_browser_controls() {
        let mut plan = TaskPlan::new("vfs-scan-7", "Scan VFS", 255_800).unwrap();
        assert_eq!(plan.snapshot().available_controls, [TaskControl::Cancel]);

        plan.start().unwrap();
        plan.report(4_096, 255_800, Some("data/cpk/base.cpk".to_owned()))
            .unwrap();
        let running = plan.snapshot();
        assert_eq!(running.phase, TaskPhase::Running);
        assert_eq!(running.done, 4_096);
        assert_eq!(
            running.available_controls,
            [TaskControl::Pause, TaskControl::Cancel]
        );

        plan.pause().unwrap();
        assert_eq!(
            plan.snapshot().available_controls,
            [TaskControl::Resume, TaskControl::Cancel]
        );
        plan.request_cancel().unwrap();
        assert!(plan.snapshot().available_controls.is_empty());
        plan.confirm_canceled().unwrap();
        assert_eq!(plan.snapshot().phase, TaskPhase::Canceled);
    }

    #[test]
    fn snapshot_json_is_stable_and_camel_case() {
        let mut plan = TaskPlan::new("asset-index", "Index assets", 10).unwrap();
        plan.start().unwrap();
        plan.report(3, 10, None).unwrap();
        let value: serde_json::Value =
            serde_json::from_str(&plan.snapshot_json().unwrap()).unwrap();

        assert_eq!(value["id"], "asset-index");
        assert_eq!(value["phase"], "running");
        assert_eq!(value["done"], 3);
        assert_eq!(value["total"], 10);
        assert_eq!(value["availableControls"][0], "pause");
        assert_eq!(value["availableControls"][1], "cancel");
    }

    #[test]
    fn plan_rejects_unbounded_and_invalid_updates_without_mutation() {
        assert_eq!(TaskPlan::new("", "Scan", 1), Err(TaskPlanError::EmptyId));
        let mut plan = TaskPlan::new("scan", "Scan", 10).unwrap();
        assert!(matches!(
            plan.report(1, 10, None),
            Err(TaskPlanError::InvalidTransition { .. })
        ));
        plan.start().unwrap();
        assert_eq!(
            plan.report(11, 10, None),
            Err(TaskPlanError::ProgressExceedsTotal {
                done: 11,
                total: 10
            })
        );
        assert_eq!(plan.snapshot().done, 0);

        let oversized = "x".repeat(MAX_TASK_PROGRESS_MESSAGE_BYTES + 1);
        assert_eq!(
            plan.report(1, 10, Some(oversized)),
            Err(TaskPlanError::MessageTooLong {
                max: MAX_TASK_PROGRESS_MESSAGE_BYTES
            })
        );
        assert_eq!(plan.snapshot().done, 0);
    }
}
