//! **Moteur de jeu niers** — boucle intégrée qui TOURNE (état-monde + physique + gameplay),
//! en Rust pur, headless et **déterministe**. Le rendu top-down vit dans [`render`], la boucle
//! et la sortie vidéo dans le binaire `nie-runtime`.
//!
//! C'est le *cadre* exécutable du moteur : une simulation de football jouable de bout en bout
//! (22 joueurs + ballon, physique, possession, buts) où la logique reversée de IEVR se branche
//! incrémentalement. Ancrages RE réels : la **gravité du ballon = [`nie_core::BALL_GRAVITY`]**
//! (`2.0`, bits IEEE `0x40000000`, confirmés dans `ball_component.c`), 11 v 11, un GK par camp.
//!
//! Ce qui est **propre au moteur niers** (simulation temps-réel jouable) est distinct de ce qui
//! est **porté byte-exact** de IEVR (constantes, structures). La physique PhysX exacte et la
//! résolution de but event-driven de IEVR sont des pistes séparées (cf. `nie-engine`, le système
//! d'événements reversé) qui remplaceront progressivement les approximations d'ici.

#![forbid(unsafe_code)]

pub mod g4mt;
pub mod render;

pub use nie_core::animation::{
    AnimationClip, AnimationError, BoneId, BonePose, BoneTrack, Keyframe, PoseFrame, Rotation,
    SkeletonId,
};

use nie_core::BALL_GRAVITY;

// Vecteurs : SOURCE UNIQUE `nie_geom` (dédup Phase 2). Alias V2/V3 pour préserver le code local.
// Convention nie-runtime : `z` = hauteur (vit dans le code ; le type est axis-agnostique).
// ⚠ Ne pas convertir vers/depuis `nie_core::Vec3` (y=hauteur) — cf. `docs/ARCHITECTURE.md` landmine #4.
use nie_geom::{Vec2 as V2, Vec3 as V3};

// ── Cadence de simulation ───────────────────────────────────────────────────────
//
// `docs/STACK.md` l'impose : « Timestep fixe. La logique tourne au tick réel du moteur Lives,
// les frames longues sont bornées, le rendu part d'un état interpolé. C'est la condition du
// reproductible. Jamais de logique pilotée par un delta-time variable. »
//
// Jusqu'au 2026-09-20 ces constantes vivaient dans `nie-net::protocol` : le RÉSEAU déclarait la
// cadence du jeu. L'inversion coûtait cher — `nie-play` avançait à 1/30 et personne ne le
// voyait, alors que le serveur autoritaire diffusait du 60 Hz. Deux hôtes, deux simulations, et
// un hachage de synchronisation incapable de les réconcilier. Le moteur possède sa cadence ;
// `nie-net` la reprend d'ici, ce qui rend la dérive impossible plutôt qu'improbable.

/// Nombre de pas de simulation par seconde.
pub const TICK_RATE_HZ: u32 = 60;

/// Durée d'un pas de simulation, en secondes.
pub const TICK_DT: f32 = 1.0 / TICK_RATE_HZ as f32;

/// Nombre maximal de pas rattrapés en un seul appel à [`FixedStep::advance`].
///
/// Sans borne, une frame longue (chargement, point d'arrêt, machine surchargée) demande des
/// centaines de pas, qui prennent encore plus de temps, qui en demandent plus encore : c'est la
/// spirale de la mort. Au-delà de cette borne le temps en trop est **abandonné** — le jeu
/// ralentit visiblement, ce qui est un symptôme honnête, là où une spirale se lit comme un
/// blocage.
pub const MAX_CATCHUP_STEPS: u32 = 5;

/// Accumulateur de pas fixe : convertit un temps d'horloge variable en un nombre entier de pas.
///
/// Un hôte (fenêtre, navigateur, serveur) reçoit des frames de durée variable ; la simulation,
/// elle, ne doit avancer que par pas de [`TICK_DT`]. Cet accumulateur est la charnière, et le
/// dépôt n'en avait aucune : chaque appelant passait son propre `dt` à [`World::step`], si bien
/// qu'il existait autant de simulations que d'hôtes.
///
/// ```
/// use nie_runtime::{FixedStep, TICK_DT};
/// let mut pas = FixedStep::default();
/// // Une frame d'exactement deux pas en rend deux, sans reste.
/// assert_eq!(pas.advance(TICK_DT * 2.0), 2);
/// // Une demi-frame n'en rend aucun : le temps est conservé pour la suivante.
/// assert_eq!(pas.advance(TICK_DT * 0.5), 0);
/// assert_eq!(pas.advance(TICK_DT * 0.5), 1);
/// ```
#[derive(Debug, Clone, Copy)]
pub struct FixedStep {
    /// Temps d'horloge reçu et pas encore consommé, en secondes.
    accumulateur: f32,
    /// Durée d'un pas.
    dt: f32,
    /// Borne de rattrapage.
    max_catchup: u32,
}

impl Default for FixedStep {
    fn default() -> Self {
        Self::new(TICK_DT, MAX_CATCHUP_STEPS)
    }
}

impl FixedStep {
    /// Construit un accumulateur. `dt` non fini ou non strictement positif retombe sur
    /// [`TICK_DT`] : un pas nul ou négatif ferait boucler l'appelant indéfiniment.
    #[must_use]
    pub fn new(dt: f32, max_catchup: u32) -> Self {
        let dt = if dt.is_finite() && dt > 0.0 {
            dt
        } else {
            TICK_DT
        };
        Self {
            accumulateur: 0.0,
            dt,
            max_catchup: max_catchup.max(1),
        }
    }

    /// Durée d'un pas.
    #[must_use]
    pub fn dt(&self) -> f32 {
        self.dt
    }

    /// Temps d'horloge accumulé et pas encore consommé, en secondes.
    #[must_use]
    pub fn reste(&self) -> f32 {
        self.accumulateur
    }

    /// Ce même reste, en **fraction d'un pas** — le facteur d'interpolation du rendu.
    ///
    /// `docs/STACK.md` demande que « le rendu part d'un état interpolé », et c'est cette valeur
    /// qui le permet : à `0.5`, l'image doit montrer le monde à mi-chemin entre le pas précédent
    /// et le pas courant. Sans elle, une simulation à 60 Hz affichée à 144 Hz montre la même
    /// image plusieurs fois de suite puis saute — le mouvement paraît saccadé alors que la
    /// simulation est parfaitement régulière, et on va chercher le défaut dans la physique.
    ///
    /// Nommée d'après `bevy_time::Fixed::overstep_fraction`, dont la lecture a révélé que
    /// `reste()` seul laissait cette division à chaque appelant — c'est-à-dire à personne,
    /// puisque aucun hôte du dépôt n'interpole aujourd'hui.
    ///
    /// Toujours dans `[0, 1)` tant que la borne de rattrapage n'est pas atteinte.
    #[must_use]
    pub fn overstep_fraction(&self) -> f32 {
        self.accumulateur / self.dt
    }

    /// Absorbe `wall_dt` secondes d'horloge et rend le nombre de pas à exécuter.
    ///
    /// Un `wall_dt` non fini ou négatif rend `0` **sans toucher à l'accumulateur** : une horloge
    /// qui recule ou déborde est un défaut de l'hôte, et l'empoisonner ferait payer à la
    /// simulation une faute qui n'est pas la sienne.
    pub fn advance(&mut self, wall_dt: f32) -> u32 {
        if !wall_dt.is_finite() || wall_dt < 0.0 {
            return 0;
        }
        self.accumulateur += wall_dt;
        let mut pas = 0;
        while self.accumulateur >= self.dt && pas < self.max_catchup {
            self.accumulateur -= self.dt;
            pas += 1;
        }
        if pas == self.max_catchup {
            // Borne atteinte : le temps en trop est abandonné plutôt que reporté, sans quoi le
            // retard se cumulerait d'une frame à l'autre.
            self.accumulateur = self.accumulateur.min(self.dt);
        }
        pas
    }
}

// ── Dimensions du terrain (mètres, origine au centre) ───────────────────────────
/// Demi-longueur (but à but) : terrain 105 m.
pub const HALF_LEN: f32 = 52.5;
/// Demi-largeur (touche à touche) : terrain 68 m.
pub const HALF_WID: f32 = 34.0;
/// Demi-largeur des buts (largeur réglementaire 7,32 m).
pub const GOAL_HALF: f32 = 3.66;
/// Hauteur de la barre transversale (2,44 m).
pub const GOAL_HEIGHT: f32 = 2.44;

// ── Paramètres physiques (unités-jeu ; gravité ancrée sur la RE) ─────────────────
/// Restitution du ballon au sol (rebond).
const RESTITUTION: f32 = 0.6;
/// Friction de roulement au sol (par seconde).
const GROUND_FRICTION: f32 = 0.9;
/// Traînée aérienne légère (par seconde).
const AIR_DRAG: f32 = 0.05;
/// Rayon de contrôle du ballon par un joueur (mètres).
const CONTROL_RADIUS: f32 = 1.4;
/// Rayon de tacle : un adverse à cette distance vole la possession (< contrôle → hystérésis).
const STEAL_RADIUS: f32 = 0.7;
/// Rayon de parade du gardien : il dégage un tir/ballon bas passant à cette distance (m).
const SAVE_RADIUS: f32 = 1.5;
/// Distance au but adverse en deçà de laquelle le porteur tire au lieu de dribbler (m).
const SHOOT_RANGE: f32 = 18.0;
/// Vitesse de dribble du ballon poussé devant le porteur (m/s).
const DRIBBLE_SPEED: f32 = 9.0;
/// Vitesse de course max d'un joueur (m/s).
const PLAYER_SPEED: f32 = 7.0;
/// Puissance de frappe (m/s) imprimée au ballon vers le but adverse.
const KICK_POWER: f32 = 26.0;
/// Composante verticale d'une frappe (loft) — basse pour des tirs tendus qui restent sous la barre.
const KICK_LOFT: f32 = 1.0;
/// Cadence minimale entre deux frappes du même porteur (s).
const KICK_COOLDOWN: f32 = 0.35;
/// Durée d'immunité au tacle après une récupération (s) — crée des courses d'attaque nettes.
const POSSESSION_LOCK: f32 = 0.55;

/// Rôle d'un joueur sur le terrain (détermine sa zone de base).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Role {
    Goalkeeper,
    Defender,
    Midfielder,
    Forward,
}

/// Un joueur : position/vitesse au sol, équipe (0 = domicile attaque +x, 1 = extérieur attaque −x).
#[derive(Debug, Clone, Copy)]
pub struct Player {
    pub pos: V2,
    pub vel: V2,
    pub team: u8,
    pub role: Role,
    /// Position de base (ancrage de formation) vers laquelle le joueur revient hors action.
    pub home: V2,
}

/// Le ballon : position 3D + vitesse 3D + gravité (ancrée RE).
#[derive(Debug, Clone, Copy)]
pub struct Ball {
    pub pos: V3,
    pub vel: V3,
    pub gravity: f32,
}

impl Default for Ball {
    fn default() -> Self {
        Self {
            pos: V3::new(0.0, 0.0, 0.11),
            vel: V3::default(),
            gravity: BALL_GRAVITY,
        }
    }
}

/// Ce que la joueuse demande au joueur qu'elle contrôle, pour le pas de simulation à venir.
///
/// Un état, pas un événement : une direction se **maintient** tant qu'une touche est enfoncée,
/// là où un menu réagit à des appuis. Le front remplit cette structure à chaque image ; le moteur
/// ne sait pas d'où elle vient (clavier, manette, rejeu enregistré).
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct Input {
    /// Direction voulue, en mètres par seconde normalisés — zéro = le joueur s'arrête.
    pub dir: V2,
    /// Frapper le ballon cette image, si le joueur contrôlé le possède.
    pub shoot: bool,
}

/// État complet du monde simulé à un instant donné.
#[derive(Debug, Clone)]
pub struct World {
    pub ball: Ball,
    pub players: Vec<Player>,
    /// Entrée de la joueuse pour le prochain [`World::step`].
    ///
    /// Laissée à zéro, la simulation reste **exactement** ce qu'elle était : les 22 joueurs sont
    /// pilotés par l'IA. C'est ce qui permet d'ajouter le contrôle sans invalider les rejeux
    /// déterministes ni les tests de simulation existants.
    pub input: Input,
    /// Entrée de l'équipe adverse (extérieur / team 1) pour le prochain [`World::step`].
    ///
    /// Utilisé en mode multijoueur / réseau. Si laissée à zéro, l'équipe extérieur reste
    /// pilotée 100% par l'IA.
    pub away_input: Input,
    /// Buts marqués `[domicile, extérieur]`.
    pub score: [u32; 2],
    /// Temps de jeu simulé (s).
    pub time: f32,
    /// Compteur de pas de simulation (déterministe).
    pub tick: u64,
    /// Index du dernier porteur (pour le cooldown de frappe), et son chrono.
    possessor: Option<usize>,
    kick_timer: f32,
    /// Immunité au tacle après récupération (s) : donne au porteur un burst d'attaque net.
    steal_lock: f32,
}

/// Formation 4-4-2 en fractions du demi-terrain pour l'équipe domicile (attaque +x).
/// `(x_frac, y_frac)` ∈ [−1, 1] ; mappé en mètres par [`HALF_LEN`]/[`HALF_WID`].
const FORMATION_442: [(f32, f32, Role); 11] = [
    (-0.95, 0.0, Role::Goalkeeper),
    (-0.6, -0.7, Role::Defender),
    (-0.6, -0.25, Role::Defender),
    (-0.6, 0.25, Role::Defender),
    (-0.6, 0.7, Role::Defender),
    (-0.15, -0.7, Role::Midfielder),
    (-0.15, -0.25, Role::Midfielder),
    (-0.15, 0.25, Role::Midfielder),
    (-0.15, 0.7, Role::Midfielder),
    (-0.3, -0.2, Role::Forward),
    (-0.3, 0.2, Role::Forward),
];

impl World {
    /// Coup d'envoi : 22 joueurs en 4-4-2 (domicile + extérieur miroir), ballon au centre.
    #[must_use]
    pub fn kickoff() -> Self {
        let mut players = Vec::with_capacity(22);
        for &(xf, yf, role) in &FORMATION_442 {
            // Domicile : attaque +x, sa moitié = −x.
            let home0 = V2::new(xf * HALF_LEN, yf * HALF_WID);
            players.push(Player {
                pos: home0,
                vel: V2::default(),
                team: 0,
                role,
                home: home0,
            });
            // Extérieur : miroir (attaque −x).
            let home1 = V2::new(-xf * HALF_LEN, yf * HALF_WID);
            players.push(Player {
                pos: home1,
                vel: V2::default(),
                team: 1,
                role,
                home: home1,
            });
        }
        Self {
            ball: Ball::default(),
            players,
            input: Input::default(),
            away_input: Input::default(),
            score: [0, 0],
            time: 0.0,
            tick: 0,
            possessor: None,
            kick_timer: 0.0,
            steal_lock: 0.0,
        }
    }

    /// Index du joueur que la joueuse contrôle, dans l'équipe **domicile** (team 0).
    #[must_use]
    pub fn controlled(&self) -> Option<usize> {
        self.controlled_for_team(0)
    }

    /// Index du joueur contrôlé pour une équipe donnée (`0` = domicile, `1` = extérieur).
    ///
    /// Le porteur s'il est de cette équipe, sinon le joueur de champ le plus proche du ballon.
    /// Le gardien est exclu pour ne pas déserter sa cage.
    #[must_use]
    pub fn controlled_for_team(&self, team: u8) -> Option<usize> {
        if let Some(i) = self.possessor
            && self.players.get(i).is_some_and(|p| p.team == team)
        {
            return Some(i);
        }
        let ball2 = self.ball.pos.ground();
        self.players
            .iter()
            .enumerate()
            .filter(|(_, p)| p.team == team && p.role != Role::Goalkeeper)
            .min_by(|(_, a), (_, b)| {
                let (da, db) = ((a.pos - ball2).len(), (b.pos - ball2).len());
                da.partial_cmp(&db).unwrap_or(core::cmp::Ordering::Equal)
            })
            .map(|(i, _)| i)
    }

    /// Hachage FNV-1a 32 bits de **tout ce que [`step`](Self::step) peut changer**.
    ///
    /// `nie-net` le diffuse dans `TickSync` pour détecter une désynchronisation entre clients.
    /// Un tel détecteur ne vaut que par sa couverture : jusqu'au 2026-09-20 il ignorait `tick`,
    /// `time`, `kick_timer` et `steal_lock`, si bien que **deux mondes qui allaient diverger
    /// hachaient pareil**. Ce n'est pas théorique — `kick_timer` décide si une frappe part
    /// (`cmd_shoot && self.kick_timer <= 0.0`) et `steal_lock` si un tacle aboutit : deux
    /// clients pouvaient se croire d'accord et jouer deux parties différentes, la divergence
    /// n'apparaissant qu'au pas suivant, par ses conséquences, ou jamais.
    ///
    /// # Ce qui entre, et ce qui n'entre pas
    ///
    /// Entrent tous les champs que `step` mute : `tick`, `time`, `kick_timer`, `steal_lock`,
    /// `score`, `possessor`, le ballon et les joueurs. `team`, `role` et `home` n'entrent pas :
    /// ils sont posés au coup d'envoi et **aucun chemin ne les réécrit** (vérifié 2026-09-20) ;
    /// les ajouter coûterait 22 tours de boucle pour des valeurs identiques par construction.
    /// Le jour où une remplaçante ou un changement de formation les mute, ils doivent entrer.
    ///
    /// `input` et `away_input` n'entrent pas non plus, et c'est délibéré : ce sont les entrées
    /// du **prochain** pas, pas de l'état atteint. En lockstep elles voyagent par leur propre
    /// canal, et deux clients les appliquent à des instants différents — les hacher ferait
    /// crier la désynchronisation sur un fonctionnement normal.
    ///
    /// Un `f32` est haché par ses **bits**, pas par sa valeur : `-0.0` et `+0.0` sont égaux au
    /// sens de `==` mais ne sont pas le même état, et `NaN` n'est égal à rien, pas même à
    /// lui-même. Un comparateur de synchronisation doit voir l'octet.
    #[must_use]
    pub fn state_hash(&self) -> u32 {
        let mut h: u32 = 0x811c9dc5;
        let mut feed = |val: u32| {
            h ^= val;
            h = h.wrapping_mul(0x01000193);
        };
        feed(self.ball.pos.x.to_bits());
        feed(self.ball.pos.y.to_bits());
        feed(self.ball.pos.z.to_bits());
        feed(self.ball.vel.x.to_bits());
        feed(self.ball.vel.y.to_bits());
        feed(self.ball.vel.z.to_bits());
        feed(self.score[0]);
        feed(self.score[1]);
        feed(self.possessor.map_or(0xFFFFFFFF, |p| p as u32));
        // Le compteur de pas : deux mondes à des ticks différents ne sont pas le même état,
        // même si leurs positions coïncident. Un `u64` se hache en deux mots.
        feed((self.tick & 0xFFFF_FFFF) as u32);
        feed((self.tick >> 32) as u32);
        feed(self.time.to_bits());
        // Les deux verrous décident du comportement du pas suivant : les omettre rendait une
        // désynchronisation invisible jusqu'à ce qu'elle produise ses effets.
        feed(self.kick_timer.to_bits());
        feed(self.steal_lock.to_bits());
        for p in &self.players {
            feed(p.pos.x.to_bits());
            feed(p.pos.y.to_bits());
            feed(p.vel.x.to_bits());
            feed(p.vel.y.to_bits());
        }
        h
    }

    /// Avance la simulation d'un pas `dt` (secondes). Déterministe.
    pub fn step(&mut self, dt: f32) {
        self.tick += 1;
        self.time += dt;
        if self.kick_timer > 0.0 {
            self.kick_timer -= dt;
        }
        if self.steal_lock > 0.0 {
            self.steal_lock -= dt;
        }
        self.step_players(dt);
        self.step_ball(dt);
        self.resolve_possession(dt);
        self.keeper_save();
        if self.detect_goal() {
            self.reset_after_goal();
        }
    }

    /// Déplace chaque joueur : le **porteur** fonce vers le but adverse (attaque), le plus proche
    /// de l'équipe défendante chasse le ballon (sauf le GK qui garde sa cage), les autres tiennent
    /// leur position de formation.
    fn step_players(&mut self, dt: f32) {
        let ball2 = self.ball.pos.ground();
        let carrier = self.possessor;
        // Joueurs sous contrôle pour chaque équipe (0 = domicile, 1 = extérieur).
        // Seulement s'il y a une direction demandée. Sans entrée, le joueur reste piloté par l'IA.
        let pilote_home = (self.input.dir.len() > 0.01)
            .then(|| self.controlled_for_team(0))
            .flatten();
        let pilote_away = (self.away_input.dir.len() > 0.01)
            .then(|| self.controlled_for_team(1))
            .flatten();
        // Plus proche par équipe.
        let mut nearest = [usize::MAX, usize::MAX];
        let mut best = [f32::MAX, f32::MAX];
        for (i, p) in self.players.iter().enumerate() {
            let d = (p.pos - ball2).len();
            let t = p.team as usize;
            if d < best[t] {
                best[t] = d;
                nearest[t] = i;
            }
        }
        for (i, p) in self.players.iter_mut().enumerate() {
            let target = if carrier == Some(i) {
                // Porteur : sprinte vers le but adverse en GARDANT sa position latérale
                // (jeu 2D ; léger recentrage pour finir face au but).
                V2::new(
                    if p.team == 0 { HALF_LEN } else { -HALF_LEN },
                    p.pos.y * 0.85,
                )
            } else if nearest[p.team as usize] == i
                && !(p.role == Role::Goalkeeper && ball2.x.abs() < HALF_LEN * 0.5)
            {
                // Chasseur : récupère le ballon (le GK ne sort pas loin de sa cage).
                ball2
            } else {
                p.home
            };
            // Le joueur pilote obéit à la direction demandée, pas à sa cible d'IA.
            let dir = if pilote_home == Some(i) {
                self.input.dir.norm()
            } else if pilote_away == Some(i) {
                self.away_input.dir.norm()
            } else {
                (target - p.pos).norm()
            };
            p.vel = dir * PLAYER_SPEED;
            p.pos = p.pos + p.vel * dt;
            p.pos.x = p.pos.x.clamp(-HALF_LEN, HALF_LEN);
            p.pos.y = p.pos.y.clamp(-HALF_WID, HALF_WID);
        }
    }

    /// Physique du ballon : intégrateur d'Euler semi-implicite + gravité + rebond + frictions.
    fn step_ball(&mut self, dt: f32) {
        let b = &mut self.ball;
        // Gravité (descend) + traînée aérienne.
        b.vel.z -= b.gravity * dt;
        let drag = 1.0 - AIR_DRAG * dt;
        b.vel.x *= drag;
        b.vel.y *= drag;
        // Intégration position.
        b.pos.x += b.vel.x * dt;
        b.pos.y += b.vel.y * dt;
        b.pos.z += b.vel.z * dt;
        // Sol : rebond + friction de roulement.
        if b.pos.z <= 0.0 {
            b.pos.z = 0.0;
            if b.vel.z < 0.0 {
                b.vel.z = -b.vel.z * RESTITUTION;
                if b.vel.z < 0.2 {
                    b.vel.z = 0.0;
                }
            }
            let roll = GROUND_FRICTION.powf(dt);
            b.vel.x *= roll;
            b.vel.y *= roll;
        }
        // Rebond sur les touches (la ligne de but est gérée par detect_goal).
        if b.pos.y.abs() > HALF_WID {
            b.pos.y = b.pos.y.clamp(-HALF_WID, HALF_WID);
            b.vel.y = -b.vel.y * RESTITUTION;
        }
    }

    /// Possession **collante** + dribble/tir. Le porteur courant garde le ballon tant qu'aucun
    /// adverse n'entre dans le rayon de tacle ([`STEAL_RADIUS`]) ; il dribble vers le but adverse
    /// et frappe une fois à portée de tir ([`SHOOT_RANGE`]). Crée un jeu directionnel (→ buts),
    /// au lieu d'une oscillation centrale.
    fn resolve_possession(&mut self, _dt: f32) {
        let ball2 = self.ball.pos.ground();
        let low = self.ball.pos.z < 0.6;

        // Plus proche joueur (global) et son équipe.
        let mut nearest = (usize::MAX, f32::MAX);
        for (i, p) in self.players.iter().enumerate() {
            let d = (p.pos - ball2).len();
            if d < nearest.1 {
                nearest = (i, d);
            }
        }

        // Porteur courant conservé s'il reste à portée de contrôle.
        let prev = self.possessor;
        let keep = prev.filter(|&i| (self.players[i].pos - ball2).len() < CONTROL_RADIUS);
        let owner = match keep {
            // Conserve sauf si un ADVERSE entre dans le rayon de tacle (hors verrou de possession).
            Some(c) => {
                let opp_steal = self.steal_lock <= 0.0
                    && nearest.0 != usize::MAX
                    && self.players[nearest.0].team != self.players[c].team
                    && nearest.1 < STEAL_RADIUS;
                if opp_steal { Some(nearest.0) } else { Some(c) }
            }
            // Sinon le plus proche prend, s'il est à portée de contrôle.
            None if nearest.1 < CONTROL_RADIUS => Some(nearest.0),
            None => None,
        };
        self.possessor = owner;
        if owner.is_some() && owner != prev {
            self.steal_lock = POSSESSION_LOCK; // burst d'attaque à la récupération
        }

        let Some(i) = owner else { return };
        if !low {
            return; // ballon en l'air : pas de contrôle au sol.
        }
        let team = self.players[i].team;
        // Frappe commandée : quand le joueur contrôlé tient le ballon et appuie sur tir, il frappe
        // MAINTENANT, dans la direction demandée.
        let cmd_shoot = if team == 0 {
            self.input.shoot && Some(i) == self.controlled_for_team(0)
        } else {
            self.away_input.shoot && Some(i) == self.controlled_for_team(1)
        };
        if cmd_shoot && self.kick_timer <= 0.0 {
            let user_dir = if team == 0 {
                self.input.dir
            } else {
                self.away_input.dir
            };
            let vise = if user_dir.len() > 0.01 {
                user_dir.norm()
            } else {
                (V2::new(if team == 0 { HALF_LEN } else { -HALF_LEN }, 0.0) - ball2).norm()
            };
            self.ball.vel = V3::new(vise.x * KICK_POWER, vise.y * KICK_POWER, KICK_LOFT);
            self.kick_timer = KICK_COOLDOWN;
            return;
        }

        // But adverse : domicile (0) → +x, extérieur (1) → −x. On vise le but en suivant la
        // position latérale du PORTEUR (jeu/tirs 2D au lieu d'un axe central dégénéré) ; la cible
        // reste dans la largeur du but à l'approche.
        let goal_x = if team == 0 { HALF_LEN } else { -HALF_LEN };
        // Dribble : pousse le ballon vers le but en suivant l'angle latéral du porteur.
        let drib_y = (self.players[i].pos.y * 0.7).clamp(-HALF_WID * 0.5, HALF_WID * 0.5);
        let to_goal = V2::new(goal_x, drib_y) - ball2;
        if to_goal.len() < SHOOT_RANGE && self.kick_timer <= 0.0 {
            // Tir placé : vise le poteau OPPOSÉ au gardien adverse (le bat s'il est mal placé).
            let gk_y = self
                .players
                .iter()
                .find(|p| p.team != team && p.role == Role::Goalkeeper)
                .map_or(0.0, |g| g.pos.y);
            let post = if gk_y >= 0.0 {
                -GOAL_HALF * 0.82
            } else {
                GOAL_HALF * 0.82
            };
            let dir = (V2::new(goal_x, post) - ball2).norm();
            self.ball.vel = V3::new(dir.x * KICK_POWER, dir.y * KICK_POWER, KICK_LOFT);
            self.kick_timer = KICK_COOLDOWN;
        } else {
            let dir = to_goal.norm();
            self.ball.vel.x = dir.x * DRIBBLE_SPEED;
            self.ball.vel.y = dir.y * DRIBBLE_SPEED;
        }
    }

    /// Parade du gardien : si un ballon **bas** approche le but d'une équipe et que son GK est à
    /// portée ([`SAVE_RADIUS`]), il le dégage vers le terrain et en reprend possession. Donne à la
    /// défense un vrai outil → les buts se méritent (et le match s'équilibre).
    fn keeper_save(&mut self) {
        if self.ball.pos.z >= GOAL_HEIGHT {
            return; // au-dessus de la barre : pas parable au sol.
        }
        let ball2 = self.ball.pos.ground();
        for team in 0u8..2 {
            let own_goal_x = if team == 0 { -HALF_LEN } else { HALF_LEN };
            if (ball2.x - own_goal_x).abs() > 16.5 {
                continue; // hors du tiers défensif proche du but.
            }
            let Some(gk) = self
                .players
                .iter()
                .position(|p| p.team == team && p.role == Role::Goalkeeper)
            else {
                continue;
            };
            if (self.players[gk].pos - ball2).len() < SAVE_RADIUS {
                // Dégagement en cloche douce vers le centre du terrain.
                let away = if team == 0 { 1.0 } else { -1.0 };
                self.ball.vel = V3::new(away * 9.0, ball2.y * -0.2, 3.0);
                self.possessor = Some(gk);
                self.kick_timer = KICK_COOLDOWN;
            }
        }
    }

    /// `true` si le ballon a franchi une ligne de but entre les poteaux et sous la barre.
    fn detect_goal(&mut self) -> bool {
        let b = self.ball.pos;
        let inside = b.y.abs() < GOAL_HALF && b.z < GOAL_HEIGHT;
        if b.x > HALF_LEN && inside {
            self.score[0] += 1; // domicile marque dans le but +x
            true
        } else if b.x < -HALF_LEN && inside {
            self.score[1] += 1;
            true
        } else {
            // Sortie de but sans but : ramener le ballon dans le terrain (rebond simple).
            if b.x.abs() > HALF_LEN {
                self.ball.pos.x = b.x.clamp(-HALF_LEN, HALF_LEN);
                self.ball.vel.x = -self.ball.vel.x * RESTITUTION;
            }
            false
        }
    }

    /// Remet le ballon au centre et les joueurs à leur formation après un but.
    fn reset_after_goal(&mut self) {
        self.ball = Ball::default();
        for p in &mut self.players {
            p.pos = p.home;
            p.vel = V2::default();
        }
        self.possessor = None;
        self.kick_timer = KICK_COOLDOWN;
        self.steal_lock = 0.0;
    }

    /// Index du porteur actuel (le plus proche à portée de contrôle), s'il y en a un.
    #[must_use]
    pub fn possessor(&self) -> Option<usize> {
        self.possessor
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kickoff_pose_22_joueurs_et_ballon_au_centre() {
        let w = World::kickoff();
        assert_eq!(w.players.len(), 22);
        assert_eq!(w.players.iter().filter(|p| p.team == 0).count(), 11);
        assert_eq!(
            w.players
                .iter()
                .filter(|p| p.role == Role::Goalkeeper)
                .count(),
            2
        );
        assert!(w.ball.pos.ground().len() < 0.01, "ballon au centre");
        assert_eq!(w.ball.gravity, BALL_GRAVITY);
    }

    #[test]
    fn ballon_tombe_sous_la_gravite() {
        let mut w = World::kickoff();
        w.players.clear(); // pas d'interférence de possession
        w.ball.pos = V3::new(0.0, 0.0, 5.0);
        w.ball.vel = V3::default();
        let z0 = w.ball.pos.z;
        for _ in 0..10 {
            w.step(1.0 / 60.0);
        }
        assert!(
            w.ball.pos.z < z0,
            "le ballon descend ({} < {z0})",
            w.ball.pos.z
        );
    }

    #[test]
    fn ballon_rebondit_au_sol_avec_perte() {
        let mut w = World::kickoff();
        w.players.clear();
        w.ball.pos = V3::new(0.0, 0.0, 0.05);
        w.ball.vel = V3::new(0.0, 0.0, -5.0);
        w.step(1.0 / 60.0);
        assert!(
            w.ball.vel.z > 0.0,
            "rebond : vitesse verticale inversée ({})",
            w.ball.vel.z
        );
        assert!(w.ball.vel.z < 5.0, "rebond amorti (restitution < 1)");
    }

    #[test]
    fn joueur_le_plus_proche_converge_vers_le_ballon() {
        let mut w = World::kickoff();
        w.ball.pos = V3::new(0.0, 0.0, 0.11);
        let nearest = w
            .players
            .iter()
            .enumerate()
            .min_by(|a, b| {
                a.1.pos
                    .len()
                    .partial_cmp(&b.1.pos.len())
                    .unwrap_or(core::cmp::Ordering::Equal)
            })
            .map(|(i, _)| i)
            .unwrap();
        let d0 = w.players[nearest].pos.len();
        for _ in 0..30 {
            w.step(1.0 / 60.0);
        }
        let d1 = (w.players[nearest].pos - w.ball.pos.ground()).len();
        assert!(d1 < d0, "le joueur se rapproche du ballon ({d1} < {d0})");
    }

    #[test]
    fn but_incremente_le_score_et_relance_au_centre() {
        let mut w = World::kickoff();
        w.players.clear();
        // Ballon juste devant la ligne de but +x, entre les poteaux, à ras de terre, lancé dedans.
        w.ball.pos = V3::new(HALF_LEN - 0.1, 0.0, 0.1);
        w.ball.vel = V3::new(30.0, 0.0, 0.0);
        w.step(1.0 / 60.0);
        assert_eq!(w.score, [1, 0], "but domicile compté");
        assert!(w.ball.pos.ground().len() < 0.01, "ballon relancé au centre");
    }

    #[test]
    fn simulation_deterministe() {
        let run = || {
            let mut w = World::kickoff();
            for _ in 0..600 {
                w.step(1.0 / 60.0);
            }
            (w.score, w.ball.pos, w.players[0].pos, w.tick)
        };
        let a = run();
        let b = run();
        assert_eq!(a.0, b.0);
        assert_eq!(a.1, b.1);
        assert_eq!(a.2, b.2);
        assert_eq!(a.3, b.3);
    }

    #[test]
    fn state_hash_deterministe() {
        let mut w1 = World::kickoff();
        let mut w2 = World::kickoff();
        assert_eq!(w1.state_hash(), w2.state_hash(), "hash initial identique");

        for _ in 0..120 {
            w1.step(1.0 / 60.0);
            w2.step(1.0 / 60.0);
        }
        assert_eq!(
            w1.state_hash(),
            w2.state_hash(),
            "hash après 120 ticks identique"
        );
    }

    #[test]
    fn multijoueur_deux_joueurs_commandent_leurs_equipes() {
        let mut w = World::kickoff();
        // Le joueur 0 commande l'équipe domicile vers le haut (+y)
        w.input.dir = V2::new(0.0, 1.0);
        // Le joueur 1 commande l'équipe extérieur vers le bas (-y)
        w.away_input.dir = V2::new(0.0, -1.0);

        let home_ctrl = w.controlled_for_team(0).expect("joueur domicile trouvé");
        let away_ctrl = w.controlled_for_team(1).expect("joueur extérieur trouvé");
        assert_eq!(w.players[home_ctrl].team, 0);
        assert_eq!(w.players[away_ctrl].team, 1);

        let y0_home = w.players[home_ctrl].pos.y;
        let y0_away = w.players[away_ctrl].pos.y;

        w.step(1.0 / 60.0);

        assert!(
            w.players[home_ctrl].pos.y > y0_home,
            "joueur domicile a bougé vers le haut"
        );
        assert!(
            w.players[away_ctrl].pos.y < y0_away,
            "joueur extérieur a bougé vers le bas"
        );
    }

    // ─── Détection de désynchronisation ──────────────────────────────────────────────────

    /// Deux mondes qui ne diffèrent que par un compteur de simulation doivent avoir des
    /// hachages DIFFÉRENTS, parce qu'ils divergeront au pas suivant.
    ///
    /// `nie-net` diffuse `state_hash` dans `TickSync` comme détecteur de désynchronisation :
    /// un hachage aveugle à un état qui change le comportement rend la détection inopérante —
    /// les deux clients se croient d'accord, jouent deux parties différentes, et rien ne le
    /// signale. `kick_timer` ouvre ou ferme la frappe (`cmd_shoot && self.kick_timer <= 0.0`),
    /// `steal_lock` autorise ou interdit le tacle : ce sont des états de jeu, pas des détails.
    #[test]
    fn deux_mondes_qui_divergeront_ne_partagent_pas_leur_hachage() {
        for (nom, poser) in [
            (
                "kick_timer",
                (|w: &mut World| w.kick_timer = KICK_COOLDOWN) as fn(&mut World),
            ),
            ("steal_lock", |w: &mut World| w.steal_lock = POSSESSION_LOCK),
            ("tick", |w: &mut World| w.tick = 1),
            ("time", |w: &mut World| w.time = 1.0),
        ] {
            let temoin = World::kickoff();
            let mut modifie = World::kickoff();
            poser(&mut modifie);
            assert_ne!(
                temoin.state_hash(),
                modifie.state_hash(),
                "`{nom}` n'entre pas dans le hachage : une désynchronisation sur ce champ est invisible"
            );
        }
    }

    /// Et la divergence est RÉELLE, pas théorique : sur la même entrée, deux mondes qui ne
    /// diffèrent que par `kick_timer` produisent deux ballons différents.
    ///
    /// C'est ce qui donne son poids au test précédent — sans lui, on pourrait croire que ces
    /// champs sont du décor.
    ///
    /// La possession ne s'établit pas d'elle-même au coup d'envoi (les 22 joueurs sont en
    /// formation, à plus de `CONTROL_RADIUS` du centre : mesuré, aucun porteur en 12 pas), donc
    /// la situation est posée explicitement — un joueur de champ sur le ballon, un pas pour que
    /// `resolve_possession` l'enregistre.
    #[test]
    fn kick_timer_change_reellement_la_suite_de_la_simulation() {
        fn porteur_pret() -> World {
            let mut w = World::kickoff();
            let i = w
                .players
                .iter()
                .position(|p| p.team == 0 && p.role != Role::Goalkeeper)
                .expect("un joueur de champ");
            w.players[i].pos = w.ball.pos.ground();
            w.step(1.0 / 60.0);
            assert_eq!(w.possessor, Some(i), "la possession doit être établie");
            w
        }

        let mut libre = porteur_pret();
        let mut bloque = porteur_pret();
        assert_eq!(
            libre.state_hash(),
            bloque.state_hash(),
            "les deux mondes partent identiques"
        );
        bloque.kick_timer = KICK_COOLDOWN;

        for w in [&mut libre, &mut bloque] {
            w.input = Input {
                dir: V2::new(1.0, 0.0),
                shoot: true,
            };
            w.step(1.0 / 60.0);
        }

        assert_ne!(
            libre.ball.vel.z.to_bits(),
            bloque.ball.vel.z.to_bits(),
            "la frappe doit partir dans un monde et pas dans l'autre"
        );
        assert_ne!(
            libre.state_hash(),
            bloque.state_hash(),
            "après divergence, les hachages doivent différer"
        );
    }

    // ─── Pas de temps fixe ───────────────────────────────────────────────────────────────

    /// Le temps d'horloge n'est jamais perdu tant que la borne de rattrapage n'est pas atteinte :
    /// un millier de fractions arbitraires rendent exactement le nombre de pas attendu.
    ///
    /// C'est la propriété qui rend une simulation à pas fixe reproductible d'un hôte à l'autre :
    /// quelle que soit la cadence d'affichage, le même temps écoulé donne le même nombre de pas.
    #[test]
    fn le_temps_daccumulation_nest_pas_perdu() {
        let mut pas = FixedStep::default();
        let mut total = 0u32;
        // Des fractions volontairement irrégulières, jamais un multiple entier de TICK_DT.
        let fractions = [0.3_f32, 0.7, 0.11, 1.9, 0.4];
        let mut horloge = 0.0_f32;
        for i in 0..1000 {
            let wall = TICK_DT * fractions[i % fractions.len()];
            horloge += wall;
            total += pas.advance(wall);
        }
        let attendu = (horloge / TICK_DT).floor() as u32;
        assert!(
            total.abs_diff(attendu) <= 1,
            "{total} pas pour {horloge:.4}s, soit {attendu} attendus"
        );
        assert!(
            pas.reste() < TICK_DT,
            "le reste doit rester une fraction de pas"
        );
    }

    /// Une frame très longue ne demande PAS des centaines de pas : c'est la spirale de la mort.
    ///
    /// `docs/STACK.md` l'exige (« les frames longues sont bornées »). Sans borne, un chargement
    /// ou un point d'arrêt demande un rattrapage plus long que le retard, qui en demande un plus
    /// long encore — ce qui se lit comme un blocage plutôt que comme un ralentissement.
    #[test]
    fn une_frame_tres_longue_est_bornee() {
        let mut pas = FixedStep::default();
        assert_eq!(
            pas.advance(10.0),
            MAX_CATCHUP_STEPS,
            "10 s = 600 pas sans borne"
        );
        // Et le retard n'est pas reporté : la frame suivante repart propre.
        assert!(pas.reste() <= TICK_DT);
        assert!(pas.advance(TICK_DT) <= MAX_CATCHUP_STEPS);
    }

    /// Une horloge qui recule ou déborde ne fait pas avancer la simulation et n'empoisonne pas
    /// l'accumulateur.
    ///
    /// Un `NaN` ajouté à l'accumulateur le rend `NaN` définitivement : toutes les comparaisons
    /// deviennent fausses et la simulation s'arrête pour de bon, longtemps après la frame
    /// fautive.
    #[test]
    fn une_horloge_invalide_ne_casse_pas_laccumulateur() {
        let mut pas = FixedStep::default();
        for mauvais in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY, -1.0] {
            assert_eq!(
                pas.advance(mauvais),
                0,
                "{mauvais} ne doit produire aucun pas"
            );
        }
        assert!(pas.reste().is_finite(), "l'accumulateur doit rester fini");
        assert_eq!(pas.advance(TICK_DT), 1, "la simulation repart normalement");
    }

    /// Un `dt` absurde à la construction retombe sur la cadence du moteur.
    ///
    /// Un pas nul ou négatif ferait boucler `advance` sans fin chez l'appelant.
    #[test]
    fn un_pas_absurde_retombe_sur_la_cadence_du_moteur() {
        for absurde in [0.0, -1.0, f32::NAN, f32::INFINITY] {
            let pas = FixedStep::new(absurde, 5);
            assert_eq!(pas.dt().to_bits(), TICK_DT.to_bits(), "dt = {absurde}");
        }
        assert_eq!(
            FixedStep::new(TICK_DT, 0).advance(10.0),
            1,
            "borne plancher à 1"
        );
    }

    /// La cadence du moteur et celle du protocole réseau sont le MÊME nombre.
    ///
    /// Elles vivaient dans deux crates ; `nie-play` avançait à 1/30 pendant que le serveur
    /// autoritaire diffusait du 60 Hz. Ce test fige l'unicité.
    #[test]
    fn la_cadence_est_unique_dans_le_depot() {
        assert_eq!(TICK_RATE_HZ, 60);
        assert_eq!(TICK_DT.to_bits(), (1.0_f32 / 60.0).to_bits());
    }

    /// La fraction d'interpolation reste dans `[0, 1)` et suit le temps accumulé.
    ///
    /// C'est la valeur que le rendu doit lire pour afficher un état intermédiaire — sans elle,
    /// une simulation à 60 Hz sur un écran à 144 Hz répète des images puis saute, ce qui se lit
    /// comme une physique saccadée alors qu'elle est régulière.
    #[test]
    fn la_fraction_dinterpolation_suit_le_temps_accumule() {
        let mut pas = FixedStep::default();
        assert_eq!(pas.overstep_fraction(), 0.0, "rien d'accumulé au départ");

        assert_eq!(
            pas.advance(TICK_DT * 0.25),
            0,
            "un quart de pas n'en produit aucun"
        );
        assert!(
            (pas.overstep_fraction() - 0.25).abs() < 1e-5,
            "{}",
            pas.overstep_fraction()
        );

        assert_eq!(pas.advance(TICK_DT * 0.5), 0);
        assert!((pas.overstep_fraction() - 0.75).abs() < 1e-5);

        // Franchir un pas entier consomme le pas et laisse le reste.
        assert_eq!(pas.advance(TICK_DT * 0.5), 1);
        assert!(
            (pas.overstep_fraction() - 0.25).abs() < 1e-5,
            "après un pas, il reste 0,25 : {}",
            pas.overstep_fraction()
        );
        assert!(
            pas.overstep_fraction() < 1.0,
            "toujours une FRACTION de pas"
        );
    }
}
