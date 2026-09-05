# `third_party/` — les sources tierces vendorisées

Bibliothèques C/C++ **header-only**, copiées telles quelles et compilées dans le toolkit
`iecode`. Elles sont ici, et non dans `vcpkg.json`, parce qu'un seul en-tête ne justifie
pas un port.

| Chemin | Bibliothèque | Licence | Ce qu'on en fait |
|---|---|---|---|
| `stb/stb_image.h`, `stb/stb_image_write.h` | stb (Sean Barrett) | domaine public / MIT | lire et écrire du PNG dans les converters |
| `bcdec/bcdec.h` | bcdec (Sergii Kudlai) | domaine public / MIT | décoder les blocs BC (dont BC7) des textures G4TX |
| `mio/mio.hpp` | mio (mandreyel) | MIT | projection mémoire portable des gros fichiers |
| `tinygltf/tiny_gltf.h` | TinyGLTF (Syoyo Fujita, Aurélien Chatelain) | MIT | écrire du glTF à l'export des modèles |

Le texte complet de chaque licence est dans l'en-tête du fichier concerné, et l'attribution
est reprise dans [`NOTICE`](../NOTICE).

## Règles

- **On ne modifie pas une source vendorisée.** Un correctif local se perd à la mise à jour
  et rend le fichier incomparable à l'amont. Ce qui doit changer se met dans un
  en-tête d'enrobage, du côté d'`iecode`.
- **Mettre à jour = remplacer le fichier, et rien d'autre**, puis relancer les tests du
  toolkit. Noter la version amont dans le même commit.
- **Toute entrée nouvelle ici ajoute une ligne dans `NOTICE`.** Une bibliothèque
  redistribuée sans attribution est un défaut de licence, pas un oubli de documentation.
- Les dépendances qui *ne sont pas* copiées (Cargo, Bun, NuGet, vcpkg) n'ont rien à faire
  ici : elles se résolvent à la construction.
