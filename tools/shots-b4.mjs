/**
 * Build 4 の実画面チェック＋スクリーンショット（Chromium）
 *   node tools/shots-b4.mjs
 *
 * 出力: /workspace/downloads/janken-b4-result.png
 *   → 結果画面。WIN の緑枠と LOSE の赤枠が並ぶ 5回戦を、CPU の手を固定して作る。
 *      （R1 勝ち / R2 負け / R3 あいこ / R4 勝ち / R5 勝ち → 総合 WIN・R2 が LOSE）
 *
 * 併せて確かめる:
 *   - 結果の LOSE 行の computed style が赤い縁＋薄い赤の地（WIN の緑と対）
 *   - プレイ画面の PK 履歴ボードでも、負けた回戦が赤枠（WIN の緑と同じ濃さ）
 *   - JS エラーが出ない
 *
 * 端末のセーフエリアは Playwright から env() を差し替えられないため、
 * `--safe-t` / `--safe-b` を iPhone 15 Pro 相当（59 / 34px）に上書きする。
 */

import { mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './serve.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKSPACE = resolve(ROOT, '../..');
const OUT = resolve(WORKSPACE, 'downloads');

const LIBS =
  process.env.PLAYWRIGHT_LIBS ?? '/workspace/work/dorokei-game/.browser-libs/usr/lib/x86_64-linux-gnu';
const PLAYWRIGHT_CANDIDATES = [
  process.env.PLAYWRIGHT_PATH,
  '/workspace/work/dcd-b17/node_modules/playwright/index.js',
  'playwright',
].filter(Boolean);

async function loadChromium() {
  for (const specifier of PLAYWRIGHT_CANDIDATES) {
    try {
      const mod = await import(specifier);
      const chromium = mod.chromium ?? mod.default?.chromium;
      if (chromium) return chromium;
    } catch {
      /* 次の候補へ */
    }
  }
  throw new Error('playwright が見つかりません');
}

const SAFE_CSS = `
  :root { --safe-t: 59px !important; --safe-b: 34px !important; --safe-l: 0px !important; --safe-r: 0px !important; }
`;

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: Boolean(ok), detail });
  if (!ok) throw new Error(`NG: ${name} ${JSON.stringify(detail)}`);
};
const step = (msg) => console.error(`[step] ${msg}`);

/** rgba(...) を {r,g,b,a} に */
function parseRgba(value) {
  const match = String(value).match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\s*\)/);
  return match
    ? { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]), a: match[4] === undefined ? 1 : Number(match[4]) }
    : null;
}
const isRed = (color) => color && color.r > color.g && color.r > color.b;
const isGreen = (color) => color && color.g > color.r && color.g > color.b;
const isLightRed = (color) => color && color.r >= 250 && color.g >= 240 && color.g <= 250 && color.b >= 240 && color.b <= 250;

/** 手を選んで、締切（カウント 0）で確定するまで待つ */
async function selectAndPlay(page, hand, { timeoutMs = 12000 } = {}) {
  const before = await page.evaluate(() => window.JANKeNPoN.match?.history.length ?? 0);
  await page.click(`#handbar .handbtn[data-hand="${hand}"]`);
  await page.waitForFunction(
    (n) => (window.JANKeNPoN.match?.history.length ?? 0) > n,
    before,
    { timeout: timeoutMs },
  );
  await page.waitForTimeout(250);
}

async function main() {
  const chromium = await loadChromium();
  const server = await startServer();
  await mkdir(OUT, { recursive: true });

  let browser = null;
  try {
    browser = await chromium.launch({
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
      env: { ...process.env, LD_LIBRARY_PATH: `${LIBS}:${process.env.LD_LIBRARY_PATH ?? ''}` },
    });

    const context = await browser.newContext({
      viewport: { width: 393, height: 852 },
      deviceScaleFactor: 2,
      locale: 'ja-JP',
      timezoneId: 'Asia/Tokyo',
      colorScheme: 'light',
    });

    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`console: ${message.text()}`);
    });

    await page.goto(`${server.url}/index.html?fast=1`, { waitUntil: 'networkidle' });
    await page.addStyleTag({ content: SAFE_CSS });
    await page.waitForTimeout(250);

    /* ---------------- 1. 5回戦を、勝ち・負け・あいこが混ざるように進める ---------------- */
    step('5 rounds with fixed CPU hands');
    const plan = [
      { cpu: 'scissors', you: 'rock' }, // R1 WIN
      { cpu: 'paper', you: 'rock' }, // R2 LOSE
      { cpu: 'rock', you: 'rock' }, // R3 DRAW
      { cpu: 'paper', you: 'scissors' }, // R4 WIN
      { cpu: 'scissors', you: 'rock' }, // R5 WIN
    ];
    /* CPU の手は回戦の開始時に決まるので、始める前に並べておく */
    await page.evaluate((hands) => hands.forEach((hand) => window.JANKeNPoN.forceCpuHand(hand)), plan.map((round) => round.cpu));
    await page.evaluate(() => {
      window.JANKeNPoN.startMatch({ levelId: 'easy', rounds: 5 });
    });
    await page.waitForSelector('#screen-play.is-active', { timeout: 5000 });

    for (const [index, round] of plan.entries()) {
      step(`round ${index + 1}: you ${round.you} vs cpu ${round.cpu}`);
      await selectAndPlay(page, round.you);
      if (index === 1) {
        /* R2（負け）が終わった直後: PK ボードの赤枠を確かめる */
        const pk = await page.evaluate(() => {
          const cell = document.querySelector('#pks-cells .pk.is-lose');
          if (!cell) return null;
          const style = getComputedStyle(cell);
          return {
            border: style.borderTopColor,
            background: style.backgroundColor,
            mark: cell.querySelector('.pk__mark')?.textContent ?? '',
            winBorder: (() => {
              const win = document.querySelector('#pks-cells .pk.is-win');
              return win ? getComputedStyle(win).borderTopColor : null;
            })(),
          };
        });
        check('PKボード: 負けた回戦に赤枠が付く', Boolean(pk), pk);
        const pkBorder = parseRgba(pk.border);
        check('PKボード: 赤枠の縁は赤', isRed(pkBorder), pk.border);
        check('PKボード: 負けの記号は ×', pk.mark === '×', pk.mark);
        check(
          'PKボード: 負けの縁は勝ちの緑と同じ濃さ',
          pkBorder.a === parseRgba(pk.winBorder)?.a,
          { lose: pk.border, win: pk.winBorder },
        );
        check('PKボード: 薄い赤の地', isLightRed(parseRgba(pk.background)), pk.background);
        await page.screenshot({ path: resolve(OUT, 'janken-b4-pk-lose.png') });
      }
    }

    /* ---------------- 2. 結果画面 ---------------- */
    step('result screen');
    await page.waitForSelector('#screen-result.is-active', { timeout: 15000 });
    await page.waitForTimeout(900);

    const result = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#result-rounds .round-row')].map((row) => {
        const style = getComputedStyle(row);
        return {
          tag: row.querySelector('.round-row__tag')?.textContent?.trim() ?? '',
          className: row.className,
          border: style.borderTopColor,
          background: style.backgroundColor,
          height: row.getBoundingClientRect().height,
        };
      });
      return {
        verdict: document.querySelector('#result-verdict').textContent.trim(),
        score: document.querySelector('#result-sub').textContent.trim(),
        rows,
      };
    });

    check('結果: 5回戦ぶんの行が出る', result.rows.length === 5, result.rows);
    check('結果: 総合は WIN', result.verdict === 'WIN', result.verdict);
    const loseRows = result.rows.filter((row) => row.tag === 'LOSE');
    const winRows = result.rows.filter((row) => row.tag === 'WIN');
    check('結果: LOSE の行がある', loseRows.length >= 1, result.rows.map((row) => row.tag));
    check('結果: WIN の行がある', winRows.length >= 1, result.rows.map((row) => row.tag));

    const winEdge = parseRgba(winRows[0].border);
    check('結果: WIN の行は緑枠（従来どおり）', isGreen(winEdge), winRows[0]);
    for (const row of loseRows) {
      const edge = parseRgba(row.border);
      check('結果: LOSE の行の class は is-lose', row.className.includes('is-lose'), row.className);
      check('結果: LOSE の行の縁は赤', isRed(edge), row.border);
      check('結果: LOSE の縁は WIN の緑枠と同じ濃さ', edge.a === winEdge.a, { lose: row.border, win: winRows[0].border });
      check('結果: LOSE の行の地は薄い赤', isLightRed(parseRgba(row.background)), row.background);
      check('結果: 行の高さは WIN と同じ（1px の枠のまま）', Math.abs(row.height - winRows[0].height) < 1, {
        lose: row.height,
        win: winRows[0].height,
      });
    }

    await page.screenshot({ path: resolve(OUT, 'janken-b4-result.png'), fullPage: false });
    const fullPath = resolve(OUT, 'janken-b4-result-full.png');
    await page.screenshot({ path: fullPath, fullPage: true });

    check('JS エラーが出ていない', errors.length === 0, errors);

    for (const item of checks) console.log(`${item.ok ? 'ok' : 'NG'} - ${item.name}`);
    console.log(`\n${checks.filter((item) => item.ok).length}/${checks.length} checks pass`);
    console.log(`screenshot: ${resolve(OUT, 'janken-b4-result.png')}`);
    console.log(`full page : ${fullPath}`);
  } finally {
    if (browser) await browser.close();
    await server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
