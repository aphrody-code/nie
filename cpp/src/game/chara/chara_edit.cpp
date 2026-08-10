/// @file chara_edit.cpp
/// Implementation de CCharaEditParam et CCharaEditVariableParam.
/// Parametres d'edition de personnage — parties du corps, couleurs, echelles.

#include "iecode/game/chara/chara_edit.h"

#include <spdlog/spdlog.h>

namespace game {

// ── Fonctions utilitaires pour CCharaEditParam ─────────────────────

/// Recupere une partie editable par type.
/// @return Pointeur vers la partie, ou nullptr si le type est invalide.
[[nodiscard]] CharaEditPart* get_edit_part(
    CCharaEditParam& param, CharaEditPartType type)
{
    const auto index = static_cast<uint8_t>(type);
    if (index >= param.parts.size()) {
        return nullptr;
    }
    return &param.parts[index];
}

/// Recupere une partie editable par type (const).
[[nodiscard]] const CharaEditPart* get_edit_part(
    const CCharaEditParam& param, CharaEditPartType type)
{
    const auto index = static_cast<uint8_t>(type);
    if (index >= param.parts.size()) {
        return nullptr;
    }
    return &param.parts[index];
}

/// Change l'ID du modele d'une partie editable.
/// @return true si le changement a ete applique.
[[nodiscard]] bool set_part_model(
    CCharaEditParam& param, CharaEditPartType type, uint32_t model_id)
{
    auto* part = get_edit_part(param, type);
    if (!part) {
        spdlog::warn("set_part_model: type {} invalide", static_cast<int>(type));
        return false;
    }
    part->id = model_id;
    return true;
}

/// Change la couleur d'une partie editable.
/// @return true si le changement a ete applique.
[[nodiscard]] bool set_part_color(
    CCharaEditParam& param, CharaEditPartType type, CharaEditColor color)
{
    auto* part = get_edit_part(param, type);
    if (!part) {
        spdlog::warn("set_part_color: type {} invalide", static_cast<int>(type));
        return false;
    }
    part->color = color;
    return true;
}

/// Remet toutes les parties a leurs valeurs par defaut.
void reset_edit_param(CCharaEditParam& param) {
    for (auto& part : param.parts) {
        part.id    = 0;
        part.color = {};
        part.scale = 1.f;
    }
    param.height_scale = 1.f;
    param.body_scale   = 1.f;
    spdlog::debug("reset_edit_param: chara {} reinitialise", param.chara_id);
}

/// Applique les modifications variables en cours d'edition au parametre principal.
void apply_variable_param(
    CCharaEditParam& param, const CCharaEditVariableParam& variable)
{
    if (!variable.is_dirty) {
        return;
    }

    if (variable.editing_part_index < param.parts.size()) {
        auto& part  = param.parts[variable.editing_part_index];
        part.color  = variable.current_color;
        part.scale  = variable.current_scale;
    }
}

} // namespace game
