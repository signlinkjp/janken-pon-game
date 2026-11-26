/**
 * JANKeN PoN — Build 6 の確定仕様テスト（ビルド番号は Build 7 に上がっても、この仕様は残る）
 *
 * Build 6 で入れたものを、ここで固定する:
 *   1. プレイ画面（1対1）のヘッダーに、ワンタップのサウンド／かけ声 ON/OFF ボタン
 *      - アイコン（🔊 1f50a / 🔇 1f507）＋ ON/OFF の短いラベル
 *      - 押すと設定のサウンドと同じ値が変わり、OFF なら即ミュート・ON なら即鳴る
 *   2. パーティー画面のヘッダーにも同じボタン（CPU練習・通信対戦・パーティーで同じ）
 *   3. 特大文字（data-text-size="xlarge"）でもヘッダーがはみ出さない作り
 *      - 音のボタンは縮まない・ラウンドの点（pips）が縮んで場所をあける
 *   4. ビルド番号 6（pbxproj 2箇所・アプリ側・設定の版表示・www/ 同期）
 *
 * 実際の表示・タップ・特大レイアウトは tools/shots-b6.mjs が実ブラウザで確かめる。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { KEYS, DICT, LOCALES } from '../src/i18n.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(ROOT, path), 'utf8');
const exists = (path) => existsSync(resolve(ROOT, path));

const MAIN = read('src/main.js');
const HTML = read('index.html');
const CSS = read('styles.css');

/** 指定した関数（function name()）の中身だけを取り出す */
function bodyOf(name) {
  const start = MAIN.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name}() がある`);
  const next = MAIN.indexOf('\nfunction ', start + 10);
  return MAIN.slice(start, next < 0 ? MAIN.length : next);
}

/** 指定した id の要素を丸ごと取り出す（開始タグから同じ深さの閉じタグまで） */
function elementById(html, id) {
  const start = html.indexOf(`id="${id}"`);
  if (start < 0) return null;
  const open = html.lastIndexOf('<', start);
  const close = html.indexOf('</button>', start);
  return html.slice(open, close + '</button>'.length);
}

/** 画面（<section id="screen-…">）の中身 */
function screen(html, name) {
  const start = html.indexOf(`<section class="screen screen--${name}" id="screen-${name}">`);
  assert.ok(start >= 0, `#screen-${name} がある`);
  const end = html.indexOf('</section>', start);
  return html.slice(start, end);
}

/* ================================================================== *\
 * 1. プレイ画面のヘッダーにサウンド ON/OFF
 * ================================================================== */

test('プレイ中: ヘッダーにサウンド ON/OFF ボタンがある（アイコン＋ON/OFF ラベル）', () => {
  const play = screen(HTML, 'play');
  const head = play.slice(play.indexOf('<header class="play-head">'), play.indexOf('</header>'));
  const button = elementById(head, 'btn-play-sound');
  assert.ok(button, 'プレイのヘッダーに #btn-play-sound がある');
  assert.match(button, /class="soundbtn"/, 'サウンド用の見た目');
  assert.match(button, /type="button"/);
  assert.match(button, /aria-pressed="true"/, '押下状態を持つ（読み上げ用）');
  assert.match(button, /<img id="play-sound-icon" src="assets\/icons\/1f50a\.svg"/, '最初は 🔊（音あり）');
  assert.match(button, /<span class="soundbtn__label" id="play-sound-label">ON<\/span>/, 'ON のラベル');
  /* ヘッダーのボタンは「タイトルへ戻る ✕」の隣ではなく、スコアの手前（押しやすい右側） */
  assert.ok(head.indexOf('btn-play-sound') > head.indexOf('btn-stamp'), 'スタンプの後ろ');
  assert.ok(head.indexOf('btn-play-sound') < head.indexOf('play-head__score'), 'スコアの手前');
});

test('プレイ中: サウンド OFF の見た目（消音アイコン・muted の色）を CSS が持つ', () => {
  assert.match(CSS, /\.soundbtn\s*\{[^}]*flex:\s*none/, '音のボタンは縮まない');
  assert.match(CSS, /\.soundbtn\s*\{[^}]*height:\s*32px/, 'ヘッダーの他のボタンと同じ高さ');
  assert.match(CSS, /\.soundbtn\.is-muted/, 'OFF の見た目がある');
  assert.ok(exists('assets/icons/1f50a.svg'), '🔊 のアイコン');
  assert.ok(exists('assets/icons/1f507.svg'), '🔇 のアイコン');
});

test('パーティー: ヘッダーにも同じサウンド ON/OFF がある', () => {
  const party = screen(HTML, 'party');
  const head = party.slice(party.indexOf('<header class="play-head">'), party.indexOf('</header>'));
  const button = elementById(head, 'btn-party-sound');
  assert.ok(button, 'パーティーのヘッダーに #btn-party-sound がある');
  assert.match(button, /class="soundbtn"/);
  assert.match(button, /<img id="party-sound-icon" src="assets\/icons\/1f50a\.svg"/);
  assert.match(button, /<span class="soundbtn__label" id="party-sound-label">ON<\/span>/);
});

/* ================================================================== *\
 * 2. 設定のサウンドと双方向に同期（同じ1つの値を見る）
 * ================================================================== */

test('同期: 1つの切り替え（toggleSound）が設定と両画面のボタンを同時に塗る', () => {
  const toggle = MAIN.slice(MAIN.indexOf('function toggleSound('), MAIN.indexOf('function renderSoundButton()'));
  assert.ok(toggle.includes('const soundOn = !app.profile.sound;'), 'いまの値の反対へ');
  assert.ok(toggle.includes('persist({ ...app.profile, sound: soundOn })'), '端末に保存（設定と同じ値）');
  assert.ok(/sound\.setMuted\(!soundOn\)/.test(toggle), 'OFF は即ミュート（鳴っている音も止まる）');
  assert.ok(/if \(soundOn\) \{\s*sound\.unlock\(\);\s*sound\.play\('select'\);\s*\}/.test(toggle), 'ON に戻すと即鳴る');
  assert.ok(toggle.includes('renderSoundButton()'), 'ボタンの見た目を塗り直す');
  assert.ok(toggle.includes('renderSettings()'), '設定の行も塗り直す');
});

test('同期: 設定の行・プレイ中・パーティーの3つとも同じ toggleSound を呼ぶ', () => {
  assert.ok(MAIN.includes("$('#btn-sound').addEventListener('click', () => toggleSound())"), '設定の行');
  assert.ok(MAIN.includes("$('#btn-play-sound')?.addEventListener('click', () => toggleSound())"), 'プレイ中');
  assert.ok(MAIN.includes("$('#btn-party-sound')?.addEventListener('click', () => toggleSound())"), 'パーティー');
  /* 設定の行だけ別処理、という分岐を作らない（値がずれる原因になる） */
  assert.equal(/persist\(\{ \.\.\.app\.profile, sound: soundOn \}\)/.test(MAIN), true);
  assert.equal(MAIN.split('sound.setMuted(').length - 1 <= 4, true, 'setMuted の呼び出しは限られた場所だけ');
});

test('同期: 画面に入ったときも、いまのサウンド設定をボタンに映す', () => {
  const paint = MAIN.slice(MAIN.indexOf('function paintSoundToggles()'), MAIN.indexOf('function toggleSound('));
  assert.ok(paint.includes("'#btn-play-sound', '#play-sound-icon', '#play-sound-label'"));
  assert.ok(paint.includes("'#btn-party-sound', '#party-sound-icon', '#party-sound-label'"));
  assert.ok(paint.includes("assets/icons/1f50a.svg") && paint.includes("assets/icons/1f507.svg"), 'ON/OFF でアイコンを替える');
  assert.ok(paint.includes("button.setAttribute('aria-pressed', String(on))"));
  assert.ok(paint.includes('button.classList.toggle(\'is-muted\', !on)'));
  assert.ok(bodyOf('renderPlayChrome').includes('paintSoundToggles()'), '1対1の画面を描くとき');
  assert.ok(bodyOf('renderPartyChrome').includes('paintSoundToggles()'), 'パーティーの画面を描くとき');
  assert.ok(bodyOf('renderSoundButton').includes('paintSoundToggles()'), '設定を描き直したとき');
});

test('同期: 読み上げ（aria-label）は12言語の文言で「サウンド: ON/OFF」', () => {
  assert.ok(MAIN.includes("`${T('settings.sound')}: ${on ? T('misc.on') : T('misc.off')}`"));
  for (const locale of LOCALES) {
    assert.ok(KEYS.includes('settings.sound'), 'KEYS に settings.sound');
    assert.ok(DICT[locale.id]['settings.sound'], `${locale.id}: settings.sound`);
    assert.ok(DICT[locale.id]['misc.on'] && DICT[locale.id]['misc.off'], `${locale.id}: misc.on / misc.off`);
  }
});

test('動作: OFF にすると鳴っているかけ声も止まる（音のエンジン側の約束）', () => {
  const audio = read('src/audio.js');
  const setMuted = audio.slice(audio.indexOf('setMuted(next) {'), audio.indexOf('setMuted(next) {') + 700);
  assert.ok(setMuted.includes('rampMaster(0)'), '音量を 0 に');
  assert.ok(setMuted.includes('stopVoice()'), '鳴っているかけ声を止める');
  assert.ok(/else \{[\s\S]{0,200}rampMaster\(1\)/.test(setMuted), 'ON に戻すと音量が戻る');
});

/* ================================================================== *\
 * 3. 特大文字でもヘッダーがはみ出さない
 * ================================================================== */

test('特大: ラウンドの点（pips）が縮んで、音のボタンの場所をあける', () => {
  assert.match(CSS, /\.pips\s*\{[^}]*min-width:\s*0/, '.pips は縮める');
  assert.match(CSS, /\.pip\s*\{[^}]*flex:\s*0 1 22px/, '.pip は 22px を上限に縮む');
  assert.match(CSS, /\.pip\s*\{[^}]*min-width:\s*6px/, '潰れきらない');
  /* 音のボタンの文字は文字サイズ設定（--ts）に従う */
  assert.match(CSS, /\.soundbtn\s*\{[^}]*font-size:\s*calc\(8\.5px \* var\(--ts\)\)/);
  assert.match(CSS, /html\[data-text-size="xlarge"\]\s*\{\s*--ts:\s*1\.32;\s*\}/);
});

/* ================================================================== *\
 * 4. ビルド番号 6 と www 同期
 * ================================================================== */

test('ビルド: iOS プロジェクトもアプリも Build 9', () => {
  const pbx = read('ios/App/App.xcodeproj/project.pbxproj');
  const numbers = [...pbx.matchAll(/CURRENT_PROJECT_VERSION = (\d+);/g)].map((m) => Number(m[1]));
  assert.equal(numbers.length, 2, 'Debug / Release の2箇所');
  assert.deepEqual(numbers, [10, 10], '2箇所とも 9');
  assert.ok(pbx.includes('MARKETING_VERSION = 1.0.1;'), '表示バージョンは 1.0.0 のまま');
  assert.ok(/version: '1\.0\.1',\s*build: 10,/.test(MAIN), 'アプリ側の build も 9');
  assert.ok(HTML.includes('(Build 10)'), '設定の版表示も Build 9');
});

test('www: 配布用の写しにも Build 9 とサウンドのボタンが入る', async () => {
  const { makeWww } = await import('../tools/make-www.mjs');
  await makeWww();
  assert.ok(read('www/index.html').includes('(Build 10)'));
  assert.ok(/version: '1\.0\.1',\s*build: 10,/.test(read('www/src/main.js')));
  assert.ok(read('www/index.html').includes('id="btn-play-sound"'), 'www の画面にも音のボタン');
  assert.ok(read('www/styles.css').includes('.soundbtn'), 'www の CSS にも見た目');
});

test('テスト: package.json の npm test が build6 を順番どおり（--test-concurrency=1）で走らせる', () => {
  const pkg = JSON.parse(read('package.json'));
  const script = pkg.scripts.test;
  assert.ok(script.includes('--test-concurrency=1'), 'www/ を共有するので直列');
  assert.ok(script.includes('test/build6.test.js'), 'build6 のテストが入っている');
  const order = script.match(/test\/[a-z0-9]+\.test\.js/g);
  /* 後から足したビルド（Build 7 以降）は末尾に増えるだけ。ここでは Build 1〜6 の順番を見る */
  assert.deepEqual(order.slice(0, 8), [
    'test/core.test.js', 'test/online.test.js', 'test/build1.test.js',
    'test/build2.test.js', 'test/build3.test.js', 'test/build4.test.js',
    'test/build5.test.js', 'test/build6.test.js',
  ]);
  assert.ok(readdirSync(resolve(ROOT, 'test')).includes('build6.test.js'));
});
