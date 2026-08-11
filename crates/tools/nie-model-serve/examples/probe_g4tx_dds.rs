//! Sonde le header DDS réel d'un `.g4tx` du VFS : magic, flags, `ddspf` (FourCC vs masks),
//! présence de l'extension DX10. Sert à diagnostiquer les textures « non servies » (le
//! décodeur de `nie-model-serve` suppose un header DX10 ; un DDS legacy/uncompressed casse).
//!
//! Usage : `NIE_GAME_DIR=/home/aphrody/niers cargo run -p nie-model-serve --example probe_g4tx_dds -- <vfs-path>`

use image_dds::{ImageFormat, Surface};
use nie_formats::g4tx::parse as parse_g4tx;
use nie_formats::vfs::Vfs;
use std::path::Path;

/// Réplique minimale de la résolution de format du serveur (DX10 @148 / legacy @128).
fn resolve(dds: &[u8]) -> Option<(ImageFormat, usize)> {
    let pf_flags = u32::from_le_bytes(dds[80..84].try_into().ok()?);
    let fourcc: [u8; 4] = dds[84..88].try_into().ok()?;
    if pf_flags & 0x4 != 0 {
        if &fourcc == b"DX10" {
            let dxgi = u32::from_le_bytes(dds[128..132].try_into().ok()?);
            let f = match dxgi {
                71 => ImageFormat::BC1RgbaUnorm,
                98 => ImageFormat::BC7RgbaUnorm,
                99 => ImageFormat::BC7RgbaUnormSrgb,
                _ => return None,
            };
            return Some((f, 148));
        }
        let f = match &fourcc {
            b"DXT1" => ImageFormat::BC1RgbaUnorm,
            b"DXT4" | b"DXT5" => ImageFormat::BC3RgbaUnorm,
            _ => return None,
        };
        return Some((f, 128));
    }
    None
}

fn main() {
    let arg = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "data/dx11/chr/_face/20_EDIT/_base/base_normal_00.g4tx".to_string());
    let dir = nie_formats::vfs::resolve_game_dir().to_string_lossy().into_owned();
    let mut vfs = Vfs::new();
    vfs.init(Path::new(&dir).join("data").as_path())
        .expect("vfs init");
    let bytes = vfs
        .read(&arg)
        .unwrap_or_else(|_| panic!("{arg} absent du VFS"));
    println!("fichier = {arg} ({} o)", bytes.len());

    let g4tx = parse_g4tx(&bytes).expect("parse g4tx");

    // Décode réellement la plus grande texture DDS (le chemin que `decode_best` emprunte).
    if let Some(best) = g4tx
        .textures
        .iter()
        .filter(|t| t.is_dds)
        .max_by_key(|t| (t.width as u64) * (t.height as u64))
    {
        let dds = &bytes[best.data_offset..];
        match resolve(dds) {
            Some((fmt, px)) => {
                let surface = Surface {
                    width: best.width as u32,
                    height: best.height as u32,
                    depth: 1,
                    layers: 1,
                    mipmaps: 1,
                    image_format: fmt,
                    data: &dds[px..],
                };
                match surface.decode_rgba8() {
                    Ok(s) => println!(
                        ">>> DÉCODE OK : best {}x{} fmt={fmt:?} → {} octets RGBA",
                        best.width,
                        best.height,
                        s.data.len()
                    ),
                    Err(e) => println!(">>> DÉCODE ÉCHEC image_dds : {e}"),
                }
            }
            None => println!(">>> format best non résolu (toujours non servi)"),
        }
    }

    for (i, t) in g4tx.textures.iter().enumerate() {
        println!(
            "tex[{i}] is_dds={} {}x{} data_offset={}",
            t.is_dds, t.width, t.height, t.data_offset
        );
        if !t.is_dds {
            continue;
        }
        let off = t.data_offset;
        let s = &bytes[off..];
        let magic = u32::from_le_bytes(s[0..4].try_into().unwrap());
        let dw_flags = u32::from_le_bytes(s[8..12].try_into().unwrap());
        // DDS_PIXELFORMAT commence à l'offset 4 + 72 = 76 (dwSize), ddspf.flags à 80, FourCC à 84.
        let pf_flags = u32::from_le_bytes(s[80..84].try_into().unwrap());
        let fourcc = &s[84..88];
        let rgb_bitcount = u32::from_le_bytes(s[88..92].try_into().unwrap());
        let r_mask = u32::from_le_bytes(s[92..96].try_into().unwrap());
        let g_mask = u32::from_le_bytes(s[96..100].try_into().unwrap());
        let b_mask = u32::from_le_bytes(s[100..104].try_into().unwrap());
        let a_mask = u32::from_le_bytes(s[104..108].try_into().unwrap());
        let is_dx10 = fourcc == b"DX10";
        println!(
            "  magic={magic:#010x} dwFlags={dw_flags:#010x} ddspf.flags={pf_flags:#010x} \
             fourCC={:?} ({}) bitcount={rgb_bitcount}",
            String::from_utf8_lossy(fourcc),
            if is_dx10 {
                "DX10 ext"
            } else {
                "legacy/uncompressed"
            }
        );
        println!("  masks R={r_mask:#010x} G={g_mask:#010x} B={b_mask:#010x} A={a_mask:#010x}");
        if is_dx10 {
            let dxgi = u32::from_le_bytes(s[128..132].try_into().unwrap());
            println!("  DX10.dxgiFormat = {dxgi}");
        }
    }
}
