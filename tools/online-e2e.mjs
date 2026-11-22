/**
 * 通信対戦のエンドツーエンド確認（実ブラウザ2枚 × 実際の Supabase）
 *   node tools/online-e2e.mjs
 *
 * 同じ Chromium に2ページ開き、両方から合言葉の部屋（使い捨てのコード）へ入り、
 * 5回戦を最後まで遊んで、両方の結果が一致するかを確かめる。
 * ネットワークが要るので `npm test` には入れていない（手動の確認用）。
 *
 * 環境変数:
 *   PLAYWRIGHT_LIBS / PLAYWRIGHT_PATH … この環境の Chromium 用
 *   ONLINE_E2E_ROUNDS … 遊ぶ回戦数（既定は全部 = 5）
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './serve.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
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
  throw new Error('playwright が見つかりません');
}

const code = `Q${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: Boolean(ok), detail });
  if (!ok) throw new Error(`NG: ${name} ${JSON.stringify(detail)}`);
};

async function main() {
  const chromium = await loadChromium();
  const server = await startServer();
  let browser = null;
  try {
    browser = await chromium.launch({
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
      env: { ...process.env, LD_LIBRARY_PATH: `${LIBS}:${process.env.LD_LIBRARY_PATH ?? ''}` },
    });
    const context = await browser.newContext({ viewport: { width: 430, height: 932 }, locale: 'ja-JP' });
    const errors = [];
    const open = async (name) => {
      const page = await context.newPage();
      page.on('pageerror', (error) => errors.push(`${name}: ${error.message}`));
      await page.goto(`${server.url}/?fast=1`, { waitUntil: 'load' });
      await page.waitForFunction(() => Boolean(window.JANKeNPoN));
      await page.fill('#nickname', name);
      await page.locator('#nickname').blur();
      /* 部屋は完全に任意のコードなので、だれとも当たらない */
      await page.evaluate(() => window.JANKeNPoN.openSheet('online'));
      return page;
    };
    const A = await open('E2E-A');
    const B = await open('E2E-B');
    await A.fill('#online-code', code);
    await B.fill('#online-code', code);
    await A.click('#btn-room-join');
    await B.click('#btn-room-join');

    for (const [name, page] of [['A', A], ['B', B]]) {
      try {
        await page.waitForSelector('#screen-play.is-active', { timeout: 25000 });
      } catch (e) {
        const diag = await page.evaluate(() => ({
          view: document.querySelector('.screen.is-active')?.id ?? null,
          online: window.JANKeNPoN.online,
          toast: document.querySelector('#toast')?.textContent ?? '',
          sheet: !document.querySelector('#sheet-online').hidden,
        })).catch(() => null);
        console.error(`DIAG ${name}`, JSON.stringify(diag), errors.slice(0, 4));
        throw e;
      }
      const chrome = await page.evaluate(() => ({
        timer: document.querySelector('#timer-num').textContent,
        level: document.querySelector('#opp-level').textContent,
      }));
      check(`${name}: 5秒の対戦画面に入った`, /ONLINE/.test(chrome.level) && Number(chrome.timer) <= 5, chrome);
    }

    /* 5回戦を、両方が同時に手を出して進める
       （裏のタブはタイマーが絞られるので、押す前に前面へ出し、?fast=1 で待ちを短くする） */
    const rounds = Number(process.env.ONLINE_E2E_ROUNDS ?? 5);
    for (let round = 0; round < rounds; round += 1) {
      for (const page of [A, B]) {
        await page.waitForFunction(
          () => window.JANKeNPoN.phase === 'thinking' || document.querySelector('#screen-result.is-active') !== null,
          { timeout: 25000 },
        );
      }
      await A.bringToFront();
      await A.click('.handbtn[data-hand="paper"]');
      await B.bringToFront();
      await B.click('.handbtn[data-hand="rock"]');
      /* 次のラウンドに入る（または結果画面）まで待つ */
      for (const page of [A, B]) {
        await page.waitForFunction(
          () => window.JANKeNPoN.phase === 'thinking' || document.querySelector('#screen-result.is-active') !== null,
          { timeout: 25000 },
        );
      }
    }

    for (const [name, page, expect] of [['A', A, 'win'], ['B', B, 'lose']]) {
      await page.bringToFront();
      try {
        await page.waitForSelector('#screen-result.is-active', { timeout: 30000 });
      } catch (e) {
        const diag = await page.evaluate(() => ({
          view: document.querySelector('.screen.is-active')?.id ?? null,
          phase: window.JANKeNPoN.phase,
          round: window.JANKeNPoN.match?.roundIndex ?? null,
          rounds: window.JANKeNPoN.match?.rounds ?? null,
          history: window.JANKeNPoN.match?.history?.length ?? 0,
          online: window.JANKeNPoN.online,
          toast: document.querySelector('#toast')?.textContent ?? '',
        })).catch(() => null);
        console.error(`DIAG result ${name}`, JSON.stringify(diag), errors.slice(0, 4));
        throw e;
      }
      const result = await page.evaluate(() => ({
        verdict: document.querySelector('#result-verdict').textContent,
        points: document.querySelector('#result-points').textContent,
        ranked: !document.querySelector('#rank-card').hidden,
        scope: document.querySelector('#rank-scope-label').textContent,
        sub: document.querySelector('#result-sub').textContent,
        world: window.JANKeNPoN.profile.world['5'].points,
        matches: window.JANKeNPoN.profile.world['5'].matches,
      }));
      check(`${name}: 判定は ${expect}`, /WIN/.test(result.verdict) === (expect === 'win'), result);
      check(`${name}: 勝敗が国内ランキングに記録される`, result.ranked && result.matches === 1, result);
    }

    check('JS エラーなし', errors.length === 0, errors.slice(0, 3));
    console.log(`\nONLINE E2E（room ${code}）— ${checks.length} checks pass`);
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
process.on('exit', () => {
  for (const item of checks) console.log(`${item.ok ? '✓' : '✗'} ${item.name}`);
});
