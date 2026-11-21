/**
 * プロフィール保存（localStorage / Capacitor Preferences どちらでも差し替え可）
 *
 * 保存するものは3種類に分かれている:
 *   practice … CPU 戦（練習モード）の記録。この端末だけのもの。リセットできる。
 *   world    … 世界ランキングに提出した記録。部門（5回戦 / 3回戦）ごとに別集計。
 *              月別ランキング用に「今月ぶん」も持つ（月が変わると自動で0に戻る）。
 *   handCounts … 出した手の回数（グー / チョキ / パー）。戦績パネルの元データ。
 *
 * 練習データと世界ランキングの記録は別オブジェクトなので、練習のリセットが
 * ランキング側に影響することはない。
 */

export const STORAGE_KEY = 'janken-pon.profile.v1';
export const PROFILE_VERSION = 3;

export function monthKey(at = Date.now()) {
  const date = new Date(at);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function defaultMonthly(at = Date.now()) {
  return { month: monthKey(at), points: 0, matches: 0 };
}

export function defaultDivision(at = Date.now()) {
  return {
    points: 0,
    matches: 0,
    wins: 0,
    losses: 0,
    ties: 0,
    bestRank: null,
    lastRank: null,
    monthly: defaultMonthly(at),
  };
}

export function defaultPractice() {
  return { matches: 0, wins: 0, losses: 0, ties: 0, points: 0, best: 0, lastAt: null };
}

/**
 * パーティーバトル（PRO）の記録。端末内だけの遊びの記録で、
 * 世界ランキング（world）には一切加算しない。
 */
export function defaultParty() {
  return { matches: 0, wins: 0, points: 0, best: 0, lastAt: null };
}

export function defaultHandCounts() {
  return { rock: 0, scissors: 0, paper: 0, elephant: 0, human: 0, ant: 0, well: 0 };
}

export function defaultProfile(at = Date.now()) {
  return {
    version: PROFILE_VERSION,
    nickname: '',
    countryCode: 'JP',
    rounds: 5,
    practice: defaultPractice(),
    party: defaultParty(),
    world: { '5': defaultDivision(at), '3': defaultDivision(at) },
    handCounts: defaultHandCounts(),
    pro: false,
    levelId: 'normal',
    rulesetId: 'standard',
    locale: 'ja',
    sound: true,
    stampsMuted: false,
    createdAt: null,
    lastPlayedAt: null,
  };
}

function safeInt(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.round(n));
}

function safeRank(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}

function sanitizeMonthly(raw, fallback) {
  if (!raw || typeof raw !== 'object') return { ...fallback };
  const month = typeof raw.month === 'string' ? raw.month : fallback.month;
  if (month !== fallback.month) return { month: fallback.month, points: 0, matches: 0 };
  return {
    month,
    points: safeInt(raw.points, fallback.points),
    matches: safeInt(raw.matches, fallback.matches),
  };
}

function sanitizeDivision(raw, fallback = defaultDivision()) {
  if (!raw || typeof raw !== 'object') return { ...fallback, monthly: { ...fallback.monthly } };
  return {
    points: safeInt(raw.points, fallback.points),
    matches: safeInt(raw.matches, fallback.matches),
    wins: safeInt(raw.wins, fallback.wins),
    losses: safeInt(raw.losses, fallback.losses),
    ties: safeInt(raw.ties, fallback.ties),
    bestRank: raw.bestRank === undefined ? fallback.bestRank : safeRank(raw.bestRank),
    lastRank: raw.lastRank === undefined ? fallback.lastRank : safeRank(raw.lastRank),
    monthly: sanitizeMonthly(raw.monthly, fallback.monthly),
  };
}

function sanitizePractice(raw, fallback = defaultPractice()) {
  if (!raw || typeof raw !== 'object') return { ...fallback };
  return {
    matches: safeInt(raw.matches, fallback.matches),
    wins: safeInt(raw.wins, fallback.wins),
    losses: safeInt(raw.losses, fallback.losses),
    ties: safeInt(raw.ties, fallback.ties),
    points: safeInt(raw.points, fallback.points),
    best: safeInt(raw.best, fallback.best),
    lastAt: typeof raw.lastAt === 'string' ? raw.lastAt : null,
  };
}

function sanitizeHandCounts(raw, fallback = defaultHandCounts()) {
  if (!raw || typeof raw !== 'object') return { ...fallback };
  const out = { ...fallback };
  for (const hand of Object.keys(out)) out[hand] = safeInt(raw[hand], 0);
  return out;
}

function sanitizeParty(raw, fallback = defaultParty()) {
  if (!raw || typeof raw !== 'object') return { ...fallback };
  return {
    matches: safeInt(raw.matches, fallback.matches),
    wins: safeInt(raw.wins, fallback.wins),
    points: safeInt(raw.points, fallback.points),
    best: safeInt(raw.best, fallback.best),
    lastAt: typeof raw.lastAt === 'string' ? raw.lastAt : null,
  };
}

export function sanitizeProfile(raw, base = defaultProfile()) {
  if (!raw || typeof raw !== 'object') return { ...base };
  const nickname = typeof raw.nickname === 'string' ? raw.nickname.trim().slice(0, 16) : '';
  const countryCode =
    typeof raw.countryCode === 'string' && raw.countryCode.length === 2
      ? raw.countryCode.toUpperCase()
      : base.countryCode;
  const rounds = Number(raw.rounds) === 3 ? 3 : 5;

  // v1 形式（totalPoints / matches / bestRank がトップレベル）からの移行
  const legacyWorld = {
    points: safeInt(raw.totalPoints, 0),
    matches: safeInt(raw.matches, 0),
    bestRank: safeRank(raw.bestRank),
    lastRank: safeRank(raw.lastRank),
  };

  const world = {
    '5': sanitizeDivision(raw.world?.['5'], { ...legacyWorld, wins: 0, losses: 0, ties: 0, monthly: defaultMonthly() }),
    '3': sanitizeDivision(raw.world?.['3'], defaultDivision()),
  };

  const practice = sanitizePractice(
    raw.practice,
    raw.matches !== undefined
      ? { ...defaultPractice(), matches: legacyWorld.matches }
      : defaultPractice(),
  );

  return {
    ...base,
    version: PROFILE_VERSION,
    nickname,
    countryCode,
    rounds,
    practice,
    party: sanitizeParty(raw.party),
    world,
    handCounts: sanitizeHandCounts(raw.handCounts),
    pro: Boolean(raw.pro),
    levelId: typeof raw.levelId === 'string' ? raw.levelId : base.levelId,
    rulesetId: typeof raw.rulesetId === 'string' ? raw.rulesetId : base.rulesetId,
    locale: typeof raw.locale === 'string' && raw.locale.length <= 10 ? raw.locale : base.locale,
    sound: raw.sound === undefined ? base.sound : Boolean(raw.sound),
    stampsMuted: Boolean(raw.stampsMuted),
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : null,
    lastPlayedAt: typeof raw.lastPlayedAt === 'string' ? raw.lastPlayedAt : null,
  };
}

/** メモリ実装（file:// で localStorage が使えない環境でも遊べるように） */
export function createMemoryBackend() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => void map.set(key, String(value)),
    removeItem: (key) => void map.delete(key),
  };
}

function defaultBackend() {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return createMemoryBackend();
    const probe = '__janken_probe__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return ls;
  } catch {
    return createMemoryBackend();
  }
}

export function createProfileStore(backend = defaultBackend(), key = STORAGE_KEY) {
  return {
    key,
    load() {
      try {
        const raw = backend.getItem(key);
        if (!raw) return defaultProfile();
        return sanitizeProfile(JSON.parse(raw));
      } catch {
        return defaultProfile();
      }
    },
    save(profile) {
      const clean = sanitizeProfile(profile);
      try {
        backend.setItem(key, JSON.stringify(clean));
      } catch {
        /* 保存できなくても遊べるように握りつぶす */
      }
      return clean;
    },
    clear() {
      try {
        backend.removeItem(key);
      } catch {
        /* noop */
      }
      return defaultProfile();
    },
  };
}

/* ------------------------------------------------------------------ *
 * 参照ヘルパー
 * ------------------------------------------------------------------ */

export function divisionIdOf(rounds) {
  return Number(rounds) === 3 ? '3' : '5';
}

export function worldOf(profile, divisionId = divisionIdOf(profile.rounds)) {
  return profile.world?.[String(divisionId)] ?? defaultDivision();
}

export function worldPointsOf(profile, divisionId) {
  return worldOf(profile, divisionId).points;
}

/** 世界記録での勝率（0〜1）。1試合もなければ null */
export function worldWinRate(entry) {
  if (!entry || entry.matches <= 0) return null;
  return entry.wins / entry.matches;
}

/** 練習データの勝率（0〜1） */
export function practiceWinRate(practice) {
  if (!practice || practice.matches <= 0) return 0;
  return practice.wins / practice.matches;
}

/* ------------------------------------------------------------------ *
 * 更新
 * ------------------------------------------------------------------ */

/**
 * 1マッチの結果を記録する。
 *   practice  … 常に加算（端末内の練習記録。オンラインもその日の遊びとして加算）
 *   handCounts … 出した手を数える（手の率）
 *   world     … ranked: true のときだけ、その部門の世界記録に加算
 *               （パーティーバトルは ranked: false で呼び、どのランキングにも触らない）
 */
export function applyMatch(
  profile,
  {
    matchPoints = 0,
    cpuPoints = 0,
    verdict = 'tie',
    rank = null,
    rounds = profile.rounds,
    hands = [],
    ranked = true,
    at = Date.now(),
  } = {},
) {
  const gained = safeInt(matchPoints);
  const divisionId = divisionIdOf(rounds);
  const entry = worldOf(profile, divisionId);
  const iso = new Date(at).toISOString();

  const practice = {
    matches: profile.practice.matches + 1,
    wins: profile.practice.wins + (verdict === 'win' ? 1 : 0),
    losses: profile.practice.losses + (verdict === 'lose' ? 1 : 0),
    ties: profile.practice.ties + (verdict === 'tie' ? 1 : 0),
    points: profile.practice.points + gained,
    best: Math.max(profile.practice.best, gained),
    lastAt: iso,
  };

  const handCounts = { ...defaultHandCounts(), ...(profile.handCounts ?? {}) };
  for (const hand of hands) {
    if (handCounts[hand] === undefined) handCounts[hand] = 0;
    handCounts[hand] += 1;
  }

  const month = monthKey(at);
  const monthly =
    entry.monthly?.month === month
      ? {
          month,
          points: entry.monthly.points + gained,
          matches: entry.monthly.matches + 1,
        }
      : { month, points: gained, matches: 1 };

  const nextEntry =
    rank == null || ranked === false
      ? entry
      : {
          ...entry,
          points: entry.points + gained,
          matches: entry.matches + 1,
          wins: entry.wins + (verdict === 'win' ? 1 : 0),
          losses: entry.losses + (verdict === 'lose' ? 1 : 0),
          ties: entry.ties + (verdict === 'tie' ? 1 : 0),
          bestRank: entry.bestRank == null ? rank : Math.min(entry.bestRank, rank),
          lastRank: rank,
          monthly,
        };

  return {
    ...profile,
    practice,
    handCounts,
    world: { ...profile.world, [divisionId]: nextEntry },
    lastPlayedAt: iso,
    createdAt: profile.createdAt ?? iso,
  };
}

/**
 * パーティーバトル（2〜4人・5回戦）の結果を端末内の記録にだけ残す。
 * 世界ランキング（総合・月間・勝率・国内/世界）には一切加算しない。
 */
export function applyParty(profile, { points = 0, champion = false, hands = [], at = Date.now() } = {}) {
  const gained = safeInt(points);
  const party = profile.party ?? defaultParty();
  const handCounts = { ...defaultHandCounts(), ...(profile.handCounts ?? {}) };
  for (const hand of hands) {
    if (handCounts[hand] === undefined) handCounts[hand] = 0;
    handCounts[hand] += 1;
  }
  return {
    ...profile,
    handCounts,
    party: {
      matches: party.matches + 1,
      wins: party.wins + (champion ? 1 : 0),
      points: party.points + gained,
      best: Math.max(party.best, gained),
      lastAt: new Date(at).toISOString(),
    },
    lastPlayedAt: new Date(at).toISOString(),
    createdAt: profile.createdAt ?? new Date(at).toISOString(),
  };
}

/** 練習データだけを消す（世界ランキングの記録はそのまま） */
export function resetPractice(profile) {
  return { ...profile, practice: defaultPractice() };
}

export function applyPro(profile, on) {
  return { ...profile, pro: Boolean(on) };
}
