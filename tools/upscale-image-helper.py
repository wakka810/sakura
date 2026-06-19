#!/usr/bin/env python3
"""Small image codec helper for the local Sakura upscaling server.

The server keeps generated assets in its own cache directory. Temporary files
passed to this helper are expected to live in tmpfs, usually /dev/shm.
"""

from __future__ import annotations

import argparse
import struct
from pathlib import Path

from PIL import Image


def read_packet(path: Path) -> tuple[int, int, int, bytes]:
    data = path.read_bytes()
    if len(data) < 16:
        raise ValueError("RGBA packet is too short")
    width, height, stride, byte_length = struct.unpack_from("<IIII", data, 0)
    if width <= 0 or height <= 0 or stride < width * 4:
        raise ValueError("invalid RGBA packet header")
    if 16 + byte_length != len(data):
        raise ValueError("invalid RGBA packet length")
    return width, height, stride, data[16:]


def write_packet(path: Path, image: Image.Image) -> None:
    rgba = image.convert("RGBA")
    width, height = rgba.size
    pixels = rgba.tobytes()
    header = struct.pack("<IIII", width, height, width * 4, len(pixels))
    path.write_bytes(header + pixels)


def packet_to_png(args: argparse.Namespace) -> None:
    width, height, stride, pixels = read_packet(Path(args.input))
    if stride == width * 4:
        image = Image.frombytes("RGBA", (width, height), pixels)
    else:
        rows = bytearray()
        row_length = width * 4
        for y in range(height):
            start = y * stride
            rows.extend(pixels[start : start + row_length])
        image = Image.frombytes("RGBA", (width, height), bytes(rows))
    image.convert("RGB").save(args.output, "PNG")


def png_to_packet(args: argparse.Namespace) -> None:
    image = Image.open(args.input)
    write_packet(Path(args.output), image)


def resize_packet(args: argparse.Namespace) -> None:
    width, height, _stride, pixels = read_packet(Path(args.input))
    image = Image.frombytes("RGBA", (width, height), pixels)
    scale = int(args.scale)
    if scale < 1:
        raise ValueError("scale must be positive")
    resample = Image.Resampling.NEAREST if args.resample == "nearest" else Image.Resampling.LANCZOS
    image = image.resize((width * scale, height * scale), resample)
    write_packet(Path(args.output), image)


def merge_rgb_with_alpha(args: argparse.Namespace) -> None:
    source_width, source_height, _stride, source_pixels = read_packet(Path(args.source))
    model_image = Image.open(args.model).convert("RGBA")
    source = Image.frombytes("RGBA", (source_width, source_height), source_pixels)
    alpha = source.getchannel("A")
    if alpha.size != model_image.size:
        alpha = alpha.resize(model_image.size, Image.Resampling.LANCZOS)
    merged = Image.merge("RGBA", (*model_image.convert("RGB").split(), alpha))
    write_packet(Path(args.output), merged)


def main() -> None:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)

    packet_to_png_parser = subparsers.add_parser("packet-to-png")
    packet_to_png_parser.add_argument("input")
    packet_to_png_parser.add_argument("output")
    packet_to_png_parser.set_defaults(func=packet_to_png)

    png_to_packet_parser = subparsers.add_parser("png-to-packet")
    png_to_packet_parser.add_argument("input")
    png_to_packet_parser.add_argument("output")
    png_to_packet_parser.set_defaults(func=png_to_packet)

    resize_packet_parser = subparsers.add_parser("resize-packet")
    resize_packet_parser.add_argument("input")
    resize_packet_parser.add_argument("output")
    resize_packet_parser.add_argument("--scale", required=True)
    resize_packet_parser.add_argument("--resample", choices=("lanczos", "nearest"), default="lanczos")
    resize_packet_parser.set_defaults(func=resize_packet)

    merge_parser = subparsers.add_parser("merge-rgb-with-alpha")
    merge_parser.add_argument("model")
    merge_parser.add_argument("source")
    merge_parser.add_argument("output")
    merge_parser.set_defaults(func=merge_rgb_with_alpha)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
