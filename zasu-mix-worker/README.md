# ZASU MIX Worker v0.1

Independent prototype auto-vocal-mix worker.

Inputs:
- Dry vocal
- Instrumental
- NATURAL / MODERN / ROCK / LOUD style

Processing:
- SoXR HQ alignment
- HPF / tonal EQ / de-essing / compression
- Adaptive vocal loudness placement against the instrumental
- Style ambience
- Safety limiting

Outputs:
- ZASU_MIX_24bit.wav
- ZASU_VOCAL_WET_24bit.wav

This prototype does not perform pitch correction or timing correction. It is isolated from ZASU MASTER and ZASU CONVERT.
