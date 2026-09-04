#!/usr/bin/env bash
# Chaîne de bout en bout les données du jeu, en n'appelant QUE les commandes publiées dans le PATH
# (`just installer`) et les CLI des paquets — jamais `./target/release/...` ni `bun run` en dur.
#
# Pourquoi le PATH : un chemin `target/release/x` en dur est faux dès qu'on lance le script d'un
# autre répertoire, et il masque le fait qu'une commande n'a jamais été publiée. Le PATH échoue
# franchement, tout de suite, avec le nom manquant.
#
# Usage : bash scripts/pipeline-donnees.sh [--verif-seule]
set -u

sec=${1:-}
racine=$(cd "$(dirname "$0")/.." && pwd)
: "${NIE_GAME_DIR:=$racine}"
export NIE_GAME_DIR

manquants=()
echecs=()

titre() { printf '\n\033[1m%s\033[0m\n' "$1"; }

titre "1. Les commandes attendues sont-elles publiées ?"
for c in niers nie-catalog export_skills export_passives export_formations export_aphrody; do
    if chemin=$(command -v "$c" 2>/dev/null); then
        printf '  ✓ %-20s %s\n' "$c" "$chemin"
    else
        printf '  ✗ %-20s ABSENT du PATH\n' "$c"
        manquants+=("$c")
    fi
done
if [ ${#manquants[@]} -gt 0 ]; then
    echo
    echo "→ ${#manquants[@]} commande(s) absente(s). Lance : just installer"
    exit 1
fi

titre "2. Les quatre gisements répondent-ils ? (paquet @niers/catalog)"
# `nie-catalog etat` MESURE le contenu : un gisement présent peut être vide. Le lanceur se place
# à la racine du dépôt, sans quoi `extrait` et `re` sont annoncés vides — faux négatif vécu.
nie-catalog etat || echecs+=("nie-catalog etat")

[ "$sec" = "--verif-seule" ] && { echo; echo "vérification seule : rien exporté."; exit 0; }

titre "3. Exports (binaires nie-data du PATH)"
# Ces binaires n'ont pas de --help et résolvent le jeu par resolve_game_dir() : sans NIE_GAME_DIR
# ils échouent hors du dépôt. Elle est posée en tête de script.
for e in export_skills export_passives export_formations export_aphrody; do
    debut=$SECONDS
    if sortie=$("$e" 2>&1); then
        resume=$(printf '%s' "$sortie" | tail -1 | cut -c1-88)
        printf '  ✓ %-20s %3ds  %s\n' "$e" "$((SECONDS - debut))" "$resume"
    else
        printf '  ✗ %-20s %3ds  %s\n' "$e" "$((SECONDS - debut))" "$(printf '%s' "$sortie" | tail -1 | cut -c1-88)"
        echecs+=("$e")
    fi
done

titre "4. Ce qui a été écrit"
if [ -d "$racine/export" ]; then
    # `du` par fichier, jamais `xargs wc` : ce dernier sous-compte dès que xargs découpe.
    find "$racine/export" -maxdepth 1 -type f -newermt '-10 minutes' -printf '  %-42f %10s o\n' 2>/dev/null | sort
else
    echo "  (aucun répertoire export/)"
fi

echo
if [ ${#echecs[@]} -gt 0 ]; then
    printf 'ÉCHECS (%d) : %s\n' "${#echecs[@]}" "${echecs[*]}"
    exit 1
fi
echo "pipeline complet — 4 exports, 4 gisements."
