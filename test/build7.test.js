/**
 * JANKeN PoN — Build 7 の確定仕様テスト
 *
 * Build 7 で入れたものを、ここで固定する:
 *   1. プレイ画面下部の案内（play.selected）を2行に整理
 *      - 日本語は「選択中（カウント終了で確定）」／「ほかの手をタップで変更できます」
 *      - 文言の `\n` を `.timer__hint` の white-space: pre-line で改行にする
 *        （「確/定」のように単語の途中で折り返さない）
 *      - 1対1 とパーティーの両方のタイマーが同じキーを使う
 *      - 12言語すべてが2行（`\n` を含む）で、ja の各行は 375 幅・特大でも1行に収まる長さ
 *   2. 「これで決定」ボタンの補足（play.lockHint）も2行に（「締/切」で割れない）
 *   3. PRO 画面「最強CPU（MASTER・2秒）」の説明を
 *      「最強CPUとお互いに手のクセを読み合う心理戦」に（2行・`<br>` 区切り）
 *      - core.js の LEVELS.master.blurbJa も同じ言い方に合わせる
 *   4. ビルド番号 7（pbxproj 2箇所・アプリ側・設定の版表示・www/ 同期）
 *
 * 実ブラウザでの見た目（2行・はみ出しなし・スクショ）は tools/shots-b7.mjs が確かめる。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { KEYS, DICT, LOCALES } from '../src/i18n.js';
import { LEVELS } from '../src/core.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(ROOT, path), 'utf8');
const exists = (path) => existsSync(resolve(ROOT, path));

const MAIN = read('src/main.js');
const HTML = read('index.html');
const CSS = read('styles.css');

/* ================================================================== *\
 * 1. プレイ画面下部の案内を2行に
 * ================================================================== */

test('文言: play.selected は日本語で2行（選択中／変更できます）', () => {
  const value = DICT.ja['play.selected'];
  assert.equal(typeof value, 'string');
  const lines = value.split('\n');
  assert.equal(lines.length, 2, '2行（`\\n` で区切る）');
  assert.equal(lines[0], '選択中（カウント終了で確定）');
  assert.equal(lines[1], 'ほかの手をタップで変更できます');
  /* 途中で折り返さない長さ（375 幅・特大 13.86px で 1行 ≒ 20.5文字まで） */
  for (const line of lines) assert.ok(line.length <= 18, `${line} は ${line.length} 文字`);
  assert.equal(value.includes(' — '), false, '長いダッシュで1行に詰めない');
});

test('文言: play.selected は12言語すべて2行で、空の行がない', () => {
  assert.ok(KEYS.includes('play.selected'));
  for (const locale of LOCALES) {
    const value = DICT[locale.id]['play.selected'];
    assert.equal(typeof value, 'string', `${locale.id}: 文字列`);
    const lines = value.split('\n');
    assert.equal(lines.length, 2, `${locale.id}: 2行`);
    for (const line of lines) assert.ok(line.trim().length > 0, `${locale.id}: 空の行がない`);
    /* 1行目は「いま選んでいる」、2行目は「いつ確定か」の役割分担 */
    assert.ok(lines[1].length <= 30, `${locale.id}: 2行目が長すぎない（${lines[1]}）`);
  }
});

test('CSS: `\\n` をそのまま改行にする（white-space: pre-line）', () => {
  const hint = CSS.match(/\.timer__hint\s*\{[^}]*\}/)[0];
  assert.match(hint, /white-space:\s*pre-line/, 'タイマーの案内');
  assert.match(hint, /line-height:\s*1\.35/, '2行の行間');
  assert.match(hint, /min-width:\s*0/, '残り秒数と重ならない（既存の作りを残す）');
  const lock = CSS.match(/\.lockbtn__hint\s*\{[^}]*\}/)[0];
  assert.match(lock, /white-space:\s*pre-line/, '決定ボタンの補足');
  assert.match(lock, /max-width:\s*52%/, 'ボタンの中で52%まで');
});

test('画面: 1対1 とパーティーのタイマーが同じ文言（play.selected）を使う', () => {
  assert.equal((MAIN.match(/\$\('#timer-hint'\)\.textContent = T\('play\.selected'\)/g) ?? []).length, 1, '1対1');
  assert.equal((MAIN.match(/\$\('#party-timer-hint'\)\.textContent = T\('play\.selected'\)/g) ?? []).length, 1, 'パーティー');
  assert.ok(HTML.includes('id="timer-hint"') && HTML.includes('id="party-timer-hint"'), '両方の要素がある');
  /* 選んだ手の案内は「選び直し」の関数から出す（既存の流れを変えない） */
  const select = MAIN.match(/function selectHand\(hand\) \{[\s\S]*?\n\}/)[0];
  assert.ok(select.includes("T('play.selected')"), 'タップで選び直せる案内');
});

/* ================================================================== *\
 * 2. 「これで決定」の補足も2行に
 * ================================================================== */

test('文言: play.lockHint は日本語で2行（「締切」の途中で割れない）', () => {
  const value = DICT.ja['play.lockHint'];
  const lines = value.split('\n');
  assert.equal(lines.length, 2, '2行');
  assert.equal(lines[0], '押すとすぐ「ぽん！」');
  assert.equal(lines[1], '押さなければ選び直せます');
  /* 押さなければ選び直せる、という意味は残す */
  assert.ok(lines[1].includes('選び直せ'));
  for (const line of lines) assert.ok(line.length <= 12, `${line} は ${line.length} 文字`);
});

test('文言: play.lockHint は12言語そろっている（他の言語は1行のまま）', () => {
  for (const locale of LOCALES) {
    const value = DICT[locale.id]['play.lockHint'];
    assert.equal(typeof value, 'string', `${locale.id}`);
    assert.ok(value.trim().length > 0, `${locale.id}: 空でない`);
  }
});

/* ================================================================== *\
 * 3. PRO 画面「最強CPU」の説明
 * ================================================================== */

test('PRO: 最強CPUの説明が「最強CPUとお互いに手のクセを読み合う心理戦」の2行', () => {
  const li = HTML.match(/<li>\s*<img src="assets\/icons\/1f9e0\.svg"[\s\S]*?<\/li>/);
  assert.ok(li, '最強CPUの行（1f9e0）がある');
  const item = li[0];
  assert.ok(item.includes('data-i18n="pro.item3"'), '見出しは pro.item3');
  assert.ok(item.includes('最強CPU（MASTER・2秒）'), '見出しの文言はそのまま');
  assert.ok(!item.includes('2手先を読む心理戦。'), '古い説明が残っていない');
  const span = item.match(/<span>([\s\S]*?)<\/span>/)[1];
  const lines = span.split('<br>');
  assert.equal(lines.length, 2, '2行（`<br>` で区切る）');
  assert.equal(lines[0], '最強CPUとお互いに');
  assert.equal(lines[1], '手のクセを読み合う心理戦');
  assert.equal(lines.join(''), '最強CPUとお互いに手のクセを読み合う心理戦', '意味の切れ目以外は変えない');
  /* 特大（13.2px）でも2行目（13文字）が1行に収まる長さ */
  for (const line of lines) assert.ok(line.length <= 14, `${line} は ${line.length} 文字`);
});

test('PRO: 説明と core.js の blurbJa が同じ言い方（読み合う心理戦）', () => {
  const master = LEVELS.master;
  assert.equal(master.id, 'master');
  assert.equal(master.pro, true, '最強CPUは PRO');
  assert.equal(master.thinkingTimeMs, 2000, '2秒');
  assert.ok(master.blurbJa.includes('お互いのクセを読み合う'), master.blurbJa);
  assert.equal(master.blurbJa.includes('2手先'), false, 'PRO の説明と食い違う「2手先」を残さない');
  /* 実装も「相手のクセを読む」— 直前の勝敗から次の手を予測する */
  const core = read('src/core.js');
  assert.ok(core.includes('function predictPlayerHand(history)'), 'クセを読む処理がある');
  assert.ok(/levelId === 'master'[\s\S]{0,120}predictPlayerHand/.test(core), 'master がその予測を使う');
});

/* ================================================================== *\
 * 4. ビルド番号 7 と www 同期
 * ================================================================== */

test('ビルド: iOS プロジェクトもアプリも Build 9', () => {
  const pbx = read('ios/App/App.xcodeproj/project.pbxproj');
  const numbers = [...pbx.matchAll(/CURRENT_PROJECT_VERSION = (\d+);/g)].map((m) => Number(m[1]));
  assert.equal(numbers.length, 2, 'Debug / Release の2箇所');
  assert.deepEqual(numbers, [9, 9], '2箇所とも 9');
  assert.ok(pbx.includes('MARKETING_VERSION = 1.0.0;'), '表示バージョンは 1.0.0 のまま');
  assert.ok(/version: '1\.0\.0',\s*build: 9,/.test(MAIN), 'アプリ側の build も 9');
  assert.ok(HTML.includes('(Build 9)'), '設定の版表示も Build 9');
});

test('www: 配布用の写しにも Build 9 と2行の案内が入る', async () => {
  const { makeWww } = await import('../tools/make-www.mjs');
  await makeWww();
  assert.ok(read('www/index.html').includes('(Build 9)'));
  assert.ok(/version: '1\.0\.0',\s*build: 9,/.test(read('www/src/main.js')));
  assert.ok(read('www/index.html').includes('最強CPUとお互いに<br>手のクセを読み合う心理戦'), 'www の PRO 画面');
  assert.ok(read('www/styles.css').includes('white-space: pre-line'), 'www の CSS');
  assert.ok(read('www/src/i18n.js').includes('選択中（カウント終了で確定）\\nほかの手をタップで変更できます'), 'www の文言');
});

test('テスト: package.json の npm test が build7 までを順番どおり走らせる', () => {
  const pkg = JSON.parse(read('package.json'));
  const script = pkg.scripts.test;
  assert.ok(script.includes('--test-concurrency=1'), 'www/ を共有するので直列');
  const order = script.match(/test\/[a-z0-9]+\.test\.js/g);
  /* 後から足したビルド（Build 9 以降）は末尾に増えるだけ */
  assert.deepEqual(order.slice(0, 9), [
    'test/core.test.js', 'test/online.test.js', 'test/build1.test.js',
    'test/build2.test.js', 'test/build3.test.js', 'test/build4.test.js',
    'test/build5.test.js', 'test/build6.test.js', 'test/build7.test.js',
  ]);
  assert.ok(readdirSync(resolve(ROOT, 'test')).includes('build7.test.js'));
  assert.ok(pkg.description.includes('Build 9'), 'package.json の説明も Build 9');
});

test('確認スクリプト: 実ブラウザで2行と PRO 画面を見る tools/shots-b7.mjs がある', () => {
  assert.ok(exists('tools/shots-b7.mjs'));
  const shots = read('tools/shots-b7.mjs');
  assert.ok(shots.includes('#timer-hint'), 'タイマーの案内を測る');
  assert.ok(shots.includes('#btn-lock .lockbtn__hint'), '決定ボタンの補足を測る');
  assert.ok(shots.includes('janken-b7-play.png'), 'プレイ画面のスクショ');
  assert.ok(shots.includes('janken-b7-pro.png'), 'PRO 画面のスクショ');
  assert.ok(shots.includes('xlarge'), '特大文字で確認する');
});
