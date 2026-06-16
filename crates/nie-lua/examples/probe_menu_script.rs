//! Probe jetable (D1.c) : trouve le(s) script(s) `.lua.bin` d'un écran de menu, l'exécute dans
//! la vraie VM Lua 5.2 (install_menu_host + install_include) et dump le MenuState résultant
//! (layers, objets visibles/sprite/texte/nombre, cmdIds inconnus). Sert à découvrir le layerId
//! et la sémantique avant de brancher le renderer.
//!
//! Usage : `cargo run -p nie-lua --example probe_menu_script -- title02`
use std::collections::HashMap;
use std::path::Path;
use std::rc::Rc;

use nie_lua::{install_include, install_menu_host, new_vm, run_menu};

fn main() {
    let needle = std::env::args().nth(1).unwrap_or_else(|| "title02".into());
    let dir = "/mnt/c/Program Files (x86)/Steam/steamapps/common/INAZUMA ELEVEN Victory Road";
    let mut vfs = nie_formats::vfs::Vfs::new();
    vfs.init(Path::new(dir).join("data").as_path()).expect("vfs init");

    // Index basename → chemin (pour INCLUDE).
    let mut by_base: HashMap<String, String> = HashMap::new();
    for (p, _) in vfs.iter() {
        if let Some(b) = p.rsplit('/').next().filter(|b| b.ends_with(".lua.bin")) {
            by_base.entry(b.to_ascii_lowercase()).or_insert_with(|| p.to_string());
        }
    }

    // Scripts de menu correspondant au besoin.
    let mut scripts: Vec<String> = vfs
        .iter()
        .map(|(p, _)| p.to_string())
        .filter(|p| {
            p.starts_with("data/common/script/lua/menu/")
                && p.ends_with(".lua.bin")
                && p.to_ascii_lowercase().contains(&needle.to_ascii_lowercase())
        })
        .collect();
    scripts.sort();
    println!("scripts contenant '{needle}': {}", scripts.len());
    for s in &scripts {
        println!("  {}", s.rsplit('/').next().unwrap());
    }

    let vfs = Rc::new(vfs);
    let by_base = Rc::new(by_base);

    // ── Pass DRIVER : tente d'émuler la boucle de construction du moteur ──────────
    // (OnInit → GetItemButtonNum → SetupItemButton[i] → Step), tolérant aux erreurs,
    // pour découvrir quels funcLuaMenuCommand sont émis. Cf. DESIGN.md §13.
    if let Some(path) = scripts.first() {
        let bytes = vfs.read(path).unwrap();
        let name = path.rsplit('/').next().unwrap();
        let lua = new_vm();
        {
            let (vfs, by_base) = (Rc::clone(&vfs), Rc::clone(&by_base));
            install_include(&lua, move |n| {
                let c = format!("{}.lua.bin", n.to_ascii_lowercase());
                by_base.get(&c).or_else(|| by_base.get(&n.to_ascii_lowercase()))
                    .and_then(|p| vfs.read(p).ok())
            }).unwrap();
        }
        let state = install_menu_host(&lua).unwrap();
        let func = nie_lua::load_bytecode(&lua, &bytes, name).unwrap();
        let _ = func.call::<()>(());

        let call0 = |fname: &str| -> String {
            match lua.globals().get::<mlua::Function>(fname) {
                Ok(f) => match f.call::<mlua::Variadic<mlua::Value>>(()) {
                    Ok(v) => format!("ok({})", v.iter().map(|x| format!("{x:?}")).collect::<Vec<_>>().join(",")),
                    Err(e) => format!("ERR({})", e.to_string().lines().next().unwrap_or("")),
                },
                Err(_) => "absent".into(),
            }
        };
        let call1 = |fname: &str, a: i64| -> String {
            match lua.globals().get::<mlua::Function>(fname) {
                Ok(f) => match f.call::<mlua::Variadic<mlua::Value>>(a as f64) {
                    Ok(v) => format!("ok({})", v.iter().map(|x| format!("{x:?}")).collect::<Vec<_>>().join(",")),
                    Err(e) => format!("ERR({})", e.to_string().lines().next().unwrap_or("")),
                },
                Err(_) => "absent".into(),
            }
        };
        println!("\n########## DRIVER PROBE [{name}] ##########");
        // Séquence CONFIRMÉE par RE (manager 0x14109D190) : set __menuObjPtr, OnInit() (0 arg),
        // puis OnSetupLayer(layerId) par layer (c'est là que les objets sont créés).
        let _ = lua.globals().set("__menuObjPtr", 1.0_f64);
        println!("  OnInit() -> {}", call0("OnInit"));
        // Test de l'hypothèse "n'importe quel id stable suffit" : OnSetupLayer(id) pour des
        // candidats (0, puis l'id de couche réel s'il existe).
        for id in [0_i64, 1, 0x1176_F7AB, 0xE6EC_6AA3] {
            let before = state.borrow().layers.values().map(|l| l.objects.len()).sum::<usize>();
            let r = call1("OnSetupLayer", id);
            let after = state.borrow().layers.values().map(|l| l.objects.len()).sum::<usize>();
            println!("  OnSetupLayer(0x{id:08X}) -> {r}  (objets {before} -> {after})");
        }
        let st = state.borrow();
        let nobj: usize = st.layers.values().map(|l| l.objects.len()).sum();
        println!("  => OnInit MenuState: layers={} objects={} known={} unknown={}",
            st.layers.len(), nobj, st.known_cmd_log.len(), st.unknown_cmd_log.len());
        for (lid, layer) in &st.layers {
            println!("    layer 0x{lid:08X} vis={} obj={}", layer.visible, layer.objects.len());
            for (oid, o) in &layer.objects {
                println!("      obj 0x{oid:08X} vis={} sprite={:?} text={:?}", o.visible, o.sprite_texture_hash, o.text);
            }
        }

        // JOIN CHECK : crc32(objbin object name) vs hashes (layer+object) du MenuState.
        let mut hashes = std::collections::HashSet::new();
        for (lid, layer) in &st.layers {
            hashes.insert(*lid);
            for oid in layer.objects.keys() { hashes.insert(*oid); }
        }
        let mut names: Vec<(String, u32)> = vfs
            .iter()
            .map(|(p, _)| p.to_string())
            .filter(|p| p.contains("/menu/obj/") && p.ends_with(".objbin")
                && p.rsplit('/').next().is_some_and(|b| b.starts_with("title02")))
            .filter_map(|p| vfs.read(&p).ok().and_then(|b| nie_formats::objbin::parse(&b).ok()))
            .map(|o| { let h = nie_formats::cfgbin::crc32(o.name.as_bytes()); (o.name, h) })
            .collect();
        names.sort();
        let matched: Vec<&(String, u32)> = names.iter().filter(|(_, h)| hashes.contains(h)).collect();
        println!("  JOIN: {} hashes MenuState, {} objbin title02 ; crc32(name) match = {}",
            hashes.len(), names.len(), matched.len());
        for (n, h) in matched.iter().take(10) { println!("    MATCH 0x{h:08X} = {n}"); }

        // ARG LAYOUT brut : 1 ex. par cmdId émis (vérité terrain pour porter le dispatch).
        let mut seen = std::collections::HashSet::new();
        println!("  -- arg layout funcLuaMenuCommand(cmdId, layerId, rest...) --");
        for (c, l, repr) in &st.unknown_cmd_log {
            if seen.insert(*c) {
                println!("    0x{c:08X}(layer=0x{l:08X}, rest=[{repr}])");
            }
        }
    }

    for path in scripts.iter().take(6) {
        let Ok(bytes) = vfs.read(path) else { continue };
        let name = path.rsplit('/').next().unwrap();
        // Essaie plusieurs layerId candidats : 0 (= tous), puis le crc du nom de l'écran.
        for &layer_id in &[0u32, nie_formats::cfgbin::crc32(needle.as_bytes())] {
            let lua = new_vm();
            {
                let (vfs, by_base) = (Rc::clone(&vfs), Rc::clone(&by_base));
                install_include(&lua, move |n| {
                    let c = format!("{}.lua.bin", n.to_ascii_lowercase());
                    by_base.get(&c).or_else(|| by_base.get(&n.to_ascii_lowercase()))
                        .and_then(|p| vfs.read(p).ok())
                }).unwrap();
            }
            let state = install_menu_host(&lua).unwrap();
            let r = run_menu(&lua, &bytes, path, layer_id);
            // Dump des callbacks définis par le script (pour comprendre le driver de menu).
            if layer_id == 0 {
                let mut fns: Vec<String> = Vec::new();
                for pair in lua.globals().pairs::<mlua::Value, mlua::Value>().flatten() {
                    if let (mlua::Value::String(k), mlua::Value::Function(_)) = pair {
                        fns.push(k.to_string_lossy().to_string());
                    }
                }
                fns.sort();
                println!("[{name}] globals fn définies par le script (hors host): {fns:?}");
            }
            let st = state.borrow();
            let nobj: usize = st.layers.values().map(|l| l.objects.len()).sum();
            println!(
                "\n[{name}] layer_id=0x{layer_id:08X} OnOpenLayer={r:?} layers={} objects={nobj} known={} unknown={}",
                st.layers.len(), st.known_cmd_log.len(), st.unknown_cmd_log.len()
            );
            for (lid, layer) in &st.layers {
                println!("  layer 0x{lid:08X}: vis={} obj={}", layer.visible, layer.objects.len());
                for (oid, o) in layer.objects.iter().take(12) {
                    println!("    obj 0x{oid:08X} vis={} sprite={:?} text={:?} num={:?}",
                        o.visible, o.sprite_texture_hash, o.text, o.number);
                }
            }
            let mut uniq = std::collections::BTreeMap::new();
            for (c, _, _) in &st.unknown_cmd_log { *uniq.entry(*c).or_insert(0usize) += 1; }
            if !uniq.is_empty() {
                println!("  cmdIds inconnus: {:?}", uniq.iter().map(|(c,n)| format!("0x{c:08X}×{n}")).collect::<Vec<_>>());
            }
            if nobj > 0 { break; } // ce layerId peuple → suffisant
        }
    }
}
