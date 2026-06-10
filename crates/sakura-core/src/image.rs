use crate::bytes::{read_exact, read_u32_le};
use crate::error::{Result, SakuraError};

mod v2;

pub const COMPRESSED_BG_MAGIC: &[u8; 16] = b"CompressedBG___\0";
pub(super) const CBG_HEADER_LEN: usize = 0x30;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CbgMetadata {
    pub width: u16,
    pub height: u16,
    pub bits_per_pixel: u32,
    pub intermediate_length: u32,
    pub key: u32,
    pub encoded_length: u32,
    pub checksum_sum: u8,
    pub checksum_xor: u8,
    pub version: u16,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CbgPixelFormat {
    Gray8,
    Bgr565,
    Bgr24,
    Bgr32,
    Bgra32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CbgImage {
    pub width: u16,
    pub height: u16,
    pub stride: usize,
    pub format: CbgPixelFormat,
    pub pixels: Vec<u8>,
}

pub fn read_cbg_metadata(data: &[u8]) -> Result<CbgMetadata> {
    let header = read_exact(data, 0, CBG_HEADER_LEN)?;
    if !header.starts_with(COMPRESSED_BG_MAGIC) {
        return Err(SakuraError::InvalidMagic {
            expected: "CompressedBG___",
        });
    }

    let width = u16::from_le_bytes([header[0x10], header[0x11]]);
    let height = u16::from_le_bytes([header[0x12], header[0x13]]);
    let bits_per_pixel = read_u32_le(header, 0x14)?;
    let intermediate_length = read_u32_le(header, 0x20)?;
    let key = read_u32_le(header, 0x24)?;
    let encoded_length = read_u32_le(header, 0x28)?;
    let version = u16::from_le_bytes([header[0x2e], header[0x2f]]);

    if width == 0 || height == 0 {
        return Err(SakuraError::InvalidImage(
            "CompressedBG dimensions must be non-zero".to_owned(),
        ));
    }
    if !matches!(bits_per_pixel, 8 | 16 | 24 | 32) {
        return Err(SakuraError::InvalidImage(format!(
            "unsupported CompressedBG bit depth {bits_per_pixel}"
        )));
    }
    if version > 2 {
        return Err(SakuraError::UnsupportedFormat(format!(
            "CompressedBG version {version}"
        )));
    }
    let encoded_end = CBG_HEADER_LEN
        .checked_add(encoded_length as usize)
        .ok_or_else(|| SakuraError::InvalidImage("encoded byte range overflows".to_owned()))?;
    if encoded_end > data.len() {
        return Err(SakuraError::UnexpectedEof {
            offset: CBG_HEADER_LEN,
            needed: encoded_length as usize,
            available: data.len().saturating_sub(CBG_HEADER_LEN),
        });
    }

    Ok(CbgMetadata {
        width,
        height,
        bits_per_pixel,
        intermediate_length,
        key,
        encoded_length,
        checksum_sum: header[0x2c],
        checksum_xor: header[0x2d],
        version,
    })
}

pub fn decrypt_cbg_stream(data: &[u8]) -> Result<Vec<u8>> {
    let meta = read_cbg_metadata(data)?;
    let start = CBG_HEADER_LEN;
    let end = start
        .checked_add(meta.encoded_length as usize)
        .ok_or_else(|| SakuraError::InvalidImage("encoded byte range overflows".to_owned()))?;
    let encrypted = read_exact(data, start, end - start)?;
    let mut key = BgiKey::new(meta.key, 0);
    let mut decoded = Vec::with_capacity(encrypted.len());
    let mut sum = 0u8;
    let mut xor = 0u8;

    for byte in encrypted {
        let value = byte.wrapping_sub(key.update());
        sum = sum.wrapping_add(value);
        xor ^= value;
        decoded.push(value);
    }

    if sum != meta.checksum_sum || xor != meta.checksum_xor {
        return Err(SakuraError::InvalidImage(
            "CompressedBG encoded stream checksum mismatch".to_owned(),
        ));
    }
    Ok(decoded)
}

pub fn decode_cbg(data: &[u8]) -> Result<CbgImage> {
    let meta = read_cbg_metadata(data)?;
    if meta.version >= 2 {
        return v2::decode_cbg_v2(data, &meta);
    }
    decode_cbg_v1(data, &meta)
}

pub fn cbg_to_rgba(image: &CbgImage) -> Result<Vec<u8>> {
    let width = image.width as usize;
    let height = image.height as usize;
    let pixel_count = width
        .checked_mul(height)
        .ok_or_else(|| SakuraError::InvalidImage("RGBA image dimensions overflow".to_owned()))?;
    let mut rgba = vec![
        0u8;
        pixel_count.checked_mul(4).ok_or_else(|| {
            SakuraError::InvalidImage("RGBA pixel buffer length overflows".to_owned())
        })?
    ];

    for y in 0..height {
        let row = y
            .checked_mul(image.stride)
            .ok_or_else(|| SakuraError::InvalidImage("source row offset overflows".to_owned()))?;
        for x in 0..width {
            let dst = (y * width + x) * 4;
            match image.format {
                CbgPixelFormat::Gray8 => {
                    let value = *image.pixels.get(row + x).ok_or_else(|| {
                        SakuraError::InvalidImage("grayscale source pixel is truncated".to_owned())
                    })?;
                    rgba[dst] = value;
                    rgba[dst + 1] = value;
                    rgba[dst + 2] = value;
                    rgba[dst + 3] = 0xff;
                }
                CbgPixelFormat::Bgr565 => {
                    let src = row + x * 2;
                    let bytes = image.pixels.get(src..src + 2).ok_or_else(|| {
                        SakuraError::InvalidImage("BGR565 source pixel is truncated".to_owned())
                    })?;
                    let value = u16::from_le_bytes([bytes[0], bytes[1]]);
                    rgba[dst] = scale_5_to_8(((value >> 11) & 0x1f) as u8);
                    rgba[dst + 1] = scale_6_to_8(((value >> 5) & 0x3f) as u8);
                    rgba[dst + 2] = scale_5_to_8((value & 0x1f) as u8);
                    rgba[dst + 3] = 0xff;
                }
                CbgPixelFormat::Bgr24 => {
                    let src = row + x * 3;
                    let bgr = image.pixels.get(src..src + 3).ok_or_else(|| {
                        SakuraError::InvalidImage("BGR24 source pixel is truncated".to_owned())
                    })?;
                    rgba[dst] = bgr[2];
                    rgba[dst + 1] = bgr[1];
                    rgba[dst + 2] = bgr[0];
                    rgba[dst + 3] = 0xff;
                }
                CbgPixelFormat::Bgr32 | CbgPixelFormat::Bgra32 => {
                    let src = row + x * 4;
                    let bgra = image.pixels.get(src..src + 4).ok_or_else(|| {
                        SakuraError::InvalidImage("BGR32 source pixel is truncated".to_owned())
                    })?;
                    rgba[dst] = bgra[2];
                    rgba[dst + 1] = bgra[1];
                    rgba[dst + 2] = bgra[0];
                    rgba[dst + 3] = if image.format == CbgPixelFormat::Bgra32 {
                        bgra[3]
                    } else {
                        0xff
                    };
                }
            }
        }
    }

    Ok(rgba)
}

fn decode_cbg_v1(data: &[u8], meta: &CbgMetadata) -> Result<CbgImage> {
    let encoded = decrypt_cbg_stream(data)?;
    let mut offset = 0usize;
    let weights = read_weight_table(&encoded, 0x100, &mut offset)?;
    let tree = WeightedHuffmanTree::new(&weights)?;
    let packed_start = CBG_HEADER_LEN + meta.encoded_length as usize;
    let packed_bits = read_exact(data, packed_start, data.len() - packed_start)?;
    let mut bits = MsbBitReader::new(packed_bits);
    let mut packed = vec![0u8; meta.intermediate_length as usize];
    for byte in &mut packed {
        *byte = tree.decode(&mut bits)? as u8;
    }

    let pixel_size = pixel_size(meta.bits_per_pixel)?;
    let stride = meta.width as usize * pixel_size;
    let mut pixels = vec![0u8; stride * meta.height as usize];
    unpack_zero_runs(&packed, &mut pixels)?;
    reverse_average_sampling(
        &mut pixels,
        meta.width as usize,
        meta.height as usize,
        stride,
        pixel_size,
    );

    Ok(CbgImage {
        width: meta.width,
        height: meta.height,
        stride,
        format: pixel_format(meta.bits_per_pixel, meta.version)?,
        pixels,
    })
}

fn scale_5_to_8(value: u8) -> u8 {
    (value << 3) | (value >> 2)
}

fn scale_6_to_8(value: u8) -> u8 {
    (value << 2) | (value >> 4)
}

fn pixel_size(bits_per_pixel: u32) -> Result<usize> {
    match bits_per_pixel {
        8 => Ok(1),
        16 => Ok(2),
        24 => Ok(3),
        32 => Ok(4),
        _ => Err(SakuraError::InvalidImage(format!(
            "unsupported CompressedBG bit depth {bits_per_pixel}"
        ))),
    }
}

fn pixel_format(bits_per_pixel: u32, version: u16) -> Result<CbgPixelFormat> {
    match (bits_per_pixel, version) {
        (8, _) => Ok(CbgPixelFormat::Gray8),
        (16, 0 | 1) => Ok(CbgPixelFormat::Bgr565),
        (24, _) => Ok(CbgPixelFormat::Bgr24),
        (32, _) => Ok(CbgPixelFormat::Bgra32),
        _ => Err(SakuraError::InvalidImage(format!(
            "unsupported CompressedBG bit depth {bits_per_pixel}"
        ))),
    }
}

pub(super) fn read_weight_table(data: &[u8], count: usize, offset: &mut usize) -> Result<Vec<u32>> {
    let mut weights = Vec::with_capacity(count);
    for _ in 0..count {
        weights.push(read_integer(data, offset)?);
    }
    Ok(weights)
}

pub(super) fn read_integer(data: &[u8], offset: &mut usize) -> Result<u32> {
    let mut value = 0u32;
    let mut shift = 0u32;
    loop {
        let byte = *data.get(*offset).ok_or_else(|| {
            SakuraError::InvalidImage("truncated variable-length integer".to_owned())
        })?;
        *offset += 1;
        value |= u32::from(byte & 0x7f) << shift;
        if byte & 0x80 == 0 {
            return Ok(value);
        }
        shift += 7;
        if shift >= 32 {
            return Err(SakuraError::InvalidImage(
                "variable-length integer exceeds 32 bits".to_owned(),
            ));
        }
    }
}

fn unpack_zero_runs(input: &[u8], output: &mut [u8]) -> Result<()> {
    let mut dst = 0usize;
    let mut src = 0usize;
    let mut zero_run = false;
    while dst < output.len() {
        let count = read_integer(input, &mut src)? as usize;
        if dst + count > output.len() {
            return Err(SakuraError::InvalidImage(
                "zero-run segment exceeds output size".to_owned(),
            ));
        }
        if zero_run {
            output[dst..dst + count].fill(0);
        } else {
            let end = src.checked_add(count).ok_or_else(|| {
                SakuraError::InvalidImage("zero-run input range overflows".to_owned())
            })?;
            let source = input.get(src..end).ok_or_else(|| {
                SakuraError::InvalidImage("zero-run literal segment is truncated".to_owned())
            })?;
            output[dst..dst + count].copy_from_slice(source);
            src = end;
        }
        zero_run = !zero_run;
        dst += count;
    }
    Ok(())
}

fn reverse_average_sampling(
    output: &mut [u8],
    width: usize,
    height: usize,
    stride: usize,
    pixel_size: usize,
) {
    for y in 0..height {
        let line = y * stride;
        for x in 0..width {
            let pixel = line + x * pixel_size;
            for p in 0..pixel_size {
                let mut avg = 0usize;
                if x > 0 {
                    avg += usize::from(output[pixel + p - pixel_size]);
                }
                if y > 0 {
                    avg += usize::from(output[pixel + p - stride]);
                }
                if x > 0 && y > 0 {
                    avg /= 2;
                }
                if avg != 0 {
                    output[pixel + p] = output[pixel + p].wrapping_add(avg as u8);
                }
            }
        }
    }
}

#[derive(Debug, Clone)]
struct WeightedNode {
    valid: bool,
    is_parent: bool,
    weight: u32,
    left: usize,
    right: usize,
}

#[derive(Debug, Clone)]
pub(super) struct WeightedHuffmanTree {
    nodes: Vec<WeightedNode>,
}

impl WeightedHuffmanTree {
    pub(super) fn new(weights: &[u32]) -> Result<Self> {
        Self::new_with_order(weights, HuffmanBuildOrder::StableMinimum)
    }

    pub(super) fn new_v2(weights: &[u32]) -> Result<Self> {
        Self::new_with_order(weights, HuffmanBuildOrder::V2Minimum)
    }

    fn new_with_order(weights: &[u32], order: HuffmanBuildOrder) -> Result<Self> {
        let root_weight = weights.iter().try_fold(0u32, |sum, weight| {
            sum.checked_add(*weight).ok_or_else(|| {
                SakuraError::InvalidImage("Huffman root weight overflows".to_owned())
            })
        })?;
        if root_weight == 0 {
            return Err(SakuraError::InvalidImage(
                "Huffman tree has no weighted leaves".to_owned(),
            ));
        }

        let mut nodes: Vec<WeightedNode> = weights
            .iter()
            .map(|weight| WeightedNode {
                valid: *weight != 0,
                is_parent: false,
                weight: *weight,
                left: 0,
                right: 0,
            })
            .collect();

        loop {
            let left = take_lightest_node(&mut nodes, order, 0)?;
            let right = take_lightest_node(&mut nodes, order, 1)?;
            let weight = nodes[left]
                .weight
                .checked_add(nodes[right].weight)
                .ok_or_else(|| {
                    SakuraError::InvalidImage("Huffman parent weight overflows".to_owned())
                })?;
            nodes.push(WeightedNode {
                valid: true,
                is_parent: true,
                weight,
                left,
                right,
            });
            if weight >= root_weight {
                break;
            }
        }

        Ok(Self { nodes })
    }

    pub(super) fn decode(&self, input: &mut MsbBitReader<'_>) -> Result<u16> {
        let mut node_index = self.nodes.len() - 1;
        while self.nodes[node_index].is_parent {
            node_index = if input.read_bit()? == 0 {
                self.nodes[node_index].left
            } else {
                self.nodes[node_index].right
            };
        }
        Ok(node_index as u16)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum HuffmanBuildOrder {
    StableMinimum,
    V2Minimum,
}

fn take_lightest_node(
    nodes: &mut [WeightedNode],
    order: HuffmanBuildOrder,
    child_slot: usize,
) -> Result<usize> {
    let Some(index) = lightest_node_index(nodes, order, child_slot) else {
        return Err(SakuraError::InvalidImage(
            "Huffman tree is missing a child node".to_owned(),
        ));
    };
    nodes[index].valid = false;
    Ok(index)
}

fn lightest_node_index(
    nodes: &[WeightedNode],
    order: HuffmanBuildOrder,
    child_slot: usize,
) -> Option<usize> {
    match order {
        HuffmanBuildOrder::StableMinimum => nodes
            .iter()
            .enumerate()
            .filter(|(_, node)| node.valid)
            .min_by_key(|(_, node)| node.weight)
            .map(|(index, _)| index),
        HuffmanBuildOrder::V2Minimum => {
            let (mut index, mut min_weight) = first_valid_node(nodes)?;
            let start = (index + 1).max(child_slot + 1);
            for (candidate_index, node) in nodes.iter().enumerate().skip(start) {
                if node.valid && node.weight < min_weight {
                    index = candidate_index;
                    min_weight = node.weight;
                }
            }
            Some(index)
        }
    }
}

fn first_valid_node(nodes: &[WeightedNode]) -> Option<(usize, u32)> {
    nodes
        .iter()
        .enumerate()
        .find(|(_, node)| node.valid)
        .map(|(index, node)| (index, node.weight))
}

#[derive(Debug, Clone)]
pub(super) struct MsbBitReader<'a> {
    data: &'a [u8],
    byte_offset: usize,
    mask: u8,
    current: u8,
}

impl<'a> MsbBitReader<'a> {
    pub(super) fn new(data: &'a [u8]) -> Self {
        Self {
            data,
            byte_offset: 0,
            mask: 0,
            current: 0,
        }
    }

    pub(super) fn read_bit(&mut self) -> Result<u8> {
        if self.mask == 0 {
            self.current = *self.data.get(self.byte_offset).ok_or_else(|| {
                SakuraError::InvalidImage("truncated Huffman bitstream".to_owned())
            })?;
            self.byte_offset += 1;
            self.mask = 0x80;
        }
        let bit = u8::from(self.current & self.mask != 0);
        self.mask >>= 1;
        Ok(bit)
    }

    pub(super) fn read_bits(&mut self, count: u8) -> Result<u32> {
        let mut value = 0u32;
        for _ in 0..count {
            value = (value << 1) | u32::from(self.read_bit()?);
        }
        Ok(value)
    }

    pub(super) fn align_to_byte(&mut self) {
        self.mask = 0;
    }

    pub(super) fn has_unread_bytes(&self) -> bool {
        self.byte_offset < self.data.len()
    }
}

#[derive(Debug, Clone)]
struct BgiKey {
    key: u32,
    magic: u32,
}

impl BgiKey {
    fn new(key: u32, magic: u32) -> Self {
        Self { key, magic }
    }

    fn update(&mut self) -> u8 {
        let v0 = 20_021u32.wrapping_mul(self.key & 0xffff);
        let mut v1 = self.magic | (self.key >> 16);
        v1 = v1
            .wrapping_mul(20_021)
            .wrapping_add(self.key.wrapping_mul(346));
        v1 = v1.wrapping_add(v0 >> 16) & 0xffff;
        self.key = (v1 << 16).wrapping_add(v0 & 0xffff).wrapping_add(1);
        v1 as u8
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_synthetic_cbg_metadata() -> Result<()> {
        let mut data = vec![0u8; CBG_HEADER_LEN + 8];
        data[..COMPRESSED_BG_MAGIC.len()].copy_from_slice(COMPRESSED_BG_MAGIC);
        data[0x10..0x12].copy_from_slice(&1280u16.to_le_bytes());
        data[0x12..0x14].copy_from_slice(&720u16.to_le_bytes());
        data[0x14..0x18].copy_from_slice(&32u32.to_le_bytes());
        data[0x20..0x24].copy_from_slice(&4096u32.to_le_bytes());
        data[0x24..0x28].copy_from_slice(&0x1234_5678u32.to_le_bytes());
        data[0x28..0x2c].copy_from_slice(&8u32.to_le_bytes());
        data[0x2e..0x30].copy_from_slice(&2u16.to_le_bytes());

        let meta = read_cbg_metadata(&data)?;
        assert_eq!(meta.width, 1280);
        assert_eq!(meta.height, 720);
        assert_eq!(meta.bits_per_pixel, 32);
        assert_eq!(meta.encoded_length, 8);
        assert_eq!(meta.version, 2);
        Ok(())
    }

    #[test]
    fn decrypts_synthetic_cbg_stream() -> Result<()> {
        let key = 0x1234_5678u32;
        let plain = [0x10u8, 0x20, 0x30, 0x40];
        let mut data = synthetic_cbg_header(key, 64, 64, 32, plain.len() as u32, &plain, 2);
        data.extend_from_slice(&encrypt_cbg_plain(key, &plain));

        let decoded = decrypt_cbg_stream(&data)?;
        assert_eq!(decoded, plain);
        Ok(())
    }

    #[test]
    fn decodes_synthetic_v1_gray8() -> Result<()> {
        let key = 0x8765_4321u32;
        let mut weights = vec![0u8; 0x100];
        weights[1] = 1;
        weights[7] = 1;
        let mut data = synthetic_cbg_header(key, 1, 1, 8, 2, &weights, 1);
        data.extend_from_slice(&encrypt_cbg_plain(key, &weights));
        data.push(0b0100_0000);

        let image = decode_cbg(&data)?;
        assert_eq!(image.width, 1);
        assert_eq!(image.height, 1);
        assert_eq!(image.stride, 1);
        assert_eq!(image.format, CbgPixelFormat::Gray8);
        assert_eq!(image.pixels, [7]);
        assert_eq!(cbg_to_rgba(&image)?, [7, 7, 7, 0xff]);
        Ok(())
    }

    #[test]
    fn decodes_synthetic_v2_gray8() -> Result<()> {
        let key = 0x1020_3040u32;
        let dct_plain = vec![0u8; 0x80];
        let mut data = synthetic_cbg_header(key, 8, 8, 8, 0, &dct_plain, 2);
        data.extend_from_slice(&encrypt_cbg_plain(key, &dct_plain));
        append_weight_table(&mut data, 0x10, &[0, 1]);
        append_weight_table(&mut data, 0xb0, &[0, 1]);

        let input_base = 200i32;
        append_i32_le(&mut data, input_base);
        append_i32_le(&mut data, input_base + 4);
        data.extend_from_slice(&[0x00, 0x40, 0x00, 0x00]);

        let image = decode_cbg(&data)?;
        assert_eq!(image.width, 8);
        assert_eq!(image.height, 8);
        assert_eq!(image.stride, 32);
        assert_eq!(image.format, CbgPixelFormat::Bgr32);
        for pixel in image.pixels.chunks_exact(4) {
            assert_eq!(pixel, [128, 128, 128, 0]);
        }
        for pixel in cbg_to_rgba(&image)?.chunks_exact(4) {
            assert_eq!(pixel, [128, 128, 128, 0xff]);
        }
        Ok(())
    }

    fn synthetic_cbg_header(
        key: u32,
        width: u16,
        height: u16,
        bits_per_pixel: u32,
        intermediate_length: u32,
        encoded_plain: &[u8],
        version: u16,
    ) -> Vec<u8> {
        let mut data = vec![0u8; CBG_HEADER_LEN];
        data[..COMPRESSED_BG_MAGIC.len()].copy_from_slice(COMPRESSED_BG_MAGIC);
        data[0x10..0x12].copy_from_slice(&width.to_le_bytes());
        data[0x12..0x14].copy_from_slice(&height.to_le_bytes());
        data[0x14..0x18].copy_from_slice(&bits_per_pixel.to_le_bytes());
        data[0x20..0x24].copy_from_slice(&intermediate_length.to_le_bytes());
        data[0x24..0x28].copy_from_slice(&key.to_le_bytes());
        data[0x28..0x2c].copy_from_slice(&(encoded_plain.len() as u32).to_le_bytes());
        data[0x2c] = encoded_plain
            .iter()
            .fold(0u8, |sum, byte| sum.wrapping_add(*byte));
        data[0x2d] = encoded_plain.iter().fold(0u8, |xor, byte| xor ^ *byte);
        data[0x2e..0x30].copy_from_slice(&version.to_le_bytes());
        data
    }

    fn encrypt_cbg_plain(key: u32, plain: &[u8]) -> Vec<u8> {
        let mut cipher = BgiKey::new(key, 0);
        plain
            .iter()
            .map(|byte| byte.wrapping_add(cipher.update()))
            .collect()
    }

    fn append_weight_table(out: &mut Vec<u8>, count: usize, weighted_symbols: &[usize]) {
        for index in 0..count {
            out.push(u8::from(weighted_symbols.contains(&index)));
        }
    }

    fn append_i32_le(out: &mut Vec<u8>, value: i32) {
        out.extend_from_slice(&value.to_le_bytes());
    }
}
