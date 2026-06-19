use std::env;
use std::error::Error;
use std::io;
use std::path::PathBuf;

fn main() -> Result<(), Box<dyn Error>> {
    let manifest_dir =
        PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").ok_or_else(|| {
            io::Error::new(io::ErrorKind::NotFound, "CARGO_MANIFEST_DIR is not set")
        })?);
    let header_dir = manifest_dir.join("../../node_modules/pl_mpeg.c");
    let header = header_dir.join("pl_mpeg.h");
    if !header.is_file() {
        return Err(format!(
            "missing {}; run npm install from the repository root",
            header.display()
        )
        .into());
    }

    println!("cargo:rerun-if-changed=src/movie_decoder.c");
    println!("cargo:rerun-if-changed=src/movie_c_headers/string.h");
    println!("cargo:rerun-if-changed=src/movie_c_headers/stdlib.h");
    println!("cargo:rerun-if-changed={}", header.display());

    cc::Build::new()
        .file("src/movie_decoder.c")
        .include("src/movie_c_headers")
        .include(header_dir)
        .flag_if_supported("-std=c11")
        .flag_if_supported("-ffreestanding")
        .warnings(true)
        .compile("sakura_movie_decoder");
    Ok(())
}
