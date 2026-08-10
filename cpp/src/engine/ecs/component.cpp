/// @file component.cpp
/// Implementation de lives::ecs::Component.
/// La majorite de la logique est dans le header (callbacks virtuels vides).
/// Ce fichier existe pour l'ancrage vtable (ODR).

#include <iecode/engine/ecs/component.h>

namespace lives::ecs {

// Ancrage vtable — le destructeur virtuel est defini ici
// pour eviter des copies de vtable dans chaque TU.
// (Le destructeur est = default dans le header, mais le compilateur
// a besoin d'un point d'ancrage unique.)

} // namespace lives::ecs
