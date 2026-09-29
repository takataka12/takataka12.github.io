#!/usr/bin/env python3
from __future__ import annotations

import json
import math
import re
import subprocess
import tempfile
from pathlib import Path
from typing import Any


STYLE_PARAMS = {
    "natural": {
        "hpf": 75, "body_db": -0.5, "presence_db": 1.0,
        "ratio": 2.0, "threshold": 0.16, "attack": 18, "release": 180,
        "makeup": 1.25, "target_offset": -1.0, "echo": None,
    },
    "modern": {
        "hpf": 85, "body_db": -1.0, "presence_db": 2.0,
        "ratio": 3.0, "threshold": 0.13, "attack": 12, "release": 140,
        "makeup": 1.5, "target_offset": 0.0, "echo": (55, 0.055),
    },
    "rock": {
        "hpf": 80, "body_db": -0.8, "presence_db": 2.7,
        "ratio": 4.0, "threshold": 0.11, "attack": 8, "release": 120,
        "makeup": 1.7, "target_offset": 1.0, "echo": (70, 0.07),
    },
    "loud": {
        "hpf": 90, "body_db": -1.4, "presence_db": 3.2,
        "ratio": 5.0, "threshold": 0.09, "attack": 6, "release": 105,
        "makeup": 1.9, "target_offset": 1.5, "echo": (60, 0.08),
    },
}


def _run(cmd: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)


def _safe_float(v: Any, fallback: float) -> float:
    try:
        f = float(v)
        return f if math.isfinite(f) else fallback
    except Exception:
        return fallback


def probe_audio(path: Path) -> dict[str, Any]:
    p = _run([
        "ffprobe", "-v", "error", "-select_streams", "a:0",
        "-show_entries", "stream=codec_name,sample_rate,channels:format=duration",
        "-of", "json", str(path),
    ])
    data = json.loads(p.stdout or "{}")
    streams = data.get("streams") or []
    if not streams:
        raise RuntimeError("no_audio_stream")
    s = streams[0]
    sr = int(s.get("sample_rate") or 0)
    if sr <= 0:
        raise RuntimeError("invalid_sample_rate")
    return {
        "codec_name": str(s.get("codec_name") or ""),
        "sample_rate": sr,
        "channels": int(s.get("channels") or 0),
        "duration_seconds": float((data.get("format") or {}).get("duration") or 0.0),
    }


def analyze_loudness(path: Path) -> dict[str, float]:
    p = subprocess.run([
        "ffmpeg", "-hide_banner", "-loglevel", "info", "-i", str(path),
        "-af", "loudnorm=I=-18:TP=-1:LRA=11:print_format=json",
        "-f", "null", "-",
    ], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=False)
    text = p.stderr or ""
    matches = re.findall(r'\{\s*"input_i".*?\}', text, re.S)
    if not matches:
        return {"lufs": -18.0, "true_peak": -3.0, "lra": 0.0}
    try:
        d = json.loads(matches[-1])
    except Exception:
        return {"lufs": -18.0, "true_peak": -3.0, "lra": 0.0}
    return {
        "lufs": _safe_float(d.get("input_i"), -18.0),
        "true_peak": _safe_float(d.get("input_tp"), -3.0),
        "lra": _safe_float(d.get("input_lra"), 0.0),
    }


def instrumental_gain_db(inst_lufs: float) -> float:
    if inst_lufs > -7.0:
        return -2.5
    if inst_lufs > -9.0:
        return -1.5
    if inst_lufs > -11.0:
        return -0.5
    return 0.0


def vocal_target_lufs(inst_lufs: float, style: str) -> float:
    p = STYLE_PARAMS[style]
    target = inst_lufs - 8.0 + float(p["target_offset"])
    return max(-20.0, min(-13.0, target))


def vocal_filter(
    style: str,
    target_lufs: float,
    sample_rate: int,
    vocal_gain_db: float = 0.0,
    reverb_amount: int = 12,
    eq_body_db: float = 0.0,
    eq_presence_db: float = 0.0,
    eq_air_db: float = 0.0,
) -> str:
    p = STYLE_PARAMS[style]
    body = max(-8.0, min(8.0, float(p["body_db"]) + float(eq_body_db)))
    presence = max(-8.0, min(8.0, float(p["presence_db"]) + float(eq_presence_db)))
    air = max(-4.0, min(4.0, float(eq_air_db)))
    gain = max(-6.0, min(6.0, float(vocal_gain_db)))
    reverb = max(0, min(40, int(reverb_amount)))

    parts = [
        f"aresample={sample_rate}:resampler=soxr:precision=28",
        f"highpass=f={p['hpf']}",
        f"equalizer=f=220:t=q:w=1.1:g={body:.2f}",
        f"equalizer=f=3200:t=q:w=1.0:g={presence:.2f}",
        f"equalizer=f=10000:t=q:w=0.7:g={air:.2f}",
        "deesser=i=0.28:m=0.45:f=0.55:s=o",
        (
            "acompressor="
            f"threshold={p['threshold']}:ratio={p['ratio']}:"
            f"attack={p['attack']}:release={p['release']}:"
            f"makeup={p['makeup']}:knee=2.828:link=average:detection=rms"
        ),
        f"loudnorm=I={target_lufs:.2f}:TP=-3.0:LRA=7",
    ]

    if reverb > 0:
        wet = reverb / 40.0
        decays = [
            0.18 * wet,
            0.13 * wet,
            0.09 * wet,
            0.06 * wet,
        ]
        parts.append(
            "aecho=0.82:0.90:38|73|119|171:"
            + "|".join(f"{d:.4f}" for d in decays)
        )

    if abs(gain) >= 0.01:
        parts.append(f"volume={gain:.2f}dB")
    return ",".join(parts)


def mix_files(
    vocal: Path,
    instrumental: Path,
    mix_out: Path,
    wet_out: Path,
    style: str,
    vocal_gain_db: float = 0.0,
    reverb_amount: int = 12,
    eq_body_db: float = 0.0,
    eq_presence_db: float = 0.0,
    eq_air_db: float = 0.0,
) -> dict[str, Any]:
    style = style if style in STYLE_PARAMS else "modern"
    vp = probe_audio(vocal)
    ip = probe_audio(instrumental)
    vlevel = analyze_loudness(vocal)
    ilevel = analyze_loudness(instrumental)

    sample_rate = ip["sample_rate"]
    if sample_rate not in (44100, 48000, 88200, 96000):
        sample_rate = 48000

    target = vocal_target_lufs(ilevel["lufs"], style)
    inst_gain = instrumental_gain_db(ilevel["lufs"])
    vf = vocal_filter(
        style, target, sample_rate,
        vocal_gain_db=vocal_gain_db,
        reverb_amount=reverb_amount,
        eq_body_db=eq_body_db,
        eq_presence_db=eq_presence_db,
        eq_air_db=eq_air_db,
    )

    graph = (
        f"[0:a]{vf}[vproc];"
        "[vproc]asplit=2[vwet][vmix];"
        f"[1:a]aresample={sample_rate}:resampler=soxr:precision=28,volume={inst_gain:.2f}dB[inst];"
        "[inst][vmix]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,"
        "alimiter=limit=0.794328:attack=5:release=80[mix]"
    )

    cmd = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-i", str(vocal), "-i", str(instrumental),
        "-filter_complex", graph,
        "-map", "[mix]", "-ar", str(sample_rate), "-c:a", "pcm_s24le", str(mix_out),
        "-map", "[vwet]", "-ar", str(sample_rate), "-c:a", "pcm_s24le", str(wet_out),
    ]
    try:
        _run(cmd)
    except subprocess.CalledProcessError as exc:
        raise RuntimeError("ffmpeg_mix_failed:" + (exc.stderr or "")[-1800:]) from exc

    mixed = analyze_loudness(mix_out)
    mp = probe_audio(mix_out)
    wp = probe_audio(wet_out)
    return {
        "engine": "ZASU MIX v0.2",
        "style": style,
        "vocal_input_lufs": round(vlevel["lufs"], 2),
        "instrumental_lufs": round(ilevel["lufs"], 2),
        "vocal_target_lufs": round(target, 2),
        "instrumental_gain_db": round(inst_gain, 2),
        "vocal_gain_db": round(float(vocal_gain_db), 2),
        "reverb_amount": int(reverb_amount),
        "eq_body_db": round(float(eq_body_db), 2),
        "eq_presence_db": round(float(eq_presence_db), 2),
        "eq_air_db": round(float(eq_air_db), 2),
        "output_lufs": round(mixed["lufs"], 2),
        "output_true_peak": round(mixed["true_peak"], 2),
        "output_sample_rate": mp["sample_rate"],
        "output_channels": mp["channels"],
        "duration_seconds": mp["duration_seconds"],
        "wet_vocal_duration_seconds": wp["duration_seconds"],
        "processing": [
            "SoXR HQ sample-rate alignment",
            "high-pass filter",
            "adaptive tonal EQ",
            "de-esser",
            "style compressor",
            "adaptive vocal loudness placement",
            "manual vocal gain",
            "adjustable ambience/reverb",
            "3-band vocal tone offsets",
            "instrumental-safe balance",
            "-2 dBFS mix safety limiter",
        ],
        "note": "Prototype auto-mix. No pitch correction or timing correction.",
    }


def self_test() -> None:
    with tempfile.TemporaryDirectory(prefix="zasu-mix-selftest-") as td:
        root = Path(td)
        vocal = root / "vocal.wav"
        inst = root / "inst.wav"
        _run([
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-f", "lavfi", "-i", "sine=frequency=420:duration=1.2",
            "-filter:a", "volume=-12dB",
            "-ar", "48000", "-c:a", "pcm_s24le", str(vocal),
        ])
        _run([
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-f", "lavfi", "-i", "sine=frequency=110:duration=1.5",
            "-filter:a", "volume=-8dB",
            "-ar", "48000", "-c:a", "pcm_s24le", str(inst),
        ])
        for style in STYLE_PARAMS:
            mix_out = root / f"{style}_mix.wav"
            wet_out = root / f"{style}_wet.wav"
            report = mix_files(
                vocal, inst, mix_out, wet_out, style,
                vocal_gain_db=2.0 if style == "modern" else (2.5 if style == "loud" else 0.0),
                reverb_amount=14 if style == "modern" else 10,
                eq_body_db=0.0,
                eq_presence_db=0.0,
                eq_air_db=0.0,
            )
            if not mix_out.exists() or mix_out.stat().st_size <= 0:
                raise RuntimeError(f"self_test_mix_missing:{style}")
            if not wet_out.exists() or wet_out.stat().st_size <= 0:
                raise RuntimeError(f"self_test_wet_missing:{style}")
            if report["output_sample_rate"] != 48000:
                raise RuntimeError(f"self_test_sample_rate:{style}")
        print("ZASU MIX self-test ready", flush=True)


if __name__ == "__main__":
    self_test()
