/**
 * Build 8 の実画面チェック＋スクリーンショット（Chromium）
 *   node tools/shots-b8.mjs
 *
 * 確かめること:
 *   A. 「国をえらぶ」の 🔊（かけ声の試聴）
 *      - 19か国すべてに 🔊 があり、押すと assets/voices/{code}.mp3 を取りに行く
 *      - 押した国を audio.voice が返し、その 🔊 だけが点灯する
 *      - 無料（pro なし）のまま・国籍ロック後でも、19か国すべてを聞ける
 *      - 国籍（countryCode / countryLocked）は変わらず、PRO も解禁されない
 *      - 同じ 🔊 の2回目で停止、シートを閉じても止まる
 *   B. 起動直後のオープニング
 *      - 出る（地球・✊✌️✋・ロゴ・一言・TAP TO START）
 *      - 約1.6秒で自動的にホームへ／タップですぐ／?fast=1 では出ない
 *      - 393 / 375 幅・標準 / 特大でもはみ出さない
 *
 * スクショ:
 *   downloads/janken-b8-opening.png          … 開幕（地球・手・ロゴ・一言）
 *   downloads/janken-b8-country-voices.png   … 国シートと 🔊
 *   downloads/janken-b8-country-locked.png   … 国籍ロック後でも 🔊 が押せる
 */

import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
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

/** CJS の playwright を、どの作業ディレクトリからでも読めるようにする */
function loadChromium() {
  const require = createRequire(import.meta.url);
  for (const specifier of PLAYWRIGHT_CANDIDATES) {
    try {
      const mod = require(specifier);
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
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function newPage(context) {
  const page = await context.newPage();
  const errors = [];
  const voiceRequests = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('request', (request) => {
    const url = request.url();
    const match = url.match(/assets\/voices\/([a-z]{2})\.mp3/);
    if (match) voiceRequests.push(match[1]);
  });
  page.on('requestfailed', (request) => {
    const url = request.url();
    if (!url.includes('favicon') && !url.includes('supabase.co')) errors.push(`requestfailed: ${url}`);
  });
  return { page, errors, voiceRequests };
}

async function main() {
  const chromium = loadChromium();
  const server = await startServer();
  await mkdir(OUT, { recursive: true });

  let browser = null;
  try {
    browser = await chromium.launch({
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
      env: { ...process.env, LD_LIBRARY_PATH: `${LIBS}:${process.env.LD_LIBRARY_PATH ?? ''}` },
    });

    /* ============================================================== *\
     * A. 国シートの 🔊（無料のまま・?fast=1 で開幕は飛ばす）
     * ============================================================== */
    const context = await browser.newContext({
      viewport: { width: 440, height: 956 },
      deviceScaleFactor: 3,
      locale: 'ja-JP',
      timezoneId: 'Asia/Tokyo',
      colorScheme: 'light',
    });
    const { page, errors, voiceRequests } = await newPage(context);
    await page.goto(`${server.url}/index.html?fast=1`, { waitUntil: 'networkidle' });
    await page.addStyleTag({ content: SAFE_CSS });
    await page.evaluate(() => window.JANKeNPoN.setLocale('ja'));
    await page.waitForTimeout(200);

    step('国シートを開く（無料のまま）');
    const before = await page.evaluate(() => ({ ...window.JANKeNPoN.profile }));
    check('無料: pro ではない', before.pro === false, before.pro);
    check('無料: 国籍はまだロックされていない', before.countryLocked === false);
    await page.evaluate(() => window.JANKeNPoN.openSheet('country'));
    await page.waitForSelector('#sheet-country:not([hidden])', { timeout: 5000 });
    await page.waitForTimeout(300);

    const cards = await page.$$eval('#country-grid .country-item', (items) =>
      items.map((item) => ({
        code: item.dataset.country,
        disabled: item.classList.contains('is-disabled'),
        previews: item.querySelectorAll('.country-item__preview').length,
        label: item.querySelector('.country-item__preview')?.getAttribute('aria-label') ?? '',
        icon: item.querySelector('.country-item__preview img')?.getAttribute('src') ?? '',
      })),
    );
    check('国: カードは19枚', cards.length === 19, cards.length);
    check('国: 全部に 🔊 が1つずつ', cards.every((card) => card.previews === 1), cards.filter((c) => c.previews !== 1));
    check('国: 🔊 のアイコンが 1f50a', cards.every((card) => card.icon === 'assets/icons/1f50a.svg'));
    check('国: 読み上げに国名が入る', cards.every((card) => card.label.includes('のかけ声を聞く')), cards[0]?.label);
    check('国: 案内の行がある', await page.isVisible('#country-preview-hint'));

    /* 19か国すべてを順に押して、その国の声が鳴ることを確かめる */
    const codes = cards.map((card) => card.code);
    const fetchedVoices = new Set();
    for (const code of codes) {
      step(`🔊 ${code}`);
      voiceRequests.length = 0;
      await page.click(`.country-item__preview[data-preview="${code}"]`);
      await page.waitForFunction(
        (c) => window.JANKeNPoN.audio.voice === c.toLowerCase(),
        code,
        { timeout: 4000 },
      );
      const state = await page.evaluate((c) => {
        const buttons = Array.from(document.querySelectorAll('.country-item__preview'));
        const active = buttons.filter((button) => button.classList.contains('is-playing'));
        const profile = window.JANKeNPoN.profile;
        return {
          playing: active.map((button) => button.dataset.preview),
          pressed: active.map((button) => button.getAttribute('aria-pressed')),
          voice: window.JANKeNPoN.audio.voice,
          countryCode: profile.countryCode,
          countryLocked: profile.countryLocked,
          pro: profile.pro,
          scope: window.JANKeNPoN.online.scope,
        };
      }, code);
      check(`国: ${code} の声が鳴っている`, state.voice === code.toLowerCase(), state);
      check(`国: ${code} だけが点灯`, state.playing.length === 1 && state.playing[0] === code, state.playing);
      check(`国: ${code} の 🔊 が aria-pressed`, state.pressed[0] === 'true', state.pressed);
      check(`国: ${code} を押しても国籍が変わらない`, state.countryCode === 'JP', state.countryCode);
      check(`国: ${code} を押しても PRO にならない`, state.pro === false && state.scope === 'domestic', state);
      check(`国: ${code} の mp3 を取りに行く`, voiceRequests.includes(code.toLowerCase()), voiceRequests);
      fetchedVoices.add(code.toLowerCase());
    }
    check('国: 19か国ぶんの mp3 をすべて取りに行った', fetchedVoices.size === 19, [...fetchedVoices]);

    /* 鳴っている途中にもう一度押すと停止（声は約1秒なので、続けて2回押して確かめる） */
    await page.evaluate(() => {
      document.querySelector('#sheet-country').scrollTop = 0;
    });
    await page.click('.country-item__preview[data-preview="BR"]', { force: true });
    await page.click('.country-item__preview[data-preview="BR"]', { force: true });
    await sleep(200);
    const stopped = await page.evaluate(() => ({
      voice: window.JANKeNPoN.audio.voice,
      playing: document.querySelectorAll('.country-item__preview.is-playing').length,
    }));
    check('国: 同じ 🔊 の2回目で止まる', stopped.voice === null && stopped.playing === 0, stopped);

    /* スクショ用に1つ点灯させたまま撮る（声は約1秒なので、確認してからすぐ撮る） */
    await page.click('.country-item__preview[data-preview="BR"]');
    await page.waitForFunction(() => window.JANKeNPoN.audio.voice === 'br', null, { timeout: 4000 });
    check('国: スクショの直前に 🔊 が点灯している', await page.isVisible('.country-item__preview.is-playing'));
    await page.screenshot({ path: resolve(OUT, 'janken-b8-country-voices.png') });

    /* ============================================================== *\
     * B. 国籍をロックしても、19か国を全部聞ける
     * ============================================================== */
    step('ブラジルで国籍を登録（ロック）');
    await page.click('.country-item[data-country="BR"] .country-item__pick');
    await page.waitForFunction(() => window.JANKeNPoN.profile.countryCode === 'BR', null, { timeout: 3000 });
    await page.click('#btn-country-confirm');
    await page.waitForFunction(() => window.JANKeNPoN.profile.countryLocked === true, null, { timeout: 3000 });
    const lockedNow = await page.evaluate(() => ({ ...window.JANKeNPoN.profile }));
    check('ロック: ブラジルで確定', lockedNow.countryCode === 'BR' && lockedNow.countryLocked === true, lockedNow);

    /* 閉じて開き直す（開いたときの描画で 🔊 が戻る） */
    await page.evaluate(() => window.JANKeNPoN.closeSheet());
    await page.waitForTimeout(150);
    await page.evaluate(() => window.JANKeNPoN.openSheet('country'));
    await page.waitForTimeout(300);

    const lockedCards = await page.$$eval('#country-grid .country-item', (items) =>
      items.map((item) => ({
        code: item.dataset.country,
        disabled: item.classList.contains('is-disabled'),
        previews: item.querySelectorAll('.country-item__preview').length,
      })),
    );
    check('ロック後: 19枚のカードが残る', lockedCards.length === 19, lockedCards.length);
    check('ロック後: 全部の 🔊 が残る', lockedCards.every((card) => card.previews === 1));
    check('ロック後: 現在の国以外は is-disabled', lockedCards.filter((card) => card.disabled).length === 18, lockedCards);
    check('ロック後: 登録のボタンは隠れる', await page.isHidden('#btn-country-confirm'));
    check('ロック後: ロックの説明が出る', await page.isVisible('#country-lock-note'));

    for (const code of codes) {
      step(`🔒 🔊 ${code}`);
      voiceRequests.length = 0;
      await page.click(`.country-item__preview[data-preview="${code}"]`);
      await page.waitForFunction(
        (c) => window.JANKeNPoN.audio.voice === c.toLowerCase(),
        code,
        { timeout: 4000 },
      );
      const state = await page.evaluate(() => ({
        voice: window.JANKeNPoN.audio.voice,
        countryCode: window.JANKeNPoN.profile.countryCode,
        countryLocked: window.JANKeNPoN.profile.countryLocked,
        pro: window.JANKeNPoN.profile.pro,
        scope: window.JANKeNPoN.online.scope,
      }));
      check(`ロック後: ${code} の声が鳴る`, state.voice === code.toLowerCase(), state);
      check(`ロック後: ${code} でも国籍は BR のまま`, state.countryCode === 'BR' && state.countryLocked === true, state);
      check(`ロック後: ${code} でも PRO にならない`, state.pro === false && state.scope === 'domestic', state);
    }

    /* スクショ用（ロック後でも 🔊 が押せる） */
    await page.click('.country-item__preview[data-preview="US"]');
    await page.waitForFunction(() => window.JANKeNPoN.audio.voice === 'us', null, { timeout: 4000 });
    await page.screenshot({ path: resolve(OUT, 'janken-b8-country-locked.png') });

    /* ロック後にカード本体を押しても国籍は変わらない（従来どおり） */
    await page.click('.country-item[data-country="US"] .country-item__pick', { force: true });
    await page.waitForTimeout(250);
    const afterPick = await page.evaluate(() => ({
      countryCode: window.JANKeNPoN.profile.countryCode,
      countryLocked: window.JANKeNPoN.profile.countryLocked,
      toast: document.querySelector('#toast')?.textContent ?? '',
    }));
    check('ロック後: 別の国を選んでも BR のまま', afterPick.countryCode === 'BR', afterPick);
    check('ロック後: 理由を伝えるトースト', afterPick.toast.includes('変更できません'), afterPick.toast);

    await page.evaluate(() => window.JANKeNPoN.closeSheet());
    check('国: シートを閉じると試聴も止まる', await page.evaluate(() => window.JANKeNPoN.audio.voice === null));
    check('国: JS エラーなし', errors.length === 0, errors);

    /* ============================================================== *\
     * B2. 小さい画面・特大文字でも 🔊 がはみ出さない
     * ============================================================== */
    const compact = await browser.newContext({
      viewport: { width: 393, height: 852 },
      deviceScaleFactor: 2,
      locale: 'ja-JP',
      timezoneId: 'Asia/Tokyo',
    });
    const compactPage = await compact.newPage();
    await compactPage.goto(`${server.url}/index.html?fast=1`, { waitUntil: 'networkidle' });
    await compactPage.evaluate(() => window.JANKeNPoN.setTextScale('xlarge'));
    await compactPage.evaluate(() => window.JANKeNPoN.openSheet('country'));
    await compactPage.waitForTimeout(300);
    for (const width of [393, 375]) {
      await compactPage.setViewportSize({ width, height: width === 375 ? 812 : 852 });
      await compactPage.waitForTimeout(250);
      const layout = await compactPage.evaluate(() => {
        const sheet = document.querySelector('#sheet-country');
        const grid = document.querySelector('#country-grid');
        const cards = [...document.querySelectorAll('.country-item')];
        const previews = [...document.querySelectorAll('.country-item__preview')];
        return {
          sheetOverflow: sheet.scrollWidth - sheet.clientWidth,
          gridOverflow: grid.scrollWidth - grid.clientWidth,
          columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
          cards: cards.length,
          previews: previews.length,
          smallest: Math.min(...previews.map((button) => Math.round(button.getBoundingClientRect().width))),
          outside: previews.filter((button) => {
            const box = button.getBoundingClientRect();
            return box.right > window.innerWidth + 1 || box.left < -1;
          }).length,
        };
      });
      check(`小画面: ${width}px でシートが横にはみ出さない`, layout.sheetOverflow <= 0 && layout.gridOverflow <= 0, layout);
      check(`小画面: ${width}px でも2列（特大）・19枚・19個`, layout.columns === 2 && layout.cards === 19 && layout.previews === 19, layout);
      check(`小画面: ${width}px でも 🔊 が縮みすぎない（20px 以上）`, layout.smallest >= 20, layout.smallest);
      check(`小画面: ${width}px でも 🔊 が画面内`, layout.outside === 0, layout);
      await compactPage.click('.country-item__preview[data-preview="DE"]');
      await compactPage.waitForFunction(() => window.JANKeNPoN.audio.voice === 'de', null, { timeout: 4000 });
      check(`小画面: ${width}px でも 🔊 でドイツの声が鳴る`, true);
    }
    await compact.close();

    /* ============================================================== *\
     * C. オープニング（?fast=1 なし）
     * ============================================================== */
    const splashContext = await browser.newContext({
      viewport: { width: 440, height: 956 },
      deviceScaleFactor: 3,
      locale: 'ja-JP',
      timezoneId: 'Asia/Tokyo',
      colorScheme: 'light',
    });
    const splashPage = await splashContext.newPage();
    const splashErrors = [];
    splashPage.on('pageerror', (error) => splashErrors.push(error.message));
    splashPage.on('console', (message) => {
      if (message.type() === 'error') splashErrors.push(message.text());
    });

    step('開幕: 出る・約1.6秒で自動');
    /* スクショは撮影に約1.6秒かかるので、自動では進めない ?opening=hold で見る */
    await splashPage.goto(`${server.url}/index.html?opening=hold`, { waitUntil: 'domcontentloaded' });
    await splashPage.waitForFunction(() => window.JANKeNPoN?.opening?.visible === true, null, { timeout: 3000 });
    await splashPage.waitForTimeout(150);

    const splash = await splashPage.evaluate(() => {
      const el = document.querySelector('#opening');
      const box = el.getBoundingClientRect();
      const app = document.querySelector('#app').getBoundingClientRect();
      const center = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return {
        visible: !el.hidden,
        covers: box.width >= app.width - 1 && box.height >= app.height - 1,
        onTop: Boolean(center && el.contains(center)),
        earth: Boolean(el.querySelector('.opening__earth')),
        hands: el.querySelectorAll('.opening__hand').length,
        logo: el.querySelector('.opening__logo-main')?.textContent ?? '',
        world: el.querySelector('.opening__logo-world')?.textContent ?? '',
        tagline: el.querySelector('.opening__tagline')?.textContent ?? '',
        tap: el.querySelector('.opening__tap-text')?.textContent ?? '',
      };
    });
    check('開幕: 画面いっぱいに出る', splash.visible && splash.covers && splash.onTop, splash);
    check('開幕: 地球がある', splash.earth);
    check('開幕: 手は3つ', splash.hands === 3, splash.hands);
    check('開幕: ロゴ JANKeN PoN', splash.logo === 'JANKeN PoN', splash.logo);
    check('開幕: ロゴ WORLD', splash.world === 'WORLD', splash.world);
    check('開幕: 一言', splash.tagline === '世界中のかけ声で真剣勝負！', splash.tagline);
    check('開幕: TAP TO START', splash.tap === 'TAP TO START', splash.tap);

    /* アニメーションが付いている（止まった絵ではない） */
    const anim = await splashPage.evaluate(() => ({
      earth: getComputedStyle(document.querySelector('.opening__earth')).animationName,
      ring: getComputedStyle(document.querySelector('.opening__ring')).animationName,
      hand: getComputedStyle(document.querySelector('.opening__hand--rock')).animationName,
      logo: getComputedStyle(document.querySelector('.opening__logo-main')).animationName,
      tap: getComputedStyle(document.querySelector('.opening__tap-text')).animationName,
    }));
    check('開幕: 地球が回る', anim.earth.includes('openSpin'), anim.earth);
    check('開幕: リングが回る', anim.ring.includes('openOrbit'), anim.ring);
    check('開幕: 手が弾む', anim.hand.includes('handPop'), anim.hand);
    check('開幕: ロゴが出る', anim.logo.includes('logoIn'), anim.logo);
    check('開幕: TAP が明滅する', anim.tap.includes('tapPulse'), anim.tap);

    await splashPage.waitForTimeout(900);
    await splashPage.screenshot({ path: resolve(OUT, 'janken-b8-opening.png') });
    check('開幕: スクショを撮っても出たまま（hold）', await splashPage.evaluate(() => window.JANKeNPoN.opening.visible === true));
    await splashPage.evaluate(() => window.JANKeNPoN.skipOpening());

    /* 自動で進む（hold を付けない素の起動） */
    await splashPage.goto(`${server.url}/index.html`, { waitUntil: 'domcontentloaded' });
    await splashPage.waitForFunction(() => window.JANKeNPoN?.opening?.visible === true, null, { timeout: 3000 });
    await splashPage.waitForFunction(() => document.querySelector('#opening').hidden === true, null, {
      timeout: 4000,
    });
    /* 出てから消えるまでをページ内の時計で測る（1.6秒＋0.3秒のフェード） */
    const autoTiming = await splashPage.evaluate(() => {
      const info = window.JANKeNPoN.opening;
      return { shownAt: Math.round(info.shownAt), hiddenAt: Math.round(info.hiddenAt), span: Math.round(info.hiddenAt - info.shownAt) };
    });
    check('開幕: 約1.6秒で自動的にホームへ', autoTiming.span >= 1450 && autoTiming.span <= 2600, autoTiming);
    check('開幕: ホームが出ている', await splashPage.evaluate(() => document.querySelector('#screen-home').classList.contains('is-active')));
    check('開幕: ホームの「はじめる」が押せる', await splashPage.isVisible('#btn-play'));
    check('開幕: JS エラーなし', splashErrors.length === 0, splashErrors);

    /* タップですぐ飛ばせる */
    step('開幕: タップで即スキップ');
    await splashPage.goto(`${server.url}/index.html`, { waitUntil: 'domcontentloaded' });
    await splashPage.waitForFunction(() => window.JANKeNPoN?.opening?.visible === true, null, { timeout: 3000 });
    await sleep(180);
    const tapStart = Date.now();
    await splashPage.mouse.click(220, 480);
    await splashPage.waitForFunction(() => document.querySelector('#opening').hidden === true, null, { timeout: 1200 });
    const tapMs = Date.now() - tapStart;
    check('開幕: タップですぐ消える', tapMs < 400, tapMs);
    check('開幕: スキップ後は done', await splashPage.evaluate(() => window.JANKeNPoN.opening.done === true));

    /* ?fast=1 は出さない（既存のブラウザ確認と同じ） */
    step('開幕: ?fast=1 は出さない');
    await splashPage.goto(`${server.url}/index.html?fast=1`, { waitUntil: 'domcontentloaded' });
    check('開幕: fast=1 では最初から隠れている', await splashPage.evaluate(() => document.querySelector('#opening').hidden === true));
    check('開幕: fast=1 でもホーム', await splashPage.isVisible('#btn-play'));

    /* 393 / 375 幅・標準 / 特大ではみ出さない */
    for (const width of [393, 375]) {
      for (const scale of ['standard', 'xlarge']) {
        step(`開幕: ${width}px / ${scale}`);
        await splashPage.setViewportSize({ width, height: width === 375 ? 812 : 852 });
        await splashPage.goto(`${server.url}/index.html?opening=hold`, { waitUntil: 'domcontentloaded' });
        await splashPage.waitForFunction(() => window.JANKeNPoN?.opening?.visible === true, null, { timeout: 3000 });
        /* 文字サイズと言語はプロフィールに残る（次の起動でも同じ条件） */
        await splashPage.evaluate((s) => {
          window.JANKeNPoN.setTextScale(s);
          window.JANKeNPoN.setLocale('ja');
        }, scale);
        await splashPage.waitForTimeout(1050);
        const fit = await splashPage.evaluate(() => {
          const el = document.querySelector('#opening');
          const logo = document.querySelector('.opening__logo-main').getBoundingClientRect();
          const tagline = document.querySelector('.opening__tagline').getBoundingClientRect();
          const tap = document.querySelector('.opening__tap').getBoundingClientRect();
          return {
            overflowX: el.scrollWidth - el.clientWidth,
            logoIn: logo.left >= -1 && logo.right <= window.innerWidth + 1,
            taglineIn: tagline.left >= -1 && tagline.right <= window.innerWidth + 1,
            tapIn: tap.bottom <= window.innerHeight + 1,
            tapTop: Math.round(tap.top),
            viewport: window.innerHeight,
          };
        });
        check(`開幕: ${width}/${scale} で横にはみ出さない`, fit.overflowX === 0 && fit.logoIn && fit.taglineIn, fit);
        check(`開幕: ${width}/${scale} で TAP が画面内`, fit.tapIn, fit);
        /* 次の条件へ行く前に閉じる（API でも飛ばせることの確認を兼ねる） */
        await splashPage.evaluate(() => window.JANKeNPoN.skipOpening());
        check(`開幕: ${width}/${scale} で API から閉じられる`, await splashPage.evaluate(() => document.querySelector('#opening').hidden === true));
      }
    }
    await splashContext.close();
    await context.close();

    /* ============================================================== *\
     * 結果
     * ============================================================== */
    const failed = checks.filter((entry) => !entry.ok);
    console.log(JSON.stringify({ checks: checks.length, failed: failed.length, shots: [
      'downloads/janken-b8-opening.png',
      'downloads/janken-b8-country-voices.png',
      'downloads/janken-b8-country-locked.png',
    ] }, null, 2));
    if (failed.length) process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    await server.close();
  }
}

main().catch((error) => {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
});
