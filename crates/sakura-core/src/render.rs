use crate::error::{Result, SakuraError};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RgbaSurface {
    width: u32,
    height: u32,
    stride: usize,
    pixels: Vec<u8>,
}

impl RgbaSurface {
    pub fn new(width: u32, height: u32) -> Result<Self> {
        let stride = width
            .checked_mul(4)
            .ok_or_else(|| SakuraError::InvalidImage("surface stride overflows".to_owned()))?
            as usize;
        let len = stride
            .checked_mul(height as usize)
            .ok_or_else(|| SakuraError::InvalidImage("surface length overflows".to_owned()))?;
        Ok(Self {
            width,
            height,
            stride,
            pixels: vec![0; len],
        })
    }

    pub fn from_rgba(width: u32, height: u32, pixels: Vec<u8>) -> Result<Self> {
        let stride = width
            .checked_mul(4)
            .ok_or_else(|| SakuraError::InvalidImage("surface stride overflows".to_owned()))?
            as usize;
        let expected = stride
            .checked_mul(height as usize)
            .ok_or_else(|| SakuraError::InvalidImage("surface length overflows".to_owned()))?;
        if pixels.len() != expected {
            return Err(SakuraError::InvalidImage(
                "RGBA surface length does not match dimensions".to_owned(),
            ));
        }
        Ok(Self {
            width,
            height,
            stride,
            pixels,
        })
    }

    pub fn width(&self) -> u32 {
        self.width
    }

    pub fn height(&self) -> u32 {
        self.height
    }

    pub fn stride(&self) -> usize {
        self.stride
    }

    pub fn pixels(&self) -> &[u8] {
        &self.pixels
    }

    pub fn pixels_mut(&mut self) -> &mut [u8] {
        &mut self.pixels
    }

    pub fn clear(&mut self, rgba: [u8; 4]) {
        for pixel in self.pixels.chunks_exact_mut(4) {
            pixel.copy_from_slice(&rgba);
        }
    }

    pub fn blit_over(&mut self, source: &RgbaSurface, x: i32, y: i32, opacity: u8) {
        if opacity == 0 {
            return;
        }

        let dst_x0 = x.max(0) as usize;
        let dst_y0 = y.max(0) as usize;
        let src_x0 = x.saturating_neg().max(0) as usize;
        let src_y0 = y.saturating_neg().max(0) as usize;
        let width = (source.width as usize)
            .saturating_sub(src_x0)
            .min((self.width as usize).saturating_sub(dst_x0));
        let height = (source.height as usize)
            .saturating_sub(src_y0)
            .min((self.height as usize).saturating_sub(dst_y0));
        if width == 0 || height == 0 {
            return;
        }

        for row in 0..height {
            let src_row = (src_y0 + row) * source.stride + src_x0 * 4;
            let dst_row = (dst_y0 + row) * self.stride + dst_x0 * 4;
            for column in 0..width {
                let src = src_row + column * 4;
                let dst = dst_row + column * 4;
                blend_pixel(
                    &source.pixels[src..src + 4],
                    &mut self.pixels[dst..dst + 4],
                    opacity,
                );
            }
        }
    }
}

fn blend_pixel(source: &[u8], dest: &mut [u8], opacity: u8) {
    let src_alpha = scale_alpha(source[3], opacity);
    if src_alpha == 0 {
        return;
    }
    if src_alpha == 255 {
        dest.copy_from_slice(&[source[0], source[1], source[2], 255]);
        return;
    }

    let dst_alpha = u32::from(dest[3]);
    let inv_alpha = 255 - u32::from(src_alpha);
    let out_alpha = u32::from(src_alpha) + div255(dst_alpha * inv_alpha);
    if out_alpha == 0 {
        dest.fill(0);
        return;
    }

    for channel in 0..3 {
        let src = u32::from(source[channel]) * u32::from(src_alpha);
        let dst = div255(u32::from(dest[channel]) * dst_alpha * inv_alpha);
        dest[channel] = ((src + dst) / out_alpha) as u8;
    }
    dest[3] = out_alpha as u8;
}

fn scale_alpha(alpha: u8, opacity: u8) -> u8 {
    div255(u32::from(alpha) * u32::from(opacity)) as u8
}

fn div255(value: u32) -> u32 {
    (value + 127) / 255
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blits_opaque_source() -> Result<()> {
        let mut dest = RgbaSurface::new(2, 1)?;
        dest.clear([1, 2, 3, 255]);
        let source = RgbaSurface::from_rgba(1, 1, vec![10, 20, 30, 255])?;

        dest.blit_over(&source, 1, 0, 255);

        assert_eq!(dest.pixels(), &[1, 2, 3, 255, 10, 20, 30, 255]);
        Ok(())
    }

    #[test]
    fn blends_half_alpha_over_opaque_dest() -> Result<()> {
        let mut dest = RgbaSurface::from_rgba(1, 1, vec![0, 0, 255, 255])?;
        let source = RgbaSurface::from_rgba(1, 1, vec![255, 0, 0, 128])?;

        dest.blit_over(&source, 0, 0, 255);

        assert_eq!(dest.pixels(), &[128, 0, 127, 255]);
        Ok(())
    }

    #[test]
    fn clips_negative_offset() -> Result<()> {
        let mut dest = RgbaSurface::new(2, 2)?;
        let source = RgbaSurface::from_rgba(
            2,
            2,
            vec![1, 0, 0, 255, 2, 0, 0, 255, 3, 0, 0, 255, 4, 0, 0, 255],
        )?;

        dest.blit_over(&source, -1, -1, 255);

        assert_eq!(
            dest.pixels(),
            &[4, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
        );
        Ok(())
    }

    #[test]
    fn applies_global_opacity() -> Result<()> {
        let mut dest = RgbaSurface::from_rgba(1, 1, vec![0, 0, 255, 255])?;
        let source = RgbaSurface::from_rgba(1, 1, vec![255, 0, 0, 255])?;

        dest.blit_over(&source, 0, 0, 128);

        assert_eq!(dest.pixels(), &[128, 0, 127, 255]);
        Ok(())
    }
}
