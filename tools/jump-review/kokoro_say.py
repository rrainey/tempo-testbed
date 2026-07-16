# Kokoro TTS for the jump-review pipeline: kokoro_say.py <voice> <out.wav> < text
# The espeakng-loader wheel ships incomplete espeak data (no phontab), so point
# it at the system espeak-ng 1.51 library+data pair before kokoro imports it.
import os
import sys
import espeakng_loader
espeakng_loader.get_library_path = lambda: "/usr/lib/x86_64-linux-gnu/libespeak-ng.so.1"
espeakng_loader.get_data_path = lambda: "/usr/lib/x86_64-linux-gnu/espeak-ng-data"
import soundfile as sf
from kokoro_onnx import Kokoro

voice, out = sys.argv[1], sys.argv[2]
text = sys.stdin.read().strip()
BASE = os.path.dirname(os.path.abspath(__file__))
kokoro = Kokoro(os.path.join(BASE, "models", "kokoro-v1.0.onnx"),
                os.path.join(BASE, "models", "voices-v1.0.bin"))
samples, sample_rate = kokoro.create(text, voice=voice, speed=0.95, lang="en-gb")
sf.write(out, samples, sample_rate)
print(f"{out}: {len(samples)/sample_rate:.1f}s")
