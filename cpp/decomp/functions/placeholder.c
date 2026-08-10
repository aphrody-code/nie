/**
 * @file placeholder.c
 * Fichier placeholder pour que le glob CMake trouve au moins un .c
 * dans decomp/functions/. A supprimer une fois les vrais fichiers
 * decompiles ajoutes.
 *
 * Pour ajouter une fonction decompiless :
 * 1. Exporter depuis Ghidra (File > Export > C/C++)
 * 2. Copier le .c ici (ex: FUN_1401c1430_rdbn_parser.c)
 * 3. Ajouter #include "decomp/compat.h" en tete pour les typedefs
 * 4. Creer un wrapper C++ dans decomp/src/bridge.cpp
 */

#include "decomp/compat.h"

/* Fonction vide pour eviter l'erreur "no symbols" a l'edition de liens */
void _decomp_placeholder(void) {
    (void)0;
}
