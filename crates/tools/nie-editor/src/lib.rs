//! Portable editing state shared by the native editor and browser bindings.
//!
//! Filesystem access, windowing, and GPU upload remain host responsibilities. This crate keeps
//! document validation, bounded JSON interchange, selection, object operations, and undo/redo
//! deterministic on native and `wasm32-unknown-unknown` targets.

#![forbid(unsafe_code)]

use std::collections::VecDeque;

use anyhow::{Result, ensure};
use nie_render3d::document::{SceneDocument, SceneObject};

/// Largest accepted or emitted project document.
pub const MAX_PROJECT_BYTES: usize = 1_000_000;
/// Maximum number of reversible document states retained in memory.
pub const MAX_HISTORY_STATES: usize = 100;

/// Validated scene document with bounded undo/redo history and selection state.
#[derive(Clone, Debug)]
pub struct EditorSession {
    document: SceneDocument,
    undo: VecDeque<SceneDocument>,
    redo: Vec<SceneDocument>,
    selected: Option<usize>,
}

impl Default for EditorSession {
    fn default() -> Self {
        Self::new(SceneDocument::default()).expect("the default scene document is valid")
    }
}

impl EditorSession {
    /// Create a session from an already decoded document.
    pub fn new(document: SceneDocument) -> Result<Self> {
        document.validate()?;
        Ok(Self {
            document,
            undo: VecDeque::new(),
            redo: Vec::new(),
            selected: None,
        })
    }

    /// Decode a bounded JSON project and validate every object before exposing it.
    pub fn from_json(bytes: &[u8]) -> Result<Self> {
        ensure!(
            bytes.len() <= MAX_PROJECT_BYTES,
            "project exceeds {MAX_PROJECT_BYTES} bytes"
        );
        Self::new(serde_json::from_slice(bytes)?)
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
    pub fn document(&self) -> &SceneDocument {
        &self.document
    }

    /// Borrow the document for an interactive edit.
    ///
    /// Call [`Self::commit`] with the pre-edit snapshot once the interaction ends. Invalid edits
    /// are rolled back by `commit`.
    pub fn document_mut(&mut self) -> &mut SceneDocument {
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

    /// Add a validated object and select it.
    pub fn add_object(&mut self, object: SceneObject) -> Result<usize> {
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

    /// Duplicate the selected object after translating it by `offset`.
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
        self.add_object(object)
    }

    /// Remove the selected object and clear the selection.
    pub fn remove_selected(&mut self) -> Result<SceneObject> {
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
    pub fn commit(&mut self, before: SceneDocument) -> Result<bool> {
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

    fn push_undo(&mut self, document: SceneDocument) {
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

    fn object(name: &str) -> SceneObject {
        SceneObject {
            name: name.into(),
            asset: format!("data/common/chr/{name}.glb"),
            position: [0.0; 3],
            yaw: 0.0,
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
