"""語音引導的錄音：把 Gemini 語音產生下載的 WAV 整理成 App 用的 MP3。

用法：py -3 -I tools/voice-clips.py <raw 資料夾> [輸出資料夾，預設 audio]
  <raw>/<語言>/<名字>.wav   名字 = teach.say.* 去掉前綴，例如 zh/cheek.sweep.wav、ja/done.wav
  輸出 audio/<語言>/<名字>.mp3

每一句做的事：
  1. 切掉頭尾的空白（留一點點，不會一開口就被切到），頭尾加很短的淡入淡出
  2. 音量對齊：每一句講話的部分調到差不多大聲，不會這句大那句小
  3. 轉成單聲道 24 kHz 的 MP3（40 kbps，一句約 20–30 KB）
同一個語言裡文字完全一樣的句子（例如三種腮紅畫法的「先沾一點點腮紅…」）只錄一次，其餘用複製的。

錄音怎麼來的：Google AI Studio → Generate speech（Gemini TTS），聲音 Nika，
風格「Warm, friendly beauty tutor guiding a friend step by step. Natural conversational pace,
clear and encouraging.」加上各語言的口音說明；一次一句，文字就是 js/i18n.js 的 teach.say.*。
需要：numpy、imageio-ffmpeg（提供 ffmpeg）。"""
import os, re, sys, wave, shutil, subprocess, tempfile
import numpy as np
import imageio_ffmpeg

sys.stdout.reconfigure(encoding='utf-8')
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = sys.argv[1]
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, 'audio')
LANGS = ['zh', 'en', 'ja']
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()

TARGET_DB = -21.0      # 講話部分的音量（RMS）
PEAK_DB = -1.0         # 峰值上限
LEAD_S, TAIL_S = 0.04, 0.14


def say_lines():
    """js/i18n.js 的 teach.say.* → { 名字: [中, 英, 日] }"""
    out = {}
    for line in open(os.path.join(ROOT, 'js', 'i18n.js'), encoding='utf-8'):
        m = re.match(r"\s*'teach\.say\.([^']+)':\s*\[(.*)\],\s*$", line)
        if m:
            out[m.group(1)] = [s.replace("\\'", "'") for s in re.findall(r"'((?:[^'\\]|\\.)*)'", m.group(2))]
    return out


def tidy(path):
    """讀 WAV → 切空白、淡入淡出、對齊音量；回傳 (float 陣列, 取樣率, 秒數)"""
    with wave.open(path, 'rb') as w:
        sr, ch, sw = w.getframerate(), w.getnchannels(), w.getsampwidth()
        raw = w.readframes(w.getnframes())
    assert sw == 2, path + ': 要 16-bit'
    x = np.frombuffer(raw, dtype='<i2').astype(np.float64) / 32768
    if ch > 1:
        x = x.reshape(-1, ch).mean(axis=1)
    win = max(1, int(sr * 0.01))
    n = len(x) // win
    rms = np.sqrt((x[:n * win].reshape(n, win) ** 2).mean(axis=1) + 1e-12)
    loud = rms > max(0.004, rms.max() * 0.03)                   # 比最大聲小 30 dB 以下算空白
    # 頭尾很小聲、又跟講話隔開的雜音（換氣聲、切開多句錄音時留下的半口氣）不算講話：
    # 從兩端往內，音量不到最大聲的 8%、跟下一段隔了 0.08 秒以上的就丟掉。
    # 句尾很輕的子音（k、t、す）緊接在講話後面，不會被丟。
    for step in (1, -1):
        i = 0 if step == 1 else n - 1
        while 0 <= i < n:
            while 0 <= i < n and not loud[i]:
                i += step
            j = i
            while 0 <= j < n and loud[j]:
                j += step
            k = j
            while 0 <= k < n and not loud[k]:
                k += step
            lo, hi = (i, j) if step == 1 else (j + 1, i + 1)
            if not (0 <= k < n) or rms[lo:hi].max() >= rms.max() * 0.08 or abs(k - j) < 8:
                break
            loud[lo:hi] = False
            i = j
    idx = np.flatnonzero(loud)
    a = max(0, idx[0] * win - int(sr * LEAD_S))
    b = min(len(x), (idx[-1] + 1) * win + int(sr * TAIL_S))
    x = x[a:b].copy()
    speech = np.sqrt((rms[loud] ** 2).mean())
    gain = min(10 ** (TARGET_DB / 20) / speech, 10 ** (PEAK_DB / 20) / (np.abs(x).max() + 1e-9))
    x *= gain
    fi, fo = int(sr * 0.008), int(sr * 0.04)
    x[:fi] *= np.linspace(0, 1, fi)
    x[-fo:] *= np.linspace(1, 0, fo)
    return x, sr, len(x) / sr


def encode(x, sr, dst):
    with tempfile.TemporaryDirectory() as d:
        tmp = os.path.join(d, 'a.wav')
        with wave.open(tmp, 'wb') as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
            w.writeframes((np.clip(x, -1, 1) * 32767).astype('<i2').tobytes())
        subprocess.run([FFMPEG, '-y', '-loglevel', 'error', '-i', tmp, '-ac', '1', '-ar', '24000',
                        '-codec:a', 'libmp3lame', '-b:a', '40k', '-map_metadata', '-1', dst], check=True)


say = say_lines()
bad = 0
for li, lang in enumerate(LANGS):
    src, dst = os.path.join(RAW, lang), os.path.join(OUT, lang)
    os.makedirs(dst, exist_ok=True)
    durs, done = [], {}
    for key, texts in say.items():
        wav = os.path.join(src, key + '.wav')
        if os.path.exists(wav):
            x, sr, dur = tidy(wav)
            encode(x, sr, os.path.join(dst, key + '.mp3'))
            done[texts[li]] = key
            durs.append((dur, key))
    for key, texts in say.items():                              # 文字一樣的句子共用同一段錄音
        out = os.path.join(dst, key + '.mp3')
        if not os.path.exists(os.path.join(src, key + '.wav')):
            if texts[li] in done:
                shutil.copyfile(os.path.join(dst, done[texts[li]] + '.mp3'), out)
            else:
                print('缺錄音：', lang, key); bad += 1
    files = [f for f in os.listdir(dst) if f.endswith('.mp3')]
    extra = [f for f in files if f[:-4] not in say]
    size = sum(os.path.getsize(os.path.join(dst, f)) for f in files)
    durs.sort()
    if not durs:
        print(lang + '：沒有錄音'); bad += 1; continue
    print(f'{lang}: {len(files)} 句 / {len(say)}，{size / 1024:.0f} KB，最短 {durs[0][0]:.2f}s（{durs[0][1]}）最長 {durs[-1][0]:.2f}s（{durs[-1][1]}）'
          + (f'；多出來的檔案：{extra}' if extra else ''))
sys.exit(1 if bad else 0)
