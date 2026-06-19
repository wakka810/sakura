use sakura_core::decompress_dsc;
use sakura_core::image::{decode_cbg, read_cbg_metadata};
use std::collections::BTreeMap;

fn main() {
    let mut ver_ok: BTreeMap<(u16, u32), (u32, u32)> = BTreeMap::new();
    let mut errors: Vec<String> = Vec::new();
    let mut dsc_ok = 0u32;
    let mut dsc_err = 0u32;
    let mut count = 0u32;
    let paths: Vec<_> = glob_arcs();
    for f in &paths {
        let d = std::fs::read(f).unwrap();
        if &d[..12] != b"BURIKO ARC20" {
            continue;
        }
        let cnt = u32::from_le_bytes([d[12], d[13], d[14], d[15]]) as usize;
        let base = 16 + cnt * 128;
        for i in 0..cnt {
            let e = &d[16 + i * 128..16 + (i + 1) * 128];
            let off = u32::from_le_bytes([e[96], e[97], e[98], e[99]]) as usize;
            let sz = u32::from_le_bytes([e[100], e[101], e[102], e[103]]) as usize;
            if base + off + sz > d.len() {
                continue;
            }
            let payload = &d[base + off..base + off + sz];
            if payload.len() >= 15 && &payload[..15] == b"CompressedBG___" {
                count += 1;
                let meta = match read_cbg_metadata(payload) {
                    Ok(m) => m,
                    Err(_) => continue,
                };
                let key = (meta.version, meta.bits_per_pixel);
                let ent = ver_ok.entry(key).or_insert((0, 0));
                match decode_cbg(payload) {
                    Ok(img) => {
                        ent.0 += 1;
                        // sanity: pixel buffer matches stride*height
                        let exp = img.stride * img.height as usize;
                        if img.pixels.len() != exp {
                            errors.push(format!(
                                "{}#{}: pixel len {} != {} (v{} {}bpp)",
                                f,
                                i,
                                img.pixels.len(),
                                exp,
                                meta.version,
                                meta.bits_per_pixel
                            ));
                        }
                    }
                    Err(err) => {
                        ent.1 += 1;
                        if errors.len() < 40 {
                            errors.push(format!(
                                "{}#{} v{} {}bpp {}x{}: {:?}",
                                f,
                                i,
                                meta.version,
                                meta.bits_per_pixel,
                                meta.width,
                                meta.height,
                                err
                            ));
                        }
                    }
                }
            } else if payload.len() >= 15 && &payload[..15] == b"DSC FORMAT 1.00" {
                match decompress_dsc(payload) {
                    Ok(_) => dsc_ok += 1,
                    Err(err) => {
                        dsc_err += 1;
                        if errors.len() < 40 {
                            errors.push(format!("DSC {}#{}: {:?}", f, i, err));
                        }
                    }
                }
            }
        }
    }
    println!("CBG decode results by (version,bpp) -> (ok,err):");
    for (k, v) in &ver_ok {
        println!("  v{} {}bpp: ok={} err={}", k.0, k.1, v.0, v.1);
    }
    println!("DSC ok={} err={}", dsc_ok, dsc_err);
    println!("total cbg scanned {}", count);
    println!("--- sample errors ({}) ---", errors.len());
    for e in errors.iter().take(40) {
        println!("{}", e);
    }
}

fn glob_arcs() -> Vec<String> {
    let mut v = Vec::new();
    for entry in std::fs::read_dir("サクラノ詩").unwrap() {
        let p = entry.unwrap().path();
        if p.extension().map(|e| e == "arc").unwrap_or(false) {
            v.push(p.to_string_lossy().to_string());
        }
    }
    v.sort();
    v
}
