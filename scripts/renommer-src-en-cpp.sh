#!/usr/bin/env bash
# Renomme l'arbre C++ `src/` en `cpp/`, et suit ses references.
#
# POURQUOI CE SCRIPT EXISTE PLUTOT QU'UN `git mv` A LA MAIN
# `src/` est le seul ecart de fond qui reste avec la structure d'openai/codex (cf.
# docs/ORGANISATION.md) : dans un monorepo a quatre langages, un dossier nomme `src/` a la
# racine ment — il ne contient que le toolkit C++ `iecode`. Mais le renommage doit se faire
# EN UN SEUL COMMIT avec ses references, sinon le `GLOB_RECURSE` de src/CMakeLists.txt et
# ses `list(FILTER … EXCLUDE REGEX ".*/src/<nom>/.*")` cessent de s'accorder, et plusieurs
# `main()` se retrouvent dans iecode_core.
#
# CE QU'IL NE FAIT PAS
# Il ne remplace QUE des motifs propres a l'arbre C++ (`src/decomp`, `src/include/iecode`,
# `src/cli/`, `src/tests`, `src/nie_rs`, `src/CMakeLists.txt`). Il ne touche jamais un
# `packages/x/src/`, un `crates/y/src/` ni un `apps/z/src/` : ces chemins-la sont legitimes
# et un remplacement aveugle les casserait tous. Les fichiers qui citent `src/` sans l'un
# de ces motifs sont LISTES a la fin, a relire a la main.
#
# Idempotent : rejoue apres coup, il constate que `cpp/` existe deja et ne fait rien.

set -euo pipefail

racine="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$racine"

# --- Gardes ------------------------------------------------------------------------

if [ -d cpp ] && [ ! -d src ]; then
	echo "cpp/ existe deja et src/ n'existe plus : le renommage a deja ete fait."
	exit 0
fi

if [ ! -d src ]; then
	echo "ERREUR : ni src/ ni cpp/ — ce script doit tourner a la racine du depot." >&2
	exit 1
fi

if [ -d cpp ]; then
	echo "ERREUR : src/ ET cpp/ existent tous les deux. Trancher a la main." >&2
	exit 1
fi

# Ce depot est travaille par deux agents en parallele (docs/A2A-CODEX.md). Renommer un
# arbre pendant qu'un autre y ecrit ecrase son travail sans le dire.
modifs="$(git status --porcelain -- src | wc -l)"
if [ "$modifs" -ne 0 ]; then
	echo "ERREUR : $modifs fichier(s) modifie(s) sous src/ ne sont pas commites." >&2
	echo "Un renommage ecraserait ce travail. Attendre la liberation de src/ :" >&2
	git status --short -- src >&2
	exit 1
fi

# --- Le renommage ------------------------------------------------------------------

echo "==> git mv src cpp"
git mv src cpp

# --- Les references ----------------------------------------------------------------

# Motifs propres a l'arbre C++, et eux seuls.
motifs=(
	'src/decomp'
	'src/include'
	'src/cli'
	'src/tests'
	'src/nie_rs'
	'src/CMakeLists.txt'
	'src/engine'
	'src/game'
	'src/modding'
	'src/formats'
	'src/vfs'
	'src/render'
	'src/archive'
	'src/compression'
	'src/converters'
	'src/crypto'
	'src/gamedata'
	'src/services'
	'src/viola'
)

# Les references vivent hors de l'arbre lui-meme (il a ete renomme avec son contenu, donc
# ses chemins internes relatifs suivent) ET dans cpp/CMakeLists.txt, qui se cite lui-meme.
motif_rg="$(printf '%s|' "${motifs[@]}")"
motif_rg="(^|[^A-Za-z0-9_./-])(${motif_rg%|})"

mapfile -t fichiers < <(
	rg -l --glob '!node_modules' --glob '!refs/**' --glob '!target/**' \
		--glob '!*.lock' --glob '!var/**' --glob '!data/**' \
		-e "$motif_rg" || true
)

echo "==> ${#fichiers[@]} fichier(s) citent l'arbre C++ ; reecriture des motifs surs"
touches=0
for f in "${fichiers[@]}"; do
	avant="$(md5sum "$f" | cut -d' ' -f1)"
	for m in "${motifs[@]}"; do
		# `\bsrc/x` seulement : precede d'un caractere de chemin, on ne touche pas
		# (packages/nie/src/cli, crates/x/src/engine…).
		perl -pi -e "s{(?<![A-Za-z0-9_./-])\Q$m\E}{cpp/${m#src/}}g" "$f"
	done
	apres="$(md5sum "$f" | cut -d' ' -f1)"
	[ "$avant" != "$apres" ] && touches=$((touches + 1))
done
echo "==> $touches fichier(s) reecrit(s)"

# --- Ce qui reste a relire ----------------------------------------------------------

echo
echo "==> references a 'src/' qui ne correspondent a AUCUN motif C++ connu."
echo "    A relire une par une : la plupart sont des packages/*/src ou crates/*/src"
echo "    legitimes, mais une mention en prose de l'arbre C++ peut s'y cacher."
rg -n --glob '!node_modules' --glob '!refs/**' --glob '!target/**' --glob '!*.lock' \
	--glob '!cpp/**' --glob '!var/**' --glob '!data/**' \
	-e '(^|[^A-Za-z0-9_./-])src/' |
	rg -v '(packages|apps|crates|csharp|python|plugins|bench|third_party|supabase)/[A-Za-z0-9_.-]+/src/' ||
	echo "    (aucune)"

cat <<'FIN'

==> Ce qui n'est PAS fait par ce script, et doit l'etre dans le meme commit :

  1. Verifier la configuration CMake, qui est le seul vrai juge :
       VCPKG_ROOT="$PWD/var/vcpkg" cmake -S . -B build/verif
     (poste Windows uniquement — le VPS Linux n'a pas MSVC)
  2. Relire cpp/CMakeLists.txt : le GLOB_RECURSE et ses list(FILTER … EXCLUDE REGEX)
     doivent citer cpp/, sinon plusieurs main() entrent dans iecode_core.
  3. Relire .clangd, CMakePresets.json et .github/workflows/ci.yml.
  4. Mettre a jour docs/ORGANISATION.md : le lot 1 passe de « bloque » a « fait ».
  5. Prevenir l'autre agent : aphrody a2a tick --kind fact --subject "done: src/ -> cpp/"
FIN
