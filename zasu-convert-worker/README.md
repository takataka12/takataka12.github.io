# ZASU CONVERT Worker

Independent conversion worker for ZASU MASTER tools.

- WAV / FLAC / AIFF / ALAC output
- 44.1 / 48 / 88.2 / 96 kHz
- 16 / 24-bit
- SoXR HQ resampling (precision 28)
- TPDF triangular dither when reducing to 16-bit
- No EQ, compression, limiting, loudness normalization, or PUNCH processing
- Separate database queue and Railway service from ZASU MASTER
