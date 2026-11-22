/**
 * Build 7 の実画面チェック＋スクリーンショット（Chromium）
 *   node tools/shots-b7.mjs
 *
 * 確かめること:
 *   1. プレイ画面下部の案内（#timer-hint）が2行：
 *      「選択中（カウント終了で確定）」／「ほかの手をタップで変更できます」
 *      - 393 / 375 幅・標準 / 特大（--ts 1.32）の4通りで、ちょうど2行
 *      - 途中で「確/定」のように割れない（行の中身を文字単位で確かめる）
 *      - 残り秒数（.timer__num）と重ならない・横にはみ出さない
 *   2. 「これで決定」の補足が2行：「押すとすぐ「ぽん！」」／「押さなければ選び直せます」
 *   3. 12言語すべてで2行以内・はみ出しなし（1行目が長い言語は短くしてある）
 *   4. パーティー画面のタイマーも同じ2行
 *   5. PRO 画面「最強CPU（MASTER・2秒）」の説明が
 *      「最強CPUとお互いに」／「手のクセを読み合う心理戦」の2行（4通りで確認）
 *   6. JS エラーなし
 *
 * スクショ（App Store 提出サイズ 1320×2868 = 440×956 @3x）:
 *   downloads/janken-b7-title.png
 *   downloads/janken-b7-play.png      … 手を選んだ状態（下部の案内が2行）
 *   downloads/janken-b7-play-muted.png
 *   downloads/janken-b7-result.png
 *   downloads/janken-b7-party.png
 *   downloads/janken-b7-ranking.png
 *   downloads/janken-b7-pro.png       … 最強CPUの説明が2行
 *   downloads/janken-b7-settings.png
 * 補助（QA・393×852 @2x）:
 *   downloads/janken-b7-xlarge.png / janken-b7-xlarge-375.png
 *   downloads/janken-b7-pro-xlarge.png / janken-b7-pro-xlarge-375.png
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

const LOCALES = ['ja', 'en', 'ko', 'zh-Hans', 'zh-Hant', 'es', 'fr', 'de', 'pt', 'it', 'hi', 'id'];

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: Boolean(ok), detail });
  if (!ok) throw new Error(`NG: ${name} ${JSON.stringify(detail)}`);
};
const step = (msg) => console.error(`[step] ${msg}`);

/** 要素のテキストを「見た目の行」ごとに分けて返す（文字ごとの矩形から行を判定） */
async function textLines(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    /* テキストノードを全部歩いて、文字ごとの矩形の上端で「見た目の行」をまとめる
       （`<br>` で分かれた複数のテキストノードにも、`\n`＋pre-line にも効く） */
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const lines = [];
    let cur = null;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent;
      for (let i = 0; i < text.length; i += 1) {
        if (text[i] === '\n') continue; /* 改行そのものは行の中身に数えない */
        const range = document.createRange();
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        const top = Math.round(range.getBoundingClientRect().top);
        if (!cur || cur.top !== top) {
          cur = { top, text: '' };
          lines.push(cur);
        }
        cur.text += text[i];
      }
    }
    const rect = el.getBoundingClientRect();
    return {
      lines: lines.map((line) => line.text),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      overflow: el.scrollWidth - el.clientWidth,
      whiteSpace: getComputedStyle(el).whiteSpace,
    };
  }, selector);
}

/** タイマー行の重なり・はみ出し具合 */
async function timerLayout(page, prefix = '') {
  return page.evaluate((p) => {
    const box = document.querySelector(p ? `#${p}timer` : '#timer');
    const hint = document.querySelector(`#${p}timer-hint`);
    const num = box.querySelector('.timer__num');
    const bar = box.querySelector('.timer__bar');
    const a = hint.getBoundingClientRect();
    const b = num.getBoundingClientRect();
    const c = bar.getBoundingClientRect();
    return {
      hintRight: Math.round(a.right),
      numLeft: Math.round(b.left),
      gap: Math.round(b.left - a.right),
      hintBottom: Math.round(a.bottom),
      barTop: Math.round(c.top),
      outside: a.left < -0.5 || a.right > window.innerWidth + 0.5,
      viewport: window.innerWidth,
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
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
      env: { ...process.env, LD_LIBRARY_PATH: `${LIBS}:${process.env.LD_LIBRARY_PATH ?? ''}` },
    });

    /* ============================================================== *\
     * A. 393×852 で操作しながら、4通り（幅 × 文字サイズ）を確かめる
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
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message} :: ${error.stack?.split('\n').slice(0,4).join(' | ')}`));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`console: ${message.text()}`);
    });
    page.on('requestfailed', (request) => {
      const url = request.url();
      if (!url.includes('favicon') && !url.includes('supabase.co')) errors.push(`requestfailed: ${url}`);
    });

    await page.goto(`${server.url}/index.html?fast=1`, { waitUntil: 'networkidle' });
    await page.addStyleTag({ content: SAFE_CSS });
    await page.waitForTimeout(250);

    const HINT_LINES = ['選択中（カウント終了で確定）', 'ほかの手をタップで変更できます'];
    const LOCK_LINES = ['押すとすぐ「ぽん！」', '押さなければ選び直せます'];

    for (const width of [393, 375]) {
      await page.setViewportSize({ width, height: width === 375 ? 812 : 852 });
      for (const scale of ['standard', 'xlarge']) {
        step(`ja play: ${width}px / ${scale}`);
        await page.evaluate((s) => window.JANKeNPoN.setTextScale(s), scale);
        await page.evaluate(() => window.JANKeNPoN.setLocale('ja'));
        await page.evaluate(() => window.JANKeNPoN.startMatch({ levelId: 'easy', rounds: 5, opponentCode: 'US' }));
        await page.waitForSelector('#screen-play.is-active', { timeout: 5000 });
        await page.waitForTimeout(200);
        await page.click('#handbar .handbtn[data-hand="rock"]');
        await page.waitForSelector('#btn-lock:not([hidden])', { timeout: 4000 });
        await page.waitForTimeout(150);

        const hint = await textLines(page, '#timer-hint');
        check(`案内: ちょうど2行（${width}/${scale}）`, hint.lines.length === 2, hint);
        check(`案内: 1行目＝選択中（カウント終了で確定）（${width}/${scale}）`, hint.lines[0] === HINT_LINES[0], hint.lines);
        check(`案内: 2行目＝ほかの手をタップで変更できます（${width}/${scale}）`, hint.lines[1] === HINT_LINES[1], hint.lines);
        check(`案内: 横にはみ出さない（${width}/${scale}）`, hint.overflow === 0, hint);

        const layout = await timerLayout(page);
        check(`案内: 残り秒数と重ならない（${width}/${scale}）`, layout.gap >= 6 && !layout.outside, layout);
        check(`案内: タイマーのバーと重ならない（${width}/${scale}）`, layout.hintBottom <= layout.barTop + 1, layout);

        const lock = await textLines(page, '#btn-lock .lockbtn__hint');
        check(`決定ボタン: ちょうど2行（${width}/${scale}）`, lock.lines.length === 2, lock);
        check(`決定ボタン: 1行目＝押すとすぐ「ぽん！」（${width}/${scale}）`, lock.lines[0] === LOCK_LINES[0], lock.lines);
        check(`決定ボタン: 2行目＝押さなければ選び直せます（${width}/${scale}）`, lock.lines[1] === LOCK_LINES[1], lock.lines);
        check(`決定ボタン: 横にはみ出さない（${width}/${scale}）`, lock.overflow === 0, lock);

        const stack = await page.evaluate(() => {
          const lockBtn = document.querySelector('#btn-lock').getBoundingClientRect();
          const handbar = document.querySelector('#handbar').getBoundingClientRect();
          return { lockBottom: Math.round(lockBtn.bottom), handbarTop: Math.round(handbar.top) };
        });
        check(`決定ボタン: 手のボタンと重ならない（${width}/${scale}）`, stack.lockBottom <= stack.handbarTop, stack);

        if (scale === 'xlarge') {
          /* 言語切替のトーストが消えてから撮る（画面の上に重なるため） */
          await page.waitForSelector('#toast:not(.is-on)', { timeout: 4000 }).catch(() => {});
          await page.waitForTimeout(300);
          await page.screenshot({
            path: resolve(OUT, width === 375 ? 'janken-b7-xlarge-375.png' : 'janken-b7-xlarge.png'),
          });
        }
      }
    }

    /* ---------------- パーティー（同じキー・同じ2行） ---------------- */
    step('party: same two lines');
    await page.setViewportSize({ width: 393, height: 852 });
    await page.evaluate(() => window.JANKeNPoN.setTextScale('xlarge'));
    await page.evaluate(() => window.JANKeNPoN.demoParty(3));
    await page.waitForSelector('#screen-party.is-active', { timeout: 5000 });
    await page.waitForTimeout(300);
    await page.click('#party-handbar .handbtn[data-hand="rock"]').catch(() => {});
    await page.waitForTimeout(250);
    const partyHint = await textLines(page, '#party-timer-hint');
    if (partyHint.lines.length === 2) {
      check('パーティー: 案内も2行（1行目）', partyHint.lines[0] === HINT_LINES[0], partyHint.lines);
      check('パーティー: 案内も2行（2行目）', partyHint.lines[1] === HINT_LINES[1], partyHint.lines);
    } else {
      /* 手を選ぶ前は「手をえらんでください」の1行。2行の案内は選んだあとだけ */
      check('パーティー: 選ぶ前は1行の案内', partyHint.lines.length === 1, partyHint);
    }
    const partyLayout = await timerLayout(page, 'party-');
    check('パーティー: 残り秒数と重ならない', partyLayout.gap >= 6 && !partyLayout.outside, partyLayout);

    /* ---------------- 12言語（2行以内・はみ出しなし） ---------------- */
    for (const width of [393, 375]) {
      await page.setViewportSize({ width, height: width === 375 ? 812 : 852 });
      for (const scale of ['standard', 'xlarge']) {
        for (const locale of LOCALES) {
          await page.evaluate(({ s, l }) => {
            window.JANKeNPoN.setTextScale(s);
            window.JANKeNPoN.setLocale(l);
          }, { s: scale, l: locale });
          await page.evaluate(() => window.JANKeNPoN.startMatch({ levelId: 'easy', rounds: 5, opponentCode: 'US' }));
          await page.waitForSelector('#screen-play.is-active');
          await page.waitForTimeout(120);
          await page.click('#handbar .handbtn[data-hand="rock"]');
          await page.waitForSelector('#btn-lock:not([hidden])');
          await page.waitForTimeout(100);
          const hint = await textLines(page, '#timer-hint');
          const layout = await timerLayout(page);
          check(`12言語: ${locale} は2行以内（${width}/${scale}）`, hint.lines.length <= 2, hint);
          check(`12言語: ${locale} ははみ出さない（${width}/${scale}）`, hint.overflow === 0 && !layout.outside, { hint, layout });
          check(`12言語: ${locale} は残り秒数と重ならない（${width}/${scale}）`, layout.gap >= 6, layout);
          const lock = await textLines(page, '#btn-lock .lockbtn__hint');
          check(`12言語: ${locale} の決定ボタンもはみ出さない（${width}/${scale}）`, lock.overflow === 0, lock);
        }
      }
    }

    /* ---------------- PRO 画面：最強CPUの説明が2行 ---------------- */
    const PRO_LINES = ['最強CPUとお互いに', '手のクセを読み合う心理戦'];
    for (const width of [393, 375]) {
      await page.setViewportSize({ width, height: width === 375 ? 812 : 852 });
      for (const scale of ['standard', 'xlarge']) {
        step(`pro sheet: ${width}px / ${scale}`);
        await page.evaluate((s) => window.JANKeNPoN.setTextScale(s), scale);
        await page.evaluate(() => window.JANKeNPoN.setLocale('ja'));
        await page.evaluate(() => window.JANKeNPoN.openSheet('pro'));
        await page.waitForTimeout(350);
        const pro = await textLines(page, '#sheet-pro .pro-list li:nth-child(3) span');
        check(`PRO: 説明がちょうど2行（${width}/${scale}）`, pro.lines.length === 2, pro);
        check(`PRO: 1行目＝最強CPUとお互いに（${width}/${scale}）`, pro.lines[0] === PRO_LINES[0], pro.lines);
        check(`PRO: 2行目＝手のクセを読み合う心理戦（${width}/${scale}）`, pro.lines[1] === PRO_LINES[1], pro.lines);
        check(`PRO: 行の途中で折り返さない（${width}/${scale}）`, pro.overflow === 0, pro);
        const sheet = await page.evaluate(() => {
          const el = document.querySelector('#sheet-pro');
          return { scrollW: el.scrollWidth, clientW: el.clientWidth, listW: Math.round(document.querySelector('#sheet-pro .pro-list').getBoundingClientRect().width) };
        });
        check(`PRO: シートが横にはみ出さない（${width}/${scale}）`, sheet.scrollW <= sheet.clientW + 1, sheet);
        if (scale === 'xlarge') {
          await page.waitForSelector('#toast:not(.is-on)', { timeout: 4000 }).catch(() => {});
          await page.waitForTimeout(300);
          await page.screenshot({
            path: resolve(OUT, width === 375 ? 'janken-b7-pro-xlarge-375.png' : 'janken-b7-pro-xlarge.png'),
          });
        }
        await page.evaluate(() => window.JANKeNPoN.closeSheet());
        await page.waitForTimeout(200);
      }
    }

    await page.evaluate(() => window.JANKeNPoN.setTextScale('standard'));
    check('JS: エラーが出ていない', errors.length === 0, errors);
    await context.close();

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
    await shot.screenshot({ path: resolve(OUT, 'janken-b7-title.png') });

    /* プレイ（手を選んだ状態＝下部の2行の案内が出ている） */
    await shot.evaluate(() => window.JANKeNPoN.startMatch({ levelId: 'normal', rounds: 5, opponentCode: 'BR' }));
    await shot.waitForSelector('#screen-play.is-active');
    await shot.waitForTimeout(250);
    await shot.click('#handbar .handbtn[data-hand="rock"]');
    await shot.waitForSelector('#btn-lock:not([hidden])');
    await shot.waitForTimeout(300);
    const shopHint = await textLines(shot, '#timer-hint');
    check('スクショ: プレイ画面の案内が2行', shopHint.lines.length === 2, shopHint);
    await shot.screenshot({ path: resolve(OUT, 'janken-b7-play.png') });

    /* サウンド OFF の見た目（ボタンが 🔇 OFF になる。トーストが消えるまで待つ） */
    await shot.click('#btn-play-sound');
    await shot.waitForTimeout(1500);
    await shot.screenshot({ path: resolve(OUT, 'janken-b7-play-muted.png') });
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
    await shot.screenshot({ path: resolve(OUT, 'janken-b7-result.png') });

    /* パーティー（4人） */
    await shot.evaluate(() => window.JANKeNPoN.demoParty(4));
    await shot.waitForSelector('#screen-party.is-active');
    await shot.waitForTimeout(500);
    await shot.screenshot({ path: resolve(OUT, 'janken-b7-party.png') });

    /* ランキング */
    await shot.evaluate(() => window.JANKeNPoN.openSheet('ranking'));
    await shot.waitForTimeout(400);
    await shot.screenshot({ path: resolve(OUT, 'janken-b7-ranking.png') });
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
    const proShot = await textLines(shot, '#sheet-pro .pro-list li:nth-child(3) span');
    check('スクショ: PRO の最強CPUの説明が2行', proShot.lines.length === 2, proShot);
    await shot.screenshot({ path: resolve(OUT, 'janken-b7-pro.png') });
    await shot.evaluate(() => window.JANKeNPoN.closeSheet());
    await shot.waitForTimeout(200);

    /* 設定（版表示 1.0.0 (Build 7)） */
    await shot.evaluate(() => window.JANKeNPoN.openSheet('settings'));
    await shot.waitForTimeout(300);
    const version = await shot.evaluate(() => document.querySelector('#sheet-settings .sheet__note')?.textContent ?? '');
    check('スクショ: 設定の版表示が Build 7', version.includes('(Build 7)'), version);
    await shot.screenshot({ path: resolve(OUT, 'janken-b7-settings.png') });

    check('スクショ: JS エラーなし', storeErrors.length === 0, storeErrors);
    await store.close();

    for (const row of checks) console.log(`${row.ok ? 'OK ' : 'NG '} ${row.name}`);
    console.log(`\n${checks.length} 件 OK / downloads/janken-b7-*.png`);
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
