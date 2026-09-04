# Installer la CLI Niers

La CLI utilisateur est le binaire **`niers`**, fourni par le paquet Cargo
**`nie-cli`**. Le dépôt canonique est
<https://github.com/aphrody-code/nie>. Il reste privé à la publication Cargo
(`publish = false`) : l'installation reproductible se fait depuis Git avec le
`Cargo.lock` du dépôt.

Les droits, licences et contenus Inazuma Eleven restent régis par
[`LICENSE`](../LICENSE) et par l'Accord Commercial Officiel d'Exploitation
N° RG-L5-VR-2026-001. Installer la CLI ne redistribue pas les données du jeu.

## Prérequis

- Rust correspondant à [`rust-toolchain.toml`](../rust-toolchain.toml) ;
- Git ;
- Windows 10/11, macOS ou Linux 64 bits.

Certaines commandes dépendent de la plateforme ou d'outils externes. En
particulier, `niers mem` utilise `process_vm_readv` et n'est disponible que sous
Linux. Les délégations `niers cpp` et `niers cs` nécessitent respectivement le
backend C++ et .NET ; le cœur de la CLI et `niers --version` n'en dépendent pas.

## Installation globale

Sur Linux, macOS, PowerShell ou `cmd.exe` :

```console
cargo install --git https://github.com/aphrody-code/nie --package nie-cli --locked
niers --version
```

Cargo place `niers` dans son répertoire global de binaires, habituellement
`$CARGO_HOME/bin` (`~/.cargo/bin` sur Linux et macOS,
`%USERPROFILE%\.cargo\bin` sur Windows). Ce répertoire doit être présent dans
`PATH`.

Pour installer une version immuable, ajouter `--tag vX.Y.Z`. Sans `--tag`, la
commande suit la branche par défaut du dépôt.

## Mise à jour

```console
cargo install --git https://github.com/aphrody-code/nie --package nie-cli --locked --force
niers --version
```

Pour une mise à jour contrôlée, ajouter le nouveau `--tag vX.Y.Z`. `--force`
remplace uniquement les binaires appartenant au paquet Cargo ciblé.

## Désinstallation

```console
cargo uninstall nie-cli
```

Cette commande retire le binaire `niers` suivi par Cargo. Elle ne supprime ni
une installation du jeu, ni les données utilisateur, ni un clone local du
dépôt.

## Installation de développement du dépôt entier

`just installer` est réservé aux contributeurs : il expose par liens
symboliques tous les outils déjà compilés du workspace ainsi que les lanceurs
Bun. Un gestionnaire de paquets et un utilisateur final doivent cibler
exclusivement le paquet `nie-cli` et le binaire `niers` avec les commandes
ci-dessus.
