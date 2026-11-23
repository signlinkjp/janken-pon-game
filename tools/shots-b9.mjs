/**
 * Build 9 の実画面チェック＋スクリーンショット（Chromium）
 *   node tools/shots-b9.mjs
 *
 * 確かめること:
 *   A. 英語フォールバック
 *      - 12言語にない端末（タイ語 th-TH）では画面が英語（日本語にしない）
 *      - 日本語の端末は今までどおり日本語
 *      - 英語では手の名前も英語（ROCK / SCISSORS / PAPER）
 *   B. 「国をえらぶ」の🌐言語ピル
 *      - 見出しの下・右上に小さく出る（画面の横幅に収まる）
 *      - 押すと国シートの上に言語シート。言語を選ぶと国シートに戻り、
 *        国名とピルの表示がその言語になる（国籍は変わらない）
 *      - 393 / 375 幅・標準 / 特大でもはみ出さない
 *   C. 世界の特別ルール（PRO・ランキング対象外）
 *      - 無料ではチップに PRO の印。押しても解禁されず PRO シートへ
 *      - PRO で ゾウ・人間・アリ / 井戸つき を選べる（一言説明・CTA・ポイント表記）
 *      - マッチはそのルールの手だけ（EPA 3手 / 井戸つき 4手）、判定と得点もそのルール
 *      - 通信対戦（ランキング）はクラシック固定
 *      - 結果画面に「ランキングに加算されません」と出る
 *      - パーティーはホストだけが選べる（参加者は「ホストが決めます」）
 *
 * スクショ:
 *   downloads/janken-b9-country-lang.png  … 国をえらぶ＋言語ピル
 *   downloads/janken-b9-special-mode.png  … ホームの特別ルール（PRO）
 *   downloads/janken-b9-play-epa.png      … ゾウ・人間・アリの対戦画面
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
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('requestfailed', (request) => {
    const url = request.url();
    if (!url.includes('favicon') && !url.includes('supabase.co')) errors.push(`requestfailed: ${url}`);
  });
  return { page, errors };
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
     * A+B. 言語（タイ語の端末 → 英語。ピルから切り替え）
     * ============================================================== */
    const thContext = await browser.newContext({
      viewport: { width: 440, height: 956 },
      deviceScaleFactor: 2,
      locale: 'th-TH',
      timezoneId: 'Asia/Tokyo',
      colorScheme: 'light',
    });
    const th = await newPage(thContext);
    await th.page.goto(`${server.url}/index.html?fast=1`, { waitUntil: 'networkidle' });
    await th.page.addStyleTag({ content: SAFE_CSS });
    await th.page.waitForTimeout(300);

    const fallback = await th.page.evaluate(() => ({
      locale: window.JANKeNPoN.locale,
      modes: document.querySelector('[data-i18n="home.modes"]')?.textContent ?? '',
      play: document.querySelector('#play-label')?.textContent ?? '',
      tagline: document.querySelector('.logo__tag')?.textContent ?? '',
    }));
    check('英語: タイ語の端末は英語になる', fallback.locale === 'en', fallback);
    check('英語: 画面が英語（対戦モード）', /Play modes/i.test(fallback.modes), fallback.modes);
    check('英語: 画面が英語（はじめる）', /Start/i.test(fallback.play), fallback.play);
    check('英語: 日本語の見出しが残っていない', !/[ぁ-んァ-ヶ]/.test(fallback.play), fallback.play);

    /* 英語の端末で、ピルを押して日本語へ */
    await th.page.evaluate(() => window.JANKeNPoN.openSheet('country'));
    await th.page.waitForSelector('#sheet-country:not([hidden])', { timeout: 5000 });
    await th.page.waitForTimeout(200);
    const pillEn = await th.page.evaluate(() => {
      const pill = document.querySelector('#btn-country-lang');
      const rect = pill.getBoundingClientRect();
      return {
        visible: !!pill.offsetParent,
        label: document.querySelector('#country-lang-label')?.textContent ?? '',
        right: Math.round(rect.right),
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
        viewport: window.innerWidth,
        header: document.querySelector('#sheet-country .sheet__head h3')?.getBoundingClientRect().bottom ?? 0,
      };
    });
    check('ピル: 国シートに出る', pillEn.visible, pillEn);
    check('ピル: いまの言語（English）', pillEn.label === 'English', pillEn.label);
    check('ピル: 画面の横幅に収まる', pillEn.left >= 0 && pillEn.right <= pillEn.viewport, pillEn);
    check('ピル: 見出しの下にある', pillEn.top >= pillEn.header - 1, pillEn);

    await th.page.click('#btn-country-lang');
    await th.page.waitForSelector('#sheet-language:not([hidden])', { timeout: 3000 });
    await th.page.waitForTimeout(150);
    check('ピル: 押すと言語シートが開く', await th.page.isVisible('#sheet-language'));
    check('ピル: 言語は12（英語の画面）', (await th.page.$$('#lang-grid .lang-item')).length === 12);
    /* ほかの言語（韓国語）でもピルと画面が切り替わる */
    await th.page.click('.lang-item[data-locale="ko"]');
    await th.page.waitForTimeout(250);
    const ko = await th.page.evaluate(() => ({
      pill: document.querySelector('#country-lang-label')?.textContent ?? '',
      play: document.querySelector('#play-label')?.textContent ?? '',
    }));
    check('ピル: 韓国語にすると表示も韓国語', ko.pill === '한국어' && /판/.test(ko.play), ko);
    await th.page.click('.lang-item[data-locale="ja"]');
    await th.page.waitForTimeout(250);
    const afterJa = await th.page.evaluate(() => ({
      locale: window.JANKeNPoN.locale,
      pill: document.querySelector('#country-lang-label')?.textContent ?? '',
      play: document.querySelector('#play-label')?.textContent ?? '',
    }));
    check('ピル: 日本語を選ぶと画面が日本語', afterJa.locale === 'ja' && /回戦をはじめる/.test(afterJa.play), afterJa);
    check('ピル: 表示も 日本語 に変わる', afterJa.pill === '日本語', afterJa.pill);
    await th.page.click('#sheet-language [data-close]');
    await th.page.waitForTimeout(200);
    const back = await th.page.evaluate(() => ({
      country: !document.querySelector('#sheet-country').hidden,
      overlay: !document.querySelector('#overlay').hidden,
      label: document.querySelector('#country-lang-label')?.textContent ?? '',
      countryName: document.querySelector('.country-item[data-country="JP"] .country-item__name')?.textContent ?? '',
      close: !!document.querySelector('#sheet-country [data-close]')?.offsetParent,
    }));
    check('ピル: 閉じると国シートに戻る', back.country && back.overlay && back.close, back);
    check('ピル: 戻った国シートは日本語', back.countryName === '日本', back.countryName);
    const countryAfterLang = await th.page.evaluate(() => ({
      code: window.JANKeNPoN.profile.countryCode,
      locked: window.JANKeNPoN.profile.countryLocked,
    }));
    check('ピル: 言語を変えても国籍は変わらない', countryAfterLang.code === 'JP' && countryAfterLang.locked === false, countryAfterLang);

    /* ピルのあとも、国を選ぶボタンは今までどおり動く */
    await th.page.click('.country-item[data-country="FR"] .country-item__pick');
    await th.page.waitForTimeout(200);
    const pickedFr = await th.page.evaluate(() => window.JANKeNPoN.profile.countryCode);
    check('国: ピルのあとも国を選べる', pickedFr === 'FR', pickedFr);
    await thContext.close();

    /* 日本語の端末は今までどおり */
    const jaContext = await browser.newContext({
      viewport: { width: 440, height: 956 },
      deviceScaleFactor: 2,
      locale: 'ja-JP',
      timezoneId: 'Asia/Tokyo',
    });
    const ja = await newPage(jaContext);
    await ja.page.goto(`${server.url}/index.html?fast=1`, { waitUntil: 'networkidle' });
    await ja.page.waitForTimeout(200);
    check('日本語: 日本語の端末は日本語', (await ja.page.evaluate(() => window.JANKeNPoN.locale)) === 'ja');
    await jaContext.close();

    /* ============================================================== *\
     * C. 世界の特別ルール（無料 → PRO）
     * ============================================================== */
    const context = await browser.newContext({
      viewport: { width: 440, height: 956 },
      deviceScaleFactor: 3,
      locale: 'ja-JP',
      timezoneId: 'Asia/Tokyo',
      colorScheme: 'light',
    });
    const { page, errors } = await newPage(context);
    await page.goto(`${server.url}/index.html?fast=1`, { waitUntil: 'networkidle' });
    await page.addStyleTag({ content: SAFE_CSS });
    await page.evaluate(() => window.JANKeNPoN.setLocale('ja'));
    await page.waitForTimeout(300);

    /* 無料: チップは PRO の印、押してもプロフィールは無料のまま */
    const freeChips = await page.$$eval('#rule-chips .rule-chip', (items) =>
      items.map((item) => ({
        id: item.dataset.ruleset,
        text: item.textContent.trim(),
        locked: item.classList.contains('is-locked'),
        active: item.classList.contains('is-active'),
      })),
    );
    check('無料: チップは3つ（クラシック・ゾウ・井戸）', freeChips.length === 3, freeChips);
    check('無料: クラシックが選択中', freeChips[0]?.active === true, freeChips[0]);
    check('無料: 特別ルールは PRO の印', freeChips[1]?.locked && freeChips[1]?.text.includes('PRO') && freeChips[2]?.locked, freeChips);
    await page.click('#rule-chips .rule-chip[data-ruleset="epa"]');
    await page.waitForTimeout(250);
    const lockedTry = await page.evaluate(() => ({
      pro: window.JANKeNPoN.profile.pro,
      ruleset: window.JANKeNPoN.rules.practice,
      proSheet: !document.querySelector('#sheet-pro').hidden,
    }));
    check('無料: 押しても解禁されない', lockedTry.pro === false && lockedTry.ruleset === 'standard', lockedTry);
    check('無料: PRO シートへ案内する', lockedTry.proSheet === true, lockedTry);

    /* PRO を入れて選ぶ */
    await page.evaluate(() => window.JANKeNPoN.setPro(true));
    await page.evaluate(() => window.JANKeNPoN.closeSheet());
    await page.waitForTimeout(250);
    const unlocked = await page.$$eval('#rule-chips .rule-chip', (items) =>
      items.map((item) => ({ id: item.dataset.ruleset, locked: item.classList.contains('is-locked') })),
    );
    check('PRO: 特別ルールの鍵が外れる', unlocked.every((chip) => !chip.locked), unlocked);

    await page.click('#rule-chips .rule-chip[data-ruleset="epa"]');
    await page.waitForTimeout(250);
    const epaHome = await page.evaluate(() => ({
      ruleset: window.JANKeNPoN.rules.practice,
      hint: document.querySelector('#rule-hint')?.textContent ?? '',
      hintHidden: document.querySelector('#rule-hint')?.hidden,
      cta: document.querySelector('#play-sub')?.textContent ?? '',
      points: document.querySelector('#block-note')?.textContent ?? '',
      active: document.querySelector('#rule-chips .rule-chip.is-active')?.dataset.ruleset,
    }));
    check('ルール: 選ぶと保存される', epaHome.ruleset === 'epa', epaHome);
    check('ルール: 選択中のチップ', epaHome.active === 'epa', epaHome.active);
    check('ルール: 一言説明が出る', epaHome.hintHidden === false && epaHome.hint.includes('ゾウ'), epaHome.hint);
    check('ルール: はじめるボタンにも出る', /ELEPHANT/.test(epaHome.cta), epaHome.cta);
    check('ルール: ポイント表記が切り替わる', /ゾウ3/.test(epaHome.points), epaHome.points);

    /* 特大でもはみ出さない */
    await page.evaluate(() => {
      document.documentElement.dataset.textSize = 'xlarge';
    });
    await page.waitForTimeout(250);
    const fit = await page.evaluate(() => {
      const chips = document.querySelector('#rule-chips');
      const block = document.querySelector('#rule-chips').closest('.mode-panel');
      return {
        overflowX: document.body.scrollWidth - window.innerWidth,
        chipsVisible: chips.scrollHeight > 0,
        chipsWidth: Math.round(chips.getBoundingClientRect().width),
        blockRight: Math.round(block.getBoundingClientRect().right),
        viewport: window.innerWidth,
      };
    });
    check('特大: ルールの行が画面からはみ出さない', fit.overflowX <= 0 && fit.blockRight <= fit.viewport, fit);
    await page.evaluate(() => {
      document.documentElement.dataset.textSize = 'standard';
    });
    await page.waitForTimeout(200);

    /* 国をえらぶ＋言語ピル（提出用の解像度で撮る） */
    await page.evaluate(() => window.JANKeNPoN.openSheet('country'));
    await page.waitForSelector('#sheet-country:not([hidden])', { timeout: 5000 });
    await page.waitForTimeout(300);
    const pillJa = await page.evaluate(() => {
      const pill = document.querySelector('#btn-country-lang');
      const rect = pill.getBoundingClientRect();
      return {
        visible: !!pill.offsetParent,
        label: document.querySelector('#country-lang-label')?.textContent ?? '',
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        viewport: window.innerWidth,
      };
    });
    check('ピル: 日本語の画面でも出る', pillJa.visible && pillJa.label === '日本語', pillJa);
    check('ピル: 提出用の幅でも収まる', pillJa.left >= 0 && pillJa.right <= pillJa.viewport, pillJa);
    await page.screenshot({ path: resolve(OUT, 'janken-b9-country-lang.png') });
    await page.evaluate(() => { window.JANKeNPoN.closeSheet(); window.JANKeNPoN.closeSheet(); });
    await page.waitForTimeout(250);

    /* スクショ: ホームの特別ルール（トーストが消えてから撮る） */
    await page.waitForFunction(() => !document.querySelector('#toast')?.classList.contains('is-on'), null, { timeout: 4000 });
    await page.waitForTimeout(200);
    await page.screenshot({ path: resolve(OUT, 'janken-b9-special-mode.png') });

    /* 英語でも（English の端末で特別ルールの名前が英語） */
    await page.evaluate(() => window.JANKeNPoN.setLocale('en'));
    await page.waitForTimeout(250);
    const enChips = await page.$$eval('#rule-chips .rule-chip', (items) => items.map((item) => item.textContent.trim()));
    check('英語: 特別ルールの名前も英語', enChips.some((text) => text.includes('ELEPHANT')) && enChips.some((text) => text.includes('WELL')), enChips);
    await page.evaluate(() => window.JANKeNPoN.setLocale('ja'));
    await page.waitForTimeout(200);

    /* マッチ: EPA の3手で遊べる */
    await page.evaluate(() => window.JANKeNPoN.startMatch({ seed: 11, rounds: 3 }));
    await page.waitForSelector('#screen-play.is-active', { timeout: 5000 });
    await page.waitForTimeout(400);
    const epaPlay = await page.evaluate(() => ({
      ruleset: window.JANKeNPoN.summary()?.rulesetId,
      hands: Array.from(document.querySelectorAll('#handbar .handbtn')).map((button) => button.dataset.hand),
      legend: document.querySelector('#legend')?.textContent?.replace(/\s+/g, '') ?? '',
      opponent: document.querySelector('#opp-name')?.textContent ?? '',
    }));
    check('EPA: マッチのルールは epa', epaPlay.ruleset === 'epa', epaPlay.ruleset);
    check('EPA: 手は ゾウ・人間・アリ の3つ', JSON.stringify(epaPlay.hands) === JSON.stringify(['elephant', 'human', 'ant']), epaPlay.hands);
    check('EPA: 凡例もその3手', ['ゾウ', '人間', 'アリ'].every((word) => epaPlay.legend.includes(word)), epaPlay.legend);
    await page.waitForFunction(() => !document.querySelector('#toast')?.classList.contains('is-on'), null, { timeout: 4000 });
    await page.screenshot({ path: resolve(OUT, 'janken-b9-play-epa.png') });

    /* アリ（5pt）でゾウに勝つ */
    await page.evaluate(() => window.JANKeNPoN.forceCpuHand('elephant'));
    await page.click('#handbar .handbtn[data-hand="ant"]');
    const locked = await page.evaluate(() => window.JANKeNPoN.lockVisible);
    check('EPA: これで決定が出る', locked === true);
    await page.evaluate(() => window.JANKeNPoN.lock());
    await page.waitForTimeout(900);
    const round = await page.evaluate(() => {
      const summary = window.JANKeNPoN.summary();
      const first = summary?.perRound?.[0];
      return {
        outcome: first?.outcome,
        points: first?.points,
        shown: document.querySelector('#play-points')?.textContent ?? '',
        cpuHist: document.querySelector('#pks-cells .pk .pk__hands img')?.getAttribute('src') ?? '',
      };
    });
    check('EPA: アリがゾウに勝って5pt', round.outcome === 'win' && round.points === 5, round);

    /* 井戸つきは4手 */
    await page.evaluate(() => window.JANKeNPoN.setPro(false));
    await page.evaluate(() => window.JANKeNPoN.setPro(true));
    await page.evaluate(() => window.JANKeNPoN.setRuleset('well'));
    await page.waitForTimeout(200);
    await page.evaluate(() => window.JANKeNPoN.startMatch({ seed: 5, rounds: 3 }));
    await page.waitForSelector('#screen-play.is-active', { timeout: 5000 });
    await page.waitForTimeout(350);
    const wellPlay = await page.evaluate(() => ({
      ruleset: window.JANKeNPoN.summary()?.rulesetId,
      hands: Array.from(document.querySelectorAll('#handbar .handbtn')).map((button) => button.dataset.hand),
    }));
    check('井戸: マッチのルールは well', wellPlay.ruleset === 'well', wellPlay.ruleset);
    check('井戸: 手は4つ（井戸つき）', wellPlay.hands.length === 4 && wellPlay.hands.includes('well'), wellPlay.hands);

    /* 結果画面の注記（3回戦を流しきる） */
    for (let i = 0; i < 3; i += 1) {
      const finished = await page.evaluate(() => window.JANKeNPoN.summary()?.finished ?? false);
      if (finished) break;
      await page.evaluate(() => window.JANKeNPoN.forceCpuHand('rock'));
      await page.click('#handbar .handbtn[data-hand="well"]');
      await page.evaluate(() => window.JANKeNPoN.lock());
      await page.waitForTimeout(1400);
    }
    const result = await page.evaluate(() => ({
      screen: !document.querySelector('#screen-result').classList.contains('is-active') ? 'other' : 'result',
      view: window.JANKeNPoN.view ?? null,
      note: document.querySelector('#result-note')?.textContent ?? '',
      noteHidden: document.querySelector('#result-note')?.hidden,
      rankHidden: document.querySelector('#rank-card')?.hidden,
      ruleset: window.JANKeNPoN.summary()?.rulesetId,
      points: document.querySelector('#result-points')?.textContent ?? '',
    }));
    check('結果: 特別ルールのマッチが終わる', result.screen === 'result' && result.ruleset === 'well', result);
    check('結果: ランキングの欄は出さない', result.rankHidden === true, result);
    check('結果: ランキングに加算されないと出る', result.noteHidden === false && result.note.includes('ランキング'), result);

    /* 通信対戦（ランキング）はクラシック固定 */
    await page.evaluate(() => window.JANKeNPoN.demoOnlineMatch({ nickname: 'Kai', countryCode: 'US' }));
    await page.waitForTimeout(400);
    const onlineRule = await page.evaluate(() => ({
      ruleset: window.JANKeNPoN.summary()?.rulesetId,
      hands: Array.from(document.querySelectorAll('#handbar .handbtn')).map((button) => button.dataset.hand),
    }));
    check('通信: 特別ルールを選んでいてもクラシック', onlineRule.ruleset === 'standard', onlineRule);
    check('通信: 手は3つ', onlineRule.hands.length === 3, onlineRule.hands);

    /* パーティー: ホストだけが選べる */
    await page.evaluate(() => window.JANKeNPoN.openSheet('party'));
    await page.waitForTimeout(400);
    const partyChips = await page.$$eval('#party-rule-seg .rule-chip', (items) =>
      items.map((item) => ({ id: item.dataset.ruleset, active: item.classList.contains('is-active') })),
    );
    check('パーティー: ルールのチップが3つ', partyChips.length === 3, partyChips);
    const beforeGuest = await page.evaluate(() => window.JANKeNPoN.party.rulesetId);
    await page.click('#party-rule-seg .rule-chip[data-ruleset="epa"]');
    await page.waitForTimeout(200);
    const guest = await page.evaluate(() => ({
      ruleset: window.JANKeNPoN.party.rulesetId,
      toast: document.querySelector('#toast')?.textContent ?? '',
    }));
    check('パーティー: ホスト以外は変えられない', guest.ruleset === beforeGuest && guest.toast.includes('ホスト'), guest);
    const asHost = await page.evaluate(() => window.JANKeNPoN.setPartyRuleset('well'));
    check('パーティー: ホストは選べる', asHost === 'well', asHost);

    /* PRO を切ったらクラシックへ戻る */
    const afterPro = await page.evaluate(() => {
      window.JANKeNPoN.setPro(false);
      return {
        ruleset: window.JANKeNPoN.rules.practice,
        party: window.JANKeNPoN.party.rulesetId,
        chips: Array.from(document.querySelectorAll('#rule-chips .rule-chip')).map((chip) => chip.classList.contains('is-locked')),
      };
    });
    check('PRO を切るとクラシックに戻る', afterPro.ruleset === 'standard' && afterPro.party === 'standard', afterPro);
    check('PRO を切るとチップに鍵が戻る', afterPro.chips.slice(1).every(Boolean), afterPro.chips);

    check('ページのエラーが無い', errors.length === 0, errors);
    await context.close();

    /* ============================================================== *\
     * 結果
     * ============================================================== */
    const failed = checks.filter((entry) => !entry.ok);
    console.log(JSON.stringify({
      checks: checks.length,
      failed: failed.length,
      shots: [
        'downloads/janken-b9-country-lang.png',
        'downloads/janken-b9-special-mode.png',
        'downloads/janken-b9-play-epa.png',
      ],
    }, null, 2));
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
