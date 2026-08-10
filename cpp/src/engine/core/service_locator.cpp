/// @file service_locator.cpp
/// ServiceLocator : registre global de services type-safe.
/// Toutes les methodes sont template-inline dans le header ; ce fichier
/// existe pour fournir une unite de traduction stable et documenter
/// l'intention runtime du systeme.

#include "iecode/engine/core/service_locator.h"

namespace lives {

// Les membres statiques (services_) sont inline dans le header.
// Ce TU permet d'assurer une instanciation unique cote edition de liens
// et sert de point d'ancrage pour d'eventuelles extensions non-template.

} // namespace lives
