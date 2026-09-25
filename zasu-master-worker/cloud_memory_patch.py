from pathlib import Path
import sys

path = Path(sys.argv[1])
s = path.read_text(encoding="utf-8")

s = s.replace(
    'def tonal_transient_stage(x, fs, p):\n    z = x.astype(np.float64, copy=True)',
    'def tonal_transient_stage(x, fs, p):\n'
    '    # Cloud memory guard: x is already float64 from load_work_audio; first lfilter allocates output.\n'
    '    # Avoid an unnecessary full-song duplicate before filtering.\n'
    '    z = x'
)

s = s.replace(
'''def write_fair_ab(input_audio, output_audio, fs, input_lufs, output_lufs, output_dir):
    output_dir.mkdir(parents=True, exist_ok=True)
    common = min(input_lufs, output_lufs)
    bg = common-input_lufs; ag = common-output_lufs
    before = input_audio*amp(bg); after=output_audio*amp(ag)
    bp=output_dir/"before_FAIR.wav"; ap=output_dir/"after_FAIR.wav"
    sf.write(bp, before, fs, subtype="PCM_24"); sf.write(ap, after, fs, subtype="PCM_24")
    return {"matched_lufs": float(common), "before_gain_db": float(bg), "after_gain_db": float(ag),
            "before_path": str(bp), "after_path": str(ap)}
''',
'''def write_fair_ab(input_audio, output_audio, fs, input_lufs, output_lufs, output_dir):
    output_dir.mkdir(parents=True, exist_ok=True)
    common = min(input_lufs, output_lufs)
    bg = common-input_lufs; ag = common-output_lufs
    bp=output_dir/"before_FAIR.wav"; ap=output_dir/"after_FAIR.wav"
    # Cloud memory guard: write one gain-matched render at a time. DSP/math is unchanged.
    before = input_audio*amp(bg)
    sf.write(bp, before, fs, subtype="PCM_24")
    del before
    after = output_audio*amp(ag)
    sf.write(ap, after, fs, subtype="PCM_24")
    del after
    return {"matched_lufs": float(common), "before_gain_db": float(bg), "after_gain_db": float(ag),
            "before_path": str(bp), "after_path": str(ap)}
'''
)

s = s.replace(
'''    params = adaptive_params(before, classification)

    # Free the high-rate original before loading the work-rate copy if possible.
    x, fs, orig_fs, tmpdir = load_work_audio(input_path)
    base = tonal_transient_stage(x, fs, params)
    y_work, convergence = converge_loudness_fast(base, fs, chosen_target, max_renders=1)
    del base
''',
'''    params = adaptive_params(before, classification)

    # Cloud memory guard: reload original later for FAIR A/B instead of retaining two float64 song copies.
    del original

    x, fs, orig_fs, tmpdir = load_work_audio(input_path)
    base = tonal_transient_stage(x, fs, params)
    del x
    y_work, convergence = converge_loudness_fast(base, fs, chosen_target, max_renders=1)
    del base
'''
)

s = s.replace(
'''    if fair_ab_dir:
        # FAIR AB must be same rate. Original is already in memory here.
        report["fair_ab"] = write_fair_ab(original, y, original_fs,
                                           before["integrated_lufs"], after["integrated_lufs"], Path(fair_ab_dir))
''',
'''    if fair_ab_dir:
        # FAIR AB must be same rate. Reload original only at the end to keep peak RAM low.
        original_fair, fair_fs = sf.read(input_path, always_2d=True, dtype="float64")
        if fair_fs != original_fs:
            raise ValueError("Input sample rate changed during processing.")
        report["fair_ab"] = write_fair_ab(original_fair, y, original_fs,
                                           before["integrated_lufs"], after["integrated_lufs"], Path(fair_ab_dir))
        del original_fair
'''
)

path.write_text(s, encoding="utf-8")
print("cloud memory patch applied", path)
