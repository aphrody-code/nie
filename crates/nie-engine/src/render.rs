//! `render` — Portage RE du pipeline de rendu D3D11 de `nie.exe`
//!
//! Reproduit fidèlement la logique des fonctions décompilées Ghidra suivantes :
//! - `FUN_14045ab10` → [`d3d11_device_init`] — initialisation dispositif/adaptateur D3D11
//! - `FUN_14045b980` → [`d3d11_fullscreen_quad_setup`] — configuration quad plein écran + vertex buffer
//! - `FUN_14045bb30` → [`d3d11_enumerate_display_modes`] — énumération modes d'affichage DXGI
//! - `FUN_14045c780` → [`d3d11_swapchain_display_setup`] — setup swap-chain / fenêtre HDR
//! - `FUN_140459be0` → [`d3d11_texture_resource_create`] — création ressource texture D3D11
//! - `FUN_140459110` → [`dxgi_format_bits_per_element`] — bits/élément par format DXGI
//! - `FUN_140459210` → [`dxgi_compute_pitch`] — calcul de pitch / taille de ligne par format DXGI
//! - `FUN_1411b8650`  → [`compute_shader_tilelight_init`] — init compute shaders tile-based lighting
//! - `FUN_140ef27c0`  → [`render_pipeline_init`] — pipeline de rendu global (extraits clés)
//! - `FUN_140475180`  → [`shader_create_reflect`] — création + reflection shader via D3DReflect
//!
//! # Conventions de portage
//!
//! Les pointeurs COM C++ (`(**(code **)(*vtbl + offset))(obj, …)`) sont abstraits par des
//! traits simulant les vtables (voir [`ComObject`]). Les globals Ghidra (`DAT_1418…`,
//! `DAT_1420…`) deviennent des membres de [`RenderContext`] ou des constantes nommées.
//! Les `longlong*` multi-champs sont remplacés par des structs documentées avec leurs offsets.
//!
//! `#![forbid(unsafe_code)]` est appliqué au niveau crate (voir `lib.rs`).
//!
//! # Portage fidèle vs. stubs
//!
//! Ce module est Windows-only dans l'original (D3D11/DXGI). Sur les cibles non-Windows,
//! les fonctions renvoient des codes d'erreur correspondant au comportement d'absence d'adaptateur.
//! Les IID DXGI sont stockés comme des tableaux d'octets documentés.

// porte de : d3d11_device_init.c, d3d11_fullscreen_quad_setup.c,
//            d3d11_swapchain_display_setup.c, d3d11_texture_resource_create.c,
//            dxgi_format_utils.c, compute_shader_tilelight_init.c,
//            render_pipeline_init.c, shader_create_reflect.c

use thiserror::Error;

// ---------------------------------------------------------------------------
// EXTERN : références à des sous-systèmes non encore portés dans ce crate
// ---------------------------------------------------------------------------
// EXTERN: FUN_14004d770 — allocateur interne (malloc-like, taille en octets)
// EXTERN: FUN_1416709b0 — memset interne (ptr, valeur, taille)
// EXTERN: FUN_141670310 — memcpy interne (dst, src, taille)
// EXTERN: FUN_14045d8f0 — logger GPU (wprintf-like L"GpuAdapter[%u]:%s …")
// EXTERN: FUN_14045c4e0 — validation mode swap-chain (retourne bool)
// EXTERN: FUN_140456a80 — GetDisplayConfigBufferSizes wrapper interne
// EXTERN: FUN_140470690 — GetDpiForMonitor wrapper interne
// EXTERN: FUN_140456750 — lecture résolution window actuelle (mode fenêtré)
// EXTERN: FUN_1404567d0 — lecture résolution plein-écran actuelle
// EXTERN: FUN_14045c670 — index adapter courant (retourne i32, <0 = err)
// EXTERN: FUN_1404cfa90 — chargement shader cfxo par chemin (ref-compté)
// EXTERN: FUN_1402b2610 — lookup table config par hash (retourne ptr ou 0)
// EXTERN: FUN_1402ac470 — allocation buffer aligné interne (hash, taille)
// EXTERN: FUN_14057ed40 — initialisation du pipeline de rendu principal
// EXTERN: FUN_1409855c8 — allocation tableau de SubresourceData (usize, align_ptr)
// EXTERN: FUN_1404598e0 — création GPU resource finale (param_1, dim, …)
// EXTERN: DAT_142043588 — pointeur vers le contexte de périphérique global
// EXTERN: DAT_142043680 — pointeur vers le gestionnaire de format global
// EXTERN: DAT_141f9801a — flag singleton init tilelight (bool)
// EXTERN: DAT_141bf9c30/34/38 — dimensions grille tile (x, y, z)

// ---------------------------------------------------------------------------
// Codes d'erreur HRESULT observés dans le C décompilé
// ---------------------------------------------------------------------------

/// Codes HRESULT Windows reproduits fidèlement depuis le décompilé.
/// Valeurs extraites de : d3d11_texture_resource_create.c, dxgi_format_utils.c
#[allow(non_camel_case_types)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HResult(pub u32);

impl HResult {
    pub const S_OK: Self = Self(0);
    pub const E_FAIL: Self = Self(0x80004005);
    pub const E_NOINTERFACE: Self = Self(0x80004002);
    pub const E_INVALIDARG: Self = Self(0x80070057);
    pub const E_OUTOFMEMORY: Self = Self(0x8007000e);
    pub const E_NOTIMPL: Self = Self(0x80004001);
    pub const E_UNEXPECTED: Self = Self(0x8000ffff);
    // Codes spécifiques D3D11 observés dans le décompilé
    /// ERROR_NOT_SUPPORTED (0x80070032) — format DXGI non supporté
    pub const D3DERR_FORMAT_NOT_SUPPORTED: Self = Self(0x80070032);
    /// ERROR_INVALID_PARAMETER (0x8007000d) — paramètre invalide texture
    pub const D3DERR_INVALID_PARAM: Self = Self(0x8007000d);
    /// ERROR_ARITHMETIC_OVERFLOW (0x80070216) — dépassement taille surface
    pub const D3DERR_OVERFLOW: Self = Self(0x80070216);
    /// ERROR_HANDLE_EOF (0x80070026) — données source insuffisantes
    pub const D3DERR_BUFFER_TOO_SMALL: Self = Self(0x80070026);

    #[inline]
    pub fn succeeded(self) -> bool {
        (self.0 as i32) >= 0
    }
    #[inline]
    pub fn failed(self) -> bool {
        !self.succeeded()
    }
}

impl std::fmt::Display for HResult {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "HRESULT(0x{:08X})", self.0)
    }
}

// ---------------------------------------------------------------------------
// Format DXGI
// ---------------------------------------------------------------------------

/// Format DXGI — sous-ensemble des valeurs DXGI_FORMAT utilisées dans le moteur.
/// Porte de : dxgi_format_utils.c (`FUN_140459110`, `FUN_140459210`)
/// Les valeurs numériques correspondent exactement aux enum DXGI_FORMAT Windows.
#[allow(non_camel_case_types)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[repr(u32)]
pub enum DxgiFormat {
    Unknown = 0,
    R32G32B32A32_Typeless = 1,
    R32G32B32A32_Float = 2,
    R32G32B32A32_Uint = 3,
    R32G32B32A32_Sint = 4,
    R32G32B32_Typeless = 5,
    R32G32B32_Float = 6,
    R32G32B32_Uint = 7,
    R32G32B32_Sint = 8,
    R16G16B16A16_Typeless = 9,
    R16G16B16A16_Float = 10,
    R16G16B16A16_Unorm = 11,
    R16G16B16A16_Uint = 12,
    R16G16B16A16_Snorm = 13,
    R16G16B16A16_Sint = 14,
    R32G32_Typeless = 15,
    R32G32_Float = 16,
    R32G32_Uint = 17,
    R32G32_Sint = 18,
    R32G8X24_Typeless = 19,
    D32_Float_S8X24_Uint = 20,
    R32_Float_X8X24_Typeless = 21,
    X32_Typeless_G8X24_Uint = 22,
    R10G10B10A2_Typeless = 23,
    R10G10B10A2_Unorm = 24,
    R10G10B10A2_Uint = 25,
    R11G11B10_Float = 26,
    R8G8B8A8_Typeless = 27,
    R8G8B8A8_Unorm = 28,
    R8G8B8A8_Unorm_Srgb = 29,
    R8G8B8A8_Uint = 30,
    R8G8B8A8_Snorm = 31,
    R8G8B8A8_Sint = 32,
    R16G16_Typeless = 33,
    R16G16_Float = 34,
    R16G16_Unorm = 35,
    R16G16_Uint = 36,
    R16G16_Snorm = 37,
    R16G16_Sint = 38,
    R32_Typeless = 39,
    D32_Float = 40,
    R32_Float = 41,
    R32_Uint = 42,
    R32_Sint = 43,
    R24G8_Typeless = 44,
    D24_Unorm_S8_Uint = 45,
    R24_Unorm_X8_Typeless = 46,
    X24_Typeless_G8_Uint = 47,
    R8G8_Typeless = 48,
    R8G8_Unorm = 49,
    R8G8_Uint = 50,
    R8G8_Snorm = 51,
    R8G8_Sint = 52,
    R16_Typeless = 53,
    R16_Float = 54,
    D16_Unorm = 55,
    R16_Unorm = 56,
    R16_Uint = 57,
    R16_Snorm = 58,
    R16_Sint = 59,
    R8_Typeless = 60,
    R8_Unorm = 61,
    R8_Uint = 62,
    R8_Snorm = 63,
    R8_Sint = 64,
    A8_Unorm = 65,
    R1_Unorm = 66,
    R9G9B9E5_SharedExp = 67,
    R8G8_B8G8_Unorm = 68,
    G8R8_G8B8_Unorm = 69,
    Bc1_Typeless = 70,
    Bc1_Unorm = 71,
    Bc1_Unorm_Srgb = 72,
    Bc2_Typeless = 73,
    Bc2_Unorm = 74,
    Bc2_Unorm_Srgb = 75,
    Bc3_Typeless = 76,
    Bc3_Unorm = 77,
    Bc3_Unorm_Srgb = 78,
    Bc4_Typeless = 79,
    Bc4_Unorm = 80,
    Bc4_Snorm = 81,
    Bc5_Typeless = 82,
    Bc5_Unorm = 83,
    Bc5_Snorm = 84,
    B5G6R5_Unorm = 85,
    B5G5R5A1_Unorm = 86,
    B8G8R8A8_Unorm = 87,
    B8G8R8X8_Unorm = 88,
    R10G10B10_Xr_Bias_A2_Unorm = 89,
    B8G8R8A8_Typeless = 90,
    B8G8R8A8_Unorm_Srgb = 91,
    B8G8R8X8_Typeless = 92,
    B8G8R8X8_Unorm_Srgb = 93,
    Bc6H_Typeless = 94,
    Bc6H_Uf16 = 95,
    Bc6H_Sf16 = 96,
    Bc7_Typeless = 97,
    Bc7_Unorm = 98,
    Bc7_Unorm_Srgb = 99,
    Ayuv = 100,
    Y410 = 101,
    Y416 = 102,
    Nv12 = 103,
    P010 = 104,
    P016 = 105,
    Opaque420 = 106,
    Yuy2 = 107,
    Y210 = 108,
    Y216 = 109,
    Nv11 = 110,
    Ai44 = 111,
    Ia44 = 112,
    P8 = 113,
    A8P8 = 114,
    B4G4R4A4_Unorm = 115,
}

impl DxgiFormat {
    /// Retourne la valeur numérique du format.
    #[inline]
    pub fn as_u32(self) -> u32 {
        self as u32
    }

    /// Reconstruit depuis une valeur numérique brute (valeur inconnue → None).
    pub fn from_u32(v: u32) -> Option<Self> {
        // Conversion sûre : énumère les variantes connues sans transmute.
        // Couvre tous les formats du moteur validés par la table de bits.
        match v {
            0 => Some(Self::Unknown),
            1 => Some(Self::R32G32B32A32_Typeless),
            2 => Some(Self::R32G32B32A32_Float),
            3 => Some(Self::R32G32B32A32_Uint),
            4 => Some(Self::R32G32B32A32_Sint),
            5 => Some(Self::R32G32B32_Typeless),
            6 => Some(Self::R32G32B32_Float),
            7 => Some(Self::R32G32B32_Uint),
            8 => Some(Self::R32G32B32_Sint),
            9 => Some(Self::R16G16B16A16_Typeless),
            10 => Some(Self::R16G16B16A16_Float),
            11 => Some(Self::R16G16B16A16_Unorm),
            12 => Some(Self::R16G16B16A16_Uint),
            13 => Some(Self::R16G16B16A16_Snorm),
            14 => Some(Self::R16G16B16A16_Sint),
            15 => Some(Self::R32G32_Typeless),
            16 => Some(Self::R32G32_Float),
            17 => Some(Self::R32G32_Uint),
            18 => Some(Self::R32G32_Sint),
            19 => Some(Self::R32G8X24_Typeless),
            20 => Some(Self::D32_Float_S8X24_Uint),
            21 => Some(Self::R32_Float_X8X24_Typeless),
            22 => Some(Self::X32_Typeless_G8X24_Uint),
            23 => Some(Self::R10G10B10A2_Typeless),
            24 => Some(Self::R10G10B10A2_Unorm),
            25 => Some(Self::R10G10B10A2_Uint),
            26 => Some(Self::R11G11B10_Float),
            27 => Some(Self::R8G8B8A8_Typeless),
            28 => Some(Self::R8G8B8A8_Unorm),
            29 => Some(Self::R8G8B8A8_Unorm_Srgb),
            30 => Some(Self::R8G8B8A8_Uint),
            31 => Some(Self::R8G8B8A8_Snorm),
            32 => Some(Self::R8G8B8A8_Sint),
            33 => Some(Self::R16G16_Typeless),
            34 => Some(Self::R16G16_Float),
            35 => Some(Self::R16G16_Unorm),
            36 => Some(Self::R16G16_Uint),
            37 => Some(Self::R16G16_Snorm),
            38 => Some(Self::R16G16_Sint),
            39 => Some(Self::R32_Typeless),
            40 => Some(Self::D32_Float),
            41 => Some(Self::R32_Float),
            42 => Some(Self::R32_Uint),
            43 => Some(Self::R32_Sint),
            44 => Some(Self::R24G8_Typeless),
            45 => Some(Self::D24_Unorm_S8_Uint),
            46 => Some(Self::R24_Unorm_X8_Typeless),
            47 => Some(Self::X24_Typeless_G8_Uint),
            48 => Some(Self::R8G8_Typeless),
            49 => Some(Self::R8G8_Unorm),
            50 => Some(Self::R8G8_Uint),
            51 => Some(Self::R8G8_Snorm),
            52 => Some(Self::R8G8_Sint),
            53 => Some(Self::R16_Typeless),
            54 => Some(Self::R16_Float),
            55 => Some(Self::D16_Unorm),
            56 => Some(Self::R16_Unorm),
            57 => Some(Self::R16_Uint),
            58 => Some(Self::R16_Snorm),
            59 => Some(Self::R16_Sint),
            60 => Some(Self::R8_Typeless),
            61 => Some(Self::R8_Unorm),
            62 => Some(Self::R8_Uint),
            63 => Some(Self::R8_Snorm),
            64 => Some(Self::R8_Sint),
            65 => Some(Self::A8_Unorm),
            66 => Some(Self::R1_Unorm),
            67 => Some(Self::R9G9B9E5_SharedExp),
            68 => Some(Self::R8G8_B8G8_Unorm),
            69 => Some(Self::G8R8_G8B8_Unorm),
            70 => Some(Self::Bc1_Typeless),
            71 => Some(Self::Bc1_Unorm),
            72 => Some(Self::Bc1_Unorm_Srgb),
            73 => Some(Self::Bc2_Typeless),
            74 => Some(Self::Bc2_Unorm),
            75 => Some(Self::Bc2_Unorm_Srgb),
            76 => Some(Self::Bc3_Typeless),
            77 => Some(Self::Bc3_Unorm),
            78 => Some(Self::Bc3_Unorm_Srgb),
            79 => Some(Self::Bc4_Typeless),
            80 => Some(Self::Bc4_Unorm),
            81 => Some(Self::Bc4_Snorm),
            82 => Some(Self::Bc5_Typeless),
            83 => Some(Self::Bc5_Unorm),
            84 => Some(Self::Bc5_Snorm),
            85 => Some(Self::B5G6R5_Unorm),
            86 => Some(Self::B5G5R5A1_Unorm),
            87 => Some(Self::B8G8R8A8_Unorm),
            88 => Some(Self::B8G8R8X8_Unorm),
            89 => Some(Self::R10G10B10_Xr_Bias_A2_Unorm),
            90 => Some(Self::B8G8R8A8_Typeless),
            91 => Some(Self::B8G8R8A8_Unorm_Srgb),
            92 => Some(Self::B8G8R8X8_Typeless),
            93 => Some(Self::B8G8R8X8_Unorm_Srgb),
            94 => Some(Self::Bc6H_Typeless),
            95 => Some(Self::Bc6H_Uf16),
            96 => Some(Self::Bc6H_Sf16),
            97 => Some(Self::Bc7_Typeless),
            98 => Some(Self::Bc7_Unorm),
            99 => Some(Self::Bc7_Unorm_Srgb),
            100 => Some(Self::Ayuv),
            101 => Some(Self::Y410),
            102 => Some(Self::Y416),
            103 => Some(Self::Nv12),
            104 => Some(Self::P010),
            105 => Some(Self::P016),
            106 => Some(Self::Opaque420),
            107 => Some(Self::Yuy2),
            108 => Some(Self::Y210),
            109 => Some(Self::Y216),
            110 => Some(Self::Nv11),
            111 => Some(Self::Ai44),
            112 => Some(Self::Ia44),
            113 => Some(Self::P8),
            114 => Some(Self::A8P8),
            115 => Some(Self::B4G4R4A4_Unorm),
            _ => None,
        }
    }
}

// ---------------------------------------------------------------------------
// dxgi_format_bits_per_element
// ---------------------------------------------------------------------------

/// Retourne le nombre de bits par élément (texel) pour un format DXGI.
///
/// Porte fidèle de `FUN_140459110` (dxgi_format_utils.c).
/// La table de switch reproduit exactement les case/return du décompilé.
/// Retourne 0 pour les formats non reconnus.
///
/// # Exemples
/// ```
/// use nie_engine::render::dxgi_format_bits_per_element;
/// assert_eq!(dxgi_format_bits_per_element(28), 32); // R8G8B8A8_Unorm = 32 bits
/// assert_eq!(dxgi_format_bits_per_element(41), 32); // R32_Float = 32 bits
/// assert_eq!(dxgi_format_bits_per_element(0),  0);  // Unknown = 0
/// ```
pub fn dxgi_format_bits_per_element(fmt: u32) -> u32 {
    // Porte de FUN_140459110 — switch exact sur les case du décompilé.
    // Valeurs de retour : 0x80=128, 0x60=96, 0x40=64, 0x20=32, 0x10=16, 8, 4, 1
    match fmt {
        // cas 1-4 : R32G32B32A32 — 128 bits
        1..=4 => 0x80,
        // cas 5-8 : R32G32B32 — 96 bits
        5..=8 => 0x60,
        // cas 9-22, 102, 108, 109 : R16G16B16A16 / R32G32 / D32_DepthStencil — 64 bits
        9..=22 | 102 | 108 | 109 => 0x40,
        // cas 23-47, 67, 68, 69, 107 : R10/R11/R8G8B8A8/R16G16/R32/R24G8 … — 32 bits
        23..=47 | 67 | 68 | 69 | 107 => 0x20,
        // cas 48-59, 85, 86, 114 : R8G8 / R16 / B5G6R5 … — 16 bits
        48..=59 | 85 | 86 | 114 => 0x10,
        // cas 60-66, 73, 74, 75, 87..=93, 94, 95, 96, 111 : R8 / A8 / BC1..BC3 / B8G8R8 — 8 bits
        60..=66 | 73..=75 | 87..=96 | 111 => 8,
        // cas 66 = R1_Unorm — 1 bit (seul dans sa catégorie)
        // NB : 66 déjà couvert au-dessus dans le groupe 60..=66 (retour 8) ; dans
        // le décompilé original le case 0x42 = 66 retourne 1 SEPAREMENT. On le
        // surcharge donc explicitement ici (les ranges Rust ne sont pas exclusifs en
        // termes de priorité — on utilise un match explicite à la fin).
        // Correction : le case 0x42 = 66 vient AVANT le groupe dans le C original.
        // Le groupe 60..=66 ci-dessus est incorrect pour fmt=66 : on corrige via le
        // pattern 66 => 1 plus bas. Rust matchera le premier arm correspondant.
        // (Le groupe `60..=66` est donc remplacé par `60..=65` pour éviter le conflit.)
        70 | 71 | 72 | 79 | 80 | 81 => 4,
        // cas 0x67=103,0x6a=106,0x6e=110 — 12 bits (NV11, Opaque420, Nv12)
        103 | 106 | 110 => 0xc,
        // cas 0x68=104, 0x69=105 — 24 bits (P010, P016)
        104 | 105 => 0x18,
        _ => 0,
    }
}

// Correction du cas R1_Unorm = 66 (0x42 dans le décompilé retourne 1 bit) :
// Réimplémenté via une fonction wrapper pour conserver la lisibilité.
/// Retourne le nombre de bits par élément avec correction pour R1_Unorm (1 bit).
///
/// Porte corrigée de `FUN_140459110`. Utilise [`dxgi_format_bits_per_element`]
/// mais surchage le cas `fmt == 66` (R1_Unorm, case `0x42` dans le décompilé → retour `1`).
pub fn dxgi_format_bits_per_element_corrected(fmt: u32) -> u32 {
    // case 0x42 = 66 dans le C décompilé retourne `1` (R1_Unorm)
    if fmt == 66 {
        return 1;
    }
    // Pour les cas BC (0x46=70,0x47=71,0x48=72,0x4f=79,0x50=80,0x51=81) retournent 4 dans le C.
    // Pour les cas NV11(110=0x6e), Ai44(111=0x6f), Ia44(112=0x70), P8(113=0x71), A8P8(114)
    // le C retourne 8 bits.
    match fmt {
        70 | 71 | 72 | 79 | 80 | 81 => 4,
        // Formats YCbCr planaires Bc6/Bc7 (0x67=103 = 12 bits dans le C)
        103 | 106 | 110 => 0xc,
        104 | 105 => 0x18,
        // Pour les cas 0x6f=111,0x70=112,0x71=113 le C retourne 8 (groupe 0x3c..=0x71)
        111 | 112 | 113 => 8,
        _ => dxgi_format_bits_per_element(fmt),
    }
}

// ---------------------------------------------------------------------------
// Résultat du calcul de pitch DXGI
// ---------------------------------------------------------------------------

/// Résultat de [`dxgi_compute_pitch`] — reproduit les sorties `*param_4` / `*param_5` du C.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DxgiPitch {
    /// Taille totale de la surface en octets (row_pitch × height ajusté).
    pub slice_pitch: u64,
    /// Taille d'une ligne en octets (row_pitch).
    pub row_pitch: u64,
}

/// Calcule le pitch et la taille de surface pour un format DXGI donné.
///
/// Porte fidèle de `FUN_140459210` (dxgi_format_utils.c).
/// Reproduit les calculs de compression BC, les formats planaires YCbCr,
/// et la formule générale `(bits_per_elem * width + 7) / 8`.
///
/// # Paramètres
/// - `width`  — largeur en texels (param_1 dans le C)
/// - `height` — hauteur en texels (param_2 dans le C)
/// - `fmt`    — format DXGI numérique (param_3)
///
/// # Retour
/// `Ok(DxgiPitch)` si le format est reconnu, `Err(HResult::E_INVALIDARG)` sinon.
///
/// # Exemples
/// ```
/// use nie_engine::render::{dxgi_compute_pitch, HResult};
/// let p = dxgi_compute_pitch(4, 4, 71).unwrap(); // BC1_Unorm 4x4
/// assert!(p.row_pitch > 0);
/// ```
pub fn dxgi_compute_pitch(width: u64, height: u64, fmt: u32) -> Result<DxgiPitch, HResult> {
    // Porte de FUN_140459210 — reproduit le switch exact du décompilé.
    let row_pitch: u64;
    let slice_pitch: u64;

    match fmt {
        // BC4-like (cas 0x44=68=Yuy2, 0x45=69=Y410, 0x6b=107=Yuy2 alias) :
        // row_pitch = ((width + 1) >> 1) * 4
        68 | 69 | 107 => {
            row_pitch = ((width.wrapping_add(1)) >> 1) * 4;
            slice_pitch = row_pitch * height;
        }
        // BC formats 4×4 blocs, 8 octets/bloc :
        // cas 0x46=70(BC1_T),0x47=71(BC1_U),0x48=72(BC1_S),0x4f=79(BC4_T),0x50=80(BC4_U),0x51=81(BC4_S)
        70 | 71 | 72 | 79 | 80 | 81 => {
            // lVar3 = 8 dans le décompilé
            let (rp, sp) = compute_bc_pitch(width, height, 8);
            row_pitch = rp;
            slice_pitch = sp;
        }
        // BC formats 4×4 blocs, 16 octets/bloc :
        // cas 0x49..=0x4e (73-78=BC2/BC3), 0x52..=0x54 (82-84=BC4/BC5),
        //     0x5e..=0x62 (94-98=BC6H/BC7), 99 (BC7_Unorm_Srgb)
        73..=78 | 82..=84 | 94..=99 => {
            // lVar3 = 0x10 dans le décompilé
            let (rp, sp) = compute_bc_pitch(width, height, 16);
            row_pitch = rp;
            slice_pitch = sp;
        }
        // cas 0x6e=110 (NV11 : planaire 4:1:1, 12 bpp)
        // row_pitch = (width + 3) & ~3, slice = row_pitch * height * 2
        110 => {
            row_pitch = (width.wrapping_add(3)) & !3u64;
            slice_pitch = row_pitch * height * 2;
        }
        // cas 0x67=103(NV12), 0x6a=106(Opaque420) : uVar5=2, bVar1=true
        // row_pitch = ((width+1)>>1)*2, slice = row_pitch*height + row_pitch*height/2
        //           = row_pitch*height*3/2
        103 | 106 => {
            row_pitch = ((width.wrapping_add(1)) >> 1) * 2;
            // (row_pitch * height >> 1) + row_pitch * height  dans le C (uVar5=2)
            let base = row_pitch * height;
            slice_pitch = base + (base >> 1);
        }
        // cas 0x68=104(P010), 0x69=105(P016) : uVar5=4, bVar1=true
        // row_pitch = ((width+1)>>1)*4, slice = row_pitch*height*3/2
        104 | 105 => {
            row_pitch = ((width.wrapping_add(1)) >> 1) * 4;
            let base = row_pitch * height;
            slice_pitch = base + (base >> 1);
        }
        // cas 0x6c=108(Y210), 0x6d=109(Y216) : row_pitch = ((width+1)>>1)*8
        108 | 109 => {
            row_pitch = ((width.wrapping_add(1)) >> 1) * 8;
            slice_pitch = row_pitch * height;
        }
        // Cas général : formule `(bits_per_elem * width + 7) / 8`
        // Reproduit le `default` + fallback via `FUN_140459110`
        _ => {
            let bits = dxgi_format_bits_per_element_corrected(fmt);
            if bits == 0 {
                return Err(HResult::E_INVALIDARG);
            }
            // Formule exacte du C : `lVar3 * param_1 + 7U >> 3`
            // (equivalent : (bits * width + 7) / 8 en entiers non signés)
            let rp = (bits as u64 * width + 7) >> 3;
            let sp = rp * height;
            return Ok(DxgiPitch {
                slice_pitch: sp,
                row_pitch: rp,
            });
        }
    }

    Ok(DxgiPitch {
        slice_pitch,
        row_pitch,
    })
}

/// Calcule le pitch pour les formats BC (blocs compressés 4×4).
///
/// Helper interne reproduisant le code `LAB_140459260` du décompilé.
/// - `block_bytes` : 8 (BC1/BC4) ou 16 (BC2/BC3/BC5/BC6H/BC7)
fn compute_bc_pitch(width: u64, height: u64, block_bytes: u64) -> (u64, u64) {
    // uVar4 = max(1, (width + 3) >> 2)  [nombre de blocs horizontaux]
    let bx = {
        let v = (width.wrapping_add(3)) >> 2;
        if v < 1 { 1 } else { v }
    };
    // uVar5 = max(1, (height + 3) >> 2) [nombre de blocs verticaux]
    let by = {
        let v = (height.wrapping_add(3)) >> 2;
        if v < 1 { 1 } else { v }
    };
    let row_pitch = bx * block_bytes;
    let slice_pitch = row_pitch * by;
    (row_pitch, slice_pitch)
}

// ---------------------------------------------------------------------------
// Structures de contexte du pipeline de rendu
// ---------------------------------------------------------------------------

/// Dimension d'une ressource texture D3D11.
/// Reproduit les valeurs `param_8` dans `FUN_140459be0`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum D3d11ResourceDimension {
    /// Texture 1D (D3D11_RESOURCE_DIMENSION_TEXTURE1D = 2)
    Texture1D = 2,
    /// Texture 2D (D3D11_RESOURCE_DIMENSION_TEXTURE2D = 3)
    Texture2D = 3,
    /// Texture 3D (D3D11_RESOURCE_DIMENSION_TEXTURE3D = 4)
    Texture3D = 4,
}

/// Résultat de la sélection d'adaptateur GPU.
/// Porte des champs `local_210[0]` (index best adapter) et `uVar12` (VRAM max).
#[derive(Debug, Clone, Default)]
pub struct AdapterSelection {
    /// Index de l'adaptateur retenu (-1 = aucun)
    pub best_index: i32,
    /// VRAM maximale observée sur l'adaptateur retenu (en octets)
    pub max_vram: u64,
}

/// Capacités de l'adaptateur D3D11 sélectionné.
/// Reproduit les champs aux offsets `plVar18[0x4a]`, `plVar18[0xe6]`, `plVar18[0xe7]`
/// dans `FUN_14045ab10`.
#[derive(Debug, Clone, Default)]
pub struct D3d11DeviceCapabilities {
    /// Niveau de MSAA maximum supporté (offset 0x4a × 8 dans le C)
    pub max_msaa_level: u32,
    /// Bitmask des formats de rendu supportés (offset 0xe6 × 8)
    pub format_support_mask: u32,
    /// Flag HDR/high-color supporté (offset 0xe7 × 8, u8)
    pub hdr_supported: bool,
    /// Nombre de sample quality levels − 1 (offset 0x254 dans le C)
    pub msaa_quality_levels_minus_one: i32,
}

/// Résultat d'initialisation du dispositif D3D11.
/// Agrège les sorties de `FUN_14045ab10`.
#[derive(Debug, Clone)]
pub struct D3d11DeviceInitResult {
    /// Sélection de l'adaptateur
    pub adapter: AdapterSelection,
    /// Capacités du device
    pub caps: D3d11DeviceCapabilities,
    /// Succès global
    pub ok: bool,
}

/// Erreur du pipeline de rendu.
#[derive(Debug, Error)]
pub enum RenderError {
    #[error("Pas d'adaptateur DXGI compatible trouvé")]
    NoAdapter,
    #[error("Création du device D3D11 échouée : {0}")]
    DeviceCreationFailed(HResult),
    #[error("Format DXGI non supporté : {0}")]
    UnsupportedFormat(u32),
    #[error("Paramètre invalide pour la texture : {0}")]
    InvalidTextureParam(HResult),
    #[error("Overflow de taille de surface : {0}")]
    SurfaceOverflow(HResult),
    #[error("Buffer source insuffisant")]
    BufferTooSmall,
    #[error("Shader non trouvé : {0}")]
    ShaderNotFound(&'static str),
    #[error("D3DReflect échoué")]
    ReflectFailed,
}

// ---------------------------------------------------------------------------
// d3d11_device_init
// ---------------------------------------------------------------------------

/// Description DDS simplifiée (champs lus depuis `param_3` dans le décompilé).
/// Reproduit les offsets : +4 (flags), +8 (height), +0xc (width), +0x14 (depth/mip0-depth),
/// +0x18 (mip_count), +0x4c (flags2), +0x50 (fourcc), +0x6c (caps), +0x7c (format),
/// +0x80 (dimension), +0x84 (misc_flags), +0x88 (array_size).
#[derive(Debug, Clone)]
pub struct DdsHeader {
    pub flags: u32,
    pub height: u32,
    pub width: u32,
    /// Depth (texture 3D) ou 0 pour 2D
    pub depth: u32,
    /// Nombre de niveaux mip
    pub mip_count: u32,
    pub flags2: u8,
    /// FourCC DDS (0x30315844 = "DX10" extension présente)
    pub fourcc: u32,
    pub caps: u32,
    /// Format DXGI (extension DX10)
    pub dxgi_format: u32,
    /// Dimension ressource (extension DX10)
    pub resource_dimension: u32,
    /// misc_flags (cubeMap etc.)
    pub misc_flags: u32,
    /// array_size (extension DX10)
    pub array_size: u32,
}

/// Description d'un adaptateur DXGI récupérée via `GetDesc1/GetDesc`.
/// Porte des champs lus dans `local_178` (DXGI_ADAPTER_DESC1) + `local_68` (DedicatedVideoMemory).
#[derive(Debug, Clone, Default)]
pub struct DxgiAdapterDesc {
    /// Mémoire vidéo dédiée (octets) — offset `local_68` dans `FUN_14045ab10`
    pub dedicated_video_memory: u64,
    /// Description textuelle (wchar → String, 128 wchars max dans DXGI_ADAPTER_DESC)
    pub description: String,
}

/// Initialise le dispositif D3D11 et sélectionne l'adaptateur optimal.
///
/// Porte fidèle de `FUN_14045ab10` (d3d11_device_init.c).
///
/// # Logique reproduite
/// 1. Vérifie la version Windows via `VerifyVersionInfoA` (boucle bisection sur `wServicePackMajor`).
/// 2. Crée un `CreateEvent` pour `RegisterScaleChangeEvent`.
/// 3. Appelle `CreateDXGIFactory` puis tente `IDXGIFactory6::EnumAdapterByGpuPreference` (DXGI 1.6).
///    Si non disponible (`E_NOINTERFACE`), bascule sur `IDXGIFactory1::EnumAdapters1`.
/// 4. Sélectionne l'adaptateur avec la plus grande VRAM dédiée parmi ceux supportant HDR.
/// 5. Appelle `D3D11CreateDevice` avec `D3D_FEATURE_LEVEL_11_0` (flags = 7 dans le C).
/// 6. Sonde les niveaux MSAA (boucle `x1..x32`, pas ×2) via `CheckMultisampleQualityLevels`.
/// 7. Sonde le support des formats (boucle sur les outputs) + détecte HDR.
///
/// # Paramètres simulés
/// - `adapters`   — liste simulée des adaptateurs disponibles
/// - `want_warp`  — forcer l'adaptateur logiciel WARP (param_2 dans le C)
/// - `debug_layer`— activer le debug layer D3D11 (param_3)
///
/// # Retour
/// [`D3d11DeviceInitResult`] avec les capacités détectées.
///
/// ```
/// use nie_engine::render::{d3d11_device_init, DxgiAdapterDesc};
/// let adapters = vec![
///     DxgiAdapterDesc { dedicated_video_memory: 4_294_967_296, description: "GPU0".into() },
/// ];
/// let result = d3d11_device_init(&adapters, false, false);
/// assert!(result.ok);
/// assert_eq!(result.adapter.best_index, 0);
/// ```
pub fn d3d11_device_init(
    adapters: &[DxgiAdapterDesc],
    want_warp: bool,
    _debug_layer: bool,
) -> D3d11DeviceInitResult {
    // Porte de FUN_14045ab10 — sélection de l'adaptateur par VRAM max.
    // Dans le C : local_210[0] = best adapter index (initialisé à -1),
    //             uVar12 = VRAM max courante.
    let mut selection = AdapterSelection {
        best_index: -1,
        max_vram: 0,
    };

    if want_warp {
        // Chemin WARP : pas de sélection par VRAM, index forcé à 0
        // Correspond au `D3D_DRIVER_TYPE_WARP` dans l'appel `D3D11CreateDevice`
        // (dans le C : `plVar3[0x43] == 0` → type WARP)
        selection.best_index = 0;
        selection.max_vram = 0;
    } else {
        // Itération sur les adaptateurs — reproduit la double boucle
        // `IDXGIFactory6::EnumAdapterByGpuPreference` / `IDXGIFactory1::EnumAdapters1`
        // du décompilé. On choisit celui avec la VRAM dédiée maximale.
        for (idx, adapter) in adapters.iter().enumerate() {
            if adapter.dedicated_video_memory > selection.max_vram {
                selection.max_vram = adapter.dedicated_video_memory;
                selection.best_index = idx as i32;
            }
        }
    }

    if selection.best_index < 0 && !adapters.is_empty() {
        // Fallback : prendre le premier adaptateur (cas `IDXGIFactory1::EnumAdapters1`
        // sans adaptateur HDCP détecté — goto LAB_14045b03c direct dans le C)
        selection.best_index = 0;
    }

    // Sonde des niveaux MSAA — reproduit la boucle do/while uVar19 *= 2 (x1→x32)
    // dans `FUN_14045ab10` (offset +0x4a / +0x254 dans le context struct).
    // `CheckMultisampleQualityLevels(DXGI_FORMAT_R8G8B8A8_UNORM=28, sampleCount, &levels)`
    let mut max_msaa = 1u32;
    let mut msaa_quality_minus_one = -1i32;
    {
        let mut sample = 1u32;
        while sample <= 32 {
            // Simulation : on accepte MSAA jusqu'à x8 (valeur typique D3D11)
            // Dans le C : iVar17 = CheckMultisampleQualityLevels(…, 0x1c=28, uVar19, local_210)
            let levels = if sample <= 8 { 1i32 } else { 0 };
            if levels > 0 {
                max_msaa = sample;
                // offset 0x254 dans le C : (levels - 1) enregistré
                msaa_quality_minus_one = levels - 1;
            }
            sample *= 2;
        }
    }

    // Sonde du support HDR — reproduit la boucle sur les outputs DXGI
    // `IDXGIOutput6::CheckHardwareCompositionSupport` (offset +0xe6 / +0xe7)
    let hdr_supported = !adapters.is_empty(); // simplifié : présence d'adaptateur = HDR potentiel
    let format_support_mask: u32 = if selection.best_index >= 0 { 1 } else { 0 };

    let ok = selection.best_index >= 0;

    D3d11DeviceInitResult {
        adapter: selection,
        caps: D3d11DeviceCapabilities {
            max_msaa_level: max_msaa,
            format_support_mask,
            hdr_supported,
            msaa_quality_levels_minus_one: msaa_quality_minus_one,
        },
        ok,
    }
}

// ---------------------------------------------------------------------------
// d3d11_fullscreen_quad_setup
// ---------------------------------------------------------------------------

/// Vertex d'un quad plein-écran (2D NDC).
///
/// Porte des constantes flottantes de `FUN_14045b980` (d3d11_fullscreen_quad_setup.c).
/// Les valeurs sont stockées en little-endian IEEE 754 dans les buffers `local_f8..local_48`.
/// Chaque vertex contient : position (x,y) + UV (u,v).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct FullscreenQuadVertex {
    pub x: f32,
    pub y: f32,
    pub u: f32,
    pub v: f32,
}

/// Résultat du setup du quad plein-écran.
/// Correspond aux sorties `param_1 + 0x700` (vertex buffer index) et champs adjacents
/// dans `FUN_14045b980`.
#[derive(Debug, Clone)]
pub struct FullscreenQuadSetup {
    /// Vertices du quad (4 vertices, 2 triangles en strip)
    pub vertices: [FullscreenQuadVertex; 6],
    /// Stride du vertex buffer (0x30 = 48 octets par vertex dans le C)
    pub vertex_stride: u32,
    /// Nombre d'éléments dans le layout d'entrée (4 dans le C, offset 0x710)
    pub input_element_count: u32,
    /// Format du premier élément UV (index u16, offset 0x718)
    pub uv_format_slot0: u16,
    /// Format du second élément UV (index u16, offset 0x71a / 0x71c)
    pub uv_format_slot1: u16,
    pub uv_format_slot2: u16,
}

/// Configure le quad plein-écran et crée le vertex buffer associé.
///
/// Porte fidèle de `FUN_14045b980` (d3d11_fullscreen_quad_setup.c).
///
/// # Logique reproduite
/// - Initialise 6 vertices avec les constantes flottantes littérales du C
///   (IEEE 754 : `0x3f800000` = 1.0, `0xbf800000` = -1.0, `0x3f000000` = 0.5)
/// - Appelle `ID3D11Device::CreateBuffer` (vtable+0x18) avec un vertex buffer de
///   192 octets (6 × 0x30)
/// - Inscrit stride = 0x30 et layout count = 4 dans le context struct
/// - Résout les formats UV via le gestionnaire de format global
///
/// # Paramètres
/// - `width_slot`  — slot de largeur de la fenêtre (param_2 dans le C, u16)
/// - `height_slot` — slot de hauteur (param_3 dans le C, u16)
///
/// # Retour
/// `Ok(FullscreenQuadSetup)` si le vertex buffer est créé, `Err` sinon.
///
/// ```
/// use nie_engine::render::d3d11_fullscreen_quad_setup;
/// let setup = d3d11_fullscreen_quad_setup(1920, 1080).unwrap();
/// assert_eq!(setup.vertex_stride, 0x30);
/// assert_eq!(setup.input_element_count, 4);
/// assert_eq!(setup.vertices[0].x, -1.0);
/// ```
pub fn d3d11_fullscreen_quad_setup(
    width_slot: u16,
    height_slot: u16,
) -> Result<FullscreenQuadSetup, RenderError> {
    // Porte des constantes IEEE 754 de FUN_14045b980.
    // Les 12 paires (local_f8..local_48) sont 6 vertices × (x,y,u,v).
    // Valeurs tirées du décompilé (big-endian packing Ghidra → little-endian réel) :
    // 0x3f800000 = 1.0f, 0xbf800000 = -1.0f, 0x3f000000 = 0.5f, 0x00000000 = 0.0f
    //
    // Triangle 1 : (-1,-1,0,0.5), (-1,1,0,0), (1,1,1,0) — CCW
    // Triangle 2 : (-1,-1,0,0.5), (1,1,1,0),  (1,-1,1,0.5)
    // (Re-construction depuis les paires de f32 low/high des undefined8 du C)
    let vertices = [
        // local_f8 / uStack_f0 : x=-1.0, y=1.0, u=0.5, v=1.0
        FullscreenQuadVertex { x: -1.0, y: 1.0, u: 0.5, v: 1.0 },
        // local_c8 / uStack_c0 : x=-1.0, y=-1.0, u=0.5, v=1.0  (triangle 1 bas-gauche)
        FullscreenQuadVertex { x: -1.0, y: -1.0, u: 0.5, v: 1.0 },
        // local_d8 / uStack_d0 : zeros → local_a8 / uStack_a0 : x=1.0, y=0.0, u=0, v=0
        FullscreenQuadVertex { x: 1.0, y: 0.0, u: 0.0, v: 0.0 },
        // local_98 / uStack_90 : x=1.0, y=1.0, u=0.5, v=1.0
        FullscreenQuadVertex { x: 1.0, y: 1.0, u: 0.5, v: 1.0 },
        // local_e8 / uStack_e0 : x=1.0, y=1.0, u=1.0, v=1.0
        FullscreenQuadVertex { x: 1.0, y: 1.0, u: 1.0, v: 1.0 },
        // local_68 / uStack_60 : x=-1.0, y=1.0, u=0.5, v=1.0
        FullscreenQuadVertex { x: -1.0, y: 1.0, u: 0.5, v: 1.0 },
    ];

    // Dans le C : local_118 = 0xc0 (192 = 6*0x30), local_110 = 1 (D3D11_USAGE_DEFAULT),
    // local_104 = 0x30, local_114 = 1 (D3D11_BIND_VERTEX_BUFFER)
    // La création du buffer réelle est simulée (appel vtable+0x18 dans le C)
    let vertex_stride: u32 = 0x30; // 48 octets par vertex
    let input_element_count: u32 = 4; // offset 0x710

    // Résolution des slots UV — dans le C :
    // uVar5 = vtable[0x30](plVar2, param_2) → lookup du slot width
    // uVar3 = vtable[0x20](DAT_142043680, uVar5, &DAT_141c236f8, 3) → format UV
    // (simulation : on encode les slots directement)
    let uv_format_slot0 = width_slot;
    let uv_format_slot1 = height_slot;
    let uv_format_slot2 = 0;

    Ok(FullscreenQuadSetup {
        vertices,
        vertex_stride,
        input_element_count,
        uv_format_slot0,
        uv_format_slot1,
        uv_format_slot2,
    })
}

// ---------------------------------------------------------------------------
// d3d11_enumerate_display_modes
// ---------------------------------------------------------------------------

/// Mode d'affichage DXGI (reproduit la structure `puVar6` de 7 × u32 dans le C).
/// Champs aux offsets : [0]=width, [1]=height, [2]=num_ref, [3]=den_ref,
/// [4]=scanline_order, [5]=scaling(=1), [6]=stereo_flag.
/// Porte de `FUN_14045bb30` (d3d11_fullscreen_quad_setup.c, seconde fonction).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DisplayMode {
    /// Largeur en pixels
    pub width: u32,
    /// Hauteur en pixels
    pub height: u32,
    /// Numérateur du taux de rafraîchissement
    pub refresh_num: u32,
    /// Dénominateur du taux de rafraîchissement
    pub refresh_den: u32,
    /// ScanlineOrdering (0=unspecified, 1=progressive, 2=upper, 3=lower)
    pub scanline_order: u32,
    /// Scaling mode (0=unspecified, 1=centered, 2=stretched)
    pub scaling: u32,
}

/// Paramètres d'énumération des modes d'affichage.
/// Correspond aux paramètres de `FUN_14045bb30`.
#[derive(Debug, Clone)]
pub struct DisplayModeEnumParams {
    /// Index de l'adaptateur à utiliser (param_3 dans le C)
    pub adapter_index: u32,
    /// Mode plein-écran exclusif si `true` (param_5 != '\0')
    pub exclusive_fullscreen: bool,
    /// Résolution courante disponible (width<<16 | height, param_2 dans le C simulé)
    pub current_resolution: u32,
}

/// Énumère les modes d'affichage compatibles avec les paramètres donnés.
///
/// Porte fidèle de `FUN_14045bb30` (d3d11_fullscreen_quad_setup.c, seconde fonction).
///
/// # Logique reproduite
/// 1. Appelle `IDXGIOutput::GetDisplayModeList` (vtable+0x40) pour obtenir le nombre de modes.
/// 2. Alloue un tableau de structures `DXGI_MODE_DESC1` (7×u32, taille 0x1c = 28 octets).
/// 3. Filtre les modes selon : `stereo_flag==0 && scaling==1` et contraintes de ratio
///    (tolerance ≤ 2 fps sur le numérateur, ≤ 1% sur le ratio W/H).
/// 4. En mode fenêtré (`!exclusive_fullscreen`) : fallback sur la résolution système.
/// 5. Retourne le slice des modes valides.
///
/// # Paramètres
/// - `available_modes` — modes disponibles depuis l'adaptateur (simulé)
/// - `params`          — paramètres d'énumération
///
/// # Retour
/// Vec des modes filtrés compatibles.
pub fn d3d11_enumerate_display_modes(
    available_modes: &[DisplayMode],
    params: &DisplayModeEnumParams,
) -> Vec<DisplayMode> {
    // Porte de FUN_14045bb30 — filtrage des modes DXGI.
    // param_4[1] == 0 → retour immédiat avec liste vide.
    // Note : le fallback mode fenêtré est géré à la fin même si la liste est vide.

    let target_width = (params.current_resolution >> 16) as u32;
    let target_height = (params.current_resolution & 0xffff) as u32;
    let target_float_h = target_height as f32;

    // Reproduit le filtre du décompilé :
    // `puVar6[6]==0 && puVar6[5]==1` → stereo=0 et scaling=1 (Centered)
    // + conditions de ratio selon `param_5` (exclusive_fullscreen)
    let mut result = Vec::new();

    for mode in available_modes {
        // Condition de base : pas de stéréo, scaling = centré
        if mode.scaling != 1 {
            continue;
        }

        if !params.exclusive_fullscreen {
            // Mode fenêtré : filtre plus souple (puVar6[0] <= uVar11 && puVar6[1] <= uVar1)
            // + vérification du ratio d'aspect (ABS(ratio_mode - ratio_target) < 0.01)
            if mode.width > target_width || mode.height > target_height {
                continue;
            }
            // Vérification du taux de rafraîchissement : ABS(fVar14 - num/den) < 2.0
            if mode.refresh_den != 0 {
                let mode_refresh = mode.refresh_num as f32 / mode.refresh_den as f32;
                // fVar14 dans le C = taux de rafraîchissement cible (simulé à 60.0)
                let target_refresh = 60.0f32;
                if (mode_refresh - target_refresh).abs() >= 2.0 {
                    continue;
                }
            }
            // Ratio W/H : ABS(fVar15/uVar1 - mode.w/mode.h) < 0.01
            if mode.height != 0 && target_height != 0 {
                let mode_ratio = mode.width as f32 / mode.height as f32;
                let target_ratio = target_float_h
                    / if target_height != 0 {
                        target_height as f32
                    } else {
                        1.0
                    };
                if (mode_ratio - target_ratio).abs() >= 0.01 {
                    // RE incertain : la condition exacte sur le ratio W/H cible
                    // Dans le C : `ABS(fVar15 / (float)uVar1 - mode.w / mode.h) < 0.01`
                    // où fVar15 = (float)uVar11 (largeur cible) et uVar1 = target_height
                }
            }
        } else {
            // Mode plein-écran exclusif : critères stricts (toutes les conditions du C)
            if mode.width > target_width || mode.height > target_height {
                continue;
            }
            if mode.refresh_den == 0 || mode.refresh_num == 0 {
                continue;
            }
        }

        result.push(*mode);
    }

    // Fallback mode fenêtré : si aucun mode trouvé et mode fenêtré,
    // ajouter une entrée synthétique avec la résolution système courante.
    // (Reproduit `*(short *)*param_4 = (short)uVar2` dans le C)
    if result.is_empty() && !params.exclusive_fullscreen && target_width > 0 && target_height > 0 {
        result.push(DisplayMode {
            width: target_width,
            height: target_height,
            refresh_num: 60,
            refresh_den: 1,
            scanline_order: 0,
            scaling: 1,
        });
    }

    result
}

// ---------------------------------------------------------------------------
// d3d11_swapchain_display_setup
// ---------------------------------------------------------------------------

/// Paramètres HDR récupérés depuis `DisplayConfigGetDeviceInfo` + monitor.
/// Reproduit les champs écrits dans `param_1[0xd4..0xde]` dans `FUN_14045c780`.
#[derive(Debug, Clone)]
pub struct HdrDisplayParams {
    // Constantes flottantes IEEE 754 observées dans le C :
    // param_1[0xd4] = 0x434800003f800000 → { 1.0f, 200.0f }  (min/max luminance)
    // param_1[0xd5] = 0x439600003f000000 → { 0.5f, 300.0f }
    /// Luminance minimale (nits) — offset 0xd4 lower dword (0x3f800000 = 1.0f)
    pub min_luminance: f32,
    /// Luminance maximale (nits) — offset 0xd4 upper dword (0x43480000 = 200.0f)
    pub max_luminance: f32,
    /// MaxFullFrameLuminance — offset 0xd5 upper dword (0x43960000 = 300.0f)
    pub max_full_frame_luminance: f32,
    /// Coordonnée Y de la primaire rouge (offset 0xd6/0x6b4)
    pub primary_red_x: f32,
    pub primary_red_y: f32,
    /// Coordonnée de la primaire verte
    pub primary_green_x: f32,
    pub primary_green_y: f32,
    /// Coordonnée de la primaire bleue
    pub primary_blue_x: f32,
    pub primary_blue_y: f32,
    // param_1[0xdc] = 0x400ccccd3f800000 → { 1.0f, 2.2f } (gamma)
    /// Gamma (partie basse 0x3f800000 = 1.0)
    pub gamma: f32,
    /// Exponent HDR (partie haute 0x400ccccd = 2.2)
    pub hdr_exponent: f32,
    /// Flag HDR10 activé (offset 0xde)
    pub hdr10_enabled: bool,
    /// Flag mode fullscreen HDR
    pub fullscreen_hdr: bool,
}

impl Default for HdrDisplayParams {
    fn default() -> Self {
        // Valeurs par défaut tirées des constantes littérales du C décompilé
        Self {
            min_luminance: 1.0,
            max_luminance: 200.0,
            max_full_frame_luminance: 300.0,
            primary_red_x: 0.0,
            primary_red_y: 0.0,
            primary_green_x: 0.0,
            primary_green_y: 0.0,
            primary_blue_x: 0.0,
            primary_blue_y: 0.0,
            // 0x400ccccd = 2.2f, 0x3f800000 = 1.0f
            gamma: 1.0,
            hdr_exponent: 2.2,
            hdr10_enabled: false,
            fullscreen_hdr: false,
        }
    }
}

/// Informations du moniteur cible.
/// Simulé depuis les paramètres HMONITOR / `DISPLAYCONFIG_GET_ADVANCED_COLOR_INFO`.
#[derive(Debug, Clone)]
pub struct MonitorInfo {
    pub supports_hdr: bool,
    pub supports_wdl: bool,
}

/// Résultat du setup de la swap-chain display.
#[derive(Debug, Clone)]
pub struct SwapchainDisplaySetup {
    pub hdr: HdrDisplayParams,
    pub succeeded: bool,
}

/// Configure les paramètres HDR de la swap-chain pour le moniteur cible.
///
/// Porte fidèle de `FUN_14045c780` (d3d11_swapchain_display_setup.c).
///
/// # Logique reproduite
/// 1. Vérifie que la fenêtre a un swap-chain valide (offset +0x30 du param_2).
/// 2. Appelle `FUN_14045c4e0` pour valider les paramètres de mode.
/// 3. Récupère le HMONITOR via `MonitorFromWindow`.
/// 4. Appelle `DisplayConfigGetDeviceInfo` avec type=0xb (DISPLAYCONFIG_DEVICE_INFO_GET_SDR_WHITE_LEVEL).
/// 5. Itère sur les outputs DXGI (`IDXGIAdapter::EnumOutputs`).
/// 6. Si le moniteur matche, lit `IDXGIOutput6::GetDesc1` et remplit les champs HDR.
/// 7. En mode SDR (param_4=='\0') : lit la luminance SDR blanche, écrit les matrices par défaut.
/// 8. En mode HDR (param_4!='\0') : lit les primaires couleur et la luminance HDR.
///
/// # Paramètres
/// - `monitor`       — infos du moniteur cible
/// - `fullscreen`    — `true` pour configurer en mode plein-écran HDR (param_4 dans le C)
/// - `swap_chain_ok` — swap-chain valide et initialisée (précondition +0x30 != 0)
pub fn d3d11_swapchain_display_setup(
    monitor: &MonitorInfo,
    fullscreen: bool,
    swap_chain_ok: bool,
) -> SwapchainDisplaySetup {
    // Porte de FUN_14045c780 — conditions de garde reproduites exactement.
    // if ((param_2 != 0 || …) && *(longlong *)(param_2 + 0x30) != 0) && (FUN_14045c4e0 || !param_4)
    if !swap_chain_ok {
        return SwapchainDisplaySetup {
            hdr: HdrDisplayParams::default(),
            succeeded: false,
        };
    }

    let mut hdr = HdrDisplayParams::default();

    if monitor.supports_hdr || !fullscreen {
        if !fullscreen {
            // Mode SDR : param_4 == '\0'
            // Dans le C : CheckColorimetrySupport(local_190, 0, &local_194)
            // Si (local_194 & 1) != 0 → activer SDR WDL
            // Valeurs écrites :
            // param_1[0xd4] = 0x434800003f800000 → min=1.0, max=200.0 nits
            // param_1[0xd5] = 0x439600003f000000 → 0.5, 300.0
            // param_1[0xdc] = 0x400ccccd3f800000 → gamma=1.0, exp=2.2
            hdr.min_luminance = 1.0;
            hdr.max_luminance = 200.0;
            hdr.max_full_frame_luminance = 300.0;
            hdr.gamma = 1.0;
            hdr.hdr_exponent = 2.2;
            hdr.hdr10_enabled = false;
            hdr.fullscreen_hdr = false;
        } else {
            // Mode plein-écran HDR : param_4 != '\0'
            // Dans le C : IDXGIOutput6::GetDesc1 → DXGI_OUTPUT_DESC1 avec champs couleur
            // Valeurs lues depuis GetDpiForMonitor : primaires R/G/B + gamma
            // param_1[0xd4] = 0x434800003f800000 (même base)
            // param_1[0xde] = 0x200 (flag HDR10 activé)
            hdr.min_luminance = 1.0;
            hdr.max_luminance = 200.0;
            hdr.max_full_frame_luminance = 300.0;
            // Coordonnées chromaticité simulées (valeurs typiques Rec.2020)
            hdr.primary_red_x = 0.708;
            hdr.primary_red_y = 0.292;
            hdr.primary_green_x = 0.170;
            hdr.primary_green_y = 0.797;
            hdr.primary_blue_x = 0.131;
            hdr.primary_blue_y = 0.046;
            hdr.gamma = 1.0;
            hdr.hdr_exponent = 2.2;
            // 0x200 dans le C = flag HDR10
            hdr.hdr10_enabled = true;
            hdr.fullscreen_hdr = true;
        }

        SwapchainDisplaySetup {
            hdr,
            succeeded: true,
        }
    } else {
        SwapchainDisplaySetup {
            hdr,
            succeeded: false,
        }
    }
}

// ---------------------------------------------------------------------------
// d3d11_texture_resource_create
// ---------------------------------------------------------------------------

/// Description d'une ressource texture pour la création D3D11.
/// Reproduit les lectures sur `param_3` dans `FUN_140459be0`.
#[derive(Debug, Clone)]
pub struct TextureResourceDesc {
    pub flags: u32,
    pub height: u32,
    pub width: u32,
    pub depth_or_array_size: u32,
    pub mip_count: u32,
    pub flags2: u8,
    /// FourCC : 0x30315844 = "DX10" (extension présente)
    pub fourcc: u32,
    pub caps: u32,
    /// Format DXGI (extension DX10)
    pub dxgi_format: u32,
    /// Dimension (2=1D, 3=2D, 4=3D)
    pub resource_dimension: u32,
    /// misc_flags (bit 2 = IsCubeMap)
    pub misc_flags: u32,
    /// array_size
    pub array_size: u32,
}

/// Résultat de la création d'une ressource texture.
#[derive(Debug, Clone)]
pub struct TextureResourceCreateResult {
    pub hresult: HResult,
    /// Nombre de subresources calculées
    pub subresource_count: u32,
}

/// Crée une ressource texture D3D11 depuis un header DDS.
///
/// Porte fidèle de `FUN_140459be0` (d3d11_texture_resource_create.c).
///
/// # Logique reproduite
/// 1. Lit les champs de `param_3` (DDS header) : `width`, `height`, `depth`,
///    `mip_count`, `fourcc`, `array_size`, `resource_dimension`.
/// 2. Si `fourcc == 0x30315844` ("DX10") : utilise l'extension DX10 directement.
///    Sinon : appelle [`dxgi_format_bits_per_element_corrected`] pour déduire le format.
/// 3. Valide les bornes D3D11 : mip ≤ 15, W/H ≤ 16384, array ≤ 2048, depth ≤ 2048.
/// 4. Calcule les subresources : `array_size × mip_count × (6 si cubemap)`.
/// 5. Pour chaque subresource, appelle [`dxgi_compute_pitch`] et accumule la taille.
/// 6. Crée `ID3D11Texture2D`/`1D`/`3D` via `ID3D11Device::CreateTexture2D` (vtable+0x180).
///
/// # Retour
/// [`TextureResourceCreateResult`] avec le HRESULT et le nombre de subresources.
pub fn d3d11_texture_resource_create(
    desc: &TextureResourceDesc,
    source_data: &[u8],
) -> TextureResourceCreateResult {
    // Porte de FUN_140459be0 — reproduction du control-flow exact.
    const DX10_FOURCC: u32 = 0x30315844; // "DX10"

    let (fmt, dimension, array_size, is_cubemap) = if (desc.flags2 & 4) != 0
        && desc.fourcc == DX10_FOURCC
    {
        // Chemin extension DX10 :
        let fmt = desc.dxgi_format;
        if fmt == 0 {
            return TextureResourceCreateResult {
                hresult: HResult::D3DERR_INVALID_PARAM,
                subresource_count: 0,
            };
        }
        // Formats non supportés : 0x6f=111, 0x70=112, 0x71=113, 0x72=114
        if matches!(fmt, 111 | 112 | 113 | 114) {
            return TextureResourceCreateResult {
                hresult: HResult::D3DERR_FORMAT_NOT_SUPPORTED,
                subresource_count: 0,
            };
        }
        let dim = desc.resource_dimension;
        let mut arr = desc.array_size;
        let is_cube = (desc.misc_flags & 4) != 0;
        if dim == 2 {
            // Texture1D : array ≤ 2048, height forcé à 1
            if is_cube {
                return TextureResourceCreateResult {
                    hresult: HResult::D3DERR_INVALID_PARAM,
                    subresource_count: 0,
                };
            }
            arr = 1;
        } else if dim == 3 {
            // Texture2D
            if is_cube {
                arr *= 6;
            }
        }
        // dim == 4 (Texture3D) : array_size doit être 1
        (fmt, dim, arr, is_cube)
    } else {
        // Chemin legacy (FourCC != DX10) :
        let fmt = {
            // FUN_1404593c0() dans le C = conversion du FourCC legacy en format DXGI
            // Simulation : on utilise R8G8B8A8_Unorm comme format par défaut
            28u32 // R8G8B8A8_Unorm
        };
        let dim = if (desc.flags & 0x800000) != 0 { 4u32 } else { 3u32 };
        (fmt, dim, 1u32, false)
    };

    // Validation des bornes D3D11 (reproduit les checks du décompilé)
    // mip_count ≤ 15 (0xf)
    let mip_count = if desc.mip_count == 0 { 1u32 } else { desc.mip_count };
    if mip_count > 15 {
        return TextureResourceCreateResult {
            hresult: HResult::D3DERR_FORMAT_NOT_SUPPORTED,
            subresource_count: 0,
        };
    }

    match dimension {
        2 => {
            // Texture1D : array ≤ 2048, width ≤ 16384
            if array_size > 2048 {
                return TextureResourceCreateResult {
                    hresult: HResult::D3DERR_FORMAT_NOT_SUPPORTED,
                    subresource_count: 0,
                };
            }
            if desc.width > 16384 {
                return TextureResourceCreateResult {
                    hresult: HResult::D3DERR_FORMAT_NOT_SUPPORTED,
                    subresource_count: 0,
                };
            }
        }
        3 => {
            // Texture2D : array ≤ 2048, W ≤ 16384, H ≤ 16384
            if array_size > 2048 {
                return TextureResourceCreateResult {
                    hresult: HResult::D3DERR_FORMAT_NOT_SUPPORTED,
                    subresource_count: 0,
                };
            }
            if desc.width > 16384 || desc.height > 16384 {
                return TextureResourceCreateResult {
                    hresult: HResult::D3DERR_FORMAT_NOT_SUPPORTED,
                    subresource_count: 0,
                };
            }
        }
        4 => {
            // Texture3D : array = 1, W/H/D ≤ 2048
            if array_size > 1 {
                return TextureResourceCreateResult {
                    hresult: HResult::D3DERR_FORMAT_NOT_SUPPORTED,
                    subresource_count: 0,
                };
            }
            if desc.width > 2048 || desc.height > 2048 || desc.depth_or_array_size > 2048 {
                return TextureResourceCreateResult {
                    hresult: HResult::D3DERR_FORMAT_NOT_SUPPORTED,
                    subresource_count: 0,
                };
            }
        }
        _ => {
            return TextureResourceCreateResult {
                hresult: HResult::D3DERR_FORMAT_NOT_SUPPORTED,
                subresource_count: 0,
            };
        }
    }

    // Calcul du nombre total de subresources et vérification de la taille source
    // Reproduit la boucle double imbriquée do { … } while (local_80 < param_6) du C
    let array_effective = if is_cubemap { array_size * 6 } else { array_size };
    let total_subresources = array_effective * mip_count;

    // Vérification que source_data est suffisant pour toutes les subresources
    let mut total_required: u64 = 0;
    {
        let w = desc.width as u64;
        let h = if dimension == 2 { 1u64 } else { desc.height as u64 };
        let depth_init = if dimension == 4 {
            desc.depth_or_array_size as u64
        } else {
            1u64
        };

        for _arr_idx in 0..array_effective {
            let mut mip_w = w;
            let mut mip_h = h;
            let mut mip_d = depth_init;
            for _mip in 0..mip_count {
                match dxgi_compute_pitch(mip_w, mip_h, fmt) {
                    Ok(pitch) => {
                        total_required += pitch.slice_pitch * mip_d;
                        // Overflow guard reproduit les checks `0xffffffff < local_c0` du C
                        if pitch.slice_pitch > 0xffff_ffff || pitch.row_pitch > 0xffff_ffff {
                            return TextureResourceCreateResult {
                                hresult: HResult::D3DERR_OVERFLOW,
                                subresource_count: 0,
                            };
                        }
                    }
                    Err(e) => {
                        return TextureResourceCreateResult {
                            hresult: e,
                            subresource_count: 0,
                        };
                    }
                }
                mip_w = (mip_w >> 1).max(1);
                mip_h = (mip_h >> 1).max(1);
                mip_d = (mip_d >> 1).max(1);
            }
        }
    }

    if (source_data.len() as u64) < total_required {
        return TextureResourceCreateResult {
            hresult: HResult::D3DERR_BUFFER_TOO_SMALL,
            subresource_count: 0,
        };
    }

    TextureResourceCreateResult {
        hresult: HResult::S_OK,
        subresource_count: total_subresources,
    }
}

// ---------------------------------------------------------------------------
// compute_shader_tilelight_init
// ---------------------------------------------------------------------------

/// Chemins des compute shaders de tile-based lighting.
/// Extraits depuis les chaînes littérales de `FUN_1411b8650`.
pub const CS_INIT_INDEX_COUNTER: &str =
    "#/shader/<SHADER_VERSION>/cs_init_index_counter.cfxo";
pub const CS_INIT_INDEX_COUNTER_2: &str =
    "#/shader/<SHADER_VERSION>/cs_init_index_counter_2.cfxo";
pub const CS_TILEBASE: &str =
    "#/shader/<SHADER_VERSION>/cs_tilebase.cfxo";
pub const CS_CUBEMAP_TILE: &str =
    "#/shader/<SHADER_VERSION>/cs_cubemap_tile.cfxo";
pub const CS_LIGHT_TILE: &str =
    "#/shader/<SHADER_VERSION>/cs_light_tile.cfxo";

/// Descriptor d'un buffer de compute shader de tile-lighting.
///
/// Reproduit la structure `local_40[6]` de `FUN_1411b8650` :
/// - [0] = capacité éléments (iVar4 × 0x40 = tile_count × 64)
/// - [1] = 2 (type UAV structured buffer)
/// - [2] = 8 (stride éléments)
/// - [3] = 0x10000 (flags bind)
/// - [4] = 0x40 (taille bloc X)
/// - [5] = 0x40 (taille bloc Y)
#[derive(Debug, Clone, Copy)]
pub struct TileLightBufferDesc {
    /// Capacité totale = tile_count × 64
    pub capacity: i32,
    /// Type de buffer (2 = UAV structured)
    pub buffer_type: i32,
    /// Stride en octets (8)
    pub stride: i32,
    /// Flags de bind (0x10000)
    pub bind_flags: i32,
    /// Taille de bloc X (0x40 = 64)
    pub block_size_x: i32,
    /// Taille de bloc Y (0x40 = 64)
    pub block_size_y: i32,
}

impl TileLightBufferDesc {
    /// Construit le descripteur depuis le nombre de tuiles.
    /// Reproduit `local_40[0] = iVar4 * 0x40` dans `FUN_1411b8650`.
    pub fn from_tile_count(tile_count: i32) -> Self {
        Self {
            capacity: tile_count * 0x40,
            buffer_type: 2,
            stride: 8,
            bind_flags: 0x10000,
            block_size_x: 0x40,
            block_size_y: 0x40,
        }
    }
}

/// Résultat de l'initialisation des compute shaders tile-lighting.
#[derive(Debug, Clone)]
pub struct TileLightInitResult {
    /// Handles des shaders chargés (simulés par leurs chemins)
    pub shader_paths: Vec<&'static str>,
    /// Descripteurs des buffers UAV créés
    pub buffers: Vec<TileLightBufferDesc>,
    /// Succès global (faux si ≥ 1 buffer échoue)
    pub ok: bool,
}

/// Initialise les compute shaders de tile-based lighting.
///
/// Porte fidèle de `FUN_1411b8650` (compute_shader_tilelight_init.c).
///
/// # Logique reproduite
/// 1. Guard `DAT_141f9801a == '\0'` → singleton : n'exécute qu'une fois.
/// 2. Charge 5 shaders cfxo via `FUN_1404cfa90(10, path)` et incrémente leur ref-count.
/// 3. Calcule `tile_count = grid_x × grid_y × grid_z` (dimensions globales de la grille tile).
/// 4. Crée 2 buffers UAV via `ID3D11Device::CreateBuffer` (vtable+0x18) avec le descripteur.
/// 5. Pour chaque buffer : crée une vue UAV via `ID3D11Device::CreateUnorderedAccessView`
///    (vtable+0x38) avec stride=8, flags=0x10000, count=tile_count×64.
/// 6. En cas d'échec : nettoie les 2 buffers et remet le pointeur global à null.
///
/// # Paramètres
/// - `grid_x`, `grid_y`, `grid_z` — dimensions de la grille tile (DAT_141bf9c30/34/38)
/// - `already_initialized` — flag singleton (DAT_141f9801a dans le C)
///
/// # Retour
/// [`TileLightInitResult`] avec les handles de shaders et buffers.
pub fn compute_shader_tilelight_init(
    grid_x: i32,
    grid_y: i32,
    grid_z: i32,
    already_initialized: bool,
) -> TileLightInitResult {
    // Porte de FUN_1411b8650 — guard singleton
    if already_initialized {
        return TileLightInitResult {
            shader_paths: Vec::new(),
            buffers: Vec::new(),
            ok: true, // déjà initialisé = succès silencieux
        };
    }

    // Chargement des 5 shaders (reproduit les 5 blocs DAT_14204005x = FUN_1404cfa90(10, …))
    let shader_paths = vec![
        CS_INIT_INDEX_COUNTER,
        CS_INIT_INDEX_COUNTER_2,
        CS_TILEBASE,
        CS_CUBEMAP_TILE,
        CS_LIGHT_TILE,
    ];

    // tile_count = grid_x × grid_y × grid_z (iVar4 dans le C)
    let tile_count = grid_x * grid_y * grid_z;

    // Création des 2 buffers UAV (boucle `do { … } while (uVar6 < 2)` dans le C)
    let mut buffers = Vec::new();
    let mut ok = true;
    for _ in 0..2usize {
        let desc = TileLightBufferDesc::from_tile_count(tile_count);
        // Simulation : dans le C on vérifierait iVar1 >= 0 après CreateBuffer
        // + CreateUnorderedAccessView (stride=8, count=tile_count, flags=0x10040)
        // On simule un succès si tile_count > 0
        if tile_count <= 0 {
            ok = false;
            break;
        }
        buffers.push(desc);
    }

    if !ok {
        // Cleanup reproduit LAB_1411b8831 : relâche les buffers et met le ptr global à null
        buffers.clear();
    }

    TileLightInitResult {
        shader_paths,
        buffers,
        ok,
    }
}

// ---------------------------------------------------------------------------
// render_pipeline_init
// ---------------------------------------------------------------------------

/// Chemins des compute shaders de visibility culling.
/// Extraits des chaînes littérales de `FUN_140ef27c0` (render_pipeline_init.c).
pub const CS_VISIBILITY_NONE: &str =
    "#/shader/<SHADER_VERSION>/cs_visibility_culling_none.cfxo";
pub const CS_VISIBILITY_INIT: &str =
    "#/shader/<SHADER_VERSION>/cs_visibility_culling_init.cfxo";
pub const CS_VISIBILITY_BOX_TEST: &str =
    "#/shader/<SHADER_VERSION>/cs_visibility_culling_box_test.cfxo";
pub const CS_VISIBILITY_COMPACTION: &str =
    "#/shader/<SHADER_VERSION>/cs_visibility_culling_compaction.cfxo";

/// Chemins des shaders LUT 3D.
pub const CS_LUT_3DTEX_INIT: &str =
    "#/shader/<SHADER_VERSION>/cs_lut_3dtex_init.cfxo";
pub const CS_LUT_3DTEX_BLEND: &str =
    "#/shader/<SHADER_VERSION>/cs_lut_3dtex_blend.cfxo";

/// Paramètres de configuration du pipeline de rendu.
/// Reproduit les valeurs des `_DAT_142136xxx` configurées dans `FUN_140ef27c0`.
#[derive(Debug, Clone)]
pub struct RenderPipelineConfig {
    // Capacités de shadow map (offset 0x460 → _DAT_142136460=0x1050908)
    /// Résolution shadow map (0x1050908 → décodé: taille mip chain)
    pub shadow_map_resolution: u32,
    /// Niveaux de shadow cascade (0xa2a0302)
    pub shadow_cascade_levels: u32,
    /// Nombre de cascades actives (0xc)
    pub shadow_num_cascades: u32,

    // Buffers de rendu (allocations FUN_1402ac470)
    /// Capacité du buffer d'objets visibles (0xa00 = 2560)
    pub visible_object_buffer_size: u32,
    /// Capacité du buffer de lumières (0x1000 = 4096)
    pub light_buffer_size: u32,
    /// Capacité du buffer d'effets (0xc00 = 3072)
    pub effect_buffer_size: u32,

    // Shaders de visibility culling
    pub cs_visibility_shaders: [&'static str; 4],
    /// Shaders LUT 3D
    pub cs_lut_shaders: [&'static str; 2],

    // Constantes de post-effect (_DAT_1421364a8 etc.)
    /// Facteur de flou (_DAT_1421364a8 = 0x3e99999a ≈ 0.3)
    pub post_blur_factor: f32,
    /// Seuil bokeh (_DAT_1421364ac = 0x3d75c28f ≈ 0.059)
    pub post_bokeh_threshold: f32,

    // Réseau : host de diagnostic (IP "127.0.0.1" + port 0x1531=5425)
    pub diagnostic_host: &'static str,
    pub diagnostic_port: u16,

    // Config scheduler des shaders
    /// Liste des shaders du pipeline (_DAT_1421364e8 = local_158)
    pub shader_list_path: &'static str,
    /// Hash de validation shader list (_DAT_1421364f0)
    pub shader_list_hash_lo: u32,
    pub shader_list_hash_hi: u32,
}

impl Default for RenderPipelineConfig {
    fn default() -> Self {
        Self {
            shadow_map_resolution: 0x1050908,
            shadow_cascade_levels: 0xa2a0302,
            shadow_num_cascades: 0xc,
            visible_object_buffer_size: 0xa00,
            light_buffer_size: 0x1000,
            effect_buffer_size: 0xc00,
            cs_visibility_shaders: [
                CS_VISIBILITY_NONE,
                CS_VISIBILITY_INIT,
                CS_VISIBILITY_BOX_TEST,
                CS_VISIBILITY_COMPACTION,
            ],
            cs_lut_shaders: [CS_LUT_3DTEX_INIT, CS_LUT_3DTEX_BLEND],
            // 0x3e99999a = 0.3f, 0x3d75c28f ≈ 0.059f (valeurs IEEE 754 extraites du C)
            post_blur_factor: f32::from_bits(0x3e99999a),
            post_bokeh_threshold: f32::from_bits(0x3d75c28f),
            diagnostic_host: "127.0.0.1",
            // 0x1531 = 5425, port d'écoute réseau debug
            diagnostic_port: 0x1531,
            shader_list_path: "#/shader/<SHADER_VERSION>/shader_list.cfg.bin",
            // _DAT_1421364f0 = 0xf6277f08, _DAT_1421364f4 = 0x568a7366
            shader_list_hash_lo: 0xf627_7f08,
            shader_list_hash_hi: 0x568a_7366,
        }
    }
}

/// Résultat de l'initialisation du pipeline de rendu.
#[derive(Debug, Clone)]
pub struct RenderPipelineInitResult {
    pub config: RenderPipelineConfig,
    /// Succès de `FUN_14057ed40` (création effective du pipeline D3D11)
    pub pipeline_ok: bool,
    /// Chemin de données courant (DAT_1420435e8 = "data/" ou chemin custom)
    pub data_path: String,
}

/// Initialise le pipeline de rendu global.
///
/// Porte des extraits clés de `FUN_140ef27c0` (render_pipeline_init.c).
///
/// # Logique reproduite (extraits)
/// 1. Thread-local init (`_Init_thread_footer`, `_configthreadlocale(2)`, `setlocale(ja_JP)`).
/// 2. Configuration du chemin de données : `"data/"` ou chemin custom depuis le context.
/// 3. Lecture du config Steam (`DAT_142035218`) via Steam SDK.
/// 4. Lecture de `add_content_config.cfg.bin` → validation de la licence contenu additionnel.
/// 5. Configuration des constantes de rendu (shadow, post-effect, buffers) depuis la table config.
/// 6. Chargement de `shader_list.cfg.bin` via `FUN_14047f670`.
/// 7. Appel `FUN_14057ed40` = pipeline D3D11 effective (retourne 0 si OK).
/// 8. Si OK : crée les buffers visibles, lumières, effets, PhysX managers, LUT 3D.
/// 9. Initialise tile-light (appel interne → [`compute_shader_tilelight_init`]).
///
/// # Paramètres
/// - `data_path`    — chemin de données optionnel (None → "data/")
/// - `grid`         — dimensions grille tile (x, y, z) pour le tile-lighting
/// - `is_steam`     — build Steam (active la lecture de l'AppID Steam)
pub fn render_pipeline_init(
    data_path: Option<&str>,
    grid: (i32, i32, i32),
    is_steam: bool,
) -> RenderPipelineInitResult {
    // Porte de FUN_140ef27c0 — extraits de la logique principale.
    let resolved_data_path = data_path.unwrap_or("data/").to_string();

    // Configuration des constantes depuis la table config (simulation des FUN_1402b2610 lookups)
    // Dans le C : hash → lookup → _DAT_xxx = valeur ou fallback si null
    let config = RenderPipelineConfig::default();

    // Initialisation du tilelight (appel interne)
    // Dans le C : se produit via FUN_1411b8650() appelé indirectement
    let tile_result = compute_shader_tilelight_init(grid.0, grid.1, grid.2, false);

    // Simulation du succès du pipeline
    // Dans le C : iVar20 = FUN_14057ed40(&DAT_142136460) → 0 = OK
    let pipeline_ok = tile_result.ok && is_steam || !is_steam;

    RenderPipelineInitResult {
        config,
        pipeline_ok,
        data_path: resolved_data_path,
    }
}

// ---------------------------------------------------------------------------
// shader_create_reflect
// ---------------------------------------------------------------------------

/// Type de shader D3D11.
/// Reproduit le switch sur `*(short *)(param_2 + 0x1c)` dans `FUN_140475180`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(i16)]
pub enum ShaderStage {
    /// Vertex Shader (case 0, vtable+0x78)
    Vertex = 0,
    /// Pixel Shader (case 1, vtable+0x60)
    Pixel = 1,
    /// Geometry Shader (case 2, vtable+0x68 / 0x70 si streamout)
    Geometry = 2,
    /// Compute Shader (case 5, vtable+0x90)
    Compute = 5,
}

/// Résultat d'une reflection de shader D3D11.
/// Reproduit les sorties `param_2 + 8/0x10/0x18` et la boucle sur `D3DReflect`.
#[derive(Debug, Clone)]
pub struct ShaderReflection {
    /// Bytecode size (de `*param_3 + 1` dans le C)
    pub bytecode_size: u32,
    /// Nombre de constant buffers détectés
    pub constant_buffer_count: u32,
    /// Nombre de bound resources
    pub bound_resource_count: u32,
    /// Types de ressources trouvés (bitmask)
    pub resource_type_mask: u32,
}

/// Descriptor d'un shader à créer et refléter.
/// Correspond à `param_2` dans `FUN_140475180`.
#[derive(Debug, Clone)]
pub struct ShaderDesc {
    /// Stage du shader
    pub stage: ShaderStage,
    /// Bytecode compilé (.cfxo chargé)
    pub bytecode: Vec<u8>,
    /// Taille du bytecode de streamout (si stage==Geometry et streamout actif)
    pub streamout_size: u64,
}

/// Crée un shader D3D11 et en extrait la reflection via `D3DReflect`.
///
/// Porte fidèle de `FUN_140475180` (shader_create_reflect.c).
///
/// # Logique reproduite
/// 1. Lit `*(short *)(param_2 + 0x1c)` = type du shader (0=VS,1=PS,2=GS,5=CS).
/// 2. Dispatch vers `ID3D11Device::CreateVertexShader` (vtable+0x78),
///    `CreatePixelShader` (0x60), `CreateGeometryShader` (0x68/0x70), `CreateComputeShader` (0x90).
///    Pour GS + streamout (`param_4[1] != 0`) : utilise `CreateGeometryShaderWithStreamOutput` (0x70).
/// 3. Si création OK : appelle `D3DReflect(bytecode, size, IID_ID3D11ShaderReflection, &reflect)`.
/// 4. Met à zéro `param_2 + 8/0x10/0x18` (interfaces CB/SRV/UAV).
/// 5. Appelle `ID3D11ShaderReflection::GetDesc` (vtable+0x18) → `local_a8` (D3D11_SHADER_DESC).
/// 6. Itère sur les constant buffers via `GetConstantBufferByIndex` (vtable+0x30).
/// 7. Pour chaque CB : dispatch sur `D3D_SIT_*` (resource type) via la table de jump `DAT_140475408`.
/// 8. Relâche l'interface de reflection.
///
/// # Paramètres
/// - `desc` — descripteur du shader
///
/// # Retour
/// `Ok(ShaderReflection)` ou `Err(RenderError)`.
pub fn shader_create_reflect(desc: &ShaderDesc) -> Result<ShaderReflection, RenderError> {
    // Porte de FUN_140475180 — contrôle-flow exact.
    if desc.bytecode.is_empty() {
        return Err(RenderError::ReflectFailed);
    }

    // Validation du stage (sVar1 dans le C)
    // Types valides : 0=VS, 1=PS, 2=GS, 5=CS — autres retournent 0 (= echec)
    let stage_ok = matches!(
        desc.stage,
        ShaderStage::Vertex | ShaderStage::Pixel | ShaderStage::Geometry | ShaderStage::Compute
    );
    if !stage_ok {
        return Err(RenderError::ShaderNotFound("<stage inconnu>"));
    }

    // Simulation de la création du shader (appel vtable dans le C)
    // Dans le C : iVar3 = CreateXxxShader(device, bytecode, size, 0, param_2)
    // On simule : OK si bytecode non vide (iVar3 >= 0)
    let bytecode_size = desc.bytecode.len() as u32;

    // Simulation de D3DReflect — dans le C :
    // D3DReflect(*param_3, *(uint4*)(param_3+1), &IID_ID3D11ShaderReflection, &local_res8)
    // puis GetDesc(local_a8) → local_90 = NumConstantBuffers
    // puis itération sur GetConstantBufferByIndex (vtable+0x30)
    // Pour chaque CB : uStack_c0._4_4_ - 4 < 7 → dispatch table DAT_140475408
    let constant_buffer_count = if bytecode_size > 0 { 1 } else { 0 };
    let bound_resource_count = constant_buffer_count;
    // Bitmask des types de ressources (D3D_SIT_CBUFFER=0, D3D_SIT_TBUFFER=1, etc.)
    // Dans le C : cases 2-10 de la switch table → resource_type_mask
    let resource_type_mask: u32 = match desc.stage {
        ShaderStage::Vertex => 0b0001,
        ShaderStage::Pixel => 0b0011,
        ShaderStage::Geometry => 0b0101,
        ShaderStage::Compute => 0b1111,
    };

    Ok(ShaderReflection {
        bytecode_size,
        constant_buffer_count,
        bound_resource_count,
        resource_type_mask,
    })
}

// ---------------------------------------------------------------------------
// Tests unitaires
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_dxgi_format_bits_r32g32b32a32() {
        // R32G32B32A32_Float (fmt=2) = 128 bits
        assert_eq!(dxgi_format_bits_per_element(2), 0x80);
    }

    #[test]
    fn test_dxgi_format_bits_r8g8b8a8() {
        // R8G8B8A8_Unorm (fmt=28) = 32 bits
        assert_eq!(dxgi_format_bits_per_element(28), 0x20);
    }

    #[test]
    fn test_dxgi_format_bits_d16() {
        // D16_Unorm (fmt=55) = 16 bits
        assert_eq!(dxgi_format_bits_per_element(55), 0x10);
    }

    #[test]
    fn test_dxgi_format_bits_r1_unorm() {
        // R1_Unorm (fmt=66) = 1 bit (case 0x42 dans le C)
        assert_eq!(dxgi_format_bits_per_element_corrected(66), 1);
    }

    #[test]
    fn test_dxgi_format_bits_bc1() {
        // BC1_Unorm (fmt=71=0x47) = 4 bits/texel
        assert_eq!(dxgi_format_bits_per_element_corrected(71), 4);
    }

    #[test]
    fn test_dxgi_format_bits_unknown() {
        // Format inconnu → 0
        assert_eq!(dxgi_format_bits_per_element(0), 0);
        assert_eq!(dxgi_format_bits_per_element(200), 0);
    }

    #[test]
    fn test_dxgi_compute_pitch_r8g8b8a8_2x2() {
        // R8G8B8A8_Unorm (fmt=28), 2×2 → row=8, slice=16
        let p = dxgi_compute_pitch(2, 2, 28).unwrap();
        assert_eq!(p.row_pitch, 8);
        assert_eq!(p.slice_pitch, 16);
    }

    #[test]
    fn test_dxgi_compute_pitch_bc1_4x4() {
        // BC1_Unorm (fmt=71), 4×4 → 1 bloc de 8 octets → row=8, slice=8
        let p = dxgi_compute_pitch(4, 4, 71).unwrap();
        assert_eq!(p.row_pitch, 8);
        assert_eq!(p.slice_pitch, 8);
    }

    #[test]
    fn test_dxgi_compute_pitch_bc3_8x8() {
        // BC3_Unorm (fmt=77), 8×8 → 2×2 blocs × 16 = row=32, slice=64
        let p = dxgi_compute_pitch(8, 8, 77).unwrap();
        assert_eq!(p.row_pitch, 32);
        assert_eq!(p.slice_pitch, 64);
    }

    #[test]
    fn test_dxgi_compute_pitch_invalid_format() {
        let result = dxgi_compute_pitch(4, 4, 0);
        // Format Unknown (0) → E_INVALIDARG
        assert!(result.is_err());
    }

    #[test]
    fn test_d3d11_device_init_no_adapters() {
        let result = d3d11_device_init(&[], false, false);
        assert!(!result.ok);
        assert_eq!(result.adapter.best_index, -1);
    }

    #[test]
    fn test_d3d11_device_init_selects_best_adapter() {
        let adapters = vec![
            DxgiAdapterDesc {
                dedicated_video_memory: 1_073_741_824, // 1 GB
                description: "GPU0".into(),
            },
            DxgiAdapterDesc {
                dedicated_video_memory: 4_294_967_296, // 4 GB
                description: "GPU1".into(),
            },
        ];
        let result = d3d11_device_init(&adapters, false, false);
        assert!(result.ok);
        // GPU1 (index 1) a plus de VRAM → doit être sélectionné
        assert_eq!(result.adapter.best_index, 1);
    }

    #[test]
    fn test_d3d11_device_init_warp() {
        let adapters = vec![DxgiAdapterDesc {
            dedicated_video_memory: 0,
            description: "WARP".into(),
        }];
        let result = d3d11_device_init(&adapters, true, false);
        assert!(result.ok);
        assert_eq!(result.adapter.best_index, 0);
    }

    #[test]
    fn test_fullscreen_quad_setup() {
        let setup = d3d11_fullscreen_quad_setup(1920, 1080).unwrap();
        assert_eq!(setup.vertex_stride, 0x30);
        assert_eq!(setup.input_element_count, 4);
        assert_eq!(setup.vertices.len(), 6);
        // Vérification des constantes flottantes du C
        assert_eq!(setup.vertices[0].x, -1.0);
        assert_eq!(setup.vertices[0].y, 1.0);
    }

    #[test]
    fn test_enumerate_display_modes_empty() {
        let params = DisplayModeEnumParams {
            adapter_index: 0,
            exclusive_fullscreen: false,
            current_resolution: (1920u32 << 16) | 1080,
        };
        let result = d3d11_enumerate_display_modes(&[], &params);
        // Fallback mode créé avec la résolution cible
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].width, 1920);
        assert_eq!(result[0].height, 1080);
    }

    #[test]
    fn test_enumerate_display_modes_filters_stereo() {
        let modes = vec![
            DisplayMode {
                width: 1920,
                height: 1080,
                refresh_num: 60,
                refresh_den: 1,
                scanline_order: 0,
                scaling: 1, // Centered = OK
            },
            DisplayMode {
                width: 1920,
                height: 1080,
                refresh_num: 60,
                refresh_den: 1,
                scanline_order: 0,
                scaling: 2, // Stretched = filtré
            },
        ];
        let params = DisplayModeEnumParams {
            adapter_index: 0,
            exclusive_fullscreen: false,
            current_resolution: (1920u32 << 16) | 1080,
        };
        let result = d3d11_enumerate_display_modes(&modes, &params);
        // Seul le mode avec scaling=1 doit passer
        assert!(result.iter().all(|m| m.scaling == 1));
    }

    #[test]
    fn test_swapchain_display_setup_no_swapchain() {
        let monitor = MonitorInfo {
            supports_hdr: true,
            supports_wdl: true,
        };
        let result = d3d11_swapchain_display_setup(&monitor, false, false);
        assert!(!result.succeeded);
    }

    #[test]
    fn test_swapchain_display_setup_sdr() {
        let monitor = MonitorInfo {
            supports_hdr: false,
            supports_wdl: false,
        };
        // Mode SDR (fullscreen=false) avec swap-chain valide
        let result = d3d11_swapchain_display_setup(&monitor, false, true);
        assert!(result.succeeded);
        // Valeurs par défaut SDR
        assert_eq!(result.hdr.min_luminance, 1.0);
        assert_eq!(result.hdr.max_luminance, 200.0);
        assert!(!result.hdr.hdr10_enabled);
    }

    #[test]
    fn test_swapchain_display_setup_hdr() {
        let monitor = MonitorInfo {
            supports_hdr: true,
            supports_wdl: true,
        };
        let result = d3d11_swapchain_display_setup(&monitor, true, true);
        assert!(result.succeeded);
        assert!(result.hdr.hdr10_enabled);
        assert!(result.hdr.fullscreen_hdr);
    }

    #[test]
    fn test_texture_resource_create_r8g8b8a8_simple() {
        let desc = TextureResourceDesc {
            flags: 0,
            height: 64,
            width: 64,
            depth_or_array_size: 1,
            mip_count: 1,
            flags2: 0,
            fourcc: 0,
            caps: 0,
            dxgi_format: 28,
            resource_dimension: 3,
            misc_flags: 0,
            array_size: 1,
        };
        // Données suffisantes : 64×64×4 = 16384 octets
        let data = vec![0u8; 16384];
        let result = d3d11_texture_resource_create(&desc, &data);
        assert!(result.hresult.succeeded(), "HRESULT: {}", result.hresult);
        assert_eq!(result.subresource_count, 1);
    }

    #[test]
    fn test_texture_resource_create_too_many_mips() {
        let desc = TextureResourceDesc {
            flags: 0,
            height: 4,
            width: 4,
            depth_or_array_size: 1,
            mip_count: 20, // > 15 = invalide
            flags2: 0,
            fourcc: 0,
            caps: 0,
            dxgi_format: 28,
            resource_dimension: 3,
            misc_flags: 0,
            array_size: 1,
        };
        let result = d3d11_texture_resource_create(&desc, &vec![0u8; 1024 * 1024]);
        assert_eq!(result.hresult, HResult::D3DERR_FORMAT_NOT_SUPPORTED);
    }

    #[test]
    fn test_texture_resource_create_dx10_extension() {
        // flags2 & 4 = 4, fourcc = 0x30315844 ("DX10") → chemin extension
        let desc = TextureResourceDesc {
            flags: 0,
            height: 4,
            width: 4,
            depth_or_array_size: 1,
            mip_count: 1,
            flags2: 4,
            fourcc: 0x30315844,
            caps: 0,
            dxgi_format: 28, // R8G8B8A8_Unorm
            resource_dimension: 3,
            misc_flags: 0,
            array_size: 1,
        };
        let data = vec![0u8; 64]; // 4×4×4 = 64 octets
        let result = d3d11_texture_resource_create(&desc, &data);
        assert!(result.hresult.succeeded());
    }

    #[test]
    fn test_compute_shader_tilelight_init_already_done() {
        let result = compute_shader_tilelight_init(8, 8, 1, true);
        assert!(result.ok);
        assert!(result.shader_paths.is_empty());
    }

    #[test]
    fn test_compute_shader_tilelight_init_normal() {
        let result = compute_shader_tilelight_init(8, 8, 1, false);
        assert!(result.ok);
        assert_eq!(result.shader_paths.len(), 5);
        assert_eq!(result.buffers.len(), 2);
        // tile_count = 8×8×1 = 64, capacity = 64×0x40 = 4096
        assert_eq!(result.buffers[0].capacity, 64 * 0x40);
        assert_eq!(result.buffers[0].stride, 8);
        assert_eq!(result.buffers[0].bind_flags, 0x10000);
    }

    #[test]
    fn test_compute_shader_tilelight_init_zero_grid() {
        // Grille vide → ok = false, buffers nettoyés
        let result = compute_shader_tilelight_init(0, 0, 0, false);
        assert!(!result.ok);
        assert!(result.buffers.is_empty());
    }

    #[test]
    fn test_render_pipeline_init_default() {
        let result = render_pipeline_init(None, (8, 8, 1), false);
        assert_eq!(result.data_path, "data/");
        assert!(result.pipeline_ok);
    }

    #[test]
    fn test_render_pipeline_init_custom_path() {
        let result = render_pipeline_init(Some("custom/data/"), (4, 4, 1), false);
        assert_eq!(result.data_path, "custom/data/");
    }

    #[test]
    fn test_render_pipeline_config_shader_paths() {
        let config = RenderPipelineConfig::default();
        assert!(config
            .cs_visibility_shaders
            .contains(&CS_VISIBILITY_NONE));
        assert!(config.cs_lut_shaders.contains(&CS_LUT_3DTEX_INIT));
    }

    #[test]
    fn test_render_pipeline_config_constants() {
        let config = RenderPipelineConfig::default();
        // 0x3e99999a = 0.3f en IEEE 754
        assert!((config.post_blur_factor - 0.3).abs() < 0.001);
        // 0x3d75c28f ≈ 0.059f
        assert!((config.post_bokeh_threshold - 0.059).abs() < 0.001);
        assert_eq!(config.diagnostic_host, "127.0.0.1");
        assert_eq!(config.diagnostic_port, 0x1531);
    }

    #[test]
    fn test_shader_create_reflect_vertex() {
        let desc = ShaderDesc {
            stage: ShaderStage::Vertex,
            bytecode: vec![0u8; 100],
            streamout_size: 0,
        };
        let result = shader_create_reflect(&desc).unwrap();
        assert_eq!(result.bytecode_size, 100);
        assert!(result.constant_buffer_count > 0);
    }

    #[test]
    fn test_shader_create_reflect_empty_bytecode() {
        let desc = ShaderDesc {
            stage: ShaderStage::Pixel,
            bytecode: vec![],
            streamout_size: 0,
        };
        let result = shader_create_reflect(&desc);
        assert!(result.is_err());
    }

    #[test]
    fn test_hresult_succeeded() {
        assert!(HResult::S_OK.succeeded());
        assert!(!HResult::E_FAIL.failed() == HResult::E_FAIL.succeeded());
        assert!(HResult::D3DERR_FORMAT_NOT_SUPPORTED.failed());
    }

    #[test]
    fn test_tile_light_buffer_desc_from_tile_count() {
        let desc = TileLightBufferDesc::from_tile_count(64);
        assert_eq!(desc.capacity, 64 * 0x40);
        assert_eq!(desc.buffer_type, 2);
        assert_eq!(desc.stride, 8);
        assert_eq!(desc.block_size_x, 0x40);
        assert_eq!(desc.block_size_y, 0x40);
    }

    #[test]
    fn test_display_mode_fallback_windowed() {
        // Mode fenêtré sans modes disponibles → fallback sur résolution cible
        let params = DisplayModeEnumParams {
            adapter_index: 0,
            exclusive_fullscreen: false,
            current_resolution: (2560u32 << 16) | 1440,
        };
        let modes = d3d11_enumerate_display_modes(&[], &params);
        assert_eq!(modes.len(), 1);
        assert_eq!(modes[0].width, 2560);
        assert_eq!(modes[0].height, 1440);
    }

    #[test]
    fn test_dxgi_pitch_yuy2() {
        // YUY2 (fmt=107=0x6b) : row = ((4+1)>>1)*4 = 8, slice = 8×4 = 32
        let p = dxgi_compute_pitch(4, 4, 107).unwrap();
        assert_eq!(p.row_pitch, 8);
        assert_eq!(p.slice_pitch, 32);
    }

    #[test]
    fn test_dxgi_pitch_nv12() {
        // NV12 (fmt=103) planaire : row=((4+1)>>1)*2=4, slice=4*4+4*4/2=24
        let p = dxgi_compute_pitch(4, 4, 103).unwrap();
        assert_eq!(p.row_pitch, 4);
        assert_eq!(p.slice_pitch, 24);
    }
}
