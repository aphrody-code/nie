//! Deterministic pose and animation contracts owned by the engine core.
//!
//! This module deliberately contains no file-format interpretation.  A loader (glTF, VRM or a
//! native motion format) is responsible for converting its evidence into these types; playback
//! only evaluates already-decoded keyframes.  In particular, the interpolation here is a generic
//! authoring/runtime primitive and is not presented as the semantics of an unresolved G4RA/G4MT
//! field.

use nie_geom::Vec3;

/// Stable identity of a skeleton in a runtime scene.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct SkeletonId(u32);

impl SkeletonId {
    /// Creates an identity from the caller-owned scene/document identifier.
    #[must_use]
    pub const fn new(value: u32) -> Self {
        Self(value)
    }

    /// Returns the underlying stable identity.
    #[must_use]
    pub const fn get(self) -> u32 {
        self.0
    }
}

/// Stable identity of a bone within a skeleton.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct BoneId(u16);

impl BoneId {
    /// Creates an identity from the decoded skeleton contract.
    #[must_use]
    pub const fn new(value: u16) -> Self {
        Self(value)
    }

    /// Returns the underlying bone identity.
    #[must_use]
    pub const fn get(self) -> u16 {
        self.0
    }
}

/// Quaternion stored as `(x, y, z, w)`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rotation(pub [f32; 4]);

impl Rotation {
    /// Identity rotation.
    pub const IDENTITY: Self = Self([0.0, 0.0, 0.0, 1.0]);

    /// Creates a quaternion without changing its components.
    #[must_use]
    pub const fn new(x: f32, y: f32, z: f32, w: f32) -> Self {
        Self([x, y, z, w])
    }

    fn normalized(self) -> Self {
        let [x, y, z, w] = self.0;
        let length_sq = x * x + y * y + z * z + w * w;
        if length_sq <= f32::EPSILON || !length_sq.is_finite() {
            return Self::IDENTITY;
        }
        let inverse = 1.0 / length_sq.sqrt();
        Self::new(x * inverse, y * inverse, z * inverse, w * inverse)
    }

    fn is_valid(self) -> bool {
        let [x, y, z, w] = self.0;
        let length_sq = x * x + y * y + z * z + w * w;
        x.is_finite()
            && y.is_finite()
            && z.is_finite()
            && w.is_finite()
            && length_sq.is_finite()
            && length_sq > f32::EPSILON
    }

    fn nlerp(self, other: Self, amount: f32) -> Self {
        let [ax, ay, az, aw] = self.0;
        let [mut bx, mut by, mut bz, mut bw] = other.0;
        // Quaternions q and -q represent the same rotation.  The shortest linear path makes
        // sampling independent of the sign chosen by an importer.
        if ax * bx + ay * by + az * bz + aw * bw < 0.0 {
            bx = -bx;
            by = -by;
            bz = -bz;
            bw = -bw;
        }
        Self::new(
            ax + (bx - ax) * amount,
            ay + (by - ay) * amount,
            az + (bz - az) * amount,
            aw + (bw - aw) * amount,
        )
        .normalized()
    }

    /// Hamilton product of two quaternions (`self * other`).
    #[must_use]
    pub fn combine(self, other: &Self) -> Self {
        Self(crate::quat::quat_mul(&self.0, &other.0)).normalized()
    }

    /// Rotates a 3D vector by this quaternion: `q * (v, 0) * q^-1`.
    #[must_use]
    pub fn rotate_vec3(self, v: Vec3) -> Vec3 {
        let [x, y, z, w] = self.0;
        // Optimization: t = 2 * cross(q.xyz, v); v' = v + w * t + cross(q.xyz, t)
        let tx = 2.0 * (y * v.z - z * v.y);
        let ty = 2.0 * (z * v.x - x * v.z);
        let tz = 2.0 * (x * v.y - y * v.x);

        let rx = v.x + w * tx + (y * tz - z * ty);
        let ry = v.y + w * ty + (z * tx - x * tz);
        let rz = v.z + w * tz + (x * ty - y * tx);

        Vec3::new(rx, ry, rz)
    }
}

/// Local transform of one bone at a sampled instant.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct BonePose {
    /// Local translation in the owning engine coordinate convention.
    pub translation: Vec3,
    /// Local rotation as `(x, y, z, w)`.
    pub rotation: Rotation,
    /// Local non-uniform scale.
    pub scale: Vec3,
}

impl Default for BonePose {
    fn default() -> Self {
        Self {
            translation: Vec3::zero(),
            rotation: Rotation::IDENTITY,
            scale: Vec3::new(1.0, 1.0, 1.0),
        }
    }
}

/// A timestamped pose. Bone order is not semantic; each entry is addressed by [`BoneId`].
#[derive(Debug, Clone, PartialEq)]
pub struct PoseFrame {
    /// Skeleton this pose addresses.
    pub skeleton: SkeletonId,
    /// Sample time in seconds.
    pub time_seconds: f32,
    /// Bone identities and their local poses.
    pub bones: Vec<(BoneId, BonePose)>,
}

impl PoseFrame {
    /// Returns a bone pose by identity, without assuming a contiguous native bone table.
    #[must_use]
    pub fn bone(&self, id: BoneId) -> Option<BonePose> {
        self.bones
            .iter()
            .find(|(bone, _)| *bone == id)
            .map(|(_, pose)| *pose)
    }

    /// Evaluates world-space transforms of all bones given their parent hierarchy.
    ///
    /// `parents` maps a `BoneId` to its optional parent `BoneId`. If a bone has no parent
    /// (or is mapped to `None`), its local transform is its world transform.
    /// Hierarchy is evaluated forward; cyclic relationships or missing parents fail safely.
    #[must_use]
    pub fn evaluate_world_poses(&self, parents: &[(BoneId, Option<BoneId>)]) -> Vec<(BoneId, BonePose)> {
        let mut world_poses = Vec::with_capacity(self.bones.len());
        for &(bone_id, local_pose) in &self.bones {
            let mut current_id = bone_id;
            let mut current_local = local_pose;
            let mut chain = Vec::new();
            let mut visited = std::collections::HashSet::new();

            while let Some(&(_, parent_opt)) = parents.iter().find(|(b, _)| *b == current_id) {
                if !visited.insert(current_id) {
                    // Cycle detected: fallback to current local transform
                    break;
                }
                chain.push(current_local);
                if let Some(parent_id) = parent_opt {
                    if let Some(parent_pose) = self.bone(parent_id) {
                        current_id = parent_id;
                        current_local = parent_pose;
                    } else {
                        break;
                    }
                } else {
                    break;
                }
            }

            // Chain is from child to root. Reverse to compose from root down to child.
            chain.reverse();
            let mut world = BonePose::default();
            for link in chain {
                world = world.combine(&link);
            }
            world_poses.push((bone_id, world));
        }
        world_poses
    }
}

impl BonePose {
    /// Combines a parent world transform with a child local transform (`self * child`).
    ///
    /// The child translation is rotated and scaled by the parent, then added to the parent
    /// translation. Quaternions are composed via Hamilton product. Scales are multiplied.
    #[must_use]
    pub fn combine(&self, child: &Self) -> Self {
        let rotated_child_translation = self.rotation.rotate_vec3(Vec3::new(
            child.translation.x * self.scale.x,
            child.translation.y * self.scale.y,
            child.translation.z * self.scale.z,
        ));

        let world_translation = Vec3::new(
            self.translation.x + rotated_child_translation.x,
            self.translation.y + rotated_child_translation.y,
            self.translation.z + rotated_child_translation.z,
        );

        let world_rotation = self.rotation.combine(&child.rotation);

        let world_scale = Vec3::new(
            self.scale.x * child.scale.x,
            self.scale.y * child.scale.y,
            self.scale.z * child.scale.z,
        );

        Self {
            translation: world_translation,
            rotation: world_rotation,
            scale: world_scale,
        }
    }
}

/// One local-transform keyframe.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Keyframe {
    /// Key time in seconds from the beginning of the clip.
    pub time_seconds: f32,
    /// Local bone pose at this time.
    pub pose: BonePose,
}

/// Keyframes for one bone. Times must be finite, non-negative and strictly increasing.
#[derive(Debug, Clone, PartialEq)]
pub struct BoneTrack {
    /// Bone addressed by this track.
    pub bone: BoneId,
    /// Strictly increasing keyframes.
    pub keyframes: Vec<Keyframe>,
}

/// Decoded, format-neutral animation clip.
#[derive(Debug, Clone, PartialEq)]
pub struct AnimationClip {
    /// Skeleton whose bones are addressed by the tracks.
    pub skeleton: SkeletonId,
    /// Non-negative duration in seconds.
    pub duration_seconds: f32,
    /// Per-bone local-transform tracks.
    pub tracks: Vec<BoneTrack>,
}

impl AnimationClip {
    /// Validates the bounded generic playback contract.
    pub fn validate(&self) -> Result<(), AnimationError> {
        if !self.duration_seconds.is_finite() || self.duration_seconds < 0.0 {
            return Err(AnimationError::InvalidDuration);
        }
        for track in &self.tracks {
            let mut previous = None;
            for keyframe in &track.keyframes {
                if !keyframe.time_seconds.is_finite() || keyframe.time_seconds < 0.0 {
                    return Err(AnimationError::InvalidKeyframeTime);
                }
                if previous.is_some_and(|time| keyframe.time_seconds <= time) {
                    return Err(AnimationError::UnsortedKeyframes);
                }
                if keyframe.time_seconds > self.duration_seconds {
                    return Err(AnimationError::KeyframeAfterDuration);
                }
                if !keyframe.pose.is_valid() {
                    return Err(AnimationError::InvalidPose);
                }
                previous = Some(keyframe.time_seconds);
            }
        }
        Ok(())
    }

    /// Samples all tracks at `time_seconds`. Empty tracks are intentionally omitted.
    ///
    /// `looped` wraps positive times at the clip duration; a zero-duration clip samples at its
    /// first keyframe. Invalid clips or non-finite times return `None` rather than inventing data.
    #[must_use]
    pub fn sample(&self, time_seconds: f32, looped: bool) -> Option<PoseFrame> {
        self.validate().ok()?;
        if !time_seconds.is_finite() || time_seconds < 0.0 {
            return None;
        }
        let time = if looped && self.duration_seconds > 0.0 {
            time_seconds % self.duration_seconds
        } else {
            time_seconds.min(self.duration_seconds)
        };
        let bones = self
            .tracks
            .iter()
            .filter_map(|track| sample_track(track, time).map(|pose| (track.bone, pose)))
            .collect();
        Some(PoseFrame {
            skeleton: self.skeleton,
            time_seconds: time,
            bones,
        })
    }
}

fn sample_track(track: &BoneTrack, time: f32) -> Option<BonePose> {
    let first = *track.keyframes.first()?;
    if time <= first.time_seconds {
        return Some(first.pose);
    }
    for pair in track.keyframes.windows(2) {
        let [a, b] = pair else {
            unreachable!("windows(2) always has two entries")
        };
        if time <= b.time_seconds {
            let amount = (time - a.time_seconds) / (b.time_seconds - a.time_seconds);
            return Some(BonePose {
                translation: lerp(a.pose.translation, b.pose.translation, amount),
                rotation: a.pose.rotation.nlerp(b.pose.rotation, amount),
                scale: lerp(a.pose.scale, b.pose.scale, amount),
            });
        }
    }
    track.keyframes.last().map(|keyframe| keyframe.pose)
}

fn lerp(a: Vec3, b: Vec3, amount: f32) -> Vec3 {
    Vec3::new(
        a.x + (b.x - a.x) * amount,
        a.y + (b.y - a.y) * amount,
        a.z + (b.z - a.z) * amount,
    )
}

/// Reasons a decoded clip cannot be sampled.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AnimationError {
    /// Clip duration is negative or non-finite.
    InvalidDuration,
    /// A keyframe time is negative or non-finite.
    InvalidKeyframeTime,
    /// Keyframe times are not strictly increasing.
    UnsortedKeyframes,
    /// A keyframe lies past the declared clip duration.
    KeyframeAfterDuration,
    /// A pose has non-finite translation/scale or a zero/invalid quaternion.
    InvalidPose,
}

impl BonePose {
    fn is_valid(self) -> bool {
        self.translation.x.is_finite()
            && self.translation.y.is_finite()
            && self.translation.z.is_finite()
            && self.scale.x.is_finite()
            && self.scale.y.is_finite()
            && self.scale.z.is_finite()
            && self.rotation.is_valid()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(time: f32, x: f32, rotation: Rotation) -> Keyframe {
        Keyframe {
            time_seconds: time,
            pose: BonePose {
                translation: Vec3::new(x, 0.0, 0.0),
                rotation,
                ..BonePose::default()
            },
        }
    }

    #[test]
    fn samples_translation_rotation_and_scale_deterministically() {
        let clip = AnimationClip {
            skeleton: SkeletonId::new(7),
            duration_seconds: 2.0,
            tracks: vec![BoneTrack {
                bone: BoneId::new(3),
                keyframes: vec![
                    key(0.0, 0.0, Rotation::IDENTITY),
                    key(2.0, 2.0, Rotation::new(0.0, 0.0, 1.0, 0.0)),
                ],
            }],
        };
        let a = clip.sample(1.0, false).expect("valid sample");
        let b = clip.sample(1.0, false).expect("valid sample");
        assert_eq!(a, b);
        assert_eq!(a.skeleton, SkeletonId::new(7));
        assert_eq!(a.bone(BoneId::new(3)).expect("bone").translation.x, 1.0);
        assert!(
            (a.bone(BoneId::new(3)).expect("bone").rotation.0[3] - 2.0_f32.sqrt() / 2.0).abs()
                < 1e-6
        );
    }

    #[test]
    fn loop_and_clamp_are_explicit_and_deterministic() {
        let clip = AnimationClip {
            skeleton: SkeletonId::new(1),
            duration_seconds: 2.0,
            tracks: vec![BoneTrack {
                bone: BoneId::new(0),
                keyframes: vec![
                    key(0.0, 0.0, Rotation::IDENTITY),
                    key(2.0, 2.0, Rotation::IDENTITY),
                ],
            }],
        };
        assert_eq!(clip.sample(3.0, true).expect("loop").time_seconds, 1.0);
        assert_eq!(clip.sample(3.0, false).expect("clamp").time_seconds, 2.0);
    }

    #[test]
    fn malformed_and_nonfinite_input_fails_closed() {
        let clip = AnimationClip {
            skeleton: SkeletonId::new(1),
            duration_seconds: 1.0,
            tracks: vec![BoneTrack {
                bone: BoneId::new(0),
                keyframes: vec![
                    key(0.5, 0.0, Rotation::IDENTITY),
                    key(0.5, 1.0, Rotation::IDENTITY),
                ],
            }],
        };
        assert_eq!(clip.validate(), Err(AnimationError::UnsortedKeyframes));
        assert!(clip.sample(f32::NAN, false).is_none());

        let invalid_pose = AnimationClip {
            skeleton: SkeletonId::new(1),
            duration_seconds: 1.0,
            tracks: vec![BoneTrack {
                bone: BoneId::new(0),
                keyframes: vec![Keyframe {
                    time_seconds: 0.0,
                    pose: BonePose {
                        translation: Vec3::new(f32::NAN, 0.0, 0.0),
                        ..BonePose::default()
                    },
                }],
            }],
        };
        assert_eq!(invalid_pose.validate(), Err(AnimationError::InvalidPose));

        let zero_rotation = AnimationClip {
            skeleton: SkeletonId::new(1),
            duration_seconds: 1.0,
            tracks: vec![BoneTrack {
                bone: BoneId::new(0),
                keyframes: vec![Keyframe {
                    time_seconds: 0.0,
                    pose: BonePose {
                        rotation: Rotation::new(0.0, 0.0, 0.0, 0.0),
                        ..BonePose::default()
                    },
                }],
            }],
        };
        assert_eq!(zero_rotation.validate(), Err(AnimationError::InvalidPose));
    }

    #[test]
    fn bone_pose_combine_and_world_poses_evaluation() {
        let half_angle = std::f32::consts::FRAC_1_SQRT_2;
        let parent = BonePose {
            translation: Vec3::new(0.0, 10.0, 0.0),
            rotation: Rotation::new(0.0, half_angle, 0.0, half_angle), // 90 deg around Y
            scale: Vec3::new(2.0, 2.0, 2.0),
        };
        let child = BonePose {
            translation: Vec3::new(1.0, 0.0, 0.0),
            rotation: Rotation::IDENTITY,
            scale: Vec3::new(1.0, 1.0, 1.0),
        };
        let combined = parent.combine(&child);
        assert!((combined.scale.x - 2.0).abs() < 1e-5);
        // (1, 0, 0) scaled by 2 -> (2, 0, 0). Rotated 90 deg around Y -> (0, 0, -2).
        // + parent translation (0, 10, 0) -> (0, 10, -2).
        assert!((combined.translation.x - 0.0).abs() < 1e-5);
        assert!((combined.translation.y - 10.0).abs() < 1e-5);
        assert!((combined.translation.z - (-2.0)).abs() < 1e-5);

        let frame = PoseFrame {
            skeleton: SkeletonId::new(1),
            time_seconds: 0.0,
            bones: vec![
                (BoneId::new(0), parent),
                (BoneId::new(1), child),
            ],
        };
        let parents = [(BoneId::new(0), None), (BoneId::new(1), Some(BoneId::new(0)))];
        let world_poses = frame.evaluate_world_poses(&parents);
        assert_eq!(world_poses.len(), 2);
        assert_eq!(world_poses[0].0, BoneId::new(0));
        assert_eq!(world_poses[0].1.translation, parent.translation);
        assert_eq!(world_poses[0].1.scale, parent.scale);
        assert!((world_poses[0].1.rotation.0[1] - parent.rotation.0[1]).abs() < 1e-6);
        assert_eq!(world_poses[1].0, BoneId::new(1));
        assert!((world_poses[1].1.translation.x - combined.translation.x).abs() < 1e-5);
        assert!((world_poses[1].1.translation.y - combined.translation.y).abs() < 1e-5);
        assert!((world_poses[1].1.translation.z - combined.translation.z).abs() < 1e-5);
        assert_eq!(world_poses[1].1.scale, combined.scale);
        assert!((world_poses[1].1.rotation.0[1] - combined.rotation.0[1]).abs() < 1e-6);
    }
}
