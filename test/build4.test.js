/**
 * JANKeN PoN — Build 4 の確定仕様テスト
 *
 * Build 4 で直した1項目を、ここで固定する:
 *   1. 結果画面（リザルト）の負けた回戦（LOSE）を赤枠で囲む
 *      - WIN の緑枠（薄い緑の地＋緑の縁）と対になる、薄い赤の地＋赤い縁
 *      - プレイ画面の PK 戦風の履歴ボード（#pks）も同じ濃さの赤枠に揃える
 *   2. ビルド番号 4（pbxproj 2箇所・アプリ側・設定の版表示・www/）
 *
 * 実際の見た目（色・線）は tools/shots-b4.mjs が実ブラウザで確かめる。
 * ここでは、その元になる CSS と描画（class）の契約を固定する。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(ROOT, path), 'utf8');
const exists = (path) => existsSync(resolve(ROOT, path));

const CSS = read('styles.css');
const MAIN = read('src/main.js');

const { pkBoard, pkTally } = await import('../src/core.js');

/** 指定したセレクタの宣言ブロックを取り出す（最初の1つ） */
function rule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = CSS.match(new RegExp(`(^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
  return match ? match[2] : null;
}

/** rgba(...) の3色と濃さ */
function rgba(block) {
  const match = block?.match(/border-color:\s*rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\s*\)/);
  return match ? { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]), a: Number(match[4]) } : null;
}

/** 薄い地の色（#f.....） */
const lightBackground = (block) => /background:\s*#f[0-9a-f]{5}/i.test(block ?? '');

/* ================================================================== *\
 * 1. 結果画面の LOSE 赤枠
 * ================================================================== */

test('リザルト: 負けた回戦（LOSE）の行に赤い縁と薄い赤の地が付く', () => {
  const block = rule('.round-row.is-lose');
  assert.ok(block, '.round-row.is-lose のスタイルがある');
  const edge = rgba(block);
  assert.ok(edge, `縁は rgba で色を持つ: ${block}`);
  assert.ok(edge.r > edge.g && edge.r > edge.b, `縁は赤（R が最大）: ${JSON.stringify(edge)}`);
  assert.ok(edge.a >= 0.25, `縁は WIN と同じくらい濃い（α ${edge.a}）`);
  assert.ok(lightBackground(block), `薄い赤の地: ${block}`);
  assert.equal(/border-width|border:\s/.test(block), false, 'border の太さは変えない（WIN と同じ1px・行の高さを崩さない）');
});

test('リザルト: WIN の緑枠と LOSE の赤枠が対になっている', () => {
  const win = rule('.round-row.is-win');
  const lose = rule('.round-row.is-lose');
  assert.ok(win && lose);
  const winEdge = rgba(win);
  const loseEdge = rgba(lose);
  assert.ok(winEdge.g > winEdge.r && winEdge.g > winEdge.b, 'WIN の縁は緑');
  assert.ok(loseEdge.r > loseEdge.g && loseEdge.r > loseEdge.b, 'LOSE の縁は赤');
  assert.equal(loseEdge.a, winEdge.a, `縁の濃さを揃える（WIN ${winEdge.a} / LOSE ${loseEdge.a}）`);
  assert.ok(lightBackground(win), 'WIN にも薄い地の色');
  assert.ok(lightBackground(lose), 'LOSE にも薄い地の色');
  /* 数字（0pt）はこれまでどおり赤 */
  assert.ok(CSS.includes('.round-row.is-lose .round-row__pts { color: var(--lose); }'));
});

test('リザルト: 回戦の行は勝敗の class を持って描かれる（is-win / is-lose / is-tie）', () => {
  assert.ok(MAIN.includes('class="round-row is-${round.outcome}"'), '行の class は round.outcome から作る');
  /* WIN は緑枠・LOSE は赤枠。あいこ（is-tie）は色を付けない中立のまま（WIN/LOSE を引き立てる） */
  assert.ok(CSS.includes('.round-row.is-win'), '.round-row.is-win の見た目がある');
  assert.ok(CSS.includes('.round-row.is-lose'), '.round-row.is-lose の見た目がある');
  assert.equal(/\.round-row\.is-tie\b/.test(CSS), false, 'あいこは中立（枠の色を足さない）');
  assert.ok(MAIN.includes("const tag = round.outcome === 'win' ? 'WIN' : round.outcome === 'lose' ? 'LOSE' : 'DRAW'"));
});

/* ================================================================== *\
 * 2. プレイ画面の PK 履歴ボードも同じ赤枠
 * ================================================================== */

test('PK履歴: 負けた回戦も WIN と同じ濃さの赤枠', () => {
  const win = rule('.pk.is-win');
  const lose = rule('.pk.is-lose');
  assert.ok(win && lose, '.pk.is-win / .pk.is-lose がある');
  const winEdge = rgba(win);
  const loseEdge = rgba(lose);
  assert.ok(winEdge && loseEdge, 'どちらも rgba の縁');
  assert.ok(loseEdge.r > loseEdge.g && loseEdge.r > loseEdge.b, 'LOSE の縁は赤');
  assert.equal(loseEdge.a, winEdge.a, `WIN と LOSE の縁の濃さを揃える（${winEdge.a} / ${loseEdge.a}）`);
  assert.ok(lightBackground(lose), '薄い赤の地');
  assert.ok(CSS.includes('.pk.is-lose .pk__mark { color: var(--lose); }'), '× の記号も赤');
});

test('PK履歴: セルは勝敗で is-win / is-lose / is-tie を付ける', () => {
  assert.ok(MAIN.includes('? `is-${cell.outcome}`'), 'セルの class は cell.outcome から作る');
  const history = [
    { index: 1, playerHand: 'rock', cpuHand: 'scissors', outcome: 'win', points: 5 },
    { index: 2, playerHand: 'scissors', cpuHand: 'rock', outcome: 'lose', points: 0 },
    { index: 3, playerHand: 'paper', cpuHand: 'paper', outcome: 'tie', points: 0 },
  ];
  const board = pkBoard(history, 5);
  assert.equal(board.length, 5);
  assert.deepEqual(board.slice(0, 3).map((cell) => cell.outcome), ['win', 'lose', 'tie']);
  assert.deepEqual(pkTally(history), { wins: 1, losses: 1, ties: 1, done: 3 });
});

/* ================================================================== *\
 * 3. ビルド番号 4
 * ================================================================== */

test('ビルド: iOS プロジェクトもアプリも Build 8', () => {
  const pbx = read('ios/App/App.xcodeproj/project.pbxproj');
  const numbers = [...pbx.matchAll(/CURRENT_PROJECT_VERSION = (\d+);/g)].map((m) => Number(m[1]));
  assert.equal(numbers.length, 2, 'Debug / Release の2箇所');
  assert.deepEqual(numbers, [8, 8], '2箇所とも 8');
  assert.ok(pbx.includes('MARKETING_VERSION = 1.0.0;'), '表示バージョンは 1.0.0 のまま');
  assert.ok(/version: '1\.0\.0',\s*build: 8,/.test(MAIN), 'アプリ側の build も 8');
  assert.ok(read('index.html').includes('(Build 8)'), '設定の版表示も Build 8');
});

test('www: 配布用の写しも Build 8（node tools/make-www.mjs で同期）', async () => {
  /* www/ はリポジトリに入れない（.gitignore）ので、ここで作ってから見る。
     CI でも preflight の「Guard the shipped game files」と同じものを作る。 */
  const { makeWww } = await import('../tools/make-www.mjs');
  await makeWww();
  assert.ok(exists('www/index.html'), 'www/ がある');
  assert.ok(read('www/index.html').includes('(Build 8)'), 'www の版表示も Build 8');
  assert.ok(/version: '1\.0\.0',\s*build: 8,/.test(read('www/src/main.js')), 'www の main.js も 8');
  assert.ok(
    read('www/styles.css').includes('.round-row.is-lose { border-color: rgba(221, 59, 59, 0.28);'),
    'www の CSS も赤枠',
  );
});

/* ================================================================== *\
 * 4. ワークフロー（ビルド番号は自動読み取り・固定値を持たない）
 * ================================================================== */

test('ワークフロー: いま GitHub にある見張りは Build 7 をそのまま通す', () => {
  /* 番号は pbxproj から読むので、Build 7 に上げてもワークフローは書き換え不要。 */
  const yml = read('.github/workflows/ios-testflight-build1.yml');
  assert.equal(/BUILD_NUMBER:\s*"\d+"/.test(yml), false, 'BUILD_NUMBER を固定文字列で持たない');
  assert.ok(yml.includes('CURRENT_PROJECT_VERSION'), 'pbxproj から読む');
  assert.equal(/CURRENT_PROJECT_VERSION = 3;/.test(yml), false, 'Build 3 を前提にした固定値がない');
  assert.ok(yml.includes('npm test'), 'preflight はテストを通す');
  assert.ok(yml.includes('node --check src/main.js'), 'アプリの構文も見る');
});
