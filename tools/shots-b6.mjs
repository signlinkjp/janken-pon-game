/**
 * Build 6 の実画面チェック＋スクリーンショット（Chromium）
 *   node tools/shots-b6.mjs
 *
 * 確かめること:
 *   1. プレイ画面のヘッダーにサウンド ON/OFF ボタンが出る（🔊 ON / 🔇 OFF）
 *   2. タップで OFF → 設定の値も OFF・ゲート 0・鳴っているかけ声も即ストップ
 *   3. OFF のまま次のラウンドは無音、ON に戻すと次のラウンドからまた鳴る
 *   4. 設定のサウンド行と双方向に同期（設定で切り替えてもプレイのボタンが変わる）
 *   5. パーティー画面のヘッダーにも同じボタンがあり、切り替わる
 *   6. 特大文字（393 / 375 幅）でヘッダーがはみ出さない・重ならない
 *   7. JS エラーが出ない
 *
 * スクショ（App Store 提出サイズ 1320×2868 = 440×956 @3x）:
 *   downloads/janken-b6-title.png
 *   downloads/janken-b6-play.png
 *   downloads/janken-b6-play-muted.png
 *   downloads/janken-b6-result.png
 *   downloads/janken-b6-party.png
 *   downloads/janken-b6-ranking.png
 *   downloads/janken-b6-pro.png
 *   downloads/janken-b6-settings.png
 *   downloads/janken-b6-xlarge.png（393×852 @2x・特大文字のヘッダー確認用）
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
async function playRound(page, hand, { tapSound = false } = {}) {
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
  if (tapSound) {
    /* かけ声が鳴っている最中に、プレイ中のボタンで OFF にする */
    await page.click('#btn-play-sound');
    await page.waitForTimeout(90);
  }
  await page.waitForFunction((n) => (window.JANKeNPoN.match?.history.length ?? 0) > n, before, { timeout: 12000 });
  await page.waitForFunction(() => window.JANKeNPoN.phase === 'thinking', null, { timeout: 8000 });
  await page.waitForTimeout(120);
  const after = await page.evaluate(() => ({ voice: window.JANKeNPoN.audio.voice, phase: window.JANKeNPoN.phase }));
  return { chant, after };
}

/** ヘッダーの子要素が、画面からはみ出したり重なったりしていないか */
async function headerLayout(page, headerSelector) {
  return page.evaluate((selector) => {
    const head = document.querySelector(selector);
    const items = [
      ...head.querySelectorAll(':scope > *'),
    ].filter((el) => el.getBoundingClientRect().width > 0);
    const rects = items.map((el) => {
      const rect = el.getBoundingClientRect();
      return {
        tag: el.tagName.toLowerCase(),
        id: el.id || el.className.split(' ')[0],
        left: Math.round(rect.left * 10) / 10,
        right: Math.round(rect.right * 10) / 10,
        top: Math.round(rect.top * 10) / 10,
        bottom: Math.round(rect.bottom * 10) / 10,
      };
    });
    const overlaps = [];
    for (let i = 0; i < rects.length; i += 1) {
      for (let j = i + 1; j < rects.length; j += 1) {
        const a = rects[i];
        const b = rects[j];
        const overlapW = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        if (overlapW > 1) overlaps.push([a.id, b.id, Math.round(overlapW)]);
      }
    }
    const sound = document.querySelector('#btn-play-sound')?.getBoundingClientRect() ?? null;
    return {
      viewport: window.innerWidth,
      scrollWidth: head.scrollWidth,
      clientWidth: head.clientWidth,
      rects,
      overlaps,
      sound: sound ? { left: Math.round(sound.left), right: Math.round(sound.right), width: Math.round(sound.width) } : null,
      outside: rects.filter((rect) => rect.left < -0.5 || rect.right > window.innerWidth + 0.5),
    };
  }, headerSelector);
}

/** サウンドボタンの見た目と中の状態 */
async function soundState(page, prefix) {
  return page.evaluate((p) => {
    const button = document.querySelector(`#btn-${p}-sound`);
    const icon = document.querySelector(`#${p}-sound-icon`);
    const label = document.querySelector(`#${p}-sound-label`);
    return {
      exists: Boolean(button),
      href: icon?.getAttribute('src') ?? null,
      label: label?.textContent ?? null,
      mutedClass: button?.classList.contains('is-muted') ?? null,
      pressed: button?.getAttribute('aria-pressed') ?? null,
      aria: button?.getAttribute('aria-label') ?? null,
      sound: window.JANKeNPoN.profile.sound,
      gain: window.JANKeNPoN.audio.gain,
      voice: window.JANKeNPoN.audio.voice,
      visible: button ? button.getBoundingClientRect().width > 0 && button.getBoundingClientRect().height > 0 : false,
    };
  }, prefix);
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

    /* ============================================================== *\
     * A. 操作と表示の確認（393×852）
     * ============================================================== */
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
    page.on('requestfailed', (request) => {
      const url = request.url();
      if (!url.includes('favicon') && !url.includes('supabase.co')) errors.push(`requestfailed: ${url}`);
    });

    await page.goto(`${server.url}/index.html?fast=1`, { waitUntil: 'networkidle' });
    await page.addStyleTag({ content: SAFE_CSS });
    await page.waitForTimeout(250);

    /* ---------------- 1. プレイ画面のボタン（ON が既定） ---------------- */
    step('play header: sound toggle (ON)');
    await page.evaluate(() => window.JANKeNPoN.startMatch({ levelId: 'easy', rounds: 5, opponentCode: 'US' }));
    await page.waitForSelector('#screen-play.is-active', { timeout: 5000 });
    await page.waitForTimeout(200);
    const on = await soundState(page, 'play');
    check('プレイ中: サウンドのボタンが見えている', on.exists && on.visible, on);
    check('プレイ中: はじめは ON（設定と同じ値）', on.sound === true && on.gain === 1, on);
    check('プレイ中: 🔊 アイコンと ON のラベル', /1f50a\.svg$/.test(on.href ?? '') && on.label === 'ON', on);
    check('プレイ中: 押下状態も ON（読み上げ）', on.pressed === 'true' && /ON/.test(on.aria ?? ''), on);

    /* ---------------- 2. かけ声の途中で OFF → 即ミュート ---------------- */
    step('tap sound during the chant (OFF stops the voice now)');
    const first = await playRound(page, 'rock', { tapSound: true });
    check('声: 自分の国（jp）の声で鳴っていた', first.chant.voice === 'jp', first.chant);
    const off = await soundState(page, 'play');
    check('プレイ中: タップで OFF', off.sound === false && off.gain === 0, off);
    check('プレイ中: OFF の瞬間に鳴っている声も止まる', off.voice === null, off);
    check('プレイ中: 🔇 アイコンと OFF のラベル', /1f507\.svg$/.test(off.href ?? '') && off.label === 'OFF', off);
    check('プレイ中: muted の見た目・押下状態 OFF', off.mutedClass === true && off.pressed === 'false', off);
    check('プレイ中: 読み上げも OFF', /OFF/.test(off.aria ?? ''), off);

    /* ---------------- 3. OFF のまま次のラウンドは無音 ---------------- */
    step('next round while OFF is silent');
    const second = await playRound(page, 'scissors');
    check('声: OFF のあいだは鳴らない', second.chant.voice === null, second.chant);

    /* ---------------- 4. ON に戻すと次のラウンドから鳴る ---------------- */
    step('tap again: ON');
    await page.click('#btn-play-sound');
    await page.waitForTimeout(120);
    const back = await soundState(page, 'play');
    check('プレイ中: もう一度タップで ON（ゲート 1）', back.sound === true && back.gain === 1, back);
    check('プレイ中: ON の見た目に戻る', /1f50a\.svg$/.test(back.href ?? '') && back.label === 'ON' && back.mutedClass === false, back);
    const third = await playRound(page, 'paper');
    check('声: ON に戻すと、また鳴る', third.chant.voice === 'jp', third.chant);

    /* ---------------- 5. 設定のサウンド行と双方向に同期 ---------------- */
    step('settings row and play button stay in sync');
    await page.evaluate(() => window.JANKeNPoN.openSheet('settings'));
    await page.waitForTimeout(250);
    const rowOn = await page.evaluate(() => ({
      state: document.querySelector('#set-sound-state').textContent,
      aria: document.querySelector('#btn-sound').getAttribute('aria-label'),
    }));
    check('設定: プレイ中 ON のとき、設定も ON', rowOn.state === 'ON' && /ON/.test(rowOn.aria ?? ''), rowOn);
    await page.click('#set-sound');
    await page.waitForTimeout(200);
    const fromSettings = await soundState(page, 'play');
    check('設定で OFF → プレイ中のボタンも OFF になる', fromSettings.sound === false && fromSettings.label === 'OFF' && /1f507\.svg$/.test(fromSettings.href ?? ''), fromSettings);
    await page.click('#set-sound');
    await page.waitForTimeout(200);
    const fromSettingsOn = await soundState(page, 'play');
    check('設定で ON → プレイ中も ON に戻る', fromSettingsOn.sound === true && fromSettingsOn.label === 'ON', fromSettingsOn);
    await page.evaluate(() => window.JANKeNPoN.closeSheet());
    await page.waitForTimeout(200);

    /* ---------------- 6. パーティー画面のボタン ---------------- */
    step('party header has the same toggle');
    await page.evaluate(() => window.JANKeNPoN.demoParty(3));
    await page.waitForSelector('#screen-party.is-active', { timeout: 5000 });
    await page.waitForTimeout(250);
    const partyOn = await soundState(page, 'party');
    check('パーティー: サウンドのボタンが見えている', partyOn.exists && partyOn.visible, partyOn);
    check('パーティー: いまの設定（ON）を映している', partyOn.sound === true && partyOn.label === 'ON', partyOn);
    await page.click('#btn-party-sound');
    await page.waitForTimeout(150);
    const partyOff = await soundState(page, 'party');
    check('パーティー: タップで OFF（ゲート 0）', partyOff.sound === false && partyOff.gain === 0 && partyOff.label === 'OFF', partyOff);
    const playAfterParty = await soundState(page, 'play');
    check('パーティーで OFF → 1対1のボタンも OFF（同じ値）', playAfterParty.label === 'OFF', playAfterParty);
    await page.click('#btn-party-sound');
    await page.waitForTimeout(150);
    const partyBack = await soundState(page, 'party');
    check('パーティー: もう一度で ON', partyBack.sound === true && partyBack.label === 'ON', partyBack);

    /* ---------------- 7. 特大文字（393 / 375 幅）でヘッダーが崩れない ---------------- */
    step('xlarge text: header must not overflow (393)');
    await page.evaluate(() => window.JANKeNPoN.setTextScale('xlarge'));
    await page.evaluate(() => window.JANKeNPoN.startMatch({ levelId: 'easy', rounds: 5, opponentCode: 'US' }));
    await page.waitForSelector('#screen-play.is-active');
    await page.waitForTimeout(250);
    const wide = await headerLayout(page, '#screen-play .play-head');
    check('特大: ヘッダーが横にはみ出さない（393）', wide.outside.length === 0 && wide.scrollWidth <= wide.clientWidth + 1, wide);
    check('特大: ヘッダーの要素が重ならない（393）', wide.overlaps.length === 0, wide.overlaps);
    check('特大: サウンドのボタンが潰れない（幅 36 以上）', wide.sound && wide.sound.width >= 36, wide.sound);
    await page.screenshot({ path: resolve(OUT, 'janken-b6-xlarge.png') });

    step('xlarge text: header must not overflow (375)');
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(250);
    const narrow = await headerLayout(page, '#screen-play .play-head');
    check('特大: ヘッダーが横にはみ出さない（375）', narrow.outside.length === 0 && narrow.scrollWidth <= narrow.clientWidth + 1, narrow);
    check('特大: ヘッダーの要素が重ならない（375）', narrow.overlaps.length === 0, narrow.overlaps);
    check('特大: 375 でもサウンドのボタンが押せる幅', narrow.sound && narrow.sound.width >= 36, narrow.sound);
    await page.screenshot({ path: resolve(OUT, 'janken-b6-xlarge-375.png') });
    await page.setViewportSize({ width: 393, height: 852 });
    await page.evaluate(() => window.JANKeNPoN.setTextScale('standard'));
    await page.waitForTimeout(200);

    check('JS: エラーが出ていない', errors.length === 0, errors);

    /* ============================================================== *\
     * B. App Store 提出用のスクショ（1320×2868 = 440×956 @3x）
     * ============================================================== */
    step('store screenshots at 440x956 @3x');
    const store = await browser.newContext({
      viewport: { width: 440, height: 956 },
      deviceScaleFactor: 3,
      locale: 'ja-JP',
      timezoneId: 'Asia/Tokyo',
      colorScheme: 'light',
    });
    const shot = await store.newPage();
    const storeErrors = [];
    shot.on('pageerror', (error) => storeErrors.push(`pageerror: ${error.message}`));
    shot.on('console', (message) => {
      if (message.type() === 'error') storeErrors.push(`console: ${message.text()}`);
    });
    await shot.goto(`${server.url}/index.html?fast=1`, { waitUntil: 'networkidle' });
    await shot.addStyleTag({ content: SAFE_CSS });
    await shot.evaluate(() => window.JANKeNPoN.setNickname('トモアキ'));
    await shot.waitForTimeout(350);

    const size = await shot.evaluate(() => ({ w: window.innerWidth * window.devicePixelRatio, h: window.innerHeight * window.devicePixelRatio }));
    check('スクショ: 1320×2868（6.9インチ）', size.w === 1320 && size.h === 2868, size);

    /* タイトル */
    await shot.screenshot({ path: resolve(OUT, 'janken-b6-title.png') });

    /* プレイ（かけ声が鳴っている瞬間・1回戦の結果が出ている状態） */
    await shot.evaluate(() => window.JANKeNPoN.startMatch({ levelId: 'normal', rounds: 5, opponentCode: 'BR' }));
    await shot.waitForSelector('#screen-play.is-active');
    await shot.waitForTimeout(250);
    await shot.click('#handbar .handbtn[data-hand="rock"]');
    await shot.waitForSelector('#btn-lock:not([hidden])');
    await shot.click('#btn-lock');
    await shot.waitForFunction(() => window.JANKeNPoN.phase === 'chant', null, { timeout: 6000 });
    await shot.waitForTimeout(260);
    await shot.screenshot({ path: resolve(OUT, 'janken-b6-play.png') });
    await shot.waitForFunction(() => window.JANKeNPoN.phase === 'thinking', null, { timeout: 8000 });

    /* サウンド OFF の見た目（ボタンが 🔇 OFF になる。トーストが消えるまで待つ） */
    await shot.click('#btn-play-sound');
    await shot.waitForTimeout(1500);
    await shot.screenshot({ path: resolve(OUT, 'janken-b6-play-muted.png') });
    await shot.click('#btn-play-sound');
    await shot.waitForTimeout(1500);

    /* 結果画面（3回戦を最後まで） */
    await shot.evaluate(() => window.JANKeNPoN.startMatch({ levelId: 'normal', rounds: 3, opponentCode: 'US' }));
    for (let i = 0; i < 3; i += 1) {
      await shot.waitForFunction(() => window.JANKeNPoN.phase === 'thinking', null, { timeout: 8000 });
      const hand = ['rock', 'scissors', 'paper'][i];
      await shot.click(`#handbar .handbtn[data-hand="${hand}"]`);
      await shot.waitForSelector('#btn-lock:not([hidden])');
      await shot.click('#btn-lock');
      await shot.waitForTimeout(120);
    }
    await shot.waitForSelector('#screen-result.is-active', { timeout: 15000 });
    await shot.waitForTimeout(400);
    await shot.screenshot({ path: resolve(OUT, 'janken-b6-result.png') });

    /* パーティー（4人・サウンドのボタン入り） */
    await shot.evaluate(() => window.JANKeNPoN.demoParty(4));
    await shot.waitForSelector('#screen-party.is-active');
    await shot.waitForTimeout(500);
    await shot.screenshot({ path: resolve(OUT, 'janken-b6-party.png') });

    /* ランキング */
    await shot.evaluate(() => window.JANKeNPoN.openSheet('ranking'));
    await shot.waitForTimeout(400);
    await shot.screenshot({ path: resolve(OUT, 'janken-b6-ranking.png') });
    await shot.evaluate(() => window.JANKeNPoN.closeSheet());
    await shot.waitForTimeout(200);

    /* PRO 課金（ネイティブの StoreKit ではプレビュー用のスイッチと注記を出さないので、
       実機と同じ見た目にするため隠す。価格は IAP jp.signlink.JankenPon.pro ¥300） */
    await shot.evaluate(() => window.JANKeNPoN.openSheet('pro'));
    await shot.waitForTimeout(350);
    await shot.evaluate(() => {
      document.querySelector('#btn-pro-toggle').hidden = true;
      document.querySelector('#pro-preview-note').hidden = true;
    });
    await shot.waitForTimeout(100);
    await shot.screenshot({ path: resolve(OUT, 'janken-b6-pro.png') });
    await shot.evaluate(() => window.JANKeNPoN.closeSheet());
    await shot.waitForTimeout(200);

    /* 設定（サウンド行） */
    await shot.evaluate(() => window.JANKeNPoN.openSheet('settings'));
    await shot.waitForTimeout(300);
    await shot.screenshot({ path: resolve(OUT, 'janken-b6-settings.png') });

    check('スクショ: JS エラーなし', storeErrors.length === 0, storeErrors);
    await store.close();
    await context.close();

    for (const row of checks) console.log(`${row.ok ? 'OK ' : 'NG '} ${row.name}`);
    console.log(`\n${checks.length} 件 OK / downloads/janken-b6-*.png`);
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
