/**
 * JANKeN PoN — ルール / 進行 / ランキング / データ整合性のテスト
 * 実行: npm test  (node --test test/)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ROUNDS_PER_MATCH,
  ROUND_OPTIONS,
  DEFAULT_ROUNDS,
  RULESETS,
  LEVELS,
  HAND_META,
  getRuleset,
  handsOf,
  beatsOf,
  counterTo,
  pointsFor,
  judge,
  scoreRound,
  createMatch,
  playRound,
  matchSummary,
  chooseCpuHand,
  resolveTimeout,
  rankFor,
  rankDelta,
  isLevelUnlocked,
  isRulesetUnlocked,
  formatPoints,
  handRates,
  formatRate,
  emptyHandCounts,
  HAND_SERIES,
  TIMEOUT_POLICY,
  divisionForRounds,
  divisionLabel,
  maxPointsFor,
  isValidRounds,
} from '../src/core.js';

import {
  COUNTRIES,
  COUNTRY_COUNT,
  countryByCode,
  chantText,
  hasCountry,
  modesForCountry,
  countryForRuleset,
  pickOpponent,
} from '../src/countries.js';

import {
  RIVALS,
  DIVISIONS,
  divisionMeta,
  rivalsFor,
  leaderboard,
  formatMetric,
  metricValue,
  RANK_METRICS,
  RANK_SCOPES,
  leaderboardWindow,
  pointsToNext,
  playerRank,
  rankInDivision,
  totalInDivision,
  totalPlayers,
  playerToRow,
  rowToPlayer,
} from '../src/ranking.js';

import {
  createProfileStore,
  createMemoryBackend,
  defaultProfile,
  defaultPractice,
  defaultDivision,
  sanitizeProfile,
  applyMatch,
  applyPro,
  resetPractice,
  worldOf,
  practiceWinRate,
  STORAGE_KEY,
} from '../src/storage.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const assetExists = (path) => existsSync(resolve(ROOT, path));

/** 手っ取り早く履歴を作る */
const round = (playerHand, cpuHand, outcome, extra = {}) => ({
  index: 1,
  playerHand,
  cpuHand,
  outcome,
  points: 0,
  basePoints: 0,
  cpuPoints: 0,
  timedOut: false,
  ...extra,
});

/* ================================================================
 * 1. ポイント仕様（グー3 / チョキ2 / パー5 / あいこ0）
 * ================================================================ */

test('ポイント: グー3pt / チョキ2pt / パー5pt', () => {
  assert.equal(pointsFor('rock', 'standard'), 3);
  assert.equal(pointsFor('scissors', 'standard'), 2);
  assert.equal(pointsFor('paper', 'standard'), 5);
});

test('勝ったときだけ出した手のポイントが入る', () => {
  assert.deepEqual(scoreRound('rock', 'scissors'), { outcome: 'win', basePoints: 3, points: 3 });
  assert.deepEqual(scoreRound('scissors', 'paper'), { outcome: 'win', basePoints: 2, points: 2 });
  assert.deepEqual(scoreRound('paper', 'rock'), { outcome: 'win', basePoints: 5, points: 5 });
});

test('あいこは 0pt、負けも 0pt（相手にポイント）', () => {
  for (const hand of ['rock', 'scissors', 'paper']) {
    assert.deepEqual(scoreRound(hand, hand), { outcome: 'tie', basePoints: pointsFor(hand), points: 0 });
  }
  assert.equal(scoreRound('rock', 'paper').outcome, 'lose');
  assert.equal(scoreRound('rock', 'paper').points, 0);
  assert.equal(scoreRound('scissors', 'rock').points, 0);
  assert.equal(scoreRound('paper', 'scissors').points, 0);
});

test('勝敗表 3x3 がすべて正しい', () => {
  const table = {
    rock: { rock: 'tie', scissors: 'win', paper: 'lose' },
    scissors: { rock: 'lose', scissors: 'tie', paper: 'win' },
    paper: { rock: 'win', scissors: 'lose', paper: 'tie' },
  };
  for (const [mine, row] of Object.entries(table)) {
    for (const [theirs, expected] of Object.entries(row)) {
      assert.equal(judge(mine, theirs), expected, `${mine} vs ${theirs}`);
    }
  }
});

test('ルールセット外の手は弾く', () => {
  assert.throws(() => judge('rock', 'well'), RangeError);
  assert.throws(() => getRuleset('unknown'), RangeError);
  assert.throws(() => pointsFor('nope'), /./);
});

/* ================================================================
 * 2. 5回戦の進行
 * ================================================================ */

test('1マッチは5回戦', () => {
  assert.equal(ROUNDS_PER_MATCH, 5);
  assert.equal(createMatch().rounds, 5);
});

test('5回戦を消化すると finished になり、6回目は弾く', () => {
  let match = createMatch({ rounds: 5 });
  const sequence = [
    ['paper', 'rock'],
    ['rock', 'scissors'],
    ['scissors', 'paper'],
    ['rock', 'rock'],
    ['rock', 'paper'],
  ];
  sequence.forEach(([mine, theirs], i) => {
    match = playRound(match, { playerHand: mine, cpuHand: theirs });
    assert.equal(match.roundIndex, i + 1);
  });
  assert.equal(match.finished, true);
  assert.equal(match.history.length, 5);
  assert.equal(match.playerPoints, 5 + 3 + 2 + 0 + 0);
  assert.throws(() => playRound(match, { playerHand: 'rock', cpuHand: 'rock' }), RangeError);
});

test('playRound は元の状態を変更しない', () => {
  const before = createMatch();
  const after = playRound(before, { playerHand: 'paper', cpuHand: 'rock' });
  assert.equal(before.history.length, 0);
  assert.equal(before.playerPoints, 0);
  assert.equal(after.history.length, 1);
  assert.equal(after.playerPoints, 5);
  assert.notEqual(before, after);
});

test('あいこは 0pt のまま次のラウンドへ進む', () => {
  let match = createMatch({ rounds: 5 });
  match = playRound(match, { playerHand: 'scissors', cpuHand: 'scissors' });
  assert.equal(match.playerPoints, 0);
  assert.equal(match.roundIndex, 1);
  assert.equal(match.history[0].outcome, 'tie');
  assert.equal(match.finished, false);
});

test('タイムアウトしたラウンドに印が付く（負け扱いにはしない）', () => {
  const match = playRound(createMatch(), { playerHand: 'paper', cpuHand: 'rock', timedOut: true });
  assert.equal(match.history[0].timedOut, true);
  assert.equal(match.history[0].points, 5);
});

test('サマリー: 合計・勝敗数・最高ラウンド・判定', () => {
  let match = createMatch({ rounds: 5 });
  match = playRound(match, { playerHand: 'paper', cpuHand: 'rock' }); // +5
  match = playRound(match, { playerHand: 'rock', cpuHand: 'paper' }); // lose / cpu +5
  match = playRound(match, { playerHand: 'rock', cpuHand: 'rock' }); // tie
  match = playRound(match, { playerHand: 'scissors', cpuHand: 'paper' }); // +2
  match = playRound(match, { playerHand: 'rock', cpuHand: 'scissors' }); // +3
  const summary = matchSummary(match);
  assert.equal(summary.rounds, 5);
  assert.equal(summary.playerPoints, 10);
  assert.equal(summary.cpuPoints, 5);
  assert.equal(summary.roundsWon, 3);
  assert.equal(summary.ties, 1);
  assert.equal(summary.losses, 1);
  assert.equal(summary.verdict, 'win');
  assert.equal(summary.bestRound.points, 5);
  assert.equal(summary.finished, true);
});

/* ================================================================
 * 3. タイムアウトの安全フォールバック
 * ================================================================ */

test('時間切れはランダムな手（ルール内）で続行する', () => {
  const result = resolveTimeout('standard', () => 0.5);
  assert.ok(['rock', 'scissors', 'paper'].includes(result.hand));
  assert.equal(result.timedOut, true);
  assert.equal(result.policy, TIMEOUT_POLICY);
  assert.equal(TIMEOUT_POLICY, 'random');
});

test('時間切れでも特殊ルールの手から選ばれる', () => {
  const result = resolveTimeout('epa', () => 0.99);
  assert.ok(getRuleset('epa').hands.includes(result.hand));
});

/* ================================================================
 * 4. CPU（心理読み）
 * ================================================================ */

test('CPU はどのレベルでもルール内の手だけを出す', () => {
  for (const levelId of Object.keys(LEVELS)) {
    for (const rulesetId of Object.keys(RULESETS)) {
      for (const value of [0, 0.2, 0.5, 0.75, 0.999]) {
        const hand = chooseCpuHand({
          levelId,
          rulesetId,
          history: [round('rock', 'paper', 'lose'), round('paper', 'paper', 'tie')],
          rng: () => value,
        });
        assert.ok(getRuleset(rulesetId).hands.includes(hand), `${levelId}/${rulesetId}/${value}`);
      }
    }
  }
});

test('EASY は履歴に関係なく出す（読みはしない）', () => {
  const history = Array.from({ length: 4 }, () => round('rock', 'scissors', 'win'));
  const hand = chooseCpuHand({ levelId: 'easy', history, rng: () => 0.99 });
  assert.equal(hand, 'paper'); // ランダムの最後の手
});

test('HARD はプレイヤーの最頻手に勝つ手を選ぶ', () => {
  const history = [
    round('rock', 'paper', 'lose'),
    round('rock', 'scissors', 'win'),
    round('scissors', 'rock', 'lose'),
  ];
  const hand = chooseCpuHand({ levelId: 'hard', history, rng: () => 0.99 });
  assert.equal(hand, 'paper'); // rock が多い → rock に勝つ paper
});

test('MASTER は負けたあとに切り返してくる手を読む', () => {
  // プレイヤーは直前、CPU のチョキに負けた → グーに変えてくると予測 → パー
  const history = [round('paper', 'scissors', 'lose')];
  const hand = chooseCpuHand({ levelId: 'master', history, rng: () => 0.99 });
  assert.equal(hand, 'paper');
});

test('CPU は読み切らずにゆらぐ（同じ履歴でも外すことがある）', () => {
  const history = [round('rock', 'paper', 'lose'), round('rock', 'scissors', 'win')];
  const read = chooseCpuHand({ levelId: 'hard', history, rng: () => 0.99 });
  const off = chooseCpuHand({ levelId: 'hard', history, rng: () => 0.05 });
  assert.equal(read, 'paper');
  assert.ok(['rock', 'scissors', 'paper'].includes(off));
});

test('レベルごとのシンキングタイム（Build 1: 初級10秒〜最強2秒）', () => {
  assert.equal(LEVELS.easy.thinkingTimeMs, 10000);
  assert.equal(LEVELS.normal.thinkingTimeMs, 7000);
  assert.equal(LEVELS.hard.thinkingTimeMs, 4000);
  assert.equal(LEVELS.master.thinkingTimeMs, 2000);
});

test('初級・中級・上級は無料、最強（MASTER）だけ PRO', () => {
  assert.equal(isLevelUnlocked('easy', false), true);
  assert.equal(isLevelUnlocked('normal', false), true);
  assert.equal(isLevelUnlocked('hard', false), true);
  assert.equal(isLevelUnlocked('hard', true), true);
  assert.equal(isLevelUnlocked('master', false), false);
  assert.equal(isLevelUnlocked('master', true), true);
});

/* ================================================================
 * 5. 世界の特殊ルール
 * ================================================================ */

test('ゾウ・人間・アリ: 3すくみとポイント', () => {
  const set = getRuleset('epa');
  assert.deepEqual(set.hands, ['elephant', 'human', 'ant']);
  assert.equal(judge('elephant', 'human', 'epa'), 'win');
  assert.equal(judge('human', 'ant', 'epa'), 'win');
  assert.equal(judge('ant', 'elephant', 'epa'), 'win');
  assert.equal(judge('elephant', 'elephant', 'epa'), 'tie');
  assert.equal(scoreRound('ant', 'elephant', 'epa').points, 5);
  assert.equal(scoreRound('elephant', 'human', 'epa').points, 3);
  assert.equal(isRulesetUnlocked('epa', false), false);
});

test('井戸つき: パーが井戸をふさぎ、井戸はグーとチョキを飲む', () => {
  const set = getRuleset('well');
  assert.deepEqual(set.hands, ['rock', 'scissors', 'paper', 'well']);
  assert.equal(judge('paper', 'well', 'well'), 'win');
  assert.equal(judge('well', 'rock', 'well'), 'win');
  assert.equal(judge('well', 'scissors', 'well'), 'win');
  assert.equal(judge('rock', 'well', 'well'), 'lose');
  assert.equal(judge('scissors', 'well', 'well'), 'lose');
  assert.equal(judge('scissors', 'rock', 'well'), 'lose');
  assert.equal(pointsFor('well', 'well'), 4);
  assert.equal(isRulesetUnlocked('well', false), false);
});

test('全ルールセットの勝敗表が破綻していない（勝ち/負けが対称）', () => {
  for (const set of Object.values(RULESETS)) {
    for (const a of set.hands) {
      for (const b of set.hands) {
        const ab = judge(a, b, set.id);
        const ba = judge(b, a, set.id);
        if (a === b) {
          assert.equal(ab, 'tie');
        } else {
          assert.equal(ab === 'win', ba === 'lose', `${set.id}: ${a} vs ${b}`);
        }
      }
    }
  }
});

/* ================================================================
 * 6. 世界データ（国・掛け声）
 * ================================================================ */

test('国は12か国以上、コードは重複なし', () => {
  assert.ok(COUNTRY_COUNT >= 12, `countries: ${COUNTRY_COUNT}`);
  const codes = COUNTRIES.map((country) => country.code);
  assert.equal(new Set(codes).size, codes.length);
  for (const country of COUNTRIES) {
    assert.match(country.code, /^[A-Z]{2}$/);
  }
});

test('どの国にも旗・掛け声・読み・色がある', () => {
  for (const country of COUNTRIES) {
    assert.ok(country.nameJa.length > 0, country.code);
    assert.ok(country.nameEn.length > 0, country.code);
    assert.ok(country.flag.startsWith('assets/flags/'), country.code);
    assert.ok(assetExists(country.flag), `missing flag for ${country.code}: ${country.flag}`);
    assert.ok(country.chantParts.length > 0, country.code);
    assert.ok(country.chantParts.every((part) => part.trim().length > 0), country.code);
    assert.equal(chantText(country), country.chantParts.join(''));
    assert.match(country.tint, /^#[0-9a-f]{6}$/i, country.code);
  }
});

test('指定された掛け声が入っている（日本・ブラジル・ペルー・タイ・韓国・ドイツ・インドネシア）', () => {
  const expect = {
    JP: 'じゃんけんぽん！',
    BR: 'Jo-ken-pô!',
    PE: 'Yan-Ken-Po!',
    FR: 'PierreFeuilleCiseaux!',
    KR: '가위바위보!',
    TH: 'เป่ายิ้งฉุบ!',
    DE: 'Schnick-Schnack-Schnuck!',
  };
  for (const [code, chant] of Object.entries(expect)) {
    assert.equal(chantText(countryByCode(code)).replace(/[\s・-]/g, ''), chant.replace(/[\s・-]/g, ''), code);
  }
  assert.equal(countryByCode('ID').chantParts.length, 1); // Suit!
});

test('国コードの解決とフォールバック', () => {
  assert.equal(countryByCode('JP').nameJa, '日本');
  assert.equal(countryByCode('ZZ').code, 'JP');
  assert.equal(countryByCode('ZZ', 'BR').code, 'BR');
  assert.equal(hasCountry('kr'), false); // 小文字はそのままでは不可
  assert.equal(hasCountry('KR'), true);
});

test('特殊ルールの本場の国と、その国で遊べるルール', () => {
  assert.equal(countryForRuleset('epa').code, 'ID');
  assert.equal(countryForRuleset('well').code, 'FR');
  assert.equal(countryForRuleset('standard'), null);
  assert.deepEqual(modesForCountry(countryByCode('ID')), ['standard', 'epa']);
  assert.deepEqual(modesForCountry(countryByCode('JP')), ['standard']);
});

test('対戦相手は除外指定を守り、特殊ルールでは本場が出やすい', () => {
  for (const value of [0, 0.1, 0.5, 0.99]) {
    const opponent = pickOpponent({ exclude: 'JP', rng: () => value });
    assert.notEqual(opponent.code, 'JP');
  }
  const epa = pickOpponent({ rulesetId: 'epa', rng: () => 0.1 });
  assert.equal(epa.code, 'ID');
  const well = pickOpponent({ rulesetId: 'well', rng: () => 0.1 });
  assert.equal(well.code, 'FR');
});

test('手の画像アセットがすべて存在する', () => {
  for (const hand of Object.keys(HAND_META)) {
    assert.ok(assetExists(HAND_META[hand].asset), `missing hand asset: ${HAND_META[hand].asset}`);
  }
});

/* ================================================================
 * 7. 世界ランキング
 * ================================================================ */

test('ランキングは累計ポイント順で、自分が1行だけ入る', () => {
  const rows = leaderboard({ player: { nickname: 'テスト', countryCode: 'JP', points: 500 } });
  assert.equal(rows.length, RIVALS.length + 1);
  assert.equal(rows.filter((row) => row.isYou).length, 1);
  for (let i = 1; i < rows.length; i += 1) {
    assert.ok(rows[i - 1].points >= rows[i].points, '降順で並ぶ');
  }
  const me = rows.find((row) => row.isYou);
  assert.equal(me.nickname, 'テスト');
  assert.equal(me.points, 500);
  assert.ok(me.rank >= 1);
});

test('同点は同順位（競技順位）', () => {
  assert.equal(rankFor(100, [{ points: 300 }, { points: 100 }]), 2);
  assert.equal(rankFor(100, [{ points: 300 }, { points: 101 }]), 3);
  assert.equal(rankFor(100, [{ points: 100 }, { points: 100 }]), 1);
  assert.equal(rankFor(0, []), 1);
});

test('ポイントが増えると順位が上がる', () => {
  const before = playerRank(0);
  const after = playerRank(120);
  assert.ok(after < before, `${after} < ${before}`);
  assert.equal(rankDelta(before, after), before - after);
  assert.ok(rankDelta(before, after) > 0);
});

test('初期状態は最下位、合計人数はライバル+1', () => {
  assert.equal(playerRank(0), RIVALS.length + 1);
  assert.equal(totalPlayers(), RIVALS.length + 1);
});

test('自分の前後だけを切り出す', () => {
  const rows = leaderboard({ player: { nickname: 'ME', countryCode: 'JP', points: 1000 } });
  const window = leaderboardWindow(rows, { radius: 2 });
  assert.equal(window.length, 5);
  assert.ok(window.some((row) => row.isYou));
  assert.ok(leaderboardWindow(rows).some((row) => row.isYou));
});

test('次の順位までのポイントが分かる', () => {
  const rows = [
    { id: 'a', points: 300 },
    { id: 'b', points: 120 },
    { id: 'you', points: 100, isYou: true },
  ];
  assert.equal(pointsToNext(rows), 21);
});

test('Supabase 行との相互変換（games-realtime 接続口）', () => {
  const row = playerToRow({ nickname: 'トモアキ', countryCode: 'JP', points: 42.4, pro: true }, 0);
  assert.deepEqual(row, {
    nickname: 'トモアキ',
    country_code: 'JP',
    total_points: 42,
    is_pro: true,
    updated_at: '1970-01-01T00:00:00.000Z',
  });
  assert.deepEqual(rowToPlayer({ id: 'x', nickname: 'A', country_code: 'BR', total_points: '10' }), {
    id: 'x',
    nickname: 'A',
    countryCode: 'BR',
    points: 10,
    pro: false,
  });
});

test('ポイント表示は3桁区切り', () => {
  assert.equal(formatPoints(12480), (12480).toLocaleString('ja-JP'));
  assert.equal(formatPoints(-5), '0');
});

/* ================================================================
 * 8. 保存（プロフィール）
 * ================================================================ */

test('保存して読み戻せる', () => {
  const backend = createMemoryBackend();
  const store = createProfileStore(backend);
  const saved = store.save({ ...defaultProfile(), nickname: 'トモアキ', countryCode: 'JP', rounds: 3 });
  assert.equal(saved.rounds, 3);
  const loaded = store.load();
  assert.equal(loaded.nickname, 'トモアキ');
  assert.equal(loaded.rounds, 3);
  assert.deepEqual(loaded.world, defaultProfile().world);
  assert.ok(backend.getItem(STORAGE_KEY));
});

test('壊れたデータでも既定値に落として起動できる', () => {
  const backend = createMemoryBackend();
  const store = createProfileStore(backend);
  backend.setItem(STORAGE_KEY, '{not json');
  assert.deepEqual(store.load(), defaultProfile());

  backend.setItem(STORAGE_KEY, JSON.stringify({ nickname: 123, totalPoints: 'x', countryCode: 'JPN' }));
  const loaded = store.load();
  assert.equal(loaded.nickname, '');
  assert.equal(worldOf(loaded, '5').points, 0);
  assert.equal(loaded.countryCode, 'JP');
});

test('プロフィールは数値を丸め、名前は16文字まで', () => {
  const clean = sanitizeProfile({
    nickname: '  あいうえおかきくけこさしすせそたちつてと  ',
    totalPoints: -12,
    matches: 3.6,
    bestRank: 0,
    sound: undefined,
  });
  assert.equal(clean.nickname.length, 16);
  assert.equal(worldOf(clean, '5').points, 0);
  assert.equal(clean.practice.matches, 4, '旧 matches は練習データへ移行');
  assert.equal(worldOf(clean, '5').bestRank, null);
  assert.equal(clean.sound, true);
});

test('マッチ結果は「練習データ」と「世界記録」に分かれて貯まる', () => {
  const profile = {
    ...defaultProfile(),
    practice: { ...defaultPractice(), matches: 2, wins: 1, losses: 1, points: 100, best: 60 },
    world: { '5': { points: 100, matches: 2, bestRank: 40, lastRank: 41 }, '3': { points: 0, matches: 0, bestRank: null, lastRank: null } },
  };
  const next = applyMatch(profile, { matchPoints: 15, cpuPoints: 4, verdict: 'win', rank: 38, rounds: 5 });

  // 練習データ（端末内）
  assert.equal(next.practice.matches, 3);
  assert.equal(next.practice.wins, 2);
  assert.equal(next.practice.points, 115);
  assert.equal(next.practice.best, 60);
  assert.ok(next.practice.lastAt);

  // 世界記録（5回戦部門）
  assert.equal(worldOf(next, '5').points, 115);
  assert.equal(worldOf(next, '5').matches, 3);
  assert.equal(worldOf(next, '5').bestRank, 38);
  assert.equal(worldOf(next, '5').lastRank, 38);

  // 3回戦部門は触らない
  assert.equal(worldOf(next, '3').points, 0);
  assert.equal(worldOf(next, '3').matches, 0);
  assert.equal(worldOf(next, '3').bestRank, null);

  const worse = applyMatch(next, { matchPoints: 0, cpuPoints: 9, verdict: 'lose', rank: 44, rounds: 5 });
  assert.equal(worldOf(worse, '5').points, 115);
  assert.equal(worldOf(worse, '5').bestRank, 38, '最高順位は下がらない');
  assert.equal(worse.practice.losses, 2);
});

test('3回戦の結果は3回戦部門だけに入る', () => {
  const profile = defaultProfile();
  const next = applyMatch(profile, { matchPoints: 12, cpuPoints: 3, verdict: 'win', rank: 55, rounds: 3 });
  assert.equal(worldOf(next, '3').points, 12);
  assert.equal(worldOf(next, '5').points, 0, '5回戦部門は0のまま');
  assert.equal(next.practice.points, 12, '練習データには入る');
  assert.equal(divisionForRounds(3), '3');
  assert.equal(divisionForRounds(5), '5');
});

test('あいこまみれの 0pt マッチでも記録は残る', () => {
  const profile = { ...defaultProfile(), practice: { ...defaultPractice(), matches: 1, points: 30 } };
  const next = applyMatch(profile, { matchPoints: 0, cpuPoints: 0, verdict: 'tie', rank: 50, rounds: 5 });
  assert.equal(worldOf(next, '5').points, 0);
  assert.equal(next.practice.matches, 2);
  assert.equal(next.practice.ties, 1);
  assert.equal(next.practice.points, 30);
});

test('練習データのリセットは世界ランキングに触らない', () => {
  let profile = defaultProfile();
  profile = applyMatch(profile, { matchPoints: 20, cpuPoints: 5, verdict: 'win', rank: 45, rounds: 5 });
  profile = applyMatch(profile, { matchPoints: 10, cpuPoints: 3, verdict: 'lose', rank: 46, rounds: 3 });
  assert.equal(profile.practice.matches, 2);
  assert.equal(worldOf(profile, '5').points, 20);
  assert.equal(worldOf(profile, '3').points, 10);

  const cleared = resetPractice(profile);
  assert.deepEqual(cleared.practice, defaultPractice());
  assert.equal(worldOf(cleared, '5').points, 20, '世界記録は残る');
  assert.equal(worldOf(cleared, '3').points, 10, '3回戦の世界記録も残る');
  assert.equal(cleared.world['5'].bestRank, 45);
});

test('練習データの勝率', () => {
  assert.equal(practiceWinRate(defaultPractice()), 0);
  assert.equal(practiceWinRate({ matches: 4, wins: 3 }), 0.75);
});

test('PRO フラグ', () => {
  const profile = defaultProfile();
  assert.equal(applyPro(profile, true).pro, true);
  assert.equal(applyPro(profile, false).pro, false);
});

/* ================================================================
 * 9. 1マッチ通し（5回戦 / 3回戦・ポイント・ランキング反映）
 * ================================================================ */

test('回戦数は5回戦（標準）と3回戦（別部門）が選べる', () => {
  assert.deepEqual(ROUND_OPTIONS, [5, 3]);
  assert.equal(DEFAULT_ROUNDS, 5);
  assert.equal(isValidRounds(5), true);
  assert.equal(isValidRounds(3), true);
  assert.equal(isValidRounds(4), false);
  assert.equal(divisionLabel('5').label, '5回戦部門');
  assert.equal(divisionLabel('3').label, '3回戦部門');
  assert.equal(maxPointsFor(5), 25);
  assert.equal(maxPointsFor(3), 15);
});

test('3回戦マッチは3ラウンドで終わる', () => {
  let match = createMatch({ rounds: 3 });
  match = playRound(match, { playerHand: 'paper', cpuHand: 'rock' });
  match = playRound(match, { playerHand: 'rock', cpuHand: 'scissors' });
  assert.equal(match.finished, false);
  match = playRound(match, { playerHand: 'scissors', cpuHand: 'paper' });
  assert.equal(match.finished, true);
  assert.equal(match.history.length, 3);
  assert.equal(matchSummary(match).playerPoints, 10);
});

test('5回戦を通しで遊ぶと練習データと順位が動く', () => {
  let profile = { ...defaultProfile(), nickname: 'T' };
  const division = '5';
  const rankBefore = rankInDivision(worldOf(profile, division).points, division);

  let match = createMatch({ rulesetId: 'standard', levelId: 'normal', rounds: 5 });
  let rng = (() => {
    let i = 0;
    const values = [0.1, 0.5, 0.9, 0.3, 0.7, 0.2, 0.8, 0.4, 0.6, 0.05];
    return () => values[i++ % values.length];
  })();

  for (let i = 0; i < 5; i += 1) {
    const playerHand = ['paper', 'rock', 'scissors', 'paper', 'rock'][i];
    const cpuHand = chooseCpuHand({
      levelId: match.levelId,
      history: match.history,
      rulesetId: match.rulesetId,
      rng,
    });
    assert.ok(getRuleset('standard').hands.includes(cpuHand));
    match = playRound(match, { playerHand, cpuHand });
    rng = () => 0.42;
  }

  const summary = matchSummary(match);
  assert.equal(summary.perRound.length, 5);
  assert.equal(summary.playerPoints, match.history.reduce((sum, r) => sum + r.points, 0));
  assert.ok(summary.playerPoints >= 0 && summary.playerPoints <= 25);

  const rankAfter = rankInDivision(summary.playerPoints, division);
  profile = applyMatch(profile, {
    matchPoints: summary.playerPoints,
    cpuPoints: summary.cpuPoints,
    verdict: summary.verdict,
    rank: rankAfter,
    rounds: 5,
  });
  assert.equal(worldOf(profile, division).points, summary.playerPoints);
  assert.equal(profile.practice.matches, 1);
  assert.ok(rankAfter <= rankBefore);
  assert.equal(worldOf(profile, division).lastRank, rankAfter);
});

test('部門ごとにライバルと順位が別物になる（2冠も狙える）', () => {
  assert.equal(DIVISIONS.length, 2);
  const rivals5 = rivalsFor('5');
  const rivals3 = rivalsFor('3');
  assert.equal(rivals5.length, RIVALS.length);
  assert.equal(rivals3.length, RIVALS.length);
  assert.notDeepEqual(
    rivals5.map((r) => r.points),
    rivals3.map((r) => r.points),
    '3回戦部門は別のポイント分布',
  );
  assert.ok(rivals3[0].points < rivals5[0].points, '3回戦は上限が低い');
  for (let i = 1; i < rivals3.length; i += 1) {
    assert.ok(rivals3[i - 1].points >= rivals3[i].points, '3回戦も降順');
  }
  assert.equal(totalInDivision('5'), RIVALS.length + 1);

  // 両部門1位 → 2冠が成立する
  const topPoints = rivals5[0].points + 1000;
  assert.equal(rankInDivision(topPoints, '5'), 1);
  assert.equal(rankInDivision(topPoints, '3'), 1);
  // 片方だけなら1冠
  assert.equal(rankInDivision(rivals3[0].points + 1000, '5') > 1, true);
});

test('部門を指定したランキングに自分が1行だけ入る', () => {
  const rows = leaderboard({ division: '3', player: { nickname: 'ME', countryCode: 'JP', points: 30, matches: 3, winRate: 2 / 3 } });
  assert.equal(rows.length, RIVALS.length + 1);
  assert.equal(rows.filter((row) => row.isYou).length, 1);
  assert.equal(divisionMeta('3').label, '3回戦部門');
  const me = rows.find((row) => row.isYou);
  assert.equal(me.points, 30);
  assert.equal(me.rank, rankInDivision(30, '3'));
});

test('ありうる最大ポイントは 5回戦すべてパー勝ちの 25pt', () => {
  let match = createMatch();
  for (let i = 0; i < 5; i += 1) match = playRound(match, { playerHand: 'paper', cpuHand: 'rock' });
  const summary = matchSummary(match);
  assert.equal(summary.playerPoints, 25);
  assert.equal(summary.perfect, true);
  assert.equal(summary.verdict, 'win');
});

/* ================================================================
 * 10. ルール・レベル定義の整合性
 * ================================================================ */

test('ルールセットのポイント表と手が一致している', () => {
  for (const set of Object.values(RULESETS)) {
    for (const hand of set.hands) {
      assert.equal(typeof set.points[hand], 'number', `${set.id}/${hand}`);
      assert.ok(set.points[hand] > 0);
      assert.deepEqual(beatsOf(hand, set.id), [...set.beats[hand]], set.id);
      assert.ok(counterTo(hand, set.id), `counter for ${set.id}/${hand}`);
    }
    assert.equal(handsOf(set.id).length, set.hands.length);
  }
});

test('標準ルールのポイントは 3 / 2 / 5', () => {
  const set = getRuleset('standard');
  assert.deepEqual(set.points, { rock: 3, scissors: 2, paper: 5 });
  assert.deepEqual(set.hands, ['rock', 'scissors', 'paper']);
});

/* ================================================================
 * 11. 手の率（グー / チョキ / パー）
 * ================================================================ */

test('手の率を計算する', () => {
  const rates = handRates({ rock: 3, scissors: 1, paper: 0 }, HAND_SERIES);
  assert.equal(rates.length, 3);
  assert.deepEqual(rates.map((r) => r.hand), ['rock', 'scissors', 'paper']);
  assert.equal(rates[0].rate, 0.75);
  assert.equal(rates[1].rate, 0.25);
  assert.equal(rates[2].rate, 0);
  assert.equal(formatRate(rates[0].rate, 0), '75%');
  assert.equal(formatRate(0.5834, 1), '58.3%');
});

test('1手も出していなければ 0%（ゼロ除算しない）', () => {
  const rates = handRates(emptyHandCounts(), HAND_SERIES);
  assert.equal(rates.every((r) => r.rate === 0), true);
  assert.equal(formatRate(rates[0].rate, 0), '0%');
});

test('マッチで出した手が handCounts に貯まる', () => {
  let profile = defaultProfile();
  profile = applyMatch(profile, { matchPoints: 15, verdict: 'win', rank: 60, rounds: 5, hands: ['paper', 'paper', 'rock', 'scissors', 'paper'] });
  assert.deepEqual(profile.handCounts, { ...emptyHandCounts(), rock: 1, scissors: 1, paper: 3 });
  const rates = handRates(profile.handCounts, HAND_SERIES);
  assert.equal(rates[2].rate, 0.6, 'パー60%');
});

/* ================================================================
 * 12. 月別ポイント
 * ================================================================ */

test('月別ポイントは今月ぶんだけを数え、月が変わると0から', () => {
  const oct = new Date(2026, 9, 15, 12).getTime();
  const nov = new Date(2026, 10, 15, 12).getTime();
  let profile = defaultProfile(oct);
  assert.equal(worldOf(profile, '5').monthly.month, '2026-10');

  profile = applyMatch(profile, { matchPoints: 10, rank: 60, rounds: 5, at: oct });
  assert.deepEqual(worldOf(profile, '5').monthly, { month: '2026-10', points: 10, matches: 1 });

  profile = applyMatch(profile, { matchPoints: 5, rank: 59, rounds: 5, at: oct });
  assert.deepEqual(worldOf(profile, '5').monthly, { month: '2026-10', points: 15, matches: 2 });

  profile = applyMatch(profile, { matchPoints: 6, rank: 58, rounds: 5, at: nov });
  assert.deepEqual(worldOf(profile, '5').monthly, { month: '2026-11', points: 6, matches: 1 });
  assert.equal(worldOf(profile, '5').points, 21, '総合は積み上がる');
});

test('古い月の記録を読み込むと今月として作り直される', () => {
  const raw = {
    nickname: 'T',
    world: {
      '5': { points: 100, matches: 5, monthly: { month: '2020-01', points: 40, matches: 2 } },
    },
  };
  const profile = sanitizeProfile(raw);
  assert.equal(worldOf(profile, '5').monthly.points, 0);
  assert.equal(worldOf(profile, '5').points, 100);
});

/* ================================================================
 * 13. 世界記録の勝敗・勝率
 * ================================================================ */

test('世界記録に勝敗が貯まり、勝率が出る', () => {
  let profile = defaultProfile();
  profile = applyMatch(profile, { matchPoints: 20, verdict: 'win', rank: 60, rounds: 5 });
  profile = applyMatch(profile, { matchPoints: 0, verdict: 'lose', rank: 61, rounds: 5 });
  profile = applyMatch(profile, { matchPoints: 0, verdict: 'tie', rank: 61, rounds: 5 });
  const entry = worldOf(profile, '5');
  assert.equal(entry.matches, 3);
  assert.equal(entry.wins, 1);
  assert.equal(entry.losses, 1);
  assert.equal(entry.ties, 1);
  assert.equal(entry.wins / entry.matches, 1 / 3, '勝率33.3%');
});

/* ================================================================
 * 14. ランキングの表示軸（部門 × 指標 × 範囲）
 * ================================================================ */

test('指標は 総合 / 月別 / 勝率', () => {
  assert.deepEqual(RANK_METRICS.map((m) => m.id), ['total', 'monthly', 'winrate']);
  assert.deepEqual(RANK_SCOPES.map((s) => s.id), ['world', 'domestic']);
  assert.equal(metricValue({ points: 100, monthlyPoints: 20, matches: 10, winRate: 0.5 }, 'total'), 100);
  assert.equal(metricValue({ points: 100, monthlyPoints: 20 }, 'monthly'), 20);
  assert.equal(metricValue({ matches: 10, winRate: 0.5 }, 'winrate'), 0.5);
  assert.equal(metricValue({ matches: 0, winRate: 0.9 }, 'winrate'), 0, '試合0は勝率0扱い');
});

test('指標ごとに並び順が変わる（月別 / 勝率）', () => {
  const player = { nickname: 'ME', countryCode: 'JP', points: 0, monthlyPoints: 0, matches: 0, winRate: 0 };
  const byTotal = leaderboard({ metric: 'total', player });
  const byMonthly = leaderboard({ metric: 'monthly', player });
  const byWin = leaderboard({ metric: 'winrate', player });
  for (const rows of [byTotal, byMonthly, byWin]) {
    assert.equal(rows.length, RIVALS.length + 1);
    assert.equal(rows[0].rank, 1);
    assert.ok(rows.every((row, i) => i === 0 || metricValue(rows[i - 1], rows === byWin ? 'winrate' : rows === byMonthly ? 'monthly' : 'total') >= metricValue(row, rows === byWin ? 'winrate' : rows === byMonthly ? 'monthly' : 'total')));
  }
  assert.equal(byWin.filter((row) => row.matches > 0).every((row) => row.winRate >= 0.4 && row.winRate <= 0.7), true);
});

test('勝率1位は勝率100%のプレイヤー', () => {
  const player = { nickname: 'ACE', countryCode: 'JP', points: 10, matches: 3, wins: 3, winRate: 1 };
  const rows = leaderboard({ metric: 'winrate', player });
  const me = rows.find((row) => row.isYou);
  assert.equal(me.rank, 1);
  assert.equal(formatMetric(me, 'winrate'), '100.0%');
});

test('試合がない自分の勝率は「—」表示', () => {
  const player = { nickname: 'NEW', countryCode: 'JP', points: 0, matches: 0, winRate: 0 };
  const rows = leaderboard({ metric: 'winrate', player });
  const me = rows.find((row) => row.isYou);
  assert.equal(formatMetric(me, 'winrate'), '—');
  assert.equal(me.rank, rows.length, '勝率0は最下位');
});

test('国内ランキングは同じ国だけになる', () => {
  for (const code of ['JP', 'PH', 'BR', 'PE']) {
    const rows = leaderboard({ scope: 'domestic', player: { nickname: 'ME', countryCode: code, points: 0 } });
    assert.ok(rows.length >= 4, `${code}: ${rows.length}人`);
    assert.equal(rows.every((row) => row.countryCode === code), true, code);
    assert.equal(rows.filter((row) => row.isYou).length, 1);
  }
});

test('世界ランキングは全部の国が出る', () => {
  const rows = leaderboard({ scope: 'world', player: { nickname: 'ME', countryCode: 'JP', points: 0 } });
  const codes = new Set(rows.map((row) => row.countryCode));
  assert.ok(codes.size >= 15, `${codes.size}か国`);
});

test('部門 × 指標を組み合わせても自分の行は1つ', () => {
  for (const division of ['5', '3']) {
    for (const metric of ['total', 'monthly', 'winrate']) {
      for (const scope of ['world', 'domestic']) {
        const rows = leaderboard({ division, metric, scope, player: { nickname: 'ME', countryCode: 'JP', points: 12 } });
        assert.equal(rows.filter((row) => row.isYou).length, 1, `${division}/${metric}/${scope}`);
        assert.ok(rows.find((row) => row.isYou).rank >= 1);
      }
    }
  }
});

test('3回戦部門は5回戦よりポイントが小さい（別集計）', () => {
  const rows5 = leaderboard({ division: '5', player: { nickname: 'ME', countryCode: 'JP', points: 0 } });
  const rows3 = leaderboard({ division: '3', player: { nickname: 'ME', countryCode: 'JP', points: 0 } });
  assert.ok(rows3[0].points < rows5[0].points);
  assert.notEqual(rows3[0].id, rows5[0].id);
});

test('2冠: 両部門1位なら両方チャンピオン', () => {
  const top5 = rivalsFor('5')[0].points;
  const top3 = rivalsFor('3')[0].points;
  const profile = {
    ...defaultProfile(),
    world: {
      '5': { ...defaultDivision(), points: top5 + 10 },
      '3': { ...defaultDivision(), points: top3 + 10 },
    },
  };
  assert.equal(rankInDivision(profile.world['5'].points, '5'), 1);
  assert.equal(rankInDivision(profile.world['3'].points, '3'), 1);
});
