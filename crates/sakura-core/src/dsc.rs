use crate::bytes::{read_exact, read_u32_le};
use crate::error::{Result, SakuraError};
use std::collections::VecDeque;

pub const DSC_MAGIC: &[u8; 16] = b"DSC FORMAT 1.00\0";
const DSC_TREE_LEN: usize = 512;
const DSC_HEADER_LEN: usize = 32;

#[derive(Debug, Clone, PartialEq, Eq)]
enum Node {
    Leaf(u16),
    Branch {
        left: Option<Box<Node>>,
        right: Option<Box<Node>>,
    },
}

pub fn decompress_dsc(data: &[u8]) -> Result<Vec<u8>> {
    if data.len() < DSC_HEADER_LEN + DSC_TREE_LEN {
        return Err(SakuraError::UnexpectedEof {
            offset: 0,
            needed: DSC_HEADER_LEN + DSC_TREE_LEN,
            available: data.len(),
        });
    }
    if read_exact(data, 0, DSC_MAGIC.len())? != DSC_MAGIC {
        return Err(SakuraError::InvalidMagic {
            expected: "DSC FORMAT 1.00",
        });
    }

    let mut cipher = DscCipher::new(read_u32_le(data, 16)?);
    let decompressed_size = read_u32_le(data, 20)? as usize;
    let mut leaves_by_depth = vec![VecDeque::new(); 256];
    for symbol in 0..DSC_TREE_LEN {
        let depth = cipher.decrypt_next(data[DSC_HEADER_LEN + symbol]);
        if depth != 0 {
            let depth_index = depth as usize;
            if depth_index >= leaves_by_depth.len() {
                return Err(SakuraError::InvalidDsc(format!(
                    "Huffman depth {depth_index} exceeds supported range"
                )));
            }
            leaves_by_depth[depth_index].push_back(symbol as u16);
        }
    }

    let max_depth = leaves_by_depth
        .iter()
        .rposition(|leaves| !leaves.is_empty())
        .ok_or_else(|| SakuraError::InvalidDsc("empty Huffman tree".to_owned()))?;
    let tree = build_tree(&mut leaves_by_depth, max_depth)
        .ok_or_else(|| SakuraError::InvalidDsc("incomplete Huffman tree".to_owned()))?;
    let mut reader = BitReader::new(&data[DSC_HEADER_LEN + DSC_TREE_LEN..]);
    let mut output = Vec::with_capacity(decompressed_size);

    while output.len() < decompressed_size {
        let symbol = decode_symbol(&tree, &mut reader)?;
        if symbol < 0x100 {
            output.push(symbol as u8);
            continue;
        }

        let count = ((symbol & 0xff) + 2) as usize;
        let offset = reader.read_bits(12)? as usize + 2;
        if offset > output.len() {
            return Err(SakuraError::InvalidDsc(format!(
                "back-reference offset {offset} exceeds output size {}",
                output.len()
            )));
        }
        if output.len() + count > decompressed_size {
            return Err(SakuraError::InvalidDsc(format!(
                "back-reference length {count} exceeds declared output size"
            )));
        }
        for _ in 0..count {
            let value = output[output.len() - offset];
            output.push(value);
        }
    }

    Ok(output)
}

fn build_tree(leaves_by_depth: &mut [VecDeque<u16>], max_depth: usize) -> Option<Node> {
    build_branch(leaves_by_depth, max_depth, 0)
}

fn build_branch(
    leaves_by_depth: &mut [VecDeque<u16>],
    max_depth: usize,
    depth: usize,
) -> Option<Node> {
    if leaves_by_depth[max_depth].is_empty() {
        return None;
    }
    let left = build_child(leaves_by_depth, max_depth, depth + 1).map(Box::new);
    let right = build_child(leaves_by_depth, max_depth, depth + 1).map(Box::new);
    Some(Node::Branch { left, right })
}

fn build_child(
    leaves_by_depth: &mut [VecDeque<u16>],
    max_depth: usize,
    depth: usize,
) -> Option<Node> {
    if leaves_by_depth[max_depth].is_empty() {
        return None;
    }
    if let Some(symbol) = leaves_by_depth.get_mut(depth).and_then(VecDeque::pop_front) {
        return Some(Node::Leaf(symbol));
    }
    build_branch(leaves_by_depth, max_depth, depth)
}

fn decode_symbol(node: &Node, reader: &mut BitReader<'_>) -> Result<u16> {
    let mut current = node;
    loop {
        match current {
            Node::Leaf(value) => return Ok(*value),
            Node::Branch { left, right } => {
                let bit = reader.read_bits(1)?;
                current = match (bit, left.as_deref(), right.as_deref()) {
                    (0, Some(next), _) => next,
                    (1, _, Some(next)) => next,
                    _ => {
                        return Err(SakuraError::InvalidDsc(
                            "bitstream entered a missing Huffman branch".to_owned(),
                        ))
                    }
                };
            }
        }
    }
}

#[derive(Debug, Clone)]
struct DscCipher {
    hash: u32,
}

impl DscCipher {
    fn new(hash: u32) -> Self {
        Self { hash }
    }

    fn decrypt_next(&mut self, encrypted: u8) -> u8 {
        let (next_hash, eax) = next_hash_and_mask(self.hash);
        self.hash = next_hash;
        encrypted.wrapping_sub(eax as u8)
    }
}

fn next_hash_and_mask(hash: u32) -> (u32, u32) {
    let edx = 20_021u32.wrapping_mul(hash & 0xffff);
    let eax = 20_021u32
        .wrapping_mul((hash >> 16) & 0xffff)
        .wrapping_add(346u32.wrapping_mul(hash))
        .wrapping_add((edx >> 16) & 0xffff);
    let next = ((eax & 0xffff) << 16)
        .wrapping_add(edx & 0xffff)
        .wrapping_add(1);
    (next, eax)
}

#[derive(Debug, Clone)]
struct BitReader<'a> {
    data: &'a [u8],
    byte_offset: usize,
    pending: u64,
    pending_bits: u8,
}

impl<'a> BitReader<'a> {
    fn new(data: &'a [u8]) -> Self {
        Self {
            data,
            byte_offset: 0,
            pending: 0,
            pending_bits: 0,
        }
    }

    fn read_bits(&mut self, count: u8) -> Result<u16> {
        while self.pending_bits < count {
            let next = *self.data.get(self.byte_offset).ok_or_else(|| {
                SakuraError::InvalidDsc("compressed bitstream ended early".to_owned())
            })?;
            self.byte_offset += 1;
            self.pending = (self.pending << 8) | u64::from(next);
            self.pending_bits += 8;
        }

        let shift = self.pending_bits - count;
        let mask = (1u64 << count) - 1;
        let value = ((self.pending >> shift) & mask) as u16;
        self.pending &= (1u64 << shift).saturating_sub(1);
        self.pending_bits = shift;
        Ok(value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decompresses_literals_from_synthetic_dsc() -> Result<()> {
        let fixture = build_literal_fixture(
            &[(u16::from(b'A'), 1), (u16::from(b'B'), 1)],
            &[0b0100_0000],
            2,
        );
        assert_eq!(decompress_dsc(&fixture)?, b"AB");
        Ok(())
    }

    #[test]
    fn rejects_invalid_back_reference() {
        let fixture = build_literal_fixture(&[(0x100, 1)], &[0], 1);
        let err = decompress_dsc(&fixture).err();
        assert!(matches!(err, Some(SakuraError::InvalidDsc(_))));
    }

    fn build_literal_fixture(
        symbol_depths: &[(u16, u8)],
        bitstream: &[u8],
        output_len: u32,
    ) -> Vec<u8> {
        let hash = 0x1234_5678u32;
        let mut depths = [0u8; DSC_TREE_LEN];
        for (symbol, depth) in symbol_depths {
            depths[*symbol as usize] = *depth;
        }

        let mut out = Vec::new();
        out.extend_from_slice(DSC_MAGIC);
        out.extend_from_slice(&hash.to_le_bytes());
        out.extend_from_slice(&output_len.to_le_bytes());
        out.extend_from_slice(&[0u8; 8]);

        let mut current_hash = hash;
        for depth in depths {
            let (next_hash, eax) = next_hash_and_mask(current_hash);
            current_hash = next_hash;
            out.push(depth.wrapping_add(eax as u8));
        }
        out.extend_from_slice(bitstream);
        out
    }
}
