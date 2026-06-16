use crate::bytes::{read_exact, read_u32_le};
use crate::error::{Result, SakuraError};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BgiAudioMetadata {
    pub ogg_offset: u32,
}

pub fn read_bgi_audio_metadata(data: &[u8]) -> Result<BgiAudioMetadata> {
    let header = read_exact(data, 0, 8)?;
    if &header[4..8] != b"bw  " {
        return Err(SakuraError::InvalidMagic { expected: "bw  " });
    }

    let ogg_offset = read_u32_le(header, 0)?;
    if ogg_offset as usize >= data.len() {
        return Err(SakuraError::InvalidAudio(
            "Ogg payload offset points past audio wrapper".to_owned(),
        ));
    }
    if !data[ogg_offset as usize..].starts_with(b"OggS") {
        return Err(SakuraError::InvalidAudio(
            "Ogg payload signature missing at wrapper offset".to_owned(),
        ));
    }

    Ok(BgiAudioMetadata { ogg_offset })
}

pub fn unwrap_bgi_audio(data: &[u8]) -> Result<&[u8]> {
    let meta = read_bgi_audio_metadata(data)?;
    Ok(&data[meta.ogg_offset as usize..])
}

/// Returns the embedded Ogg payload for a BGI audio wrapper, transparently
/// DSC-decompressing the source first when needed.
///
/// Most scenario BGM/voice/SE entries are stored as a raw `bw ` Ogg wrapper, but
/// the system UI sound effects (e.g. `system.arc` `SSE000000`/`SSE000001`, the
/// title menu cursor/decide sounds) are DSC-compressed inside the archive. This
/// helper accepts either form and always yields the decoded Ogg bytes.
pub fn unwrap_bgi_audio_owned(data: &[u8]) -> Result<Vec<u8>> {
    if data.len() >= crate::dsc::DSC_MAGIC.len()
        && &data[..crate::dsc::DSC_MAGIC.len()] == crate::dsc::DSC_MAGIC
    {
        let decompressed = crate::dsc::decompress_dsc(data)?;
        let ogg = unwrap_bgi_audio(&decompressed)?;
        return Ok(ogg.to_vec());
    }
    Ok(unwrap_bgi_audio(data)?.to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_synthetic_bgi_audio_metadata() -> Result<()> {
        let mut data = Vec::new();
        data.extend_from_slice(&12u32.to_le_bytes());
        data.extend_from_slice(b"bw  ");
        data.extend_from_slice(&[0u8; 4]);
        data.extend_from_slice(b"OggS");

        let meta = read_bgi_audio_metadata(&data)?;
        assert_eq!(meta.ogg_offset, 12);
        Ok(())
    }

    #[test]
    fn unwraps_synthetic_bgi_audio_to_ogg_slice() -> Result<()> {
        let mut data = Vec::new();
        data.extend_from_slice(&8u32.to_le_bytes());
        data.extend_from_slice(b"bw  ");
        data.extend_from_slice(b"OggSfixture");

        let ogg = unwrap_bgi_audio(&data)?;
        assert_eq!(ogg, b"OggSfixture");
        Ok(())
    }

    #[test]
    fn owned_unwrap_passes_through_raw_bw_wrapper() -> Result<()> {
        let mut data = Vec::new();
        data.extend_from_slice(&8u32.to_le_bytes());
        data.extend_from_slice(b"bw  ");
        data.extend_from_slice(b"OggSfixture");

        let ogg = unwrap_bgi_audio_owned(&data)?;
        assert_eq!(ogg, b"OggSfixture");
        Ok(())
    }

    #[test]
    #[ignore = "requires SAKURA_INSTALL_DIR pointing at the user-owned local install"]
    fn owned_unwrap_decodes_dsc_compressed_system_sfx() -> Result<()> {
        use crate::archive::ArcArchive;
        use std::path::PathBuf;

        let game_dir = std::env::var_os("SAKURA_INSTALL_DIR")
            .map(PathBuf::from)
            .ok_or_else(|| {
                SakuraError::InvalidAudio(
                    "SAKURA_INSTALL_DIR is required for this ignored local-install probe"
                        .to_owned(),
                )
            })?;
        let data = std::fs::read(game_dir.join("system.arc"))
            .map_err(|error| SakuraError::InvalidAudio(format!("read system.arc: {error}")))?;
        let archive = ArcArchive::parse(&data)?;
        // SSE000000/SSE000001 are the title menu cursor/decide sounds, stored
        // DSC-compressed inside system.arc.
        for name in [b"sse000000".as_slice(), b"sse000001".as_slice()] {
            let entry = archive
                .entries()
                .iter()
                .find(|entry| entry.name.as_bytes().eq_ignore_ascii_case(name))
                .ok_or_else(|| SakuraError::InvalidAudio("system SFX entry missing".to_owned()))?;
            let payload = archive.entry_data(entry)?;
            let ogg = unwrap_bgi_audio_owned(payload)?;
            assert_eq!(&ogg[..4], b"OggS");
        }
        Ok(())
    }
}
