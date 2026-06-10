use core::fmt;

pub type Result<T> = core::result::Result<T, SakuraError>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SakuraError {
    UnexpectedEof {
        offset: usize,
        needed: usize,
        available: usize,
    },
    InvalidMagic {
        expected: &'static str,
    },
    InvalidArchive(String),
    InvalidArchiveName,
    InvalidAudio(String),
    InvalidDsc(String),
    InvalidImage(String),
    InvalidRuntime(String),
    InvalidScript(String),
    UnsupportedFormat(String),
}

impl fmt::Display for SakuraError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UnexpectedEof {
                offset,
                needed,
                available,
            } => write!(
                f,
                "unexpected EOF at byte {offset}: needed {needed} bytes, had {available}"
            ),
            Self::InvalidMagic { expected } => write!(f, "invalid magic, expected {expected}"),
            Self::InvalidArchive(message) => write!(f, "invalid archive: {message}"),
            Self::InvalidArchiveName => write!(f, "invalid archive entry name"),
            Self::InvalidAudio(message) => write!(f, "invalid audio payload: {message}"),
            Self::InvalidDsc(message) => write!(f, "invalid DSC payload: {message}"),
            Self::InvalidImage(message) => write!(f, "invalid image payload: {message}"),
            Self::InvalidRuntime(message) => write!(f, "invalid runtime state: {message}"),
            Self::InvalidScript(message) => write!(f, "invalid script payload: {message}"),
            Self::UnsupportedFormat(message) => write!(f, "unsupported format: {message}"),
        }
    }
}

impl std::error::Error for SakuraError {}
