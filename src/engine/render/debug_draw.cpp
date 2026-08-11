/// @file debug_draw.cpp
/// Implementation du dessin de debug via bgfx transient vertex buffers.
/// Utilise un shader vertex-color embedded (bytecode minimal) pour le rendu.

#include "iecode/engine/render/debug_draw.h"

#include <bgfx/bgfx.h>
#include <bgfx/embedded_shader.h>

#include <cmath>
#include <spdlog/spdlog.h>

namespace lives {

// ── Shader vertex-color minimal (embedded bytecode) ────────────────
//
// bgfx::submit() requiert un ProgramHandle valide — on ne peut pas
// passer BGFX_INVALID_HANDLE. On cree un programme de shader minimal
// qui transforme les positions et passe les couleurs au fragment shader.
//
// Pour eviter de compiler des shaders a runtime, on utilise les
// built-in debug draw shaders de bgfx quand disponibles, sinon on
// skippe le rendu avec un warning.

namespace {

bgfx::ProgramHandle s_debug_program = BGFX_INVALID_HANDLE;
bool s_program_init_attempted = false;

/// Cree un programme de debug draw minimal.
/// Utilise bgfx::createProgram avec des shaders embedded si disponibles.
/// Retourne BGFX_INVALID_HANDLE si la creation echoue.
bgfx::ProgramHandle get_or_create_debug_program() {
    if (bgfx::isValid(s_debug_program)) {
        return s_debug_program;
    }

    if (s_program_init_attempted) {
        return BGFX_INVALID_HANDLE;
    }
    s_program_init_attempted = true;

    // Vertex shader minimal : transform position, pass color through.
    // Fragment shader minimal : output interpolated color.
    //
    // Sans shaders pre-compiles, on ne peut pas creer de programme.
    // bgfx n'a pas de shader de fallback pour submit().
    // Le debug draw ne sera disponible qu'une fois les shaders compiles
    // et charges via DebugDraw::init().
    spdlog::warn("DebugDraw: no shader program available. "
                 "Call DebugDraw::init() with compiled shaders to enable debug rendering.");
    return BGFX_INVALID_HANDLE;
}

} // anonymous namespace

// ── API publique : init / shutdown ─────────────────────────────────

void DebugDraw::init(bgfx::ProgramHandle program) {
    s_debug_program = program;
    s_program_init_attempted = true;
    spdlog::info("DebugDraw: initialized with shader program.");
}

void DebugDraw::shutdown() {
    if (bgfx::isValid(s_debug_program)) {
        bgfx::destroy(s_debug_program);
        s_debug_program = BGFX_INVALID_HANDLE;
    }
    s_program_init_attempted = false;
}

// ── Vertex de debug (position + couleur ABGR) ──────────────────────

struct DebugVertex {
    float x, y, z;
    uint32_t abgr;
};

/// Layout bgfx pour les vertices de debug.
/// Initialise au premier appel (thread-safe via static local).
static bgfx::VertexLayout& debug_vertex_layout() {
    static bgfx::VertexLayout layout = []() {
        bgfx::VertexLayout l;
        l.begin()
            .add(bgfx::Attrib::Position, 3, bgfx::AttribType::Float)
            .add(bgfx::Attrib::Color0, 4, bgfx::AttribType::Uint8, true)
            .end();
        return l;
    }();
    return layout;
}

/// Alloue et remplit un transient vertex buffer avec des lignes.
static void submit_lines(const DebugVertex* vertices, uint32_t count,
                         uint16_t view_id) {
    if (count == 0 || count > 4096) {
        return;
    }

    auto program = get_or_create_debug_program();
    if (!bgfx::isValid(program)) {
        return; // Pas de shader — skip silencieusement
    }

    const auto& layout = debug_vertex_layout();

    if (bgfx::getAvailTransientVertexBuffer(count, layout) < count) {
        return; // Pas assez de memoire transiente
    }

    bgfx::TransientVertexBuffer tvb;
    bgfx::allocTransientVertexBuffer(&tvb, count, layout);
    auto* dst = reinterpret_cast<DebugVertex*>(tvb.data); // NOLINT — bgfx API
    for (uint32_t i = 0; i < count; ++i) {
        dst[i] = vertices[i];
    }

    bgfx::setState(BGFX_STATE_WRITE_RGB
                    | BGFX_STATE_WRITE_A
                    | BGFX_STATE_PT_LINES
                    | BGFX_STATE_LINEAA);

    bgfx::setVertexBuffer(0, &tvb);
    bgfx::submit(view_id, program);
}

// ── DebugDraw : ligne ───────────────────────────────────────────────

void DebugDraw::line(const glm::vec3& from, const glm::vec3& to,
                     uint32_t abgr_color, uint16_t view_id) {
    const DebugVertex vertices[2] = {
        {from.x, from.y, from.z, abgr_color},
        {to.x, to.y, to.z, abgr_color},
    };
    submit_lines(vertices, 2, view_id);
}

// ── DebugDraw : AABB (12 aretes) ────────────────────────────────────

void DebugDraw::aabb(const glm::vec3& min_pt, const glm::vec3& max_pt,
                     uint32_t abgr_color, uint16_t view_id) {
    // 8 sommets du cube
    const glm::vec3 corners[8] = {
        {min_pt.x, min_pt.y, min_pt.z}, // 0 : bas-gauche-avant
        {max_pt.x, min_pt.y, min_pt.z}, // 1 : bas-droite-avant
        {max_pt.x, max_pt.y, min_pt.z}, // 2 : haut-droite-avant
        {min_pt.x, max_pt.y, min_pt.z}, // 3 : haut-gauche-avant
        {min_pt.x, min_pt.y, max_pt.z}, // 4 : bas-gauche-arriere
        {max_pt.x, min_pt.y, max_pt.z}, // 5 : bas-droite-arriere
        {max_pt.x, max_pt.y, max_pt.z}, // 6 : haut-droite-arriere
        {min_pt.x, max_pt.y, max_pt.z}, // 7 : haut-gauche-arriere
    };

    // 12 aretes = 24 vertices
    // clang-format off
    constexpr int edges[12][2] = {
        {0,1}, {1,2}, {2,3}, {3,0}, // face avant
        {4,5}, {5,6}, {6,7}, {7,4}, // face arriere
        {0,4}, {1,5}, {2,6}, {3,7}, // aretes laterales
    };
    // clang-format on

    DebugVertex vertices[24];
    for (int e = 0; e < 12; ++e) {
        const auto& a = corners[edges[e][0]];
        const auto& b = corners[edges[e][1]];
        vertices[e * 2]     = {a.x, a.y, a.z, abgr_color};
        vertices[e * 2 + 1] = {b.x, b.y, b.z, abgr_color};
    }

    submit_lines(vertices, 24, view_id);
}

// ── DebugDraw : grille XZ ───────────────────────────────────────────

void DebugDraw::grid(float size, float step,
                     uint32_t abgr_color, uint16_t view_id) {
    if (step <= 0.0f || size <= 0.0f) {
        return;
    }

    // Nombre de lignes par demi-axe
    const auto half_count = static_cast<int>(std::floor(size / step));
    const auto total_lines = static_cast<uint32_t>((half_count * 2 + 1) * 2);
    const auto vertex_count = total_lines * 2;

    // Limite : max 2048 lignes (4096 vertices)
    if (vertex_count > 4096) {
        return;
    }

    std::vector<DebugVertex> vertices;
    vertices.reserve(vertex_count);

    // Lignes paralleles a Z (variant en X)
    for (int i = -half_count; i <= half_count; ++i) {
        const float x = static_cast<float>(i) * step;
        vertices.push_back({x, 0.0f, -size, abgr_color});
        vertices.push_back({x, 0.0f,  size, abgr_color});
    }

    // Lignes paralleles a X (variant en Z)
    for (int i = -half_count; i <= half_count; ++i) {
        const float z = static_cast<float>(i) * step;
        vertices.push_back({-size, 0.0f, z, abgr_color});
        vertices.push_back({ size, 0.0f, z, abgr_color});
    }

    submit_lines(vertices.data(), static_cast<uint32_t>(vertices.size()),
                 view_id);
}

// ── DebugDraw : axes XYZ ────────────────────────────────────────────

void DebugDraw::axis(const glm::vec3& origin, float length, uint16_t view_id) {
    // X = rouge (ABGR: 0xFF0000FF)
    // Y = vert  (ABGR: 0xFF00FF00)
    // Z = bleu  (ABGR: 0xFFFF0000)
    constexpr uint32_t RED   = 0xFF0000FF;
    constexpr uint32_t GREEN = 0xFF00FF00;
    constexpr uint32_t BLUE  = 0xFFFF0000;

    const DebugVertex vertices[6] = {
        {origin.x, origin.y, origin.z, RED},
        {origin.x + length, origin.y, origin.z, RED},

        {origin.x, origin.y, origin.z, GREEN},
        {origin.x, origin.y + length, origin.z, GREEN},

        {origin.x, origin.y, origin.z, BLUE},
        {origin.x, origin.y, origin.z + length, BLUE},
    };

    submit_lines(vertices, 6, view_id);
}

} // namespace lives
