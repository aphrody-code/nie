/// @file test_scene_manager.cpp
/// Tests unitaires pour le systeme de scenes (CSceneManager + scenes concretes).

#include <gtest/gtest.h>

#include "iecode/game/scene/scene_manager.h"
#include "iecode/game/scene/scene_base.h"
#include "iecode/game/scene/scene_title.h"
#include "iecode/game/scene/scene_menu.h"
#include "iecode/game/scene/scene_rpg.h"
#include "iecode/game/scene/scene_rpg_battle.h"
#include "iecode/game/scene/scene_soccer.h"
#include "iecode/game/scene/scene_event.h"
#include "iecode/game/scene/scene_vsroute.h"
#include "iecode/game/scene/scene_root.h"
#include "iecode/engine/core/event_system.h"

#include <memory>
#include <string>

// ════════════════════════════════════════════════════════════════════
// Fixture — reinitialise le singleton entre chaque test.
// ════════════════════════════════════════════════════════════════════

class SceneManagerTest : public ::testing::Test {
protected:
    void SetUp() override {
        auto& mgr = game::CSceneManager::instance();
        mgr.clear();
        lives::EventSystem::clear();
    }

    void TearDown() override {
        auto& mgr = game::CSceneManager::instance();
        mgr.clear();
        lives::EventSystem::clear();
    }
};

// ════════════════════════════════════════════════════════════════════
// CSceneManager — pile de scenes
// ════════════════════════════════════════════════════════════════════

TEST_F(SceneManagerTest, InitiallyEmpty) {
    auto& mgr = game::CSceneManager::instance();
    EXPECT_FALSE(mgr.has_scene());
    EXPECT_EQ(mgr.scene_count(), 0u);
    EXPECT_EQ(mgr.current_scene(), nullptr);
}

TEST_F(SceneManagerTest, PushSceneById) {
    auto& mgr = game::CSceneManager::instance();
    mgr.push_scene(game::SceneId::Title);

    EXPECT_TRUE(mgr.has_scene());
    EXPECT_EQ(mgr.scene_count(), 1u);
    EXPECT_EQ(mgr.current_scene_id(), game::SceneId::Title);

    auto* scene = mgr.current_scene();
    ASSERT_NE(scene, nullptr);
    EXPECT_EQ(scene->scene_name(), "CSceneTitle");
    EXPECT_TRUE(scene->is_active());
}

TEST_F(SceneManagerTest, PushSceneByPointer) {
    auto& mgr = game::CSceneManager::instance();
    auto scene = std::make_unique<game::CSceneMenu>();
    mgr.push_scene(std::move(scene));

    EXPECT_TRUE(mgr.has_scene());
    EXPECT_EQ(mgr.current_scene_id(), game::SceneId::Menu);
}

TEST_F(SceneManagerTest, PushNullptrIgnored) {
    auto& mgr = game::CSceneManager::instance();
    mgr.push_scene(std::unique_ptr<game::CScene>{});

    EXPECT_FALSE(mgr.has_scene());
    EXPECT_EQ(mgr.scene_count(), 0u);
}

TEST_F(SceneManagerTest, PopScene) {
    auto& mgr = game::CSceneManager::instance();
    mgr.push_scene(game::SceneId::Title);
    mgr.pop_scene();

    EXPECT_FALSE(mgr.has_scene());
    EXPECT_EQ(mgr.scene_count(), 0u);
}

TEST_F(SceneManagerTest, PopEmptyIsNoOp) {
    auto& mgr = game::CSceneManager::instance();
    // Ne doit pas crasher.
    mgr.pop_scene();
    EXPECT_FALSE(mgr.has_scene());
}

TEST_F(SceneManagerTest, StackOrdering) {
    auto& mgr = game::CSceneManager::instance();
    mgr.push_scene(game::SceneId::Title);
    mgr.push_scene(game::SceneId::Menu);
    mgr.push_scene(game::SceneId::Rpg);

    EXPECT_EQ(mgr.scene_count(), 3u);
    EXPECT_EQ(mgr.current_scene_id(), game::SceneId::Rpg);

    mgr.pop_scene();
    EXPECT_EQ(mgr.scene_count(), 2u);
    EXPECT_EQ(mgr.current_scene_id(), game::SceneId::Menu);

    mgr.pop_scene();
    EXPECT_EQ(mgr.scene_count(), 1u);
    EXPECT_EQ(mgr.current_scene_id(), game::SceneId::Title);
}

TEST_F(SceneManagerTest, SwitchScene) {
    auto& mgr = game::CSceneManager::instance();
    mgr.push_scene(game::SceneId::Title);
    mgr.switch_scene(game::SceneId::Soccer);

    // Switch remplace la scene courante, la taille de la pile reste 1.
    EXPECT_EQ(mgr.scene_count(), 1u);
    EXPECT_EQ(mgr.current_scene_id(), game::SceneId::Soccer);
    EXPECT_EQ(mgr.current_scene()->scene_name(), "CSceneSoccer");
}

TEST_F(SceneManagerTest, SwitchOnEmptyStack) {
    auto& mgr = game::CSceneManager::instance();
    // Switch sur pile vide : cree simplement la scene.
    mgr.switch_scene(game::SceneId::Event);

    EXPECT_EQ(mgr.scene_count(), 1u);
    EXPECT_EQ(mgr.current_scene_id(), game::SceneId::Event);
}

TEST_F(SceneManagerTest, ClearEmptiesStack) {
    auto& mgr = game::CSceneManager::instance();
    mgr.push_scene(game::SceneId::Title);
    mgr.push_scene(game::SceneId::Menu);
    mgr.push_scene(game::SceneId::Soccer);

    mgr.clear();
    EXPECT_FALSE(mgr.has_scene());
    EXPECT_EQ(mgr.scene_count(), 0u);
}

TEST_F(SceneManagerTest, UpdateAndDraw) {
    auto& mgr = game::CSceneManager::instance();
    mgr.push_scene(game::SceneId::Title);

    // Ne doit pas crasher.
    mgr.update(0.016f);
    mgr.draw();
}

TEST_F(SceneManagerTest, UpdateEmptyIsNoOp) {
    auto& mgr = game::CSceneManager::instance();
    // Ne doit pas crasher.
    mgr.update(0.016f);
    mgr.draw();
}

// ════════════════════════════════════════════════════════════════════
// Evenements — verification de l'emission
// ════════════════════════════════════════════════════════════════════

TEST_F(SceneManagerTest, PushEmitsSceneLoadEvent) {
    bool event_fired = false;
    (void)lives::EventSystem::subscribe(
        lives::EventType::SCENE_LOAD,
        [&](lives::EventData data) {
            event_fired = true;
            auto id = std::get<uint64_t>(data);
            EXPECT_EQ(id, static_cast<uint64_t>(game::SceneId::Title));
        });

    auto& mgr = game::CSceneManager::instance();
    mgr.push_scene(game::SceneId::Title);
    EXPECT_TRUE(event_fired);
}

TEST_F(SceneManagerTest, PopEmitsSceneUnloadEvent) {
    auto& mgr = game::CSceneManager::instance();
    mgr.push_scene(game::SceneId::Menu);

    bool event_fired = false;
    (void)lives::EventSystem::subscribe(
        lives::EventType::SCENE_UNLOAD,
        [&](lives::EventData data) {
            event_fired = true;
            auto id = std::get<uint64_t>(data);
            EXPECT_EQ(id, static_cast<uint64_t>(game::SceneId::Menu));
        });

    mgr.pop_scene();
    EXPECT_TRUE(event_fired);
}

TEST_F(SceneManagerTest, SwitchEmitsTransitionEvent) {
    auto& mgr = game::CSceneManager::instance();
    mgr.push_scene(game::SceneId::Title);

    bool transition_fired = false;
    (void)lives::EventSystem::subscribe(
        lives::EventType::SCENE_TRANSITION,
        [&](lives::EventData data) {
            transition_fired = true;
            auto id = std::get<uint64_t>(data);
            EXPECT_EQ(id, static_cast<uint64_t>(game::SceneId::Soccer));
        });

    mgr.switch_scene(game::SceneId::Soccer);
    EXPECT_TRUE(transition_fired);
}

// ════════════════════════════════════════════════════════════════════
// Pause / Resume — verification du lifecycle
// ════════════════════════════════════════════════════════════════════

TEST_F(SceneManagerTest, PushPausesCurrentScene) {
    auto& mgr = game::CSceneManager::instance();
    mgr.push_scene(game::SceneId::Title);

    auto* title = mgr.current_scene();
    ASSERT_NE(title, nullptr);
    EXPECT_TRUE(title->is_active());

    // Empiler une scene par-dessus met Title en pause.
    mgr.push_scene(game::SceneId::Menu);
    // Title n'est plus la scene courante.
    EXPECT_EQ(mgr.current_scene_id(), game::SceneId::Menu);
}

TEST_F(SceneManagerTest, PopResumesUnderlyingScene) {
    auto& mgr = game::CSceneManager::instance();
    mgr.push_scene(game::SceneId::Title);
    mgr.push_scene(game::SceneId::Menu);

    mgr.pop_scene();
    EXPECT_EQ(mgr.current_scene_id(), game::SceneId::Title);
}

// ════════════════════════════════════════════════════════════════════
// Phases — verification du systeme de phases
// ════════════════════════════════════════════════════════════════════

TEST_F(SceneManagerTest, PhaseChangeInScene) {
    auto& mgr = game::CSceneManager::instance();
    mgr.push_scene(game::SceneId::Title);

    auto* scene = mgr.current_scene();
    ASSERT_NE(scene, nullptr);

    // L'ecran titre commence en phase 0 (LOGO).
    EXPECT_EQ(scene->current_phase(), 0u);

    // Changement de phase.
    scene->set_phase(1);
    EXPECT_EQ(scene->current_phase(), 1u);

    // Meme phase = pas de changement.
    scene->set_phase(1);
    EXPECT_EQ(scene->current_phase(), 1u);
}

TEST_F(SceneManagerTest, RpgPhaseSystem) {
    auto rpg = std::make_unique<game::CSceneRpg>();
    rpg->on_enter();

    // Phase initiale = Phase010 (10).
    EXPECT_EQ(rpg->rpg_phase(), game::RpgScenePhase::Phase010);
    EXPECT_EQ(rpg->current_phase(), static_cast<uint32_t>(game::RpgScenePhase::Phase010));

    // Progression vers Phase100.
    rpg->set_rpg_phase(game::RpgScenePhase::Phase100);
    EXPECT_EQ(rpg->rpg_phase(), game::RpgScenePhase::Phase100);
    EXPECT_EQ(rpg->current_phase(), 100u);

    rpg->on_exit();
}

// ════════════════════════════════════════════════════════════════════
// Factory — creation de scenes par SceneId
// ════════════════════════════════════════════════════════════════════

TEST_F(SceneManagerTest, CreateSceneAllTypes) {
    // Verifie que chaque SceneId produit la bonne scene.
    struct TestCase {
        game::SceneId id;
        std::string_view expected_name;
    };

    const TestCase cases[] = {
        {game::SceneId::Title,          "CSceneTitle"},
        {game::SceneId::Menu,           "CSceneMenu"},
        {game::SceneId::Rpg,            "CSceneRpg"},
        {game::SceneId::RpgBattle,      "CSceneRpgBattle"},
        {game::SceneId::Soccer,         "CSceneSoccer"},
        {game::SceneId::SoccerTraining, "CSceneSoccerTraining"},
        {game::SceneId::Event,          "CSceneEvent"},
        {game::SceneId::VSRoute,        "CSceneVSRoute"},
    };

    for (const auto& tc : cases) {
        auto scene = game::create_scene(tc.id);
        ASSERT_NE(scene, nullptr) << "create_scene a retourne nullptr pour "
                                  << game::scene_id_name(tc.id);
        EXPECT_EQ(scene->scene_name(), tc.expected_name);
        EXPECT_EQ(scene->scene_id(), tc.id);
    }
}

// ════════════════════════════════════════════════════════════════════
// scene_id_name — noms lisibles
// ════════════════════════════════════════════════════════════════════

TEST_F(SceneManagerTest, SceneIdNames) {
    EXPECT_EQ(game::scene_id_name(game::SceneId::Title), "Title");
    EXPECT_EQ(game::scene_id_name(game::SceneId::Menu), "Menu");
    EXPECT_EQ(game::scene_id_name(game::SceneId::Rpg), "Rpg");
    EXPECT_EQ(game::scene_id_name(game::SceneId::RpgBattle), "RpgBattle");
    EXPECT_EQ(game::scene_id_name(game::SceneId::Soccer), "Soccer");
    EXPECT_EQ(game::scene_id_name(game::SceneId::SoccerTraining), "SoccerTraining");
    EXPECT_EQ(game::scene_id_name(game::SceneId::Event), "Event");
    EXPECT_EQ(game::scene_id_name(game::SceneId::VSRoute), "VSRoute");
}

// ════════════════════════════════════════════════════════════════════
// Scenes concretes — proprietes specifiques
// ════════════════════════════════════════════════════════════════════

TEST_F(SceneManagerTest, SceneTitleProperties) {
    game::CSceneTitle title;
    title.on_enter();

    EXPECT_TRUE(title.is_active());
    EXPECT_FALSE(title.is_press_start_done());
    EXPECT_EQ(title.scene_id(), game::SceneId::Title);

    title.on_exit();
    EXPECT_FALSE(title.is_active());
}

TEST_F(SceneManagerTest, SceneMenuProperties) {
    game::CSceneMenu menu;
    menu.on_enter();

    EXPECT_TRUE(menu.is_active());
    EXPECT_EQ(menu.active_menu_count(), 1u); // Menu principal charge.
    EXPECT_EQ(menu.scene_id(), game::SceneId::Menu);

    menu.on_exit();
    EXPECT_EQ(menu.active_menu_count(), 0u);
}

TEST_F(SceneManagerTest, SceneSoccerConstants) {
    // Verifie les constantes extraites de nie.exe.
    EXPECT_EQ(game::CSceneSoccer::PLAYER_STRIDE, 0x570u);
    EXPECT_EQ(game::CSceneSoccer::MAX_PLAYERS, 58u);
    EXPECT_EQ(game::CSceneSoccer::TEAM_STRIDE, 0x1028u);
}

TEST_F(SceneManagerTest, SceneEventProperties) {
    game::CSceneEvent event;
    event.on_enter();

    EXPECT_TRUE(event.is_active());
    EXPECT_TRUE(event.is_skippable());
    EXPECT_EQ(event.event_id(), 0u);

    event.on_exit();
}

TEST_F(SceneManagerTest, SceneVSRouteProperties) {
    game::CSceneVSRoute vsroute;
    vsroute.on_enter();

    EXPECT_TRUE(vsroute.is_active());
    EXPECT_EQ(vsroute.route_level(), 0u);
    EXPECT_FALSE(vsroute.is_online());

    vsroute.on_exit();
}

TEST_F(SceneManagerTest, SceneRootInit) {
    game::CSceneRoot root;
    root.on_enter();

    EXPECT_TRUE(root.is_active());
    EXPECT_TRUE(root.is_init_complete());
}

TEST_F(SceneManagerTest, SceneMainTransitionRequest) {
    game::CSceneMain main;
    main.on_enter();

    EXPECT_EQ(main.pending_target(), game::SceneId::Menu);

    main.request_transition(game::SceneId::Soccer);
    EXPECT_EQ(main.pending_target(), game::SceneId::Soccer);

    main.on_exit();
}

TEST_F(SceneManagerTest, SceneRpgBattleProperties) {
    game::CSceneRpgBattle battle;
    battle.on_enter();

    EXPECT_TRUE(battle.is_active());
    EXPECT_TRUE(battle.is_battle_active());
    EXPECT_EQ(battle.battle_id(), 0u);

    battle.on_exit();
    EXPECT_FALSE(battle.is_battle_active());
}

// ════════════════════════════════════════════════════════════════════
// Scenario complet — flux de jeu typique
// ════════════════════════════════════════════════════════════════════

TEST_F(SceneManagerTest, TypicalGameFlow) {
    auto& mgr = game::CSceneManager::instance();

    // Lancement du jeu : Title -> Menu -> RPG -> Soccer overlay -> retour RPG.
    mgr.push_scene(game::SceneId::Title);
    EXPECT_EQ(mgr.current_scene_id(), game::SceneId::Title);

    // Transition vers le menu.
    mgr.switch_scene(game::SceneId::Menu);
    EXPECT_EQ(mgr.scene_count(), 1u);
    EXPECT_EQ(mgr.current_scene_id(), game::SceneId::Menu);

    // Entree en mode RPG.
    mgr.switch_scene(game::SceneId::Rpg);
    EXPECT_EQ(mgr.current_scene_id(), game::SceneId::Rpg);

    // Match de foot empile par-dessus le RPG.
    mgr.push_scene(game::SceneId::Soccer);
    EXPECT_EQ(mgr.scene_count(), 2u);
    EXPECT_EQ(mgr.current_scene_id(), game::SceneId::Soccer);

    // Simule quelques frames.
    mgr.update(0.016f);
    mgr.draw();

    // Fin du match, retour au RPG.
    mgr.pop_scene();
    EXPECT_EQ(mgr.scene_count(), 1u);
    EXPECT_EQ(mgr.current_scene_id(), game::SceneId::Rpg);
}
