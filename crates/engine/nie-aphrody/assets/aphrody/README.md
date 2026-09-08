# Aphrody v2 — paquet vendored

Sous-ensemble runtime du paquet validé le 4 septembre 2026 par le pipeline `hatch-pet`.
Le gate source `qa/run-summary.json` porte `ok=true`, 74 frames validées, les quatre directions
cardinales validées et un atlas WebP VP8L lossless dont le décodage correspond au PNG canonique.

Source d'admission :
`C:\Users\aphro\Documents\Codex\2026-09-04\hatch-pet-c-users-aphro-codex\outputs\aphrody-v2`.

| Fichier | SHA-256 |
|---|---|
| `pet.json` | `1a458332b408f168cfedf43bffe1c79418168d86a534663e96a8fdcfb28f6067` |
| `animations.json` | `511da87b80816cedcc83654806e7f363ba392c67e0d4d370728f0a1b6fd51741` |
| `sprites/spritesheet.png` | `bc48f3e2a4d3086234062b9175d58f2caaec39f6afeb53ab8b222513fe964037` |
| `sprites/spritesheet.webp` | `93238150de5b86b5977f8409800a91637dfcc3b70b3b0d6d617f6563fa54389b` |

Les 74 PNG individuels et les artefacts QA ne sont pas dupliqués : `animations.json` conserve
leurs rectangles et hashes, et le test d'intégration reconstruit l'atlas complet depuis ces
cellules. L'utilisation s'inscrit dans l'Accord Commercial RG-L5-VR-2026-001 documenté à la
racine du dépôt.

## Le dossier documentaire

`../dossier/aphrody.json` et `../dossier/aphrody.md` rassemblent tout ce que le dépôt sait
d'Aphrody : les données du jeu (via `export_aphrody`), le canon officiel du zukan LEVEL-5, les
fichiers réels du VFS, le romaji calculé depuis le furigana, ce que les wikis documentent et
pas nous, et le paquet du pet décrit ci-dessus. Chaque bloc porte sa source et sa confiance.

Les deux fichiers sont embarqués par `include_str!` (`BUNDLED_DOSSIER_JSON`,
`BUNDLED_DOSSIER_MD`) et lisibles par `Dossier::bundled()` — sans fichier, sans base, sans
réseau. Ils se régénèrent par :

```bash
bun --bun scripts/aphrody/dossier.ts byron-love-aphrody \
  --zukan "<url zukan EN>" --zukan "<url zukan JA>" \
  --fandom "fr:Byron_Love" --fandom "en:Afuro_Terumi" --google "亜風炉 照美"
```

Le script écrit ici par défaut. Après régénération, `cargo test -p nie-aphrody` vérifie que le
dossier se lit, que son bloc `pet` décrit bien le paquet embarqué, et que les empreintes du
tableau ci-dessus sont exactes.
