# Byron Love / Shawn Froste — référence VFS

Ce dossier centralise la fiche exploitable par le wiki et le runtime pour les
deux personnages canon. Les binaires ne sont pas recopiés : ils restent dans
`data/ref/afubuki/` et sont reliés par leurs chemins VFS dans
`game/native-vfs.json`.

## Mixi-Max retenu

Nom court de référence : **Afubuki**.

## Nom Mixi-Max canonique

Le libellé anglais canonique est **Mix 'n' Match Afubuki**. Le deux-points
affiché dans les exports (`Mix 'n' Match: Afubuki`) est la convention de
formatage de la table `inagle_miximax`. « Mix 'n' Match Axel » est conservé
uniquement comme provenance du slot remplacé (`replaces_display_name`) ; ce
n'est pas le nom runtime d'Afubuki.

Ce nom composé identifie Aphrodi + Fubuki, à partir du partenaire attesté dans
les données Astro (`Shawn Froste`). La fiche réutilise l’identifiant runtime
existant `0x2A80A796` du slot remplacé ; seul le libellé canonique est
remplacé.
Le texte source `Axel + Shawn` est `0x4785C8B1` dans le VFS.

## Intégration

`game/identity.json` est la source unique des rôles Afubuki : avatar par
défaut, personnage principal, âme de N.I.E. et persona Steam. Le sélecteur
utilise le code VFS vérifié `c01001900` comme base Byron/Aphrodi et conserve
Shawn/Fubuki comme partenaire du Mixi-Max.

Cette déclaration est native au catalogue OC et aux consommateurs qui lisent
ce contrat. Elle ne prétend pas modifier directement `nie.exe`, une sauvegarde
ou le VFS de Steam tant qu'un point d'injection runtime dédié n'est pas prouvé.

`game/complete-profile.json` consolide toutes les versions Afuro/Fubuki, les
assets extraits, le Mixi-Max et le contrat avatar `chara_edit`. La commande
canonique est `nie oc`; `nie ocgen` reste accepté comme alias.

Le générateur `scripts/donnees/afubuki-oc.py` produit un SQL rejouable qui
crée la ligne `inagle_miximax` et rattache l'aura aux identifiants de
personnages déjà présents. Les chemins `data/common/...` et `data/dx11/...`
restent les chemins natifs du VFS.

`game/basara-profile.json` conserve Afubuki avec la convention des lignes
`inagle_miximax` : identifiant, hash, noms, descriptions, type, sous-type,
élément, asset, `sheet_data` et `data`. La forme BASARA vérifiée reste
documentée avec 71 `BASARA_BUILD_INFO` et 426 `BASARA_BUILD_TYPE`.

