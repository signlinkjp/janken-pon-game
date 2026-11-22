/**
 * 世界ランキング（プロトタイプ版）
 *
 * 表示軸:
 *   部門   … 5回戦 / 3回戦（別集計。両方1位なら「2冠」）
 *   指標   … 総合 / 月別 / 週間 / 勝率
 *   範囲   … 世界 / 国内（自分の国だけ）
 *
 * いまはダミーのライバル（RIVALS）だが、形はそのまま Supabase の
 * `games-realtime`（テーブル: janken_pon_players）に置き換えられる:
 *
 *   id uuid / nickname text / country_code text
 *   total_points_5 int / total_points_3 int
 *   monthly_5 jsonb / monthly_3 jsonb（{month, points, matches}）
 *   weekly_5 jsonb / weekly_3 jsonb（{week, points, matches}）
 *   wins_5 / losses_5 / ties_5 / wins_3 / losses_3 / ties_3 int
 *   hand_rock / hand_scissors / hand_paper int
 *   is_pro bool / updated_at timestamptz
 *
 * 差し替え手順:
 *   1. RIVALS の代わりに select の結果を rivalsFor() の形に揃えて渡す
 *   2. 自分の行は playerToRow(profile) で upsert
 *   3. ランキング再描画は Realtime の postgres_changes 購読で行う
 */

import { rankFor, formatPoints } from './core.js';

export const REALTIME_TABLE = 'janken_pon_players';

/** 5回戦部門のライバル（ポイントは累計） */
export const RIVALS = Object.freeze([
  { id: 'r01', nickname: 'Kai', countryCode: 'US', points: 12480 },
  { id: 'r02', nickname: 'Yuna', countryCode: 'JP', points: 11920 },
  { id: 'r03', nickname: 'Rafael', countryCode: 'BR', points: 11360 },
  { id: 'r04', nickname: 'Léa', countryCode: 'FR', points: 10840 },
  { id: 'r05', nickname: 'Sora', countryCode: 'JP', points: 10270 },
  { id: 'r06', nickname: 'Minjae', countryCode: 'KR', points: 9870 },
  { id: 'r07', nickname: 'Luca', countryCode: 'IT', points: 9410 },
  { id: 'r08', nickname: 'Nina', countryCode: 'DE', points: 9020 },
  { id: 'r09', nickname: 'Arif', countryCode: 'ID', points: 8640 },
  { id: 'r10', nickname: 'Ploy', countryCode: 'TH', points: 8310 },
  { id: 'r11', nickname: 'Mateus', countryCode: 'BR', points: 7980 },
  { id: 'r12', nickname: 'Sofía', countryCode: 'ES', points: 7620 },
  { id: 'r13', nickname: 'Hana', countryCode: 'JP', points: 7340 },
  { id: 'r14', nickname: 'Diego', countryCode: 'PE', points: 7010 },
  { id: 'r15', nickname: 'Emma', countryCode: 'SE', points: 6720 },
  { id: 'r16', nickname: 'Ozan', countryCode: 'TR', points: 6390 },
  { id: 'r17', nickname: 'Lin', countryCode: 'CN', points: 6010 },
  { id: 'r18', nickname: 'Mai', countryCode: 'VN', points: 5720 },
  { id: 'r19', nickname: 'Noor', countryCode: 'NL', points: 5440 },
  { id: 'r20', nickname: 'Viktor', countryCode: 'RU', points: 5170 },
  { id: 'r21', nickname: 'Kasia', countryCode: 'PL', points: 4900 },
  { id: 'r22', nickname: 'João', countryCode: 'BR', points: 4650 },
  { id: 'r23', nickname: 'Rika', countryCode: 'JP', points: 4410 },
  { id: 'r24', nickname: 'Ada', countryCode: 'US', points: 4180 },
  { id: 'r25', nickname: 'Tono', countryCode: 'ID', points: 3960 },
  { id: 'r26', nickname: 'Pim', countryCode: 'TH', points: 3750 },
  { id: 'r27', nickname: 'Elena', countryCode: 'IT', points: 3540 },
  { id: 'r28', nickname: 'Max', countryCode: 'DE', points: 3340 },
  { id: 'r29', nickname: 'Céline', countryCode: 'FR', points: 3150 },
  { id: 'r30', nickname: 'Sunwoo', countryCode: 'KR', points: 2960 },
  { id: 'r31', nickname: 'Aiko', countryCode: 'JP', points: 2780 },
  { id: 'r32', nickname: 'Rafa', countryCode: 'PE', points: 2610 },
  { id: 'r33', nickname: 'Ebba', countryCode: 'SE', points: 2440 },
  { id: 'r34', nickname: 'Kenji', countryCode: 'JP', points: 2280 },
  { id: 'r35', nickname: 'Yuri', countryCode: 'RU', points: 2120 },
  { id: 'r36', nickname: 'Anh', countryCode: 'VN', points: 1970 },
  { id: 'r37', nickname: 'Bea', countryCode: 'ES', points: 1830 },
  { id: 'r38', nickname: 'Tarık', countryCode: 'TR', points: 1690 },
  { id: 'r39', nickname: 'Nils', countryCode: 'NL', points: 1560 },
  { id: 'r40', nickname: 'Ola', countryCode: 'PL', points: 1430 },
  { id: 'r41', nickname: 'Jun', countryCode: 'JP', points: 1300 },
  { id: 'r42', nickname: 'Lia', countryCode: 'BR', points: 1170 },
  { id: 'r43', nickname: 'Sam', countryCode: 'US', points: 1040 },
  { id: 'r44', nickname: 'Pia', countryCode: 'DE', points: 910 },
  { id: 'r45', nickname: 'Rio', countryCode: 'JP', points: 740 },
  { id: 'r46', nickname: 'May', countryCode: 'TH', points: 430 },
  { id: 'r47', nickname: 'Nao', countryCode: 'JP', points: 320 },
  { id: 'r48', nickname: 'Ren', countryCode: 'JP', points: 260 },
  { id: 'r49', nickname: 'Ana', countryCode: 'ES', points: 210 },
  { id: 'r50', nickname: 'Ken', countryCode: 'US', points: 175 },
  { id: 'r51', nickname: 'Rin', countryCode: 'JP', points: 140 },
  { id: 'r52', nickname: 'Bia', countryCode: 'BR', points: 110 },
  { id: 'r53', nickname: 'Finn', countryCode: 'DE', points: 88 },
  { id: 'r54', nickname: 'Suki', countryCode: 'TH', points: 66 },
  { id: 'r55', nickname: 'Leo', countryCode: 'FR', points: 45 },
  { id: 'r56', nickname: 'Mio', countryCode: 'JP', points: 40 },
  { id: 'r57', nickname: 'Ash', countryCode: 'US', points: 34 },
  { id: 'r58', nickname: 'Nia', countryCode: 'ID', points: 28 },
  { id: 'r59', nickname: 'Tino', countryCode: 'PE', points: 22 },
  { id: 'r60', nickname: 'Yui', countryCode: 'JP', points: 17 },
  { id: 'r61', nickname: 'Oli', countryCode: 'NL', points: 13 },
  { id: 'r62', nickname: 'Zoe', countryCode: 'PL', points: 9 },
  { id: 'r63', nickname: 'Rui', countryCode: 'BR', points: 6 },
  { id: 'r64', nickname: 'Ina', countryCode: 'SE', points: 3 },
  // 国内ランキングを成立させるための追加メンバー
  { id: 'r65', nickname: 'Miko', countryCode: 'PH', points: 620 },
  { id: 'r66', nickname: 'Jomar', countryCode: 'PH', points: 88 },
  { id: 'r67', nickname: 'Liza', countryCode: 'PH', points: 12 },
  { id: 'r68', nickname: 'Wei', countryCode: 'CN', points: 1520 },
  { id: 'r69', nickname: 'Xinyi', countryCode: 'CN', points: 64 },
  { id: 'r70', nickname: 'Jiho', countryCode: 'KR', points: 2380 },
  { id: 'r71', nickname: 'Giulia', countryCode: 'IT', points: 480 },
  { id: 'r72', nickname: 'Selin', countryCode: 'TR', points: 1320 },
  { id: 'r73', nickname: 'Thao', countryCode: 'VN', points: 205 },
  { id: 'r74', nickname: 'Dasha', countryCode: 'RU', points: 760 },
]);

export const PLAYER_ROW_ID = 'you';

/* ------------------------------------------------------------------ *
 * 部門・指標・範囲
 * ------------------------------------------------------------------ */

export const DIVISIONS = Object.freeze([
  { id: '5', rounds: 5, label: '5回戦部門', short: '5回戦', factor: 1, trophy: '5回戦チャンピオン' },
  { id: '3', rounds: 3, label: '3回戦部門', short: '3回戦', factor: 0.62, trophy: '3回戦チャンピオン' },
]);

export function divisionMeta(divisionId = '5') {
  return DIVISIONS.find((division) => division.id === String(divisionId)) ?? DIVISIONS[0];
}

/**
 * 勝率ランキングの最低試合数（Build 3）。
 * 1戦1勝の 100% が1位に来ないように、5戦以上だけを対象にする。
 * 5戦未満の人は「圏外」と「あと何戦」で案内する。
 */
export const MIN_WINRATE_MATCHES = 5;

/** その指標で順位を持てるか（勝率だけ試合数が要る） */
export function isRankedIn(row, metricId = 'total') {
  if (!row) return false;
  if (metricId !== 'winrate') return true;
  return Number(row.matches ?? 0) >= MIN_WINRATE_MATCHES;
}

/** 勝率ランキングまで、あと何戦か（対象なら 0） */
export function matchesToWinRateRank(matches = 0) {
  return Math.max(0, MIN_WINRATE_MATCHES - Number(matches || 0));
}

export const RANK_METRICS = Object.freeze([
  { id: 'total', label: '総合', short: '総合', unit: 'pt', kind: 'points' },
  { id: 'monthly', label: '月別', short: '月別', unit: 'pt', kind: 'points' },
  { id: 'weekly', label: '週間', short: '週間', unit: 'pt', kind: 'points' },
  { id: 'winrate', label: '勝率', short: '勝率', unit: '%', kind: 'rate' },
]);

export function metricMeta(metricId = 'total') {
  return RANK_METRICS.find((metric) => metric.id === metricId) ?? RANK_METRICS[0];
}

export const RANK_SCOPES = Object.freeze([
  { id: 'world', label: '世界', longLabel: '世界ランキング' },
  { id: 'domestic', label: '国内', longLabel: '国内ランキング' },
]);

export function scopeMeta(scopeId = 'world') {
  return RANK_SCOPES.find((scope) => scope.id === scopeId) ?? RANK_SCOPES[0];
}

/* ------------------------------------------------------------------ *
 * ライバル生成
 * ------------------------------------------------------------------ */

/** 手の率（グー / チョキ / パー）をライバルごとに決める（合計100%） */
function rivalHandRates(index) {
  const rock = 28 + ((index * 7) % 16); // 28〜43%
  const scissors = 26 + ((index * 11) % 16); // 26〜41%
  const paper = 100 - rock - scissors; // 16〜46%
  return { rock: rock / 100, scissors: scissors / 100, paper: paper / 100 };
}

function decorateRival(rival, index) {
  const matches = 40 + ((index * 37) % 260);
  const winRate = 0.44 + ((index * 17) % 23) / 100;
  return {
    ...rival,
    matches,
    winRate,
    handRates: rivalHandRates(index),
  };
}

const divisionCache = new Map();

/**
 * 部門ごとのライバル一覧（決定的に生成するので毎回同じ順位になる）。
 * 3回戦は 1マッチの上限が 15pt なので、ポイントは 5回戦の約0.62倍。
 */
export function rivalsFor(divisionId = '5') {
  const id = String(divisionId);
  if (!divisionCache.has(id)) {
    const meta = divisionMeta(id);
    const rows = RIVALS.map((rival, index) => {
      const decorated = decorateRival(rival, index);
      const jitter = meta.factor === 1 ? 1 : 0.86 + (((index * 37 + 11) % 27) / 100);
      const points = meta.factor === 1 ? rival.points : Math.max(1, Math.round(rival.points * meta.factor * jitter));
      return {
        ...decorated,
        id: meta.factor === 1 ? rival.id : `${rival.id}-d${id}`,
        points,
        monthlyPoints: Math.round(points * (0.04 + ((index * 13) % 13) / 100)),
        weeklyPoints: Math.round(points * (0.012 + ((index * 7) % 9) / 200)),
      };
    }).sort((a, b) => b.points - a.points);
    divisionCache.set(id, rows);
  }
  return divisionCache.get(id);
}

export function playerRank(points, rivals = RIVALS) {
  return rankFor(points, rivals);
}

export function totalPlayers(rivals = RIVALS) {
  return rivals.length + 1;
}

/** 部門単位の順位（総合ポイント）。peers は通信で受け取った行。 */
export function rankInDivision(points, divisionId = '5', peers = []) {
  return rankFor(points, [...rivalsFor(divisionId), ...normalizePeers(peers)]);
}

export function totalInDivision(divisionId = '5', peers = []) {
  return rivalsFor(divisionId).length + normalizePeers(peers).length + 1;
}

/**
 * 通信で受け取った行（Supabase の broadcast）を、ライバルと同じ形に整える。
 * 形の違う行は捨てる（画面を壊さない）。
 */
export function normalizePeers(peers = []) {
  if (!Array.isArray(peers)) return [];
  return peers
    .filter((row) => row && typeof row.id === 'string' && row.id)
    .map((row) => ({
      id: row.id,
      nickname: String(row.nickname ?? 'PLAYER').slice(0, 24),
      countryCode: String(row.countryCode ?? 'JP').toUpperCase().slice(0, 2),
      points: Math.max(0, Math.round(Number(row.points) || 0)),
      monthlyPoints: Math.max(0, Math.round(Number(row.monthlyPoints) || 0)),
      weeklyPoints: Math.max(0, Math.round(Number(row.weeklyPoints) || 0)),
      matches: Math.max(0, Math.round(Number(row.matches) || 0)),
      wins: Math.max(0, Math.round(Number(row.wins) || 0)),
      losses: Math.max(0, Math.round(Number(row.losses) || 0)),
      ties: Math.max(0, Math.round(Number(row.ties) || 0)),
      winRate: Math.min(1, Math.max(0, Number(row.winRate) || 0)),
      handRates: row.handRates ?? null,
      pro: Boolean(row.pro),
      fromNet: true,
    }));
}

/* ------------------------------------------------------------------ *
 * ランキング本体
 * ------------------------------------------------------------------ */

export function metricValue(row, metricId = 'total') {
  if (!row) return 0;
  if (metricId === 'monthly') return Number(row.monthlyPoints ?? 0);
  if (metricId === 'weekly') return Number(row.weeklyPoints ?? 0);
  if (metricId === 'winrate') return row.matches > 0 ? Number(row.winRate ?? 0) : 0;
  return Number(row.points ?? 0);
}

/** 表示用の文字列（単位はヘッダー側で出す） */
export function formatMetric(row, metricId = 'total') {
  if (!row) return '—';
  if (metricId === 'winrate') {
    if (!row.matches) return '—';
    /* 順位の対象になるのは 5戦以上だけ（1戦1勝の100%で1位になるのを防ぐ） */
    if (!isRankedIn(row, 'winrate')) return '—';
    return `${(Number(row.winRate ?? 0) * 100).toFixed(1)}%`;
  }
  return formatPoints(metricValue(row, metricId));
}

/**
 * ランキングを組み立てる。
 *   player: { nickname, countryCode, points, monthlyPoints, weeklyPoints, matches, winRate, handRates, pro }
 */
export function leaderboard({
  division = '5',
  metric = 'total',
  scope = 'world',
  player = {},
  peers = [],
} = {}) {
  const divisionId = String(division);
  const youId = PLAYER_ROW_ID;
  const rivalPool = [...rivalsFor(divisionId), ...normalizePeers(peers).filter((row) => row.id !== youId)];
  const rivals = rivalPool.filter(
    (rival) => scope !== 'domestic' || rival.countryCode === player.countryCode,
  );

  const you = {
    id: PLAYER_ROW_ID,
    nickname: player.nickname || 'YOU',
    countryCode: player.countryCode ?? 'JP',
    points: Math.max(0, Math.round(player.points ?? 0)),
    monthlyPoints: Math.max(0, Math.round(player.monthlyPoints ?? 0)),
    weeklyPoints: Math.max(0, Math.round(player.weeklyPoints ?? 0)),
    matches: Math.max(0, Math.round(player.matches ?? 0)),
    wins: Math.max(0, Math.round(player.wins ?? 0)),
    losses: Math.max(0, Math.round(player.losses ?? 0)),
    ties: Math.max(0, Math.round(player.ties ?? 0)),
    winRate: player.matches > 0 ? player.winRate : 0,
    handRates: player.handRates ?? null,
    isYou: true,
    pro: Boolean(player.pro),
  };

  /* 勝率だけは 5戦未満を圏外（順位なし）にして、リストの最後に回す */
  const rows = [...rivals.map((rival) => ({ ...rival, isYou: false })), you]
    .map((row) => ({ ...row, qualified: isRankedIn(row, metric) }))
    .sort((a, b) => {
      if (a.qualified !== b.qualified) return a.qualified ? -1 : 1;
      return metricValue(b, metric) - metricValue(a, metric) || Number(b.isYou) - Number(a.isYou);
    });

  return rows.map((row) => ({
    ...row,
    rank: row.qualified
      ? 1 + rows.filter((other) => other.qualified && metricValue(other, metric) > metricValue(row, metric)).length
      : null,
  }));
}

/** 互換用（旧名） */
export const leaderboardFor = (options) => leaderboard(options);

/**
 * 自分の行の前後だけ（ランキング画面でスクロールせず見える範囲）。
 */
export function leaderboardWindow(rows, { aroundId = PLAYER_ROW_ID, radius = 3 } = {}) {
  const index = rows.findIndex((row) => row.id === aroundId);
  if (index < 0) return rows.slice(0, radius * 2 + 1);
  const start = Math.max(0, index - radius);
  const end = Math.min(rows.length, index + radius + 1);
  return rows.slice(start, end);
}

/** 次の順位までどれだけ足りないか（指標の単位で返す） */
export function pointsToNext(rows, rowId = PLAYER_ROW_ID, metric = 'total') {
  const index = rows.findIndex((row) => row.id === rowId);
  if (index <= 0) return 0;
  const me = rows[index];
  const ahead = rows[index - 1];
  const diff = metricValue(ahead, metric) - metricValue(me, metric);
  if (metric === 'winrate') return Math.max(0, diff);
  return Math.max(0, ahead.points === me.points ? 0 : Math.ceil(diff + (metric === 'total' ? 1 : 0)));
}

export function playerToRow({ nickname, countryCode, points, pro = false }, at = Date.now()) {
  return {
    nickname: String(nickname || 'YOU').slice(0, 24),
    country_code: countryCode,
    total_points: Math.max(0, Math.round(points)),
    is_pro: Boolean(pro),
    updated_at: new Date(at).toISOString(),
  };
}

export function rowToPlayer(row) {
  return {
    id: row.id ?? null,
    nickname: row.nickname ?? 'YOU',
    countryCode: row.country_code ?? 'JP',
    points: Number(row.total_points ?? 0),
    pro: Boolean(row.is_pro),
  };
}
