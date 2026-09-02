---
description: Boucle de la forge — mesurer la part du binaire reellement produite par le depot
argument-hint: [split|lift|build|report|tout]
allowed-tools: Bash, Read, Grep, Glob
---
La forge est le juge du projet : elle produit `nie.exe` et mesure a l'octet la part generee par le depot.

Etape demandee : $ARGUMENTS (par defaut : `report` si `var/forge/` existe, sinon `split` puis `lift` puis `report`).

Regles :
- Cible = `nie.exe` a la racine (lien vers l'install Steam, 33 918 464 o, sha b1fa04ea3658…). Verifie-le avant de mesurer.
- Ordre : `split` → `lift` → `cc` → `build` → `verify` → `report` (recette `just forge`).
- Passe a `split` les fonctions feuilles mesurees par `nie_re::recover`, pas seulement les racines `.pdata` : c'est le decoupage, pas l'encodeur, qui a fait le dernier grand saut de mesure.
- L'IDENTITE PRIME : `build` echoue si sha256(dist/nie.exe) differe de la reference. Ne jamais « corriger » ce test, c'est le contrat.
- Ne compte jamais `semantic` comme des octets produits : seuls `emitted`/`assembled`/`bytes` comptent.
- Devant un plateau : n'ecris pas de code a l'aveugle. Enrichis le diagnostic (`blocking_detail` ventile par mnemonique, `orig=` vs `nie-asm=`), relance `lift`, lis. Puis `nie-forge candidates --no-reloc` donne la prochaine cible chiffree.
- Rends la mesure avant/apres et la prochaine cible, jamais un pourcentage cite de memoire.
