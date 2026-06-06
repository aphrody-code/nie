//! Diagnostic des transforms G4PKM pour plusieurs objets de 100_mainmenu.

fn main() -> anyhow::Result<()> {
    let game_data = std::path::PathBuf::from("/home/ubuntu/.local/share/Steam/iecode/inazuma/data");
    
    let mut vfs = nie_formats::vfs::Vfs::new();
    vfs.init(&game_data)?;
    
    // Tester plusieurs G4PKM pour comprendre le pattern
    let test_cases = [
        // (g4pkm_path, sprite_w, sprite_h, nom)
        ("data/common/menu/100_mainmenu/mainmenu90/mainmenu90_23/mainmenu90_23.g4pkm", 728.0f64, 140.0f64, "mainmenu90_23 (liste item)"),
        ("data/common/menu/100_mainmenu/mainmenu04/mainmenu04_00_3/mainmenu04_00_3.g4pkm", 2640.0f64, 560.0f64, "mainmenu04_00_3 (background)"),
        ("data/common/menu/100_mainmenu/mainmenu04/mainmenu04_00_2/mainmenu04_00_2.g4pkm", 300.0f64, 92.0f64, "mainmenu04_00_2 (status_base)"),
        ("data/common/menu/100_mainmenu/mainmenu90/mainmenu90_01/mainmenu90_01.g4pkm", 0.0, 0.0, "mainmenu90_01 (header, W=776 H=120)"),
    ];
    
    for (g4pkm_path, sprite_w, sprite_h, label) in &test_cases {
        println!("\n=== {label} ===");
        println!("g4pkm={g4pkm_path}");
        
        let bytes = match vfs.read(g4pkm_path) {
            Ok(b) => b,
            Err(e) => { println!("ERREUR: {e}"); continue; }
        };
        
        let g4pk = nie_formats::g4pk::parse(&bytes)?;
        
        let g4sk_data: Option<&[u8]> = g4pk.files.iter().find_map(|f| {
            let data = bytes.get(f.offset..f.offset + f.size)?;
            if data.starts_with(b"G4SK") { Some(data) } else { None }
        });
        
        let Some(g4sk) = g4sk_data else {
            println!("no_g4sk");
            continue;
        };
        
        let header = nie_formats::g4sk::parse_header(g4sk)?;
        let bones = nie_formats::g4sk::parse_hierarchy(g4sk, &header);
        let n = header.bone_count as usize;
        
        const STRIDE: usize = 48;
        let base = 0x40usize;
        
        for i in 0..n {
            let off = base + i * STRIDE;
            if off + STRIDE > g4sk.len() { break; }
            
            let r00 = f32::from_le_bytes(g4sk[off+0..off+4].try_into().unwrap());
            let r01 = f32::from_le_bytes(g4sk[off+4..off+8].try_into().unwrap());
            let tx  = f32::from_le_bytes(g4sk[off+12..off+16].try_into().unwrap());
            let r10 = f32::from_le_bytes(g4sk[off+16..off+20].try_into().unwrap());
            let r11 = f32::from_le_bytes(g4sk[off+20..off+24].try_into().unwrap());
            let ty  = f32::from_le_bytes(g4sk[off+28..off+32].try_into().unwrap());
            
            let sx = (r00*r00 + r10*r10).sqrt();
            let sy = (r01*r01 + r11*r11).sqrt();
            
            let bone_name = bones.bones.get(i).map(|b| b.name.as_str()).unwrap_or("?");
            let parent = bones.bones.get(i).map(|b| b.parent_index).unwrap_or(-1);
            
            // Formule actuelle MenuLayoutExporter
            let scale_x_json = if *sprite_w > 0.0 { (sx as f64) * (1280.0/1920.0) / sprite_w } else { 0.0 };
            let rendered = if *sprite_w > 0.0 { sprite_w * scale_x_json } else { 0.0 };
            
            if i == 0 || sx > 1.0 || sx.abs() < 0.01 {
                println!("  bone[{i:2}] p={parent:2} '{bone_name}': tx={tx:.1} ty={ty:.1} sx={sx:.4} sy={sy:.4} -> scale_json={scale_x_json:.6} rendered={rendered:.1}px");
            }
        }
    }
    
    Ok(())
}
