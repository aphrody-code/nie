/// @file res_base.cpp
/// Base des ressources du moteur Level-5 (lives::CResBase).
/// State machine : UNLOADED -> LOADING -> LOADED | FAILED.

#include "iecode/engine/res/res_base.h"

namespace lives {

/// Incremente le ref-count d'une ressource et retourne sa nouvelle valeur.
uint32_t res_addref(CResBase& res) noexcept {
    return ++res.res_ref_count_;
}

/// Decremente le ref-count. Retourne la nouvelle valeur. 0 = eligible a la liberation.
uint32_t res_release(CResBase& res) noexcept {
    if (res.res_ref_count_ == 0) return 0;
    return --res.res_ref_count_;
}

/// Transitionne la ressource vers l'etat LOADING.
void res_begin_load(CResBase& res) noexcept {
    res.state_ = ResState::LOADING;
}

/// Marque la ressource comme chargee avec succes.
void res_end_load(CResBase& res, bool success) noexcept {
    res.state_ = success ? ResState::LOADED : ResState::FAILED;
}

} // namespace lives
