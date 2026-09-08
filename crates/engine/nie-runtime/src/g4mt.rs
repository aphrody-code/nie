//! Runtime adapter from decoded G4MT tracks to the canonical animation contract.
//!
//! Byte parsing and target resolution remain owned by `nie-formats`. This module only maps the
//! explicit, format-neutral result of `Motion::decode_clip` into `nie-core` identities and then
//! delegates deterministic sampling to `AnimationClip`.

use nie_core::animation::{
    AnimationClip, AnimationError, BoneId, BonePose, BoneTrack, Keyframe, PoseFrame, Rotation,
    SkeletonId,
};
use nie_formats::g4mt::DecodedMotionClip;
use nie_geom::Vec3;

/// Failure while adapting an already decoded G4MT clip for runtime playback.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum G4mtAdapterError {
    /// A resolved skeleton index does not fit the canonical bone identity.
    BoneIndexOutOfRange(usize),
    /// The converted clip violates the bounded canonical animation contract.
    InvalidAnimation(AnimationError),
    /// The requested sample time is negative or non-finite.
    InvalidSampleTime,
}

/// Converts an explicit G4MT decode result into the canonical runtime clip.
///
/// Target hashes and unresolved targets have already been handled by `Motion::decode_clip`.
/// This adapter does not guess missing identities or alter the decoded local transforms.
pub fn animation_clip(
    decoded: &DecodedMotionClip,
    skeleton: SkeletonId,
) -> Result<AnimationClip, G4mtAdapterError> {
    let tracks = decoded
        .tracks
        .iter()
        .map(|track| {
            let bone = u16::try_from(track.bone_index)
                .map(BoneId::new)
                .map_err(|_| G4mtAdapterError::BoneIndexOutOfRange(track.bone_index))?;
            let keyframes = track
                .keyframes
                .iter()
                .map(|keyframe| Keyframe {
                    time_seconds: keyframe.time_seconds,
                    pose: BonePose {
                        translation: Vec3::new(
                            keyframe.pose.translation[0],
                            keyframe.pose.translation[1],
                            keyframe.pose.translation[2],
                        ),
                        rotation: Rotation(keyframe.pose.quat),
                        scale: Vec3::new(
                            keyframe.pose.scale[0],
                            keyframe.pose.scale[1],
                            keyframe.pose.scale[2],
                        ),
                    },
                })
                .collect();
            Ok(BoneTrack { bone, keyframes })
        })
        .collect::<Result<Vec<_>, G4mtAdapterError>>()?;

    let clip = AnimationClip {
        skeleton,
        duration_seconds: decoded.duration_seconds,
        tracks,
    };
    clip.validate()
        .map_err(G4mtAdapterError::InvalidAnimation)?;
    Ok(clip)
}

/// Converts and samples an explicit G4MT decode result as a canonical [`PoseFrame`].
pub fn pose_frame(
    decoded: &DecodedMotionClip,
    skeleton: SkeletonId,
    time_seconds: f32,
    looped: bool,
) -> Result<PoseFrame, G4mtAdapterError> {
    let clip = animation_clip(decoded, skeleton)?;
    clip.sample(time_seconds, looped)
        .ok_or(G4mtAdapterError::InvalidSampleTime)
}

#[cfg(test)]
mod tests {
    use super::*;
    use nie_formats::{
        g4mt::{DecodedMotionKeyframe, DecodedMotionTrack},
        g4sk::LocalTrs,
    };

    fn keyframe(time_seconds: f32, x: f32) -> DecodedMotionKeyframe {
        DecodedMotionKeyframe {
            time_seconds,
            pose: LocalTrs {
                scale: [1.0, 1.0, 1.0],
                quat: [0.0, 0.0, 0.0, 1.0],
                translation: [x, 2.0, 3.0],
            },
        }
    }

    #[test]
    fn decoded_track_reaches_canonical_pose_sampling() {
        let decoded = DecodedMotionClip {
            name: "fixture".into(),
            duration_seconds: 1.0,
            tracks: vec![DecodedMotionTrack {
                bone_index: 7,
                keyframes: vec![keyframe(0.0, 0.0), keyframe(1.0, 4.0)],
            }],
        };

        let frame = pose_frame(&decoded, SkeletonId::new(42), 0.25, false).unwrap();

        assert_eq!(frame.skeleton, SkeletonId::new(42));
        assert_eq!(frame.time_seconds, 0.25);
        assert_eq!(
            frame.bone(BoneId::new(7)).unwrap().translation,
            Vec3::new(1.0, 2.0, 3.0)
        );
    }

    #[test]
    fn out_of_range_bone_is_not_truncated() {
        let decoded = DecodedMotionClip {
            name: "fixture".into(),
            duration_seconds: 0.0,
            tracks: vec![DecodedMotionTrack {
                bone_index: usize::from(u16::MAX) + 1,
                keyframes: vec![keyframe(0.0, 0.0)],
            }],
        };

        assert_eq!(
            animation_clip(&decoded, SkeletonId::new(1)),
            Err(G4mtAdapterError::BoneIndexOutOfRange(
                usize::from(u16::MAX) + 1
            ))
        );
    }

    #[test]
    fn invalid_decoded_timing_fails_closed() {
        let decoded = DecodedMotionClip {
            name: "fixture".into(),
            duration_seconds: 1.0,
            tracks: vec![DecodedMotionTrack {
                bone_index: 0,
                keyframes: vec![keyframe(0.75, 0.0), keyframe(0.5, 1.0)],
            }],
        };

        assert_eq!(
            animation_clip(&decoded, SkeletonId::new(1)),
            Err(G4mtAdapterError::InvalidAnimation(
                AnimationError::UnsortedKeyframes
            ))
        );
    }
}
