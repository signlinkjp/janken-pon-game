/**
 * Build 3 の実画面チェック＋スクリーンショット（Chromium）
 *   node tools/shots-b3.mjs
 *
 * 出力: /workspace/downloads/janken-b3-*.png
 *   ・home-xlarge        文字サイズ「特大」のホーム（回戦数 / CPUの強さ・7/5/3/2秒）
 *   ・stats-xlarge       戦績（チョキが1行・その手ごとの勝率）
 *   ・play-lock          プレイ中の「これで決定（ロック）」
 *   ・ranking-winrate    勝率ランキング（5戦未満は圏外・あと何戦）
 *   ・ranking-legend     3色バーの凡例
 *   ・party-domestic     パーティー（無料の国内）
 *   ・party-world        PRO の世界パーティー
 *   ・online-result      2ブラウザの通信対戦（5回戦）の結果
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

/** 1行に収まっているか（高さと横のはみ出しで見る） */
const oneLine = (rect, scrollWidth, clientWidth, maxHeight = 26) =>
  rect.height <= maxHeight && scrollWidth <= clientWidth + 1;

async function main() {
  const chromium = await loadChromium();
  const server = await startServer();
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
    env: { ...process.env, LD_LIBRARY_PATH: `${LIBS}:${process.env.LD_LIBRARY_PATH ?? ''}` },
  });

  try {
    const context = await browser.newContext({
      viewport: { width: 393, height: 852 },
      deviceScaleFactor: 2,
      locale: 'ja-JP',
      timezoneId: 'Asia/Tokyo',
      colorScheme: 'light',
    });
    const errors = [];
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`console: ${message.text()}`);
    });

    await page.goto(`${server.url}/index.html?fast=1`, { waitUntil: 'networkidle' });
    await page.addStyleTag({ content: SAFE_CSS });
    await page.waitForTimeout(250);

    /* ---------------- 1. 特大のホーム（回戦数 / CPUの強さ） ---------------- */
    step('home / xlarge');
    await page.click('.tabbar button[data-nav="settings"]');
    await page.click('#text-size-seg button[data-text-size="xlarge"]');
    await page.click('#sheet-settings [data-close]');
    await page.waitForTimeout(250);

    const home = await page.evaluate(() => {
      const label = document.querySelector('#level-note');
      const labelRect = label.getBoundingClientRect();
      const segButtons = [...document.querySelectorAll('#rounds-seg button')];
      const segRects = segButtons.map((button) => {
        const rect = button.getBoundingClientRect();
        return { text: button.textContent.trim(), height: rect.height, scrollWidth: button.scrollWidth, clientWidth: button.clientWidth };
      });
      const levels = [...document.querySelectorAll('#level-row .level')].map((level) => ({
        name: level.querySelector('.level__name').textContent,
        time: level.querySelector('.level__time').textContent,
      }));
      const cta = document.querySelector('#play-sub').textContent;
      return {
        label: label.textContent.trim(),
        labelRect: { height: labelRect.height, width: labelRect.width },
        labelScroll: label.scrollWidth,
        labelClient: label.clientWidth,
        segRects,
        levels,
        cta,
        overflowX: document.documentElement.scrollWidth - window.innerWidth,
      };
    });
    check('特大: 「回戦数 / CPUの強さ」が1行', oneLine(home.labelRect, home.labelScroll, home.labelClient), home);
    check('特大: 5回戦/3回戦のボタンが2行に割れない',
      home.segRects.every((button) => button.height <= 44 && button.scrollWidth <= button.clientWidth + 1), home.segRects);
    check('CPUの秒数が 7.0 / 5.0 / 3.0 / 2.0',
      JSON.stringify(home.levels.map((level) => level.time)) === JSON.stringify(['7.0s', '5.0s', '3.0s', '2.0s']), home.levels);
    check('ホームの開始ボタンが中級5秒', home.cta.includes('5.0s'), home.cta);
    check('特大: 横にはみ出さない', home.overflowX <= 1, home.overflowX);
    await page.screenshot({ path: resolve(OUT, 'janken-b3-home-xlarge.png') });

    /* ---------------- 2. 戦績（チョキ1行・手ごとの勝率） ---------------- */
    step('stats / xlarge');
    await page.evaluate(() => {
      /* 練習を数試合ぶん作る（手ごとの勝率が入るように） */
      const key = 'janken-pon.profile.v1';
      const profile = JSON.parse(localStorage.getItem(key) ?? '{}');
      profile.handCounts = { rock: 9, scissors: 10, paper: 11 };
      profile.handResults = {
        rock: { wins: 6, losses: 3, ties: 2 },
        scissors: { wins: 2, losses: 5, ties: 1 },
        paper: { wins: 4, losses: 4, ties: 0 },
      };
      profile.practice = { matches: 2, wins: 0, losses: 2, ties: 0, points: 0, best: 0, lastAt: null };
      localStorage.setItem(key, JSON.stringify(profile));
    });
    /* 保存した記録を読み直す（起動時にプロフィールを読む） */
    await page.reload({ waitUntil: 'networkidle' });
    await page.addStyleTag({ content: SAFE_CSS });
    await page.waitForTimeout(250);
    await page.evaluate(() => window.JANKeNPoN.openSheet('stats'));
    await page.waitForTimeout(300);
    const stats = await page.evaluate(() => {
      const names = [...document.querySelectorAll('#stats-hands .handrow__name')].map((el) => {
        const rect = el.getBoundingClientRect();
        return { text: el.textContent, height: rect.height, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
      });
      const wins = [...document.querySelectorAll('#stats-hands .handrow__win')].map((el) => el.textContent.trim());
      return { names, wins };
    });
    const choki = stats.names.find((name) => name.text === 'チョキ');
    check('特大: 戦績の「チョキ」が1行', choki && oneLine(choki, choki.scrollWidth, choki.clientWidth, 24), choki);
    check('手ごとの勝率が出る', stats.wins.length === 3 && stats.wins.every((text) => text.includes('勝率')), stats.wins);
    check('グーの勝率は 67%（6勝3敗・あいこ除く）', stats.wins[0].includes('67%'), stats.wins[0]);
    check('チョキの勝率は 29%（2勝5敗）', stats.wins[1].includes('29%'), stats.wins[1]);
    await page.screenshot({ path: resolve(OUT, 'janken-b3-stats-xlarge.png') });
    await page.click('#sheet-stats [data-close]');

    /* ---------------- 3. プレイ画面の「これで決定（ロック）」 ---------------- */
    step('play / lock button');
    await page.evaluate(() => {
      window.JANKeNPoN.setNickname('トモアキ');
      window.JANKeNPoN.startMatch({ rounds: 5, levelId: 'normal' });
    });
    await page.waitForTimeout(300);
    const beforePick = await page.evaluate(() => ({
      visible: window.JANKeNPoN.lockVisible,
      phase: window.JANKeNPoN.phase,
      hintRight: document.querySelector('#timer-hint').getBoundingClientRect().right,
      numLeft: document.querySelector('#timer-num').getBoundingClientRect().left,
      hintLines: document.querySelector('#timer-hint').getBoundingClientRect().height,
    }));
    check('未選択では「これで決定」を出さない', beforePick.visible === false, beforePick);
    check('特大: 案内が残り秒数と重ならない', beforePick.hintRight <= beforePick.numLeft + 0.5, beforePick);

    await page.click('.handbtn[data-hand="paper"]');
    await page.waitForTimeout(150);
    const picked = await page.evaluate(() => ({
      visible: window.JANKeNPoN.lockVisible,
      label: document.querySelector('#lock-hand').textContent,
      history: window.JANKeNPoN.match.history.length,
      phase: window.JANKeNPoN.phase,
    }));
    check('手を選ぶと「これで決定」が出る', picked.visible === true, picked);
    check('選んだ手がボタンに出る', picked.label.includes('パー'), picked);
    check('選んだだけでは確定しない', picked.history === 0 && picked.phase === 'thinking', picked);
    await page.screenshot({ path: resolve(OUT, 'janken-b3-play-lock.png') });

    /* 押した瞬間に「ぽん！」へ（締切を待たない） */
    const lockedAt = Date.now();
    await page.click('#btn-lock');
    const afterLock = await page.evaluate(() => ({
      phase: window.JANKeNPoN.phase,
      history: window.JANKeNPoN.match.history.length,
      visible: window.JANKeNPoN.lockVisible,
      hint: document.querySelector('#timer-hint').textContent,
    }));
    check('決定を押すとすぐ「ぽん！」（待たない）', afterLock.phase === 'chant' || afterLock.history === 1, afterLock);
    check('決定を押すとボタンが消える', afterLock.visible === false, afterLock);
    await page.waitForFunction(() => window.JANKeNPoN.match.history.length >= 1, null, { timeout: 8000 });
    const committed = await page.evaluate(() => ({
      hand: window.JANKeNPoN.match.history[0].playerHand,
      elapsed: 0,
    }));
    check('決定した手（パー）が記録される', committed.hand === 'paper', committed);

    /* 押さなければ選び直せる（2ラウンド目） */
    await page.waitForFunction(() => window.JANKeNPoN.phase === 'thinking', null, { timeout: 8000 });
    await page.click('.handbtn[data-hand="rock"]');
    await page.click('.handbtn[data-hand="scissors"]');
    const reselect = await page.evaluate(() => ({
      selected: document.querySelector('.handbtn.is-picked')?.dataset.hand,
      history: window.JANKeNPoN.match.history.length,
    }));
    check('決定を押さなければ選び直せる', reselect.selected === 'scissors' && reselect.history === 1, reselect);
    const startedAt = Date.now();
    await page.click('#btn-lock');
    check('2回目の決定もすぐ進む', Date.now() - startedAt < 1500, Date.now() - startedAt);
    await page.evaluate(() => window.JANKeNPoN.abortMatch?.('テスト終了'));

    /* ---------------- 4. ランキング（勝率5戦以上・凡例） ---------------- */
    step('ranking / winrate / legend');
    await page.evaluate(() => {
      const key = 'janken-pon.profile.v1';
      const profile = JSON.parse(localStorage.getItem(key) ?? '{}');
      profile.world = profile.world ?? {};
      profile.world['5'] = { ...(profile.world['5'] ?? {}), points: 24, matches: 3, wins: 3, losses: 0, ties: 0 };
      localStorage.setItem(key, JSON.stringify(profile));
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.addStyleTag({ content: SAFE_CSS });
    await page.waitForTimeout(250);
    await page.evaluate(() => {
      window.JANKeNPoN.openSheet('ranking');
      window.JANKeNPoN.setRankingView({ division: '5', metric: 'winrate', scope: 'domestic' });
    });
    await page.waitForTimeout(400);
    const winrate = await page.evaluate(() => ({
      rank: document.querySelector('#rank-me .rank-me__rank').textContent.trim(),
      need: document.querySelector('#rank-me .rank-me__need')?.textContent ?? '',
      note: document.querySelector('#rank-note')?.textContent ?? '',
      legend: document.querySelector('#rank-legend')?.textContent ?? '',
      hidden: document.querySelector('#rank-legend')?.hidden,
      outsideRow: Boolean(document.querySelector('#rank-list .rank-row.is-outside')),
    }));
    check('勝率: 3戦では圏外', winrate.rank.includes('圏外'), winrate);
    check('勝率: あと何戦かが出る', winrate.need.includes('あと2戦'), winrate);
    check('勝率: 「5戦以上が対象」を明記', winrate.note.includes('5戦以上'), winrate);
    check('凡例: グー/チョキ/パーの色', /グー/.test(winrate.legend) && /チョキ/.test(winrate.legend) && /パー/.test(winrate.legend), winrate);
    await page.screenshot({ path: resolve(OUT, 'janken-b3-ranking-winrate.png') });

    await page.evaluate(() => window.JANKeNPoN.setRankingView({ metric: 'total' }));
    await page.waitForTimeout(300);
    const legend = await page.evaluate(() => {
      const items = [...document.querySelectorAll('#rank-legend .rank-legend__item i')].map((el) => getComputedStyle(el).backgroundColor);
      const bars = [...document.querySelectorAll('.rank-me .mini-rate i')].map((el) => getComputedStyle(el).backgroundColor);
      return { items, bars, count: document.querySelectorAll('#rank-legend .rank-legend__item').length };
    });
    check('凡例は3つ', legend.count === 3, legend);
    /* HAND_COLORS = #ffcf5c / #4fe3ff / #a58bff と同じ色（rgb 表記で比較） */
    check('凡例の色がグー/チョキ/パーの色', JSON.stringify(legend.items) === JSON.stringify(['rgb(255, 207, 92)', 'rgb(79, 227, 255)', 'rgb(165, 139, 255)']), legend.items);
    check('自分の行のバーと凡例が同じ色', JSON.stringify(legend.bars) === JSON.stringify(legend.items), legend);
    await page.screenshot({ path: resolve(OUT, 'janken-b3-ranking-legend.png') });
    await page.click('#sheet-ranking [data-close]');

    /* ---------------- 5. パーティー（無料の国内 / PRO の世界） ---------------- */
    step('party / domestic for free, world for PRO');
    /* 実際の入口（パーティーのカード → 開始ボタン）から開く（無料でも入れること） */
    await page.click('#mode-cards .mode-card[data-mode="party"]');
    await page.waitForTimeout(150);
    await page.click('#btn-play');
    await page.waitForTimeout(600);
    const party = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('#party-scope-seg button')].map((button) => ({
        text: button.textContent.trim(),
        locked: button.classList.contains('is-locked'),
        active: button.classList.contains('is-active'),
      }));
      return {
        buttons,
        note: document.querySelector('#party-scope-note').textContent,
        code: document.querySelector('#party-code-value').textContent,
        pro: window.JANKeNPoN.profile.pro,
      };
    });
    check('無料でもパーティーを開ける（国内が選ばれている）',
      party.buttons[0]?.text.includes('国内') && party.buttons[0]?.active === true, party);
    check('世界は PRO の鍵', party.buttons[1]?.locked === true, party);
    check('国内/世界の説明が出る', party.note.includes('国内') && party.note.includes('世界'), party.note);
    await page.screenshot({ path: resolve(OUT, 'janken-b3-party-domestic.png') });

    await page.evaluate(() => window.JANKeNPoN.setPro(true));
    await page.waitForTimeout(300);
    const proParty = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('#party-scope-seg button')].map((button) => ({
        text: button.textContent.trim(),
        locked: button.classList.contains('is-locked'),
      }));
      return { buttons };
    });
    check('PRO なら世界パーティーを選べる', proParty.buttons[1]?.locked === false, proParty);
    await page.click('#party-scope-seg button[data-scope="world"]');
    await page.waitForTimeout(400);
    const worldRoom = await page.evaluate(() => ({
      scope: window.JANKeNPoN.party.scope ?? null,
      code: document.querySelector('#party-code-value').textContent,
      active: document.querySelector('#party-scope-seg button[data-scope="world"]').classList.contains('is-active'),
    }));
    check('世界に切り替えると世界の部屋になる', worldRoom.active === true, worldRoom);
    await page.screenshot({ path: resolve(OUT, 'janken-b3-party-world.png') });
    await page.click('#sheet-party [data-close]');
    await page.evaluate(() => window.JANKeNPoN.setPro(false));

    /* ---------------- 5b. パーティーの「これで決定」 ---------------- */
    step('party / lock button');
    await page.evaluate(() => window.JANKeNPoN.demoParty(3));
    await page.waitForTimeout(500);
    const partyBefore = await page.evaluate(() => ({
      view: document.querySelector('.screen.is-active')?.id,
      phase: window.JANKeNPoN.party.phase,
      visible: window.JANKeNPoN.lockVisible,
    }));
    check('パーティー: 未選択では決定ボタンを出さない', partyBefore.visible === false, partyBefore);
    await page.click('#party-handbar .handbtn[data-hand="rock"]');
    await page.waitForTimeout(150);
    const partyPicked = await page.evaluate(() => ({
      visible: window.JANKeNPoN.lockVisible,
      label: document.querySelector('#party-lock-hand').textContent,
    }));
    check('パーティー: 手を選ぶと決定ボタンが出る', partyPicked.visible === true && partyPicked.label.includes('グー'), partyPicked);
    await page.click('#btn-party-lock');
    await page.waitForTimeout(200);
    const partyLocked = await page.evaluate(() => ({
      phase: window.JANKeNPoN.party.phase,
      hint: document.querySelector('#party-timer-hint').textContent,
      visible: window.JANKeNPoN.lockVisible,
    }));
    check('パーティー: 決定で送信し「相手を待っています」', partyLocked.visible === false && /待って/.test(partyLocked.hint), partyLocked);
    await page.screenshot({ path: resolve(OUT, 'janken-b3-party-lock.png') });
    await page.evaluate(() => window.JANKeNPoN.abortMatch?.('テスト終了'));

    check('JS エラーなし', errors.length === 0, errors.slice(0, 4));

    /* ---------------- 6. 通信対戦（2ブラウザ・5回戦） ---------------- */
    step('online match between two browsers (5 rounds, lock button)');
    const online = await verifyOnline(server);
    checks.push(...online.checks);

    console.log(`\nBUILD 3 画面チェック — ${checks.length} 件`);
    for (const item of checks) console.log(`  ${item.ok ? '✓' : '✗'} ${item.name}`);
  } finally {
    await browser.close();
    await server.close();
  }
}

/** 画面が隠れないよう、ブラウザを2つに分けて5回戦を最後まで遊ぶ */
async function verifyOnline(server) {
  const chromium = await loadChromium();
  const launch = () =>
    chromium.launch({
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
      env: { ...process.env, LD_LIBRARY_PATH: `${LIBS}:${process.env.LD_LIBRARY_PATH ?? ''}` },
    });
  const bA = await launch();
  const bB = await launch();
  const out = { checks: [] };
  const add = (name, ok, detail = '') => {
    out.checks.push({ name, ok: Boolean(ok), detail });
    if (!ok) throw new Error(`NG: ${name} ${JSON.stringify(detail)}`);
  };
  const code = `L${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  try {
    const open = async (browser, name, nick) => {
      const page = await (await browser.newContext({ viewport: { width: 393, height: 852 }, locale: 'ja-JP' })).newPage();
      page.on('pageerror', (error) => out.errors?.push(`${name}: ${error.message}`));
      await page.goto(`${server.url}/index.html?fast=1`, { waitUntil: 'load' });
      await page.waitForFunction(() => Boolean(window.JANKeNPoN));
      await page.fill('#nickname', nick);
      await page.locator('#nickname').blur();
      await page.evaluate(() => window.JANKeNPoN.openSheet('online'));
      return page;
    };
    const A = await open(bA, 'A', 'E2E-A');
    const B = await open(bB, 'B', 'E2E-B');
    await A.fill('#online-code', code);
    await B.fill('#online-code', code);
    await A.click('#btn-room-join');
    await B.click('#btn-room-join');
    for (const [name, page] of [['A', A], ['B', B]]) {
      await page.waitForSelector('#screen-play.is-active', { timeout: 25000 });
    }
    add('通信: 2台が合言葉の部屋で組になる', true);

    /* 5回戦を、両方が「これで決定」で進める */
    for (let round = 0; round < 5; round += 1) {
      await Promise.all([A, B].map((page) => page.waitForFunction(() => window.JANKeNPoN.phase === 'thinking', null, { timeout: 20000 })));
      await A.click('.handbtn[data-hand="paper"]');
      await B.click('.handbtn[data-hand="rock"]');
      await Promise.all([A, B].map((page) => page.click('#btn-lock')));
      await Promise.all([A, B].map((page) => page.waitForFunction(
        () => window.JANKeNPoN.match?.history.length >= Number(document.body.dataset.round ?? 0) || window.JANKeNPoN.match?.finished,
        null,
        { timeout: 20000 },
      ).catch(() => {})));
    }
    for (const [name, page] of [['A', A], ['B', B]]) {
      await page.waitForSelector('#screen-result.is-active', { timeout: 25000 });
    }
    const resultA = await A.evaluate(() => ({
      verdict: document.querySelector('#result-verdict').textContent.trim(),
      score: document.querySelector('#result-points').textContent.trim(),
      history: window.JANKeNPoN.match?.history.length ?? 0,
    }));
    const resultB = await B.evaluate(() => ({
      verdict: document.querySelector('#result-verdict').textContent.trim(),
      score: document.querySelector('#result-points').textContent.trim(),
      history: window.JANKeNPoN.match?.history.length ?? 0,
    }));
    add('通信: 5回戦が最後まで進む', resultA.history === 5 && resultB.history === 5, { resultA, resultB });
    add('通信: 勝ち負けが2台で噛み合う',
      /WIN/.test(resultA.verdict) === /LOSE/.test(resultB.verdict), { resultA, resultB });
    await A.screenshot({ path: resolve(OUT, 'janken-b3-online-result.png') });
  } finally {
    await bA.close();
    await bB.close();
  }
  return out;
}

main().catch((error) => {
  console.error(`\n✗ ${error.message}`);
  for (const item of checks) console.log(`  ${item.ok ? '✓' : '✗'} ${item.name}`);
  process.exitCode = 1;
});
