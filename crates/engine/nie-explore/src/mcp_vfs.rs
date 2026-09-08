//! Host-neutral VFS query DTOs used by transport bindings.

use base64::Engine as _;
use globset::Glob;
use nie_formats::vfs::Vfs;
use serde_json::{Value, json};

fn safe_path(path: &str) -> anyhow::Result<&str> {
    let path = path.trim();
    anyhow::ensure!(
        !path.is_empty()
            && !path.starts_with('/')
            && !path.contains('\\')
            && !path.chars().any(char::is_control)
            && !path.split('/').any(|part| part == ".."),
        "invalid VFS path"
    );
    Ok(path)
}

fn extension(path: &str) -> &str {
    let basename = path.rsplit('/').next().unwrap_or(path);
    for ext in [".cfg.bin", ".objbin", ".fxbin", ".mevbin"] {
        if basename.to_ascii_lowercase().ends_with(ext) {
            return ext;
        }
    }
    basename.rfind('.').map_or("", |index| &basename[index..])
}

fn decode_kind(path: &str) -> &'static str {
    let lower = path.to_ascii_lowercase();
    if lower.ends_with(".g4tx") {
        "tex"
    } else if [".hca", ".adx", ".acb", ".awb"]
        .iter()
        .any(|ext| lower.ends_with(ext))
    {
        "audio"
    } else if [".cfg.bin", ".objbin", ".mevbin"]
        .iter()
        .any(|ext| lower.ends_with(ext))
    {
        "cfg"
    } else {
        "raw"
    }
}

pub fn list(vfs: &Vfs, prefix: &str, limit: usize) -> Value {
    let prefix = prefix.trim_matches('/');
    let mut directories = std::collections::BTreeSet::new();
    let mut files = Vec::new();
    let mut file_count = 0usize;
    for (path, entry) in vfs.iter() {
        let rest = if prefix.is_empty() {
            path
        } else if let Some(rest) = path
            .strip_prefix(prefix)
            .and_then(|rest| rest.strip_prefix('/'))
        {
            rest
        } else {
            continue;
        };
        if let Some((directory, _)) = rest.split_once('/') {
            directories.insert(directory.to_owned());
        } else {
            file_count += 1;
            if files.len() < limit {
                files.push(json!({"name":rest,"path":path,"cpk":entry.cpk_filename,"size":entry.file_size}));
            }
        }
    }
    let directory_count = directories.len();
    let visible = directories.into_iter().take(limit).collect::<Vec<_>>();
    let remaining = limit.saturating_sub(visible.len());
    files.truncate(remaining);
    let truncated = directory_count > visible.len() || file_count > files.len();
    json!({"prefix":if prefix.is_empty(){"(root)".to_owned()}else{format!("{prefix}/")},"directories":visible,"files":files,"total_directories":directory_count,"total_files":file_count,"truncated":truncated})
}

pub fn search(vfs: &Vfs, query: &str, limit: usize) -> anyhow::Result<Value> {
    let query = query.trim();
    anyhow::ensure!(
        !query.is_empty() && query.len() <= 16 * 1024,
        "invalid query"
    );
    let glob = query
        .chars()
        .any(|c| matches!(c, '*' | '?' | '[' | ']' | '{' | '}'));
    let matcher = glob
        .then(|| Glob::new(query).map(|g| g.compile_matcher()))
        .transpose()?;
    let folded = query.to_ascii_lowercase();
    let mut total = 0;
    let mut matches = Vec::new();
    for (path, entry) in vfs.iter() {
        if !matcher.as_ref().map_or_else(
            || path.to_ascii_lowercase().contains(&folded),
            |m| m.is_match(path),
        ) {
            continue;
        }
        total += 1;
        if matches.len() < limit {
            matches.push(json!({"name":path.rsplit('/').next(),"path":path,"cpk":entry.cpk_filename,"size":entry.file_size}));
        }
    }
    Ok(
        json!({"query":query,"mode":if glob{"glob"}else{"substring"},"total_matches":total,"matches":matches,"truncated":total>matches.len()}),
    )
}

pub fn stat(vfs: &Vfs, path: &str) -> anyhow::Result<Value> {
    let path = safe_path(path)?;
    if let Some(e) = vfs.find(path) {
        let d = decode_kind(path);
        return Ok(
            json!({"kind":"file","path":path,"cpk":e.cpk_filename,"ext":extension(path),"decode":d,"decodable":d!="raw","size":e.file_size,"readable":vfs.is_readable(path)}),
        );
    }
    let prefix = format!("{}/", path.trim_end_matches('/'));
    let children = vfs.iter().filter(|(p, _)| p.starts_with(&prefix)).count();
    Ok(if children > 0 {
        json!({"kind":"directory","path":path,"child_count":children})
    } else {
        json!({"kind":"missing","path":path})
    })
}

pub fn cat(vfs: &Vfs, path: &str, cap: usize) -> anyhow::Result<Value> {
    let path = safe_path(path)?;
    let e = vfs
        .find(path)
        .ok_or_else(|| anyhow::anyhow!("path not found in VFS"))?;
    let data = vfs
        .read(path)
        .map_err(|e| anyhow::anyhow!("VFS read failed: {e}"))?;
    let truncated = data.len() > cap;
    let slice = &data[..data.len().min(cap)];
    let mut value =
        json!({"path":path,"cpk":e.cpk_filename,"size":data.len(),"truncated":truncated});
    let textual = ["txt", "json", "lua", "xml"]
        .iter()
        .any(|x| extension(path).contains(x));
    if textual && let Ok(text) = std::str::from_utf8(slice) {
        value["text"] = Value::String(text.to_owned())
    } else {
        value["base64"] = Value::String(base64::engine::general_purpose::STANDARD.encode(slice))
    }
    Ok(value)
}

pub fn asset(vfs: &Vfs, path: &str, decode: &str, cap: usize) -> anyhow::Result<Value> {
    let path = safe_path(path)?;
    let source = vfs
        .read(path)
        .map_err(|e| anyhow::anyhow!("VFS read failed: {e}"))?;
    let (bytes, content_type) = match decode {
        "raw" => (source, "application/octet-stream"),
        "cfg" => (
            nie_formats::decode::decode(&source)
                .ok_or_else(|| anyhow::anyhow!("format is not decodable as JSON"))?
                .json,
            "application/json",
        ),
        "tex" => (
            nie_formats::g4tx_decode::decode_best_to_png(
                &source,
                nie_formats::g4tx_decode::basename_of(path),
            )
            .ok_or_else(|| anyhow::anyhow!("texture could not be decoded"))?,
            "image/png",
        ),
        "audio" => (
            nie_formats::cri_audio::decode_to_wav(&source).map_err(anyhow::Error::msg)?,
            "audio/wav",
        ),
        other => anyhow::bail!("unknown decode mode: {other}"),
    };
    let truncated = bytes.len() > cap;
    let slice = &bytes[..bytes.len().min(cap)];
    let mut value = json!({"path":path,"decode":decode,"source":"rust-native","url":format!("nie://{path}"),"http_status":200,"content_type":content_type,"content_length":bytes.len(),"truncated":truncated});
    if content_type == "application/json" {
        value["text"] = Value::String(String::from_utf8_lossy(slice).into_owned())
    } else if !truncated {
        value["base64"] = Value::String(base64::engine::general_purpose::STANDARD.encode(slice))
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (std::path::PathBuf, Vfs) {
        let root = std::env::temp_dir().join(format!(
            "nie-mcp-vfs-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(root.join("alpha/sub")).unwrap();
        std::fs::create_dir_all(root.join("beta")).unwrap();
        std::fs::write(root.join("alpha/readme.txt"), b"hello world").unwrap();
        std::fs::write(root.join("alpha/blob.bin"), [0xff, 0x00, 0x01]).unwrap();
        std::fs::write(root.join("alpha/sub/item.json"), b"{}").unwrap();
        let mut vfs = Vfs::new();
        vfs.init_loose(&root).unwrap();
        (root, vfs)
    }
    #[test]
    fn rejects_parent_paths() {
        assert!(safe_path("a/../b").is_err())
    }
    #[test]
    fn classifies_compound_extensions() {
        assert_eq!(decode_kind("x.cfg.bin"), "cfg");
        assert_eq!(extension("x.cfg.bin"), ".cfg.bin")
    }
    #[test]
    fn list_and_search_are_bounded_and_deterministic() {
        let (root, vfs) = fixture();
        let listed = list(&vfs, "data/alpha", 1);
        assert_eq!(listed["directories"], json!(["sub"]));
        assert_eq!(listed["files"], json!([]));
        assert_eq!(listed["total_files"], 2);
        assert_eq!(listed["truncated"], true);
        let found = search(&vfs, "*.txt", 1).unwrap();
        assert_eq!(found["mode"], "glob");
        assert_eq!(found["total_matches"], 1);
        assert_eq!(found["matches"][0]["path"], "data/alpha/readme.txt");
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn stat_cat_and_asset_preserve_text_base64_and_decode_errors() {
        let (root, vfs) = fixture();
        assert_eq!(stat(&vfs, "data/alpha/readme.txt").unwrap()["kind"], "file");
        assert_eq!(stat(&vfs, "data/alpha").unwrap()["child_count"], 3);
        let text = cat(&vfs, "data/alpha/readme.txt", 5).unwrap();
        assert_eq!(text["text"], "hello");
        assert_eq!(text["truncated"], true);
        let binary = cat(&vfs, "data/alpha/blob.bin", 2).unwrap();
        assert_eq!(binary["base64"], "/wA=");
        let raw = asset(&vfs, "data/alpha/blob.bin", "raw", 8).unwrap();
        assert_eq!(raw["base64"], "/wAB");
        assert!(
            asset(&vfs, "data/alpha/blob.bin", "wat", 8)
                .unwrap_err()
                .to_string()
                .contains("unknown decode mode")
        );
        assert!(asset(&vfs, "data/alpha/blob.bin", "cfg", 8).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
}
