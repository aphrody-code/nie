#!/usr/bin/env bash
# Construit le mod « Victory Road » : bascule hors des paquets les 23 fichiers que le jeu
# possède pour ce mode, afin qu'il les charge depuis le disque et qu'ils deviennent éditables.
#
# ── Ce que ce mod fait, et ce qu'il ne fait PAS ──────────────────────────────────────────────
#
# Il SORT les fichiers du mode de leurs CPK. C'est le préalable à toute modification : tant
# qu'un fichier est dans un paquet, on ne peut pas l'éditer sans repacker.
#
# Il ne rend PAS le mode jouable, et aucun mod de données ne le pourrait, pour une raison
# mesurée trois fois par des chemins indépendants :
#
#   1. `niers mode index` -> victory-road est le SEUL mode à g4tx = 0. Aucune texture propre ;
#      ses objbin vivent sous `soccer99_*`, un dossier qui n'en contient aucune.
#   2. `mode_text` -> 0 libellé d'interface résolu, là où kizuna-station en a 17 et team-dock 13.
#   3. Ses écrans s'appellent `fake_vroad_entry_menu`, `fake_vroad_qualifier`,
#      `soccer99_44_final_vroad_ranking_fake` — le mot est dans les noms d'origine.
#
# Autrement dit : les écrans existent (4, dont `victory_load_mode_menu` avec ses 7 calques et
# 11 commandes) mais leur habillage n'est pas dans les fichiers installés. Rendre l'écran
# atteignable afficherait une coquille. Le contenu réel arrive côté serveur — ce que confirme
# l'absence totale d'écrans `lobby`, `ranked`, `bot_match` et `competition` dans le VFS, alors
# que `menu_text` les nomme.
#
# Usage : scripts/build-mod-victory-road.sh [racine-du-jeu]
set -euo pipefail

RACINE="${1:-$PWD}"
NIERS="${NIERS:-$RACINE/target/release/niers}"
MOD="$RACINE/data/mods/victory-road"
DIST="$RACINE/data/mods/victory-road-dist"

[ -x "$NIERS" ] || { echo "niers introuvable : $NIERS (cargo build --release -p nie-cli)" >&2; exit 1; }
export NIE_GAME_DIR="$RACINE"

echo "→ collecte des fichiers du mode"
rm -rf "$MOD" "$DIST"
mkdir -p "$MOD"

# Les assets du mode vivent sous TROIS orthographes : `vroad`, `victory_load` et `victory_lode`
# (translittérations de ロード), plus `victoryroad` pour la bannière. Chercher un seul de ces
# motifs en manque les deux tiers.
for motif in vroad victory_load victory_lode victoryroad; do
	"$NIERS" vfs find "$motif" -n 200 2>/dev/null | awk '{print $2}' | grep -E '^data/' || true
done | sort -u | while read -r f; do
	mkdir -p "$MOD/$(dirname "$f")"
	"$NIERS" vfs extract "$f" -o "$MOD/$f" >/dev/null
done

echo "→ $(find "$MOD" -type f | wc -l) fichiers collectés"
echo "→ bascule hors des paquets"
"$NIERS" viola pack --mod-dir "$MOD" -o "$DIST"

echo
echo "Mod prêt : $DIST"
echo "Il contient les fichiers + un cpk_list.cfg.bin réécrit. Copier son contenu sur"
echo "l'installation du jeu pour que celui-ci charge ces fichiers depuis le disque."
