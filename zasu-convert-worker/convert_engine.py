#!/usr/bin/env python3
from __future__ import annotations

import json
import subprocess
import tempfile
from pathlib import Path
from typing import Any


def _run(cmd: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)


def probe_audio(path: Path) -> dict[str, Any]:
    p = _run([
        "ffprobe", "-v", "error", "-select_streams", "a:0",
        "-show_entries",
        "stream=codec_name,sample_rate,channels,sample_fmt,bits_per_sample,bits_per_raw_sample:format=duration",
        "-of", "json", str(path),
    ])
    data = json.loads(p.stdout or "{}")
    streams = data.get("streams") or []
    if not streams:
        raise RuntimeError("no_audio_stream")
    s = streams[0]
    sample_rate = int(s.get("sample_rate") or 0)
    if sample_rate <= 0:
        raise RuntimeError("invalid_sample_rate")
    bits = int(s.get("bits_per_raw_sample") or s.get("bits_per_sample") or 0)
    if bits <= 0:
        fmt = str(s.get("sample_fmt") or "")
        if "16" in fmt:
            bits = 16
        elif "24" in fmt or "32" in fmt or "flt" in fmt or "dbl" in fmt:
            bits = 24
        else:
            bits = 24
    duration = float((data.get("format") or {}).get("duration") or 0.0)
    return {
        "codec_name": s.get("codec_name"),
        "sample_rate": sample_rate,
        "channels": int(s.get("channels") or 0),
        "sample_fmt": s.get("sample_fmt"),
        "bit_depth": 16 if bits <= 16 else 24,
        "duration_seconds": duration,
    }


def output_suffix(fmt: str) -> str:
    return {"wav": ".wav", "flac": ".flac", "aiff": ".aiff", "alac": ".m4a"}[fmt]


def _codec_args(fmt: str, bit_depth: int) -> list[str]:
    if fmt == "wav":
        return ["-c:a", "pcm_s16le" if bit_depth == 16 else "pcm_s24le", "-f", "wav"]
    if fmt == "aiff":
        return ["-c:a", "pcm_s16be" if bit_depth == 16 else "pcm_s24be", "-f", "aiff"]
    if fmt == "flac":
        return ["-c:a", "flac", "-compression_level", "8", "-sample_fmt", "s16" if bit_depth == 16 else "s32"]
    if fmt == "alac":
        return ["-c:a", "alac", "-sample_fmt", "s16p" if bit_depth == 16 else "s32p", "-f", "ipod"]
    raise RuntimeError("unsupported_output_format")


def convert_file(
    source: Path,
    dest: Path,
    output_format: str,
    sample_rate: int | None,
    bit_depth: int | None,
    dither: bool,
) -> dict[str, Any]:
    before = probe_audio(source)
    out_rate = int(sample_rate or before["sample_rate"])
    out_bits = int(bit_depth or before["bit_depth"])
    out_bits = 16 if out_bits <= 16 else 24

    cmd = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-i", str(source),
        "-map", "0:a:0",
        "-vn",
        "-map_metadata", "0",
    ]

    needs_resample = out_rate != before["sample_rate"]
    needs_dither = bool(dither and out_bits == 16 and before["bit_depth"] > 16)
    if needs_resample or needs_dither:
        opts = [
            f"osr={out_rate}",
            "resampler=soxr",
            "precision=28",
            "cheby=1",
        ]
        if out_bits == 16:
            opts.append("osf=s16")
            if needs_dither:
                opts.append("dither_method=triangular")
        cmd += ["-af", "aresample=" + ":".join(opts)]

    cmd += _codec_args(output_format, out_bits)
    cmd += [str(dest)]

    try:
        _run(cmd)
    except subprocess.CalledProcessError as exc:
        detail = (exc.stderr or "")[-1600:]
        raise RuntimeError(f"ffmpeg_convert_failed:{detail}") from exc

    after = probe_audio(dest)
    return {
        "input_codec": before["codec_name"],
        "input_sample_rate": before["sample_rate"],
        "input_bit_depth": before["bit_depth"],
        "channels": before["channels"],
        "duration_seconds": after["duration_seconds"] or before["duration_seconds"],
        "output_format": output_format,
        "output_codec": after["codec_name"],
        "output_sample_rate": after["sample_rate"],
        "output_bit_depth": out_bits,
        "dither_applied": needs_dither,
        "resampler": "SoXR HQ precision=28" if needs_resample or needs_dither else "not required",
        "audio_processing": "format/sample-rate/bit-depth conversion only; no EQ, compression, limiting, or loudness normalization",
    }


def self_test() -> None:
    with tempfile.TemporaryDirectory(prefix="zasu-convert-test-") as td:
        root = Path(td)
        src = root / "source.wav"
        _run([
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-f", "lavfi", "-i", "sine=frequency=1000:duration=0.25",
            "-ar", "48000", "-c:a", "pcm_s24le", str(src),
        ])
        cases = [
            ("wav", 44100, 16, True),
            ("flac", 48000, 24, False),
            ("aiff", 44100, 24, False),
            ("alac", 48000, 24, False),
        ]
        for fmt, sr, bits, dither in cases:
            dst = root / ("out" + output_suffix(fmt))
            report = convert_file(src, dst, fmt, sr, bits, dither)
            if not dst.exists() or dst.stat().st_size <= 0:
                raise RuntimeError(f"self_test_output_missing:{fmt}")
            if report["output_sample_rate"] != sr:
                raise RuntimeError(f"self_test_sample_rate:{fmt}")
        print("ZASU CONVERT self-test ready", flush=True)


if __name__ == "__main__":
    self_test()
