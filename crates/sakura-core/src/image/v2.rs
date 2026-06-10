use super::{
    decrypt_cbg_stream, read_exact, read_integer, read_weight_table, CbgImage, CbgMetadata,
    CbgPixelFormat, MsbBitReader, WeightedHuffmanTree, CBG_HEADER_LEN,
};
use crate::error::{Result, SakuraError};

pub(super) fn decode_cbg_v2(data: &[u8], meta: &CbgMetadata) -> Result<CbgImage> {
    if meta.encoded_length < 0x80 {
        return Err(SakuraError::InvalidImage(
            "CompressedBG v2 encoded stream is shorter than DCT table".to_owned(),
        ));
    }

    let encoded = decrypt_cbg_stream(data)?;
    let width = align8(meta.width as usize);
    let height = align8(meta.height as usize);
    let mut decoder = V2Decoder::new(meta.bits_per_pixel, width, height, &encoded)?;

    let base_offset = CBG_HEADER_LEN
        .checked_add(meta.encoded_length as usize)
        .ok_or_else(|| SakuraError::InvalidImage("v2 base offset overflows".to_owned()))?;
    let mut cursor = base_offset;
    decoder.tree1 = Some(WeightedHuffmanTree::new_v2(&read_weight_table(
        data,
        0x10,
        &mut cursor,
    )?)?);
    decoder.tree2 = Some(WeightedHuffmanTree::new_v2(&read_weight_table(
        data,
        0xb0,
        &mut cursor,
    )?)?);

    let y_blocks = height / 8;
    let offset_count = y_blocks + 1;
    let input_base = cursor
        .checked_add(offset_count * 4)
        .and_then(|value| value.checked_sub(base_offset))
        .ok_or_else(|| SakuraError::InvalidImage("v2 input base overflows".to_owned()))?;
    let mut offsets = Vec::with_capacity(offset_count);
    for _ in 0..offset_count {
        let raw = read_i32_le(data, cursor)?;
        cursor += 4;
        offsets.push(raw - input_base as i32);
    }
    let input = read_exact(data, cursor, data.len() - cursor)?;
    let pad_skip = ((width >> 3) + 7) >> 3;
    let mut output = vec![0u8; width * height * 4];

    let mut dst = 0usize;
    for row in 0..y_blocks {
        let block_offset = checked_offset(offsets[row], pad_skip, input.len())?;
        let next_offset = if row + 1 == y_blocks {
            input.len()
        } else {
            checked_offset(offsets[row + 1], 0, input.len())?
        };
        if block_offset > next_offset {
            return Err(SakuraError::InvalidImage(
                "v2 block offset points past next block".to_owned(),
            ));
        }
        decoder.unpack_block(&input[block_offset..next_offset], &mut output, dst)?;
        dst += width * 32;
    }

    let has_alpha = if meta.bits_per_pixel == 32 {
        let alpha_offset = checked_offset(offsets[y_blocks], 0, input.len())?;
        unpack_alpha(&input[alpha_offset..], &mut output, width)?
    } else {
        false
    };

    let pixels = crop_aligned_output(output, meta.width as usize, meta.height as usize, width)?;
    Ok(CbgImage {
        width: meta.width,
        height: meta.height,
        stride: meta.width as usize * 4,
        format: if has_alpha {
            CbgPixelFormat::Bgra32
        } else {
            CbgPixelFormat::Bgr32
        },
        pixels,
    })
}

#[derive(Debug, Clone)]
struct V2Decoder {
    bits_per_pixel: u32,
    width: usize,
    dct: [[f32; 64]; 2],
    tree1: Option<WeightedHuffmanTree>,
    tree2: Option<WeightedHuffmanTree>,
}

impl V2Decoder {
    fn new(bits_per_pixel: u32, width: usize, _height: usize, encoded: &[u8]) -> Result<Self> {
        if !matches!(bits_per_pixel, 8 | 24 | 32) {
            return Err(SakuraError::InvalidImage(format!(
                "unsupported CompressedBG v2 bit depth {bits_per_pixel}"
            )));
        }
        let mut dct = [[0f32; 64]; 2];
        for index in 0..0x80 {
            dct[index >> 6][index & 0x3f] = f32::from(encoded[index]) * DCT_TABLE[index & 0x3f];
        }
        Ok(Self {
            bits_per_pixel,
            width,
            dct,
            tree1: None,
            tree2: None,
        })
    }

    fn unpack_block(&self, block: &[u8], output: &mut [u8], dst: usize) -> Result<()> {
        let mut offset = 0usize;
        let block_size = read_integer(block, &mut offset)? as usize;
        let mut reader = MsbBitReader::new(&block[offset..]);
        let mut color_data = vec![0i16; block_size];
        let mut acc = 0i32;
        let tree1 = self.tree1()?;
        let tree2 = self.tree2()?;

        for index in (0..block_size).step_by(64) {
            if !reader.has_unread_bytes() {
                break;
            }
            let count = tree1.decode(&mut reader)? as u8;
            if count != 0 {
                acc += read_signed_bits(&mut reader, count)?;
            }
            color_data[index] = acc as i16;
        }

        reader.align_to_byte();

        for base in (0..block_size).step_by(64) {
            if !reader.has_unread_bytes() {
                break;
            }
            let mut index = 1usize;
            while index < 64 && reader.has_unread_bytes() {
                let mut code = tree2.decode(&mut reader)? as usize;
                if code == 0 {
                    break;
                }
                if code == 0x0f {
                    index += 0x10;
                    continue;
                }
                index += code & 0x0f;
                if index >= BLOCK_FILL_ORDER.len() {
                    break;
                }
                code >>= 4;
                let value = read_signed_bits(&mut reader, code as u8)?;
                color_data[base + usize::from(BLOCK_FILL_ORDER[index])] = value as i16;
                index += 1;
            }
        }

        if self.bits_per_pixel == 8 {
            self.decode_grayscale(&color_data, output, dst)
        } else {
            self.decode_rgb(&color_data, output, dst)
        }
    }

    fn decode_rgb(&self, data: &[i16], output: &mut [u8], mut dst: usize) -> Result<()> {
        let block_count = self.width / 8;
        let required = self.width * 24;
        if data.len() < required {
            return Err(SakuraError::InvalidImage(
                "v2 RGB block is shorter than expected".to_owned(),
            ));
        }

        let mut ycbcr = [[0i16; 3]; 64];
        for block in 0..block_count {
            let mut src = block * 64;
            for channel in 0..3 {
                self.decode_dct(channel, data, src, &mut ycbcr);
                src += self.width * 8;
            }
            for (index, pixel) in ycbcr.iter().enumerate() {
                let cy = f32::from(pixel[0]);
                let cb = f32::from(pixel[1]);
                let cr = f32::from(pixel[2]);
                let r = cy + 1.402 * cr - 178.956;
                let g = cy - 0.34414 * cb - 0.71414 * cr + 135.95984;
                let b = cy + 1.772 * cb - 226.316;
                let y = index >> 3;
                let x = index & 7;
                let out = dst + (y * self.width + x) * 4;
                output[out] = float_to_byte(b);
                output[out + 1] = float_to_byte(g);
                output[out + 2] = float_to_byte(r);
            }
            dst += 32;
        }
        Ok(())
    }

    fn decode_grayscale(&self, data: &[i16], output: &mut [u8], mut dst: usize) -> Result<()> {
        let block_count = self.width / 8;
        let required = self.width * 8;
        if data.len() < required {
            return Err(SakuraError::InvalidImage(
                "v2 grayscale block is shorter than expected".to_owned(),
            ));
        }

        let mut ycbcr = [[0i16; 3]; 64];
        let mut src = 0usize;
        for _ in 0..block_count {
            self.decode_dct(0, data, src, &mut ycbcr);
            src += 64;
            for (index, pixel) in ycbcr.iter().enumerate() {
                let y = index >> 3;
                let x = index & 7;
                let out = dst + (y * self.width + x) * 4;
                let value = pixel[0] as u8;
                output[out] = value;
                output[out + 1] = value;
                output[out + 2] = value;
            }
            dst += 32;
        }
        Ok(())
    }

    fn decode_dct(&self, channel: usize, data: &[i16], src: usize, ycbcr: &mut [[i16; 3]; 64]) {
        let table = if channel > 0 { 1 } else { 0 };
        let mut tmp = [[0f32; 8]; 8];

        for column in 0..8 {
            if data[src + 8 + column] == 0
                && data[src + 16 + column] == 0
                && data[src + 24 + column] == 0
                && data[src + 32 + column] == 0
                && data[src + 40 + column] == 0
                && data[src + 48 + column] == 0
                && data[src + 56 + column] == 0
            {
                let value = f32::from(data[src + column]) * self.dct[table][column];
                for row in &mut tmp {
                    row[column] = value;
                }
                continue;
            }

            let v1 = f32::from(data[src + column]) * self.dct[table][column];
            let v2 = f32::from(data[src + 8 + column]) * self.dct[table][8 + column];
            let v3 = f32::from(data[src + 16 + column]) * self.dct[table][16 + column];
            let v4 = f32::from(data[src + 24 + column]) * self.dct[table][24 + column];
            let v5 = f32::from(data[src + 32 + column]) * self.dct[table][32 + column];
            let v6 = f32::from(data[src + 40 + column]) * self.dct[table][40 + column];
            let v7 = f32::from(data[src + 48 + column]) * self.dct[table][48 + column];
            let v8 = f32::from(data[src + 56 + column]) * self.dct[table][56 + column];

            let v10 = v1 + v5;
            let v11 = v1 - v5;
            let v12 = v3 + v7;
            let v13 = (v3 - v7) * SQRT_2 - v12;
            let v1 = v10 + v12;
            let v7 = v10 - v12;
            let v3 = v11 + v13;
            let v5 = v11 - v13;
            let v14 = v2 + v8;
            let v15 = v2 - v8;
            let v16 = v6 + v4;
            let v17 = v6 - v4;
            let v8 = v14 + v16;
            let v11 = (v14 - v16) * SQRT_2;
            let v9 = (v17 + v15) * 1.847_759;
            let v10 = 1.082_392_2 * v15 - v9;
            let v13 = -2.613_126 * v17 + v9;
            let v6 = v13 - v8;
            let v4 = v11 - v6;
            let v2 = v10 + v4;

            tmp[0][column] = v1 + v8;
            tmp[1][column] = v3 + v6;
            tmp[2][column] = v5 + v4;
            tmp[3][column] = v7 - v2;
            tmp[4][column] = v7 + v2;
            tmp[5][column] = v5 - v4;
            tmp[6][column] = v3 - v6;
            tmp[7][column] = v1 - v8;
        }

        let mut dst = 0usize;
        for row in tmp {
            let v10 = row[0] + row[4];
            let v11 = row[0] - row[4];
            let v12 = row[2] + row[6];
            let v13 = SQRT_2 * (row[2] - row[6]) - v12;
            let v1 = v10 + v12;
            let v7 = v10 - v12;
            let v3 = v11 + v13;
            let v5 = v11 - v13;
            let v8 = row[1] + row[7] + row[5] + row[3];
            let v11 = (row[1] + row[7] - row[5] - row[3]) * SQRT_2;
            let v9 = (row[5] - row[3] + row[1] - row[7]) * 1.847_759;
            let v10 = v9 - (row[1] - row[7]) * 1.082_392_2;
            let v13 = v9 - (row[5] - row[3]) * 2.613_126;
            let v6 = v13 - v8;
            let v4 = v11 - v6;
            let v2 = v10 - v4;

            ycbcr[dst][channel] = float_to_short(v1 + v8);
            dst += 1;
            ycbcr[dst][channel] = float_to_short(v3 + v6);
            dst += 1;
            ycbcr[dst][channel] = float_to_short(v5 + v4);
            dst += 1;
            ycbcr[dst][channel] = float_to_short(v7 + v2);
            dst += 1;
            ycbcr[dst][channel] = float_to_short(v7 - v2);
            dst += 1;
            ycbcr[dst][channel] = float_to_short(v5 - v4);
            dst += 1;
            ycbcr[dst][channel] = float_to_short(v3 - v6);
            dst += 1;
            ycbcr[dst][channel] = float_to_short(v1 - v8);
            dst += 1;
        }
    }

    fn tree1(&self) -> Result<&WeightedHuffmanTree> {
        self.tree1
            .as_ref()
            .ok_or_else(|| SakuraError::InvalidImage("missing v2 DC Huffman tree".to_owned()))
    }

    fn tree2(&self) -> Result<&WeightedHuffmanTree> {
        self.tree2
            .as_ref()
            .ok_or_else(|| SakuraError::InvalidImage("missing v2 AC Huffman tree".to_owned()))
    }
}

fn unpack_alpha(input: &[u8], output: &mut [u8], width: usize) -> Result<bool> {
    if input.len() < 4 || read_u32_le(input, 0)? != 1 {
        return Ok(false);
    }
    let mut offset = 4usize;
    let mut dst = 3isize;
    let mut control = 2u32;
    while (dst as usize) < output.len() {
        control >>= 1;
        if control == 1 {
            let byte = *input.get(offset).ok_or_else(|| {
                SakuraError::InvalidImage("truncated v2 alpha control stream".to_owned())
            })?;
            offset += 1;
            control = u32::from(byte) | 0x100;
        }

        if control & 1 != 0 {
            let value = read_u16_le(input, offset)?;
            offset += 2;
            let mut x = i32::from(value & 0x3f);
            if x > 0x1f {
                x |= !0x3f;
            }
            let mut y = i32::from((value >> 6) & 7);
            if y != 0 {
                y |= !7;
            }
            let count = usize::from((value >> 9) & 0x7f) + 3;
            let mut src = dst + ((x + y * width as i32) * 4) as isize;
            if src < 0 || src >= dst {
                return Ok(false);
            }
            for _ in 0..count {
                output[dst as usize] = output[src as usize];
                src += 4;
                dst += 4;
            }
        } else {
            output[dst as usize] = *input.get(offset).ok_or_else(|| {
                SakuraError::InvalidImage("truncated v2 alpha literal stream".to_owned())
            })?;
            offset += 1;
            dst += 4;
        }
    }
    Ok(true)
}

fn read_signed_bits(reader: &mut MsbBitReader<'_>, count: u8) -> Result<i32> {
    if count == 0 {
        return Ok(0);
    }
    let mut value = reader.read_bits(count)? as i32;
    if value >> (count - 1) == 0 {
        value |= (-1i32) << count;
        value += 1;
    }
    Ok(value)
}

fn crop_aligned_output(
    input: Vec<u8>,
    width: usize,
    height: usize,
    aligned_width: usize,
) -> Result<Vec<u8>> {
    let src_stride = aligned_width
        .checked_mul(4)
        .ok_or_else(|| SakuraError::InvalidImage("v2 source stride overflows".to_owned()))?;
    let dst_stride = width
        .checked_mul(4)
        .ok_or_else(|| SakuraError::InvalidImage("v2 destination stride overflows".to_owned()))?;
    if width == aligned_width {
        let expected = dst_stride
            .checked_mul(height)
            .ok_or_else(|| SakuraError::InvalidImage("v2 output length overflows".to_owned()))?;
        return input.get(..expected).map(Vec::from).ok_or_else(|| {
            SakuraError::InvalidImage("v2 output is shorter than declared dimensions".to_owned())
        });
    }
    let mut out = vec![
        0u8;
        dst_stride.checked_mul(height).ok_or_else(|| {
            SakuraError::InvalidImage("v2 cropped output length overflows".to_owned())
        })?
    ];
    for y in 0..height {
        let src = y
            .checked_mul(src_stride)
            .ok_or_else(|| SakuraError::InvalidImage("v2 source row overflows".to_owned()))?;
        let dst = y
            .checked_mul(dst_stride)
            .ok_or_else(|| SakuraError::InvalidImage("v2 destination row overflows".to_owned()))?;
        let row = input.get(src..src + dst_stride).ok_or_else(|| {
            SakuraError::InvalidImage("v2 source row is shorter than expected".to_owned())
        })?;
        out[dst..dst + dst_stride].copy_from_slice(row);
    }
    Ok(out)
}

fn checked_offset(offset: i32, extra: usize, len: usize) -> Result<usize> {
    let value = i64::from(offset)
        .checked_add(extra as i64)
        .ok_or_else(|| SakuraError::InvalidImage("v2 stream offset overflows".to_owned()))?;
    if value < 0 || value as usize > len {
        return Err(SakuraError::InvalidImage(
            "v2 stream offset points past data".to_owned(),
        ));
    }
    Ok(value as usize)
}

fn read_i32_le(data: &[u8], offset: usize) -> Result<i32> {
    let bytes = read_exact(data, offset, 4)?;
    Ok(i32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
}

fn read_u32_le(data: &[u8], offset: usize) -> Result<u32> {
    let bytes = read_exact(data, offset, 4)?;
    Ok(u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
}

fn read_u16_le(data: &[u8], offset: usize) -> Result<u16> {
    let bytes = read_exact(data, offset, 2)?;
    Ok(u16::from_le_bytes([bytes[0], bytes[1]]))
}

fn float_to_short(value: f32) -> i16 {
    let value = 0x80 + ((value as i32) >> 3);
    if value <= 0 {
        0
    } else if value <= 0xff {
        value as i16
    } else if value < 0x180 {
        0xff
    } else {
        0
    }
}

fn float_to_byte(value: f32) -> u8 {
    if value >= 255.0 {
        255
    } else if value <= 0.0 {
        0
    } else {
        value as u8
    }
}

fn align8(value: usize) -> usize {
    (value + 7) & !7
}

const BLOCK_FILL_ORDER: [u8; 64] = [
    0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20,
    13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59,
    52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
];

#[rustfmt::skip]
#[allow(clippy::excessive_precision)]
const DCT_TABLE: [f32; 64] = [
    1.00000000, 1.38703990, 1.30656302, 1.17587554, 1.00000000, 0.78569496, 0.54119611, 0.27589938,
    1.38703990, 1.92387950, 1.81225491, 1.63098633, 1.38703990, 1.08979023, 0.75066054, 0.38268343,
    1.30656302, 1.81225491, 1.70710683, 1.53635550, 1.30656302, 1.02655995, 0.70710677, 0.36047992,
    1.17587554, 1.63098633, 1.53635550, 1.38268340, 1.17587554, 0.92387950, 0.63637930, 0.32442334,
    1.00000000, 1.38703990, 1.30656302, 1.17587554, 1.00000000, 0.78569496, 0.54119611, 0.27589938,
    0.78569496, 1.08979023, 1.02655995, 0.92387950, 0.78569496, 0.61731654, 0.42521504, 0.21677275,
    0.54119611, 0.75066054, 0.70710677, 0.63637930, 0.54119611, 0.42521504, 0.29289323, 0.14931567,
    0.27589938, 0.38268343, 0.36047992, 0.32442334, 0.27589938, 0.21677275, 0.14931567, 0.07612047,
];

const SQRT_2: f32 = std::f32::consts::SQRT_2;
