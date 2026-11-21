/**
 * 実ブラウザ（Chromium）での操作テスト＋スクリーンショット（Build 1）
 *   npm run shots
 *
 * 出力: /workspace/downloads/janken-b1-*.png
 *   title / modes / online-sheet / online-play / party / party-result /
 *   result / ranking / pro / language / privacy
 *
 * 環境変数（この環境の Chromium 用）:
 *   PLAYWRIGHT_LIBS … libnspr4 等の場所
 *   PLAYWRIGHT_PATH … playwright 本体の場所
 *   ?fast=1 は付けない（5秒固定のタイマー表示をそのまま見る）
 */

import { mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './serve.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKSPACE = resolve(ROOT, '../..');
const OUT = resolve(WORKSPACE, 'downloads');

const LIBS =
  process.env.PLAYWRIGHT_LIBS ??
  '/workspace/work/dorokei-game/.browser-libs/usr/lib/x86_64-linux-gnu';
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
  throw new Error('playwright が見つかりません（npm i -D playwright で導入してください）');
}

const checks = [];
function check(name, condition, detail = '') {
  checks.push({ name, ok: Boolean(condition), detail });
  if (!condition) throw new Error(`NG: ${name} ${JSON.stringify(detail)}`);
}
const step = (msg) => console.error(`[step] ${msg}`);

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
      viewport: { width: 430, height: 932 },
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
    page.on('requestfailed', (request) => {
      const url = request.url();
      /* 通信は別プロジェクト（Supabase）。ここが落ちても UI はローカルで動く */
      if (!url.includes('favicon') && !url.includes('supabase.co')) {
        errors.push(`requestfailed: ${url} ${request.failure()?.errorText}`);
      }
    });

    /* ---------- 1. タイトル ---------- */
    step('home');
    await page.goto(`${server.url}/`, { waitUntil: 'load' });
    await page.waitForFunction(() => Boolean(window.JANKeNPoN));
    await page.fill('#nickname', 'トモアキ');
    await page.locator('#nickname').blur();
    await page.waitForTimeout(400);

    const home = await page.evaluate(() => ({
      points: document.querySelector('#home-points').textContent,
      rank: document.querySelector('#home-rank').textContent,
      modes: Array.from(document.querySelectorAll('#mode-cards .mode-card')).map((card) => card.dataset.mode),
      modeGrid: document.querySelectorAll('#mode-grid').length,
      special: document.querySelector('#screen-home').textContent.includes('ゾウ・人間・アリ'),
      levels: document.querySelectorAll('.level').length,
      lockedLevels: document.querySelectorAll('.level.is-locked').length,
      playLabel: document.querySelector('#play-label').textContent,
      playSub: document.querySelector('#play-sub').textContent,
      practice: document.querySelector('#practice-stats').textContent,
      resetDisabled: document.querySelector('#btn-practice-reset').disabled,
      tabs: Array.from(document.querySelectorAll('.tabbar button span')).map((el) => el.textContent),
      kicker: document.querySelector('.logo__tag').textContent,
    }));
    check('タイトル: 3つの対戦モード', home.modes.join(',') === 'practice,online,party', home.modes);
    check('タイトル: ルール選択のグリッドは無い（クラシック一本）', home.modeGrid === 0 && !home.special, home);
    check('タイトル: CPU4段階・最強だけロック', home.levels === 4 && home.lockedLevels === 1, home);
    check('タイトル: 初期は5回戦・中級7.0秒', /5回戦をはじめる/.test(home.playLabel) && /7\.0s/.test(home.playSub), home);
    check('タイトル: 練習データは空', home.practice.includes('まだ') && home.resetDisabled, home);
    check('タイトル: タブ4つ', home.tabs.length === 4, home.tabs);
    await page.screenshot({ path: resolve(OUT, 'janken-b1-title.png') });

    /* ---------- 2. 通信モードのパネル ---------- */
    step('online panel');
    await page.click('#mode-cards .mode-card[data-mode="online"]');
    await page.waitForTimeout(150);
    const onlinePanel = await page.evaluate(() => ({
      panel: !document.querySelector('#panel-online').hidden,
      practiceHidden: document.querySelector('#panel-practice').hidden,
      scopes: Array.from(document.querySelectorAll('#scope-seg button')).map((b) => b.textContent.trim()),
      cta: document.querySelector('#play-label').textContent,
      sub: document.querySelector('#play-sub').textContent,
      note: document.querySelector('#online-mode-note').textContent,
    }));
    check('通信: 国内/世界の切替が出る', onlinePanel.scopes.length === 2, onlinePanel.scopes);
    check('通信: CTA がクイックマッチ', onlinePanel.cta === 'クイックマッチ', onlinePanel.cta);
    check('通信: 1手5秒・国内が無料と分かる', /5\.0s/.test(onlinePanel.sub) && /国内/.test(onlinePanel.note), onlinePanel);
    await page.screenshot({ path: resolve(OUT, 'janken-b1-modes.png') });

    step('online sheet');
    await page.evaluate(() => window.JANKeNPoN.openSheet('online'));
    await page.waitForSelector('#sheet-online:not([hidden])');
    await page.waitForTimeout(300);
    const sheet = await page.evaluate(() => ({
      title: document.querySelector('#online-status-title').textContent,
      sub: document.querySelector('#online-status-sub').textContent,
      turn: document.querySelector('#sheet-online').textContent.includes('1手5秒固定'),
      code: Boolean(document.querySelector('#online-code')),
    }));
    check('通信シート: 待機の説明と5秒固定', sheet.turn && sheet.code, sheet);
    await page.screenshot({ path: resolve(OUT, 'janken-b1-online-sheet.png') });
    await page.evaluate(() => window.JANKeNPoN.closeSheet());

    /* ---------- 3. 通信の対戦画面（5.0秒・相手は OPPONENT） ---------- */
    step('online play');
    await page.evaluate(() => window.JANKeNPoN.demoOnlineMatch({ nickname: 'Kai', countryCode: 'US' }));
    await page.waitForFunction(() => window.JANKeNPoN.phase === 'thinking');
    const onlinePlay = await page.evaluate(() => ({
      timer: document.querySelector('#timer-num').textContent,
      level: document.querySelector('#opp-level').textContent,
      label: document.querySelector('#cpu-label').textContent,
      name: document.querySelector('#opp-name').textContent,
      hands: document.querySelectorAll('.handbtn').length,
    }));
    check('通信の対戦: タイマーが5.0秒固定', onlinePlay.timer === '5.0', onlinePlay.timer);
    check('通信の対戦: 相手は ONLINE / OPPONENT', /ONLINE/.test(onlinePlay.level) && onlinePlay.label === 'OPPONENT', onlinePlay);
    check('通信の対戦: 手は3つ（クラシック）', onlinePlay.hands === 3, onlinePlay.hands);
    await page.screenshot({ path: resolve(OUT, 'janken-b1-online-play.png') });
    await page.click('#btn-quit');
    await page.waitForSelector('#screen-home.is-active');

    /* ---------- 4. CPU練習の1試合 → 結果（ランキング非加算） ---------- */
    step('practice match');
    await page.evaluate(() => {
      window.JANKeNPoN.setMode('practice');
      window.JANKeNPoN.setRounds(5);
    });
    await page.evaluate(() => {
      for (let i = 0; i < 5; i += 1) window.JANKeNPoN.forceCpuHand('scissors');
      window.JANKeNPoN.startMatch({ opponentCode: 'BR', levelId: 'normal' });
    });
    await page.waitForFunction(() => window.JANKeNPoN.phase === 'thinking');
    /* 速く回すため、5回ともグーで勝つ */
    for (let i = 0; i < 5; i += 1) {
      await page.waitForFunction(() => window.JANKeNPoN.phase === 'thinking');
      await page.click('.handbtn[data-hand="rock"]');
      await page.waitForFunction(
        (round) => window.JANKeNPoN.phase === 'thinking' || document.querySelector('#screen-result.is-active') !== null,
        i,
        { timeout: 8000 },
      );
    }
    await page.waitForSelector('#screen-result.is-active', { timeout: 8000 });
    const result = await page.evaluate(() => ({
      verdict: document.querySelector('#result-verdict').textContent,
      points: document.querySelector('#result-points').textContent,
      rankHidden: document.querySelector('#rank-card').hidden,
      note: document.querySelector('#result-note').hidden ? '' : document.querySelector('#result-note').textContent,
      practice: document.querySelector('#practice-result-stats').textContent,
      world: window.JANKeNPoN.profile.world['5'].points,
      rounds: document.querySelectorAll('#result-rounds .round-row').length,
    }));
    check('結果: 5回戦の勝敗とポイント', result.rounds === 5 && result.verdict === 'WIN', result);
    check('結果: 練習はランキングに加算しない', result.rankHidden && result.world === 0, result);
    check('結果: その旨が画面に出る', result.note.includes('加算されません'), result.note);
    await page.waitForTimeout(1400); // 数字のカウントアップが終わるまで
    await page.screenshot({ path: resolve(OUT, 'janken-b1-result.png') });
    await page.click('#btn-home');
    await page.waitForSelector('#screen-home.is-active');

    /* ---------- 5. パーティー（2〜4人・5回戦・ランキング対象外） ---------- */
    step('party');
    await page.evaluate(() => window.JANKeNPoN.setPro(true));
    await page.evaluate(() => window.JANKeNPoN.demoParty(3));
    await page.waitForSelector('#screen-party.is-active');
    const party = await page.evaluate(() => ({
      pods: document.querySelectorAll('#party-grid .ppod').length,
      round: document.querySelector('#party-round-label').textContent,
      timer: document.querySelector('#party-timer-num').textContent,
      unranked: document.querySelector('#screen-party').textContent.includes('ランキング対象外'),
      hands: document.querySelectorAll('#party-handbar .handbtn').length,
    }));
    check('パーティー: 3人のカード', party.pods === 3, party.pods);
    check('パーティー: ROUND 1 / 5', party.round === 'ROUND 1 / 5', party.round);
    check('パーティー: 1手5.0秒', party.timer === '5.0', party.timer);
    check('パーティー: ランキング対象外の表記', party.unranked, party);
    await page.evaluate(() => window.JANKeNPoN.demoPartyRound());
    await page.waitForTimeout(300);
    const partyRound = await page.evaluate(() => ({
      revealed: document.querySelectorAll('#party-grid .ppod.is-revealed').length,
      verdict: document.querySelector('#party-verdict-label').textContent,
      winner: document.querySelectorAll('#party-grid .ppod.is-winner').length,
    }));
    check('パーティー: 全員の手が開く', partyRound.revealed === 3, partyRound);
    check('パーティー: 勝った人が分かる', partyRound.winner === 1 && partyRound.verdict.includes('+5'), partyRound);
    await page.waitForTimeout(2200); // トーストが消えるまで
    await page.screenshot({ path: resolve(OUT, 'janken-b1-party.png') });

    step('party result');
    await page.evaluate(() => window.JANKeNPoN.demoPartyResult());
    await page.waitForSelector('#screen-party-result.is-active');
    const partyResult = await page.evaluate(() => ({
      rows: document.querySelectorAll('#party-standings .standing-row').length,
      verdict: document.querySelector('#party-result-verdict').textContent,
      points: document.querySelector('#party-result-points').textContent,
      note: document.querySelector('#screen-party-result').textContent.includes('加算されません'),
      world: window.JANKeNPoN.profile.world['5'].points,
      party: window.JANKeNPoN.profile.party.matches,
    }));
    check('パーティー結果: 順位表に3人', partyResult.rows === 3, partyResult.rows);
    check('パーティー結果: 優勝表示', partyResult.verdict === 'CHAMPION' && partyResult.points === '18', partyResult);
    check('パーティー結果: ランキングは動かない', partyResult.world === 0 && partyResult.party === 1, partyResult);
    check('パーティー結果: 非加算の注記', partyResult.note, partyResult);
    await page.waitForTimeout(2200); // トーストが消えるまで
    await page.screenshot({ path: resolve(OUT, 'janken-b1-party-result.png') });
    await page.click('#btn-party-home');
    await page.waitForSelector('#screen-home.is-active');

    /* ---------- 6. ランキング（国内は無料・世界は PRO） ---------- */
    step('ranking');
    await page.evaluate(() => window.JANKeNPoN.setPro(false));
    await page.click('.tabbar button[data-nav="ranking"]');
    await page.waitForSelector('#sheet-ranking:not([hidden])');
    await page.waitForTimeout(200);
    const ranking = await page.evaluate(() => ({
      title: document.querySelector('#ranking-title').textContent,
      rows: document.querySelectorAll('#rank-list .rank-row').length,
      me: document.querySelector('#rank-me').textContent.includes('YOU'),
      worldLocked: Array.from(document.querySelectorAll('#scope-tabs button')).some((b) => b.dataset.scope === 'world' && b.classList.contains('is-locked')),
      metrics: document.querySelectorAll('#metric-tabs button').length,
    }));
    check('ランキング: 国内が開く', ranking.title.includes('国内') && ranking.me, ranking);
    check('ランキング: 世界は PRO ロック', ranking.worldLocked, ranking);
    check('ランキング: 指標3つ・行が出る', ranking.metrics === 3 && ranking.rows > 3, ranking);
    await page.screenshot({ path: resolve(OUT, 'janken-b1-ranking.png') });
    await page.click('#sheet-ranking [data-close]');

    /* ---------- 7. PRO シートと解放 ---------- */
    step('pro');
    await page.click('.tabbar button[data-nav="pro"]');
    await page.waitForSelector('#sheet-pro:not([hidden])');
    const proSheet = await page.evaluate(() => ({
      items: document.querySelectorAll('.pro-list li').length,
      price: document.querySelector('#pro-price-amount').textContent,
      buy: !document.querySelector('#btn-pro-buy').hidden,
      preview: !document.querySelector('#btn-pro-toggle').hidden,
    }));
    check('PRO: 5つの解放内容', proSheet.items === 5, proSheet.items);
    check('PRO: 価格と購入ボタン（プレビューは体験スイッチ）', proSheet.price.includes('480') && proSheet.buy && proSheet.preview, proSheet);
    await page.screenshot({ path: resolve(OUT, 'janken-b1-pro.png') });
    await page.click('#btn-pro-toggle');
    await page.waitForTimeout(200);
    const proOn = await page.evaluate(() => ({
      pro: window.JANKeNPoN.profile.pro,
      lockedLevels: document.querySelectorAll('.level.is-locked').length,
    }));
    check('PRO ON で最強CPUが解放', proOn.pro && proOn.lockedLevels === 0, proOn);
    await page.click('#sheet-pro [data-close]');

    /* ---------- 8. 12言語 ---------- */
    step('language');
    await page.click('.tabbar button[data-nav="settings"]');
    await page.waitForSelector('#sheet-settings:not([hidden])');
    await page.click('#set-language');
    await page.waitForSelector('#sheet-language:not([hidden])');
    const lang = await page.evaluate(() => ({
      count: document.querySelectorAll('#lang-grid .lang-item').length,
      labels: Array.from(document.querySelectorAll('#lang-grid .lang-item b')).map((b) => b.textContent),
    }));
    check('言語: 12言語', lang.count === 12, lang.count);
    await page.screenshot({ path: resolve(OUT, 'janken-b1-language.png') });
    await page.click('#lang-grid .lang-item[data-locale="en"]');
    await page.waitForTimeout(300);
    const english = await page.evaluate(() => ({
      tab: document.querySelector('.tabbar button[data-nav="ranking"] span').textContent,
      play: document.querySelector('#play-label').textContent,
      practice: document.querySelector('#practice-stats').textContent,
    }));
    check('言語: 英語に切り替わる', english.tab === 'Ranking' && /round match/.test(english.play), english);
    await page.evaluate(() => window.JANKeNPoN.setLocale('ja'));
    await page.waitForTimeout(200);
    await page.click('#sheet-language [data-close]');
    await page.click('#sheet-settings [data-close]');

    /* ---------- 9. プライバシーポリシー ---------- */
    step('privacy');
    await page.evaluate(() => window.JANKeNPoN.openSheet('privacy'));
    await page.waitForSelector('#sheet-privacy:not([hidden])');
    const legal = await page.evaluate(() => ({
      headings: document.querySelectorAll('#sheet-privacy .legal h4').length,
      text: document.querySelector('#sheet-privacy .legal').textContent.length,
    }));
    check('プライバシーポリシーが開く', legal.headings >= 8 && legal.text > 900, legal);
    await page.screenshot({ path: resolve(OUT, 'janken-b1-privacy.png') });
    await page.evaluate(() => window.JANKeNPoN.closeSheet());

    /* ---------- 10. ホームに戻して、最終状態 ---------- */
    await page.evaluate(() => window.JANKeNPoN.setPro(false));
    await page.waitForTimeout(200);
    await page.screenshot({ path: resolve(OUT, 'janken-b1-home-final.png') });

    check('JS エラーが 0（外部の通信失敗を除く）', errors.length === 0, errors.slice(0, 4));

    console.log(`\nJANKeN PoN Build 1 — ${checks.length} checks pass`);
    for (const item of checks) console.log(`  ✓ ${item.name}`);
  } finally {
    if (browser) await browser.close();
    await server.close();
  }
}

main().catch((error) => {
  console.error(`\n✗ ${error.message}`);
  process.exitCode = 1;
});
