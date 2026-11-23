/**
 * JANKeN PoN — Build 9 の確定仕様テスト
 *
 * Build 9 で入れたもの:
 *   1. 12言語にない端末の言語は英語（日本語にしない）
 *      - detectLocale は FALLBACK_LOCALE = 'en'
 *      - 言語の記録が無いプロフィールは null（初回起動で端末の言語から決める）
 *   2. 国をえらぶシートの🌐言語ピル（その場で言語を変えられる）
 *   3. 世界の特別ルール（ゾウ・人間・アリ / 井戸つき）を PRO の遊びとして復帰
 *      - CPU練習とパーティーだけ。通信対戦（ランキング）はクラシック固定
 *      - パーティーはホストが選び、部屋の全員が同じルールで遊ぶ
 *   4. ビルド番号 9（pbxproj 2箇所・アプリ側・設定の版表示・www/ 同期）
 *
 * 実ブラウザ（Chromium）の操作・見た目は tools/shots-b9.mjs が確かめる。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  KEYS,
  DICT,
  LOCALES,
  FALLBACK_LOCALE,
  DEFAULT_LOCALE,
  detectLocale,
} from '../src/i18n.js';
import {
  RULESETS,
  ACTIVE_RULESETS,
  UNRANKED_RULESETS,
  SPECIAL_RULESETS,
  RANKED_RULESET,
  rulesetsForMode,
  isSpecialRuleset,
  isRulesetVisible,
  isRulesetUnlocked,
  rulesetName,
  rulesetHint,
  scoreRound,
  scorePartyRound,
  chooseCpuHand,
  resolveTimeout,
  isValidHand,
} from '../src/core.js';
import { defaultProfile, createProfileStore, createMemoryBackend } from '../src/storage.js';
import { OnlineSession, safeRulesetId } from '../src/online.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(ROOT, path), 'utf8');
const exists = (path) => existsSync(resolve(ROOT, path));

const MAIN = read('src/main.js');
const HTML = read('index.html');
const CSS = read('styles.css');
const ONLINE = read('src/online.js');

/* ================================================================== *\
 * 1. 英語フォールバック
 * ================================================================== */

test('言語: 12言語にない端末は英語（空・タイ語・アラビア語・ベトナム語）', () => {
  assert.equal(FALLBACK_LOCALE, 'en');
  assert.equal(DEFAULT_LOCALE, 'ja', '辞書の既定（日本語）はそのまま');
  for (const tag of ['', 'th-TH', 'ar-EG', 'vi', 'tr-TR', 'sv-SE', 'xx-YY']) {
    assert.equal(detectLocale(tag), 'en', `${tag || '(空)'} → en`);
  }
});

test('言語: 12言語のタグは今までどおり（英語の地域も en）', () => {
  const expected = {
    'ja-JP': 'ja',
    'en-US': 'en',
    'en-GB': 'en',
    'ko-KR': 'ko',
    'zh-CN': 'zh-Hans',
    'zh-TW': 'zh-Hant',
    'zh-HK': 'zh-Hant',
    'es-419': 'es',
    'fr-CA': 'fr',
    'de-AT': 'de',
    'pt-PT': 'pt',
    'it-IT': 'it',
    'hi-IN': 'hi',
    'id-ID': 'id',
    'in-ID': 'id',
  };
  for (const [tag, locale] of Object.entries(expected)) {
    assert.equal(detectLocale(tag), locale, tag);
  }
});

test('言語: 記録が無いプロフィールは「まだ選んでいない」= null', () => {
  assert.equal(defaultProfile().locale, null);
  const store = createProfileStore(createMemoryBackend(), 'janken-pon.test');
  assert.equal(store.load().locale, null);
  /* 古いプロフィールに残っている言語は壊さない */
  const backend = createMemoryBackend();
  backend.setItem('janken-pon.test', JSON.stringify({ nickname: 'A', locale: 'ko' }));
  assert.equal(createProfileStore(backend, 'janken-pon.test').load().locale, 'ko');
});

test('言語: 起動時に端末の言語から決めて、画面の言語に反映する', () => {
  assert.ok(/app\.profile\.locale = i18n\.detectLocale\(navigator\.language\)/.test(MAIN), 'detectLocale を使う');
  assert.ok(/if \(!i18n\.isLocale\(app\.profile\.locale\)\)/.test(MAIN), 'まだ決まっていないときだけ');
  assert.ok(/app\.locale = app\.profile\.locale/.test(MAIN), '画面の言語へ写す');
});

test('言語: 新しい文言（言語ピル・特別ルール）が12言語ぶん揃っている', () => {
  const added = [
    'country.langSwitch',
    'special.label', 'special.proNote', 'special.locked', 'special.rankedNote',
    'special.partyLabel', 'special.hostOnly', 'special.resultNote',
    'party.spread', 'pro.item6',
  ];
  for (const key of added) assert.ok(KEYS.includes(key), `KEYS に ${key}`);
  for (const locale of LOCALES) {
    for (const key of added) {
      const value = DICT[locale.id][key];
      assert.equal(typeof value, 'string', `${locale.id} / ${key}`);
      assert.ok(value.trim().length > 0, `${locale.id} / ${key} が空`);
    }
  }
  for (const locale of LOCALES) {
    assert.ok(DICT[locale.id]['country.langSwitch'].length <= 24, `${locale.id}: ピルに収まる長さ`);
  }
});

/* ================================================================== *\
 * 2. 国をえらぶの言語ピル
 * ================================================================== */

test('言語ピル: 国をえらぶシートの上に 🌐（現在の言語 ▾）がある', () => {
  const sheet = HTML.slice(HTML.indexOf('id="sheet-country"'), HTML.indexOf('id="sheet-ranking"'));
  assert.ok(sheet.includes('id="btn-country-lang"'), 'ボタン');
  assert.ok(sheet.includes('🌐'), '地球のアイコン');
  assert.ok(sheet.includes('id="country-lang-label"'), 'いまの言語の名前');
  assert.ok(sheet.includes('data-i18n-aria="country.langSwitch"'), '読み上げは翻訳する');
  const header = sheet.slice(0, sheet.indexOf('id="country-lock-note"'));
  assert.ok(header.indexOf('btn-country-lang') > header.indexOf('sheet__head'), '見出しのすぐ下');
});

test('言語ピル: 押すと国シートの上に言語シートが開き、選ぶと国シートへ戻る', () => {
  assert.ok(/langPill\.addEventListener\('click'/.test(MAIN), 'ピルの操作');
  assert.ok(/openSheet\('language', \{ nested: true \}\)/.test(MAIN), '国シートを閉じずに重ねる');
  assert.ok(/function renderCountryLang\(\)/.test(MAIN), 'ピルの表示を更新する');
  assert.ok(/i18n\.localeMeta\(app\.locale\)\.label/.test(MAIN), '現在の言語名');
  assert.ok(/if \(previous === 'country'\) renderCountryGrid\(\)/.test(MAIN), '戻ったら国名も描き直す');
});

test('言語ピル: 見た目は小さな丸いピル（画面を占めない）', () => {
  assert.ok(CSS.includes('.lang-pill'), 'ピルのスタイル');
  assert.ok(/\.lang-pill \{[^}]*border-radius:\s*999px/.test(CSS), '丸い形');
  assert.ok(/\.sheet-toolbar \{[^}]*justify-content:\s*flex-end/.test(CSS), '右上に寄せる');
});

/* ================================================================== *\
 * 3. 世界の特別ルール（PRO・ランキング対象外）
 * ================================================================== */

test('特別ルール: ゾウ・人間・アリ と 井戸つきが復帰し、通信対戦はクラシック固定', () => {
  assert.deepEqual([...SPECIAL_RULESETS], ['epa', 'well']);
  assert.deepEqual([...ACTIVE_RULESETS], ['standard'], 'ランキングに入るルールはクラシックだけ');
  assert.deepEqual([...UNRANKED_RULESETS], ['standard', 'epa', 'well'], 'ランキング外の遊び');
  assert.equal(RANKED_RULESET, 'standard');
  assert.deepEqual(rulesetsForMode('practice').map((set) => set.id), ['standard', 'epa', 'well']);
  assert.deepEqual(rulesetsForMode('party').map((set) => set.id), ['standard', 'epa', 'well']);
  assert.deepEqual(rulesetsForMode('online').map((set) => set.id), ['standard'], 'ランキングは守る');
  for (const id of SPECIAL_RULESETS) {
    assert.equal(RULESETS[id].pro, true, `${id} は PRO`);
    assert.equal(isRulesetVisible(id), true, `${id} は選べる`);
    assert.equal(isRulesetUnlocked(id, false), false, `${id} は無料では使えない`);
    assert.equal(isRulesetUnlocked(id, true), true, `${id} は PRO で使える`);
  }
  assert.equal(isRulesetUnlocked('standard', false), true, 'クラシックは無料');
});

test('特別ルール: 日本語と英語の名前・説明が揃っている（ほかの言語は英語）', () => {
  assert.equal(rulesetName('epa', 'ja'), 'ゾウ・人間・アリ');
  assert.equal(rulesetName('epa', 'en'), 'ELEPHANT / HUMAN / ANT');
  assert.equal(rulesetName('well', 'ko'), 'WELL', '日本語以外は英語');
  assert.ok(rulesetHint('epa', 'ja').includes('アリ'));
  assert.ok(rulesetHint('epa', 'en').toLowerCase().includes('ant'));
  assert.ok(rulesetHint('well', 'de').toLowerCase().includes('well'));
  assert.equal(RULESETS.epa.countryCode, 'ID', '本場はインドネシア');
  assert.equal(RULESETS.well.countryCode, 'FR', '本場はフランス');
});

test('特別ルール: ゾウ・人間・アリの勝敗とポイント（アリが5pt）', () => {
  assert.equal(scoreRound('ant', 'elephant', 'epa').points, 5);
  assert.equal(scoreRound('elephant', 'human', 'epa').points, 3);
  assert.equal(scoreRound('human', 'ant', 'epa').points, 2);
  assert.equal(scoreRound('ant', 'ant', 'epa').points, 0, 'あいこは0');
  assert.equal(isValidHand('rock', 'epa'), false, 'グーは使わない');
});

test('特別ルール: 井戸つきは4手（井戸4pt・パーだけが井戸をふさぐ）', () => {
  assert.equal(scoreRound('well', 'rock', 'well').points, 4);
  assert.equal(scoreRound('paper', 'well', 'well').points, 5);
  assert.equal(scoreRound('rock', 'well', 'well').points, 0);
  assert.equal(isValidHand('well', 'well'), true);
  assert.equal(isValidHand('well', 'epa'), false, 'ルールをまたがない');
});

test('特別ルール: CPU もそのルールの手だけを出す（タイムアウトも同じ）', () => {
  for (const id of ['epa', 'well']) {
    const hands = RULESETS[id].hands;
    for (let seed = 1; seed <= 30; seed += 1) {
      let state = seed;
      const rng = () => {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        state >>>= 0;
        return state / 4294967296;
      };
      const hand = chooseCpuHand({ levelId: 'hard', history: [], rulesetId: id, rng });
      assert.ok(hands.includes(hand), `${id}: ${hand}`);
      assert.ok(hands.includes(resolveTimeout(id, rng).hand), `${id}: timeout`);
    }
  }
});

test('特別ルール: パーティーの採点も部屋のルールで行う', () => {
  const epa = scorePartyRound({ a: 'ant', b: 'elephant', c: 'human' }, 'epa');
  assert.equal(epa.threeWay, true, '3すくみは0pt');
  assert.deepEqual(epa.points, { a: 0, b: 0, c: 0 });
  const win = scorePartyRound({ a: 'ant', b: 'elephant' }, 'epa');
  assert.deepEqual(win.winners, ['a']);
  assert.equal(win.points.a, 5);
  const well = scorePartyRound({ a: 'paper', b: 'well', c: 'rock' }, 'well');
  assert.deepEqual(well.winners, ['a'], 'パーが井戸をふさぐ');
  assert.equal(well.points.a, 5);
});

test('特別ルール: CPU練習は選んだルールで始まり、無料ならクラシックに戻す', () => {
  assert.ok(/function practiceRulesetId\(\)/.test(MAIN), '練習のルールを決める関数');
  assert.ok(/const matchSet = set\.pro && !isPro\(\)/.test(MAIN), '無料ならクラシック');
  assert.ok(/const set = getRuleset\(rulesetId \?\? practiceRulesetId\(\)\)/.test(MAIN), '引数でも渡せる');
  assert.ok(/rulesetId: matchSet\.id,/.test(MAIN), 'マッチに渡す');
  assert.ok(/rulesetId: matchSet\.id/.test(MAIN) && /pickOpponent\(\{[^}]*rulesetId: matchSet\.id/s.test(MAIN), '相手は本場の国が出やすい');
  assert.ok(/if \(isSpecialRuleset\(next\.rulesetId\)\) next = \{ \.\.\.next, rulesetId: RANKED_RULESET \}/.test(MAIN), 'PRO を切ったら戻す');
});

test('特別ルール: 通信対戦（ランキング）はクラシック固定のまま', () => {
  const onlineMatch = MAIN.slice(MAIN.indexOf('function startOnlineMatch'), MAIN.indexOf('function beginRound'));
  assert.ok(onlineMatch.includes('rulesetId: RANKED_RULESET'), '通信対戦はクラシック');
  assert.equal(onlineMatch.includes('practiceRulesetId'), false, '練習の設定を持ち込まない');
  /* 1対1の手の検証・確定は、いまのマッチのルールで行う */
  assert.ok(/getRuleset\(app\.match\?\.rulesetId \?\? RANKED_RULESET\)\.hands/.test(MAIN));
  assert.ok(/rulesetId: app\.match\?\.rulesetId \?\? RANKED_RULESET/.test(MAIN));
});

test('特別ルール: ホームは小さなチップ（大きなグリッドを作らない）', () => {
  assert.ok(HTML.includes('id="rule-chips"'), 'CPU練習のチップ');
  assert.ok(HTML.includes('id="rule-hint"'), '一言説明（特別ルールのときだけ）');
  assert.ok(HTML.includes('id="block-note"'), 'ポイント表記はルールに合わせる');
  assert.equal(HTML.includes('id="mode-grid"'), false, '大きなグリッドは作らない');
  assert.ok(/function renderRules\(\)/.test(MAIN));
  assert.ok(/rule-chip\$\{active \? ' is-active' : ''\}/.test(MAIN), '選択中の見た目');
  assert.ok(/locked \? '<em>PRO<\/em>'/.test(MAIN), 'PRO の印');
  assert.ok(CSS.includes('.rule-chip'), 'チップのスタイル');
  assert.ok(/\.rule-chips \{[^}]*overflow-x:\s*auto/.test(CSS), '横に流れる（折り返して縦に伸びない）');
});

test('特別ルール: 結果画面に「ランキングに加算されない」と出る', () => {
  assert.ok(/isSpecialRuleset\(app\.match\?\.rulesetId\)/.test(MAIN));
  assert.ok(/specialMatch \? T\('special\.resultNote'\)/.test(MAIN));
});

test('特別ルール: PRO の一覧にも並ぶ', () => {
  const proList = HTML.slice(HTML.indexOf('class="pro-list"'), HTML.indexOf('</ul>', HTML.indexOf('class="pro-list"')));
  assert.ok(proList.includes('data-i18n="pro.item6"'), 'PRO の一覧に特別ルール');
  assert.ok(proList.includes('1f418.svg'), 'ゾウのアイコン');
});

/* ================================================================== *\
 * 3b. パーティーの部屋のルール（通信）
 * ================================================================== */

function fakeSession(profile = { nickname: 'A', countryCode: 'JP', pro: true }) {
  const sent = [];
  const client = {
    clientId: 'host',
    subscribe() {},
    unsubscribe() {},
    track() {},
    untrack() {},
    broadcast(channel, event, payload) {
      sent.push({ channel, event, payload });
      return true;
    },
  };
  const session = new OnlineSession({ client });
  const events = [];
  session.onEvent = (event) => events.push(event);
  session.openParty({ code: 'RULE1', profile, rulesetId: 'epa' });
  return { session, events, sent };
}

test('パーティー: ホストが選んだルールで部屋を立てる（PRO のみ）', () => {
  assert.equal(safeRulesetId('epa'), 'epa');
  assert.equal(safeRulesetId('nope'), 'standard', '知らないIDはクラシック');
  assert.equal(safeRulesetId(undefined), 'standard');
  const pro = fakeSession({ nickname: 'A', countryCode: 'JP', pro: true });
  assert.equal(pro.session.rulesetId, 'epa');
  const free = fakeSession({ nickname: 'B', countryCode: 'JP', pro: false });
  assert.equal(free.session.rulesetId, 'standard', '無料はクラシックへ');
});

test('パーティー: 開始の電文にルールを載せ、参加者はホストのルールを採用する', () => {
  const { session, events, sent } = fakeSession();
  session.host = true;
  session.players = [{ key: 'host', nickname: 'A', countryCode: 'JP' }, { key: 'bbb', nickname: 'B', countryCode: 'JP' }];
  session.startParty();
  const start = sent.find((message) => message.event === 'party-start');
  assert.ok(start, 'party-start を送る');
  assert.equal(start.payload.rulesetId, 'epa');
  assert.equal(events.find((event) => event.type === 'party-started')?.rulesetId, 'epa');

  /* 参加者側: ホストのルールを受け取る */
  const guestSent = [];
  const guest = new OnlineSession({
    client: { clientId: 'bbb', subscribe() {}, unsubscribe() {}, track() {}, untrack() {}, broadcast(c, e, p) { guestSent.push({ c, e, p }); return true; } },
  });
  const guestEvents = [];
  guest.onEvent = (event) => guestEvents.push(event);
  guest.openParty({ code: 'RULE1', mode: 'join', profile: { nickname: 'B', countryCode: 'JP' }, rulesetId: 'standard' });
  guest.players = [{ key: 'host', nickname: 'A' }, { key: 'bbb', nickname: 'B' }];
  guest.handlePartyBroadcast('party-start', { from: 'host', rounds: 5, rulesetId: 'well' });
  assert.equal(guest.rulesetId, 'well');
  assert.equal(guestEvents.find((event) => event.type === 'party-started')?.rulesetId, 'well');
});

test('パーティー: 部屋のルールに無い手は送らない・採点しない', () => {
  const { session } = fakeSession();
  session.players = [{ key: 'host', nickname: 'A' }, { key: 'bbb', nickname: 'B' }];
  session.partyPoints = new Map([['host', 0], ['bbb', 0]]);
  assert.equal(session.partyPick(0, 'rock'), false, 'EPA にグーは無い');
  assert.equal(session.partyPick(0, 'ant'), true, 'アリは送れる');
  const round = session.applyPartyRound(0, { host: 'ant', bbb: 'elephant' });
  assert.equal(round.points.host, 5, 'アリがゾウに勝つ');
  assert.equal(round.points.bbb, 0);
});

test('前後のルールが入ってきたら捨てる（古いアプリ・いたずら対策）', () => {
  const { session } = fakeSession();
  session.players = [{ key: 'host', nickname: 'A' }];
  session.handlePartyBroadcast('party-start', { from: 'other', rounds: 5, rulesetId: 'var(--evil)' });
  assert.equal(session.rulesetId, 'epa', '知らないルールでは、いまのルールのまま');
  session.handlePartyBroadcast('party-start', { from: 'other', rounds: 5, rulesetId: 'well' });
  assert.equal(session.rulesetId, 'well', '知っているルールは採用する');
});

test('パーティー: ルールの選択はホストだけ（ホームの画面側）', () => {
  assert.ok(/if \(!app\.party\.isHost\) \{\n\s*toast\(T\('special\.hostOnly'\)\)/.test(MAIN), 'ホスト以外は変えられない');
  assert.ok(/app\.online\.session\.rulesetId = rulesetId/.test(MAIN), '開始の電文に載せる');
  assert.ok(/rulesetId: app\.party\.rulesetId \|\| RANKED_RULESET/.test(MAIN), '部屋のルールで検証');
  assert.ok(HTML.includes('id="party-rule-seg"'), 'パーティーのシートにチップ');
  assert.ok(HTML.includes('data-i18n="special.partyLabel"'), 'ホストが選ぶと書く');
  assert.ok(ONLINE.includes("rulesetId: this.rulesetId"), 'party-start に載せる');
});

/* ================================================================== *\
 * 4. ビルド番号
 * ================================================================== */

test('ビルド: iOS プロジェクトもアプリも Build 9', () => {
  const pbx = read('ios/App/App.xcodeproj/project.pbxproj');
  const numbers = [...pbx.matchAll(/CURRENT_PROJECT_VERSION = (\d+);/g)].map((m) => Number(m[1]));
  assert.equal(numbers.length, 2, 'Debug / Release の2箇所');
  assert.deepEqual(numbers, [9, 9], '2箇所とも 9');
  assert.ok(pbx.includes('MARKETING_VERSION = 1.0.0;'), '表示バージョンは 1.0.0 のまま');
  assert.ok(/version: '1\.0\.0',\s*build: 9,/.test(MAIN), 'アプリ側の build も 9');
  assert.ok(HTML.includes('(Build 9)'), '設定の版表示も Build 9');
});

test('www: 配布用の写しにも Build 9・言語ピル・特別ルールが入る', async () => {
  const { makeWww } = await import('../tools/make-www.mjs');
  await makeWww();
  assert.ok(read('www/index.html').includes('(Build 9)'));
  assert.ok(/version: '1\.0\.0',\s*build: 9,/.test(read('www/src/main.js')));
  assert.ok(read('www/index.html').includes('id="btn-country-lang"'), '言語ピル');
  assert.ok(read('www/index.html').includes('id="rule-chips"'), 'ルールのチップ');
  assert.ok(read('www/src/core.js').includes('special: true'), '特別ルール');
  assert.ok(read('www/styles.css').includes('.lang-pill'), 'ピルの CSS');
});

test('テスト: package.json の npm test が build9 を最後に走らせる', () => {
  const pkg = JSON.parse(read('package.json'));
  const script = pkg.scripts.test;
  assert.ok(script.includes('--test-concurrency=1'), 'www/ を共有するので直列');
  const order = script.match(/test\/[a-z0-9]+\.test\.js/g);
  assert.deepEqual(order, [
    'test/core.test.js', 'test/online.test.js', 'test/build1.test.js',
    'test/build2.test.js', 'test/build3.test.js', 'test/build4.test.js',
    'test/build5.test.js', 'test/build6.test.js', 'test/build7.test.js',
    'test/build8.test.js', 'test/build9.test.js',
  ]);
  assert.ok(readdirSync(resolve(ROOT, 'test')).includes('build9.test.js'));
  assert.ok(pkg.description.includes('Build 9'), 'package.json の説明も Build 9');
});

test('確認スクリプト: 実ブラウザで言語ピルと特別ルールを見る tools/shots-b9.mjs がある', () => {
  assert.ok(exists('tools/shots-b9.mjs'));
  const shots = read('tools/shots-b9.mjs');
  assert.ok(shots.includes('btn-country-lang'), '言語ピルを押す');
  assert.ok(shots.includes('rule-chips'), 'ルールのチップを押す');
  assert.ok(shots.includes('th-TH'), '12言語にない端末で英語になる');
  assert.ok(shots.includes('janken-b9-country-lang.png'), 'スクショ1');
  assert.ok(shots.includes('janken-b9-special-mode.png'), 'スクショ2');
});

test('README が Build 9 の内容を説明している', () => {
  const readme = read('README.md');
  assert.ok(readme.includes('Build 9'), 'Build 9 の節');
  assert.ok(readme.includes('英語'), '言語のフォールバック');
  assert.ok(readme.includes('ゾウ・人間・アリ'), '特別ルール');
  assert.ok(readme.includes('井戸つき'), '特別ルール');
  assert.ok(readme.includes('ランキング対象外'), 'ランキングに入れない');
});
