#pragma once

/// @file soccer_state_machine.h
/// CSoccerStateMachine — machine a etats du moteur de match soccer.
/// Classe RTTI : game::CSoccerStateMachine.
/// Decompile dans soccer_match_state_machine.c.

#include <cstdint>
#include <string_view>

namespace game {

/// Etats de la machine a etats soccer.
enum class SoccerPhase : uint32_t {
    Idle        = 0,
    KickOff     = 1,
    InPlay      = 2,
    SetPlay     = 3,
    Goal        = 4,
    HalfTime    = 5,
    FullTime    = 6,
    Penalty     = 7,
    FocusBattle = 8,
    Command     = 9,
    Tutorial    = 10,
};

/// Retourne le nom lisible d'un SoccerPhase.
[[nodiscard]] constexpr std::string_view soccer_phase_name(SoccerPhase phase) {
    switch (phase) {
    case SoccerPhase::Idle:        return "Idle";
    case SoccerPhase::KickOff:     return "KickOff";
    case SoccerPhase::InPlay:      return "InPlay";
    case SoccerPhase::SetPlay:     return "SetPlay";
    case SoccerPhase::Goal:        return "Goal";
    case SoccerPhase::HalfTime:    return "HalfTime";
    case SoccerPhase::FullTime:    return "FullTime";
    case SoccerPhase::Penalty:     return "Penalty";
    case SoccerPhase::FocusBattle: return "FocusBattle";
    case SoccerPhase::Command:     return "Command";
    case SoccerPhase::Tutorial:    return "Tutorial";
    }
    return "Unknown";
}

/// Duree d'une mi-temps en secondes (par defaut).
inline constexpr float DEFAULT_HALF_DURATION = 300.f;

/// Nombre de mi-temps.
inline constexpr int HALF_COUNT = 2;

/// Machine a etats du match soccer.
/// Gere les transitions entre les phases du match.
/// Encodage score : minutes * 10000 + secondes.
struct CSoccerStateMachine {
    SoccerPhase current_phase_ = SoccerPhase::Idle;
    SoccerPhase prev_phase_    = SoccerPhase::Idle;
    float       phase_timer_   = 0.f;
    int         score_home_    = 0;
    int         score_away_    = 0;
    int         half_          = 1;     // 1 ou 2
    float       match_time_    = 0.f;   // Temps de match en secondes
    float       half_duration_ = DEFAULT_HALF_DURATION; // Duree d'une mi-temps

    /// Effectue une transition vers un nouvel etat.
    void transition(SoccerPhase next);

    /// Met a jour le timer de la phase courante et le temps de match.
    /// Gere automatiquement la transition mi-temps / fin de match.
    void update(float dt);

    /// Enregistre un but pour une equipe (0 = domicile, 1 = exterieur).
    void score_goal(uint32_t team_index);

    /// Encode le temps de match au format nie.exe : minutes * 10000 + secondes.
    [[nodiscard]] int encode_time() const;

    /// Verifie si le jeu est en cours.
    [[nodiscard]] bool is_in_play() const { return current_phase_ == SoccerPhase::InPlay; }

    /// Verifie si le match est termine.
    [[nodiscard]] bool is_finished() const { return current_phase_ == SoccerPhase::FullTime; }

    /// Verifie si on est en phase de combat/technique speciale.
    [[nodiscard]] bool is_in_battle() const { return current_phase_ == SoccerPhase::FocusBattle; }

    /// Verifie si une transition est valide depuis la phase courante.
    [[nodiscard]] bool can_transition_to(SoccerPhase next) const;

    /// Reinitialise la machine pour un nouveau match.
    void reset();
};

} // namespace game
