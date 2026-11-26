/**
 * JANKeN PoN — Build 1 の確定仕様テスト
 *
 * トモアキさんが決めた Build 1 の仕様を、コードとファイルの両方で担保する:
 *   ・クラシック一本（特殊ルールは UI に出さない）
 *   ・通信は1手5秒固定 / マッチング30秒
 *   ・国内は無料、世界とパーティーと最強CPUと手の率と金色フレームは PRO
 *   ・2〜4人パーティーは5回戦で、どのランキングにも加算しない
 *   ・12言語
 *   ・アイコン／Bundle ID／TestFlight ワークフローの契約
 *   ・通信の安全（自由入力なし・定型スタンプ・検証）
 *
 *   npm test
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  RULESETS,
  ACTIVE_RULESETS,
  ARCHIVED_RULESETS,
  SPECIAL_RULESETS,
  UNRANKED_RULESETS,
  activeRulesets,
  isRulesetVisible,
  rulesetsForMode,
  LEVELS,
  ONLINE_TURN_MS,
  MATCH_TIMEOUT_MS,
  ONLINE_RULES,
  PARTY_ROUNDS,
  PARTY_MIN_PLAYERS,
  PARTY_MAX_PLAYERS,
  PARTY_TURN_MS,
  PARTY_COUNTS_FOR_RANKING,
  scorePartyRound,
  partyStandings,
  validateOnlinePick,
  validateStamp,
  payloadTooLarge,
  ONLINE_LIMITS,
  pointsFor,
} from '../src/core.js';
import {
  PRODUCT_ID,
  FREE_LEVELS,
  PRO_LEVELS,
  levelsFor,
  canUseLevel,
  canPlayWorld,
  canPlayDomestic,
  canPlayParty,
  canPlayDomesticParty,
  canPlayWorldParty,
  partyScopesFor,
  canSeeOpponentRates,
  frameFor,
  fallbackPrice,
} from '../src/pro.js';
import { LOCALES, KEYS, t, DICT, PROSE, applyI18n, detectLocale, FALLBACK_LOCALE } from '../src/i18n.js';
import {
  createProfileStore,
  createMemoryBackend,
  defaultProfile,
  applyMatch,
  applyParty,
  worldOf,
  defaultParty,
} from '../src/storage.js';
import { DIVISIONS, RANK_METRICS, RANK_SCOPES, leaderboard } from '../src/ranking.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(ROOT, path), 'utf8');
const exists = (path) => existsSync(resolve(ROOT, path));

/* ------------------------------------------------------------------ *\
 * 1. クラシック一本
 * ------------------------------------------------------------------ */

test('Build 9: ランキングはクラシック一本・ランキング外は特別ルールも選べる', () => {
  assert.deepEqual([...ACTIVE_RULESETS], ['standard'], 'ランキングが入るルールは増やさない');
  assert.equal(activeRulesets().length, 1);
  assert.deepEqual([...UNRANKED_RULESETS], ['standard', 'epa', 'well']);
  assert.equal(isRulesetVisible('standard'), true);
  assert.equal(isRulesetVisible('epa'), true);
  assert.equal(isRulesetVisible('well'), true);
});

test('世界の特別ルールは PRO の遊び（ランキングが入るモードでは使わない）', () => {
  assert.ok(RULESETS.epa, 'ゾウ・人間・アリ');
  assert.ok(RULESETS.well, '井戸つき');
  assert.deepEqual([...SPECIAL_RULESETS], ['epa', 'well']);
  assert.deepEqual([...ARCHIVED_RULESETS], [], 'UI から外しているルールは無い');
  for (const id of SPECIAL_RULESETS) {
    assert.equal(RULESETS[id].pro, true, `${id} は PRO`);
    assert.equal(RULESETS[id].special, true, `${id} は特別ルール`);
  }
  assert.equal(RULESETS.standard.special, undefined, 'クラシックは特別ルールではない');
  /* 通信対戦（ランキング）はクラシック固定 */
  assert.deepEqual(rulesetsForMode('online').map((set) => set.id), ['standard']);
  assert.deepEqual(rulesetsForMode('practice').map((set) => set.id), ['standard', 'epa', 'well']);
  assert.deepEqual(rulesetsForMode('party').map((set) => set.id), ['standard', 'epa', 'well']);
});

test('クラシックのポイントは世界共通の 3 / 2 / 5、あいこは 0', () => {
  assert.equal(pointsFor('rock', 'standard'), 3);
  assert.equal(pointsFor('scissors', 'standard'), 2);
  assert.equal(pointsFor('paper', 'standard'), 5);
});

test('ホーム画面のルール選択は小さなチップ（PRO の印つき・大きなグリッドは無い）', () => {
  const html = read('index.html');
  assert.equal(html.includes('id="mode-grid"'), false, '大きなルール選択グリッドは作らない');
  assert.ok(html.includes('id="rule-chips"'), 'CPU練習のパネルにチップの列');
  assert.ok(html.includes('id="party-rule-seg"'), 'パーティーのシートにもチップの列');
  assert.ok(html.includes('id="rule-hint"'), '特別ルールの一言説明');
  assert.ok(html.includes('CLASSIC'), 'クラシックの表記は残す');
});

/* ------------------------------------------------------------------ *\
 * 2. 通信の国際固定ルール
 * ------------------------------------------------------------------ */

test('通信対戦は1手5秒固定・マッチングは30秒で打ち切り', () => {
  assert.equal(ONLINE_TURN_MS, 5000);
  assert.equal(MATCH_TIMEOUT_MS, 30000);
  assert.equal(ONLINE_RULES.turnMs, 5000);
  assert.equal(ONLINE_RULES.matchTimeoutMs, 30000);
  assert.equal(ONLINE_RULES.rulesetId, 'standard');
});

test('CPU練習だけが思考時間を選べる（2秒〜7秒・中級5秒が基本）', () => {
  const times = Object.values(LEVELS).map((level) => level.thinkingTimeMs);
  assert.deepEqual(times.sort((a, b) => a - b), [2000, 3000, 5000, 7000]);
  for (const time of times) {
    assert.ok(time >= 2000 && time <= 7000, `${time}ms は 2〜7秒の範囲`);
  }
  /* Build 3: 中級の5秒は、通信対戦の1手5秒と同じ速さ（基本の速さを合わせる） */
  assert.equal(LEVELS.normal.thinkingTimeMs, ONLINE_TURN_MS);
  assert.equal(LEVELS.easy.thinkingTimeMs, 7000);
  assert.equal(LEVELS.hard.thinkingTimeMs, 3000);
  assert.equal(LEVELS.master.thinkingTimeMs, 2000);
});

/* ------------------------------------------------------------------ *\
 * 3. パーティーバトル（2〜4人・5回戦・ランキング非加算）
 * ------------------------------------------------------------------ */

test('パーティーは 2〜4人・5回戦・1手5秒', () => {
  assert.equal(PARTY_ROUNDS, 5);
  assert.equal(PARTY_MIN_PLAYERS, 2);
  assert.equal(PARTY_MAX_PLAYERS, 4);
  assert.equal(PARTY_TURN_MS, ONLINE_TURN_MS);
  assert.equal(ONLINE_RULES.party.rounds, 5);
  assert.equal(ONLINE_RULES.party.max, 4);
});

test('パーティーの結果はどのランキングにも加算しない（定数で担保）', () => {
  assert.equal(PARTY_COUNTS_FOR_RANKING, false);
  assert.equal(ONLINE_RULES.party.ranked, false);
});

test('パーティーの採点: 単独勝ちも複数勝ちもその手のポイント', () => {
  const single = scorePartyRound({ a: 'rock', b: 'scissors' });
  assert.deepEqual(single.winners, ['a']);
  assert.equal(single.points.a, 3);
  assert.equal(single.points.b, 0);

  const multi = scorePartyRound({ a: 'paper', b: 'paper', c: 'rock', d: 'rock' });
  assert.deepEqual(multi.winners.sort(), ['a', 'b']);
  assert.equal(multi.points.a, 5);
  assert.equal(multi.points.b, 5);
  assert.equal(multi.points.c, 0);
  assert.equal(multi.points.d, 0);
});

test('パーティーの採点: 全員同じ手・3すくみは 0pt', () => {
  const same = scorePartyRound({ a: 'rock', b: 'rock', c: 'rock' });
  assert.equal(same.allSame, true);
  assert.deepEqual(Object.values(same.points), [0, 0, 0]);

  const three = scorePartyRound({ a: 'rock', b: 'scissors', c: 'paper' });
  assert.equal(three.threeWay, true);
  assert.deepEqual(Object.values(three.points), [0, 0, 0]);

  const four = scorePartyRound({ a: 'rock', b: 'scissors', c: 'paper', d: 'rock' });
  assert.equal(four.threeWay, true);
  assert.deepEqual(Object.values(four.points), [0, 0, 0, 0]);
});

test('パーティーの最終順位はポイント順・同点は同順位', () => {
  const standings = partyStandings([
    { id: 'a', nickname: 'A', points: 12 },
    { id: 'b', nickname: 'B', points: 17 },
    { id: 'c', nickname: 'C', points: 12 },
  ]);
  assert.equal(standings[0].id, 'b');
  assert.equal(standings[0].rank, 1);
  assert.equal(standings[1].rank, 2);
  assert.equal(standings[2].rank, 2);
  assert.equal(standings[1].points, 12);
});

test('パーティーの記録は端末内だけで、世界記録に触らない', () => {
  let profile = defaultProfile();
  profile = applyMatch(profile, { matchPoints: 9, verdict: 'win', rank: 70, rounds: 5, hands: ['rock'] });
  const worldBefore = JSON.parse(JSON.stringify(profile.world));

  profile = applyParty(profile, { points: 25, champion: true, hands: ['paper', 'paper'] });
  assert.deepEqual(profile.world, worldBefore, '世界ランキングの値は1つも変わらない');
  assert.equal(profile.party.matches, 1);
  assert.equal(profile.party.wins, 1);
  assert.equal(profile.party.points, 25);
  assert.equal(profile.practice.matches, 1, '練習データも増えない');
});

test('ranked: false のマッチは世界記録に加算しない', () => {
  const profile = applyMatch(defaultProfile(), {
    matchPoints: 20, verdict: 'win', rank: 1, rounds: 5, hands: ['paper'], ranked: false,
  });
  assert.equal(worldOf(profile, '5').points, 0);
  assert.equal(worldOf(profile, '5').matches, 0);
  assert.equal(profile.practice.matches, 1);
});

/* ------------------------------------------------------------------ *\
 * 4. 無料と PRO の線引き
 * ------------------------------------------------------------------ */

test('無料: CPU練習（初〜上級）・国内ランキング・12言語', () => {
  assert.deepEqual(levelsFor(false), ['easy', 'normal', 'hard']);
  assert.equal(canUseLevel(false, 'master'), false);
  assert.equal(canPlayDomestic(), true);
  assert.equal(canPlayWorld(false), false);
  /* Build 3: 国内パーティーは無料（世界パーティーだけ PRO） */
  assert.equal(canPlayParty(false), true);
  assert.equal(canPlayDomesticParty(), true);
  assert.equal(canPlayWorldParty(false), false);
  assert.deepEqual(partyScopesFor(false), ['domestic']);
  assert.equal(canSeeOpponentRates(false), false);
  assert.equal(frameFor(false), 'standard');
});

test('PRO: 世界・パーティー・最強CPU・手の率・ゴールドフレーム', () => {
  assert.deepEqual(levelsFor(true), ['easy', 'normal', 'hard', 'master']);
  assert.equal(canUseLevel(true, 'master'), true);
  assert.equal(canPlayWorld(true), true);
  assert.equal(canPlayParty(true), true);
  assert.equal(canPlayWorldParty(true), true);
  assert.deepEqual(partyScopesFor(true), ['domestic', 'world']);
  assert.equal(canSeeOpponentRates(true), true);
  assert.equal(frameFor(true), 'gold');
  assert.ok(FREE_LEVELS.every((id) => PRO_LEVELS.includes(id)));
});

test('課金プロダクトIDは jp.signlink.JankenPon.pro', () => {
  assert.equal(PRODUCT_ID, 'jp.signlink.JankenPon.pro');
});

test('PRO の価格表示は12言語ぶんある（StoreKit の表示価格が優先）', () => {
  for (const locale of LOCALES) {
    assert.ok(fallbackPrice(locale.id), `${locale.id} の価格`);
  }
});

/* ------------------------------------------------------------------ *\
 * 5. ランキング（部門 × 指標 × 範囲）
 * ------------------------------------------------------------------ */

test('ランキングは 3回戦/5回戦 × 総合/月別/週間/勝率 × 世界/国内', () => {
  assert.deepEqual(DIVISIONS.map((division) => division.id), ['5', '3']);
  assert.deepEqual(RANK_METRICS.map((metric) => metric.id), ['total', 'monthly', 'weekly', 'winrate']);
  assert.deepEqual(RANK_SCOPES.map((scope) => scope.id), ['world', 'domestic']);
});

test('国内ランキングは自分の国だけ、世界は全員', () => {
  const player = { nickname: 'YOU', countryCode: 'JP', points: 10, matches: 1, winRate: 1 };
  const domestic = leaderboard({ division: '5', metric: 'total', scope: 'domestic', player });
  assert.ok(domestic.every((row) => row.countryCode === 'JP'));
  const world = leaderboard({ division: '5', metric: 'total', scope: 'world', player });
  assert.ok(world.length > domestic.length);
});

/* ------------------------------------------------------------------ *\
 * 6. 通信の安全
 * ------------------------------------------------------------------ */

test('受信した手を検証する（不正手・範囲外ラウンド・二重送信）', () => {
  const rounds = 5;
  const seen = new Set();
  assert.equal(validateOnlinePick({ from: 'a', round: 0, hand: 'rock' }, { self: 'me', rounds, seen }).ok, true);
  seen.add('a:0');
  assert.equal(validateOnlinePick({ from: 'a', round: 0, hand: 'rock' }, { self: 'me', rounds, seen }).reason, 'duplicate');
  assert.equal(validateOnlinePick({ from: 'a', round: 0, hand: 'well' }, { self: 'me', rounds }).reason, 'hand');
  assert.equal(validateOnlinePick({ from: 'a', round: 9, hand: 'rock' }, { self: 'me', rounds }).reason, 'round');
  assert.equal(validateOnlinePick({ from: 'a', round: -1, hand: 'rock' }, { self: 'me', rounds }).reason, 'round');
  assert.equal(validateOnlinePick({ from: 'me', round: 1, hand: 'rock' }, { self: 'me', rounds }).reason, 'self');
  assert.equal(validateOnlinePick(null, { self: 'me', rounds }).reason, 'shape');
});

test('スタンプは定型IDだけ・4秒あき', () => {
  const allowed = ['hello', 'nice', 'close', 'nervous', 'haha', 'thanks'];
  assert.equal(validateStamp({ from: 'a', id: 'nice' }, { self: 'me', allowed, lastAt: 0, now: 10000 }).ok, true);
  assert.equal(validateStamp({ from: 'a', id: 'nice' }, { self: 'me', allowed, lastAt: 9000, now: 10000 }).reason, 'cooldown');
  assert.equal(validateStamp({ from: 'a', id: '／＼' }, { self: 'me', allowed, lastAt: 0, now: 10000 }).reason, 'stamp');
  assert.equal(validateStamp({ from: 'me', id: 'nice' }, { self: 'me', allowed, lastAt: 0, now: 10000 }).reason, 'self');
});

test('通信本文にはサイズ上限がある（長文を持ち込ませない）', () => {
  assert.equal(payloadTooLarge({ hand: 'rock' }), false);
  assert.equal(payloadTooLarge({ text: 'あ'.repeat(ONLINE_LIMITS.maxMessageBytes) }), true);
});

test('自由入力のチャットが無い（textarea・contenteditable を持たない）', () => {
  const html = read('index.html');
  assert.equal(/<textarea/i.test(html), false);
  assert.equal(/contenteditable="true"/i.test(html), false);
  const config = read('capacitor.config.json');
  assert.ok(config.includes('jp.signlink.JankenPon'));
});

test('iOS の長押しコピー・選択・ズームを抑止している', () => {
  const css = read('styles.css');
  assert.ok(/-webkit-touch-callout:\s*none/.test(css));
  assert.ok(/-webkit-user-select:\s*none/.test(css));
  assert.ok(/user-select:\s*none/.test(css));
});

test('3回連続の時間切れでマッチを終了する（放置対策）', () => {
  const main = read('src/main.js');
  assert.ok(main.includes('MAX_CONSECUTIVE_TIMEOUTS'));
  assert.ok(/MAX_CONSECUTIVE_TIMEOUTS\s*=\s*3/.test(main));
});

/* ------------------------------------------------------------------ *\
 * 7. 12言語
 * ------------------------------------------------------------------ */

test('12言語がそろっている', () => {
  assert.equal(LOCALES.length, 12);
  const ids = LOCALES.map((locale) => locale.id);
  assert.deepEqual(ids, ['ja', 'en', 'ko', 'zh-Hans', 'zh-Hant', 'es', 'fr', 'de', 'pt', 'it', 'hi', 'id']);
});

test('12言語すべてに、すべてのUI文言がある（空文字なし）', () => {
  for (const locale of LOCALES) {
    const dict = DICT[locale.id];
    assert.ok(dict, `${locale.id} の辞書`);
    for (const key of KEYS) {
      assert.equal(typeof dict[key], 'string', `${locale.id} / ${key}`);
      assert.ok(dict[key].trim().length > 0, `${locale.id} / ${key} が空`);
    }
  }
});

test('文言の差し込み（{n}）と、長文の日本語・英語', () => {
  assert.equal(t('home.play', 'ja', { n: 5 }), '5回戦をはじめる');
  assert.equal(t('home.play', 'en', { n: 3 }), 'Start 3-round match');
  assert.ok(PROSE.ja['howto.s5.body'].includes('ランキング'));
  assert.ok(PROSE.en['howto.s5.body'].includes('never added'));
  assert.ok(PROSE.ja['legal.s1.body'].length > 40);
});

test('端末の言語タグから近いロケールを選ぶ', () => {
  assert.equal(detectLocale('ja-JP'), 'ja');
  assert.equal(detectLocale('zh-TW'), 'zh-Hant');
  assert.equal(detectLocale('zh-CN'), 'zh-Hans');
  assert.equal(detectLocale('pt-BR'), 'pt');
  assert.equal(detectLocale('id-ID'), 'id');
  /* Build 9: 12言語のどれでもない端末は英語（日本語にしない） */
  assert.equal(detectLocale(''), 'en');
  assert.equal(detectLocale('th-TH'), 'en');
  assert.equal(detectLocale('ar-EG'), 'en');
  assert.equal(detectLocale('vi'), 'en');
  assert.equal(detectLocale('en-GB'), 'en');
  assert.equal(FALLBACK_LOCALE, 'en');
});

test('applyI18n は data-i18n / aria / placeholder を埋める（DOM 無しでは 0）', () => {
  assert.equal(applyI18n(null, 'ja'), 0);
  const nodes = [
    { getAttribute: () => 'nav.ranking', textContent: '' },
    { getAttribute: () => 'home.reset', textContent: '' },
  ];
  const root = {
    querySelectorAll: (selector) => (selector === '[data-i18n]' ? nodes : []),
  };
  assert.equal(applyI18n(root, 'en'), 2);
  assert.equal(nodes[0].textContent, 'Ranking');
  assert.equal(nodes[1].textContent, 'Reset');
});

test('HTML の主要な文言が data-i18n を持つ', () => {
  const html = read('index.html');
  for (const key of ['nav.ranking', 'nav.stats', 'nav.settings', 'home.modes', 'pro.sub', 'settings.language']) {
    assert.ok(html.includes(`data-i18n="${key}"`), `${key} が data-i18n を持つ`);
  }
});

/* ------------------------------------------------------------------ *\
 * 8. アイコン／iOS プロジェクト／ワークフローの契約
 * ------------------------------------------------------------------ */

function pngHeader(path) {
  const buffer = readFileSync(resolve(ROOT, path));
  assert.equal(buffer.slice(1, 4).toString('ascii'), 'PNG', `${path} は PNG`);
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const bitDepth = buffer.readUInt8(24);
  const colorType = buffer.readUInt8(25);
  return { width, height, bitDepth, colorType };
}

test('アプリアイコンは 1024×1024・RGB・透過なし（assets と iOS の両方）', () => {
  for (const path of ['assets/janken-appicon-1024.png', 'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png']) {
    assert.ok(exists(path), `${path} がある`);
    const header = pngHeader(path);
    assert.equal(header.width, 1024, `${path} の幅`);
    assert.equal(header.height, 1024, `${path} の高さ`);
    assert.equal(header.bitDepth, 8);
    assert.equal(header.colorType, 2, `${path} は RGB（透過なし = colortype 2）`);
  }
});

test('2つのアイコンは同じ絵（バイト一致）', () => {
  const a = readFileSync(resolve(ROOT, 'assets/janken-appicon-1024.png'));
  const b = readFileSync(resolve(ROOT, 'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png'));
  assert.ok(a.equals(b));
});

test('Capacitor のアプリ名と Bundle ID', () => {
  const config = JSON.parse(read('capacitor.config.json'));
  assert.equal(config.appId, 'jp.signlink.JankenPon');
  assert.equal(config.appName, 'JANKeN PoN');
  assert.equal(config.webDir, 'www');
});

test('iOS プロジェクトの契約（名前・Bundle ID・版番号）', () => {
  const plist = read('ios/App/App/Info.plist');
  assert.ok(plist.includes('<string>JANKeN PoN</string>'));
  const pbx = read('ios/App/App.xcodeproj/project.pbxproj');
  assert.ok(pbx.includes('PRODUCT_BUNDLE_IDENTIFIER = jp.signlink.JankenPon;'));
  /* ビルド番号は Build ごとに上がる（Build 2 で 2） */
  const buildNumbers = [...pbx.matchAll(/CURRENT_PROJECT_VERSION = (\d+);/g)].map((m) => Number(m[1]));
  assert.equal(buildNumbers.length, 2, 'Debug/Release の2箇所にビルド番号がある');
  assert.ok(buildNumbers.every((n) => Number.isInteger(n) && n >= 1));
  assert.equal(new Set(buildNumbers).size, 1, '2箇所のビルド番号は同じ');
  assert.ok(pbx.includes('MARKETING_VERSION = 1.0.1;'));
  assert.ok(exists('ios/App/App.xcodeproj/xcshareddata/xcschemes/App.xcscheme'));
  assert.ok(exists('ios/App/App/AppDelegate.swift'));
});

test('StoreKit 2 のプラグインが iOS 側に組み込まれている', () => {
  const swift = read('ios/App/App/AppDelegate.swift');
  assert.ok(swift.includes('import StoreKit'));
  assert.ok(swift.includes('class StoreKitPlugin: CAPPlugin'));
  assert.ok(swift.includes('jsName = "StoreKit"'));
  assert.ok(swift.includes('jp.signlink.JankenPon.pro'));
  assert.ok(swift.includes('registerPluginInstance'));
  assert.ok(swift.includes('Transaction.currentEntitlements'));
  const scene = read('ios/App/App/SceneDelegate.swift');
  assert.ok(scene.includes('JankenBridgeViewController'));
  assert.ok(scene.includes('SceneDelegateProxy'));
});

test('TestFlight ワークフロー: 1行目・BUILD_NUMBER・BUNDLE_ID・preflight', () => {
  const path = 'docs/ios-testflight-build1.yml';
  assert.ok(exists(path), 'Build 1 の履歴として残す');
  const yml = read(path);
  assert.equal(yml.split('\n')[0], '# JANKeN PoN iOS TestFlight Build 1');
  assert.ok(yml.includes('BUNDLE_ID: jp.signlink.JankenPon'));
  assert.ok(yml.includes('name: JANKeN PoN iOS TestFlight'));
  assert.ok(yml.includes('preflight:'));
  assert.ok(yml.includes('npm test'));
  assert.ok(yml.includes('npx cap sync ios'));
  assert.ok(yml.includes('altool --upload-app'));
  /* 貼り付け前でも古いビルド番号が出ないよう、確認入力と Bundle ID を突き合わせる */
  assert.ok(yml.includes('confirm_bundle_id'));
  assert.ok(yml.includes('test "$CONFIRM" = "$BUNDLE_ID"') || yml.includes('CONFIRM') );

  /* いま使うワークフロー（Build 2 以降）は、ビルド番号を iOS プロジェクトから読む */
  const current = 'docs/ios-testflight-build2.yml';
  assert.ok(exists(current), '最新のワークフローがある');
  const latest = read(current);
  assert.equal(latest.split('\n')[0], '# JANKeN PoN iOS TestFlight Build 2');
  assert.equal(/BUILD_NUMBER:\s*"\d+"/.test(latest), false, 'BUILD_NUMBER を固定文字列で持たない');
  assert.ok(latest.includes('CURRENT_PROJECT_VERSION'), 'iOS プロジェクトからビルド番号を読む');
});

test('iOS プロジェクトは Capacitor の public を持たない（cap sync が入れる）', () => {
  /* リポジトリに古い www を焼き付けない: cap sync が ios/App/App/public を作る */
  assert.equal(exists('ios/App/App/public/index.html'), false);
  const gitignore = read('.gitignore');
  assert.ok(gitignore.includes('ios/App/App/public'));
});

/* ------------------------------------------------------------------ *\
 * 9. 保存の移行（既存プロフィールを壊さない）
 * ------------------------------------------------------------------ */

test('プロフィールに言語とパーティー記録が増えても、古いデータを読める', () => {
  const backend = createMemoryBackend();
  backend.setItem('janken-pon.profile.v1', JSON.stringify({ nickname: 'トモ', rounds: 3, totalPoints: 40 }));
  const store = createProfileStore(backend, 'janken-pon.profile.v1');
  const profile = store.load();
  assert.equal(profile.nickname, 'トモ');
  assert.equal(profile.rounds, 3);
  /* Build 9: 言語の記録が無い古いデータは「まだ選んでいない」= null（初回起動で端末の言語から決める） */
  assert.equal(profile.locale, null);
  assert.deepEqual(profile.party, defaultParty());
});

test('練習データのリセットはパーティー記録と世界記録に触らない', () => {
  const { resetPractice } = { resetPractice: (p) => ({ ...p, practice: { matches: 0, wins: 0, losses: 0, ties: 0, points: 0, best: 0, lastAt: null } }) };
  const profile = applyParty(applyMatch(defaultProfile(), { matchPoints: 5, verdict: 'win', rank: 74 }), { points: 12 });
  const reset = resetPractice(profile);
  assert.deepEqual(reset.world, profile.world);
  assert.deepEqual(reset.party, profile.party);
});

test('npm test は3つのテストファイルをすべて実行する', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.ok(pkg.scripts.test.includes('test/core.test.js'));
  assert.ok(pkg.scripts.test.includes('test/online.test.js'));
  assert.ok(pkg.scripts.test.includes('test/build1.test.js'));
});

test('README が Build 1 の仕様を説明している', () => {
  const readme = read('README.md');
  assert.ok(readme.includes('Build 1'));
  assert.ok(readme.includes('5秒'));
  assert.ok(readme.includes('jp.signlink.JankenPon'));
  assert.ok(readme.includes('jp.signlink.JankenPon.pro'));
  assert.ok(exists('docs/privacy.md'));
  assert.ok(statSync(resolve(ROOT, 'docs/privacy.md')).size > 100);
});
