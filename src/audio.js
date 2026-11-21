/**
 * 効果音（Web Audio API のシンセのみ。音声ファイルは持たない）
 *
 * ブラウザは「ユーザーの操作」の後にしか音を出せないので、
 * 最初のタップで unlock() して AudioContext を起こす。
 */

const SCALE = {
  C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.0, A4: 440.0, B4: 493.88,
  C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880.0, B5: 987.77,
  C6: 1046.5, E6: 1318.51, G6: 1567.98, C7: 2093.0,
};

export function createAudioEngine({
  AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext,
  volume = 0.9,
  muted = false,
} = {}) {
  let ctx = null;
  let master = null;
  let noiseBuffer = null;
  let isMuted = Boolean(muted);
  /* マスターの基準音量。ミュートはこの値を 0 にする（鳴っている途中の音も即座に止まる） */
  const baseGain = 0.22 * volume;

  function rampMaster(target) {
    if (!ctx || !master) return;
    const t0 = ctx.currentTime;
    try {
      master.gain.cancelScheduledValues(t0);
      master.gain.setValueAtTime(Math.max(0.0001, master.gain.value), t0);
      master.gain.exponentialRampToValueAtTime(Math.max(0.0001, target), t0 + 0.03);
    } catch {
      master.gain.value = target;
    }
  }

  function ensure() {
    if (!AudioContextClass) return null;
    try {
      if (!ctx) {
        ctx = new AudioContextClass();
        master = ctx.createGain();
        master.gain.value = isMuted ? 0.0001 : baseGain;
        master.connect(ctx.destination);
      }
      /* iOS の WKWebView は 'suspended' のほかに 'interrupted' でも止まる。
         どちらでも、次の操作のたびに起こし直す。 */
      if (ctx.state !== 'running' && typeof ctx.resume === 'function') ctx.resume();
      return ctx;
    } catch {
      return null;
    }
  }

  function now() {
    return ctx.currentTime;
  }

  function tone({ freq, to = null, dur = 0.14, type = 'sine', gain = 0.3, delay = 0, attack = 0.006, release = null }) {
    if (!ensure()) return;
    const t0 = now() + delay;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (to && to !== freq) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + dur);
    amp.gain.setValueAtTime(0.0001, t0);
    amp.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + attack);
    amp.gain.exponentialRampToValueAtTime(0.0001, t0 + (release ?? dur));
    osc.connect(amp).connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  function noise({ dur = 0.25, gain = 0.18, delay = 0, from = 1200, to = 400, q = 1.1, type = 'bandpass' }) {
    if (!ensure()) return;
    if (!noiseBuffer) {
      noiseBuffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5), ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    }
    const t0 = now() + delay;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(from, t0);
    filter.frequency.exponentialRampToValueAtTime(Math.max(60, to), t0 + dur);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, t0);
    amp.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + 0.01);
    amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter).connect(amp).connect(master);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  const sounds = {
    click() {
      tone({ freq: 720, to: 560, dur: 0.07, type: 'square', gain: 0.09 });
    },
    select() {
      tone({ freq: SCALE.E5, dur: 0.08, type: 'triangle', gain: 0.16 });
      tone({ freq: SCALE.A5, dur: 0.1, type: 'triangle', gain: 0.12, delay: 0.06 });
    },
    tick() {
      tone({ freq: 1500, dur: 0.035, type: 'sine', gain: 0.1 });
    },
    urgent() {
      tone({ freq: 1040, dur: 0.09, type: 'square', gain: 0.12 });
    },
    chant() {
      noise({ dur: 0.14, gain: 0.22, from: 900, to: 220, q: 0.8 });
      tone({ freq: 196, to: 150, dur: 0.12, type: 'sine', gain: 0.22 });
    },
    reveal() {
      noise({ dur: 0.28, gain: 0.18, from: 400, to: 2600, q: 1.4 });
      tone({ freq: 180, to: 320, dur: 0.16, type: 'triangle', gain: 0.16 });
    },
    win() {
      [SCALE.C5, SCALE.E5, SCALE.G5, SCALE.C6].forEach((freq, i) => {
        tone({ freq, dur: 0.22, type: 'triangle', gain: 0.26, delay: i * 0.075 });
      });
      tone({ freq: SCALE.C7, dur: 0.4, type: 'sine', gain: 0.08, delay: 0.3 });
      noise({ dur: 0.3, gain: 0.1, from: 4000, to: 1200, delay: 0.3, q: 0.7 });
    },
    lose() {
      [SCALE.G4, SCALE.E4, SCALE.C4].forEach((freq, i) => {
        tone({ freq, dur: 0.26, type: 'sawtooth', gain: 0.14, delay: i * 0.12 });
      });
      tone({ freq: 92, dur: 0.4, type: 'sine', gain: 0.2, delay: 0.24 });
    },
    tie() {
      tone({ freq: SCALE.A4, dur: 0.09, type: 'square', gain: 0.14 });
      tone({ freq: SCALE.A4, dur: 0.12, type: 'square', gain: 0.12, delay: 0.13 });
    },
    coin() {
      tone({ freq: SCALE.G6, dur: 0.06, type: 'square', gain: 0.09 });
      tone({ freq: SCALE.C7, dur: 0.09, type: 'square', gain: 0.08, delay: 0.05 });
    },
    rankUp() {
      [SCALE.E5, SCALE.G5, SCALE.B5, SCALE.E6].forEach((freq, i) => {
        tone({ freq, dur: 0.18, type: 'triangle', gain: 0.2, delay: i * 0.06 });
      });
    },
    fanfare() {
      const melody = [SCALE.C5, SCALE.E5, SCALE.G5, SCALE.C6, SCALE.G5, SCALE.C6, SCALE.E6];
      melody.forEach((freq, i) => {
        tone({ freq, dur: 0.26, type: 'triangle', gain: 0.22, delay: i * 0.11 });
      });
      noise({ dur: 0.5, gain: 0.12, from: 5000, to: 900, delay: 0.55 });
      [SCALE.C5, SCALE.E5, SCALE.G5].forEach((freq) => {
        tone({ freq, dur: 0.7, type: 'sine', gain: 0.1, delay: 0.77 });
      });
    },
    whoosh() {
      noise({ dur: 0.4, gain: 0.14, from: 200, to: 1800, q: 0.9 });
    },
    locked() {
      tone({ freq: 150, to: 110, dur: 0.12, type: 'square', gain: 0.12 });
    },
    proUnlock() {
      [SCALE.G4, SCALE.B4, SCALE.D5, SCALE.G5, SCALE.B5].forEach((freq, i) => {
        tone({ freq, dur: 0.3, type: 'triangle', gain: 0.18, delay: i * 0.07 });
      });
    },
  };

  return {
    unlock() {
      const context = ensure();
      return context ? context.state : null;
    },
    play(name) {
      if (isMuted) return;
      const sound = sounds[name];
      if (!sound) return;
      try {
        sound();
      } catch {
        /* 音が出せなくてもゲームは続ける */
      }
    },
    /**
     * サウンド ON/OFF。効果音は play() の入口で止め、さらにマスターを 0 にするので、
     * すでに鳴っている音（遅延して予約されたファンファーレの残りなど）もその場で消える。
     * OFF→ON では、次の操作で AudioContext を起こし直す。
     */
    setMuted(next) {
      const value = Boolean(next);
      if (value === isMuted) {
        if (!value) ensure();
        return isMuted;
      }
      isMuted = value;
      if (isMuted) {
        rampMaster(0.0001);
      } else {
        ensure();
        rampMaster(baseGain);
      }
      return isMuted;
    },
    get muted() {
      return isMuted;
    },
    get volume() {
      return master ? master.gain.value : isMuted ? 0 : baseGain;
    },
    get state() {
      return ctx ? ctx.state : 'idle';
    },
    get context() {
      return ctx;
    },
    soundNames: Object.keys(sounds),
  };
}
