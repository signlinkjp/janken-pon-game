/**
 * JANKeN PoN — Build 5 の確定仕様テスト
 *
 * Build 5 で入れたものを、ここで固定する:
 *   1. 各国語のかけ声を、アプリに同梱した mp3（assets/voices/{code}.mp3）で鳴らす
 *      - 全国（19か国）に Neural Voice と読み上げテキストがある
 *      - 実際のファイルがあり、空でなく mp3 として読める（数KB以上）
 *      - fetch → decodeAudioData で再生・キャッシュ・重ならない・サウンドOFFで鳴らない
 *      - decode できない環境は <audio> で同じファイルを鳴らす
 *   2. 設定の「音をテスト」を削除（ボタン・処理・文言・見た目）
 *   3. ビルド番号 5（pbxproj 2箇所・アプリ側・設定の版表示・www/ 同期）
 *
 * 実際の音・見た目は tools/shots-b5.mjs が実ブラウザで確かめる。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { COUNTRIES, voiceFile, speechFor } from '../src/countries.js';
import { createAudioEngine, voiceAsset, VOICE_MIN_BYTES } from '../src/audio.js';
import { KEYS, DICT, LOCALES } from '../src/i18n.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(ROOT, path), 'utf8');
const exists = (path) => existsSync(resolve(ROOT, path));
const size = (path) => statSync(resolve(ROOT, path)).size;

const MAIN = read('src/main.js');
const HTML = read('index.html');
const CSS = read('styles.css');

/** 国コード → 声の言語（Neural Voice の先頭と一致すること） */
const EXPECTED_LANGUAGE = {
  JP: 'ja-JP', US: 'en-US', BR: 'pt-BR', PE: 'es-PE', FR: 'fr-FR', KR: 'ko-KR',
  TH: 'th-TH', DE: 'de-DE', ID: 'id-ID', CN: 'zh-CN', IT: 'it-IT', ES: 'es-ES',
  PH: 'fil-PH', RU: 'ru-RU', SE: 'sv-SE', TR: 'tr-TR', VN: 'vi-VN', NL: 'nl-NL', PL: 'pl-PL',
};

/** 先頭が mp3 として読めるか（ID3 タグ、または MPEG のフレーム同期） */
function looksLikeMp3(head) {
  return (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33)
    || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0);
}

/* ================================================================== *\
 * 1. 国データ（全国に声と言語がある）
 * ================================================================== */

test('声: 19か国すべてに Neural Voice と読み上げテキストがある', () => {
  assert.equal(COUNTRIES.length, 19);
  for (const country of COUNTRIES) {
    const speech = speechFor(country);
    assert.ok(speech, `${country.code} に speech がある`);
    assert.match(speech.voice, /^[a-z]{2,3}-[A-Z]{2}-\w+Neural$/, `${country.code}: ${speech.voice}`);
    assert.equal(speech.voice.split('-').slice(0, 2).join('-'), EXPECTED_LANGUAGE[country.code], `${country.code} の言語`);
    assert.ok(typeof speech.text === 'string' && speech.text.trim().length > 0, `${country.code} の読み上げテキスト`);
  }
});

test('声: 読み上げテキストは画面の記号（！・?・中黒）を含まない', () => {
  for (const country of COUNTRIES) {
    const speech = speechFor(country);
    assert.equal(/[!！?？。、,・…]/.test(speech.text), false, `${country.code}: ${speech.text}`);
  }
});

test('声: ファイルの場所は assets/voices/{小文字コード}.mp3', () => {
  assert.equal(voiceAsset('JP'), 'assets/voices/jp.mp3');
  assert.equal(voiceAsset('BR'), 'assets/voices/br.mp3');
  assert.equal(voiceFile('US'), 'assets/voices/us.mp3');
  for (const country of COUNTRIES) {
    assert.equal(voiceFile(country.code), voiceAsset(country.code));
  }
});

/* ================================================================== *\
 * 2. 同梱する mp3（全国ぶん実在し、空でない）
 * ================================================================== */

test('声: 全国の mp3 が実在し、数KB以上で mp3 として読める', () => {
  for (const country of COUNTRIES) {
    const path = voiceFile(country.code);
    assert.ok(exists(path), `${path} がある`);
    const bytes = size(path);
    assert.ok(bytes >= VOICE_MIN_BYTES, `${path}: ${bytes} bytes（${VOICE_MIN_BYTES} 以上）`);
    const head = readFileSync(resolve(ROOT, path)).subarray(0, 3);
    assert.ok(looksLikeMp3(head), `${path} の先頭が mp3`);
  }
});

test('声: 19ファイルがそろっていて、どの国も別の音声', () => {
  const files = readdirSync(resolve(ROOT, 'assets/voices')).filter((name) => name.endsWith('.mp3'));
  assert.equal(files.length, COUNTRIES.length, `assets/voices の mp3 は ${COUNTRIES.length} 本`);
  assert.deepEqual(
    files.map((name) => name.replace('.mp3', '')).sort(),
    COUNTRIES.map((country) => country.code.toLowerCase()).sort(),
  );
});

test('声: 生成の道具（tools/make-voices.mjs）が国データから作る', () => {
  const tool = read('tools/make-voices.mjs');
  assert.ok(tool.includes("from '../src/countries.js'"));
  assert.ok(tool.includes('edge-tts'), 'edge-tts で作る');
  assert.ok(tool.includes('speech.voice') && tool.includes('speech.text'));
  assert.ok(tool.includes('MIN_VOICE_BYTES'), '空・壊れたファイルを残さない');
  assert.equal(tool.includes('MIN_VOICE_BYTES = 4000'), true);
});

/* ================================================================== *\
 * 3. 再生（fetch → decode → キャッシュ・重ならない・サウンドOFF）
 * ================================================================== */

function fakeVoiceWorld({ decodeWorks = true, failFetch = false } = {}) {
  const stats = { fetched: [], starts: 0, voiceStarts: 0, stops: 0, decodes: 0, elements: [] };

  class FakeParam {
    constructor(value = 0) { this.value = value; }
    setValueAtTime(value) { this.value = value; return this; }
    exponentialRampToValueAtTime(value) { this.value = value; return this; }
    linearRampToValueAtTime(value) { this.value = value; return this; }
    cancelScheduledValues() { return this; }
  }
  class FakeNode {
    connect(other) { return other; }
  }
  class FakeAudioContext {
    constructor() {
      this.state = 'suspended';
      this.sampleRate = 48000;
      this.currentTime = 0;
      this.destination = new FakeNode();
    }
    createGain() { const node = new FakeNode(); node.gain = new FakeParam(1); return node; }
    createBuffer(channels, length) { return { getChannelData: () => new Float32Array(length) }; }
    createBufferSource() {
      const node = new FakeNode();
      node.started = false;
      node.start = () => {
        node.started = true;
        stats.starts += 1;
        /* 無音のロック解除用バッファではなく、かけ声の音声が鳴った回数 */
        if (node.buffer && node.buffer.duration) stats.voiceStarts += 1;
      };
      node.stop = () => { stats.stops += 1; };
      return node;
    }
    decodeAudioData(data, ok, fail) {
      stats.decodes += 1;
      if (!decodeWorks) { fail?.(new Error('decode failed')); return Promise.reject(new Error('decode failed')); }
      const buffer = { duration: 1.2, data };
      ok?.(buffer);
      return Promise.resolve(buffer);
    }
    resume() { this.state = 'running'; return Promise.resolve(); }
  }
  class FakeAudio {
    constructor(src) { this.src = src; this.played = 0; this.paused = 0; }
    play() { this.played += 1; stats.elements.push(this.src); return Promise.resolve(); }
    pause() { this.paused += 1; }
    setAttribute() {}
  }
  const fetchImpl = async (url) => {
    stats.fetched.push(url);
    if (failFetch) return { ok: false, status: 404 };
    return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(16) };
  };

  return { stats, FakeAudioContext, FakeAudio, fetchImpl };
}

const settle = () => new Promise((done) => setTimeout(done, 0));

test('再生: 国コードの mp3 を fetch → decode して、ゲートを通して鳴らす', async () => {
  const { stats, FakeAudioContext, FakeAudio, fetchImpl } = fakeVoiceWorld();
  const engine = createAudioEngine({ AudioContextClass: FakeAudioContext, fetchImpl, voiceElementClass: FakeAudio, mediaElementClass: null });
  engine.unlock();
  const started = engine.playVoice('JP');
  assert.equal(await started, true);
  assert.equal(engine.voice, 'jp', '鳴っている間は「いま鳴っている国」を持つ');
  assert.deepEqual(stats.fetched, ['assets/voices/jp.mp3']);
  assert.equal(stats.decodes, 1);
  assert.equal(stats.voiceStarts, 1);
  assert.equal(stats.elements.length, 0, 'decode できるときは <audio> を使わない');
});

test('再生: 同じ国の2回目は読み込み済みの音を使う（fetch は1回）', async () => {
  const { stats, FakeAudioContext, FakeAudio, fetchImpl } = fakeVoiceWorld();
  const engine = createAudioEngine({ AudioContextClass: FakeAudioContext, fetchImpl, voiceElementClass: FakeAudio, mediaElementClass: null });
  engine.unlock();
  await engine.playVoice('us');
  await engine.playVoice('US');
  assert.equal(stats.fetched.length, 1, 'キャッシュから鳴らす');
  assert.equal(stats.decodes, 1);
  assert.equal(stats.voiceStarts, 2);
});

test('再生: 次の声を鳴らす前に、前の声を止める（重ならない）', async () => {
  const { stats, FakeAudioContext, FakeAudio, fetchImpl } = fakeVoiceWorld();
  const engine = createAudioEngine({ AudioContextClass: FakeAudioContext, fetchImpl, voiceElementClass: FakeAudio, mediaElementClass: null });
  engine.unlock();
  await engine.playVoice('JP');
  assert.equal(stats.stops, 0);
  await engine.playVoice('BR');
  assert.equal(stats.stops, 1, '前のラウンドの声を止める');
  assert.equal(engine.voice, 'br');
  engine.stopVoice();
  assert.equal(stats.stops, 2);
  assert.equal(engine.voice, null);
});

test('再生: サウンド OFF のときは鳴らさない（ON に戻すと鳴る）', async () => {
  const { stats, FakeAudioContext, FakeAudio, fetchImpl } = fakeVoiceWorld();
  const engine = createAudioEngine({ AudioContextClass: FakeAudioContext, fetchImpl, voiceElementClass: FakeAudio, mediaElementClass: null, muted: true });
  engine.unlock();
  assert.equal(await engine.playVoice('JP'), false);
  assert.equal(stats.fetched.length, 0, 'OFF では読みにも行かない');
  engine.setMuted(false);
  assert.equal(await engine.playVoice('JP'), true);
  engine.setMuted(true);
  assert.equal(stats.stops, 1, 'OFF にした瞬間に鳴っている声を止める');
});

test('再生: decode できない・ファイルが無いときは <audio> で同じファイルを鳴らす', async () => {
  const broken = fakeVoiceWorld({ decodeWorks: false });
  const engine1 = createAudioEngine({
    AudioContextClass: broken.FakeAudioContext, fetchImpl: broken.fetchImpl,
    voiceElementClass: broken.FakeAudio, mediaElementClass: null,
  });
  engine1.unlock();
  assert.equal(await engine1.playVoice('KR'), true);
  assert.deepEqual(broken.stats.elements, ['assets/voices/kr.mp3'], 'decode 失敗 → <audio>');

  const missing = fakeVoiceWorld({ failFetch: true });
  const engine2 = createAudioEngine({
    AudioContextClass: missing.FakeAudioContext, fetchImpl: missing.fetchImpl,
    voiceElementClass: missing.FakeAudio, mediaElementClass: null,
  });
  engine2.unlock();
  assert.equal(await engine2.playVoice('TH'), true);
  assert.deepEqual(missing.stats.elements, ['assets/voices/th.mp3'], '404 でも無音で止まらない');
});

test('再生: fetch も Audio も無い環境でも落ちない', async () => {
  const { FakeAudioContext } = fakeVoiceWorld();
  const engine = createAudioEngine({ AudioContextClass: FakeAudioContext, fetchImpl: null, voiceElementClass: null, mediaElementClass: null });
  engine.unlock();
  assert.equal(await engine.playVoice('JP'), false);
  assert.equal(engine.voice, null);
});

test('再生: preloadVoice で先に読み込める（失敗しても投げない）', async () => {
  const { stats, FakeAudioContext, FakeAudio, fetchImpl } = fakeVoiceWorld();
  const engine = createAudioEngine({ AudioContextClass: FakeAudioContext, fetchImpl, voiceElementClass: FakeAudio, mediaElementClass: null });
  engine.unlock();
  assert.equal(await engine.preloadVoice(['JP', 'US']), true);
  assert.deepEqual(stats.fetched, ['assets/voices/jp.mp3', 'assets/voices/us.mp3']);
  const broken = fakeVoiceWorld({ failFetch: true });
  const engine2 = createAudioEngine({
    AudioContextClass: broken.FakeAudioContext, fetchImpl: broken.fetchImpl,
    voiceElementClass: broken.FakeAudio, mediaElementClass: null,
  });
  engine2.unlock();
  assert.equal(await engine2.preloadVoice('JP'), true, '失敗は握りつぶす');
  await settle();
});

/* ================================================================== *\
 * 4. 画面へのつなぎ方（かけ声の国・止める場所）
 * ================================================================== */

test('つなぎ: ラウンドのかけ声は「いま表示しているかけ声の国」で鳴らす', () => {
  const chant = MAIN.slice(MAIN.indexOf('async function runChant'), MAIN.indexOf('async function runChant') + 1200);
  assert.ok(chant.includes('sound.playVoice(chantCountry().code)'), 'かけ声の国で鳴らす');
  assert.ok(/function chantCountry\(\)[\s\S]{0,220}app\.chantSide === 'opp' \? opponent : me/.test(MAIN), '自分 / 相手の切替に従う');
});

test('つなぎ: 決定・次のラウンド・結果・画面離脱・サウンドOFF で声を止める', () => {
  assert.ok(/app\.phase = 'chant';\s*\/\* Build 5[\s\S]{0,120}sound\.stopVoice\(\)/.test(MAIN), '決定した瞬間');
  assert.ok(/function resetArena\(\) \{\s*\/\* Build 5[\s\S]{0,80}sound\.stopVoice\(\)/.test(MAIN), '次のラウンド');
  assert.ok(/function finishMatch\(\) \{\s*app\.phase = 'done';\s*\/\* Build 5[\s\S]{0,80}sound\.stopVoice\(\)/.test(MAIN), '結果へ');
  assert.ok(/function showScreen\(name\) \{\s*\/\* Build 5[\s\S]{0,160}if \(name !== 'play'\) sound\.stopVoice\(\)/.test(MAIN), '画面離脱');
  assert.ok(/setMuted\(next\)[\s\S]{0,260}stopVoice\(\)/.test(read('src/audio.js')), 'サウンド OFF');
});

test('つなぎ: 試合の開始時に自国と相手国の声を先に読む', () => {
  assert.ok(/sound\.preloadVoice\(\[app\.profile\.countryCode, opponent\.code\]\)/.test(MAIN), 'CPU 練習');
  assert.ok(/sound\.preloadVoice\(\[app\.profile\.countryCode, country\.code\]\)/.test(MAIN), '通信対戦');
});

/* ================================================================== *\
 * 5. 設定の「音をテスト」削除
 * ================================================================== */

test('設定: 「音をテスト」の行・処理・見た目が残っていない', () => {
  assert.equal(HTML.includes('set-sound-test'), false, 'index.html にボタンが無い');
  assert.equal(MAIN.includes('set-sound-test'), false, 'main.js に処理が無い');
  assert.equal(CSS.includes('set-row--sound-test'), false, 'styles.css に専用の見た目が無い');
  assert.equal(HTML.includes('音をテスト'), false);
});

test('設定: 12言語の文言からも「音をテスト」を外した', () => {
  assert.equal(KEYS.includes('settings.soundTest'), false, 'KEYS に無い');
  for (const locale of LOCALES) {
    assert.equal(DICT[locale.id]['settings.soundTest'], undefined, `${locale.id} に残っていない`);
  }
});

test('設定: サウンド ON/OFF と音の初期化そのものは残す', () => {
  assert.ok(HTML.includes('id="set-sound"'), 'サウンドの行は残る');
  assert.ok(MAIN.includes("sound.setMuted(!soundOn)"), 'ON/OFF の処理は残る');
  assert.ok(read('src/audio.js').includes('navigator.audioSession'), 'Audio Session の初期化は残る');
  assert.ok(read('src/audio.js').includes('AUDIO_SESSION_TYPE = \'playback\''));
});

/* ================================================================== *\
 * 6. ビルド番号 5 と www 同期
 * ================================================================== */

test('ビルド: iOS プロジェクトもアプリも Build 6', () => {
  const pbx = read('ios/App/App.xcodeproj/project.pbxproj');
  const numbers = [...pbx.matchAll(/CURRENT_PROJECT_VERSION = (\d+);/g)].map((m) => Number(m[1]));
  assert.equal(numbers.length, 2, 'Debug / Release の2箇所');
  assert.deepEqual(numbers, [6, 6], '2箇所とも 6');
  assert.ok(pbx.includes('MARKETING_VERSION = 1.0.0;'), '表示バージョンは 1.0.0 のまま');
  assert.ok(/version: '1\.0\.0',\s*build: 6,/.test(MAIN), 'アプリ側の build も 6');
  assert.ok(HTML.includes('(Build 6)'), '設定の版表示も Build 6');
});

test('www: 配布用の写しにも Build 6 と音声ファイルが入る', async () => {
  const { makeWww } = await import('../tools/make-www.mjs');
  await makeWww();
  assert.ok(read('www/index.html').includes('(Build 6)'));
  assert.ok(/version: '1\.0\.0',\s*build: 6,/.test(read('www/src/main.js')));
  assert.ok(read('www/src/countries.js').includes("voice: 'ja-JP-NanamiNeural'"));
  assert.ok(exists('www/assets/voices/jp.mp3'), 'www に音声が写る');
  assert.equal(size('www/assets/voices/jp.mp3'), size('assets/voices/jp.mp3'), '同じファイル');
  const files = readdirSync(resolve(ROOT, 'www/assets/voices')).filter((name) => name.endsWith('.mp3'));
  assert.equal(files.length, COUNTRIES.length);
});

test('ワークフロー: いまの見張りは Build 6 と音声ファイルをそのまま通す', () => {
  const yml = read('.github/workflows/ios-testflight-build1.yml');
  assert.equal(/BUILD_NUMBER:\s*"\d+"/.test(yml), false, '番号は固定しない');
  assert.ok(yml.includes('CURRENT_PROJECT_VERSION'));
  assert.ok(yml.includes('node --check src/audio.js'), '音のファイルも構文を見る');
  assert.ok(yml.includes('npm test'));
});
