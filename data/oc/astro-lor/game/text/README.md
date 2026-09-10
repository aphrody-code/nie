# `game/text/` — le dialogue OC, au format du jeu

Un événement de dialogue produit ici, dans **la forme exacte** que le jeu utilise sous
`data/common/text/`. Ce n'est pas une copie de données du jeu : les lignes sont écrites
depuis le lore et la bande dessinée d'Astro Lor.

```
game/text/
├── fr/event/ev98_99010.cfg.bin.json    les 15 répliques, en français
├── en/event/ev98_99010.cfg.bin.json    les mêmes, en anglais
└── event/ev98_99010_map.cfg.bin.json   la table washa — invariante par langue
```

Chemins VFS visés, si l'événement est un jour injecté :

| Fichier | Chemin dans le jeu |
|---|---|
| `fr/event/ev98_99010.cfg.bin.json` | `data/common/text/fr/event/ev98_99010.cfg.bin` |
| `en/event/ev98_99010.cfg.bin.json` | `data/common/text/en/event/ev98_99010.cfg.bin` |
| `event/ev98_99010_map.cfg.bin.json` | `data/common/text/event/ev98_99010_map.cfg.bin` |

Ce sont des `*.cfg.bin.json` — la **forme iecode** que lisent les parseurs typés de
`nie-data`, pas le `.cfg.bin` binaire. Le passage au binaire dépend du verrou **V1** de
[`docs/ASTRO-LOR.md`](../../../../../docs/ASTRO-LOR.md) : `encode_t2b` ne rend pas encore un
fichier octet-identique. Tant que V1 n'a pas sa preuve, ces fichiers sont du contenu prêt,
pas un mod installable.

## D'où vient le texte

Les 15 répliques transcrivent les trois planches de `source/comic/` — @Karumina_san — et
s'appuient sur les faits déjà normalisés par `scripts/donnees/astro-lor-oc.py` : le coma de
trois ans, la jambe droite amputée et sa canne, Shawn Froste l'ami d'enfance qui appelle
Astro « Shiro ».

Une réserve, dite plutôt que masquée : sur la page 2, la bulle « on dirait que je suis venue
au mauvais moment… » est posée hors du personnage dessiné. Elle est attribuée ici à Astro,
que le « TAP TAP » de la canne annonce dans la case suivante. Le jeu ne stocke aucun nom de
locuteur dans une ligne `TEXT_INFO` : l'attribution ne vit que dans les commentaires du
script, et se corrige là.

## Le format, mesuré

```text
<lang>/event/<id>.cfg.bin.json
  TEXT_INFO_BEGIN_0        variables = [Int nombre_de_lignes]
    TEXT_INFO_<i>          variables = [Int hash, Int 0, String texte, Int 0]

event/<id>_map.cfg.bin.json
  TEXT_WASHA_MAP_BEGIN_0   variables = [Int nombre_de_lignes]
    TEXT_WASHA_MAP_<i>     17 variables ; var[0] = le même hash,
                           var[15] = le libellé canonique <id>_<bloc>_<ligne>
```

Le `hash` est le **CRC-32 standard du libellé washa**. Recoupé sur deux lignes livrées de
`ev02_00800` : `ev02_00800_010_010` → `-1714101475`, `ev02_00800_010_020` → `-1292259106`.
C'est la clé de jointure entre le texte et la table washa, et elle ne dépend pas de la langue.

`ev98` est un préfixe qu'aucun événement livré n'utilise sur cette build — relevé sur tout
`data/`, pas supposé. Même raisonnement que les codes de personnage `c99019010` : un espace
de noms qui ne peut pas entrer en collision avec ce que le binaire porte déjà.

Les retours à la ligne sont la séquence littérale `\n` de deux caractères, comme dans les
fichiers français livrés.

## Régénérer

```bash
uv run scripts/donnees/astro-lor-dialogue.py
```

Le script est la source ; ces trois JSON en sont la sortie. Modifier une réplique se fait
dans `SCENE`, jamais dans le JSON — les hashes se recalculent tout seuls.

## Ce qui a été vérifié

- Schéma comparé nœud par nœud à `ev02_00800` livré (texte **et** washa) : identique.
- Jointure interne : 15 hashes côté texte, 15 côté washa, mêmes valeurs, aucun doublon.
- Le CRC-32 employé rend les deux hashes livrés cités plus haut.

Ce qui n'est **pas** vérifié : que le jeu lise l'événement. Il faudrait pour cela l'encoder
en `.cfg.bin` (verrou V1) et l'installer. Aucune de ces deux preuves n'existe aujourd'hui.
