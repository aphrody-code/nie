# `csharp/` — l'outillage .NET (IECODE)

Trois projets .NET 10, réunis par `IECODE.sln` à la racine du dépôt (avec `global.json` et
`NuGet.config`, dont `bench/cs` hérite).

| Projet | Rôle |
|---|---|
| `IECODE.Core` | la bibliothèque : dump, pack, lecture mémoire, conversion de texture |
| `IECODE.CLI` | la CLI, atteinte par `niers cs <args>` — jamais appelée directement par l'utilisateur |
| `IECODE.Core.Tests` | les tests |

C# tient ce rôle-là et pas un autre : la [doctrine polyglotte](../docs/ARCHITECTURE.md)
donne un rôle à chaque langage, et une commande utilisateur nouvelle s'écrit en Rust dans
`nie-cli`, jamais ici.

```bash
dotnet build   IECODE.sln     # depuis la racine du dépôt
dotnet test    IECODE.sln
niers cs --help                # la façade
```

## `dotnet` est ABSENT du VPS Linux

Cet arbre **ne s'y compile ni ne s'y teste**. Un lot C# travaillé depuis le VPS n'est que
*relu* : le dire, et ne jamais l'annoncer vérifié. La vérification se fait depuis le poste
Windows.

## Résolution des chemins du jeu

Aucun chemin de machine ne doit être compilé ici, pas plus qu'ailleurs : la racine du jeu
se résout à l'exécution (variable d'environnement, puis remontée d'ancêtres). Un chemin en
dur passe les tests de la machine qui l'a écrit et échoue partout ailleurs — c'est un
défaut qui a déjà été corrigé deux fois dans cet arbre.
