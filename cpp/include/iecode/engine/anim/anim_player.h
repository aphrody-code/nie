#pragma once

/// @file anim_player.h
/// Player d'animation squelettique — clips TRS par bone + lecture temporelle.
///
/// Abstraction iecode. La vraie classe nie.exe est `lives::gmdCAnimation`
/// (struct de 0x5058 bytes avec slots de cross-fade a +0x25DC et +0x5038).
/// Notre `AnimPlayer` est une simplification qui ne modelise pas encore
/// le cross-fade multi-slots.
///
/// Les clips peuvent etre crees depuis un G4RA (archive qui contient en
/// realite des track groups avec le FourCC `G4MT` = `0x544d3447`) ou
/// construits manuellement par code (tests, editeur).

#include "iecode/formats/level5/g4ra.h"
#include "iecode/formats/level5/agi.h"

#include <glm/glm.hpp>
#include <glm/gtc/quaternion.hpp>

#include <cstdint>
#include <optional>
#include <span>
#include <vector>

namespace lives {

/// Piste TRS pour un os — listes paralleles (times, positions, rotations, scales).
/// Les trois tableaux TRS doivent avoir la meme taille que `times`.
/// Un tableau TRS peut etre vide : la composante correspondante est alors
/// consideree comme identite (t=0, r=identity, s=1).
struct AnimTrack {
    uint32_t bone_index = 0;
    std::vector<float>     times;      ///< Keyframes triees ascendant (secondes)
    std::vector<glm::vec3> positions;  ///< Translation locale
    std::vector<glm::quat> rotations;  ///< Quaternion local (xyzw)
    std::vector<glm::vec3> scales;     ///< Scale local
};

/// Clip d'animation — ensemble de pistes pour un squelette donne.
struct AnimClip {
    float duration = 0.f;           ///< Duree totale en secondes
    float fps      = 30.f;          ///< Frames par seconde (indicatif)
    std::vector<AnimTrack> tracks;

    /// FourCC des track groups d'animation a l'interieur d'un G4RA.
    /// Litteral `'G4MT'` en big-endian = `0x544d3447` en little-endian.
    static constexpr uint32_t kG4mtFourCc = 0x544d3447U;

    /// Cree un clip depuis un G4RA. L'implementation doit chercher les
    /// chunks portant le FourCC `G4MT` (`kG4mtFourCc`) — et non le magic
    /// G4RA lui-meme — pour extraire les track groups. Retourne nullopt
    /// tant que le format des keyframes Level-5 n'est pas reverse.
    [[nodiscard]] static std::optional<AnimClip> from_g4ra(
        const iecode::level5::G4raFile& ra);

    /// Cree un clip depuis un fichier AGI parse. Le format detaille des
    /// keyframes par bone n'est pas encore entierement reverse — pour
    /// l'instant on extrait `duration` et `track_count` du header AGI et
    /// on fournit un clip "stub" avec une seule keyframe identite par track.
    /// Quand le parser AGI sera complet, cette fonction lira les vraies
    /// pistes TRS.
    [[nodiscard]] static std::optional<AnimClip> from_agi(
        const iecode::level5::AgiFile& agi);
};

/// Lecteur d'animation — maintient un temps courant et interpole les pistes.
/// Non-owning : le clip pointe doit survivre au player.
class AnimPlayer {
public:
    AnimPlayer() = default;

    /// Attache un clip (ne copie pas). Reset le temps a 0.
    void set_clip(const AnimClip* clip) noexcept;

    /// Active/desactive le bouclage (par defaut true).
    void set_loop(bool loop) noexcept { loop_ = loop; }

    /// Fait avancer le temps interne de `dt` secondes.
    void update(float dt) noexcept;

    /// Remet le temps a 0.
    void reset() noexcept { time_ = 0.f; }

    /// Temps courant (secondes).
    [[nodiscard]] float time() const noexcept { return time_; }

    /// Clip attache (peut etre null).
    [[nodiscard]] const AnimClip* clip() const noexcept { return clip_; }

    /// Indique si la lecture est terminee (seulement pertinent si !loop_).
    [[nodiscard]] bool is_done() const noexcept;

    /// Retourne la transform locale (TRS -> mat4) pour un os donne au
    /// temps courant. Si aucun track ne correspond, retourne l'identite.
    [[nodiscard]] glm::mat4 get_bone_transform(uint32_t bone_index) const noexcept;

    /// Remplit un buffer de transforms pour les bones [0, count).
    /// Les os sans track recoivent l'identite.
    void get_bone_transforms(std::span<glm::mat4> out) const noexcept;

private:
    const AnimClip* clip_ = nullptr;
    float time_ = 0.f;
    bool  loop_ = true;
};

} // namespace lives
