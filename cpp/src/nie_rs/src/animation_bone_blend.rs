//! Safe Rust port of `FUN_1404ae7e0` — weighted bone-pose blending.
//!
//! Original Ghidra source: `decomp/functions/animation_bone_blend.c`
//! Address: `0x1404ae7e0`
//! Subsystem: `lives::gmdCAnimation` — skeletal animation interpolation.
//!
//! The native function walks a pose-matrix buffer, picks bones gated by a
//! visibility bitmask + optional per-bone float weight, and calls a helper
//! (`FUN_140585c60`) that lerp-blends a destination 4x4 matrix toward a source
//! matrix using `1.0 - src_weight`. The C dump exposes raw pointer arithmetic
//! over opaque structs (`gmdCAnimation`, `CBone`, the pose buffers), so the
//! port hides every dereference behind a [`BoneBlendCtx`] trait — the same
//! pattern used by `vfs_path_resolver`.
//!
//! Scope of this module: **first function only** (the bone blender). The
//! second function in the same .c file (`FUN_1404aeac0`, ~700 lines of Ghidra
//! noise) is intentionally not ported here.

#![forbid(unsafe_code)]

/// Outcome of a blend pass.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BlendResult {
    /// Number of bones whose matrix was actually blended.
    pub blended: usize,
    /// `true` if the optional root-compensation branch (the `param_1 + 0x19c`
    /// guard in the native code) fired at the end of the pass.
    pub applied_root_compensation: bool,
}

/// Reasons the blend pass exited without doing any work.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SkipReason {
    /// Source weight was at or above 1.0 — destination already owns the result.
    WeightSaturated,
    /// One of the upstream context fields was missing
    /// (matches the cascade of `if (... != 0)` gates in the Ghidra dump).
    MissingContext,
    /// The skeleton exposed zero bones to walk.
    EmptySkeleton,
}

/// Opaque accessor over the native animation context.
///
/// Every method here corresponds to a raw pointer dereference in the original
/// C function. Implementations talk to the real `gmdCAnimation` (in the
/// engine FFI layer) or to a deterministic mock (in tests).
pub trait BoneBlendCtx {
    /// Returns `false` if any required upstream field is null. Mirrors the
    /// chain `*(longlong *)(param_1 + 8) != 0 && ... && param_2 != 0 && ...`.
    fn is_ready(&self) -> bool;

    /// Number of bones the helper should walk (the `uVar4` count derived from
    /// `*(ushort *)(lVar6 + 6 + lVar1 * 4)`).
    fn bone_count(&self) -> usize;

    /// Index of the i-th source bone in the pose buffer. The native code
    /// indexes a `ushort *puVar14` then dereferences it to get the bone id.
    /// `None` collapses to "skip this bone" (out-of-range case).
    fn bone_index(&self, i: usize) -> Option<u16>;

    /// Visibility ceiling read from `*(ushort *)(lVar13 + 0x25c)`.
    fn bone_index_ceiling(&self) -> u16;

    /// `true` when bone `bone_id` passes the bitmask test
    /// (`*(uint *)(lVar7 + (bone_id >> 5) * 4) >> (bone_id & 0x1f) & 1`).
    /// When the mask pointer (`lVar7`) is null in the native code, every bone
    /// passes — implementations should return `true` in that case.
    fn bone_mask_allows(&self, bone_id: u16) -> bool;

    /// Per-bone float weight gate
    /// (`0.0 < *(float *)(lVar15 + bone_id * 4)`). When the per-bone-weight
    /// pointer is null, return `None` — the native code skips this filter.
    fn per_bone_weight(&self, bone_id: u16) -> Option<f32>;

    /// Perform the actual matrix blend for bone `bone_id` at amount `amount`
    /// (= `1.0 - src_weight`). Mirrors `FUN_140585c60(dst, src, amount)`.
    fn blend_bone_matrix(&self, bone_id: u16, amount: f32);

    /// `true` when the optional visibility flag should be written back.
    /// In the native code this is `(bVar9 != 0)`, set from
    /// `*(byte *)(lVar6 + 8 + lVar1 * 4) & 1`.
    fn writes_visibility_flag(&self) -> bool;

    /// Mark bone `bone_id` as visible (sets the byte at `param_3[2] + bone_id`).
    fn mark_bone_visible(&self, bone_id: u16);

    /// Store the final blend amount in the result slot (writes
    /// `*(float *)(param_3 + 3) = fVar16` in the native function).
    fn store_blend_amount(&self, amount: f32);

    /// `true` when the trailing root-compensation branch should run
    /// (native check: `*(int *)(param_1 + 0x19c) != 0`).
    fn has_root_compensation(&self) -> bool;

    /// Apply the root-compensation blend. The native code rebuilds two
    /// stack-resident matrices from DAT globals then calls the same blender.
    /// The Rust port treats it as one opaque step.
    fn apply_root_compensation(&self, amount: f32);
}

/// Blend the active pose toward the source pose by `src_weight`.
///
/// Returns either [`BlendResult`] on success or a [`SkipReason`] explaining why
/// the pass short-circuited without touching any matrix.
pub fn blend_bone_pose(
    ctx: &dyn BoneBlendCtx,
    src_weight: f32,
) -> Result<BlendResult, SkipReason> {
    if src_weight >= 1.0 {
        return Err(SkipReason::WeightSaturated);
    }
    if !ctx.is_ready() {
        return Err(SkipReason::MissingContext);
    }

    let bone_count = ctx.bone_count();
    if bone_count == 0 {
        return Err(SkipReason::EmptySkeleton);
    }

    let amount = 1.0 - src_weight;
    let ceiling = ctx.bone_index_ceiling();
    let writes_vis = ctx.writes_visibility_flag();
    let mut blended: usize = 0;

    for i in 0..bone_count {
        let Some(bone_id) = ctx.bone_index(i) else {
            continue;
        };
        if bone_id >= ceiling {
            continue;
        }
        if !ctx.bone_mask_allows(bone_id) {
            continue;
        }
        if let Some(w) = ctx.per_bone_weight(bone_id) {
            if !(w > 0.0) {
                continue;
            }
        }

        ctx.blend_bone_matrix(bone_id, amount);
        blended += 1;

        if writes_vis {
            ctx.mark_bone_visible(bone_id);
        }
    }

    if writes_vis {
        ctx.store_blend_amount(amount);
    }

    let applied_root_compensation = ctx.has_root_compensation();
    if applied_root_compensation {
        ctx.apply_root_compensation(amount);
    }

    Ok(BlendResult {
        blended,
        applied_root_compensation,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    #[derive(Debug, Default, Clone)]
    struct MockEvent {
        bone_id: u16,
        amount: f32,
        kind: &'static str,
    }

    struct MockCtx {
        ready: bool,
        bones: Vec<Option<u16>>,
        ceiling: u16,
        mask: Option<Vec<u16>>, // when Some, only listed ids pass
        per_bone: Option<Vec<(u16, f32)>>,
        writes_vis: bool,
        has_root: bool,
        log: RefCell<Vec<MockEvent>>,
        stored_amount: RefCell<Option<f32>>,
    }

    impl MockCtx {
        fn happy(bones: Vec<u16>) -> Self {
            Self {
                ready: true,
                bones: bones.into_iter().map(Some).collect(),
                ceiling: u16::MAX,
                mask: None,
                per_bone: None,
                writes_vis: false,
                has_root: false,
                log: RefCell::new(Vec::new()),
                stored_amount: RefCell::new(None),
            }
        }
    }

    impl BoneBlendCtx for MockCtx {
        fn is_ready(&self) -> bool {
            self.ready
        }
        fn bone_count(&self) -> usize {
            self.bones.len()
        }
        fn bone_index(&self, i: usize) -> Option<u16> {
            self.bones.get(i).copied().flatten()
        }
        fn bone_index_ceiling(&self) -> u16 {
            self.ceiling
        }
        fn bone_mask_allows(&self, bone_id: u16) -> bool {
            self.mask
                .as_ref()
                .map(|m| m.contains(&bone_id))
                .unwrap_or(true)
        }
        fn per_bone_weight(&self, bone_id: u16) -> Option<f32> {
            self.per_bone
                .as_ref()
                .and_then(|v| v.iter().find(|(id, _)| *id == bone_id).map(|(_, w)| *w))
        }
        fn blend_bone_matrix(&self, bone_id: u16, amount: f32) {
            self.log.borrow_mut().push(MockEvent {
                bone_id,
                amount,
                kind: "blend",
            });
        }
        fn writes_visibility_flag(&self) -> bool {
            self.writes_vis
        }
        fn mark_bone_visible(&self, bone_id: u16) {
            self.log.borrow_mut().push(MockEvent {
                bone_id,
                amount: 0.0,
                kind: "vis",
            });
        }
        fn store_blend_amount(&self, amount: f32) {
            *self.stored_amount.borrow_mut() = Some(amount);
        }
        fn has_root_compensation(&self) -> bool {
            self.has_root
        }
        fn apply_root_compensation(&self, amount: f32) {
            self.log.borrow_mut().push(MockEvent {
                bone_id: 0,
                amount,
                kind: "root",
            });
        }
    }

    #[test]
    fn early_out_when_weight_saturated() {
        let ctx = MockCtx::happy(vec![1, 2, 3]);
        assert_eq!(
            blend_bone_pose(&ctx, 1.0).unwrap_err(),
            SkipReason::WeightSaturated
        );
        assert_eq!(
            blend_bone_pose(&ctx, 1.5).unwrap_err(),
            SkipReason::WeightSaturated
        );
        assert!(ctx.log.borrow().is_empty());
    }

    #[test]
    fn early_out_when_context_not_ready() {
        let mut ctx = MockCtx::happy(vec![1, 2, 3]);
        ctx.ready = false;
        assert_eq!(
            blend_bone_pose(&ctx, 0.5).unwrap_err(),
            SkipReason::MissingContext
        );
        assert!(ctx.log.borrow().is_empty());
    }

    #[test]
    fn early_out_on_empty_skeleton() {
        let ctx = MockCtx::happy(vec![]);
        assert_eq!(
            blend_bone_pose(&ctx, 0.5).unwrap_err(),
            SkipReason::EmptySkeleton
        );
    }

    #[test]
    fn happy_path_blends_every_bone() {
        let ctx = MockCtx::happy(vec![10, 20, 30]);
        let r = blend_bone_pose(&ctx, 0.25).unwrap();
        assert_eq!(r.blended, 3);
        assert!(!r.applied_root_compensation);
        let log = ctx.log.borrow();
        assert_eq!(log.len(), 3);
        for ev in log.iter() {
            assert_eq!(ev.kind, "blend");
            assert!((ev.amount - 0.75).abs() < 1e-6);
        }
        assert!(ctx.stored_amount.borrow().is_none());
    }

    #[test]
    fn mask_filters_one_bone_out() {
        let mut ctx = MockCtx::happy(vec![10, 20, 30]);
        ctx.mask = Some(vec![10, 30]); // bone 20 masked out
        let r = blend_bone_pose(&ctx, 0.5).unwrap();
        assert_eq!(r.blended, 2);
        let ids: Vec<u16> = ctx.log.borrow().iter().map(|e| e.bone_id).collect();
        assert_eq!(ids, vec![10, 30]);
    }

    #[test]
    fn per_bone_weight_zero_skips() {
        let mut ctx = MockCtx::happy(vec![10, 20, 30]);
        ctx.per_bone = Some(vec![(10, 0.5), (20, 0.0), (30, -0.1)]);
        let r = blend_bone_pose(&ctx, 0.5).unwrap();
        assert_eq!(r.blended, 1);
        assert_eq!(ctx.log.borrow()[0].bone_id, 10);
    }

    #[test]
    fn ceiling_filters_out_of_range_bone() {
        let mut ctx = MockCtx::happy(vec![10, 20, 5000]);
        ctx.ceiling = 100;
        let r = blend_bone_pose(&ctx, 0.5).unwrap();
        assert_eq!(r.blended, 2);
    }

    #[test]
    fn writes_visibility_when_flagged() {
        let mut ctx = MockCtx::happy(vec![10, 20]);
        ctx.writes_vis = true;
        let r = blend_bone_pose(&ctx, 0.25).unwrap();
        assert_eq!(r.blended, 2);
        let log = ctx.log.borrow();
        let blends = log.iter().filter(|e| e.kind == "blend").count();
        let viss = log.iter().filter(|e| e.kind == "vis").count();
        assert_eq!(blends, 2);
        assert_eq!(viss, 2);
        let stored = ctx.stored_amount.borrow();
        assert!(stored.is_some());
        assert!((stored.unwrap() - 0.75).abs() < 1e-6);
    }

    #[test]
    fn root_compensation_fires_when_enabled() {
        let mut ctx = MockCtx::happy(vec![10]);
        ctx.has_root = true;
        let r = blend_bone_pose(&ctx, 0.4).unwrap();
        assert!(r.applied_root_compensation);
        let root_calls: Vec<f32> = ctx
            .log
            .borrow()
            .iter()
            .filter(|e| e.kind == "root")
            .map(|e| e.amount)
            .collect();
        assert_eq!(root_calls.len(), 1);
        assert!((root_calls[0] - 0.6).abs() < 1e-6);
    }
}
