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


# Runtime stage diagnostics: stderr is captured by the parent even when the child is SIGKILLed.
s = s.replace(
    'def master_file(input_path, output_path, target_lufs=None, true_peak_ceiling=-0.8, fair_ab_dir=None):\n    input_path = Path(input_path); output_path=Path(output_path)',
    'def master_file(input_path, output_path, target_lufs=None, true_peak_ceiling=-0.8, fair_ab_dir=None):\n'
    '    import resource, sys\n'
    '    def _stage(name):\n'
    '        print(f"ENGINE_STAGE {name} maxrss_kb={resource.getrusage(resource.RUSAGE_SELF).ru_maxrss}", file=sys.stderr, flush=True)\n'
    '    input_path = Path(input_path); output_path=Path(output_path)\n'
    '    _stage("start")'
)
s = s.replace(
    '    before = analyze(original, original_fs, full_meter=True)\n    classification = classify(before)',
    '    _stage("before_analyze_start")\n'
    '    before = analyze(original, original_fs, full_meter=True)\n'
    '    _stage("before_analyze_done")\n'
    '    classification = classify(before)'
)
s = s.replace(
    '    x, fs, orig_fs, tmpdir = load_work_audio(input_path)\n    base = tonal_transient_stage(x, fs, params)\n    del x\n    y_work, convergence = converge_loudness_fast(base, fs, chosen_target, max_renders=1)\n    del base',
    '    _stage("load_work_start")\n'
    '    x, fs, orig_fs, tmpdir = load_work_audio(input_path)\n'
    '    _stage("load_work_done")\n'
    '    base = tonal_transient_stage(x, fs, params)\n'
    '    _stage("tonal_done")\n'
    '    del x\n'
    '    y_work, convergence = converge_loudness_fast(base, fs, chosen_target, max_renders=1)\n'
    '    _stage("converge_done")\n'
    '    del base'
)
s = s.replace(
    '    y = resample_output(y_work, fs, orig_fs)\n    del y_work\n    y, final_tp, guard_db = final_true_peak_guard(y, orig_fs, true_peak_ceiling)\n    after = analyze(y, orig_fs, full_meter=True, known_tp=final_tp)',
    '    y = resample_output(y_work, fs, orig_fs)\n'
    '    _stage("resample_output_done")\n'
    '    del y_work\n'
    '    y, final_tp, guard_db = final_true_peak_guard(y, orig_fs, true_peak_ceiling)\n'
    '    _stage("true_peak_guard_done")\n'
    '    after = analyze(y, orig_fs, full_meter=True, known_tp=final_tp)\n'
    '    _stage("after_analyze_done")'
)
s = s.replace(
    '    if fair_ab_dir:\n        # FAIR AB must be same rate. Reload original only at the end to keep peak RAM low.',
    '    if fair_ab_dir:\n'
    '        _stage("fair_start")\n'
    '        # FAIR AB must be same rate. Reload original only at the end to keep peak RAM low.'
)
s = s.replace(
    '        del original_fair\n\n    report_path = output_path.with_suffix(".report.json")',
    '        del original_fair\n'
    '        _stage("fair_done")\n\n'
    '    report_path = output_path.with_suffix(".report.json")'
)

path.write_text(s, encoding="utf-8")
print("cloud memory patch applied", path)
