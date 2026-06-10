use crate::dsc::DSC_MAGIC;
use crate::image::COMPRESSED_BG_MAGIC;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PayloadKind {
    Dsc,
    CompressedBg,
    BgiAudio,
    MpegProgramStream,
    MpegVideo,
    OggVorbis,
    Png,
    Jpeg,
    Wav,
    Unknown,
}

pub fn sniff_payload(data: &[u8]) -> PayloadKind {
    if data.starts_with(DSC_MAGIC) {
        PayloadKind::Dsc
    } else if data.starts_with(COMPRESSED_BG_MAGIC) {
        PayloadKind::CompressedBg
    } else if data.len() >= 8 && &data[4..8] == b"bw  " {
        PayloadKind::BgiAudio
    } else if data.starts_with(b"\x00\x00\x01\xba") {
        PayloadKind::MpegProgramStream
    } else if data.starts_with(b"\x00\x00\x01\xb3") {
        PayloadKind::MpegVideo
    } else if data.starts_with(b"OggS") {
        PayloadKind::OggVorbis
    } else if data.starts_with(b"\x89PNG\r\n\x1a\n") {
        PayloadKind::Png
    } else if data.starts_with(b"\xff\xd8\xff") {
        PayloadKind::Jpeg
    } else if data.len() >= 12 && data.starts_with(b"RIFF") && &data[8..12] == b"WAVE" {
        PayloadKind::Wav
    } else {
        PayloadKind::Unknown
    }
}
