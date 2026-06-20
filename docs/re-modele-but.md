# RE du modèle de but de match (IEVR) — anchors + reconstruction

Reverse du chemin but/tir du moteur de match, sur le binaire **courant** `nie_eacpatched.exe`
(build VPS du 3 juin 2026). Outil : `scripts/re_goal_model.py` (pefile + iced-x86). Statut de tout
ce qui suit : **reversé, NON validé runtime** (pas d'oracle sans lancer le jeu).

## Anchors RTTI (vtables confirmées dans le binaire courant)

Layout MSVC vérifié : la valeur `vtable_vaddr` de `niers.sqlite` est le **COL** ; les pointeurs de
vméthodes commencent à **COL+8**. Contrôle : `CSoccerEventCheckComponent::vmethod_0 == 0x140379270`
(= mémoire `c3-modele-but-anchors`).

| Classe | COL (vtable_vaddr) | Note |
|---|---|---|
| `CSoccerEventCheckComponent` | `0x14183B238` | FSM d'événement (taille objet 0x88) |
| `SoccerShootCatchInfoMenu` | `0x1418220F0` | **MENU UI** (cf. ci-dessous), PAS la physique |
| `SoccerCalcKeeperSaveComponent` | `0x141827930` | déjà porté (`nie-core/keeper.rs`) |
| `BallMoveGoalnet` | `0x141832D78` | **cible physique but (à reverser)** |
| `GoalnetComponent` | `0x14183D670` | **cible physique but (à reverser)** |
| `GoalState` / `GoalNetState` | `0x14182FD18` / `0x14182FE80` | états du but |
| `SoccerBattleEventPlayEventInfo` | `0x1418349E8` | info d'événement de match |

## Reconstruction (workflow, 9 fonctions)

- **`CSoccerEventCheckComponent::vmethod_10` (`0x141404340`)** — *tick d'une FSM d'événement
  générique* (confiance med-high). Garde sur une liste intrusive d'enfants (`this+0x08`, next à
  `+0xC0`, flags 16-bit `+0x7C` : bit0 actif requis, bit3 disqualifiant, bit7 terminal/stop-scan).
  Si armée (`this+0x80 != 0`) : table de saut à 7 états (`this+0x70`, -1 = inactif), compteur de
  **phase `this+0x74` (0→2)**. Sous-appel `0x141404150` (prédicat de phase) → si true, `phase++` ;
  à `phase>=2`, tail-call `0x1414044A0` (finalisation : appelle le callback de complétion `this+0x68`,
  reset état/phase/latch). Avant complétion, émet une fois le callback de progression `this+0x60`
  (latch `this+0x7C`). **C'est le système d'événements scripté de match** (générique), pas la
  détection de but en soi.
- **`SoccerShootCatchInfoMenu::vmethod_1..5,9` (`0x141043740`/`0x141044b50`/`0x141043a60`/
  `0x141044cf0`/`0x141044d40`/`0x141044dc0`)** — **CORRECTION** : cette classe est un
  **`lives::CMenuObject`** (UI). Ses vméthodes sont des handlers de cycle de vie de menu
  (désactivation, Step/PostStep par frame gardés sur `state>=3`, diffusion d'événements script
  « Step », `vmethod_9` = build-once de la liste via flag `this+0x1EC`). Elle **affiche** les infos
  tir/arrêt à l'écran ; elle ne calcule **pas** la trajectoire ni le but.

## Conclusion / prochaines cibles

La **résolution physique tir→but** n'est ni dans l'event-check (FSM générique) ni dans le
shoot-catch (menu). Prochaines cibles RE : **`BallMoveNormal::update`** (la méthode de mouvement du
ballon, absente du décompilé iecode — cf. `nie-core/ball.rs`), **`GoalnetComponent`** et
**`BallMoveGoalnet`** (collision filet/but). Le moteur jouable `nie-runtime` utilise pour l'instant
une physique Rust propre (gravité ancrée 2.0) ; ces fonctions la remplaceront byte-exact quand
reversées (statut distinct « reversé, non validé runtime »).
