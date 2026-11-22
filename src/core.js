/**
 * JANKeN PoN — ゲームコア
 *
 * DOM に一切触れない純粋ロジック。ブラウザ（index.html）からも
 * node --test（test/core.test.js）からも同じ関数を読み込む。
 *
 * ルール:
 *   グー(✊)で勝ち = 3pt / チョキ(✌️)で勝ち = 2pt / パー(✋)で勝ち = 5pt
 *   あいこ = 0pt（そのまま次のラウンドへ） / 1マッチ = 5回戦
 */

/** 1マッチの回戦数（標準は 5回戦。3回戦は別部門） */
export const ROUNDS_PER_MATCH = 5;

/* ------------------------------------------------------------------ *
 * 通信対戦の国際固定ルール（Build 1 で確定）
 * ------------------------------------------------------------------ */

/** 通信対戦の1手は 5秒固定（世界共通。レベルで変えられない） */
export const ONLINE_TURN_MS = 5000;

/** 通信マッチングの待機上限。過ぎたら安全に終了して案内する */
export const MATCH_TIMEOUT_MS = 30000;

/** パーティーバトル（PRO）: 2〜4人・5回戦・1手5秒固定 */
export const PARTY_ROUNDS = 5;
export const PARTY_MIN_PLAYERS = 2;
export const PARTY_MAX_PLAYERS = 4;
export const PARTY_TURN_MS = ONLINE_TURN_MS;

/**
 * パーティーの結果は、どのランキング（総合・月間・勝率・国内・世界）にも
 * 加算しない。UI とテストはこの定数だけを見る。
 */
export const PARTY_COUNTS_FOR_RANKING = false;

/** 選べる回戦数。3回戦は 5回戦とは別のランキング部門を持つ */
export const ROUND_OPTIONS = Object.freeze([5, 3]);
export const DEFAULT_ROUNDS = 5;

/** 通信対戦の固定条件（画面に出す文言もここから作る） */
export const ONLINE_RULES = Object.freeze({
  turnMs: ONLINE_TURN_MS,
  matchTimeoutMs: MATCH_TIMEOUT_MS,
  rounds: ROUND_OPTIONS,
  rulesetId: 'standard',
  party: { rounds: PARTY_ROUNDS, min: PARTY_MIN_PLAYERS, max: PARTY_MAX_PLAYERS, turnMs: PARTY_TURN_MS, ranked: PARTY_COUNTS_FOR_RANKING },
});

/** 部門 ID は回戦数の文字列（'5' / '3'） */
export const DIVISION_LABELS = Object.freeze({
  '5': { label: '5回戦部門', short: '5回戦', rounds: 5, trophy: '5回戦チャンピオン' },
  '3': { label: '3回戦部門', short: '3回戦', rounds: 3, trophy: '3回戦チャンピオン' },
});

export function isValidRounds(rounds) {
  return ROUND_OPTIONS.includes(Number(rounds));
}

export function divisionForRounds(rounds = DEFAULT_ROUNDS) {
  return String(Number(rounds) === 3 ? 3 : 5);
}

export function divisionLabel(divisionId) {
  return DIVISION_LABELS[String(divisionId)] ?? DIVISION_LABELS['5'];
}

/** その回戦数の理論最大ポイント（毎回パーで勝つ） */
export function maxPointsFor(rounds = ROUNDS_PER_MATCH) {
  return Number(rounds) * Math.max(...Object.values(RULESETS.standard.points));
}

/**
 * 手の表示メタ情報。ポイントは「どのルールセットか」で決まるので
 * ここには持たせない（RULESETS[id].points が唯一の正）。
 */
export const HAND_META = Object.freeze({
  rock:     { key: 'rock',     labelJa: 'グー',   labelEn: 'ROCK',     asset: 'assets/icons/270a.svg', mapsTo: null },
  scissors: { key: 'scissors', labelJa: 'チョキ', labelEn: 'SCISSORS', asset: 'assets/icons/270c.svg', mapsTo: null },
  paper:    { key: 'paper',    labelJa: 'パー',   labelEn: 'PAPER',    asset: 'assets/icons/270b.svg', mapsTo: null },
  // 特殊ハンドは「どの ✊/✌️/✋ に相当するか」を必ず添えて表示する
  elephant: { key: 'elephant', labelJa: 'ゾウ',   labelEn: 'ELEPHANT', asset: 'assets/icons/1f418.svg', mapsTo: 'rock' },
  human:    { key: 'human',    labelJa: '人間',   labelEn: 'HUMAN',    asset: 'assets/icons/1f9d1.svg', mapsTo: 'scissors' },
  ant:      { key: 'ant',      labelJa: 'アリ',   labelEn: 'ANT',      asset: 'assets/icons/1f41c.svg', mapsTo: 'paper' },
  well:     { key: 'well',     labelJa: '井戸',   labelEn: 'WELL',     asset: 'assets/icons/1faa3.svg', mapsTo: 'paper' },
});

/** 特殊ハンドの対応先（✊/✌️/✋）を返す。通常の手は null */
export function mappedHandOf(hand) {
  return HAND_META[hand]?.mapsTo ?? null;
}

/**
 * ルールセット。
 *   hands  : 使える手（表示順）
 *   points : その手で「勝ったとき」にもらえるポイント
 *   beats  : beats[A] に含まれる手に A が勝つ
 */
export const RULESETS = Object.freeze({
  standard: {
    id: 'standard',
    nameJa: 'クラシック',
    nameEn: 'CLASSIC',
    rulesJa: 'グー3 ・ チョキ2 ・ パー5',
    hands: ['rock', 'scissors', 'paper'],
    points: { rock: 3, scissors: 2, paper: 5 },
    beats: { rock: ['scissors'], scissors: ['paper'], paper: ['rock'] },
    pro: false,
  },
  epa: {
    id: 'epa',
    nameJa: 'ゾウ・人間・アリ',
    nameEn: 'ELEPHANT / HUMAN / ANT',
    rulesJa: 'ゾウ3 ・ 人間2 ・ アリ5',
    hintJa: 'ゾウは人間に勝ち、人間はアリに勝ち、アリはゾウに勝つ。',
    hands: ['elephant', 'human', 'ant'],
    points: { elephant: 3, human: 2, ant: 5 },
    beats: { elephant: ['human'], human: ['ant'], ant: ['elephant'] },
    pro: true,
    countryCode: 'ID',
    /* Build 1 の UI には出さない（v1.1 以降に温存。コードの土台だけ残す） */
    archived: true,
  },
  well: {
    id: 'well',
    nameJa: '井戸つき',
    nameEn: 'WELL',
    rulesJa: 'パーだけが井戸をふさぐ（4手）',
    hintJa: '井戸はグーとチョキに勝ち、パーだけが井戸に勝つ（4手）。',
    hands: ['rock', 'scissors', 'paper', 'well'],
    points: { rock: 3, scissors: 2, paper: 5, well: 4 },
    beats: { rock: ['scissors'], scissors: ['paper'], paper: ['rock', 'well'], well: ['rock', 'scissors'] },
    pro: true,
    countryCode: 'FR',
    archived: true,
  },
});

/**
 * Build 1 で遊べるルールセット。クラシック一本に集中する。
 * 特殊ルール（ゾウ・人間・アリ / 井戸つき）はコードに残し、UI には出さない。
 */
export const ACTIVE_RULESETS = Object.freeze(['standard']);

/** v1.1 以降に温存しているルール（UI 非表示） */
export const ARCHIVED_RULESETS = Object.freeze(
  Object.values(RULESETS).filter((set) => set.archived === true).map((set) => set.id),
);

export function activeRulesets() {
  return ACTIVE_RULESETS.map((id) => RULESETS[id]);
}

export function isRulesetVisible(rulesetId) {
  return ACTIVE_RULESETS.includes(rulesetId);
}

/**
 * CPU レベル。thinkingTimeMs がそのままシンキングタイムになる。
 * 1人用（CPU 練習）だけが思考時間を選べる：初級7秒 / 中級5秒（既定）/
 * 上級3秒 / 最強2秒。通信対戦は ONLINE_TURN_MS（5秒）固定で、ここは使わない。
 */
export const LEVELS = Object.freeze({
  easy: {
    id: 'easy', label: 'EASY', labelJa: '初級', thinkingTimeMs: 7000, pro: false,
    blurbJa: '7秒。じっくり考えてよい。まずはここから。',
  },
  normal: {
    id: 'normal', label: 'NORMAL', labelJa: '中級', thinkingTimeMs: 5000, pro: false,
    blurbJa: '5秒。ときどき、あなたの癖をのぞいてくる。',
  },
  hard: {
    id: 'hard', label: 'HARD', labelJa: '上級', thinkingTimeMs: 3000, pro: false,
    blurbJa: '3秒。あなたが出がちな手を、ちゃんと覚えている。',
  },
  master: {
    id: 'master', label: 'MASTER', labelJa: '最強', thinkingTimeMs: 2000, pro: true,
    /* Build 7: PRO 画面の説明（「最強CPUとお互いに手のクセを読み合う心理戦」）に合わせる。
       実装は「相手のクセを読む」（predictPlayerHand）＋ PRO は相手の手の率が見える、の両方向。 */
    blurbJa: '2秒。お互いのクセを読み合う、心理戦の相手。',
  },
});

export const DEFAULT_LEVEL = 'normal';
export const DEFAULT_RULESET = 'standard';

export const OUTCOME = Object.freeze({ WIN: 'win', LOSE: 'lose', TIE: 'tie' });

/** タイムアウト時に「ランダムで出す」安全フォールバックの名前（UI 表示用） */
export const TIMEOUT_POLICY = 'random';

const RULESET_LIST = Object.keys(RULESETS);

export function levelList() {
  return Object.keys(LEVELS).map((id) => LEVELS[id]);
}

export function isLevelUnlocked(levelId, pro = false) {
  const level = LEVELS[levelId];
  if (!level) return false;
  return pro || !level.pro;
}

export function isRulesetUnlocked(rulesetId, pro = false) {
  const set = RULESETS[rulesetId];
  if (!set) return false;
  return pro || !set.pro;
}

/** 未知の ID は例外にする（黙って標準ルールに落とすと不整合に気づけないため） */
export function getRuleset(rulesetId = DEFAULT_RULESET) {
  const set = RULESETS[rulesetId];
  if (!set) throw new RangeError(`unknown ruleset: ${rulesetId}`);
  return set;
}

export function getLevel(levelId = DEFAULT_LEVEL) {
  const level = LEVELS[levelId];
  if (!level) throw new RangeError(`unknown level: ${levelId}`);
  return level;
}

export function handsOf(rulesetId = DEFAULT_RULESET) {
  return getRuleset(rulesetId).hands.slice();
}

export function beatsOf(hand, rulesetId = DEFAULT_RULESET) {
  const beats = getRuleset(rulesetId).beats[hand];
  if (!beats) return [];
  return Array.isArray(beats) ? beats.slice() : [beats];
}

export function pointsFor(hand, rulesetId = DEFAULT_RULESET) {
  const points = getRuleset(rulesetId).points[hand];
  if (typeof points !== 'number') {
    throw new RangeError(`hand "${hand}" has no points in ruleset "${rulesetId}"`);
  }
  return points;
}

/** hand に勝つ手（複数あるルールでは最初の1つ） */
export function counterTo(hand, rulesetId = DEFAULT_RULESET) {
  const set = getRuleset(rulesetId);
  return set.hands.find((h) => beatsOf(h, rulesetId).includes(hand)) ?? null;
}

export function isValidHand(hand, rulesetId = DEFAULT_RULESET) {
  return Boolean(hand) && getRuleset(rulesetId).hands.includes(hand);
}

function assertHand(hand, rulesetId, who) {
  if (!isValidHand(hand, rulesetId)) {
    throw new RangeError(`${who} hand "${hand}" is not part of ruleset "${rulesetId}"`);
  }
}

/**
 * じゃんけんの勝敗。プレイヤー視点で 'win' | 'lose' | 'tie'。
 */
export function judge(playerHand, cpuHand, rulesetId = DEFAULT_RULESET) {
  assertHand(playerHand, rulesetId, 'player');
  assertHand(cpuHand, rulesetId, 'cpu');
  if (playerHand === cpuHand) return OUTCOME.TIE;
  return beatsOf(playerHand, rulesetId).includes(cpuHand) ? OUTCOME.WIN : OUTCOME.LOSE;
}

/**
 * 1ラウンドの得点計算。
 * 勝ち → 出した手のポイント / あいこ・負け → 0pt
 */
export function scoreRound(playerHand, cpuHand, rulesetId = DEFAULT_RULESET) {
  const outcome = judge(playerHand, cpuHand, rulesetId);
  const basePoints = pointsFor(playerHand, rulesetId);
  return {
    outcome,
    basePoints,
    points: outcome === OUTCOME.WIN ? basePoints : 0,
  };
}

/** CPU 側の獲得ポイント（勝ったときだけ、出した手のポイント） */
export function scoreCpuRound(playerHand, cpuHand, rulesetId = DEFAULT_RULESET) {
  const outcome = judge(cpuHand, playerHand, rulesetId);
  return outcome === OUTCOME.WIN ? pointsFor(cpuHand, rulesetId) : 0;
}

export function createMatch({
  rulesetId = DEFAULT_RULESET,
  levelId = DEFAULT_LEVEL,
  rounds = ROUNDS_PER_MATCH,
  opponent = null,
  id = null,
  startedAt = null,
} = {}) {
  getRuleset(rulesetId);
  getLevel(levelId);
  if (!Number.isInteger(rounds) || rounds < 1) {
    throw new RangeError('rounds must be a positive integer');
  }
  return {
    id,
    rulesetId,
    levelId,
    rounds,
    opponent,
    startedAt,
    roundIndex: 0,
    playerPoints: 0,
    cpuPoints: 0,
    history: [],
    finished: false,
  };
}

/**
 * 1ラウンドを消化した新しいマッチ状態を返す（引数は変更しない）。
 */
export function playRound(state, { playerHand, cpuHand, timedOut = false } = {}) {
  if (!state) throw new TypeError('match state is required');
  if (state.finished) throw new RangeError('match is already finished; start a new one');
  const { rulesetId } = state;
  const { outcome, points, basePoints } = scoreRound(playerHand, cpuHand, rulesetId);
  const cpuPoints = scoreCpuRound(playerHand, cpuHand, rulesetId);

  const round = {
    index: state.roundIndex + 1,
    playerHand,
    cpuHand,
    outcome,
    points,
    basePoints,
    cpuPoints,
    timedOut: Boolean(timedOut),
  };

  const history = [...state.history, round];
  return {
    ...state,
    history,
    roundIndex: history.length,
    playerPoints: state.playerPoints + points,
    cpuPoints: state.cpuPoints + cpuPoints,
    finished: history.length >= state.rounds,
  };
}

export function currentRoundNumber(state) {
  return Math.min(state.roundIndex + 1, state.rounds);
}

export function matchSummary(state) {
  if (!state) throw new TypeError('match state is required');
  const perRound = state.history.map((round) => ({ ...round }));
  const roundsWon = perRound.filter((r) => r.outcome === OUTCOME.WIN).length;
  const ties = perRound.filter((r) => r.outcome === OUTCOME.TIE).length;
  const losses = perRound.filter((r) => r.outcome === OUTCOME.LOSE).length;
  const bestRound = perRound.reduce(
    (best, round) => (round.points > (best?.points ?? -1) ? round : best),
    null,
  );
  const verdict =
    state.playerPoints > state.cpuPoints
      ? OUTCOME.WIN
      : state.playerPoints < state.cpuPoints
        ? OUTCOME.LOSE
        : OUTCOME.TIE;

  return {
    rounds: perRound.length,
    playerPoints: state.playerPoints,
    cpuPoints: state.cpuPoints,
    roundsWon,
    ties,
    losses,
    verdict,
    perRound,
    bestRound,
    timedOutRounds: perRound.filter((r) => r.timedOut).length,
    perfect: perRound.length > 0 && roundsWon === perRound.length,
    rulesetId: state.rulesetId,
    levelId: state.levelId,
    opponent: state.opponent,
    finished: state.finished,
  };
}

/* ------------------------------------------------------------------ *
 * CPU（心理読み）
 * ------------------------------------------------------------------ */

function pickRandom(list, rng) {
  const value = rng();
  const index = Math.min(list.length - 1, Math.max(0, Math.floor(value * list.length)));
  return list[index];
}

function mostFrequent(list) {
  const counts = new Map();
  for (const item of list) counts.set(item, (counts.get(item) ?? 0) + 1);
  let best = null;
  let bestCount = -1;
  for (const [item, count] of counts) {
    if (count >= bestCount) {
      best = item;
      bestCount = count;
    }
  }
  return best;
}

/**
 * マスター用の「次の手」予測。
 *  - 前のラウンドに負けた → 相手（CPU）の勝ち手に勝つ手へ変えてくる
 *  - 前のラウンドに勝った → 同じ手を続けがち
 *  - あいこ          → 直近2手の並びから最頻の手
 */
function predictPlayerHand(history) {
  const last = history[history.length - 1];
  if (!last) return null;
  if (last.outcome === OUTCOME.LOSE) return counterTo(last.cpuHand, last.rulesetId ?? DEFAULT_RULESET);
  if (last.outcome === OUTCOME.WIN) return last.playerHand;
  const recent = history.slice(-3).map((r) => r.playerHand);
  return mostFrequent(recent);
}

/**
 * CPU の手を選ぶ。
 * level ごとに読む深さと「外す確率」が変わる。
 */
export function chooseCpuHand({
  levelId = DEFAULT_LEVEL,
  history = [],
  rulesetId = DEFAULT_RULESET,
  rng = Math.random,
} = {}) {
  const set = getRuleset(rulesetId);
  getLevel(levelId);
  const randomHand = () => pickRandom(set.hands, rng);

  if (!history.length || levelId === 'easy') return randomHand();

  const playerHands = history.map((r) => r.playerHand);
  let predicted = null;

  if (levelId === 'normal') {
    // 35% だけ直前の手を読む
    if (rng() < 0.35) predicted = history[history.length - 1].playerHand;
  } else if (levelId === 'hard') {
    predicted = mostFrequent(playerHands);
  } else if (levelId === 'master') {
    predicted = predictPlayerHand(history.map((r) => ({ ...r, rulesetId })));
  }

  if (!predicted) return randomHand();

  // 読み切らないためのゆらぎ（マスターほど精度が高い）
  const missRate = levelId === 'master' ? 0.12 : levelId === 'hard' ? 0.22 : 0.3;
  if (rng() < missRate) return randomHand();

  return counterTo(predicted, rulesetId) ?? randomHand();
}

/**
 * シンキングタイム切れの安全フォールバック。
 * 仕様どおり「ランダムで手を出す」（負け扱いにはしない）。
 */
export function resolveTimeout(rulesetId = DEFAULT_RULESET, rng = Math.random) {
  const set = getRuleset(rulesetId);
  return { hand: pickRandom(set.hands, rng), timedOut: true, policy: TIMEOUT_POLICY };
}

/* ------------------------------------------------------------------ *
 * ランキング（ポイント計算のみ。ダミーライバルは ranking.js）
 * ------------------------------------------------------------------ */

/** 競技順位: 自分より多いポイントの人数 + 1（同点は同順位） */
export function rankFor(points, rivals = []) {
  const safe = Number.isFinite(points) ? points : 0;
  return rivals.filter((r) => r.points > safe).length + 1;
}

export function rankDelta(before, after) {
  if (!Number.isFinite(before) || !Number.isFinite(after)) return 0;
  return before - after; // 正の数 = 順位が上がった
}

export function formatPoints(value) {
  return Math.max(0, Math.round(value)).toLocaleString('ja-JP');
}

export { RULESET_LIST };

/* ------------------------------------------------------------------ *
 * 手の率（グー / チョキ / パー）
 * ------------------------------------------------------------------ */

/** 戦績パネルで並べる基本の手 */
export const HAND_SERIES = Object.freeze(['rock', 'scissors', 'paper']);

/**
 * 手の色（戦績バー・ランキングの3色バー・凡例で同じ値を使う）。
 * ここを変えれば、バーと凡例が必ずそろって変わる。
 */
export const HAND_COLORS = Object.freeze({ rock: '#ffcf5c', scissors: '#4fe3ff', paper: '#a58bff' });

export function emptyHandCounts() {
  return {
    rock: 0,
    scissors: 0,
    paper: 0,
    elephant: 0,
    human: 0,
    ant: 0,
    well: 0,
  };
}

/**
 * 手の回数から「率」を出す。
 * 例: {rock:3, scissors:1, paper:0} → rock 75%, scissors 25%
 */
export function handRates(counts = {}, series = HAND_SERIES) {
  const safe = counts ?? {};
  const total = series.reduce((sum, hand) => sum + Math.max(0, Number(safe[hand]) || 0), 0);
  return series.map((hand) => {
    const count = Math.max(0, Number(safe[hand]) || 0);
    return { hand, count, rate: total > 0 ? count / total : 0 };
  });
}

/** 率をパーセント表記（小数1桁） */
export function formatRate(rate, digits = 0) {
  if (!Number.isFinite(rate)) return '—';
  return `${(Math.max(0, Math.min(1, rate)) * 100).toFixed(digits)}%`;
}

/* ------------------------------------------------------------------ *
 * パーティーバトル（PRO・2〜4人）
 * ------------------------------------------------------------------ */

/**
 * パーティーの1ラウンドを採点する。
 *
 *   ・全員が同じ手       → 0pt
 *   ・グー・チョキ・パーが全部出た（3すくみ）→ 0pt
 *   ・それ以外          → 勝った手を出した全員に、その手のポイント（✊3 / ✌️2 / ✋5）
 *
 * 単独勝ちも複数勝ちも同じ。あいこはテンポ重視で 0pt のまま次へ。
 *
 * @param {Record<string, 'rock'|'scissors'|'paper'>} hands  参加者ID → 手
 * @returns {{points: Record<string, number>, winners: string[], threeWay: boolean, allSame: boolean, best: string|null}}
 */
export function scorePartyRound(hands = {}, rulesetId = 'standard') {
  const set = getRuleset(rulesetId);
  const entries = Object.entries(hands).filter(([, hand]) => set.hands.includes(hand));
  const out = { points: {}, winners: [], threeWay: false, allSame: false, best: null };
  for (const [id] of entries) out.points[id] = 0;
  if (entries.length === 0) return out;

  const distinct = new Set(entries.map(([, hand]) => hand));
  if (distinct.size === 1) {
    out.allSame = true;
    for (const [id] of entries) out.points[id] = 0;
    return out;
  }
  /* グー・チョキ・パーが全部揃うと、誰も勝ちにならない（3すくみ） */
  if (set.hands.every((hand) => distinct.has(hand))) {
    out.threeWay = true;
    return out;
  }

  /* 勝つ手は「ほかの全部の手に勝つ手」1つだけ。2手しか出ていなければ必ず決まる。 */
  const winner = set.hands.find((hand) =>
    [...distinct].every((other) => other === hand || beatsOf(hand, rulesetId).includes(other)),
  );
  if (!winner) return out;
  const points = pointsFor(winner, rulesetId);
  out.best = winner;
  for (const [id, hand] of entries) {
    if (hand === winner) {
      out.winners.push(id);
      out.points[id] = points;
    }
  }
  return out;
}

/**
 * パーティーの最終順位。ポイントが多い順、同じなら名前順（決定的）。
 * @param {Array<{id: string, nickname?: string, points: number}>} players
 */
export function partyStandings(players = []) {
  const rows = [...players].map((player) => ({ ...player, points: Math.max(0, Math.round(Number(player.points) || 0)) }));
  rows.sort((a, b) => b.points - a.points || String(a.nickname ?? a.id).localeCompare(String(b.nickname ?? b.id)));
  let rank = 0;
  let lastPoints = null;
  return rows.map((row, index) => {
    if (lastPoints === null || row.points !== lastPoints) {
      rank = index + 1;
      lastPoints = row.points;
    }
    return { ...row, rank, champion: rank === 1 };
  });
}

/* ------------------------------------------------------------------ *
 * 通信メッセージの検証（不正手・二重送信・範囲外ラウンドを弾く）
 * ------------------------------------------------------------------ */

export const ONLINE_LIMITS = Object.freeze({
  maxMessageBytes: 900,
  maxHandsPerRound: 1,
  maxStampPerWindow: 1,
  stampWindowMs: 4000,
});

/**
 * 受信した「手」のメッセージを検証する。
 *
 *   ・型がオブジェクトで、from が自分以外
 *   ・round が 0〜rounds-1 の整数
 *   ・hand がクラシックの3手
 *   ・同じ人から同じラウンドに2回目が来たら弾く
 *
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export function validateOnlinePick(message, { self = null, rounds = 5, seen = null, rulesetId = 'standard' } = {}) {
  if (!message || typeof message !== 'object') return { ok: false, reason: 'shape' };
  const from = message.from;
  if (typeof from !== 'string' || !from) return { ok: false, reason: 'from' };
  if (self && from === self) return { ok: false, reason: 'self' };
  const round = Number(message.round);
  if (!Number.isInteger(round) || round < 0 || round >= Number(rounds)) return { ok: false, reason: 'round' };
  if (!isValidHand(message.hand, rulesetId)) return { ok: false, reason: 'hand' };
  if (seen && typeof seen.has === 'function' && seen.has(`${from}:${round}`)) return { ok: false, reason: 'duplicate' };
  return { ok: true, from, round, hand: message.hand };
}

/** 受信したスタンプの検証（定型IDのみ・連打はクールダウン） */
export function validateStamp(message, { self = null, allowed = [], lastAt = 0, now = Date.now(), windowMs = ONLINE_LIMITS.stampWindowMs } = {}) {
  if (!message || typeof message !== 'object') return { ok: false, reason: 'shape' };
  const from = message.from;
  if (typeof from !== 'string' || !from) return { ok: false, reason: 'from' };
  if (self && from === self) return { ok: false, reason: 'self' };
  if (!allowed.includes(message.id)) return { ok: false, reason: 'stamp' };
  if (now - lastAt < windowMs) return { ok: false, reason: 'cooldown' };
  return { ok: true, from, id: message.id };
}

/** 通信本文のサイズ上限（長文・自由入力の持ち込みを防ぐ） */
export function payloadTooLarge(payload, limit = ONLINE_LIMITS.maxMessageBytes) {
  try {
    return JSON.stringify(payload).length > limit;
  } catch {
    return true;
  }
}

/* ------------------------------------------------------------------ *
 * Build 2 — PK戦風の履歴ボード / かけ声の切替
 * ------------------------------------------------------------------ */

/**
 * かけ声の出どころ。
 *   self … 左側のプレイヤー（＝自分）の国の言葉。Build 2 の既定。
 *   opp  … 右側の対戦相手の国の言葉。
 */
export const CHANT_SIDES = Object.freeze(['self', 'opp']);

export function normalizeChantSide(side) {
  return side === 'opp' ? 'opp' : 'self';
}

/** かけ声切替ボタンが呼ぶ1手（self ⇄ opp） */
export function nextChantSide(side) {
  return normalizeChantSide(side) === 'opp' ? 'self' : 'opp';
}

/** 履歴ボードの結果記号（勝○ / 負× / 引分△ / まだ · ） */
export const ROUND_MARKS = Object.freeze({ win: '○', lose: '×', tie: '△', pending: '·' });

/**
 * サッカーのPK戦風スコアボード用に、ラウンドごとの手と結果を並べる。
 * history は createMatch/playRound の history（古い順）。
 * まだ打っていないラウンドも含めて rounds 個ぶん返す（常時表示のため）。
 *
 * @param {Array<{playerHand: string, cpuHand: string, outcome: string, points: number}>} history
 * @param {number} rounds
 */
export function pkBoard(history = [], rounds = ROUNDS_PER_MATCH) {
  const done = Array.isArray(history) ? history : [];
  const total = Math.max(1, Number(rounds) || ROUNDS_PER_MATCH, done.length);
  return Array.from({ length: total }, (_, index) => {
    const round = done[index] ?? null;
    const outcome = round?.outcome ?? null;
    return {
      index: index + 1,
      playerHand: round?.playerHand ?? null,
      cpuHand: round?.cpuHand ?? null,
      outcome,
      mark: outcome ? ROUND_MARKS[outcome] ?? ROUND_MARKS.pending : ROUND_MARKS.pending,
      points: round?.points ?? 0,
      done: Boolean(round),
    };
  });
}

/** PKボードの勝敗の数（見出し用） */
export function pkTally(history = []) {
  const list = Array.isArray(history) ? history : [];
  return {
    wins: list.filter((round) => round.outcome === OUTCOME.WIN).length,
    losses: list.filter((round) => round.outcome === OUTCOME.LOSE).length,
    ties: list.filter((round) => round.outcome === OUTCOME.TIE).length,
    done: list.length,
  };
}

/**
 * 締切（カウント終了）での確定（Build 2）。
 * タップは「選択中」だけで、最後に選んでいた手があればそれを、無ければランダムを返す。
 */
export function resolveCommit(selectedHand, { rulesetId = DEFAULT_RULESET, rng = Math.random } = {}) {
  if (isValidHand(selectedHand, rulesetId)) {
    return { hand: selectedHand, timedOut: false, source: 'selected' };
  }
  const { hand } = resolveTimeout(rulesetId, rng);
  return { hand, timedOut: true, source: 'timeout' };
}
