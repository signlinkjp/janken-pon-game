/**
 * JANKeN PoN — Build 3 の確定仕様テスト
 *
 * Build 3 で直した6項目を、ここで固定する:
 *   1. iOS 実機で音が鳴らない原因（Web Audio の Audio Session が ambient で、
 *      消音スイッチに切られていた）と、その対策
 *   2. CPU 練習の秒数（初級7 / 中級5 / 上級3 / 最強2）
 *   3. 文字サイズ「特大」の「回戦数 / CPUの強さ」と「チョキ」の折り返し
 *   4. その手を出したときの勝率（あいこを除く）
 *   5. ランキングの3色バーの凡例
 *   6. 勝率ランキングは5戦以上（1戦1勝の100%で1位にならない）
 *
 * 端末（iOS）そのものは CI で動かせないので、AudioContext と
 * Audio Session を偽物に差し替えて「何を作り、何を鳴らし、どの種類にしたか」を見る。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(ROOT, path), 'utf8');
const exists = (path) => existsSync(resolve(ROOT, path));

const {
  createAudioEngine,
  SILENT_WAV,
  AUDIO_SESSION_TYPE,
  QUIET_SESSION_TYPE,
  NATIVE_PLUGIN,
} = await import('../src/audio.js');
const { LEVELS, HAND_SERIES, HAND_COLORS } = await import('../src/core.js');
const {
  applyMatch,
  applyParty,
  defaultProfile,
  handWinRate,
  handResultOf,
  sanitizeProfile,
  PROFILE_VERSION,
} = await import('../src/storage.js');
const { MIN_WINRATE_MATCHES, leaderboard, isRankedIn, matchesToWinRateRank, formatMetric } = await import(
  '../src/ranking.js'
);
const { LOCALES, KEYS, DICT } = await import('../src/i18n.js');

/* ------------------------------------------------------------------ *\
 * 偽の AudioContext（iOS の癖も再現できるようにする）
 * ------------------------------------------------------------------ */

function fakeAudio({ resumeFails = false } = {}) {
  const stats = { contexts: 0, oscillators: 0, buffers: 0, resumes: 0, gains: [] };

  class FakeParam {
    constructor(value = 0) {
      this.value = value;
    }
    setValueAtTime(value) {
      this.value = value;
      return this;
    }
    linearRampToValueAtTime(value) {
      this.value = value;
      return this;
    }
    exponentialRampToValueAtTime(value) {
      this.value = value;
      return this;
    }
    cancelScheduledValues() {
      return this;
    }
  }

  class FakeNode {
    connect(other) {
      return other;
    }
  }

  class FakeAudioContext {
    constructor() {
      stats.contexts += 1;
      this.state = 'suspended'; // iOS は操作の外で作ると suspended のまま
      this.sampleRate = 48000;
      this.currentTime = 0;
      this.destination = new FakeNode();
      this.listeners = {};
    }
    addEventListener(name, fn) {
      (this.listeners[name] ??= []).push(fn);
    }
    createGain() {
      const node = new FakeNode();
      node.gain = new FakeParam(1);
      stats.gains.push(node.gain);
      return node;
    }
    createOscillator() {
      const node = new FakeNode();
      node.type = 'sine';
      node.frequency = new FakeParam(440);
      node.start = () => {
        stats.oscillators += 1;
      };
      node.stop = () => {};
      return node;
    }
    createBiquadFilter() {
      const node = new FakeNode();
      node.type = 'bandpass';
      node.Q = new FakeParam(1);
      node.frequency = new FakeParam(1000);
      return node;
    }
    createBuffer(channels, length) {
      return { getChannelData: () => new Float32Array(length) };
    }
    createBufferSource() {
      const node = new FakeNode();
      node.start = () => {
        stats.buffers += 1;
      };
      node.stop = () => {};
      return node;
    }
    resume() {
      stats.resumes += 1;
      if (resumeFails) return Promise.reject(new Error('NotAllowedError'));
      this.state = 'running';
      return Promise.resolve();
    }
  }

  return { FakeAudioContext, stats };
}

/** 無音 <audio> の代わり（鳴らした回数と止めた回数を数える） */
function fakeMedia() {
  const calls = { created: 0, played: 0, paused: 0, last: null };
  class FakeMediaElement {
    constructor(src) {
      calls.created += 1;
      calls.last = this;
      this.src = src;
      this.loop = false;
      this.preload = '';
      this.volume = 1;
      this.attributes = {};
      this.playCount = 0;
      this.pauseCount = 0;
    }
    setAttribute(name, value) {
      this.attributes[name] = value;
    }
    play() {
      calls.played += 1;
      this.playCount += 1;
      return Promise.resolve();
    }
    pause() {
      calls.paused += 1;
      this.pauseCount += 1;
    }
  }
  return { FakeMediaElement, calls };
}

/** iOS 16.4+ の navigator.audioSession 相当 */
function fakeSession(type = 'auto') {
  return { type };
}

/* ================================================================== *\
 * 1. 音が出ない原因と対策（audio.js / AppDelegate.swift / main.js）
 * ================================================================== */

test('音: 無音 WAV は data URI の WAV（WebProcess の Audio Session を playback にするため）', () => {
  assert.ok(SILENT_WAV.startsWith('data:audio/wav;base64,'));
  const bytes = Buffer.from(SILENT_WAV.split(',')[1], 'base64');
  assert.equal(bytes.subarray(0, 4).toString(), 'RIFF');
  assert.equal(bytes.subarray(8, 12).toString(), 'WAVE');
  assert.equal(AUDIO_SESSION_TYPE, 'playback', '消音スイッチで切られない種類');
  assert.equal(QUIET_SESSION_TYPE, 'ambient', 'サウンド OFF ではほかの音と混ざる種類に戻す');
  assert.equal(NATIVE_PLUGIN, 'JankenAudio');
});

test('音: AudioContext は起動時に作らない（操作の中で作る）', () => {
  const { FakeAudioContext, stats } = fakeAudio();
  createAudioEngine({ AudioContextClass: FakeAudioContext });
  assert.equal(stats.contexts, 0, 'モジュール読み込み・初期化では作らない');
});

test('音: unlock() で Audio Session を playback にし、無音バッファと無音 <audio> を鳴らす', () => {
  const { FakeAudioContext, stats } = fakeAudio();
  const asset = fakeMedia();
  const session = fakeSession('auto');
  const engine = createAudioEngine({
    AudioContextClass: FakeAudioContext,
    mediaElementClass: asset.FakeMediaElement,
    session,
  });

  const state = engine.unlock();
  assert.equal(stats.contexts, 1, '操作の中で AudioContext ができる');
  assert.equal(state, 'running');
  assert.equal(session.type, 'playback', 'navigator.audioSession.type = playback');
  assert.equal(engine.sessionType, 'playback');
  assert.ok(stats.buffers >= 1, '無音バッファを鳴らす（iOS のロック解除）');
  assert.equal(asset.calls.created, 1);
  assert.equal(asset.calls.played, 1, '無音の <audio> を鳴らす');
  assert.equal(asset.calls.last.loop, true, '鳴っている状態を保つ');
  assert.equal(asset.calls.last.src, SILENT_WAV);
  assert.equal(engine.unlocked, true);
  assert.equal(engine.silenceActive, true);
});

test('音: ミュートで <audio> を止めて ambient に戻し、ON で playback に戻す', () => {
  const { FakeAudioContext } = fakeAudio();
  const asset = fakeMedia();
  const session = fakeSession('auto');
  const engine = createAudioEngine({
    AudioContextClass: FakeAudioContext,
    mediaElementClass: asset.FakeMediaElement,
    session,
  });

  engine.unlock();
  engine.setMuted(true);
  assert.equal(session.type, 'ambient');
  assert.equal(asset.calls.paused, 1, '無音 <audio> を止める');
  assert.equal(engine.silenceActive, false);
  assert.equal(engine.gain, 0, 'ゲートは 0');

  engine.setMuted(false);
  assert.equal(session.type, 'playback');
  assert.equal(engine.gain, 1, 'ゲートは 1（0.0001 を経由しない）');
  assert.ok(asset.calls.played >= 2, 'ON で鳴らし直す');
});

test('音: AudioContext が閉じられたら作り直す（iOS 17 の「数回で鳴らなくなる」対策）', () => {
  const { FakeAudioContext, stats } = fakeAudio();
  const engine = createAudioEngine({ AudioContextClass: FakeAudioContext, mediaElementClass: null });
  engine.unlock();
  assert.equal(stats.contexts, 1);

  engine.context.state = 'closed';
  engine.play('click');
  assert.equal(stats.contexts, 2, '閉じた文脈は捨てて作り直す');
  assert.ok(stats.oscillators > 0, '作り直した文脈で鳴る');
});

test('音: resume() が失敗しても音の組み立ては止めない', () => {
  const { FakeAudioContext, stats } = fakeAudio({ resumeFails: true });
  const engine = createAudioEngine({ AudioContextClass: FakeAudioContext });
  const state = engine.unlock();
  assert.equal(state, 'suspended', '起きない（iOS が操作を拒否した状況）');
  engine.play('win');
  assert.ok(stats.oscillators > 0, 'それでもノードは作る（次の操作で鳴る）');
});

test('音: 音を出せない環境（AudioContext なし）でも落ちない', () => {
  const engine = createAudioEngine({ AudioContextClass: null, mediaElementClass: null });
  assert.equal(engine.unlock(), null);
  engine.play('win');
  engine.wake();
  engine.setMuted(true);
  engine.setMuted(false);
  assert.equal(engine.state, 'idle');
});

test('音: ネイティブ（JankenAudio）があれば操作のたびに起こす', () => {
  const audio = read('src/audio.js');
  assert.ok(audio.includes("NATIVE_PLUGIN = 'JankenAudio'"));
  assert.ok(/window\.Capacitor[\s\S]{0,120}Plugins/.test(audio), 'Capacitor のプラグインを呼ぶ');
  assert.ok(/unlock\(\)[\s\S]{0,400}activateNative\(\)/.test(audio), 'unlock で呼ぶ');
});

test('音: iOS 側は Audio Session を playback で起こし直し、JankenAudio を登録する', () => {
  const swift = read('ios/App/App/AppDelegate.swift');
  assert.ok(swift.includes('import AVFoundation'));
  assert.ok(swift.includes('AVAudioSession.sharedInstance()'));
  assert.ok(swift.includes('.playback'), '消音スイッチで止まらないカテゴリ');
  assert.ok(swift.includes('static func activateAudioSession()'), '起こし直す入口');
  assert.ok(/applicationDidBecomeActive[\s\S]{0,220}activateAudioSession\(\)/.test(swift), '復帰で起こす');
  assert.ok(swift.includes('@objc(JankenAudioPlugin)'));
  assert.ok(swift.includes('jsName = "JankenAudio"'));
  assert.ok(swift.includes('registerPluginInstance(JankenAudioPlugin())'), 'ブリッジに登録する');
  assert.ok(swift.includes('CAPPluginMethod(name: "activate"'), 'activate を公開する');
});

test('音: main.js が操作・復帰・設定のテストで音を起こす', () => {
  const main = read('src/main.js');
  assert.ok(/pointerdown[\s\S]{0,160}sound\.unlock\(\)/.test(main), 'タップのたびに起こす');
  assert.ok(/visibilitychange[\s\S]{0,240}sound\.wake\(\)/.test(main), '復帰で起こし直す');
  assert.ok(main.includes("$('#set-sound-test')"), '設定の「音をテスト」');
  assert.ok(main.includes("sound.play('fanfare')"));
  assert.ok(/sound\.sessionType/.test(main), 'Audio Session の種類を画面に出す');
  /* タイトルのスピーカーボタンと設定の行は同じスイッチ */
  assert.ok(/sound\.setMuted\(!soundOn\)/.test(main));
});

test('音: 設定に「音をテスト」の行があり、12言語ぶんの文言がある', () => {
  const html = read('index.html');
  assert.ok(html.includes('id="set-sound-test"'));
  assert.ok(html.includes('id="set-sound-test-state"'));
  assert.ok(KEYS.includes('settings.soundTest'));
  for (const locale of LOCALES) {
    const value = DICT[locale.id]['settings.soundTest'];
    assert.equal(typeof value, 'string', `${locale.id}`);
    assert.ok(value.trim().length > 0, `${locale.id} が空`);
  }
});

/* ================================================================== *\
 * 2. CPU 練習の秒数（7 / 5 / 3 / 2）
 * ================================================================== */

test('CPU: 初級7秒・中級5秒（初期値）・上級3秒・最強2秒', () => {
  assert.equal(LEVELS.easy.thinkingTimeMs, 7000);
  assert.equal(LEVELS.normal.thinkingTimeMs, 5000);
  assert.equal(LEVELS.hard.thinkingTimeMs, 3000);
  assert.equal(LEVELS.master.thinkingTimeMs, 2000);
  const main = read('src/main.js');
  assert.ok(/level\.thinkingTimeMs \/ 1000\)\.toFixed\(1\)/.test(main), '画面は秒で出す（7.0s / 5.0s…）');
  const html = read('index.html');
  assert.ok(html.includes('NORMAL ・ 5.0秒 ・ CLASSIC'), 'ホームの初期表示も中級5秒');
  assert.ok(!html.includes('NORMAL ・ 7.0秒'), '古い表示が残っていない');
});

/* ================================================================== *\
 * 3. 文字サイズ「特大」のレイアウト
 * ================================================================== */

test('特大: 「回戦数 / CPUの強さ」の行が折り返しで崩れない', () => {
  const css = read('styles.css');
  assert.ok(/\.panel-row \{[^}]*flex-wrap: wrap/.test(css), '足りなければ次の行へ落とす');
  assert.ok(/\.panel-label \{[^}]*white-space: nowrap/.test(css), 'ラベルは途中で割らない');
  assert.ok(/\.seg button \{[\s\S]{0,400}white-space: nowrap/.test(css), 'セグメントの文字も割らない');
  const html = read('index.html');
  assert.ok(html.includes('id="level-note"'), '「回戦数 / CPUの強さ」の見出し');
  assert.ok(html.includes('id="rounds-seg"'));
});

test('特大: 戦績の「チョキ」が2行に割れない（名前の列は中身に合わせる）', () => {
  const css = read('styles.css');
  assert.ok(
    /\.handrow \{[^}]*grid-template-columns: 20px auto minmax\(40px, 1fr\)/.test(css),
    '名前の列は auto（40px 固定にしない）',
  );
  assert.ok(/\.handrow__name \{[^}]*white-space: nowrap/.test(css), '「チョキ」を1行で');
  const main = read('src/main.js');
  assert.ok(main.includes('handrow__name'), '行の組み立ては main.js');
});

test('特大: プレイ中の案内が残り秒数と重ならない', () => {
  const css = read('styles.css');
  assert.ok(/\.timer__hint \{[^}]*min-width: 0/.test(css), '案内は残り秒数の手前で折り返す');
  assert.ok(/\.timer__row \{[^}]*gap: 8px/.test(css));
});

/* ================================================================== *\
 * 4. その手を出したときの勝率
 * ================================================================== */

test('手の勝率: 勝敗を手ごとに数え、あいこは勝率の分母から外す', () => {
  const profile = defaultProfile();
  const next = applyMatch(profile, {
    matchPoints: 10,
    verdict: 'win',
    rounds: 5,
    hands: ['rock', 'rock', 'paper'],
    handRounds: [
      { hand: 'rock', outcome: 'win' },
      { hand: 'rock', outcome: 'tie' },
      { hand: 'paper', outcome: 'lose' },
    ],
  });
  assert.deepEqual(next.handResults.rock, { wins: 1, losses: 0, ties: 1 });
  assert.deepEqual(next.handResults.paper, { wins: 0, losses: 1, ties: 0 });
  assert.equal(handWinRate(next.handResults, 'rock'), 1, '1勝0敗（あいこは除く）');
  assert.equal(handWinRate(next.handResults, 'paper'), 0);
  assert.equal(handWinRate(next.handResults, 'scissors'), null, '出していない手は —');
  assert.deepEqual(handResultOf(next.handResults, 'scissors'), { wins: 0, losses: 0, ties: 0 });

  /* あいこだけの手は「勝率 —」 */
  const tieOnly = applyMatch(profile, { hands: ['scissors'], handRounds: [{ hand: 'scissors', outcome: 'tie' }] });
  assert.equal(handWinRate(tieOnly.handResults, 'scissors'), null);
  assert.deepEqual(tieOnly.handResults.scissors, { wins: 0, losses: 0, ties: 1 });

  /* 2勝1敗 → 67% */
  const mixed = applyMatch(profile, {
    hands: ['rock', 'rock', 'rock'],
    handRounds: [
      { hand: 'rock', outcome: 'win' },
      { hand: 'rock', outcome: 'win' },
      { hand: 'rock', outcome: 'lose' },
    ],
  });
  assert.equal(Math.round(handWinRate(mixed.handResults, 'rock') * 100), 67);
});

test('手の勝率: パーティーの手は勝率に入れない（回数だけ数える）', () => {
  const profile = defaultProfile();
  const afterParty = applyParty(profile, { points: 5, hands: ['rock', 'rock'] });
  assert.equal(afterParty.handCounts.rock, 2, '手の率には入る');
  assert.deepEqual(afterParty.handResults, {}, '勝率は1対1だけ');
});

test('手の勝率: 保存・読み込みで壊れない（古いプロフィールは空から）', () => {
  assert.equal(PROFILE_VERSION, 6);
  const fresh = defaultProfile();
  assert.deepEqual(fresh.handResults, {});

  const kept = sanitizeProfile({ ...fresh, handResults: { rock: { wins: 3, losses: 1, ties: 2 }, bad: 'x' } });
  assert.deepEqual(kept.handResults, { rock: { wins: 3, losses: 1, ties: 2 } });

  const legacy = sanitizeProfile({ version: 5, handCounts: { rock: 4 } });
  assert.deepEqual(legacy.handResults, {}, 'Build 2 以前のデータでも落ちない');
});

test('手の勝率: 戦績シートに「勝率」の行が出る（main.js / index.html）', () => {
  const main = read('src/main.js');
  assert.ok(main.includes('handrow__win'), '行の下に勝率を出す');
  assert.ok(/handRowsHtml\(counts, HAND_SERIES, \{ results: app\.profile\.handResults/.test(main), '戦績は端末の記録を使う');
  assert.ok(main.includes('あいこを除いた勝負'), 'あいこを除く旨を明記');
  assert.ok(main.includes('勝率'), '文言');
});

/* ================================================================== *\
 * 5. ランキングの凡例（3色バー）
 * ================================================================== */

test('凡例: ランキングに ✊✌️✋ の色凡例があり、バーと同じ色を使う', () => {
  const html = read('index.html');
  assert.ok(html.includes('id="rank-legend"'), '凡例の入れ物');
  const main = read('src/main.js');
  assert.ok(main.includes('function renderRankLegend'), '中身は main.js が描く');
  assert.ok(/renderRankLegend\(locked\)/.test(main), 'ランキングを描くたびに更新');
  assert.ok(/HAND_SERIES\.map/.test(main), 'グー / チョキ / パーの順');
  assert.ok(/HAND_COLORS\[hand\]/.test(main), '色はバーと同じ定数から');
  /* 3色が実際に違う色であること */
  assert.equal(new Set(HAND_SERIES.map((hand) => HAND_COLORS[hand])).size, 3);
  assert.deepEqual(HAND_SERIES, ['rock', 'scissors', 'paper']);
  const css = read('styles.css');
  assert.ok(/\.rank-legend \{/.test(css));
  assert.ok(/\.rank-legend__item i \{/.test(css), '色の見本');
});

/* ================================================================== *\
 * 6. 勝率ランキングは5戦以上
 * ================================================================== */

test('勝率: 5戦未満は圏外で、あと何戦かを出す', () => {
  assert.equal(MIN_WINRATE_MATCHES, 5);
  assert.equal(isRankedIn({ matches: 4 }, 'winrate'), false);
  assert.equal(isRankedIn({ matches: 5 }, 'winrate'), true);
  assert.equal(matchesToWinRateRank(0), 5);
  assert.equal(matchesToWinRateRank(3), 2);

  const luck = leaderboard({
    metric: 'winrate',
    player: { nickname: 'LUCK', countryCode: 'JP', points: 12, matches: 1, wins: 1, winRate: 1 },
  });
  const me = luck.find((row) => row.isYou);
  assert.equal(me.rank, null, '1戦1勝では順位を持たない');
  assert.equal(formatMetric(me, 'winrate'), '—');

  const solid = leaderboard({
    metric: 'winrate',
    player: { nickname: 'SOLID', countryCode: 'JP', points: 60, matches: 8, wins: 6, winRate: 0.75 },
  });
  const ace = solid.find((row) => row.isYou);
  assert.equal(typeof ace.rank, 'number');
  assert.equal(ace.rank, 1);
});

test('勝率: 画面に「5戦以上で対象」と「あとN戦」が出る', () => {
  const main = read('src/main.js');
  assert.ok(/勝率ランキングは\$\{MIN_WINRATE_MATCHES\}戦以上が対象です/.test(main));
  assert.ok(main.includes('あと${needMatches}戦'), '圏外はあと何戦かを出す');
  assert.ok(main.includes('圏外'), '圏外の表示');
  assert.ok(main.includes('rank-row__outside'), '行にも5戦未満の印');
  const html = read('index.html');
  assert.ok(html.includes('id="rank-note"'), '※の案内の場所');
  const css = read('styles.css');
  assert.ok(/\.rank-note \{/.test(css));
  assert.ok(/\.rank-row__outside \{/.test(css));
});

/* ================================================================== *\
 * 7. ビルド番号とワークフロー
 * ================================================================== */

test('ビルド: アプリも iOS プロジェクトも Build 4', () => {
  const pbx = read('ios/App/App.xcodeproj/project.pbxproj');
  const numbers = [...pbx.matchAll(/CURRENT_PROJECT_VERSION = (\d+);/g)].map((m) => Number(m[1]));
  assert.equal(numbers.length, 2, 'Debug / Release の2箇所');
  assert.deepEqual(numbers, [4, 4]);
  assert.ok(pbx.includes('MARKETING_VERSION = 1.0.0;'));
  assert.ok(/version: '1\.0\.0',\s*build: 4,/.test(read('src/main.js')));
  assert.ok(read('index.html').includes('(Build 4)'));
});

test('ワークフロー: docs/ios-testflight-build3.yml は番号を自動で読み、Build 3 の検査を持つ', () => {
  const path = 'docs/ios-testflight-build3.yml';
  assert.ok(exists(path), 'Build 3 用のワークフロー');
  const yml = read(path);
  assert.equal(yml.split('\n')[0], '# JANKeN PoN iOS TestFlight Build 3');
  assert.equal(/BUILD_NUMBER:\s*"\d+"/.test(yml), false, 'ビルド番号を固定しない');
  assert.ok(yml.includes('CURRENT_PROJECT_VERSION'), 'pbxproj から読む');
  assert.ok(/Read the build number from the iOS project/.test(yml));
  for (const needle of [
    'navigator.audioSession',
    'SILENT_WAV',
    'JankenAudio',
    'thinkingTimeMs: 7000',
    'thinkingTimeMs: 5000',
    'handResults',
    'handWinRate',
    'rank-legend',
    'MIN_WINRATE_MATCHES = 5',
  ]) {
    assert.ok(yml.includes(needle), `${needle} が検査に入っている`);
  }
  assert.ok(yml.includes('janken-pon-testflight-build3-evidence'));
  /* Build 2 の契約（前の見張り）も残す */
  for (const needle of ['env(safe-area-inset-top', 'data-text-size', 'countryLocked', 'id="pks-cells"', 'btn-chant-toggle', "id: 'weekly'", 'rampMaster']) {
    assert.ok(yml.includes(needle), `${needle} が残っている`);
  }
});

test('ワークフロー: いま GitHub にある Build 2 用の見張りも Build 3 を通す', () => {
  /* Build 2 のワークフローは番号を自動で読むので、そのままでも Build 3 を配信できる。
     ここでは固定文字列（Build 2 を弾く条件）が無いことを確かめる。 */
  const yml = read('docs/ios-testflight-build2.yml');
  assert.equal(/CURRENT_PROJECT_VERSION = 2;/.test(yml), false);
  assert.equal(/BUILD_NUMBER:\s*"\d+"/.test(yml), false);
  assert.ok(yml.includes('CURRENT_PROJECT_VERSION'));
});


/* ================================================================== *\
 * 8. 「これで決定（ロック）」ボタン
 * ================================================================== */

test('決定: 手を選ぶと「これで決定」が出て、押すとすぐ確定する', () => {
  const html = read('index.html');
  assert.ok(html.includes('id="btn-lock"'), '1対1の決定ボタン');
  assert.ok(html.includes('id="btn-party-lock"'), 'パーティーの決定ボタン');
  assert.ok(html.includes('data-i18n="play.lock"'));
  assert.ok(html.includes('data-i18n="play.lockHint"'), '押さなければ選び直せる旨');
  assert.ok(html.includes('hidden'), '最初は出さない');

  const main = read('src/main.js');
  assert.ok(main.includes('function renderLockButton'), '手を選んだときだけ出す');
  assert.ok(/app\.selectedHand \? app\.selectedHand : null|app\.selectedHand : null/.test(main) || main.includes("app.phase === 'thinking' ? app.selectedHand : null"));
  assert.ok(/\$\('#btn-lock'\)\?\.addEventListener\('click'/.test(main), '決定の押下');
  assert.ok(/\$\('#btn-party-lock'\)\?\.addEventListener\('click'/.test(main));
  assert.ok(/commitRound\(\)/.test(main) && /commitPartyHand\(\)/.test(main), '確定の処理へ進む');
  /* 選んだ・締切で確定・次のラウンド開始で出し入れが揃う */
  assert.ok((main.match(/renderLockButton\(\);/g) ?? []).length >= 5, '選ぶ/確定/開始で描き直す');
});

test('決定: 文言が12言語そろっている', () => {
  for (const key of ['play.lock', 'play.lockHint']) {
    assert.ok(KEYS.includes(key), `${key} が KEYS にある`);
    for (const locale of LOCALES) {
      const value = DICT[locale.id][key];
      assert.equal(typeof value, 'string', `${locale.id} / ${key}`);
      assert.ok(value.trim().length > 0, `${locale.id} / ${key} が空`);
    }
  }
});

/* ================================================================== *\
 * 9. パーティーの国内（無料）/ 世界（PRO）
 * ================================================================== */

test('パーティー: 無料は国内・PRO は世界を選べる（pro.js）', async () => {
  const pro = await import('../src/pro.js');
  assert.equal(pro.canPlayParty(false), true, '国内は無料');
  assert.equal(pro.canPlayDomesticParty(), true);
  assert.equal(pro.canPlayWorldParty(false), false);
  assert.equal(pro.canPlayWorldParty(true), true);
  assert.deepEqual(pro.partyScopesFor(false), ['domestic']);
  assert.deepEqual(pro.partyScopesFor(true), ['domestic', 'world']);
});

test('パーティー: 画面に国内/世界の切り替えがあり、範囲を通信へ渡す', () => {
  const html = read('index.html');
  assert.ok(html.includes('id="party-scope-seg"'), '国内/世界の切り替え');
  assert.ok(html.includes('id="party-scope-note"'), '説明');
  const main = read('src/main.js');
  assert.ok(main.includes('function renderPartyScope'));
  assert.ok(main.includes('function setPartyScope'));
  assert.ok(/openParty\(\{ code, profile: app\.profile, scope: app\.party\.scope \}\)/.test(main), '部屋を作るときに範囲を渡す');
  assert.ok(/scope: app\.party\.scope \}\)/.test(main), '合言葉で入るときも同じ範囲');
  /* パーティーのカードは無料でも押せる（PRO の鍵は世界だけ） */
  assert.ok(!/mode === 'party' && !isPro\(\)/.test(main), '国内パーティーを PRO で止めない');
  assert.ok(!html.includes('mode-card__pro'), 'パーティーのカードから PRO バッジを外す');
});

test('パーティー: 世界パーティーは PRO だけが部屋を開ける（online.js）', async () => {
  const online = await import('../src/online.js');
  const session = new online.OnlineSession({ client: { clientId: 'x', subscribe() {}, broadcast() {} } });
  const refused = session.openParty({ code: 'ABCD', profile: { pro: false, countryCode: 'JP' }, scope: 'world' });
  assert.equal(refused, null);
  assert.equal(session.mode, null);
  const allowed = session.openParty({ code: 'ABCD', profile: { pro: true, countryCode: 'JP' }, scope: 'world' });
  assert.equal(allowed, 'janken-party:world:ABCD');
});

/* ================================================================== *\
 * 10. 通信の作り直し（設計点検で見つかった実際の不具合）
 * ================================================================== */

test('通信: 「cpu hand null」で止まる競合を直している（相手の手が締切と同時に届く）', () => {
  const main = read('src/main.js');
  assert.ok(main.includes('async function revealRound(cpuHand = app.roundCpu)'), '開く手を引数で受け取る');
  assert.ok(/await revealRound\(cpuHand\)/.test(main), 'かけ声からは同じ手を渡す');
  assert.ok(main.includes('if (!HAND_META[cpuHand]) return;'), '手が無いまま開かない');
});

test('通信: 組んだあと、相手の姿を見るまで待機チャンネルを離れない', () => {
  const online = read('src/online.js');
  assert.ok(online.includes('releaseWaiting()'), '相手を見たら離れる');
  assert.ok(/this\.waitingChannel = waiting/.test(online), '待機チャンネルを覚えておく');
  assert.ok(/handleMatchPresence[\s\S]{0,600}releaseWaiting\(\)/.test(online), '相手を見たら離す');
  assert.ok(/handleMatchBroadcast[\s\S]{0,900}releaseWaiting\(\)/.test(online), 'hello でも離す');
  assert.ok(online.includes('MATCH_JOIN_WAIT_MS'), '相手が来ないときの打ち切り');
});

test('通信: 合言葉の部屋は後から入った人も自分から組む（pair 電文の取りこぼし対策）', () => {
  const online = read('src/online.js');
  assert.ok(/this\.pairWith\(first \? keys\[1\] : keys\[0\]/.test(online), '部屋は2人とも入る');
  assert.ok(/const partner = firstKey === mine \? keys\[pairStart \+ 1\] : firstKey;/.test(online), 'クイックも両側から');
});

test('通信: 送れなかった手は記録せず、戻ったら送り直す', () => {
  const online = read('src/online.js');
  assert.ok(/const sent = this\.client\.broadcast\(this\.matchName, 'pick'/.test(online));
  assert.ok(/if \(!sent\) return false;/.test(online), '送れない手を出したことにしない');
  assert.ok(/for \(const \[index, hand\] of this\.myPicks\)/.test(online), '復帰で送り直す');
});

test('パーティー: 定員4人を超えたら入れない・途中参加も入れない', () => {
  const online = read('src/online.js');
  assert.ok(/roster\.length > PARTY_MAX_PLAYERS/.test(online));
  assert.ok(/type: 'party-full'/.test(online));
  assert.ok(/if \(this\.started && this\.players\.length\)/.test(online), '試合中の途中参加を切る');
  const main = read('src/main.js');
  assert.ok(/case 'party-full'/.test(main), '画面でも知らせる');
});
