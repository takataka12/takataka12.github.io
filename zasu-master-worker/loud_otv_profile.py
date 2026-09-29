#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np
import punch_engine as p

PROFILE_ID = "loud_otv"
PROFILE_VERSION = "1.0"

# Features measured from the supplied REFERENCE12 master.
# The audio itself is not shipped with the service.
REFERENCE = {
    "integrated_lufs": -4.1776,
    "lra_lu": 2.0276,
    "sample_peak_dbfs": 0.0,
    "true_peak_dbtp": 1.0877,
    "rms_dbfs": -7.2215,
    "crest_db": 7.2215,
    "stereo_correlation": 0.6225,
    "side_mid_db": -6.3315,
    "band_ratios": {
        "sub_20_80": 0.467719,
        "body_120_300": 0.092109,
        "mid_500_1500": 0.181443,
        "presence_1500_4000": 0.209084,
        "attack_4000_8000": 0.040320,
        "air_10000_20000": 0.009326,
    },
}

NOMINAL_TARGET_LUFS = -4.18
SAFETY_FALLBACK_LUFS = -5.40
SAFE_TRUE_PEAK_DBTP = -0.80

_BASE_ADAPTIVE = p.adaptive_params


def _nudge_db(ref: float, cur: float, strength: float, low: float, high: float) -> float:
    raw = 10.0 * math.log10(max(ref, 1e-9) / max(cur, 1e-9)) * strength
    return float(np.clip(raw, low, high))


def loud_otv_params(a, c):
    params = dict(_BASE_ADAPTIVE(a, c))
    r = a["band_ratios"]
    ref = REFERENCE["band_ratios"]

    # Reference-guided, not reference-copying: use small spectral nudges only.
    # This keeps the profile useful across different mixes while preserving
    # the OTV reference's dense low-end / controlled-top character.
    nudges = {
        "low": _nudge_db(ref["sub_20_80"], r["sub_20_80"], 0.14, -0.90, 0.45),
        "body": _nudge_db(ref["body_120_300"], r["body_120_300"], 0.10, -0.50, 0.50),
        "presence": _nudge_db(ref["presence_1500_4000"], r["presence_1500_4000"], 0.12, -0.65, 0.65),
        "attack": _nudge_db(ref["attack_4000_8000"], r["attack_4000_8000"], 0.07, -0.30, 0.30),
        "air": _nudge_db(ref["air_10000_20000"], r["air_10000_20000"], 0.08, -0.45, 0.35),
    }

    params["low_shelf_80_db"] = float(np.clip(params["low_shelf_80_db"] + nudges["low"], -2.4, 0.45))
    params["body_190_db"] = float(np.clip(params["body_190_db"] + nudges["body"], -0.5, 1.0))
    params["presence_2200_db"] = float(np.clip(params["presence_2200_db"] + nudges["presence"], -1.8, 0.45))
    params["presence_5200_db"] = float(np.clip(params["presence_5200_db"] + nudges["attack"], -0.4, 0.55))
    params["air_shelf_12000_db"] = float(np.clip(params["air_shelf_12000_db"] + nudges["air"], -2.0, 0.35))

    # OTV is dense rather than transient-hyped. Preserve attacks, but do not
    # add the larger transient enhancement used by STANDARD.
    params["transient_strength"] = float(min(params["transient_strength"] * 0.52, 0.82))
    params["transient_max_db"] = float(min(params["transient_max_db"], 0.90))

    # Move narrow mixes gently toward the reference width. Never narrow a mix.
    sm = float(a.get("stereo", {}).get("side_mid_db", -120.0))
    if np.isfinite(sm) and sm < REFERENCE["side_mid_db"]:
        ref_width_gain = float(np.clip((REFERENCE["side_mid_db"] - sm) * 0.10, 0.0, 1.40))
        params["width_high_side_gain_db"] = float(max(params["width_high_side_gain_db"], ref_width_gain))

    params["profile_reference_nudges_db"] = nudges
    return params


def needs_safety_fallback(report: dict) -> bool:
    history = report.get("convergence_history") or [{}]
    limiter_gr = float(history[0].get("limiter_min_gain_db", 0.0) or 0.0)
    guard = float(report.get("final_true_peak_guard_db", 0.0) or 0.0)
    crest = float((report.get("output") or {}).get("crest_db", 99.0) or 99.0)
    return limiter_gr < -9.0 or guard < -2.5 or crest < 4.8


def run(input_path: str, output_path: str, fair_ab_dir: str | None) -> dict:
    p.adaptive_params = loud_otv_params

    report = p.master_file(
        input_path,
        output_path,
        target_lufs=NOMINAL_TARGET_LUFS,
        true_peak_ceiling=SAFE_TRUE_PEAK_DBTP,
        fair_ab_dir=fair_ab_dir,
    )
    fallback = False
    target_used = NOMINAL_TARGET_LUFS

    if needs_safety_fallback(report):
        fallback = True
        target_used = SAFETY_FALLBACK_LUFS
        report = p.master_file(
            input_path,
            output_path,
            target_lufs=target_used,
            true_peak_ceiling=SAFE_TRUE_PEAK_DBTP,
            fair_ab_dir=fair_ab_dir,
        )

    report["profile"] = {
        "id": PROFILE_ID,
        "label": "LOUD / OTV",
        "version": PROFILE_VERSION,
        "policy": "REFERENCE12-guided loudness and tonal density with true-peak safety",
        "nominal_target_lufs": NOMINAL_TARGET_LUFS,
        "target_used_lufs": target_used,
        "safe_true_peak_dbtp": SAFE_TRUE_PEAK_DBTP,
        "safety_fallback_used": fallback,
        "reference_metrics": REFERENCE,
    }
    report["target"]["mode"] = "loud_otv_reference"
    report_path = Path(output_path).with_suffix(".report.json")
    report_path.write_text(json.dumps(report, indent=2, allow_nan=True), encoding="utf-8")
    return report


def main():
    ap = argparse.ArgumentParser(description="ZASU MASTER LOUD / OTV profile")
    ap.add_argument("input")
    ap.add_argument("output")
    ap.add_argument("--fair-ab", default=None)
    args = ap.parse_args()
    report = run(args.input, args.output, args.fair_ab)
    print(json.dumps(report, indent=2, allow_nan=True))


if __name__ == "__main__":
    main()
