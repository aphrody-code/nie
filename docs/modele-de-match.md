# Modèle de résolution de match

Ce que le RE a établi sur la chaîne tir → blocage → but dans `nie.exe`, et ce qui reste opaque.
Adresses en base image `0x140000000`. Distinction maintenue partout : *décompilé* ≠ *compris* ≠
*portable*.

## Le résultat principal : la résolution est data-driven, pas une formule

Il n'existe **pas** de formule arithmétique compacte à porter. Chaque couche désassemblée n'est
qu'une indirection de lookup :

```
service-locator haché (0x1404E0C30)  →  dispatch virtuel (vtable+0x70)  →  registre par ID
```

L'issue d'un combat de focus (but ou parade) est déterminée par les **données** que ces lookups
parcourent — état de scène et tables de config — pas par un coefficient inline. Porter la
résolution signifie porter l'**évaluateur table-driven et ses tables**, soit un sous-système
entier, de la même nature de frontière que le driver-transform du menu.

**Conséquence directe** : `GOAL_RATE_BASE = 0.035` et la formule `kc / (kc + ps)` de
`nie-core/src/match_sim.rs` n'ont **aucun fondement binaire**. Elles restent nominales et sont
signalées comme telles dans le code.

## `lives::CRand` = MT19937 — confirmé bit-exact, porté

Le seul verrou entièrement levé. Trois sources concordent (seed, next, genrand brut).

| Constante | Valeur | Rôle MT19937 |
|---|---|---|
| Multiplicateur d'init | `0x6C078965` (1812433253) | `mt[i] = 1812433253*(mt[i-1]^(mt[i-1]>>30))+i` |
| Taille d'état | `0x270` = 624 mots u32 | n = 624 |
| Offset de torsion | index `0x18C` relatif | m = 397 |
| MATRIX_A | `0x9908B0DF` | torsion |
| UPPER / LOWER_MASK | `0x80000000` / `0x7FFFFFFF` | masques haut/bas |
| Tempering shifts | `>>11`, `<<7`, `<<15`, `>>18` | standard |
| Tempering masks b, c | `0x9D2C5680`, `0xEFC60000` | standard |
| Tempering mask d | `0xFFFFFFFF` | écrit par le constructeur à `this+0x138C` |
| Graine par défaut | `0x1571` = 5489 | le défaut canonique MT19937 |

**Le piège des masques « non standard »** : la décompilation montre `(y & 0xff3a58ad) << 7` et
`(y & 0xffffdf8c) << 15`, qui ne ressemblent pas aux constantes canoniques. C'est une réécriture
du compilateur de `(y << s) & B` en `(y & (B>>s)) << s` — les bits hauts éliminés par le shift
sont « don't care ». Vérifié : `0xff3a58ad & 0x01ffffff == 0x9d2c5680 >> 7`. Les masques **sont**
canoniques.

**Layout de l'objet** (taille `0x1398`) : `+0x00` vftable · `+0x08` `mti` · `+0x0C` `mt[0..623]` ·
`+0x1390` compteur de tirages · `+0x1394` copie du seed · `+0x138C` masque `d`.

**Génération bornée** : `vmethod_4(this, n)` applique la **méthode de Lemire** — `mulhi(r, range)`
avec rejet par seuil `(-range) % range` ; `n == 0` renvoie le brut. La boucle de rejet doit être
répliquée : elle détermine la *consommation* de tirages, donc le rejeu byte-exact.

**État du port** : `nie-core/src/crand.rs`, validé contre le vecteur de référence
`init_genrand(5489)`. `vmethod_0` est le destructeur scalaire-deleting MSVC, pas un générateur.

Attention : le PRNG est un primitif moteur (`lives::`, utilisé aussi au rendu), pas un composant
de football. Le porter ne débloque pas à lui seul la résolution.

## `FocusBtlState` — la machine d'état, sans l'issue

`FocusBtlState::vmethod_1` (`0x1412CD7A0`, 205 o) est l'**entrée d'état** one-shot, pas la boucle
de résolution : pose des bits de flag à `state+0x10` (`| 2`, et `| 0xC` si le flag d'équipe
`(team+0x1030) & 4`), joue un effet par ID haché `0xD4F6EC81`, puis calcule
`state+0x24 = delegate ? 0 : 3` — le code de sortie connu de la FSM.

Le délégué `0x1410729D0` est un **dispatch d'événement haché**, indexé par type de commande :

| Type de commande focus | ID haché |
|---|---|
| 1 ou 2 | `0x6AD2B143` |
| 3 | `0xB98AFD39` |
| 4 | `0xDD36D36B` |
| 5 | `0xF6954E2D` |

Il construit un bloc de 16 slots de 20 octets (contenant le sous-ID constant `0xFB7527AE`, l'ID
`0x04A47B7B`, et un `0x3F800000` = `1.0f`), le passe au système d'événements, et recopie 5 octets
de résultat (`{u32; u8}`) dans `state+0x2c`.

**Le résolveur d'événement reste à localiser.** L'adresse `0x1412C0970` a été citée comme étant ce
résolveur : c'est **faux** pour ce build. La fonction à cette zone commence à `0x1412C0950`, fait
~112 octets, et n'est qu'un poster d'événement (`ReservePopupMiss` via `lookup(0xE6B51AE7)` +
`vtable[0x70]`) — sa signature (rcx + xmm0/xmm1) ne correspond pas aux 4 arguments du vrai
résolveur. Il faut repartir de son site d'appel réel, dont l'`arg2` est `UNK_141753018`.

`UNK_141753018` est **du code**, pas des données : un callback de recherche de table par ID
(boucle linéaire sur 128 entrées de 40 o à `[rcx + 0x4DB758]`, renvoie l'entrée dont `[entrée+0xC]`
égale l'ID). Le helper voisin `0x141753040` parcourt une autre table (128 × 192 o, clé à `+0x60`).

Les huit hashes (`0x6AD2B143`, `0xB98AFD39`, `0xDD36D36B`, `0xF6954E2D`, `0xFB7527AE`,
`0x04A47B7B`, `0xD4F6EC81`, `0xF4DBDF21`) **ne sont pas dans la table `hash_name`** — vérifié.
Cette table couvre les CRC Level-5 de noms d'assets, pas les IDs d'événement internes du moteur.
Les nommer par lookup inagle/iecode est un cul-de-sac : il faut décompiler la table de dispatch.

## Gardien — constantes portées, calcul absent

Cinq constantes IEEE 754 validées et portées dans `nie-core/src/keeper.rs`, depuis le
constructeur du `SoccerCalcKeeperSaveComponent` (`0x14030E5C0`/`E680`/`E770`) :

| Champ | Valeur f32 | Hex |
|---|---|---|
| `save_radius` | 1.0 | `0x3F800000` |
| `max_dive_dist` | 5.0 | `0x40A00000` |
| `save_probability` | ≈ 0.800 | `0x3F4CCCCD` |
| `reaction_time` | ≈ 4.73 frames | `0x40975C29` |
| `dive_speed` | ≈ 2.67 | `0x402AE148` |

La structure `ShootSaveData` est portée (shoot_position, shoot_direction, flags, state_byte,
keeper_position, dive_direction, dive_lateral, aux_vector, impact_position, surface_normal).

Les quatre « callers » du composant (`0x14030CDC0`, `0x14030D040`, `0x14030D7E0`, `0x14030DEE0`)
et le callback `0x14030DDE0` sont **tous de la plomberie de file de commandes**, pas la formule :
garde d'état de scène, allocation de deux nœuds par pool, recopie du `ShootSaveData`, chaînage,
puis pose de mots de kind — `0x140000`, `0x180000`, `0x700000`, `0x1900000` (quatre familles) avec
les sous-codes `0x100`/`0x10D`/`0x10F`/`0x119`.

Le calcul `evaluate()`/`update()` (tirage CRand contre `save_probability`, distance contre
`max_dive_dist`) s'exécute quand la commande enfilée est **dépilée**. Ce sont les vmethods du
composant, pas ses enfileurs — cible non localisée.

## Paramètres PK — schéma portable, valeurs data-driven

`fixPkWinMinPercentage` / `fixPkWinMaxPercentage` sont les seules probabilités explicitement
nommées dans un contexte de résolution. Leur loader réel est `0x140390090` (4792 o) — un
**initialiseur de table de réflexion** idempotent qui enregistre 43 descripteurs de 0x38 o à
`&DAT_1421257F0`, chacun `{ ptr_nom, offset_struct u32, taille, getter 0x140454300,
setter 0x140454340, type-hash 0xF4DBDF21 }`.

| Champ | Offset dans la struct |
|---|---|
| `fixPkWinMinPercentage` | `0x9C` |
| `fixPkWinMaxPercentage` | `0xA0` |

Les 41 autres couvrent `pkGkDefenseLine*`, `pkShootHitStop*`, etc. (offsets `0x0C` à `0xC0`).

> L'adresse `0x14038FC70`, longtemps citée pour ce loader, n'est **pas une fonction** : c'est du
> bourrage `int3` dans un gap. Artefact du désalignement de l'index Ghidra — la vérité terrain
> est `.pdata`.

Le **schéma** est portable (binding nom → offset → type). Les **valeurs** ne sont pas dans le
code : elles viennent d'un `cfg.bin` chargé à l'exécution, non identifié précisément (piste :
`soccer_game_config_*.cfg.bin`, section `SOCCER_GAME_INFO`, 650 entrées).

## Autres éléments confirmés

**Phases de match** (`SoccerPhase`, 11 valeurs) : 0 Idle · 1 KickOff · 2 InPlay · 3 SetPlay ·
4 Goal · 5 HalfTime · 6 FullTime · 7 Penalty · 8 FocusBattle · 9 Command · 10 Tutorial.
`match_fsm.rs` utilise 11 états internes mais ignore encore cet enum.

**Horloge** : `minutes * 10_000 + seconds`, aux offsets `+0x1e080` (u16) et `+0x1e082` (u16) de
`CSceneSoccer`. FullTime = `900_000`.

**Balle** : gravité `2.0f` (`0x40000000`), scale `1.0f`, `INVALID_TARGET_ID = 0xFFFF0000`,
`INVALID_PLAYER_IDX = 0xFF`, `max_collisions = 5`, 10 variantes de `BallMoveKind`.

**SoccerCtrl** : triple de phase aux offsets `0x700`–`0x702`. Phase 0 = sentinelle, 1 = normal.

**Tactiques** : 3 contextes × 4 niveaux, mode = 2, threshold = `-1.0f`, flags_mask = `0x1000000`,
timeout = 20 frames, counter = 5.

**Registre de commandes** : la fonction à `0x140082690` (833 références de chaînes) porte le
registre complet — `CMD_ACTION_SHOOT`, `CMD_FOCUS_BATTLE_DASH`, `CMD_FOCUS_BATTLE_POWER_BLOCK`,
`CMD_FOCUS_BATTLE_POWER_CHARGE`, `CMD_FOCUS_BATTLE_PREP_BLOCK`, `CMD_ON_DEFENSE_LINE`,
`CMD_RUN_CMDBTL`, `CMD_RUN_MDLBTL`, `CMD_ZONE_SHOOT_CHAIN_SHOOT`. La distinction
`PREP_BLOCK` / `POWER_BLOCK` confirme une structure en deux temps du combat de focus.

**Dimensions de terrain** : le loader `0x140397380` lit `goalSize{X,Y,Z}_{Normal,Battle}`,
`fieldSize{X,Z}_{Normal,Battle}`, `penaltyAreaSize{X,Z}_*`, `centerCircleRadius_*`,
`centerPos{X,Y,Z}` — les variantes `_Battle` distinguent le mode FocusBattle du jeu normal.

## Ce qui reste inconnu

- **La formule de résolution du focus** — enfermée dans un évaluateur table-driven non localisé.
- **`evaluate()`/`update()` du composant gardien** — les vmethods, pas les enfileurs.
- **Schéma de `SOCCER_GAME_DIFFICULTY`** — 45 champs entiers positionnels × 1772 entrées, aucun
  nom. La source de vérité serait le header `GDSSoccerGameConfig`.
- **Les 8 paramètres de `ScFbtlActivatedEffect`** — signification inconnue.
- **Condition de déclenchement de FocusBattle depuis InPlay** — seuil de distance, décision IA ou
  commande joueur ?
- **Durée d'une FocusBattle en frames.**
- **Contribution des stats au FocusBtlState** — extrapolée depuis inagle, jamais confirmée.
