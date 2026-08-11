/// @file test_anim_player.cpp
/// Tests unitaires pour lives::AnimClip / lives::AnimPlayer.
/// Ces tests sont headless (pas de dependance bgfx runtime).

#include "iecode/engine/anim/anim_player.h"

#include <glm/gtc/epsilon.hpp>
#include <glm/gtc/matrix_access.hpp>

#include <gtest/gtest.h>

using lives::AnimClip;
using lives::AnimPlayer;
using lives::AnimTrack;

namespace {

constexpr float kEps = 1e-4f;

AnimClip make_simple_clip() {
    AnimClip clip;
    clip.duration = 2.0f;
    clip.fps      = 30.f;

    AnimTrack tr;
    tr.bone_index = 3;
    tr.times      = {0.0f, 1.0f, 2.0f};
    tr.positions  = {glm::vec3(0.f, 0.f, 0.f),
                     glm::vec3(10.f, 0.f, 0.f),
                     glm::vec3(10.f, 10.f, 0.f)};
    tr.rotations  = {glm::quat(1.f, 0.f, 0.f, 0.f),
                     glm::quat(1.f, 0.f, 0.f, 0.f),
                     glm::quat(1.f, 0.f, 0.f, 0.f)};
    tr.scales     = {glm::vec3(1.f), glm::vec3(1.f), glm::vec3(1.f)};

    clip.tracks.push_back(std::move(tr));
    return clip;
}

} // namespace

TEST(AnimPlayer, DefaultIsIdentity) {
    AnimPlayer p;
    EXPECT_TRUE(p.is_done());
    const glm::mat4 m = p.get_bone_transform(0);
    EXPECT_TRUE(glm::all(glm::epsilonEqual(glm::column(m, 3),
                                           glm::vec4(0.f, 0.f, 0.f, 1.f), kEps)));
}

TEST(AnimPlayer, SetClipResetsTime) {
    AnimClip clip = make_simple_clip();
    AnimPlayer p;
    p.set_clip(&clip);
    EXPECT_FLOAT_EQ(p.time(), 0.f);
    EXPECT_EQ(p.clip(), &clip);
}

TEST(AnimPlayer, InterpolatesPosition) {
    AnimClip clip = make_simple_clip();
    AnimPlayer p;
    p.set_loop(false);
    p.set_clip(&clip);

    // t=0 : pos = (0,0,0)
    glm::mat4 m = p.get_bone_transform(3);
    EXPECT_NEAR(glm::column(m, 3).x, 0.f, kEps);

    // t=0.5 : pos = (5,0,0)
    p.update(0.5f);
    m = p.get_bone_transform(3);
    EXPECT_NEAR(glm::column(m, 3).x, 5.f, kEps);

    // t=1.5 : pos = (10,5,0)
    p.update(1.0f);
    m = p.get_bone_transform(3);
    EXPECT_NEAR(glm::column(m, 3).x, 10.f, kEps);
    EXPECT_NEAR(glm::column(m, 3).y, 5.f, kEps);
}

TEST(AnimPlayer, LoopWraps) {
    AnimClip clip = make_simple_clip();
    AnimPlayer p;
    p.set_loop(true);
    p.set_clip(&clip);

    p.update(2.5f);  // 2.5 mod 2.0 = 0.5
    EXPECT_NEAR(p.time(), 0.5f, kEps);
    EXPECT_FALSE(p.is_done());
}

TEST(AnimPlayer, NoLoopClamps) {
    AnimClip clip = make_simple_clip();
    AnimPlayer p;
    p.set_loop(false);
    p.set_clip(&clip);

    p.update(5.0f);
    EXPECT_NEAR(p.time(), 2.0f, kEps);
    EXPECT_TRUE(p.is_done());
}

TEST(AnimPlayer, UnknownBoneReturnsIdentity) {
    AnimClip clip = make_simple_clip();
    AnimPlayer p;
    p.set_clip(&clip);
    p.update(0.5f);

    const glm::mat4 m = p.get_bone_transform(999);
    EXPECT_TRUE(glm::all(glm::epsilonEqual(glm::column(m, 3),
                                           glm::vec4(0.f, 0.f, 0.f, 1.f), kEps)));
}

TEST(AnimClip, FromG4raPlaceholderReturnsNullopt) {
    iecode::level5::G4raFile ra;
    auto clip = AnimClip::from_g4ra(ra);
    EXPECT_FALSE(clip.has_value());
}
