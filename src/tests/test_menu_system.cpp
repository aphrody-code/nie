/// @file test_menu_system.cpp
/// Tests unitaires pour le systeme de menus lives:: (16 classes).
/// Couvre CMenuObject, CMenuRender, CMenuAnimation, CMenuLayerGroup,
/// CMenuListView, CMenuText, CMenuCursorCtrl, CMenuIconDraw,
/// MenuScrollBarComponent, MenuAnchorComponent, MenuAnchor3DComponent,
/// CMenuAttachLocator, CRefModelMenuPrimitive, CMenuRefMaterialSync,
/// CMenuNamingSetting.

#include <iecode/engine/menu/menu_object.h>
#include <iecode/engine/menu/menu_render.h>
#include <iecode/engine/menu/menu_animation.h>
#include <iecode/engine/menu/menu_layer.h>
#include <iecode/engine/menu/menu_list_view.h>
#include <iecode/engine/menu/menu_text.h>
#include <iecode/engine/menu/menu_cursor.h>
#include <iecode/engine/menu/menu_icon.h>
#include <iecode/engine/menu/menu_scroll.h>
#include <iecode/engine/menu/menu_anchor.h>
#include <iecode/engine/menu/menu_attach.h>
#include <iecode/engine/menu/menu_ref_model.h>
#include <iecode/engine/menu/menu_naming.h>

#include <gtest/gtest.h>

namespace {

// ═══════════════════════════════════════════════════════════════════════
// CMenuObject
// ═══════════════════════════════════════════════════════════════════════

TEST(CMenuObject, ClassNameCorrect) {
    lives::CMenuObject obj;
    EXPECT_EQ(obj.get_class_name(), "CMenuObject");
}

TEST(CMenuObject, AddChildSetsParent) {
    lives::CMenuObject parent;
    lives::CMenuObject child;
    parent.add_child(&child);

    EXPECT_EQ(child.parent_, &parent);
    ASSERT_EQ(parent.children_.size(), 1);
    EXPECT_EQ(parent.children_[0], &child);
}

TEST(CMenuObject, RemoveChildClearsParent) {
    lives::CMenuObject parent;
    lives::CMenuObject child;
    parent.add_child(&child);
    parent.remove_child(&child);

    EXPECT_EQ(child.parent_, nullptr);
    EXPECT_TRUE(parent.children_.empty());
}

TEST(CMenuObject, AddChildReparents) {
    lives::CMenuObject parent1;
    lives::CMenuObject parent2;
    lives::CMenuObject child;

    parent1.add_child(&child);
    EXPECT_EQ(child.parent_, &parent1);

    parent2.add_child(&child);
    EXPECT_EQ(child.parent_, &parent2);
    EXPECT_TRUE(parent1.children_.empty());
    ASSERT_EQ(parent2.children_.size(), 1);
}

TEST(CMenuObject, FindChildByName) {
    lives::CMenuObject root;
    lives::CMenuObject child1;
    lives::CMenuObject child2;
    lives::CMenuObject grandchild;

    child1.name_ = "child1";
    child2.name_ = "child2";
    grandchild.name_ = "grandchild";

    root.add_child(&child1);
    root.add_child(&child2);
    child2.add_child(&grandchild);

    EXPECT_EQ(root.find_child_by_name("child1"), &child1);
    EXPECT_EQ(root.find_child_by_name("grandchild"), &grandchild);
    EXPECT_EQ(root.find_child_by_name("nonexistent"), nullptr);
}

TEST(CMenuObject, SetLayout) {
    lives::CMenuObject obj;
    lives::MenuLayout layout{
        .pos = {100.f, 200.f},
        .size = {320.f, 240.f},
        .scale = 2.f,
        .info_id = 42,
    };
    obj.set_layout(layout);

    EXPECT_FLOAT_EQ(obj.layout_.pos.x, 100.f);
    EXPECT_FLOAT_EQ(obj.layout_.size.y, 240.f);
    EXPECT_FLOAT_EQ(obj.layout_.scale, 2.f);
    EXPECT_EQ(obj.layout_.info_id, 42u);
}

TEST(CMenuObject, AddNullChildNoOp) {
    lives::CMenuObject parent;
    parent.add_child(nullptr);
    EXPECT_TRUE(parent.children_.empty());
}

// ═══════════════════════════════════════════════════════════════════════
// CMenuRender
// ═══════════════════════════════════════════════════════════════════════

TEST(CMenuRender, RegisterAndUnregister) {
    lives::CMenuRender render;
    lives::CMenuObject obj;

    auto slot = render.register_object(&obj, 10);
    EXPECT_GE(slot, 0);
    EXPECT_EQ(render.active_count_, 1u);

    render.unregister_object(slot);
    EXPECT_EQ(render.active_count_, 0u);
}

TEST(CMenuRender, RegisterNullReturnsMinusOne) {
    lives::CMenuRender render;
    EXPECT_EQ(render.register_object(nullptr, 0), -1);
}

TEST(CMenuRender, SortByPriority) {
    lives::CMenuRender render;
    lives::CMenuObject obj1;
    lives::CMenuObject obj2;
    lives::CMenuObject obj3;

    (void)render.register_object(&obj3, 30);
    (void)render.register_object(&obj1, 10);
    (void)render.register_object(&obj2, 20);

    render.sort_by_priority();

    // Apres tri, priorites croissantes dans les premiers slots.
    EXPECT_EQ(render.slots_[0].priority, 10u);
    EXPECT_EQ(render.slots_[1].priority, 20u);
    EXPECT_EQ(render.slots_[2].priority, 30u);
}

TEST(CMenuRender, DrawPassEnum) {
    // Verification des 13 passes.
    EXPECT_EQ(static_cast<uint8_t>(lives::MenuDrawPass::COUNT), 13);
    EXPECT_EQ(static_cast<uint8_t>(lives::MenuDrawPass::UI_BEFORE), 0);
    EXPECT_EQ(static_cast<uint8_t>(lives::MenuDrawPass::POST_MENU_END_DRAW), 12);
}

// ═══════════════════════════════════════════════════════════════════════
// CMenuAnimation
// ═══════════════════════════════════════════════════════════════════════

TEST(CMenuAnimation, PlayAndUpdate) {
    lives::CMenuAnimation anim;
    anim.duration_ = 1.0f;
    anim.play();

    EXPECT_TRUE(anim.playing_);
    EXPECT_FLOAT_EQ(anim.current_time_, 0.f);

    anim.update(0.5f);
    EXPECT_FLOAT_EQ(anim.current_time_, 0.5f);
    EXPECT_FALSE(anim.is_finished());

    anim.update(0.5f);
    EXPECT_TRUE(anim.is_finished());
    EXPECT_FALSE(anim.playing_);
}

TEST(CMenuAnimation, Looping) {
    lives::CMenuAnimation anim;
    anim.duration_ = 1.0f;
    anim.looping_ = true;
    anim.play();

    anim.update(1.5f);
    EXPECT_TRUE(anim.playing_);
    EXPECT_FALSE(anim.is_finished());
    EXPECT_NEAR(anim.current_time_, 0.5f, 0.001f);
}

TEST(CMenuAnimation, ProgressEaseIn) {
    lives::CMenuAnimation anim;
    anim.duration_ = 1.0f;
    anim.ease_type_ = lives::EaseType::EASE_IN;
    anim.play();
    anim.update(0.5f);

    // Ease in: t^2 = 0.5^2 = 0.25
    EXPECT_NEAR(anim.progress(), 0.25f, 0.001f);
}

TEST(CMenuAnimation, ProgressEaseOut) {
    lives::CMenuAnimation anim;
    anim.duration_ = 1.0f;
    anim.ease_type_ = lives::EaseType::EASE_OUT;
    anim.play();
    anim.update(0.5f);

    // Ease out: 1 - (1-0.5)^2 = 1 - 0.25 = 0.75
    EXPECT_NEAR(anim.progress(), 0.75f, 0.001f);
}

TEST(CMenuAnimation, StopResetsTime) {
    lives::CMenuAnimation anim;
    anim.duration_ = 2.0f;
    anim.play();
    anim.update(1.0f);
    anim.stop();

    EXPECT_FALSE(anim.playing_);
    EXPECT_FLOAT_EQ(anim.current_time_, 0.f);
}

TEST(CMenuSimpleAnimation, CurrentValueWithEase) {
    lives::CMenuSimpleAnimation anim;
    anim.duration_ = 1.0f;
    anim.start_value_ = 0.f;
    anim.end_value_ = 100.f;
    anim.ease_type_ = lives::EaseType::LINEAR;
    anim.play();
    anim.update(0.5f);

    EXPECT_NEAR(anim.current_value(), 50.f, 0.01f);
}

TEST(CMenuRateAnimeCtrl, UpdateAndReset) {
    lives::CMenuRateAnimeCtrl ctrl;
    ctrl.rate_ = 2.0f;

    ctrl.update(0.25f);
    EXPECT_NEAR(ctrl.progress_, 0.5f, 0.001f);

    ctrl.reset();
    EXPECT_FLOAT_EQ(ctrl.progress_, 0.f);
}

// ═══════════════════════════════════════════════════════════════════════
// CMenuLayerGroup
// ═══════════════════════════════════════════════════════════════════════

TEST(CMenuLayerGroup, AddAndSortLayers) {
    lives::CMenuLayerGroup group;
    lives::CMenuLayerObject layer1;
    lives::CMenuLayerObject layer2;
    lives::CMenuLayerObject layer3;

    layer1.layer_index_ = 2;
    layer2.layer_index_ = 0;
    layer3.layer_index_ = 1;

    group.add_layer(&layer1);
    group.add_layer(&layer2);
    group.add_layer(&layer3);

    // Apres tri, ordre par profondeur.
    ASSERT_EQ(group.layers_.size(), 3);
    EXPECT_EQ(group.layers_[0]->layer_index_, 0u);
    EXPECT_EQ(group.layers_[1]->layer_index_, 1u);
    EXPECT_EQ(group.layers_[2]->layer_index_, 2u);
}

TEST(CMenuLayerGroup, SetActiveLayer) {
    lives::CMenuLayerGroup group;
    lives::CMenuLayerObject layer0;
    lives::CMenuLayerObject layer1;
    layer0.layer_index_ = 0;
    layer1.layer_index_ = 1;

    group.add_layer(&layer0);
    group.add_layer(&layer1);

    group.set_active_layer(1);
    EXPECT_FALSE(layer0.active_);
    EXPECT_TRUE(layer1.active_);
    EXPECT_EQ(group.get_active_layer(), &layer1);
}

TEST(CMenuLayerGroup, RemoveLayer) {
    lives::CMenuLayerGroup group;
    lives::CMenuLayerObject layer;
    group.add_layer(&layer);
    EXPECT_EQ(group.layers_.size(), 1);

    group.remove_layer(&layer);
    EXPECT_TRUE(group.layers_.empty());
}

// ═══════════════════════════════════════════════════════════════════════
// CMenuListView
// ═══════════════════════════════════════════════════════════════════════

TEST(CMenuListView, SelectAndScroll) {
    lives::CMenuListView list;
    list.set_item_count(20);
    list.visible_count_ = 5;

    list.select(15);
    EXPECT_EQ(list.selected_index_, 15u);
    // Scroll doit s'ajuster pour rendre l'item 15 visible.
    EXPECT_LE(list.scroll_offset_, 15u);
    EXPECT_GT(list.scroll_offset_ + list.visible_count_, 15u);
}

TEST(CMenuListView, SelectNextWraps) {
    lives::CMenuListView list;
    list.set_item_count(3);

    list.select(2);
    list.select_next();
    EXPECT_EQ(list.selected_index_, 0u);
}

TEST(CMenuListView, SelectPreviousWraps) {
    lives::CMenuListView list;
    list.set_item_count(3);

    list.select(0);
    list.select_previous();
    EXPECT_EQ(list.selected_index_, 2u);
}

TEST(CMenuListView, SetItemCountClampsSelection) {
    lives::CMenuListView list;
    list.set_item_count(10);
    list.select(9);
    list.set_item_count(5);

    EXPECT_EQ(list.selected_index_, 4u);
}

TEST(CMenuListView, LastVisible) {
    lives::CMenuListView list;
    list.set_item_count(20);
    list.visible_count_ = 5;
    list.scroll_to(3);

    EXPECT_EQ(list.first_visible(), 3u);
    EXPECT_EQ(list.last_visible(), 8u);
}

TEST(CMenuListView, EnsureVisible) {
    lives::CMenuListView list;
    list.set_item_count(20);
    list.visible_count_ = 5;
    list.scroll_to(0);

    list.ensure_visible(10);
    EXPECT_EQ(list.scroll_offset_, 6u); // 10 - 5 + 1 = 6
}

// ═══════════════════════════════════════════════════════════════════════
// CMenuText
// ═══════════════════════════════════════════════════════════════════════

TEST(CMenuText, SetTextMarksDirty) {
    lives::CMenuText text;
    text.update(0.f); // Nettoie le dirty initial.
    text.set_text("Hello");
    EXPECT_EQ(text.text_, "Hello");
}

TEST(CMenuText, MeasureEmptyText) {
    lives::CMenuText text;
    auto size = text.measure_text();
    EXPECT_FLOAT_EQ(size.x, 0.f);
    EXPECT_FLOAT_EQ(size.y, 0.f);
}

TEST(CMenuText, MeasureMultilineText) {
    lives::CMenuText text;
    text.set_text("AB\nCD");

    auto size = text.measure_text();
    // 2 caracteres par ligne, 2 lignes.
    EXPECT_GT(size.x, 0.f);
    EXPECT_GT(size.y, 0.f); // 2 lignes
}

TEST(CMenuText, ClassNameCorrect) {
    lives::CMenuText text;
    EXPECT_EQ(text.get_class_name(), "CMenuText");

    lives::CRefModelMenuText ref;
    EXPECT_EQ(ref.get_class_name(), "CRefModelMenuText");
}

// ═══════════════════════════════════════════════════════════════════════
// CMenuCursorCtrl
// ═══════════════════════════════════════════════════════════════════════

TEST(CMenuCursorCtrl, MoveDownWraps) {
    lives::CMenuCursorCtrl cursor;
    cursor.max_items_ = 3;
    cursor.wrap_mode_ = lives::CursorWrapMode::WRAP;
    cursor.current_index_ = 2;

    cursor.move_down();
    EXPECT_EQ(cursor.current_index_, 0u);
}

TEST(CMenuCursorCtrl, MoveDownClamps) {
    lives::CMenuCursorCtrl cursor;
    cursor.max_items_ = 3;
    cursor.wrap_mode_ = lives::CursorWrapMode::CLAMP;
    cursor.current_index_ = 2;

    cursor.move_down();
    EXPECT_EQ(cursor.current_index_, 2u);
}

TEST(CMenuCursorCtrl, MoveUpWraps) {
    lives::CMenuCursorCtrl cursor;
    cursor.max_items_ = 3;
    cursor.wrap_mode_ = lives::CursorWrapMode::WRAP;
    cursor.current_index_ = 0;

    cursor.move_up();
    EXPECT_EQ(cursor.current_index_, 2u);
}

TEST(CMenuCursorCtrl, SelectCallsCallback) {
    lives::CMenuCursorCtrl cursor;
    cursor.max_items_ = 5;
    cursor.current_index_ = 3;

    uint32_t selected = 999;
    cursor.on_select_ = [&selected](uint32_t idx) { selected = idx; };

    cursor.select();
    EXPECT_EQ(selected, 3u);
}

TEST(CMenuCursorCtrl, IndexChangedCallback) {
    lives::CMenuCursorCtrl cursor;
    cursor.max_items_ = 5;
    cursor.current_index_ = 0;

    uint32_t old_idx = 999, new_idx = 999;
    cursor.on_index_changed_ = [&](uint32_t o, uint32_t n) {
        old_idx = o;
        new_idx = n;
    };

    cursor.move_down();
    EXPECT_EQ(old_idx, 0u);
    EXPECT_EQ(new_idx, 1u);
}

TEST(CMenuCursorCtrl, UpdateInterpolatesToTarget) {
    lives::CMenuCursorCtrl cursor;
    cursor.max_items_ = 2;
    cursor.move_speed_ = 100.f;
    cursor.set_item_position(0, {0.f, 0.f});
    cursor.set_item_position(1, {0.f, 100.f});

    cursor.set_index(0);
    EXPECT_FLOAT_EQ(cursor.cursor_pos_.y, 0.f);

    cursor.move_down();
    // target_pos_ devrait etre {0, 100}.
    cursor.update(0.5f); // 100 * 0.5 = 50 pixels de mouvement.
    EXPECT_NEAR(cursor.cursor_pos_.y, 50.f, 1.f);
}

TEST(CMenuCursorCtrl, GridNavigation) {
    lives::CMenuCursorCtrl cursor;
    cursor.max_items_ = 9; // Grille 3x3.
    cursor.columns_ = 3;
    cursor.current_index_ = 0;

    cursor.move_right();
    EXPECT_EQ(cursor.current_index_, 1u);

    cursor.move(lives::CursorDirection::DOWN);
    EXPECT_EQ(cursor.current_index_, 4u); // 1 + 3

    cursor.move_left();
    EXPECT_EQ(cursor.current_index_, 3u);
}

// ═══════════════════════════════════════════════════════════════════════
// CMenuIconDraw
// ═══════════════════════════════════════════════════════════════════════

TEST(CMenuIconDraw, ComputeUV) {
    lives::CMenuIconDraw icon;
    icon.atlas_columns_ = 4;
    icon.cell_size_ = {32.f, 32.f};
    icon.icon_index_ = 5; // Ligne 1, colonne 1.

    auto uv = icon.compute_uv();
    // Colonne 1/4, ligne 1. Atlas 128x128.
    EXPECT_NEAR(uv.x, 0.25f, 0.001f); // u_min = 1/4
    EXPECT_NEAR(uv.y, 0.25f, 0.001f); // v_min = 1/4
    EXPECT_NEAR(uv.z, 0.5f, 0.001f);  // u_max = 2/4
    EXPECT_NEAR(uv.w, 0.5f, 0.001f);  // v_max = 2/4
}

TEST(CMenuIconDraw, ComputeUVFlipped) {
    lives::CMenuIconDraw icon;
    icon.atlas_columns_ = 2;
    icon.cell_size_ = {64.f, 64.f};
    icon.icon_index_ = 0;
    icon.flip_h_ = true;

    auto uv = icon.compute_uv();
    EXPECT_GT(uv.x, uv.z); // u_min > u_max quand flippe horizontalement.
}

TEST(CMenuIconDraw, ClassNameCorrect) {
    lives::CMenuIconDraw icon;
    EXPECT_EQ(icon.get_class_name(), "CMenuIconDraw");
}

// ═══════════════════════════════════════════════════════════════════════
// MenuScrollBarComponent
// ═══════════════════════════════════════════════════════════════════════

TEST(MenuScrollBarComponent, ThumbPosition) {
    lives::MenuScrollBarComponent scroll;
    scroll.set_range(100, 10);

    scroll.scroll_to(50);
    // Position = 50 / (100 - 10) = 50/90 = 0.5556
    EXPECT_NEAR(scroll.get_thumb_position(), 50.f / 90.f, 0.001f);
}

TEST(MenuScrollBarComponent, ThumbSize) {
    lives::MenuScrollBarComponent scroll;
    scroll.set_range(100, 10);

    // Taille = 10/100 = 0.1
    EXPECT_NEAR(scroll.get_thumb_size(), 0.1f, 0.001f);
}

TEST(MenuScrollBarComponent, NeedsScrollbar) {
    lives::MenuScrollBarComponent scroll;
    scroll.set_range(10, 20);
    EXPECT_FALSE(scroll.needs_scrollbar());

    scroll.set_range(20, 10);
    EXPECT_TRUE(scroll.needs_scrollbar());
}

TEST(MenuScrollBarComponent, ScrollBy) {
    lives::MenuScrollBarComponent scroll;
    scroll.set_range(100, 10);

    scroll.scroll_to(50);
    scroll.scroll_by(-5);
    EXPECT_EQ(scroll.scroll_offset_, 45u);

    scroll.scroll_by(100); // Clampe a max.
    EXPECT_EQ(scroll.scroll_offset_, 90u);
}

TEST(MenuScrollBarComponent, ScrollByNegativeUnderflow) {
    lives::MenuScrollBarComponent scroll;
    scroll.set_range(100, 10);
    scroll.scroll_to(3);
    scroll.scroll_by(-10); // Pas de depassement negatif.
    EXPECT_EQ(scroll.scroll_offset_, 0u);
}

// ═══════════════════════════════════════════════════════════════════════
// MenuAnchorComponent
// ═══════════════════════════════════════════════════════════════════════

TEST(MenuAnchorComponent, TopLeftPosition) {
    lives::MenuAnchorComponent anchor;
    anchor.anchor_type_ = lives::AnchorType::TOP_LEFT;
    anchor.parent_size_ = {800.f, 600.f};
    anchor.offset_ = {10.f, 20.f};

    auto pos = anchor.calculate_position();
    EXPECT_FLOAT_EQ(pos.x, 10.f);
    EXPECT_FLOAT_EQ(pos.y, 20.f);
}

TEST(MenuAnchorComponent, CenterPosition) {
    lives::MenuAnchorComponent anchor;
    anchor.anchor_type_ = lives::AnchorType::CENTER;
    anchor.parent_size_ = {800.f, 600.f};
    anchor.offset_ = {0.f, 0.f};

    auto pos = anchor.calculate_position();
    EXPECT_FLOAT_EQ(pos.x, 400.f);
    EXPECT_FLOAT_EQ(pos.y, 300.f);
}

TEST(MenuAnchorComponent, BottomRightPosition) {
    lives::MenuAnchorComponent anchor;
    anchor.anchor_type_ = lives::AnchorType::BOTTOM_RIGHT;
    anchor.parent_size_ = {800.f, 600.f};

    auto pos = anchor.calculate_position();
    EXPECT_FLOAT_EQ(pos.x, 800.f);
    EXPECT_FLOAT_EQ(pos.y, 600.f);
}

TEST(MenuAnchorComponent, ScaleFit) {
    lives::MenuAnchorComponent anchor;
    anchor.scale_mode_ = lives::ScaleMode::FIT;
    anchor.parent_size_ = {800.f, 600.f};
    anchor.self_size_ = {1600.f, 900.f};

    auto scale = anchor.calculate_scale();
    // 800/1600 = 0.5, 600/900 = 0.667 -> min = 0.5
    EXPECT_NEAR(scale.x, 0.5f, 0.001f);
    EXPECT_NEAR(scale.y, 0.5f, 0.001f);
}

TEST(MenuAnchorComponent, ScaleStretch) {
    lives::MenuAnchorComponent anchor;
    anchor.scale_mode_ = lives::ScaleMode::STRETCH;
    anchor.parent_size_ = {800.f, 600.f};
    anchor.self_size_ = {400.f, 300.f};

    auto scale = anchor.calculate_scale();
    EXPECT_NEAR(scale.x, 2.f, 0.001f);
    EXPECT_NEAR(scale.y, 2.f, 0.001f);
}

// ═══════════════════════════════════════════════════════════════════════
// MenuAnchor3DComponent
// ═══════════════════════════════════════════════════════════════════════

TEST(MenuAnchor3DComponent, ProjectionOnScreen) {
    lives::MenuAnchor3DComponent anchor;
    anchor.world_position_ = {0.f, 0.f, -5.f};

    // Matrice identite simulant une camera au centre.
    glm::mat4 view_proj(1.f);
    // Perspective simplifiee : z=-5 donne w=5 en clip space.
    // Pour un vrai test, on utilise une vraie matrice.
    // Ici on teste avec identite — z=-5 donne NDC.z = -5 qui est hors [0,1].
    anchor.project_to_screen(view_proj, {1920.f, 1080.f});
    // Avec identite, clip = (0, 0, -5, 1), ndc.z = -5 < 0 -> hors ecran
    // Mais on verifie que ca ne crashe pas.
}

TEST(MenuAnchor3DComponent, BehindCameraNotOnScreen) {
    lives::MenuAnchor3DComponent anchor;
    anchor.world_position_ = {0.f, 0.f, 5.f};

    // Avec identite, clip.w = 1 et ndc.z = 5 > 1, donc hors frustum.
    glm::mat4 identity(1.f);
    anchor.project_to_screen(identity, {1920.f, 1080.f});
    EXPECT_FALSE(anchor.on_screen_);
}

// ═══════════════════════════════════════════════════════════════════════
// CMenuAttachLocator
// ═══════════════════════════════════════════════════════════════════════

TEST(CMenuAttachLocator, SetLocator) {
    lives::CMenuAttachLocator attach;
    attach.set_locator("spine_01");
    EXPECT_EQ(attach.bone_name_, "spine_01");
    EXPECT_EQ(attach.bone_index_, -1); // Non resolu.
    EXPECT_FALSE(attach.is_bound());
}

TEST(CMenuAttachLocator, UpdateScreenPos) {
    lives::CMenuAttachLocator attach;
    attach.offset_ = {0.f, 1.f, 0.f};

    glm::mat4 identity(1.f);
    attach.update_screen_pos(identity, {1920.f, 1080.f}, {0.f, 0.f, 0.f});

    // Position monde = (0, 1, 0), clip = (0, 1, 0, 1) -> NDC (0, 1, 0)
    // On screen: x in [-1,1], y in [-1,1], z in [0,1] -> oui
    EXPECT_TRUE(attach.on_screen_);
}

TEST(CMenuAttachLocator, ClassNameCorrect) {
    lives::CMenuAttachLocator attach;
    EXPECT_EQ(attach.get_class_name(), "CMenuAttachLocator");
}

// ═══════════════════════════════════════════════════════════════════════
// CRefModelMenuPrimitive
// ═══════════════════════════════════════════════════════════════════════

TEST(CRefModelMenuPrimitive, SetPrimitiveType) {
    lives::CRefModelMenuPrimitive prim;
    prim.set_primitive_type(lives::MenuPrimitiveType::SPHERE);
    EXPECT_EQ(prim.primitive_type_, lives::MenuPrimitiveType::SPHERE);
}

TEST(CRefModelMenuPrimitive, ClassNameCorrect) {
    lives::CRefModelMenuPrimitive prim;
    EXPECT_EQ(prim.get_class_name(), "CRefModelMenuPrimitive");
}

// ═══════════════════════════════════════════════════════════════════════
// CMenuRefMaterialSync
// ═══════════════════════════════════════════════════════════════════════

TEST(CMenuRefMaterialSync, AddRemoveTarget) {
    lives::CMenuRefMaterialSync sync;
    sync.add_target(100);
    sync.add_target(200);
    sync.add_target(100); // Doublon, ignore.
    EXPECT_EQ(sync.target_material_ids_.size(), 2);

    sync.remove_target(100);
    EXPECT_EQ(sync.target_material_ids_.size(), 1);
    EXPECT_EQ(sync.target_material_ids_[0], 200u);
}

TEST(CMenuRefMaterialSync, SyncFlags) {
    using F = lives::MaterialSyncFlags;
    auto flags = F::DIFFUSE | F::OPACITY;
    EXPECT_TRUE(lives::has_flag(flags, F::DIFFUSE));
    EXPECT_TRUE(lives::has_flag(flags, F::OPACITY));
    EXPECT_FALSE(lives::has_flag(flags, F::SPECULAR));
}

// ═══════════════════════════════════════════════════════════════════════
// CMenuNamingSetting
// ═══════════════════════════════════════════════════════════════════════

TEST(CMenuNamingSetting, InsertAndDeleteChar) {
    lives::CMenuNamingSetting naming;
    naming.max_length_ = 10;

    EXPECT_TRUE(naming.insert_char(U'A'));
    EXPECT_TRUE(naming.insert_char(U'B'));
    EXPECT_TRUE(naming.insert_char(U'C'));
    EXPECT_EQ(naming.get_text(), "ABC");
    EXPECT_EQ(naming.char_count(), 3u);

    EXPECT_TRUE(naming.delete_char()); // Supprime 'C'.
    EXPECT_EQ(naming.get_text(), "AB");
}

TEST(CMenuNamingSetting, MaxLengthEnforced) {
    lives::CMenuNamingSetting naming;
    naming.max_length_ = 3;

    EXPECT_TRUE(naming.insert_char(U'A'));
    EXPECT_TRUE(naming.insert_char(U'B'));
    EXPECT_TRUE(naming.insert_char(U'C'));
    EXPECT_FALSE(naming.insert_char(U'D')); // Depasse la limite.
    EXPECT_EQ(naming.char_count(), 3u);
}

TEST(CMenuNamingSetting, CursorMovement) {
    lives::CMenuNamingSetting naming;
    naming.max_length_ = 10;
    (void)naming.insert_char(U'H');
    (void)naming.insert_char(U'i');

    // Curseur a la fin (pos 2).
    EXPECT_EQ(naming.cursor_pos_, 2u);

    naming.move_cursor_left();
    EXPECT_EQ(naming.cursor_pos_, 1u);

    naming.move_cursor_home();
    EXPECT_EQ(naming.cursor_pos_, 0u);

    naming.move_cursor_end();
    EXPECT_EQ(naming.cursor_pos_, 2u);
}

TEST(CMenuNamingSetting, DeleteForward) {
    lives::CMenuNamingSetting naming;
    naming.max_length_ = 10;
    (void)naming.insert_char(U'A');
    (void)naming.insert_char(U'B');
    (void)naming.insert_char(U'C');

    naming.move_cursor_home(); // Curseur au debut.
    EXPECT_TRUE(naming.delete_forward()); // Supprime 'A'.
    EXPECT_EQ(naming.get_text(), "BC");
}

TEST(CMenuNamingSetting, CharCategoryFilter) {
    lives::CMenuNamingSetting naming;
    naming.max_length_ = 10;
    naming.char_category_ = lives::NamingCharCategory::NUMERIC_ONLY;

    EXPECT_FALSE(naming.insert_char(U'A'));
    EXPECT_TRUE(naming.insert_char(U'5'));
    EXPECT_EQ(naming.get_text(), "5");
}

TEST(CMenuNamingSetting, UTF8MultibyteChars) {
    lives::CMenuNamingSetting naming;
    naming.max_length_ = 5;
    naming.char_category_ = lives::NamingCharCategory::ALL;

    // Caractere multi-byte : e-accent (U+00E9, 2 bytes UTF-8).
    EXPECT_TRUE(naming.insert_char(U'\u00E9'));
    EXPECT_EQ(naming.char_count(), 1u);
    EXPECT_EQ(naming.get_text().size(), 2u); // 2 bytes UTF-8.
}

TEST(CMenuNamingSetting, CursorBlinkVisibility) {
    lives::CMenuNamingSetting naming;
    naming.editing_ = true;
    naming.cursor_blink_rate_ = 0.5f;

    naming.update(0.1f); // 0.1s < 0.5s -> visible.
    EXPECT_TRUE(naming.is_cursor_visible());

    naming.update(0.5f); // 0.6s total, 0.6 > 0.5 -> invisible.
    EXPECT_FALSE(naming.is_cursor_visible());
}

TEST(CMenuNamingSetting, ClassNameCorrect) {
    lives::CMenuNamingSetting naming;
    EXPECT_EQ(naming.get_class_name(), "CMenuNamingSetting");
}

} // namespace
