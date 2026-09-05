# astro/ — le dossier d'Astro Lor

Astro Lor est un **personnage original** (OC) inséré dans l'univers d'*Inazuma Eleven*.
Il n'existe dans aucun fichier du jeu : tout ce qui le concerne est produit ici.

Ce dossier tient les **originaux** et leur **provenance**. Il ne tient ni les
dérivés publiés, ni les données, ni le plan — chacun a sa place, dite plus bas.

---

## Structure

```
astro/
├── README.md                      ce fichier
├── manifeste-assets.json          ce qu'il faut produire pour que le jeu le connaisse
├── provenance/                    d'où vient chaque original — versionné
│   ├── discord-<id message>.json  journal de récupération : ids, empreintes, dimensions
│   └── empreintes.sha256          les 12 originaux, vérifiables
└── sources/                       les originaux — JAMAIS versionnés
    ├── planches/                  9 planches de character design (JPEG 4161×3000)
    └── bd/                        3 pages de bande dessinée (WebP 914×1280)
```

## Droits

Character design et planches : **@Karumina_san**. Les originaux sont son œuvre.

`sources/` est exclu du dépôt (`.gitignore`). Ce qui reste versionné à côté —
la provenance et les empreintes — dit d'où chaque fichier vient et ce qu'il pèse,
**sans le distribuer**.

Les dérivés publiés, eux, sont versionnés : voir plus bas, et la raison qui va avec.

## Provenance

Les **9 planches** viennent d'un message Discord, récupéré par le bot
`niers-wonderbot`. Le journal `provenance/discord-<id>.json` porte, pour chaque
image, son identifiant Discord, son empreinte sha256, ses dimensions et son poids.

Les **3 pages de bande dessinée** viennent d'URL fournies à la main. Elles n'ont pas
de journal de récupération : leur trace est dans `provenance/empreintes.sha256`.

Rien ne garantit que ce dossier soit **complet** : il contient ce qui a été
transmis, pas nécessairement tout ce qui existe.

### Vérifier que rien n'a bougé

```bash
cd astro/sources && sha256sum -c ../provenance/empreintes.sha256
```

Douze lignes `OK` attendues. Les empreintes des neuf planches recoupent celles du
journal Discord — la chaîne se vérifie de bout en bout.

## Ce qui n'est pas ici, et où c'est

| Quoi | Où | Pourquoi là |
|---|---|---|
| Dérivés publiés (portraits 512×512, planches 1600 px, pages BD) | `apps/azalee/public/oc/astro-lor/` | le site les sert ; sans eux les pages cassent, donc ils sont versionnés |
| Données du wiki (personnage, techniques, esprit, Mixi Max) | `scripts/donnees/astro-lor-oc.py`, `astro-lor-auras.py` | scripts rejouables, en `ON CONFLICT DO UPDATE` |
| Plan d'intégration au jeu et verrous | `docs/ASTRO-LOR.md` | c'est de la documentation, pas de la donnée |
| Récupération Discord | `scripts/donnees/astro-lor-planches-discord.py` | le dépôt range ses scripts dans `scripts/` |

Les dérivés sont volontairement de basse résolution : ils suffisent à l'affichage
et ne remplacent pas les originaux.

## Commandes

```bash
# Régénérer le manifeste d'assets (interroge le VFS ; quelques minutes)
uv run scripts/donnees/astro-lor-manifeste.py
jq '.resume' astro/manifeste-assets.json

# Vérifier l'intégrité des originaux
cd astro/sources && sha256sum -c ../provenance/empreintes.sha256

# Récupérer à nouveau depuis Discord — dans un dossier de TRAVAIL, pas dans sources/
uv run scripts/donnees/astro-lor-planches-discord.py /tmp/astro-brut
```

## Deux pièges déjà payés

**Ne pas rejouer la récupération Discord dans `sources/`.** Le script nomme ce
qu'il rapporte `attachment-<id>-<empreinte>.jpg`, pas `01-og-tenue-jaune.jpg` :
seul un regard humain sait ce que montre une planche. Un rejeu dans `sources/`
y déverse douze doublons sous leur nom brut — c'est arrivé, et il a fallu les
retrouver par empreinte pour les distinguer des vrais. Le script exige désormais
un dossier de sortie explicite, sans valeur par défaut.

**Se méfier de l'extension.** Deux des pages de bande dessinée sont arrivées en
`.jpg` alors que leur contenu est du WebP — Discord sert en WebP ce qu'on lui a
donné en JPEG. Vérifier avec `identify` ou `file`, pas avec le nom.

## État

Le wiki connaît Astro : fiche complète sur `/chara/astro-lor`, au même niveau
qu'un personnage du jeu.

Le jeu, lui, ne le connaît pas. `manifeste-assets.json` dit ce qui manque, et
`docs/ASTRO-LOR.md` pourquoi — les deux affirmations sont vraies en même temps.
