//! Le gizmo de translation : des poignées d'axe qu'on attrape à la souris pour déplacer un objet.
//!
//! # Ce qui manquait
//!
//! L'éditeur du dépôt porte **deux** viewports : `Viewport3D.tsx` (646 lignes de three.js, un
//! seul consommateur) et le rendu Rust. Le premier survit pour quatre capacités que le second
//! n'avait pas — grille, fil de fer, contour de sélection, **gizmo**. Les trois premières sont
//! des segments ([`crate::scene::Segment`]) ; celle-ci est de l'interaction, et c'est la dernière
//! qui reste avant de pouvoir retirer three.js.
//!
//! # La géométrie, et pourquoi elle n'est pas évidente
//!
//! Déplacer un objet le long d'un axe depuis un glissement 2D demande de projeter le curseur sur
//! **un plan** : celui qui contient l'axe et fait le plus face possible à la caméra. Un plan
//! choisi au hasard parmi ceux qui contiennent l'axe donnerait, vu de profil, un déplacement
//! hypersensible ou nul — l'objet partirait à l'infini sur un mouvement d'un pixel.
//!
//! La construction est celle de `bevy_gizmos::transform_gizmo` (`translation_plane_normal`,
//! `intersect_plane`), reprise ici parce que le chemin CPU ne passe pas par le pipeline Bevy :
//! ce module sert le rastériseur de scène, qui est l'oracle des goldens et le repli du navigateur
//! sans WebGPU.
//!
//! # Ce que ce module ne fait pas
//!
//! Ni rotation ni échelle : la translation est ce que l'éditeur mute aujourd'hui
//! (`SceneObjectV2::position`). Ni gestion d'état du glissement — c'est à l'hôte de retenir
//! l'axe attrapé et le point de départ, parce qu'un hôte natif et un navigateur ne suivent pas
//! une souris de la même façon.

use crate::pick::Ray;
use crate::scene::Segment;
use crate::vecmath::{V3, cross, dot, normv, sub};

/// L'axe qu'on manipule.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Axis {
    /// +X, dessiné en rouge.
    X,
    /// +Y, dessiné en vert.
    Y,
    /// +Z, dessiné en bleu.
    Z,
}

impl Axis {
    /// Le vecteur unitaire de l'axe, en espace monde.
    #[must_use]
    pub fn direction(self) -> V3 {
        match self {
            Self::X => [1.0, 0.0, 0.0],
            Self::Y => [0.0, 1.0, 0.0],
            Self::Z => [0.0, 0.0, 1.0],
        }
    }

    /// La couleur conventionnelle : X rouge, Y vert, Z bleu.
    ///
    /// Ce n'est pas un choix esthétique — c'est la convention que tout éditeur 3D partage, et en
    /// dévier oblige l'utilisateur à réapprendre un repère qu'il connaît déjà.
    #[must_use]
    pub fn color(self) -> [u8; 3] {
        match self {
            Self::X => [220, 60, 60],
            Self::Y => [60, 200, 80],
            Self::Z => [70, 110, 230],
        }
    }

    /// Les trois axes, dans l'ordre X, Y, Z.
    #[must_use]
    pub fn all() -> [Self; 3] {
        [Self::X, Self::Y, Self::Z]
    }
}

/// Les segments qui dessinent le gizmo à `origin`, chaque poignée de longueur `length`.
///
/// Les poignées sont **en superposition** ([`Segment::overlay`]) : un gizmo masqué par l'objet
/// qu'il manipule serait inattrapable, et l'utilisateur conclurait que l'éditeur ne répond pas.
#[must_use]
pub fn handles(origin: V3, length: f32) -> Vec<Segment> {
    Axis::all()
        .into_iter()
        .map(|axis| {
            let d = axis.direction();
            let bout = [
                origin[0] + d[0] * length,
                origin[1] + d[1] * length,
                origin[2] + d[2] * length,
            ];
            Segment::new(origin, bout, axis.color())
                .with_width(3)
                .overlay()
        })
        .collect()
}

/// Segments d'un anneau de rotation autour de `axis`, centré sur `origin`.
///
/// Un anneau par axe, dans la couleur de l'axe : c'est la convention qui permet de savoir ce
/// qu'on va tourner avant de cliquer. `segments` découpe le cercle ; 48 donne un cercle lisse à
/// l'écran sans peser, et en dessous de 12 l'anneau se lit comme un polygone.
#[must_use]
pub fn ring(origin: V3, axis: Axis, radius: f32, segments: usize) -> Vec<Segment> {
    let n = segments.max(12);
    // Deux vecteurs orthogonaux au plan de l'anneau.
    let (u, v) = match axis {
        Axis::X => ([0.0, 1.0, 0.0], [0.0, 0.0, 1.0]),
        Axis::Y => ([1.0, 0.0, 0.0], [0.0, 0.0, 1.0]),
        Axis::Z => ([1.0, 0.0, 0.0], [0.0, 1.0, 0.0]),
    };
    let point = |t: f32| -> V3 {
        let (c, s) = (t.cos(), t.sin());
        [
            origin[0] + (u[0] * c + v[0] * s) * radius,
            origin[1] + (u[1] * c + v[1] * s) * radius,
            origin[2] + (u[2] * c + v[2] * s) * radius,
        ]
    };
    let pas = core::f32::consts::TAU / n as f32;
    (0..n)
        .map(|i| {
            Segment::new(point(i as f32 * pas), point((i + 1) as f32 * pas), axis.color())
                .with_width(2)
                .overlay()
        })
        .collect()
}

/// Les trois anneaux de rotation.
#[must_use]
pub fn rotation_handles(origin: V3, radius: f32) -> Vec<Segment> {
    Axis::all()
        .into_iter()
        .flat_map(|axis| ring(origin, axis, radius, 48))
        .collect()
}

/// L'angle de rotation autour de `axis` entre deux rayons, en radians.
///
/// Le plan de mesure est **perpendiculaire à l'axe** et passe par l'origine — c'est celui dans
/// lequel l'objet tourne. Projeter sur le plan de contrainte de la translation donnerait un
/// angle sans rapport avec le mouvement visible.
///
/// L'angle est signé selon la règle de la main droite autour de l'axe : tourner le curseur dans
/// le sens trigonométrique vu depuis le bout de l'axe rend un angle positif. Sans ce signe, un
/// objet tournerait toujours dans le même sens quel que soit le geste.
///
/// `None` quand un rayon est parallèle au plan, ou quand le curseur tombe trop près du centre —
/// l'angle y est indéterminé et un bruit d'un pixel ferait tournoyer l'objet.
#[must_use]
pub fn rotate_around_axis(origin: V3, axis: Axis, start: &Ray, current: &Ray) -> Option<f32> {
    let n = axis.direction();
    let a = sub(intersect_plane(start, n, origin)?, origin);
    let b = sub(intersect_plane(current, n, origin)?, origin);
    // Rayon minimal : sous ce seuil relatif, l'angle n'est plus mesurable.
    const MINIMUM: f32 = 1e-4;
    if dot(a, a) < MINIMUM || dot(b, b) < MINIMUM {
        return None;
    }
    // atan2 du produit vectoriel projeté sur l'axe, et du produit scalaire : c'est l'angle signé.
    let sinus = dot(cross(a, b), n);
    let cosinus = dot(a, b);
    Some(sinus.atan2(cosinus))
}

/// Le facteur d'échelle entre deux rayons, mesuré le long de `axis`.
///
/// C'est le rapport des distances à l'origine, projetées sur l'axe : éloigner le curseur agrandit,
/// le rapprocher réduit. Borné à `[0.01, 100]` — un facteur nul écraserait l'objet en un point
/// dont aucune manipulation ultérieure ne le sortirait, la multiplication par zéro n'ayant pas
/// d'inverse.
///
/// `None` dans les mêmes cas que [`rotate_around_axis`], plus quand le point de départ est sur
/// l'origine : le rapport y serait une division par zéro.
#[must_use]
pub fn scale_along_axis(origin: V3, axis: Axis, start: &Ray, current: &Ray) -> Option<f32> {
    let d = axis.direction();
    let normal = translation_plane_normal(start, d);
    let a = dot(sub(intersect_plane(start, normal, origin)?, origin), d);
    let b = dot(sub(intersect_plane(current, normal, origin)?, origin), d);
    if a.abs() < 1e-4 {
        return None;
    }
    let facteur = b / a;
    if !facteur.is_finite() {
        return None;
    }
    Some(facteur.clamp(0.01, 100.0))
}

/// Le plan de contrainte d'une translation le long de `axis`, vu depuis `ray`.
///
/// Il contient l'axe et fait **le plus face possible** à la caméra. Rendre une normale
/// arbitraire quand le rayon est presque parallèle à l'axe évite une division par une longueur
/// nulle ; dans ce cas le déplacement sera de toute façon peu sensible, ce qui est le
/// comportement correct — vu exactement dans l'axe, un glissement ne porte aucune information.
#[must_use]
pub fn translation_plane_normal(ray: &Ray, axis: V3) -> V3 {
    let vertical = cross(ray.direction, axis);
    if dot(vertical, vertical) < 1e-12 {
        // Rayon parallèle à l'axe : n'importe quelle perpendiculaire fait l'affaire.
        let candidat = if axis[0].abs() < 0.9 {
            [1.0, 0.0, 0.0]
        } else {
            [0.0, 1.0, 0.0]
        };
        return normv(cross(axis, candidat));
    }
    normv(cross(axis, normv(vertical)))
}

/// Point où `ray` rencontre le plan de normale `normal` passant par `origin`.
///
/// `None` quand le rayon est parallèle au plan : il n'y a alors pas d'intersection, et rendre un
/// point arbitraire ferait sauter l'objet.
#[must_use]
pub fn intersect_plane(ray: &Ray, normal: V3, origin: V3) -> Option<V3> {
    let denom = dot(ray.direction, normal);
    if denom.abs() <= 1e-9 {
        return None;
    }
    let t = dot(normal, sub(origin, ray.origin)) / denom;
    Some([
        ray.origin[0] + ray.direction[0] * t,
        ray.origin[1] + ray.direction[1] * t,
        ray.origin[2] + ray.direction[2] * t,
    ])
}

/// Le déplacement le long de `axis` entre deux rayons — celui du clic, celui du curseur.
///
/// C'est l'opération que l'hôte appelle à chaque mouvement de souris : il garde le rayon de
/// départ, passe le rayon courant, et ajoute le vecteur rendu à la position de l'objet.
///
/// Le résultat est **contraint à l'axe** : projeter les deux points du plan sur l'axe puis
/// soustraire garantit qu'aucune composante hors-axe ne fuit, même si le plan est légèrement
/// mal orienté. Sans cette projection, un objet glissé sur X dériverait imperceptiblement en Y.
///
/// `None` quand l'un des deux rayons ne rencontre pas le plan — l'hôte laisse alors l'objet où
/// il est plutôt que de le téléporter.
#[must_use]
pub fn drag_along_axis(origin: V3, axis: Axis, start: &Ray, current: &Ray) -> Option<V3> {
    let d = axis.direction();
    let normal = translation_plane_normal(start, d);
    let a = intersect_plane(start, normal, origin)?;
    let b = intersect_plane(current, normal, origin)?;
    let delta = dot(sub(b, a), d);
    Some([d[0] * delta, d[1] * delta, d[2] * delta])
}

/// L'axe dont la poignée passe le plus près du curseur, si l'une est assez proche.
///
/// `tolerance` est en unités monde, à la distance de la poignée. L'hôte le dérive de sa
/// résolution : trop serré, aucune poignée n'est attrapable ; trop lâche, les trois se disputent
/// le curseur près de l'origine, où elles se touchent.
#[must_use]
pub fn axis_under_ray(origin: V3, length: f32, ray: &Ray, tolerance: f32) -> Option<Axis> {
    let mut meilleur: Option<(Axis, f32)> = None;
    for axis in Axis::all() {
        let d = axis.direction();
        let bout = [
            origin[0] + d[0] * length,
            origin[1] + d[1] * length,
            origin[2] + d[2] * length,
        ];
        let dist = distance_rayon_segment(ray, origin, bout);
        if dist <= tolerance && meilleur.is_none_or(|(_, m)| dist < m) {
            meilleur = Some((axis, dist));
        }
    }
    meilleur.map(|(axis, _)| axis)
}

/// Distance la plus courte entre un rayon et un segment, en unités monde.
///
/// Les deux paramètres sont bornés : le rayon ne compte pas derrière son origine, le segment pas
/// au-delà de ses extrémités. Sans ces bornes, une poignée courte serait attrapable depuis son
/// prolongement à l'infini.
fn distance_rayon_segment(ray: &Ray, a: V3, b: V3) -> f32 {
    let u = ray.direction;
    let v = sub(b, a);
    let w = sub(ray.origin, a);
    let (uu, uv, vv) = (dot(u, u), dot(u, v), dot(v, v));
    let (uw, vw) = (dot(u, w), dot(v, w));
    let denom = uu * vv - uv * uv;

    let (mut s, mut t) = if denom.abs() < 1e-9 {
        // Parallèles : n'importe quel point du rayon convient, on prend son origine.
        (0.0, if vv > 1e-9 { vw / vv } else { 0.0 })
    } else {
        (
            (uv * vw - vv * uw) / denom,
            (uu * vw - uv * uw) / denom,
        )
    };
    s = s.max(0.0); // pas derrière la caméra
    t = t.clamp(0.0, 1.0); // pas au-delà de la poignée

    let p = [
        ray.origin[0] + u[0] * s,
        ray.origin[1] + u[1] * s,
        ray.origin[2] + u[2] * s,
    ];
    let q = [a[0] + v[0] * t, a[1] + v[1] * t, a[2] + v[2] * t];
    let d = sub(p, q);
    dot(d, d).sqrt()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rayon(origin: V3, vers: V3) -> Ray {
        Ray {
            origin,
            direction: normv(sub(vers, origin)),
        }
    }

    /// Le gizmo dessine trois poignées, aux couleurs conventionnelles, toutes par-dessus.
    #[test]
    fn le_gizmo_dessine_trois_poignees_par_dessus() {
        let h = handles([1.0, 2.0, 3.0], 2.0);
        assert_eq!(h.len(), 3);
        assert!(h.iter().all(|s| !s.depth_test), "un gizmo masqué est inattrapable");
        assert_eq!(h[0].color, [220, 60, 60], "X rouge");
        assert_eq!(h[1].color, [60, 200, 80], "Y vert");
        assert_eq!(h[2].color, [70, 110, 230], "Z bleu");
        // Chaque poignée part de l'origine et mesure `length` sur son seul axe.
        for (i, s) in h.iter().enumerate() {
            assert_eq!(s.a, [1.0, 2.0, 3.0]);
            let d = sub(s.b, s.a);
            assert!((dot(d, d).sqrt() - 2.0).abs() < 1e-5);
            assert!(d[i].abs() > 1.9, "la poignée {i} doit varier sur son axe");
        }
    }

    /// Un glissement le long de X déplace de la bonne DISTANCE, et seulement en X.
    ///
    /// Valeur calculée à la main : la caméra regarde l'origine depuis +Z, donc le plan de
    /// contrainte est `z = 0` et deux rayons visant `x = 0` puis `x = 3` déplacent de 3.
    #[test]
    fn un_glissement_sur_x_deplace_de_la_bonne_distance() {
        let origine = [0.0, 0.0, 0.0];
        let oeil = [0.0, 0.0, 10.0];
        let depart = rayon(oeil, [0.0, 0.0, 0.0]);
        let courant = rayon(oeil, [3.0, 0.0, 0.0]);
        let delta = drag_along_axis(origine, Axis::X, &depart, &courant).expect("intersection");
        assert!((delta[0] - 3.0).abs() < 1e-4, "{delta:?}");
        assert!(delta[1].abs() < 1e-6 && delta[2].abs() < 1e-6, "aucune fuite hors axe : {delta:?}");
    }

    /// Le déplacement est CONTRAINT : un glissement oblique ne bouge que sur l'axe.
    ///
    /// C'est la propriété qui distingue un gizmo d'un déplacement libre. Sans la projection
    /// finale, un objet glissé sur X dériverait imperceptiblement en Y à chaque image.
    #[test]
    fn un_glissement_oblique_ne_fuit_pas_hors_de_laxe() {
        let origine = [0.0, 0.0, 0.0];
        let oeil = [2.0, 5.0, 9.0];
        let depart = rayon(oeil, [0.0, 0.0, 0.0]);
        let courant = rayon(oeil, [2.5, 1.7, -0.3]);
        let delta = drag_along_axis(origine, Axis::Y, &depart, &courant).expect("intersection");
        assert!(delta[0].abs() < 1e-5 && delta[2].abs() < 1e-5, "{delta:?}");
        assert!(delta[1].abs() > 1e-3, "il doit tout de même bouger : {delta:?}");
    }

    /// Un rayon parallèle à l'axe ne fait pas exploser le calcul.
    ///
    /// Vu exactement dans l'axe, un glissement ne porte aucune information ; le contrat est de
    /// rendre un déplacement fini, jamais un `NaN` qui propagerait l'objet hors du monde.
    #[test]
    fn un_rayon_parallele_a_laxe_ne_produit_pas_de_nan() {
        let origine = [0.0, 0.0, 0.0];
        // Caméra exactement sur +X, regardant -X : le rayon est colinéaire à l'axe X.
        let depart = Ray { origin: [10.0, 0.0, 0.0], direction: [-1.0, 0.0, 0.0] };
        let courant = Ray { origin: [10.0, 0.0, 0.0], direction: normv([-1.0, 0.02, 0.0]) };
        let n = translation_plane_normal(&depart, Axis::X.direction());
        assert!(n.iter().all(|c| c.is_finite()), "normale non finie : {n:?}");
        if let Some(delta) = drag_along_axis(origine, Axis::X, &depart, &courant) {
            assert!(delta.iter().all(|c| c.is_finite()), "{delta:?}");
        }
    }

    /// Un rayon parallèle au PLAN ne rend pas d'intersection plutôt qu'un point arbitraire.
    #[test]
    fn un_rayon_parallele_au_plan_ne_rend_rien() {
        let ray = Ray { origin: [0.0, 0.0, 5.0], direction: [1.0, 0.0, 0.0] };
        assert_eq!(intersect_plane(&ray, [0.0, 0.0, 1.0], [0.0, 0.0, 0.0]), None);
    }

    /// Le curseur attrape la poignée la plus proche, et rien quand il est loin des trois.
    #[test]
    fn le_curseur_attrape_la_poignee_la_plus_proche() {
        let origine = [0.0, 0.0, 0.0];
        let oeil = [0.0, 0.0, 10.0];
        // Visant le milieu de la poignée X.
        let sur_x = rayon(oeil, [1.0, 0.0, 0.0]);
        assert_eq!(axis_under_ray(origine, 2.0, &sur_x, 0.2), Some(Axis::X));
        // Visant le milieu de la poignée Y.
        let sur_y = rayon(oeil, [0.0, 1.0, 0.0]);
        assert_eq!(axis_under_ray(origine, 2.0, &sur_y, 0.2), Some(Axis::Y));
        // Loin des trois.
        let ailleurs = rayon(oeil, [5.0, 5.0, 0.0]);
        assert_eq!(axis_under_ray(origine, 2.0, &ailleurs, 0.2), None);
    }

    /// Une poignée n'est PAS attrapable depuis son prolongement : le segment est borné.
    ///
    /// Sans le bornage, viser loin devant la poignée l'attraperait quand même, et l'utilisateur
    /// déplacerait un objet en cliquant dans le vide.
    #[test]
    fn une_poignee_nest_pas_attrapable_depuis_son_prolongement() {
        let origine = [0.0, 0.0, 0.0];
        let oeil = [0.0, 0.0, 10.0];
        // La poignée X va de 0 à 2 ; on vise x = 6, bien au-delà.
        let au_dela = rayon(oeil, [6.0, 0.0, 0.0]);
        assert_eq!(axis_under_ray(origine, 2.0, &au_dela, 0.2), None);
    }

    /// Un anneau est fermé, dans le plan de son axe, et au bon rayon.
    #[test]
    fn un_anneau_est_ferme_dans_le_plan_de_son_axe() {
        let r = ring([1.0, 2.0, 3.0], Axis::Y, 2.0, 24);
        assert_eq!(r.len(), 24);
        // Fermé : le bout du dernier segment rejoint le départ du premier.
        let premier = r[0].a;
        let dernier = r[r.len() - 1].b;
        for c in 0..3 {
            assert!((premier[c] - dernier[c]).abs() < 1e-4, "anneau non fermé : {premier:?} / {dernier:?}");
        }
        // Dans le plan de Y : la coordonnée Y ne varie pas.
        for s in &r {
            assert!((s.a[1] - 2.0).abs() < 1e-5, "hors du plan : {:?}", s.a);
            let dx = s.a[0] - 1.0;
            let dz = s.a[2] - 3.0;
            assert!(((dx * dx + dz * dz).sqrt() - 2.0).abs() < 1e-4, "mauvais rayon");
        }
        // Un découpage absurde est relevé au plancher plutôt que de rendre un segment.
        assert_eq!(ring([0.0; 3], Axis::X, 1.0, 0).len(), 12);
    }

    /// Un quart de tour mesuré vaut bien π/2, et le sens du geste décide du SIGNE.
    ///
    /// Sans le signe, un objet tournerait toujours dans le même sens quel que soit le
    /// mouvement — ce qui se lit comme un gizmo cassé, pas comme une convention.
    #[test]
    fn un_quart_de_tour_vaut_pi_sur_deux_et_le_sens_compte() {
        let origine = [0.0, 0.0, 0.0];
        // Caméra au-dessus, regardant vers -Y : le plan de rotation de Y est XZ.
        let oeil = [0.0, 10.0, 0.0];
        let depart = rayon(oeil, [1.0, 0.0, 0.0]);
        let horaire = rayon(oeil, [0.0, 0.0, 1.0]);
        let antihoraire = rayon(oeil, [0.0, 0.0, -1.0]);

        let a = rotate_around_axis(origine, Axis::Y, &depart, &horaire).expect("angle");
        let b = rotate_around_axis(origine, Axis::Y, &depart, &antihoraire).expect("angle");
        assert!((a.abs() - core::f32::consts::FRAC_PI_2).abs() < 1e-3, "{a}");
        assert!((b.abs() - core::f32::consts::FRAC_PI_2).abs() < 1e-3, "{b}");
        assert!(a.signum() != b.signum(), "les deux sens doivent différer : {a} / {b}");
    }

    /// Au centre, l'angle est indéterminé : mieux vaut ne rien rendre que faire tournoyer.
    #[test]
    fn une_rotation_au_centre_ne_rend_rien() {
        let origine = [0.0, 0.0, 0.0];
        let oeil = [0.0, 10.0, 0.0];
        let au_centre = rayon(oeil, [0.0, 0.0, 0.0]);
        let ailleurs = rayon(oeil, [1.0, 0.0, 0.0]);
        assert_eq!(rotate_around_axis(origine, Axis::Y, &au_centre, &ailleurs), None);
    }

    /// Doubler la distance double l'échelle, et le facteur est BORNÉ.
    ///
    /// Un facteur nul écraserait l'objet en un point dont aucune manipulation ne le sortirait :
    /// la multiplication par zéro n'a pas d'inverse.
    #[test]
    fn lechelle_suit_la_distance_et_reste_bornee() {
        let origine = [0.0, 0.0, 0.0];
        let oeil = [0.0, 0.0, 10.0];
        let depart = rayon(oeil, [1.0, 0.0, 0.0]);
        let double = rayon(oeil, [2.0, 0.0, 0.0]);
        let f = scale_along_axis(origine, Axis::X, &depart, &double).expect("facteur");
        assert!((f - 2.0).abs() < 1e-3, "{f}");

        // Curseur ramené sur l'origine : le facteur est plafonné, jamais nul.
        let au_centre = rayon(oeil, [0.0, 0.0, 0.0]);
        let plancher = scale_along_axis(origine, Axis::X, &depart, &au_centre).expect("facteur");
        assert!(plancher >= 0.01, "le facteur ne doit pas atteindre zéro : {plancher}");
    }

    /// Partir de l'origine rend `None` plutôt qu'une division par zéro.
    #[test]
    fn une_echelle_depuis_lorigine_ne_rend_rien() {
        let origine = [0.0, 0.0, 0.0];
        let oeil = [0.0, 0.0, 10.0];
        let au_centre = rayon(oeil, [0.0, 0.0, 0.0]);
        let ailleurs = rayon(oeil, [1.0, 0.0, 0.0]);
        assert_eq!(scale_along_axis(origine, Axis::X, &au_centre, &ailleurs), None);
    }

    /// Les trois anneaux portent les couleurs conventionnelles des axes.
    #[test]
    fn les_trois_anneaux_portent_les_couleurs_des_axes() {
        let h = rotation_handles([0.0; 3], 1.5);
        assert_eq!(h.len(), 48 * 3);
        for axis in Axis::all() {
            assert!(
                h.iter().any(|s| s.color == axis.color()),
                "anneau {axis:?} absent"
            );
        }
        assert!(h.iter().all(|s| !s.depth_test), "les anneaux restent attrapables");
    }
}
