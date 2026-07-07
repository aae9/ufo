import json
from math import gcd
import numpy as np
from scipy.signal import resample_poly
from scipy.io import wavfile

FILE = "opensignals_00078046f44e_2026-06-10_10-00-17.txt"
TARGET_SR = 48000          # WAV sample rate (matches video audio standard)
DEFAULT_FS = 1000


def read_header(path):
    """Sampling rate + column names from the OpenSignals JSON header."""
    with open(path) as f:
        f.readline()                       # "# OpenSignals Text File Format"
        meta = json.loads(f.readline().lstrip("# ").strip())
    dev = meta[next(iter(meta))]
    return dev.get("sampling rate", DEFAULT_FS), dev.get("column", [])


fs, cols = read_header(FILE)
data = np.loadtxt(FILE, comments="#")

# columns: 0=nSeq, 1=digital, 2..=analog channels
sig = data[:, 2:].astype(float)            # (n_samples, n_channels)
n_ch = sig.shape[1]
ch_names = cols[2:] if len(cols) >= n_ch + 2 else [f"CH{i+1}" for i in range(n_ch)]

# resample ratio that PRESERVES real-time duration (1000 -> 48000 etc.)
g = gcd(TARGET_SR, fs)
up, down = TARGET_SR // g, fs // g

dur = data.shape[0] / fs
print(f"recording: {data.shape[0]:,} samples @ {fs} Hz  ->  {dur:.1f} s")

for i, name in enumerate(ch_names):
    x = sig[:, i]
    x = x - x.mean()                       # remove DC offset
    x = resample_poly(x, up, down)         # to TARGET_SR, same duration
    peak = np.max(np.abs(x)) or 1.0
    x = (x / peak * 0.95).astype(np.float32)  # normalize to -1..1 float WAV
    out = f"eeg_{name}.wav"
    wavfile.write(out, TARGET_SR, x)
    print(f"  {out}: {len(x)/TARGET_SR:.1f} s @ {TARGET_SR} Hz")