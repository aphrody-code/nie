#pragma once

/// @file debug_draw.h
/// Utilitaires de dessin de debug (lignes, AABB, grille, axes).
/// Requiert un programme de shader vertex-color pour le rendu.

#include <cstdint>
#include <bgfx/bgfx.h>
#include <glm/vec3.hpp>

namespace lives {

/// Dessin de debug — primitives geometriques simples via bgfx.
///
/// Avant utilisation, appeler init() avec un programme de shader
/// vertex-color (position + color pass-through). Sans init(), les
/// appels de dessin sont silencieusement ignores.
///
/// Toutes les methodes sont statiques et soumettent directement
/// des vertices transients au view_id specifie.
/// Couleurs au format ABGR (convention bgfx).
class DebugDraw {
public:
    DebugDraw() = delete;

    /// Initialise avec un programme de shader vertex-color.
    /// Le programme est possede par DebugDraw et detruit dans shutdown().
    static void init(bgfx::ProgramHandle program);

    /// Libere le programme de shader.
    static void shutdown();

    /// Trace une ligne entre deux points.
    static void line(const glm::vec3& from, const glm::vec3& to,
                     uint32_t abgr_color, uint16_t view_id);

    /// Trace un AABB (wireframe — 12 aretes).
    static void aabb(const glm::vec3& min_pt, const glm::vec3& max_pt,
                     uint32_t abgr_color, uint16_t view_id);

    /// Trace une grille sur le plan XZ.
    /// @param size  Etendue de la grille (-size a +size).
    /// @param step  Espacement entre les lignes.
    static void grid(float size, float step,
                     uint32_t abgr_color, uint16_t view_id);

    /// Trace un repere d'axes (X=rouge, Y=vert, Z=bleu).
    /// @param origin  Centre du repere.
    /// @param length  Longueur de chaque axe.
    static void axis(const glm::vec3& origin, float length, uint16_t view_id);
};

} // namespace lives
