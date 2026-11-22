/**
 * Build 5 の実画面チェック＋スクリーンショット（Chromium）
 *   node tools/shots-b5.mjs
 *
 * 確かめること:
 *   1. 設定に「音をテスト」が無い（スクショ: downloads/janken-b5-settings.png）
 *   2. プレイ中、かけ声の国の mp3（assets/voices/{code}.mp3）が実際に取り込まれ、
 *      その国の声として鳴っている（自分 = jp / 切替後 = 相手 us）
 *   3. 次のラウンドに入ると前の声が止まっている（重ならない）
 *   4. サウンド OFF では鳴らない
 *   5. JS エラーが出ない（スクショ: downloads/janken-b5-chant.png）
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

/** 手を選んで「これで決定」→「ぽん！」のかけ声の間の声と、次のラウンドまでの停止を見る */
async function playRound(page, hand) {
  const before = await page.evaluate(() => window.JANKeNPoN.match?.history.length ?? 0);
  await page.click(`#handbar .handbtn[data-hand="${hand}"]`);
  await page.waitForSelector('#btn-lock:not([hidden])', { timeout: 4000 });
  await page.click('#btn-lock');
  await page.waitForFunction(() => window.JANKeNPoN.phase === 'chant', null, { timeout: 6000 });
  await page.waitForTimeout(220);
  const chant = await page.evaluate(() => ({
    voice: window.JANKeNPoN.audio.voice,
    country: window.JANKeNPoN.chant.country,
    phase: window.JANKeNPoN.phase,
  }));
  await page.waitForFunction((n) => (window.JANKeNPoN.match?.history.length ?? 0) > n, before, { timeout: 12000 });
  await page.waitForFunction(() => window.JANKeNPoN.phase === 'thinking', null, { timeout: 8000 });
  await page.waitForTimeout(120);
  const after = await page.evaluate(() => ({ voice: window.JANKeNPoN.audio.voice, phase: window.JANKeNPoN.phase }));
  return { chant, after };
}

async function main() {
  const chromium = await loadChromium();
  const server = await startServer();
  await mkdir(OUT, { recursive: true });

  let browser = null;
  try {
    browser = await chromium.launch({
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none', '--autoplay-policy=no-user-gesture-required'],
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
    const requests = [];
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`console: ${message.text()}`);
    });
    page.on('request', (request) => requests.push(request.url()));
    page.on('requestfailed', (request) => errors.push(`requestfailed: ${request.url()}`));

    await page.goto(`${server.url}/index.html?fast=1`, { waitUntil: 'networkidle' });
    await page.addStyleTag({ content: SAFE_CSS });
    await page.waitForTimeout(250);

    /* ---------------- 1. 設定（「音をテスト」が無い） ---------------- */
    step('settings without sound test');
    await page.evaluate(() => window.JANKeNPoN.openSheet('settings'));
    await page.waitForTimeout(300);
    const settings = await page.evaluate(() => ({
      hasRow: Boolean(document.querySelector('#set-sound-test')),
      text: document.querySelector('#sheet-settings')?.textContent ?? '',
      soundRow: Boolean(document.querySelector('#set-sound')),
    }));
    check('設定: 「音をテスト」の行が無い', !settings.hasRow, settings);
    check('設定: 文言にも「音をテスト」が無い', !settings.text.includes('音をテスト'), settings.text.slice(0, 120));
    check('設定: サウンド ON/OFF の行は残る', settings.soundRow, settings);
    await page.screenshot({ path: resolve(OUT, 'janken-b5-settings.png') });
    await page.evaluate(() => window.JANKeNPoN.closeSheet());
    await page.waitForTimeout(200);

    /* ---------------- 2. 1ラウンド目（自分 = 日本） ---------------- */
    step('round 1: own chant (jp)');
    await page.evaluate(() => {
      window.JANKeNPoN.startMatch({ levelId: 'easy', rounds: 5, opponentCode: 'US' });
    });
    await page.waitForSelector('#screen-play.is-active', { timeout: 5000 });
    await page.waitForTimeout(200);
    const own = await page.evaluate(() => window.JANKeNPoN.chant);
    check('かけ声: 最初は自分の国（日本）', own.country === 'JP', own);

    const round1 = await playRound(page, 'rock');
    check('声: 自分の国（jp）の声で鳴っている', round1.chant.voice === 'jp', round1.chant);
    check('声: jp.mp3 を実際に取り込んでいる', requests.some((url) => url.includes('/assets/voices/jp.mp3')), requests.slice(-8));
    check('声: 次のラウンドに入ると前の声は止まっている', round1.after.voice === null, round1.after);
    await page.screenshot({ path: resolve(OUT, 'janken-b5-chant.png') });

    /* ---------------- 3. 2ラウンド目（かけ声を相手 = アメリカに切替） ---------------- */
    step('round 2: opponent chant (us)');
    await page.evaluate(() => window.JANKeNPoN.toggleChantSide());
    await page.waitForTimeout(200);
    const switched = await page.evaluate(() => window.JANKeNPoN.chant);
    check('かけ声: 切替ボタンで相手の国（アメリカ）', switched.country === 'US', switched);

    const round2 = await playRound(page, 'scissors');
    check('声: 相手の国（us）の声に切り替わる', round2.chant.voice === 'us', round2.chant);
    check('声: us.mp3 を実際に取り込んでいる', requests.some((url) => url.includes('/assets/voices/us.mp3')), requests.slice(-8));

    /* ---------------- 4. サウンド OFF では鳴らない ---------------- */
    step('sound off');
    await page.evaluate(() => window.JANKeNPoN.openSheet('settings'));
    await page.waitForTimeout(200);
    await page.click('#set-sound');
    await page.waitForTimeout(200);
    const muted = await page.evaluate(() => ({ sound: window.JANKeNPoN.profile.sound, ...window.JANKeNPoN.audio }));
    check('サウンド: OFF でゲートが 0', muted.sound === false && muted.gain === 0, muted);
    check('サウンド: OFF にした瞬間、鳴っている声も止まる', muted.voice === null, muted);
    await page.evaluate(() => window.JANKeNPoN.closeSheet());
    await page.waitForTimeout(200);

    const round3 = await playRound(page, 'paper');
    check('声: サウンド OFF では鳴らない', round3.chant.voice === null, round3.chant);

    /* ---------------- 5. ON に戻すと、また鳴る ---------------- */
    step('sound on again');
    await page.evaluate(() => window.JANKeNPoN.openSheet('settings'));
    await page.waitForTimeout(200);
    await page.click('#set-sound');
    await page.waitForTimeout(200);
    await page.evaluate(() => window.JANKeNPoN.closeSheet());
    await page.waitForTimeout(200);
    const round4 = await playRound(page, 'rock');
    check('声: ON に戻すと、また鳴る', round4.chant.voice === 'us', round4.chant);

    check('JS: エラーが出ていない', errors.length === 0, errors);

    for (const row of checks) console.log(`${row.ok ? 'OK ' : 'NG '} ${row.name}`);
    console.log(`\n${checks.length} 件 OK / downloads/janken-b5-settings.png・janken-b5-chant.png`);
  } finally {
    if (browser) await browser.close();
    await server.close();
  }
}

main().catch((error) => {
  console.error(error);
  for (const row of checks) console.error(`${row.ok ? 'OK ' : 'NG '} ${row.name} ${row.ok ? '' : JSON.stringify(row.detail)}`);
  process.exitCode = 1;
});
