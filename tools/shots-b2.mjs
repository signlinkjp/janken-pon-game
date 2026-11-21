/**
 * Build 2 の実画面チェック＋スクリーンショット（Chromium）
 *
 *   node tools/shots-b2.mjs
 *
 * 出力: /workspace/downloads/janken-b2-*.png
 *   safe-home / safe-play / pk-board / chant-self / chant-opp /
 *   settings-text-xlarge / country-lock / ranking-weekly / result / small-screen
 *
 * 端末のセーフエリアは Playwright から env() を差し替えられないため、
 * `--safe-t` / `--safe-b` を iPhone 15 Pro 相当（59 / 34px）に上書きして確認する。
 * CSS の padding がこの変数から作られていることは HTML 側の契約テストが見ている。
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
const PLAYWRIGHT_FALLBACK =
  process.env.PLAYWRIGHT_PATH ?? '/workspace/work/dcd-b17/node_modules/playwright/index.js';

async function loadChromium() {
  for (const specifier of ['playwright', PLAYWRIGHT_FALLBACK]) {
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

const checks = [];
function check(name, condition, detail = '') {
  checks.push({ name, ok: Boolean(condition), detail });
  if (!condition) throw new Error(`NG: ${name} ${JSON.stringify(detail)}`);
}
const step = (msg) => console.error(`[step] ${msg}`);

/** 手を選んで、締切（カウント 0）で確定するまで待つ */
async function selectAndPlay(page, hand, { timeoutMs = 9000 } = {}) {
  const before = await page.evaluate(() => window.JANKeNPoN.match?.history.length ?? 0);
  await page.click(`#handbar .handbtn[data-hand="${hand}"]`);
  await page.waitForFunction(
    (n) => (window.JANKeNPoN.match?.history.length ?? 0) > n,
    before,
    { timeout: timeoutMs },
  );
  /* 次のラウンドのカウントが始まるまで少し待つ */
  await page.waitForTimeout(250);
}

/** iPhone 15 Pro 相当（Dynamic Island 59px / ホームインジケータ 34px） */
const SAFE_CSS = `
  :root { --safe-t: 59px !important; --safe-b: 34px !important; --safe-l: 0px !important; --safe-r: 0px !important; }
`;

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

    /* 音の検証用に AudioContext の発音回数を数える */
    await context.addInitScript(() => {
      window.__osc = 0;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      class Counted extends AC {
        createOscillator() {
          window.__osc += 1;
          return super.createOscillator();
        }
        createBufferSource() {
          window.__osc += 1;
          return super.createBufferSource();
        }
      }
      window.AudioContext = Counted;
      if (window.webkitAudioContext) window.webkitAudioContext = Counted;
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

    /* ---------------- 1. セーフエリア（ホーム） ---------------- */
    step('home / safe area');
    const homeMetrics = await page.evaluate(() => {
      const screen = document.querySelector('#screen-home');
      const topbar = document.querySelector('#screen-home .topbar');
      const tabbar = document.querySelector('#screen-home .tabbar');
      const style = getComputedStyle(screen);
      return {
        paddingTop: parseFloat(style.paddingTop),
        paddingBottom: parseFloat(style.paddingBottom),
        topbarTop: topbar.getBoundingClientRect().top,
        tabbarBottom: tabbar.getBoundingClientRect().bottom,
        viewport: window.innerHeight,
        scrollable: style.overflowY,
      };
    });
    check('ホーム: 上余白がカメラ(59px)より下', homeMetrics.paddingTop >= 59, homeMetrics.paddingTop);
    check('ホーム: 中身の先頭がカメラより下', homeMetrics.topbarTop >= 59, homeMetrics.topbarTop);
    check('ホーム: 下余白がホームインジケータ(34px)を空ける', homeMetrics.paddingBottom >= 34, homeMetrics.paddingBottom);
    check('ホーム: 縦スクロールできる', homeMetrics.scrollable === 'auto', homeMetrics.scrollable);
    await page.screenshot({ path: resolve(OUT, 'janken-b2-safe-home.png') });

    /* ---------------- 2. サウンド ON/OFF ---------------- */
    step('sound toggle');
    await page.click('#btn-sound'); // OFF
    const stateOff = await page.evaluate(() => ({
      sound: window.JANKeNPoN.profile.sound,
      osc: window.__osc,
      label: document.querySelector('#set-sound-state').textContent,
    }));
    await page.click('#mode-cards .mode-card[data-mode="online"]');
    await page.click('#mode-cards .mode-card[data-mode="practice"]');
    await page.waitForTimeout(200);
    const duringOff = await page.evaluate(() => window.__osc);
    check('サウンド OFF で保存される', stateOff.sound === false, stateOff);
    check('サウンド OFF 中は発音しない', duringOff === stateOff.osc, { stateOff, duringOff });

    await page.click('#btn-sound'); // ON
    await page.click('#mode-cards .mode-card[data-mode="online"]');
    await page.click('#mode-cards .mode-card[data-mode="practice"]');
    await page.waitForTimeout(200);
    const duringOn = await page.evaluate(() => window.__osc);
    check('サウンド ON で鳴る', duringOn > duringOff, { duringOff, duringOn });

    /* ---------------- 3. 設定（ニックネーム・国籍・文字サイズ） ---------------- */
    step('settings + text size');
    await page.click('.tabbar button[data-nav="settings"]');
    await page.waitForTimeout(200);
    const sizeBefore = await page.evaluate(() => {
      const row = document.querySelector('#sheet-settings .set-row');
      return { px: parseFloat(getComputedStyle(row).fontSize), ts: document.documentElement.dataset.textSize };
    });
    await page.click('#text-size-seg button[data-text-size="xlarge"]');
    await page.waitForTimeout(180);
    const sizeAfter = await page.evaluate(() => {
      const row = document.querySelector('#sheet-settings .set-row');
      return {
        px: parseFloat(getComputedStyle(row).fontSize),
        ts: document.documentElement.dataset.textSize,
        saved: JSON.parse(localStorage.getItem('janken-pon.profile.v1')).textScale,
      };
    });
    check('文字サイズ 特大 で html の data-text-size が変わる', sizeAfter.ts === 'xlarge', sizeAfter);
    check('文字サイズ 特大 で実際に大きくなる', sizeAfter.px > sizeBefore.px * 1.25, { sizeBefore, sizeAfter });
    check('文字サイズが保存される', sizeAfter.saved === 'xlarge', sizeAfter);
    await page.screenshot({ path: resolve(OUT, 'janken-b2-settings-text-xlarge.png') });

    const nick = await page.inputValue('#set-nickname');
    check('設定にニックネーム欄がある', typeof nick === 'string', nick);
    const countryState = await page.textContent('#set-country-state');
    check('設定に国籍の行がある', countryState.includes('日本'), countryState);

    /* 標準に戻しておく（見た目の確認用） */
    await page.click('#text-size-seg button[data-text-size="standard"]');
    await page.waitForTimeout(120);

    /* ---------------- 4. 国籍ロック ---------------- */
    step('country lock');
    /* まだ登録していない状態にする（この端末は初回起動） */
    const lockBefore = await page.evaluate(() => window.JANKeNPoN.countryLocked);
    check('初回は国籍を選べる', lockBefore === false, lockBefore);
    await page.click('#set-country');
    await page.waitForTimeout(200);
    await page.screenshot({ path: resolve(OUT, 'janken-b2-country-confirm.png') });
    await page.click('#btn-country-confirm');
    await page.waitForTimeout(250);
    const lockAfter = await page.evaluate(() => ({
      locked: window.JANKeNPoN.countryLocked,
      code: window.JANKeNPoN.profile.countryCode,
      noteVisible: !document.querySelector('#country-lock-note').hidden,
      confirmVisible: !document.querySelector('#btn-country-confirm').hidden,
      saved: JSON.parse(localStorage.getItem('janken-pon.profile.v1')).countryLocked,
    }));
    check('登録するとロックされる', lockAfter.locked === true, lockAfter);
    check('ロックが保存される', lockAfter.saved === true, lockAfter);
    check('ロックの説明が出る', lockAfter.noteVisible === true, lockAfter);
    check('登録ボタンは消える', lockAfter.confirmVisible === false, lockAfter);
    /* ほかの国を押しても変わらない（aria-disabled のまま押せる＝案内だけ出る） */
    await page.evaluate(() => document.querySelector('.country-item:nth-child(3)').click());
    await page.waitForTimeout(200);
    const stillSame = await page.evaluate(() => window.JANKeNPoN.profile.countryCode);
    check('ロック後は国が変わらない', stillSame === lockAfter.code, { code: lockAfter.code, stillSame });
    await page.screenshot({ path: resolve(OUT, 'janken-b2-country-lock.png') });
    await page.click('#sheet-country [data-close]');
    await page.waitForTimeout(250);
    const lockedRow = await page.evaluate(() => ({
      state: document.querySelector('#set-country-state').textContent,
      note: !document.querySelector('#country-lock-note').hidden,
      homeCta: document.querySelector('#btn-country .country-btn__cta').textContent,
    }));
    check('設定の国籍行にロック表示', lockedRow.state.includes('🔒'), lockedRow);
    check('ホームの国ボタンもロック表示', lockedRow.homeCta.includes('🔒'), lockedRow);
    await page.click('#sheet-settings [data-close]');
    await page.waitForTimeout(200);

    /* ---------------- 5. プレイ画面（左が自分・PKボード・かけ声） ---------------- */
    step('play / left = you / pk board / chant');
    await page.evaluate(() => {
      window.JANKeNPoN.setNickname('トモアキ');
      ['rock', 'paper', 'scissors', 'rock', 'paper'].forEach((h) => window.JANKeNPoN.forceCpuHand(h));
      window.JANKeNPoN.startMatch({ rounds: 5, levelId: 'hard', opponentCode: 'CN', seed: 7 });
    });
    await page.waitForTimeout(400);

    const layout = await page.evaluate(() => {
      const you = document.querySelector('#you-pod').getBoundingClientRect();
      const cpu = document.querySelector('#cpu-pod').getBoundingClientRect();
      return { youX: you.left, cpuX: cpu.left, youCenter: you.left + you.width / 2, cpuCenter: cpu.left + cpu.width / 2 };
    });
    check('YOU が左・相手が右', layout.youCenter < layout.cpuCenter, layout);

    const safePlay = await page.evaluate(() => {
      const head = document.querySelector('#screen-play .play-head').getBoundingClientRect();
      const handbar = document.querySelector('#screen-play .handbar').getBoundingClientRect();
      return { headTop: head.top, handbarBottom: handbar.bottom, viewport: window.innerHeight };
    });
    check('プレイ画面: 上の中身がカメラより下', safePlay.headTop >= 59, safePlay);
    check('プレイ画面: 手のボタンが画面内', safePlay.handbarBottom <= safePlay.viewport, safePlay);

    /* 縦にスクロールしなくても、✊✌️✋ ボタンまで全部入る（iPhone 縦・セーフエリア確保後） */
    const fit = await page.evaluate(() => {
      const screen = document.querySelector('#screen-play');
      const handbar = document.querySelector('#screen-play .handbar').getBoundingClientRect();
      return {
        scrollH: screen.scrollHeight,
        clientH: screen.clientHeight,
        handbarTop: handbar.top,
        handbarBottom: handbar.bottom,
        viewport: window.innerHeight,
      };
    });
    check('プレイ中はスクロールなしで全部収まる', fit.scrollH <= fit.clientH + 1, fit);
    check('✊✌️✋ボタンが画面のすぐ下に見える', fit.handbarBottom <= fit.viewport + 0.5, fit);

    const pksBefore = await page.evaluate(() => document.querySelectorAll('#pks-cells .pk').length);
    check('PKボードが5マスある', pksBefore === 5, pksBefore);

    /* かけ声: 既定は自分（日本） */
    const chantSelf = await page.evaluate(() => ({
      side: window.JANKeNPoN.chant.side,
      words: document.querySelector('#big-chant').textContent,
      banner: document.querySelector('#opp-chant').textContent,
    }));
    check('かけ声の既定は自分', chantSelf.side === 'self', chantSelf);
    check('かけ声が日本語', chantSelf.words.includes('じゃん'), chantSelf);
    await page.screenshot({ path: resolve(OUT, 'janken-b2-chant-self.png') });

    /* ---- 締切まで何度でも選び直せる（Build 2 追加仕様） ---- */
    const beforeSelect = await page.evaluate(() => ({
      you: document.querySelector('#you-pod').classList.contains('is-revealed'),
      cpu: document.querySelector('#cpu-pod').classList.contains('is-revealed'),
      history: window.JANKeNPoN.match.history.length,
    }));
    check('カウント中は自分の手も伏せておく', beforeSelect.you === false, beforeSelect);
    check('カウント中は相手の手も伏せておく', beforeSelect.cpu === false, beforeSelect);

    await page.click('#handbar .handbtn[data-hand="rock"]');
    await page.waitForTimeout(150);
    const firstPick = await page.evaluate(() => ({
      picked: document.querySelector('.handbtn.is-picked')?.dataset.hand,
      you: document.querySelector('#you-pod').classList.contains('is-revealed'),
      history: window.JANKeNPoN.match.history.length,
      hint: document.querySelector('#timer-hint').textContent,
    }));
    check('タップは「選択中」だけで確定しない', firstPick.picked === 'rock' && firstPick.history === 0, firstPick);
    check('選択中も手は開かない', firstPick.you === false, firstPick);
    check('選択中の案内が出る', firstPick.hint.includes('選択中'), firstPick);
    await page.screenshot({ path: resolve(OUT, 'janken-b2-select.png') });

    await page.click('#handbar .handbtn[data-hand="paper"]');
    await page.waitForTimeout(150);
    const secondPick = await page.evaluate(() => ({
      picked: document.querySelector('.handbtn.is-picked')?.dataset.hand,
      history: window.JANKeNPoN.match.history.length,
    }));
    check('締切前は選び直せる', secondPick.picked === 'paper' && secondPick.history === 0, secondPick);
    await page.screenshot({ path: resolve(OUT, 'janken-b2-select-change.png') });

    /* 締切 → かけ声の最後で両方の手が同時に開く */
    await page.waitForFunction(
      () => document.querySelector('#you-pod').classList.contains('is-revealed')
        && document.querySelector('#cpu-pod').classList.contains('is-revealed'),
      null,
      { timeout: 9000 },
    );
    const opened = await page.evaluate(() => ({
      you: document.querySelector('#you-pod').classList.contains('is-revealed'),
      cpu: document.querySelector('#cpu-pod').classList.contains('is-revealed'),
      youSrc: document.querySelector('#you-hand-img').getAttribute('src'),
      cpuSrc: document.querySelector('#cpu-hand-img').getAttribute('src'),
      verdict: document.querySelector('#verdict').classList.contains('is-on'),
    }));
    check('かけ声の最後で自分と相手が同時に開く', opened.you && opened.cpu, opened);
    check('開いた手が画像で出る（自分パー / 相手グー）', opened.youSrc.endsWith('270b.svg') && opened.cpuSrc.endsWith('270a.svg'), opened);
    await page.screenshot({ path: resolve(OUT, 'janken-b2-open.png') });

    await page.waitForFunction(() => (window.JANKeNPoN.match?.history.length ?? 0) >= 1, null, { timeout: 4000 });
    const committed = await page.evaluate(() => ({
      hand: window.JANKeNPoN.match.history[0].playerHand,
      cpuHand: window.JANKeNPoN.match.history[0].cpuHand,
      outcome: window.JANKeNPoN.match.history[0].outcome,
      pips: [...document.querySelectorAll('#pips .pip')].map((p) => p.className),
    }));
    check('締切で最後に選んだ手（パー）が確定', committed.hand === 'paper', committed);
    check('相手はグー・自分は勝ち', committed.cpuHand === 'rock' && committed.outcome === 'win', committed);

    /* 2ラウンド進めて PKボードを埋める */
    for (const hand of ['scissors', 'rock']) {
      await selectAndPlay(page, hand, { timeoutMs: 9000 });
    }
    const pkState = await page.evaluate(() => ({
      marks: [...document.querySelectorAll('#pks-cells .pk__mark')].map((el) => el.textContent),
      tally: document.querySelector('#pks-tally').textContent,
      filled: document.querySelectorAll('#pks-cells .pk.is-win, #pks-cells .pk.is-lose, #pks-cells .pk.is-tie').length,
      round: document.querySelector('#arena-round').textContent,
    }));
    check('PKボードに結果が入る', pkState.filled >= 1, pkState);
    check('PKボードに勝敗の数が出る', /○\d/.test(pkState.tally), pkState);
    await page.screenshot({ path: resolve(OUT, 'janken-b2-pk-board.png') });

    /* かけ声切替（相手＝中国） */
    await page.click('#btn-chant-toggle');
    await page.waitForTimeout(250);
    const chantOpp = await page.evaluate(() => ({
      side: window.JANKeNPoN.chant.side,
      words: document.querySelector('#big-chant').textContent,
      buttons: document.querySelector('#btn-chant-toggle').getAttribute('aria-pressed'),
      saved: JSON.parse(localStorage.getItem('janken-pon.profile.v1')).chantSide,
    }));
    check('切替で相手の国のかけ声になる', chantOpp.side === 'opp', chantOpp);
    check('中国語のかけ声になる', chantOpp.words.includes('石头'), chantOpp);
    check('切替が保存される', chantOpp.saved === 'opp', chantOpp);
    await page.screenshot({ path: resolve(OUT, 'janken-b2-chant-opp.png') });

    /* 最後まで進めて結果画面（記録の保存も確認） */
    for (const hand of ['paper', 'scissors']) {
      await selectAndPlay(page, hand, { timeoutMs: 9000 });
    }
    await page.waitForTimeout(800);
    const result = await page.evaluate(() => ({
      screen: document.querySelector('#screen-result').classList.contains('is-active'),
      rows: document.querySelectorAll('#result-rounds .round-row').length,
      weekly: window.JANKeNPoN.profile.world['5'].weekly,
    }));
    check('結果画面に5ラウンドの履歴', result.rows === 5, result);
    check('週間ポイントが記録される', result.weekly.points >= 0 && typeof result.weekly.week === 'string', result.weekly);
    await page.screenshot({ path: resolve(OUT, 'janken-b2-result.png') });

    /* ---------------- 5b. 無料の記録は国内だけ／PRO で世界に入る ---------------- */
    step('free vs pro ranking');
    const buckets = await page.evaluate(() => ({
      domestic: window.JANKeNPoN.profile.world['5'].points,
      domesticMatches: window.JANKeNPoN.profile.world['5'].matches,
      world: window.JANKeNPoN.profile.global['5'].points,
      worldMatches: window.JANKeNPoN.profile.global['5'].matches,
      practice: window.JANKeNPoN.profile.practice.matches,
      pro: window.JANKeNPoN.profile.pro,
    }));
    check('CPU練習はどちらのランキングにも入らない', buckets.domestic === 0 && buckets.world === 0, buckets);
    check('CPU練習の記録は残る（練習データ）', buckets.practice >= 1, buckets);

    /* 無料で国内の記録を持っている状態を作って、世界に混ざらないことを確かめる */
    await page.evaluate(() => {
      const key = 'janken-pon.profile.v1';
      const profile = JSON.parse(localStorage.getItem(key));
      profile.world['5'].points = 24;
      profile.world['5'].matches = 2;
      profile.world['5'].wins = 2;
      profile.global['5'].points = 0;
      profile.global['5'].matches = 0;
      localStorage.setItem(key, JSON.stringify(profile));
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.addStyleTag({ content: SAFE_CSS });
    await page.waitForTimeout(300);

    const freeRanking = await page.evaluate(async () => {
      window.JANKeNPoN.openSheet('ranking');
      window.JANKeNPoN.setRankingView({ scope: 'domestic', metric: 'total' });
      await new Promise((r) => setTimeout(r, 400));
      return {
        pts: document.querySelector('#rank-me .rank-me__pts').textContent,
        scope: document.querySelector('#rank-scope-label').textContent,
        pro: window.JANKeNPoN.profile.pro,
      };
    });
    check('無料でも国内ランキングには自分の記録が出る', Number(freeRanking.pts.replace(/[^0-9]/g, '')) >= 24, freeRanking);

    /* 無料のまま世界タブ → ロックと説明 */
    const freeWorldLock = await page.evaluate(async () => {
      window.JANKeNPoN.setRankingView({ scope: 'world', metric: 'total' });
      await new Promise((r) => setTimeout(r, 300));
      const locked = document.querySelector('#rank-locked');
      return {
        hidden: locked.hidden,
        text: locked.textContent.replace(/\s+/g, ' ').trim(),
      };
    });
    check('無料は世界ランキングでロックされる', freeWorldLock.hidden === false, freeWorldLock);
    check('無料は世界に載らない旨を説明する', freeWorldLock.text.includes('国内'), freeWorldLock);
    await page.screenshot({ path: resolve(OUT, 'janken-b2-ranking-world-locked.png') });

    /* PRO にすると世界ランキングが見えるが、無料時代のポイントは入っていない */
    await page.evaluate(async () => {
      window.JANKeNPoN.setPro(true);
      window.JANKeNPoN.openSheet('ranking');
      window.JANKeNPoN.setRankingView({ scope: 'world', metric: 'total' });
      await new Promise((r) => setTimeout(r, 450));
    });
    await page.waitForTimeout(400);
    const proWorld = await page.evaluate(() => ({
      scope: document.querySelector('#rank-scope-label').textContent,
      pts: document.querySelector('#rank-me .rank-me__pts').textContent,
      saved: window.JANKeNPoN.profile.global['5'].points,
    }));
    check('PRO にしても、無料時代のポイントは世界ランキングに入らない', proWorld.pts.replace(/[^0-9]/g, '') === '0', proWorld);

    await page.evaluate(() => window.JANKeNPoN.setRankingView({ scope: 'domestic', metric: 'total' }));
    await page.waitForTimeout(350);
    const domesticView = await page.evaluate(() => ({
      pts: document.querySelector('#rank-me .rank-me__pts').textContent,
    }));
    check('国内ランキングにはそのポイントが出る', Number(domesticView.pts.replace(/[^0-9]/g, '')) >= 24, domesticView);

    /* ---------------- 6. ランキング（週間タブ） ---------------- */
    step('ranking weekly');
    await page.evaluate(() => {
      window.JANKeNPoN.setPro(true);
      window.JANKeNPoN.openSheet('ranking');
      window.JANKeNPoN.setRankingView({ scope: 'domestic', metric: 'total' });
    });
    await page.waitForTimeout(500);
    const metrics = await page.evaluate(() => [...document.querySelectorAll('#metric-tabs button')].map((b) => b.textContent));
    check('指標に週間がある', metrics.includes('週間'), metrics);
    await page.click('#metric-tabs button[data-metric="weekly"]');
    await page.waitForTimeout(400);
    const weeklyView = await page.evaluate(() => ({
      active: document.querySelector('#metric-tabs button[data-metric="weekly"]').classList.contains('is-active'),
      caption: document.querySelector('#ranking-caption').textContent,
      rows: document.querySelectorAll('#rank-list .rank-row').length,
    }));
    check('週間タブが選ばれる', weeklyView.active === true, weeklyView);
    check('週間の見出しになる', weeklyView.caption.includes('週間'), weeklyView);
    await page.screenshot({ path: resolve(OUT, 'janken-b2-ranking-weekly.png') });
    await page.click('#sheet-ranking [data-close]');
    await page.waitForTimeout(200);

    /* ---------------- 7. 小さい画面（iPhone SE）で切れない ---------------- */
    step('small screen scroll');
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForTimeout(300);
    await page.evaluate(() => window.JANKeNPoN.startMatch({ rounds: 5, opponentCode: 'BR', seed: 3 }));
    await page.waitForTimeout(500);
    const small = await page.evaluate(() => {
      const screen = document.querySelector('#screen-play');
      const handbar = document.querySelector('#screen-play .handbar');
      const rect = handbar.getBoundingClientRect();
      return {
        scrollHeight: screen.scrollHeight,
        clientHeight: screen.clientHeight,
        overflow: getComputedStyle(screen).overflowY,
        handbarTop: rect.top,
        handbarVisible: rect.top < window.innerHeight,
      };
    });
    check('小さい画面でも手のボタンに届く（スクロール可）', small.overflow === 'auto' && small.handbarVisible, small);
    await page.screenshot({ path: resolve(OUT, 'janken-b2-small-screen.png') });
    /* いちばん下までスクロールしても切れない */
    await page.evaluate(() => {
      const screen = document.querySelector('#screen-play');
      screen.scrollTop = screen.scrollHeight;
    });
    await page.waitForTimeout(150);
    await page.screenshot({ path: resolve(OUT, 'janken-b2-small-screen-bottom.png') });

    /* ---------------- 8. 余計なエラーが無い ---------------- */
    const realErrors = errors.filter((line) => !line.includes('supabase') && !line.includes('favicon'));
    check('画面のエラーが無い', realErrors.length === 0, realErrors.slice(0, 5));

    console.log(JSON.stringify({ ok: true, url: server.url, checks: checks.length }, null, 0));
  } finally {
    if (browser) await browser.close();
    await server.close();
  }
}

main().catch((error) => {
  console.error(error);
  console.error(JSON.stringify({ ok: false, checks }, null, 2));
  process.exitCode = 1;
});
