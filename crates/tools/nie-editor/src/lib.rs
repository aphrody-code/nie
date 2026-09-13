//! Portable editing state shared by the native editor and browser bindings.
//!
//! Filesystem access, windowing, and GPU upload remain host responsibilities. This crate keeps
//! document validation, bounded JSON interchange, selection, object operations, and undo/redo
//! deterministic on native and `wasm32-unknown-unknown` targets.
//!
//! ## One document, and it is the v2 one
//!
//! [`SceneDocumentV2`] carries a hierarchy, a full quaternion rotation and inherited visibility;
//! v1 carries a flat list and a single yaw. The editor viewport has always shown a hierarchy and
//! offered a rotation gizmo on three axes, so a session on v1 could not WRITE what the user did:
//! the web viewport documents its transforms as session-local for exactly that reason.
//!
//! So the session owns v2 and v1 becomes an input format only. [`SceneDocumentV2::from_json`]
//! reads either version, which keeps every project written so far openable.

#![forbid(unsafe_code)]

use std::collections::VecDeque;

use anyhow::{Result, ensure};
use nie_render3d::document::{SceneDocumentV2, SceneObject, SceneObjectV2};

/// Largest accepted or emitted project document.
pub const MAX_PROJECT_BYTES: usize = 1_000_000;
/// Maximum number of reversible document states retained in memory.
pub const MAX_HISTORY_STATES: usize = 100;

/// Validated scene document with bounded undo/redo history and selection state.
#[derive(Clone, Debug)]
pub struct EditorSession {
    document: SceneDocumentV2,
    undo: VecDeque<SceneDocumentV2>,
    redo: Vec<SceneDocumentV2>,
    selected: Option<usize>,
}

impl Default for EditorSession {
    fn default() -> Self {
        Self::new(SceneDocumentV2::default()).expect("the default scene document is valid")
    }
}

impl EditorSession {
    /// Create a session from an already decoded document.
    pub fn new(document: SceneDocumentV2) -> Result<Self> {
        document.validate()?;
        Ok(Self {
            document,
            undo: VecDeque::new(),
            redo: Vec::new(),
            selected: None,
        })
    }

    /// Decode a bounded JSON project and validate every object before exposing it.
    ///
    /// Both persisted versions are accepted; a v1 project is migrated on the way in and saved
    /// back as v2.
    pub fn from_json(bytes: &[u8]) -> Result<Self> {
        ensure!(
            bytes.len() <= MAX_PROJECT_BYTES,
            "project exceeds {MAX_PROJECT_BYTES} bytes"
        );
        Self::new(SceneDocumentV2::from_json(core::str::from_utf8(bytes)?)?)
    }

    /// Encode the current validated project as bounded, human-readable JSON.
    pub fn to_json_pretty(&self) -> Result<Vec<u8>> {
        self.document.validate()?;
        let bytes = serde_json::to_vec_pretty(&self.document)?;
        ensure!(
            bytes.len() <= MAX_PROJECT_BYTES,
            "encoded project exceeds {MAX_PROJECT_BYTES} bytes"
        );
        Ok(bytes)
    }

    /// Return the current scene document.
    pub fn document(&self) -> &SceneDocumentV2 {
        &self.document
    }

    /// Borrow the document for an interactive edit.
    ///
    /// Call [`Self::commit`] with the pre-edit snapshot once the interaction ends. Invalid edits
    /// are rolled back by `commit`.
    pub fn document_mut(&mut self) -> &mut SceneDocumentV2 {
        &mut self.document
    }

    /// Return the selected object index, if any.
    pub fn selected(&self) -> Option<usize> {
        self.selected
    }

    /// Select an object, or clear the selection with `None`.
    pub fn select(&mut self, selected: Option<usize>) -> Result<()> {
        if let Some(index) = selected {
            ensure!(
                index < self.document.objects.len(),
                "selection is out of bounds"
            );
        }
        self.selected = selected;
        Ok(())
    }

    /// Return whether an undo state is available.
    pub fn can_undo(&self) -> bool {
        !self.undo.is_empty()
    }

    /// Return whether a redo state is available.
    pub fn can_redo(&self) -> bool {
        !self.redo.is_empty()
    }

    /// An identifier no object in the document holds.
    ///
    /// A v2 identifier is DATA: it is what a parent link points at, so minting one is the only
    /// safe way to add or copy an object. Search starts past the object count because
    /// `SceneDocumentV2::from_v1` mints `object-0..object-n`.
    fn fresh_id(&self) -> String {
        let taken: std::collections::HashSet<&str> = self
            .document
            .objects
            .iter()
            .map(|object| object.id.as_str())
            .collect();
        let mut rank = self.document.objects.len();
        loop {
            let candidate = format!("object-{rank}");
            if !taken.contains(candidate.as_str()) {
                return candidate;
            }
            rank += 1;
        }
    }

    /// Add a validated object and select it.
    ///
    /// An empty identifier is minted; a supplied one is kept, and a collision is rejected by
    /// validation rather than silently renamed.
    pub fn add_object(&mut self, mut object: SceneObjectV2) -> Result<usize> {
        if object.id.is_empty() {
            object.id = self.fresh_id();
        }
        let before = self.document.clone();
        self.document.objects.push(object);
        match self.commit(before) {
            Ok(true) => {
                let index = self.document.objects.len() - 1;
                self.selected = Some(index);
                Ok(index)
            }
            Ok(false) => unreachable!("adding an object always changes the document"),
            Err(error) => Err(error),
        }
    }

    /// Decode a scene object of either persisted version, then add it.
    ///
    /// One decoder for every host: the browser bindings used to hold their own, so a payload
    /// shape accepted natively was not necessarily accepted in a tab.
    ///
    /// A v1 object names `yaw` and no `rotation`; a v2 object names `rotation`. Trying v2 first
    /// and falling back keeps the yaw of a v1 payload instead of dropping it in silence.
    pub fn add_object_json(&mut self, json: &str) -> Result<usize> {
        ensure!(
            json.len() <= MAX_PROJECT_BYTES,
            "scene object JSON exceeds {MAX_PROJECT_BYTES} bytes"
        );
        let object = match serde_json::from_str::<SceneObjectV2>(json) {
            Ok(object) => object,
            Err(v2_error) => match serde_json::from_str::<SceneObject>(json) {
                Ok(v1) => SceneObjectV2::from_v1_object(&v1),
                Err(_) => return Err(v2_error.into()),
            },
        };
        self.add_object(object)
    }

    /// Duplicate the selected object after translating it by `offset`.
    ///
    /// The copy gets a fresh identifier: keeping the original's would make two objects answer to
    /// the same parent link.
    pub fn duplicate_selected(&mut self, offset: [f32; 3]) -> Result<usize> {
        let index = self
            .selected
            .ok_or_else(|| anyhow::anyhow!("no object selected"))?;
        let mut object = self
            .document
            .objects
            .get(index)
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("selection is out of bounds"))?;
        for (position, delta) in object.position.iter_mut().zip(offset) {
            *position += delta;
        }
        object.id = self.fresh_id();
        self.add_object(object)
    }

    /// Remove the selected object and clear the selection.
    pub fn remove_selected(&mut self) -> Result<SceneObjectV2> {
        let index = self
            .selected
            .ok_or_else(|| anyhow::anyhow!("no object selected"))?;
        ensure!(
            index < self.document.objects.len(),
            "selection is out of bounds"
        );
        let before = self.document.clone();
        let removed = self.document.objects.remove(index);
        self.commit(before)?;
        self.selected = None;
        Ok(removed)
    }

    /// Record a completed interactive edit using its pre-edit snapshot.
    ///
    /// The current document is restored to `before` if validation fails. Equal snapshots do not
    /// consume history, and committing a new state clears redo history.
    pub fn commit(&mut self, before: SceneDocumentV2) -> Result<bool> {
        before.validate()?;
        if before == self.document {
            return Ok(false);
        }
        if let Err(error) = self.document.validate() {
            self.document = before;
            self.sanitize_selection();
            return Err(error);
        }
        self.push_undo(before);
        self.redo.clear();
        self.sanitize_selection();
        Ok(true)
    }

    /// Restore the preceding document state.
    pub fn undo(&mut self) -> bool {
        let Some(previous) = self.undo.pop_back() else {
            return false;
        };
        self.redo
            .push(std::mem::replace(&mut self.document, previous));
        self.sanitize_selection();
        true
    }

    /// Restore the next document state after an undo.
    pub fn redo(&mut self) -> bool {
        let Some(next) = self.redo.pop() else {
            return false;
        };
        let previous = std::mem::replace(&mut self.document, next);
        self.push_undo(previous);
        self.sanitize_selection();
        true
    }

    fn push_undo(&mut self, document: SceneDocumentV2) {
        if self.undo.len() == MAX_HISTORY_STATES {
            self.undo.pop_front();
        }
        self.undo.push_back(document);
    }

    fn sanitize_selection(&mut self) {
        if self
            .selected
            .is_some_and(|index| index >= self.document.objects.len())
        {
            self.selected = None;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn object(name: &str) -> SceneObjectV2 {
        SceneObjectV2 {
            id: String::new(),
            parent: None,
            name: name.into(),
            asset: format!("data/common/chr/{name}.glb"),
            position: [0.0; 3],
            rotation: [0.0, 0.0, 0.0, 1.0],
            scale: [1.0; 3],
            visible: true,
        }
    }

    #[test]
    fn json_roundtrip_preserves_a_valid_document() {
        let mut session = EditorSession::default();
        session.add_object(object("c01000010")).unwrap();

        let bytes = session.to_json_pretty().unwrap();
        let restored = EditorSession::from_json(&bytes).unwrap();

        assert_eq!(restored.document(), session.document());
        assert_eq!(restored.selected(), None);
    }

    #[test]
    fn oversized_json_is_rejected_before_decoding() {
        let bytes = vec![b' '; MAX_PROJECT_BYTES + 1];
        let error = EditorSession::from_json(&bytes).unwrap_err().to_string();
        assert!(error.contains("exceeds"));
    }

    #[test]
    fn add_duplicate_remove_undo_and_redo_share_one_history() {
        let mut session = EditorSession::default();
        assert_eq!(session.add_object(object("c01000010")).unwrap(), 0);
        assert_eq!(session.duplicate_selected([1.0, 2.0, 3.0]).unwrap(), 1);
        assert_eq!(session.document().objects[1].position, [1.0, 2.0, 3.0]);
        assert_eq!(session.remove_selected().unwrap().name, "c01000010");
        assert_eq!(session.document().objects.len(), 1);

        assert!(session.undo());
        assert_eq!(session.document().objects.len(), 2);
        assert!(session.redo());
        assert_eq!(session.document().objects.len(), 1);
    }

    #[test]
    fn invalid_interactive_edit_is_rolled_back() {
        let mut session = EditorSession::default();
        session.add_object(object("c01000010")).unwrap();
        let before = session.document().clone();
        session.document_mut().objects[0].scale[0] = 0.0;

        assert!(session.commit(before.clone()).is_err());
        assert_eq!(session.document(), &before);
        assert!(session.can_undo());
        assert!(!session.can_redo());
    }

    #[test]
    fn selection_must_reference_an_existing_object() {
        let mut session = EditorSession::default();
        assert!(session.select(Some(0)).is_err());
        session.add_object(object("c01000010")).unwrap();
        assert!(session.select(Some(0)).is_ok());
        assert_eq!(session.selected(), Some(0));
    }

    #[test]
    fn un_projet_v1_s_ouvre_et_se_reenregistre_en_v2() {
        let v1 = br#"{"version":1,"objects":[
            {"name":"a","asset":"a.glb","position":[0.0,0.0,0.0],"yaw":90.0,
             "scale":[1.0,1.0,1.0],"visible":true}]}"#;
        let session = EditorSession::from_json(v1).unwrap();
        assert_eq!(session.document().version, 2);
        assert_eq!(session.document().objects.len(), 1);
        assert!((session.document().objects[0].yaw_degrees() - 90.0).abs() < 1e-3);

        let bytes = session.to_json_pretty().unwrap();
        assert_eq!(EditorSession::from_json(&bytes).unwrap().document(), session.document());
    }

    #[test]
    fn un_identifiant_absent_est_frappe_et_une_copie_en_recoit_un_autre() {
        let mut session = EditorSession::default();
        session.add_object(object("c01000010")).unwrap();
        session.duplicate_selected([1.0, 0.0, 0.0]).unwrap();

        let ids: Vec<&str> = session
            .document()
            .objects
            .iter()
            .map(|object| object.id.as_str())
            .collect();
        assert_eq!(ids.len(), 2);
        assert_ne!(ids[0], ids[1]);
        assert!(ids.iter().all(|id| !id.is_empty()));
        session.document().validate().unwrap();
    }

    #[test]
    fn un_identifiant_deja_pris_est_refuse_plutot_que_renomme() {
        let mut session = EditorSession::default();
        let mut first = object("a");
        first.id = "shared".into();
        session.add_object(first).unwrap();

        let mut second = object("b");
        second.id = "shared".into();
        assert!(session.add_object(second).is_err());
        assert_eq!(session.document().objects.len(), 1);
    }

    #[test]
    fn une_hierarchie_survit_a_l_aller_retour_json() {
        let mut session = EditorSession::default();
        let mut parent = object("parent");
        parent.id = "root".into();
        session.add_object(parent).unwrap();
        let mut child = object("child");
        child.id = "leaf".into();
        child.parent = Some("root".into());
        session.add_object(child).unwrap();

        let bytes = session.to_json_pretty().unwrap();
        let restored = EditorSession::from_json(&bytes).unwrap();
        assert_eq!(restored.document().objects[1].parent.as_deref(), Some("root"));
    }

    #[test]
    fn un_objet_v1_ou_v2_passe_par_le_meme_decodeur() {
        let mut session = EditorSession::default();
        let v1 = r#"{"name":"a","asset":"a.glb","position":[0.0,0.0,0.0],"yaw":90.0,
                     "scale":[1.0,1.0,1.0],"visible":true}"#;
        let v2 = r#"{"name":"b","asset":"b.glb","position":[0.0,0.0,0.0],
                     "rotation":[0.0,0.0,0.0,1.0],"scale":[1.0,1.0,1.0],"visible":true}"#;
        assert_eq!(session.add_object_json(v1).unwrap(), 0);
        assert_eq!(session.add_object_json(v2).unwrap(), 1);

        // Le lacet du payload v1 est CONSERVÉ, pas ignoré : c'est la seule raison d'essayer
        // les deux formes plutôt que de tolérer les champs inconnus.
        assert!((session.document().objects[0].yaw_degrees() - 90.0).abs() < 1e-3);
        assert_eq!(session.document().objects[1].rotation, [0.0, 0.0, 0.0, 1.0]);
        assert!(session.document().objects.iter().all(|o| !o.id.is_empty()));
    }

    #[test]
    fn un_objet_illisible_rend_l_erreur_de_la_version_courante() {
        let mut session = EditorSession::default();
        let error = session.add_object_json("{\"name\":\"a\"}").unwrap_err().to_string();
        assert!(error.contains("asset"), "{error}");
    }

    #[test]
    fn history_discards_oldest_states_at_the_bound() {
        let mut session = EditorSession::default();
        for step in 0..(MAX_HISTORY_STATES + 5) {
            session
                .add_object(object(&format!("object-{step}")))
                .unwrap();
            session.remove_selected().unwrap();
        }

        let mut undo_count = 0;
        while session.undo() {
            undo_count += 1;
        }
        assert_eq!(undo_count, MAX_HISTORY_STATES);
    }
}
