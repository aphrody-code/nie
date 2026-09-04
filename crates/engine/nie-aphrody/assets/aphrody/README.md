# Aphrody v2 — paquet vendored

Sous-ensemble runtime du paquet validé le 4 septembre 2026 par le pipeline `hatch-pet`.
Le gate source `qa/run-summary.json` porte `ok=true`, 74 frames validées, les quatre directions
cardinales validées et un atlas WebP VP8L lossless dont le décodage correspond au PNG canonique.

Source d'admission :
`C:\Users\aphro\Documents\Codex\2026-09-04\hatch-pet-c-users-aphro-codex\outputs\aphrody-v2`.

| Fichier | SHA-256 |
|---|---|
| `pet.json` | `93b3af384a3ab44e6a0882f05458a9999bd9e8f2e42ac32a620eec7246e69cee` |
| `animations.json` | `21fb99f37e862edcc28ffe5c7f3877499d10e52f60e5dcf2b1e008e24f01cc3b` |
| `sprites/spritesheet.png` | `bc48f3e2a4d3086234062b9175d58f2caaec39f6afeb53ab8b222513fe964037` |
| `sprites/spritesheet.webp` | `93238150de5b86b5977f8409800a91637dfcc3b70b3b0d6d617f6563fa54389b` |

Les 74 PNG individuels et les artefacts QA ne sont pas dupliqués : `animations.json` conserve
leurs rectangles et hashes, et le test d'intégration reconstruit l'atlas complet depuis ces
cellules. L'utilisation s'inscrit dans l'Accord Commercial RG-L5-VR-2026-001 documenté à la
racine du dépôt.
