/**
 * JANKeN PoN — Build 2 の確定仕様テスト
 *
 * トモアキさんの実機動画（2026-11-22 07:15）で見つかった8点を、コードと
 * ファイルの両方で担保する:
 *   1. ノッチ／カメラ被りを無くすセーフエリア対応と縦スクロール
 *   2. 設定の「文字サイズ」（標準 / 大 / 特大）と即時反映
 *   3. サウンド ON/OFF が確実に効く（マスターゲイン・iOS の消音スイッチ）
 *   4. 国籍は初回登録後ロック・ニックネームだけ変更できる
 *   5. 自分（YOU）が左・相手が右
 *   6. 週間ランキング（総合・月別・週間・勝率）
 *   7. PK戦風の「出した手」履歴ボード
 *   8. かけ声の切替（自分の国 ⇄ 相手の国、既定は自分）
 *
 *   npm test
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  pkBoard,
  pkTally,
  nextChantSide,
  normalizeChantSide,
  CHANT_SIDES,
  ROUND_MARKS,
  createMatch,
  playRound,
  resolveCommit,
  ROUNDS_PER_MATCH,
} from '../src/core.js';
import {
  createProfileStore,
  createMemoryBackend,
  defaultProfile,
  defaultDivision,
  applyMatch,
  applyParty,
  worldOf,
  entryFor,
  weekKey,
  TEXT_SCALES,
  normalizeTextScale,
  setTextScale,
  setChantSide,
  registerCountry,
  lockCountry,
  canChangeCountry,
  sanitizeProfile,
  STORAGE_KEY,
} from '../src/storage.js';
import { RANK_METRICS, leaderboard, metricValue, normalizePeers, rivalsFor } from '../src/ranking.js';
import { createAudioEngine } from '../src/audio.js';
import { FALLBACK_PRICES, fallbackPrice, canPlayWorld } from '../src/pro.js';
import { LOCALES, KEYS, DICT, PROSE } from '../src/i18n.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(ROOT, path), 'utf8');
const exists = (path) => existsSync(resolve(ROOT, path));

/* ------------------------------------------------------------------ *\
 * 1. セーフエリア（ノッチ／カメラ被り）
 * ------------------------------------------------------------------ */

test('セーフエリア: viewport-fit=cover と env(safe-area-inset-*) を使う', () => {
  const html = read('index.html');
  assert.ok(/viewport-fit=cover/.test(html), 'viewport-fit=cover がある');
  const css = read('styles.css');
  assert.ok(css.includes('env(safe-area-inset-top'), '上のセーフエリアを使う');
  assert.ok(css.includes('env(safe-area-inset-bottom'), '下のセーフエリアを使う');
  assert.ok(css.includes('env(safe-area-inset-left'), '横向きの左');
  assert.ok(css.includes('env(safe-area-inset-right'), '横向きの右');
  assert.ok(css.includes('--safe-t'), '共通の変数にして全画面で使う');
  /* 全画面（.screen）の padding が --safe-t から始まる = カメラの下から描く */
  const screenRule = css.match(/\.screen \{[^}]*\}/);
  assert.ok(screenRule, '.screen のルールがある');
  assert.ok(/padding:[^;]*var\(--safe-t\)/.test(screenRule[0]), '画面の上余白がセーフエリア');
  assert.ok(/var\(--safe-b\)/.test(screenRule[0]), '画面の下余白がセーフエリア');
});

test('セーフエリア: 画面が収まらないときは縦スクロールで全体を見られる', () => {
  const css = read('styles.css');
  const screenRule = css.match(/\.screen \{[^}]*\}/)[0];
  assert.ok(/overflow-y:\s*auto/.test(screenRule), '.screen は縦スクロールできる');
  assert.ok(css.includes('-webkit-overflow-scrolling: touch'), 'iOS の慣性スクロール');
  const playRule = css.match(/\.screen--play \{[^}]*\}/)[0];
  assert.ok(/overflow-y:\s*auto/.test(playRule), 'プレイ画面も切れない');
});

test('セーフエリア: 小さい画面の詰めルールでもセーフエリアを消さない', () => {
  const css = read('styles.css');
  const small = css.match(/@media \(max-height: 780px\) \{[^]*?\n\}/);
  assert.ok(small, 'max-height: 780px のルールがある');
  assert.ok(/padding-top:\s*calc\(var\(--safe-t\)/.test(small[0]), '小さい画面でも上はセーフエリア');
});

/* ------------------------------------------------------------------ *\
 * 2. 文字サイズ
 * ------------------------------------------------------------------ */

test('文字サイズ: 標準 / 大 / 特大 の3段階で、保存される', () => {
  assert.deepEqual([...TEXT_SCALES], ['standard', 'large', 'xlarge']);
  assert.equal(defaultProfile().textScale, 'standard');
  assert.equal(normalizeTextScale('large'), 'large');
  assert.equal(normalizeTextScale('こわれた値'), 'standard');
  assert.equal(setTextScale(defaultProfile(), 'xlarge').textScale, 'xlarge');
  assert.equal(sanitizeProfile({ textScale: 'xlarge' }).textScale, 'xlarge');
  assert.equal(sanitizeProfile({ textScale: 'huge' }).textScale, 'standard', '知らない値は標準に戻す');
});

test('文字サイズ: 保存して読み戻せる', () => {
  const backend = createMemoryBackend();
  const store = createProfileStore(backend);
  store.save({ ...defaultProfile(), textScale: 'large' });
  assert.equal(store.load().textScale, 'large');
});

test('文字サイズ: CSS の倍率（--ts）で、主要な文字が拡大される', () => {
  const css = read('styles.css');
  assert.ok(/--ts:\s*1;/.test(css), '既定は 1 倍');
  assert.ok(/html\[data-text-size="large"\]\s*\{\s*--ts:\s*1\.16/.test(css));
  assert.ok(/html\[data-text-size="xlarge"\]\s*\{\s*--ts:\s*1\.32/.test(css));
  assert.ok(/font-size:\s*calc\([0-9.]+px \* var\(--ts\)\)/.test(css), 'px 指定の文字が倍率で伸びる');
  /* 遊び方の説明（howto）の本文も拡大対象 */
  assert.ok(/\.howto span \{[^}]*calc\([0-9.]+px \* var\(--ts\)\)/.test(css), 'あそびかたの本文');
});

test('文字サイズ: 設定に3つのボタンがあり、main.js が html に反映する', () => {
  const html = read('index.html');
  for (const size of TEXT_SCALES) {
    assert.ok(html.includes(`data-text-size="${size}"`), `${size} のボタン`);
  }
  assert.ok(html.includes('id="text-size-seg"'));
  const main = read('src/main.js');
  assert.ok(main.includes('document.documentElement.dataset.textSize'), 'html の data-text-size を切り替える');
  assert.ok(main.includes('changeTextScale'), '設定から呼べる');
});

/* ------------------------------------------------------------------ *\
 * 3. サウンド ON/OFF
 * ------------------------------------------------------------------ */

function fakeAudio() {
  const stats = { oscillators: 0, buffers: 0, started: 0, resumes: 0, masterGain: 0.22, state: 'suspended' };

  class FakeParam {
    constructor(value = 0) {
      this.value = value;
    }
    setValueAtTime(value) {
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
      this.state = 'suspended';
      this.sampleRate = 48000;
      this.currentTime = 0;
      this.destination = new FakeNode();
      stats.context = this;
    }
    createGain() {
      const node = new FakeNode();
      node.gain = new FakeParam(1);
      if (!stats.masterCreated) {
        stats.masterCreated = true;
        stats.master = node.gain;
      }
      return node;
    }
    createOscillator() {
      const node = new FakeNode();
      node.type = 'sine';
      node.frequency = new FakeParam(440);
      node.start = () => {
        stats.oscillators += 1;
        stats.started += 1;
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
        stats.started += 1;
      };
      node.stop = () => {};
      return node;
    }
    resume() {
      stats.resumes += 1;
      this.state = 'running';
      return Promise.resolve();
    }
  }

  return { FakeAudioContext, stats };
}

test('サウンド: OFF にするとその場で無音になり、ON で戻る', () => {
  const { FakeAudioContext, stats } = fakeAudio();
  const engine = createAudioEngine({ AudioContextClass: FakeAudioContext });

  engine.unlock();
  assert.equal(engine.state, 'running', 'ユーザー操作で AudioContext が起きる');
  assert.equal(engine.gain, 1, 'ON のときはゲートが開いている');

  engine.play('click');
  const afterOn = stats.started;
  assert.ok(afterOn > 0, 'ON のときは音が出る');

  engine.setMuted(true);
  assert.equal(engine.muted, true);
  engine.play('win');
  assert.equal(stats.started, afterOn, 'OFF のときは新しい音を作らない');
  assert.equal(engine.gain, 0, 'ゲートが 0 になる（鳴っている途中の音も消える）');

  engine.setMuted(false);
  assert.equal(engine.muted, false);
  engine.play('click');
  assert.ok(stats.started > afterOn, 'ON に戻すと鳴る');
  assert.equal(engine.gain, 1, 'ゲートが元に戻る（0.0001 のまま戻らない作り）');
  assert.ok(engine.volume > 0.1, 'マスターの音量そのものは動かない');
});

test('サウンド: 起動時ミュートでも、あとから ON にできる', () => {
  const { FakeAudioContext, stats } = fakeAudio();
  const engine = createAudioEngine({ AudioContextClass: FakeAudioContext, muted: true });
  engine.unlock();
  engine.play('click');
  /* unlock() の無音バッファは鳴らすが、聞こえる音（オシレーター）は作らない */
  assert.equal(stats.oscillators, 0, '起動時に OFF なら鳴らない');
  assert.equal(engine.gain, 0, 'ゲートは閉じたまま');
  engine.setMuted(false);
  engine.play('click');
  assert.ok(stats.oscillators > 0, 'ON にすると鳴る');
  assert.equal(engine.gain, 1, 'ゲートが開く');
});

test('サウンド: 音が出せない環境でも落ちない', () => {
  const engine = createAudioEngine({ AudioContextClass: null });
  assert.equal(engine.unlock(), null);
  engine.play('win');
  engine.setMuted(true);
  engine.setMuted(false);
  engine.play('win');
  assert.equal(engine.state, 'idle');
});

test('サウンド: iOS は消音スイッチでも鳴るように AVAudioSession を設定する', () => {
  const swift = read('ios/App/App/AppDelegate.swift');
  assert.ok(swift.includes('import AVFoundation'));
  assert.ok(swift.includes('AVAudioSession.sharedInstance()'));
  assert.ok(swift.includes('.playback'), '消音スイッチで止まらないカテゴリ');
});

test('サウンド: 画面のボタンと設定の行が同じスイッチを見る', () => {
  const main = read('src/main.js');
  assert.ok(main.includes("$('#btn-sound')"));
  assert.ok(main.includes("$('#set-sound')"));
  assert.ok(/sound\.setMuted\(!soundOn\)/.test(main));
  /* 戻ってきたとき（visibilitychange）は wake() で起こし直す（Build 3） */
  assert.ok(/visibilitychange[\s\S]{0,240}sound\.wake\(\)/.test(main));
});

/* ------------------------------------------------------------------ *\
 * 4. 国籍ロック
 * ------------------------------------------------------------------ */

test('国籍: 初回登録でロックされ、以後は国を変えられない', () => {
  const fresh = defaultProfile();
  assert.equal(fresh.countryLocked, false, '最初は選べる');
  assert.equal(canChangeCountry(fresh), true);

  const registered = registerCountry(fresh, 'BR');
  assert.equal(registered.countryCode, 'BR');
  assert.equal(registered.countryLocked, true);
  assert.equal(canChangeCountry(registered), false);

  const again = registerCountry(registered, 'JP');
  assert.equal(again.countryCode, 'BR', 'ロック後は国が変わらない');
  assert.equal(again.countryLocked, true);
});

test('国籍: 初回プレイでいまの国が登録される（lockCountry）', () => {
  const locked = lockCountry({ ...defaultProfile(), countryCode: 'US' });
  assert.equal(locked.countryCode, 'US');
  assert.equal(locked.countryLocked, true);
  assert.equal(lockCountry(locked).countryCode, 'US');
});

test('国籍: ロックは保存データ側でも守られる（保存の入口で差し替えを拒む）', () => {
  const backend = createMemoryBackend();
  const store = createProfileStore(backend);
  store.save(registerCountry({ ...defaultProfile(), nickname: 'トモアキ' }, 'JP'));
  assert.equal(store.load().countryCode, 'JP');

  /* 外から国だけ差し替えようとしても、ロック済みの国が残る */
  store.save({ ...store.load(), countryCode: 'US' });
  assert.equal(store.load().countryCode, 'JP');
  assert.equal(store.load().countryLocked, true);
});

test('国籍: ロック後もニックネームは変えられる', () => {
  const backend = createMemoryBackend();
  const store = createProfileStore(backend);
  store.save(registerCountry({ ...defaultProfile() }, 'JP'));
  store.save({ ...store.load(), nickname: 'あたらしい名前' });
  const profile = store.load();
  assert.equal(profile.nickname, 'あたらしい名前');
  assert.equal(profile.countryCode, 'JP');
  assert.equal(profile.countryLocked, true);
});

test('国籍: 設定にニックネーム欄と、ロック表示つきの国籍行がある', () => {
  const html = read('index.html');
  assert.ok(html.includes('id="set-nickname"'), '設定のニックネーム（変更できる）');
  assert.ok(html.includes('id="set-country"'), '設定の国籍行');
  assert.ok(html.includes('id="country-lock-note"'), 'ロックの説明');
  assert.ok(html.includes('id="btn-country-confirm"'), '「この国で登録する」');
  const main = read('src/main.js');
  assert.ok(main.includes('canChangeCountry'), '画面側でもロックを見る');
  assert.ok(/toast\(T\('toast\.countryLocked'\)/.test(main), 'ロック後は理由を伝える');
});

/* ------------------------------------------------------------------ *\
 * 5. 左側が自分
 * ------------------------------------------------------------------ */

test('配置: YOU のカードが相手より先（＝左）にある', () => {
  const html = read('index.html');
  assert.ok(html.indexOf('id="you-pod"') < html.indexOf('id="cpu-pod"'), 'you-pod が左');
  const css = read('styles.css');
  assert.ok(/\.stamp-bubble--you \{ left:/.test(css), 'YOU のスタンプは左');
  assert.ok(/\.stamp-bubble--cpu \{ right:/.test(css), '相手のスタンプは右');
  assert.ok(/\.floatpts \{\s*position: absolute;\s*left:/.test(css), 'ポイントの浮き出しも左');
});

test('配置: アリーナは 左・中央・右 の3列で、YOU が1列目', () => {
  const css = read('styles.css');
  const arena = css.match(/\.arena \{[^}]*\}/)[0];
  assert.ok(/grid-template-columns:\s*1fr 32px 1fr/.test(arena));
  const html = read('index.html');
  const arenaBlock = html.slice(html.indexOf('class="arena"'), html.indexOf('class="play-chant"'));
  assert.ok(arenaBlock.indexOf('you-pod') < arenaBlock.indexOf('arena__mid'), 'YOU が左');
});

/* ------------------------------------------------------------------ *\
 * 6. 週間ランキング
 * ------------------------------------------------------------------ */

test('週間: 指標は 総合 / 月別 / 週間 / 勝率', () => {
  assert.deepEqual(RANK_METRICS.map((m) => m.id), ['total', 'monthly', 'weekly', 'winrate']);
  assert.ok(KEYS.includes('rank.weekly'));
  for (const locale of LOCALES) {
    assert.ok(DICT[locale.id]['rank.weekly'], `${locale.id} の週間`);
  }
});

test('週間: 月曜はじまりの週キーで集計し、週が変わると 0 に戻る', () => {
  /* 2026-11-22 は日曜。同じ週は 11-16（月）〜11-22（日） */
  assert.equal(weekKey(new Date(2026, 10, 22, 23, 0).getTime()), weekKey(new Date(2026, 10, 16, 0, 30).getTime()));
  assert.notEqual(weekKey(new Date(2026, 10, 22, 23, 0).getTime()), weekKey(new Date(2026, 10, 23, 0, 1).getTime()));

  const week1 = new Date(2026, 10, 18, 12, 0).getTime();
  const week2 = new Date(2026, 10, 25, 12, 0).getTime();
  let profile = applyMatch(defaultProfile(), { matchPoints: 9, verdict: 'win', rank: 40, rounds: 5, hands: ['paper'], at: week1 });
  assert.equal(worldOf(profile, '5').weekly.points, 9);
  assert.equal(worldOf(profile, '5').weekly.week, weekKey(week1));
  profile = applyMatch(profile, { matchPoints: 5, verdict: 'win', rank: 38, rounds: 5, hands: ['paper'], at: week1 + 3600_000 });
  assert.equal(worldOf(profile, '5').weekly.points, 14, '同じ週は足される');
  profile = applyMatch(profile, { matchPoints: 3, verdict: 'lose', rank: 39, rounds: 5, hands: ['rock'], at: week2 });
  assert.equal(worldOf(profile, '5').weekly.points, 3, '週が変われば 0 から');
  assert.equal(worldOf(profile, '5').points, 17, '総合はそのまま');
});

test('週間: 古い週のデータは読み込み時に捨てる', () => {
  const stale = { ...defaultDivision(), weekly: { week: '2020-W01', points: 99, matches: 9 } };
  const profile = sanitizeProfile({ world: { '5': stale, '3': defaultDivision() } });
  assert.equal(worldOf(profile, '5').weekly.points, 0);
  assert.equal(worldOf(profile, '5').weekly.week, weekKey());
});

test('週間: ライバルにも週間ポイントがあり、順位が変わる', () => {
  const rivals = rivalsFor('5');
  assert.ok(rivals.every((rival) => Number.isFinite(rival.weeklyPoints)));
  assert.ok(rivals.some((rival) => rival.weeklyPoints > 0));

  const player = { nickname: 'ME', countryCode: 'JP', points: 0, monthlyPoints: 0, weeklyPoints: 12, matches: 2, winRate: 1 };
  const weekly = leaderboard({ division: '5', metric: 'weekly', scope: 'domestic', player });
  assert.equal(metricValue(weekly.find((row) => row.isYou), 'weekly'), 12);
  const top = leaderboard({ division: '5', metric: 'weekly', scope: 'domestic', player })[0];
  assert.ok(metricValue(top, 'weekly') >= 12);
});

test('週間: 通信で受け取る行にも週間ポイントを通す', () => {
  const [row] = normalizePeers([{ id: 'peer-1', weeklyPoints: '7.6' }]);
  assert.equal(row.weeklyPoints, 8);
});

/* ------------------------------------------------------------------ *\
 * 7. PK戦風の履歴ボード
 * ------------------------------------------------------------------ */

test('PKボード: ラウンド順に 自分 → 相手 と結果記号を並べる', () => {
  let match = createMatch({ rounds: 5 });
  match = playRound(match, { playerHand: 'paper', cpuHand: 'rock' }); // win
  match = playRound(match, { playerHand: 'rock', cpuHand: 'paper' }); // lose
  match = playRound(match, { playerHand: 'rock', cpuHand: 'rock' }); // tie

  const board = pkBoard(match.history, match.rounds);
  assert.equal(board.length, 5, '未消化のラウンドも並べる');
  assert.deepEqual(
    board.map((cell) => cell.mark),
    ['○', '×', '△', '·', '·'],
  );
  assert.deepEqual(
    [board[0].playerHand, board[0].cpuHand],
    ['paper', 'rock'],
  );
  assert.equal(board[0].points, 5);
  assert.equal(board[3].done, false);
  assert.equal(board[3].playerHand, null);
  assert.deepEqual(pkTally(match.history), { wins: 1, losses: 1, ties: 1, done: 3 });
});

test('PKボード: 3回戦のマッチは3マス', () => {
  const board = pkBoard([], 3);
  assert.equal(board.length, 3);
  assert.ok(board.every((cell) => cell.mark === ROUND_MARKS.pending));
  assert.equal(pkBoard([], 5).length, ROUNDS_PER_MATCH);
});

test('PKボード: プレイ画面に常時表示の器がある（左が自分）', () => {
  const html = read('index.html');
  assert.ok(html.includes('id="pks"'), 'ボードがある');
  assert.ok(html.includes('id="pks-cells"'));
  assert.ok(html.indexOf('id="pks"') < html.indexOf('class="arena"'), 'アリーナの上に置く');
  const css = read('styles.css');
  assert.ok(css.includes('.pk__hands'), '自分の手と相手の手');
  assert.ok(css.includes('.pk__mark'), '○×△の記号');
  const main = read('src/main.js');
  assert.ok(main.includes('pkBoard('), 'main.js が pkBoard を使う');
});

/* ------------------------------------------------------------------ *\
 * 8. かけ声の切替
 * ------------------------------------------------------------------ */

test('かけ声: 既定は自分（左側）の国で、ボタンで相手の国に切り替わる', () => {
  assert.deepEqual([...CHANT_SIDES], ['self', 'opp']);
  assert.equal(defaultProfile().chantSide, 'self');
  assert.equal(normalizeChantSide('なにか'), 'self');
  assert.equal(nextChantSide('self'), 'opp');
  assert.equal(nextChantSide('opp'), 'self');
  assert.equal(setChantSide(defaultProfile(), 'opp').chantSide, 'opp');
  assert.equal(setChantSide(defaultProfile(), 'どこか').chantSide, 'self');
  assert.equal(sanitizeProfile({ chantSide: 'opp' }).chantSide, 'opp');
});

test('かけ声: 切替ボタンがプレイ画面にあり、main.js がつないでいる', () => {
  const html = read('index.html');
  assert.ok(html.includes('id="btn-chant-toggle"'), 'かけ声切替ボタン');
  assert.ok(html.includes('data-i18n-aria="play.chantToggle"'), '読み上げ用の名前');
  const main = read('src/main.js');
  assert.ok(main.includes('toggleChantSide'), '切替の処理');
  assert.ok(main.includes('renderChant'), 'かけ声の再描画');
  /* CPU 戦と通信対戦のどちらも同じ renderPlayChrome を通る */
  assert.ok(/function renderPlayChrome[\s\S]*renderChant\(\)/.test(main));
});

test('かけ声: 遊び方の説明が「自分の国（切替できる）」になっている', () => {
  assert.ok(PROSE.ja['howto.s3.title'].includes('自分'));
  assert.ok(PROSE.en['howto.s3.body'].includes('left'));
});

/* ------------------------------------------------------------------ *\
 * 9. 価格（PRO は ¥300）
 * ------------------------------------------------------------------ */

test('価格: フォールバックは ¥300（StoreKit の実価格が優先）', () => {
  assert.equal(FALLBACK_PRICES.ja, '¥300');
  assert.equal(fallbackPrice('ja'), '¥300');
  assert.equal(fallbackPrice('en'), '$1.99');
  for (const locale of LOCALES) assert.ok(fallbackPrice(locale.id), `${locale.id} の価格`);
  const html = read('index.html');
  assert.ok(html.includes('¥300'), 'PRO シートの初期表示も ¥300');
  assert.equal(html.includes('¥480'), false, '古い価格を残さない');
  const main = read('src/main.js');
  assert.ok(main.includes('app.profile.proPrice || price'), 'StoreKit の価格が来たらそちらを使う');
});

/* ------------------------------------------------------------------ *\
 * 10. ビルド番号とワークフロー
 * ------------------------------------------------------------------ */

test('ビルド: iOS プロジェクトもアプリも同じ Build 番号（Build 4）', () => {
  const pbx = read('ios/App/App.xcodeproj/project.pbxproj');
  const numbers = [...pbx.matchAll(/CURRENT_PROJECT_VERSION = (\d+);/g)].map((m) => Number(m[1]));
  assert.equal(numbers.length, 2, 'Debug / Release の2箇所');
  assert.deepEqual(numbers, [4, 4], 'Build 4');
  assert.ok(pbx.includes('MARKETING_VERSION = 1.0.0;'));
  const main = read('src/main.js');
  assert.ok(/version: '1\.0\.0',\s*build: 4,/.test(main), 'アプリ側の build も 4');
  const html = read('index.html');
  assert.ok(html.includes('(Build 4)'), '設定の版表示も Build 4');
});

test('ワークフロー: docs/ios-testflight-build2.yml がビルド番号を自動で読む', () => {
  const path = 'docs/ios-testflight-build2.yml';
  assert.ok(exists(path));
  const yml = read(path);
  assert.equal(yml.split('\n')[0], '# JANKeN PoN iOS TestFlight Build 2', '1行目は YAML コメント');
  assert.equal(/BUILD_NUMBER:\s*"\d+"/.test(yml), false, 'BUILD_NUMBER を固定文字列で持たない');
  assert.ok(yml.includes('CURRENT_PROJECT_VERSION'), 'pbxproj から読む');
  assert.ok(/Read the build number from the iOS project/.test(yml), '読み取りのステップがある');
  assert.ok(yml.includes('MARKETING_VERSION'), '表示バージョンも同じ場所から');
  assert.ok(yml.includes('echo "BUILD_NUMBER=$BUILD_NUMBER" >> "$GITHUB_ENV"'), '後続ステップへ渡す');
  /* 以前の契約はそのまま */
  assert.ok(yml.includes('BUNDLE_ID: jp.signlink.JankenPon'));
  assert.ok(yml.includes('name: JANKeN PoN iOS TestFlight'));
  assert.ok(yml.includes('confirm_bundle_id'));
  assert.ok(yml.includes('npm test'));
  assert.ok(yml.includes('npx cap sync ios'));
  assert.ok(yml.includes('altool --upload-app'));
  /* Build 2 の8項目がワークフローでも守られる */
  for (const needle of ['env(safe-area-inset-top', 'data-text-size', 'countryLocked', 'id="pks-cells"', 'btn-chant-toggle', "id: 'weekly'", 'rampMaster']) {
    assert.ok(yml.includes(needle), `${needle} が preflight の検査に入っている`);
  }
});

test('README が Build 2 の変更点を説明している', () => {
  const readme = read('README.md');
  assert.ok(readme.includes('Build 2'));
  assert.ok(readme.includes('¥300'));
});

/* ------------------------------------------------------------------ *\
 * 11. 締切まで何度でも選び直せる・かけ声の前に手を公開しない
 * ------------------------------------------------------------------ */

test('選び直し: 締切で「最後に選んだ手」が確定し、未選択ならランダム', () => {
  const fixed = () => 0.42; // 常に同じ手を返す決定的な乱数
  const selected = resolveCommit('scissors', { rng: fixed });
  assert.equal(selected.hand, 'scissors');
  assert.equal(selected.timedOut, false);
  assert.equal(selected.source, 'selected');

  /* 選び直しても、resolveCommit は最後の1つしか見ない */
  assert.equal(resolveCommit('paper', { rng: fixed }).hand, 'paper');

  const none = resolveCommit(null, { rng: fixed });
  assert.equal(none.timedOut, true, '未選択はタイムアウト扱い（ランダム）');
  assert.ok(['rock', 'scissors', 'paper'].includes(none.hand));
  assert.equal(resolveCommit('', { rng: fixed }).timedOut, true);
  assert.equal(resolveCommit('well', { rng: fixed }).timedOut, true, 'ルール外の手は受け付けない');
});

test('選び直し: タップは選択だけで、確定・送信・公開をしない', () => {
  const main = read('src/main.js');
  const body = main.match(/function selectHand\(hand\) \{[\s\S]*?\n\}/)[0];
  assert.ok(body.includes('app.selectedHand = hand'), '選択を覚える');
  assert.ok(body.includes("T('play.selected')"), '選び直せると案内する');
  assert.equal(body.includes('is-revealed'), false, '手を開かない');
  assert.equal(body.includes('runChant'), false, 'かけ声を始めない');
  assert.equal(body.includes('.pick('), false, '相手に送らない');
  assert.equal(body.includes('commitRound'), false, '確定しない');
  assert.equal(body.includes('stopTimer'), false, 'カウントは止めない');
});

test('選び直し: カウントが 0 になったときだけ確定する', () => {
  const main = read('src/main.js');
  const timeout = main.match(/function handleTimeout\(\) \{[\s\S]*?\n\}/)[0];
  assert.ok(timeout.includes('commitRound('), '締切で確定');
  assert.ok(/timedOut: !app\.selectedHand/.test(timeout), '選んでいればタイムアウトにしない');
  const commit = main.match(/async function commitRound\([\s\S]*?\n\}/)[0];
  assert.ok(commit.includes('resolveCommit(app.selectedHand'), '最後の選択で確定');
  assert.ok(commit.includes('stopTimer()'), 'ここでカウントを止める');
  assert.ok(commit.includes("app.online.session.pick("), '確定してから送る');
});

test('公開: かけ声の「ぽん！」で自分と相手の手が同時に開く', () => {
  const main = read('src/main.js');
  const open = main.match(/function openPods\(cpuHand\) \{[\s\S]*?\n\}/)[0];
  assert.ok(open.includes("$('#you-hand-img').src"), '自分の手');
  assert.ok(open.includes("$('#cpu-hand-img').src"), '相手の手');
  assert.ok(open.includes("$('#you-pod').classList.add('is-revealed')"));
  assert.ok(open.includes("$('#cpu-pod').classList.add('is-revealed')"));
  assert.equal((open.match(/is-revealed/g) ?? []).length, 2, '2つを同じ関数で開く');

  const chant = main.match(/async function chantAndReveal\([\s\S]*?\n\}/)[0];
  assert.ok(/runChant\(\{ onFinal: \(\) => openPods\(cpuHand\) \}\)/.test(chant), 'かけ声の最後の拍で開く');

  const run = main.match(/async function runChant\([\s\S]*?\n\}/)[0];
  assert.ok(/i === count - 1 && onFinal/.test(run), '最後の拍でコールバック');

  /* 手を開く場所は openPods と revealRound の安全策だけ */
  const reveals = main.match(/classList\.add\('is-revealed'\)/g) ?? [];
  assert.ok(reveals.length <= 4, `手を開く箇所が増えていない (${reveals.length})`);
});

test('公開: 通信対戦は確定前の中間選択を相手に送らない', () => {
  const main = read('src/main.js');
  /* カウント中（thinking）に pick を送るのは commitRound だけ */
  const thinkingBlock = main.slice(main.indexOf('function beginRound()'), main.indexOf('async function commitRound'));
  assert.equal(thinkingBlock.includes('.pick('), false, 'カウント中に送らない');
  const applyOnline = main.match(/async function applyOnlineRound\(event\) \{[\s\S]*?\n\}/)[0];
  assert.ok(/app\.phase === 'thinking' \|\| app\.phase === 'chant'/.test(applyOnline), '自分の締切前は相手の手も開かない');
  assert.ok(/if \(app\.phase !== 'waiting'\) return;/.test(applyOnline), '確定して待っているときだけ開く');
});

test('公開: パーティーも締切で確定し、途中の選択は送らない', () => {
  const main = read('src/main.js');
  const select = main.match(/function selectPartyHand\(hand\) \{[\s\S]*?\n\}/)[0];
  assert.equal(select.includes('partyPick'), false, '選んだだけでは送らない');
  const commit = main.match(/function commitPartyHand\([\s\S]*?\n\}/)[0];
  assert.ok(commit.includes('resolveCommit(app.party.selected'), '最後の選択で確定');
  assert.ok(commit.includes('session.partyPick('), '確定してから送る');
});

/* ------------------------------------------------------------------ *\
 * 12. 無料＝同じ国籍の国内だけ / 世界は PRO
 * ------------------------------------------------------------------ */

import { quickChannel } from '../src/online.js';

test('無料: 国内ルームは国コードで分かれ、他国のプレイヤーとは当たらない', () => {
  const jp = quickChannel({ scope: 'domestic', country: 'JP', rounds: 5 });
  const br = quickChannel({ scope: 'domestic', country: 'BR', rounds: 5 });
  const jp3 = quickChannel({ scope: 'domestic', country: 'JP', rounds: 3 });
  const world = quickChannel({ scope: 'world', country: 'JP', rounds: 5 });
  assert.ok(jp.includes('JP'), jp);
  assert.ok(br.includes('BR'), br);
  assert.notEqual(jp, br, '国籍が違えば別の部屋（当たらない）');
  assert.notEqual(jp, jp3, '回戦数でも分かれる');
  assert.notEqual(jp, world, '世界は別の部屋');
  assert.ok(world.includes('world'), world);
});

test('無料: 国内戦の結果は国内ランキングだけに入り、世界には入らない', () => {
  const free = { ...defaultProfile(), pro: false };
  const after = applyMatch(free, {
    matchPoints: 12, verdict: 'win', rank: 40, rounds: 5, hands: ['paper'], scope: 'domestic',
  });
  assert.equal(entryFor(after, '5', 'domestic').points, 12, '国内（同じ国籍）のランキングに加算');
  assert.equal(entryFor(after, '5', 'world').points, 0, '世界ランキングには 0 のまま');
  assert.equal(entryFor(after, '5', 'world').matches, 0, '世界の試合数も 0');
  assert.equal(worldOf(after, '5').points, 12, 'world = 国内の記録（互換）');
});

test('PRO: 世界戦の結果が世界ランキングに入る（国内とは別集計）', () => {
  let pro = { ...defaultProfile(), pro: true };
  pro = applyMatch(pro, { matchPoints: 7, verdict: 'win', rank: 30, rounds: 5, hands: ['rock'], scope: 'domestic' });
  pro = applyMatch(pro, { matchPoints: 10, verdict: 'win', rank: 20, rounds: 5, hands: ['paper'], scope: 'world' });
  assert.equal(entryFor(pro, '5', 'domestic').points, 7);
  assert.equal(entryFor(pro, '5', 'world').points, 10);
  assert.equal(entryFor(pro, '5', 'world').matches, 1);
  assert.equal(entryFor(pro, '5', 'domestic').matches, 1);
});

test('ランキング: 世界は世界戦のポイント、国内は自分の国だけ', () => {
  const fresh = { ...defaultProfile(), pro: true, countryCode: 'JP' };
  const player = {
    nickname: 'ME', countryCode: 'JP',
    points: entryFor(fresh, '5', 'world').points,
    monthlyPoints: 0, weeklyPoints: 0, matches: 0, winRate: 0,
  };
  const worldRows = leaderboard({ division: '5', metric: 'total', scope: 'world', player });
  const me = worldRows.find((row) => row.isYou);
  assert.equal(me.points, 0, '世界戦をしていない PRO は世界ランキング 0pt から');

  /* 国内は同じ国籍だけ */
  const domestic = leaderboard({ division: '5', metric: 'total', scope: 'domestic', player });
  assert.ok(domestic.every((row) => row.countryCode === 'JP'));
});

test('無料: 世界の部屋・世界ランキングには入れない（PRO の線引き）', () => {
  const main = read('src/main.js');
  assert.ok(/app\.online\.scope === 'world' && !isPro\(\)/.test(main), '画面からは世界を選べない');
  const onlineSrc = read('src/online.js');
  assert.ok(/this\.scope === 'world' && !profile\?\.pro/.test(onlineSrc), '通信側でも世界は PRO だけ');
  assert.equal(canPlayWorld(false), false);
  assert.equal(canPlayWorld(true), true);

  const html = read('index.html');
  assert.ok(html.includes('id="rank-locked"'), '世界ランキングのロック表示');
  assert.ok(html.includes('data-i18n="rank.freeNote"'), '無料は世界に載らない旨を明示');
  assert.ok(html.includes('data-i18n="online.sameCountry"'), '国内は同じ国籍だけと明示');
  for (const locale of LOCALES) {
    assert.ok(DICT[locale.id]['rank.freeNote'], `${locale.id} の説明`);
    assert.ok(DICT[locale.id]['online.sameCountry'], `${locale.id} の国内の説明`);
  }
});

test('無料: 相手が見つからないときの CPU フォールバック導線は残す', () => {
  const html = read('index.html');
  assert.ok(html.includes('id="btn-online-cpu"'), 'CPU練習へ のボタン');
  assert.ok(html.includes('id="btn-online-retry"'), 'もう一度さがす');
  const main = read('src/main.js');
  assert.ok(main.includes("case 'timeout':"), '30秒の打ち切り');
  assert.ok(main.includes("T('online.toCpu')"));
});

test('パーティーは国内にも世界にも加算されない（PRO でも）', () => {
  let profile = { ...defaultProfile(), pro: true };
  profile = applyMatch(profile, { matchPoints: 6, verdict: 'win', rank: 50, rounds: 5, hands: ['rock'], scope: 'world' });
  const before = { world: structuredClone(profile.world), global: structuredClone(profile.global) };
  profile = applyParty(profile, { points: 25, champion: true, hands: ['paper', 'paper'] });
  assert.deepEqual(profile.world, before.world, '国内の記録は変わらない');
  assert.deepEqual(profile.global, before.global, '世界の記録も変わらない');
  assert.equal(profile.party.matches, 1);
});
