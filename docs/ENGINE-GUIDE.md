# niers — guide moteur : best practices Lua+Rust & jeu Rust (appliquées au cap pixel-perfect)

> Sources (consultées 2026-06-14) : mlua docs/README (docs.rs/crate/mlua, github mlua-rs),
> « Top 7 Rust ECS techniques » (techbuddies.io, 2025-12), « wgpu 2026 » (rustify.rs),
> game-loop / fix-your-timestep (sunjay.dev, joetsoi). Filtré par la contrainte NON
> NÉGOCIABLE de niers : **déterminisme byte/pixel-exact vs nie.exe** — toute pratique qui
> introduit du non-déterminisme ou masque l'octet est écartée (cf. `docs/STACK.md`).

## 1. Lua + Rust (mlua) — pour `nie-lua`

La VM est PUC-Rio Lua 5.2.4 vendored = celle du jeu (`docs/STACK.md`). Règles :

- **Fonctions hôtes** = `lua.create_function(|lua, args: (T1,T2)| -> LuaResult<R> { … })` puis
  `lua.globals().set("Nom", f)`. C'est le seul pont sûr ; **ne jamais toucher la pile Lua C**
  (mlua protège chaque longjmp via `lua_pcall`).
- **Erreurs, pas panics** : un `panic!` dans un callback Rust est capturé et converti en
  erreur Lua (récupérable via `pcall`). Pour le byte-exact on veut des **`LuaResult` propres**,
  pas des panics : retourner `Err(mlua::Error…)`, réserver le panic aux invariants impossibles.
- **Bytecode** : charger un `.lua.bin` exige `Lua::unsafe_new` (un bytecode malformé peut
  corrompre la VM). Le jeu = bytecode de confiance → OK, isolé dans `nie-lua` (hors
  `forbid(unsafe_code)`). Vérifier la signature `1b 4c 75 61 52` avant (`is_lua52_bytecode`).
- **Types Rust → Lua** : `UserData` (méthodes/champs) ; pour un type étranger (orphan rule)
  `register_userdata_type`. **Piège** : placer un handle Lua dans un `UserData`/callback crée
  un **cycle de références** qui empêche de détruire la VM — passer par des IDs/poignées, pas
  des handles Lua stockés.
- **État partagé hôte** : VM **mono-thread** → garder mlua `!Send` (PAS la feature `send`,
  qui coûte) et partager via `Rc<RefCell<…>>` cloné dans chaque closure (cf. `MenuState`).
  Pour de l'état global, `lua.set_app_data` / la registry plutôt que des globals Lua.
- **Perf** : **réutiliser une seule `Lua`** (création coûteuse) ; les valeurs-référence Lua
  sont *cheap to clone* (≥ mlua 0.11) ; `Variadic<T>` a un push pile rapide. Précharger les
  modules `INCLUDE` une fois.
- **Sandboxing** : on N'a PAS besoin de sandbox (scripts du jeu, de confiance) — au contraire
  on veut les vraies libs (`unsafe_new`). Mais isoler chaque écran dans sa propre VM si l'état
  global Lua doit être propre entre menus.

## 2. Jeu en Rust — pour `nie-game` / la boucle moteur

- **Pas tracée : timestep FIXE déterministe.** Simuler la logique à pas fixe (le tick réel du
  moteur Lives), **borner les frames longues**, **rendre depuis un état interpolé**. C'est LA
  condition du pixel/byte-exact reproductible (et ça rejoint le PRNG `lives::CRand` déjà porté
  byte-exact). Jamais de logique pilotée par le delta-time variable.
- **Pipeline de frame** : `entrées → update simulation → préparer données de rendu → présenter`.
  Les entrées sont normalisées en un `InputState` **consommé par la logique plus tard dans la
  frame** (zéro lag d'une frame). Le rendu **lit** l'état, ne contient **aucune règle de jeu**.
- **Rendu/entrées/physique = adaptateurs** autour de la donnée gameplay. La physique (PhysX
  porté) = boîte noire déterministe avec points de sync explicites (écrire l'état → step → relire).
- **PAS d'ECS** (décision niers, cf. `docs/STACK.md`) : le byte-exact exige des **structs 1:1**
  avec le layout C++ (offsets `0x700`, strides `0x570`…) — un ECS éclate ces structs. On garde
  donc l'idée « **données pures, sans comportement, sérialisables** » (état testable headless,
  save/load) MAIS dans des structs miroir, pas un framework ECS. (L'advice ECS/Bevy de la
  littérature ne s'applique PAS ici ; seuls les *principes* (séparation, déterminisme) tiennent.)
- **wgpu** : un seul pipeline natif (Vulkan/lavapipe sous WSLg — cf. fix `nie-game`) + wasm
  (WebGPU) compagnon. Garder **gameplay + timing en Rust**, le host (winit natif / JS wasm) =
  couche fine. Le web doit refléter l'archi native.
- **Validation** : tester les systèmes comme **fonctions pures sur la donnée** (monde minimal,
  assert sur l'état) ; rejouer la même `step()` en headless (`nie-headless`) sans rendu = gate
  de déterminisme. Le rendu se valide par diff pixel vs capture du jeu (gate SSIM/octet, à venir).

## 3. Conséquences concrètes pour la boucle niers

1. `nie-core` expose `fn step(&mut self, input: &InputState, rng: &mut CRand) -> SceneOutcome`
   à **pas fixe** (déterministe, déjà l'esprit de `match_sim`/`match_fsm::tick`).
2. `nie-lua` exécute la logique de menu/scène réelle (callbacks `OnOpenLayer` etc.) → produit
   un état (`MenuState`) ; les fonctions hôtes mutent cet état, **sans rendu**.
3. `nie-game` (host) : winit + wgpu fournit `InputState` + temps + présente l'état rendu ;
   `nie-headless` rejoue la même logique sans fenêtre (golden déterministe).
4. Tout ce qui est aléatoire passe par `lives::CRand` (MT19937 byte-exact), jamais l'horloge.
