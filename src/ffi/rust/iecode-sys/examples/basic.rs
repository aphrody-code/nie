use iecode_sys::safe::*;

fn main() {
    println!("iecode version: {}", version());

    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 {
        println!("Usage: basic <file>");
        println!("  Detects format, parses cfg.bin if applicable.");
        return;
    }

    let path = &args[1];
    let data = std::fs::read(path).expect("failed to read file");

    // Format detection
    let format = detect_format(&data);
    println!("Detected format: {}", format);

    // CRC32
    let checksum = crc32(&data);
    println!("CRC32: 0x{:08X}", checksum);

    // Try cfg.bin parsing
    if let Some(result) = cfgbin_parse(&data) {
        println!("cfg.bin format: {}", result.format());
        let json = result.json();
        let preview = &json[..100.min(json.len())];
        println!("JSON preview: {}", preview);
    }
}
