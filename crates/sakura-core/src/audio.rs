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
}
