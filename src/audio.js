/**
 * 効果音（Web Audio API のシンセのみ。音声ファイルは持たない）
 *
 * ブラウザは「ユーザーの操作」の後にしか音を出せないので、最初のタップで
 * unlock() して AudioContext を起こす。
 *
 * Build 3「iOS 実機で音が出ない」の原因と対策（すべてここに入れている）:
 *
 *   原因1: iOS の Web Audio は Audio Session の種類が既定 `ambient` で、
 *          本体横のマナースイッチ（消音）が入っていると**丸ごと無音**になる。
 *          AppDelegate の AVAudioSession(.playback) は WKWebView の
 *          別プロセスには効かない（WebKit の担当者もそう書いている）。
 *          → `navigator.audioSession.type = 'playback'`（iOS 16.4+）で直す。
 *   原因2: 起動直後（操作の外）に AudioContext を作ると、iOS では
 *          suspended のまま戻らないことがある。
 *          → 文脈は「操作の中」で作り、同じスタックで resume() する。
 *   原因3: 古い iOS には Audio Session API が無い。HTMLMediaElement の
 *          既定は `playback` なので、無音の <audio> を鳴らすと
 *          WebProcess のセッションが playback に変わる。
 *          → 操作の中で無音 WAV を一度鳴らして、その状態を保つ。
 *   原因4: マスターを 0.0001 まで exponentialRamp して戻す作りは、
 *          途中で止まると 0.0001 のまま復帰しない事故になる。
 *          → ミュートは専用のゲート（0 / 1 の linearRamp）で行う。
 */

const SCALE = {
  C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.0, A4: 440.0, B4: 493.88,
  C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880.0, B5: 987.77,
  C6: 1046.5, E6: 1318.51, G6: 1567.98, C7: 2093.0,
};

/**
 * 50ms の無音 WAV（8kHz / 8bit / モノラル）。
 * <audio> で鳴らすと WebProcess の Audio Session が playback に切り替わり、
 * マナースイッチが入っていても Web Audio が鳴るようになる。音はしない。
 */
export const SILENT_WAV =
  'data:audio/wav;base64,UklGRrQBAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YZABAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA';

/** Web Audio の出力に求める Audio Session の種類（マナースイッチで消えない） */
export const AUDIO_SESSION_TYPE = 'playback';
/** iOS ネイティブ側の小さなブリッジ（AppDelegate.swift の JankenAudioPlugin） */
export const NATIVE_PLUGIN = 'JankenAudio';
/** サウンド OFF のときに戻す種類（ほかのアプリの音と混ざる） */
export const QUIET_SESSION_TYPE = 'ambient';

/* Build 5: かけ声の音声は、実行時に合成せず、アプリに同梱した mp3 を鳴らす。
   assets/voices/{code}.mp3（国コード小文字）を fetch → decodeAudioData で
   読み込み、Web Audio のゲート（サウンド ON/OFF と同じ）を通して再生する。
   端末や WebView が decode できないときは <audio> で同じファイルを鳴らす。 */
export const VOICE_DIR = 'assets/voices';
/** これ未満は空・壊れたファイルとみなす（tools/make-voices.mjs と同じ基準） */
export const VOICE_MIN_BYTES = 4000;

/** かけ声の音声ファイルの場所（国コードは小文字） */
export function voiceAsset(code, base = VOICE_DIR) {
  return `${base}/${String(code || '').toLowerCase()}.mp3`;
}

export function createAudioEngine({
  AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext,
  volume = 0.9,
  muted = false,
  mediaElementClass = typeof globalThis.Audio === 'function' ? globalThis.Audio : null,
  session = null,
  voiceBase = VOICE_DIR,
  fetchImpl = typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null,
  voiceElementClass = typeof globalThis.Audio === 'function' ? globalThis.Audio : null,
} = {}) {
  let ctx = null;
  let master = null;
  let gate = null;
  let voiceGain = null;
  let noiseBuffer = null;
  let isMuted = Boolean(muted);
  let primed = false;
  let silence = null;
  let silenceActive = false;
  let sessionType = null;

  /* かけ声の音声（Build 5） */
  const voiceCache = new Map();
  let voicePlaying = null;
  let voiceToken = 0;

  /* マスターの基準音量。ミュートはゲート（別の Gain）で 0 にする */
  const baseGain = 0.22 * volume;

  /** ネイティブ（Capacitor）があるときだけ、アプリ側の Audio Session も起こす */
  function activateNative() {
    try {
      if (typeof window === 'undefined') return false;
      const plugins = window.Capacitor && window.Capacitor.Plugins;
      const plugin = plugins && plugins[NATIVE_PLUGIN];
      if (!plugin || typeof plugin.activate !== 'function') return false;
      const started = plugin.activate();
      if (started && typeof started.catch === 'function') started.catch(() => {});
      return true;
    } catch {
      return false;
    }
  }

  function sessionObject() {
    if (session) return session;
    try {
      return typeof navigator !== 'undefined' ? navigator.audioSession ?? null : null;
    } catch {
      return null;
    }
  }

  /**
   * Audio Session の種類を決める。iOS 16.4+ の Safari / WKWebView だけが持つ。
   * 無い環境では何も起きない（<audio> の無音で代わりに切り替える）。
   */
  function applySessionType(preferred = AUDIO_SESSION_TYPE) {
    try {
      const target = sessionObject();
      if (!target) return null;
      if (target.type !== preferred) target.type = preferred;
      sessionType = target.type ?? preferred;
      return sessionType;
    } catch {
      return null;
    }
  }

  /** ゲート（0 = 無音 / 1 = そのまま）。0.0001 を経由しないので戻り損ねない */
  function rampMaster(target) {
    if (!ctx || !gate) return;
    const value = target > 0 ? 1 : 0;
    const t0 = ctx.currentTime;
    try {
      gate.gain.cancelScheduledValues(t0);
      gate.gain.setValueAtTime(Math.max(0, Math.min(1, gate.gain.value)), t0);
      gate.gain.linearRampToValueAtTime(value, t0 + 0.02);
    } catch {
      gate.gain.value = value;
    }
  }

  /** resume() は Promise を返す。失敗しても音の組み立ては止めない */
  function kick() {
    if (!ctx) return;
    try {
      const started = typeof ctx.resume === 'function' ? ctx.resume() : null;
      if (started && typeof started.catch === 'function') started.catch(() => {});
    } catch {
      /* 起こせなくても次の操作でまた試す */
    }
  }

  function build() {
    if (!AudioContextClass) return null;
    try {
      ctx = new AudioContextClass();
    } catch {
      ctx = null;
      return null;
    }
    try {
      master = ctx.createGain();
      master.gain.value = baseGain;
      gate = ctx.createGain();
      gate.gain.value = isMuted ? 0 : 1;
      voiceGain = ctx.createGain();
      voiceGain.gain.value = 0.9;
      master.connect(gate).connect(ctx.destination);
      voiceGain.connect(gate);
    } catch {
      master = null;
      gate = null;
      voiceGain = null;
    }
    try {
      if (typeof ctx.addEventListener === 'function') {
        /* iOS は 'interrupted'（電話・Siri・ほかのアプリ）から戻るときに
           suspended のまま残ることがある。操作のたびに起こし直す。 */
        ctx.addEventListener('statechange', () => {
          if (!ctx) return;
          if (ctx.state === 'running') {
            if (gate) rampMaster(isMuted ? 0 : 1);
          }
        });
      }
    } catch {
      /* statechange が無くても動く */
    }
    return ctx;
  }

  function ensure() {
    /* closed になった文脈は捨てて作り直す（iOS 17 で数回鳴らすと閉じることがある） */
    if (ctx && ctx.state === 'closed') {
      ctx = null;
      master = null;
      gate = null;
      voiceGain = null;
      noiseBuffer = null;
      primed = false;
      voiceCache.clear();
    }
    if (!ctx) build();
    if (!ctx) return null;
    kick();
    return ctx;
  }

  /** 操作の同じスタックで 1 サンプルの無音を鳴らす（iOS のロック解除の定石） */
  function playSilenceBuffer() {
    if (!ctx || !gate) return false;
    try {
      const buffer = ctx.createBuffer(1, 1, ctx.sampleRate || 44100);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(gate);
      src.start(0);
      return true;
    } catch {
      return false;
    }
  }

  /** 無音の <audio> を鳴らして、WebProcess の Audio Session を playback にする */
  function primeSilence() {
    if (!mediaElementClass) return false;
    try {
      if (!silence) {
        silence = new mediaElementClass(SILENT_WAV);
        silence.loop = true;
        silence.preload = 'auto';
        silence.volume = 1;
        if (typeof silence.setAttribute === 'function') {
          silence.setAttribute('playsinline', '');
          silence.setAttribute('webkit-playsinline', '');
        }
      }
      const started = typeof silence.play === 'function' ? silence.play() : null;
      if (started && typeof started.catch === 'function') started.catch(() => {});
      silenceActive = true;
      return true;
    } catch {
      return false;
    }
  }

  function stopSilence() {
    if (!silence) return;
    try {
      silence.pause();
    } catch {
      /* 止められなくてもミュートはゲートで効く */
    }
    silenceActive = false;
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

  /* ---------------------------------------------------------------- *\
   * かけ声の音声（Build 5）
   * ---------------------------------------------------------------- */

  /** ArrayBuffer → AudioBuffer。decodeAudioData は約束を返す実装とコールバックの実装がある */
  function decode(data) {
    return new Promise((resolve, reject) => {
      try {
        const maybe = ctx.decodeAudioData(data, resolve, reject);
        if (maybe && typeof maybe.then === 'function') maybe.then(resolve, reject);
      } catch (error) {
        reject(error);
      }
    });
  }

  /** 国コードの mp3 を読む（同じ国は1回だけ。失敗はキャッシュしない） */
  function loadVoiceBuffer(key) {
    if (!key || !fetchImpl) return Promise.resolve(null);
    if (voiceCache.has(key)) return voiceCache.get(key);
    if (!ctx || typeof ctx.decodeAudioData !== 'function') return Promise.resolve(null);
    const promise = (async () => {
      const response = await fetchImpl(voiceAsset(key, voiceBase));
      if (!response || !response.ok) throw new Error(`voice ${key}: ${response?.status ?? 'no response'}`);
      return await decode(await response.arrayBuffer());
    })().catch(() => {
      voiceCache.delete(key);
      return null;
    });
    voiceCache.set(key, promise);
    return promise;
  }

  /** decode できない環境（古い WebView・CORS など）の代わり。同じ mp3 を <audio> で鳴らす */
  function playVoiceElement(key) {
    if (!voiceElementClass) return false;
    try {
      const element = new voiceElementClass(voiceAsset(key, voiceBase));
      element.preload = 'auto';
      try {
        element.setAttribute('playsinline', '');
        element.setAttribute('webkit-playsinline', '');
      } catch {
        /* 属性が無くても再生はできる */
      }
      const started = typeof element.play === 'function' ? element.play() : null;
      if (started && typeof started.catch === 'function') started.catch(() => {});
      voicePlaying = { code: key, source: null, element };
      return true;
    } catch {
      return false;
    }
  }

  /** 鳴っているかけ声を止める（次のラウンド・即オープン・画面離脱・サウンド OFF） */
  function stopVoice() {
    voiceToken += 1;
    const playing = voicePlaying;
    voicePlaying = null;
    if (!playing) return false;
    try {
      playing.source?.stop();
    } catch {
      /* すでに終わっていても落とさない */
    }
    try {
      playing.element?.pause();
    } catch {
      /* 同上 */
    }
    return true;
  }

  /** かけ声の mp3 を、サウンド設定のゲートを通して鳴らす */
  async function playVoice(code) {
    const key = String(code || '').toLowerCase();
    /* 鳴っている声は必ず先に止める（重ならない） */
    stopVoice();
    if (!key || isMuted) return false;
    const token = voiceToken;
    const context = ensure();
    if (!context) return playVoiceElement(key);
    const buffer = await loadVoiceBuffer(key);
    if (!buffer) return token === voiceToken && !isMuted ? playVoiceElement(key) : false;
    if (token !== voiceToken || isMuted) return false;
    if (!gate) return playVoiceElement(key);
    try {
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(voiceGain ?? gate);
      source.onended = () => {
        if (voicePlaying && voicePlaying.source === source) voicePlaying = null;
      };
      voicePlaying = { code: key, source, element: null };
      source.start(0);
      return true;
    } catch {
      return playVoiceElement(key);
    }
  }

  /** 次のラウンドに備えて先に読み込む（失敗しても何もしない） */
  function preloadVoice(codes) {
    const list = Array.isArray(codes) ? codes : [codes];
    return Promise.all(list.map((code) => loadVoiceBuffer(String(code || '').toLowerCase()))).then(() => true);
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
    /**
     * ユーザー操作の中で呼ぶ。ここで初めて AudioContext を作り、
     * Audio Session を playback にして、無音バッファと無音 <audio> を鳴らす。
     * 戻り値は AudioContext の state（'running' なら鳴る準備ができている）。
     */
    unlock() {
      applySessionType(isMuted ? QUIET_SESSION_TYPE : AUDIO_SESSION_TYPE);
      activateNative();
      const context = ensure();
      if (!context) return null;
      kick();
      playSilenceBuffer();
      if (!isMuted) primeSilence();
      primed = true;
      return context.state;
    },
    /** 復帰（バックグラウンドから戻ったとき）。次の操作の前に呼ぶ */
    wake() {
      const context = ensure();
      if (!context) return null;
      kick();
      activateNative();
      applySessionType(isMuted ? QUIET_SESSION_TYPE : AUDIO_SESSION_TYPE);
      if (!isMuted) primeSilence();
      return context.state;
    },
    play(name) {
      if (isMuted) return;
      if (!ensure()) return;
      if (ctx.state !== 'running') kick();
      if (primed && !silenceActive) primeSilence();
      const sound = sounds[name];
      if (!sound) return;
      try {
        sound();
      } catch {
        /* 音が出せなくてもゲームは続ける */
      }
    },
    /**
     * サウンド ON/OFF。効果音は play() の入口で止め、さらにゲートを 0 にするので、
     * すでに鳴っている音（遅延して予約されたファンファーレの残りなど）もその場で消える。
     * OFF のときは無音 <audio> も止めて、Audio Session をほかのアプリに返す。
     */
    setMuted(next) {
      const value = Boolean(next);
      if (value === isMuted) return isMuted;
      isMuted = value;
      if (isMuted) {
        rampMaster(0);
        stopSilence();
        stopVoice();
        applySessionType(QUIET_SESSION_TYPE);
      } else {
        applySessionType(AUDIO_SESSION_TYPE);
        if (ctx) {
          kick();
          rampMaster(1);
          primeSilence();
        }
      }
      return isMuted;
    },
    /**
     * かけ声の音声（Build 5）。国コードを渡すと assets/voices/{code}.mp3 を鳴らす。
     * 鳴っている声は先に止める。サウンド OFF のときは何もしない。
     */
    playVoice,
    /** 鳴っているかけ声を止める（次のラウンド・即オープン・画面離脱） */
    stopVoice,
    /** 先に読み込んでおく（自国と相手国。失敗しても無視） */
    preloadVoice,
    /** いま鳴っているかけ声の国コード（鳴っていなければ null） */
    get voice() {
      return voicePlaying ? voicePlaying.code : null;
    },
    /** 音声の元ファイルの場所（テスト・道具から同じ規則を使う） */
    voiceAsset,
    get muted() {
      return isMuted;
    },
    /** ゲートの値（1 = 鳴る / 0 = 無音） */
    get gain() {
      return gate ? gate.gain.value : 0;
    },
    get volume() {
      return master ? master.gain.value : baseGain;
    },
    get state() {
      return ctx ? ctx.state : 'idle';
    },
    get context() {
      return ctx;
    },
    /** いまの Audio Session の種類（iOS で 'playback' になっていれば消音スイッチでも鳴る） */
    get sessionType() {
      return sessionType ?? (sessionObject()?.type ?? null);
    },
    get unlocked() {
      return primed;
    },
    /** 無音 <audio> が鳴っているか（WebProcess のセッションが playback か） */
    get silenceActive() {
      return silenceActive;
    },
    soundNames: Object.keys(sounds),
  };
}
