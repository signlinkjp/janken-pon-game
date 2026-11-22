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
export const PROFILE_VERSION = 6;

export function monthKey(at = Date.now()) {
  const date = new Date(at);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * 週のキー（月曜はじまり・ISO 8601 の週番号）。週間ランキングの集計に使う。
 * 例: 2026-11-22 → '2026-W47'
 */
export function weekKey(at = Date.now()) {
  const date = new Date(at);
  const day = (date.getDay() + 6) % 7; // 月曜 = 0
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate() - day);
  const thursday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 3);
  const firstThursday = new Date(thursday.getFullYear(), 0, 4);
  const firstDay = (firstThursday.getDay() + 6) % 7;
  const firstMonday = new Date(thursday.getFullYear(), 0, 4 - firstDay);
  const week = 1 + Math.round((monday - firstMonday) / (7 * 24 * 60 * 60 * 1000));
  return `${monday.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function defaultMonthly(at = Date.now()) {
  return { month: monthKey(at), points: 0, matches: 0 };
}

/** 週間ランキング用の「今週ぶん」。週が変わると自動で0に戻る。 */
export function defaultWeekly(at = Date.now()) {
  return { week: weekKey(at), points: 0, matches: 0 };
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
    weekly: defaultWeekly(at),
  };
}

/** 画面の文字サイズ（設定）。CSS の --ts 倍率に対応する。 */
export const TEXT_SCALES = Object.freeze(['standard', 'large', 'xlarge']);

export function normalizeTextScale(value) {
  return TEXT_SCALES.includes(value) ? value : 'standard';
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

/**
 * 手ごとの勝敗（Build 3）。「その手を出したときの勝率」の元データ。
 * 手の回数（handCounts）はパーティーも含むが、こちらは1対1の勝負だけを数える。
 */
export function defaultHandResults() {
  return {};
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
    /* global = 世界ランキング用（PRO の世界対戦だけが加算する）。
       world は国内（同じ国籍どうし）のランキング用の記録。 */
    global: { '5': defaultDivision(at), '3': defaultDivision(at) },
    handCounts: defaultHandCounts(),
    handResults: defaultHandResults(),
    pro: false,
    levelId: 'normal',
    rulesetId: 'standard',
    locale: 'ja',
    sound: true,
    stampsMuted: false,
    textScale: 'standard',
    chantSide: 'self',
    countryLocked: false,
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
  const base = fallback && typeof fallback === 'object' ? fallback : defaultMonthly();
  if (!raw || typeof raw !== 'object') return { ...base };
  const month = typeof raw.month === 'string' ? raw.month : base.month;
  if (month !== base.month) return { month: base.month, points: 0, matches: 0 };
  return {
    month,
    points: safeInt(raw.points, base.points),
    matches: safeInt(raw.matches, base.matches),
  };
}

function sanitizeWeekly(raw, fallback) {
  const base = fallback && typeof fallback === 'object' ? fallback : defaultWeekly();
  if (!raw || typeof raw !== 'object') return { ...base };
  const week = typeof raw.week === 'string' ? raw.week : base.week;
  if (week !== base.week) return { week: base.week, points: 0, matches: 0 };
  return {
    week,
    points: safeInt(raw.points, base.points),
    matches: safeInt(raw.matches, base.matches),
  };
}

function sanitizeDivision(raw, fallback = defaultDivision()) {
  if (!raw || typeof raw !== 'object') {
    return { ...fallback, monthly: { ...fallback.monthly }, weekly: { ...fallback.weekly } };
  }
  return {
    points: safeInt(raw.points, fallback.points),
    matches: safeInt(raw.matches, fallback.matches),
    wins: safeInt(raw.wins, fallback.wins),
    losses: safeInt(raw.losses, fallback.losses),
    ties: safeInt(raw.ties, fallback.ties),
    bestRank: raw.bestRank === undefined ? fallback.bestRank : safeRank(raw.bestRank),
    lastRank: raw.lastRank === undefined ? fallback.lastRank : safeRank(raw.lastRank),
    monthly: sanitizeMonthly(raw.monthly, fallback.monthly),
    weekly: sanitizeWeekly(raw.weekly, fallback.weekly),
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

function sanitizeHandResults(raw) {
  if (!raw || typeof raw !== 'object') return defaultHandResults();
  const out = {};
  for (const [hand, row] of Object.entries(raw)) {
    if (!/^[a-z]+$/.test(hand) || !row || typeof row !== 'object') continue;
    out[hand] = {
      wins: safeInt(row.wins, 0),
      losses: safeInt(row.losses, 0),
      ties: safeInt(row.ties, 0),
    };
  }
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
  /* 国籍: 一度ロックしたら、保存データ側でも勝手に書き換わらない */
  const countryLocked = Boolean(raw.countryLocked);

  // v1 形式（totalPoints / matches / bestRank がトップレベル）からの移行
  const legacyWorld = {
    points: safeInt(raw.totalPoints, 0),
    matches: safeInt(raw.matches, 0),
    bestRank: safeRank(raw.bestRank),
    lastRank: safeRank(raw.lastRank),
  };

  const world = {
    '5': sanitizeDivision(raw.world?.['5'], { ...legacyWorld, wins: 0, losses: 0, ties: 0, monthly: defaultMonthly(), weekly: defaultWeekly() }),
    '3': sanitizeDivision(raw.world?.['3'], defaultDivision()),
  };

  /* 世界ランキング用の記録（Build 2 で追加。古いプロフィールでは 0 から） */
  const global = {
    '5': sanitizeDivision(raw.global?.['5'], defaultDivision()),
    '3': sanitizeDivision(raw.global?.['3'], defaultDivision()),
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
    global,
    handCounts: sanitizeHandCounts(raw.handCounts),
    handResults: sanitizeHandResults(raw.handResults),
    pro: Boolean(raw.pro),
    levelId: typeof raw.levelId === 'string' ? raw.levelId : base.levelId,
    rulesetId: typeof raw.rulesetId === 'string' ? raw.rulesetId : base.rulesetId,
    locale: typeof raw.locale === 'string' && raw.locale.length <= 10 ? raw.locale : base.locale,
    sound: raw.sound === undefined ? base.sound : Boolean(raw.sound),
    stampsMuted: Boolean(raw.stampsMuted),
    textScale: normalizeTextScale(raw.textScale),
    chantSide: raw.chantSide === 'opp' ? 'opp' : 'self',
    countryLocked,
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
      /* 国籍は初回登録後ロック。保存の入口でも、ロック済みの国を差し替えさせない */
      const stored = this.load();
      if (stored.countryLocked && clean.countryCode !== stored.countryCode) {
        clean.countryCode = stored.countryCode;
        clean.countryLocked = true;
      }
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

/** 世界ランキング用（PRO の世界対戦だけが加算する） */
export function globalOf(profile, divisionId = divisionIdOf(profile.rounds)) {
  return profile.global?.[String(divisionId)] ?? defaultDivision();
}

/**
 * ランキングの範囲ごとの記録。scope = 'domestic' | 'world'。
 *   国内 … 同じ国籍のプレイヤー同士の記録（無料でも加算）
 *   世界 … 国籍をまたぐ対戦の記録（PRO のみ）
 */
export function entryFor(profile, divisionId, scope = 'domestic') {
  return scope === 'world' ? globalOf(profile, divisionId) : worldOf(profile, divisionId);
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

/**
 * その手を出したときの勝率（0〜1）。あいこを除いた勝負で数える（直感的な数字）。
 * まだ勝負がついていない手（あいこだけ・未使用）は null。
 */
export function handWinRate(handResults, hand) {
  const row = handResults?.[hand];
  if (!row) return null;
  const wins = safeInt(row.wins, 0);
  const losses = safeInt(row.losses, 0);
  const decided = wins + losses;
  if (decided <= 0) return null;
  return wins / decided;
}

/** 手ごとの勝敗の行（無ければ 0/0/0 の空の行） */
export function handResultOf(handResults, hand) {
  const row = handResults?.[hand];
  return {
    wins: safeInt(row?.wins, 0),
    losses: safeInt(row?.losses, 0),
    ties: safeInt(row?.ties, 0),
  };
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
    handRounds = [],
    ranked = true,
    scope = 'domestic',
    at = Date.now(),
  } = {},
) {
  const gained = safeInt(matchPoints);
  const divisionId = divisionIdOf(rounds);
  /* 国内の対戦は local、世界（PRO）の対戦は global に入れる */
  const bucket = scope === 'world' ? 'global' : 'world';
  const entry = entryFor(profile, divisionId, scope);
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

  /* その手ごとの勝率（Build 3）。1対1の勝負だけを数える（パーティーは入らない） */
  const handResults = { ...(profile.handResults ?? {}) };
  for (const round of Array.isArray(handRounds) ? handRounds : []) {
    const hand = round?.hand;
    const outcome = round?.outcome;
    if (typeof hand !== 'string' || !hand) continue;
    if (outcome !== 'win' && outcome !== 'lose' && outcome !== 'tie') continue;
    const row = { wins: 0, losses: 0, ties: 0, ...(handResults[hand] ?? {}) };
    if (outcome === 'win') row.wins += 1;
    else if (outcome === 'lose') row.losses += 1;
    else row.ties += 1;
    handResults[hand] = row;
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

  const week = weekKey(at);
  const weekly =
    entry.weekly?.week === week
      ? {
          week,
          points: entry.weekly.points + gained,
          matches: entry.weekly.matches + 1,
        }
      : { week, points: gained, matches: 1 };

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
          weekly,
        };

  return {
    ...profile,
    practice,
    handCounts,
    handResults,
    [bucket]: { ...(profile[bucket] ?? {}), [divisionId]: nextEntry },
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

/* ------------------------------------------------------------------
 * プロフィールの編集（Build 2）
 * ------------------------------------------------------------------ */

/** 文字サイズを変える（即時反映は main.js が CSS 変数で行う） */
export function setTextScale(profile, scale) {
  return { ...profile, textScale: normalizeTextScale(scale) };
}

/** かけ声の出どころ（self = 自分の国 / opp = 相手の国） */
export function setChantSide(profile, side) {
  return { ...profile, chantSide: side === 'opp' ? 'opp' : 'self' };
}

/**
 * 国籍の登録。初回だけ国を選べて、その時点でロックする。
 * ロック後は、何を渡されても国籍は変わらない（ニックネームは別で自由）。
 */
export function registerCountry(profile, code, { at = Date.now() } = {}) {
  if (profile.countryLocked) return profile;
  const next = typeof code === 'string' && code.length === 2 ? code.toUpperCase() : profile.countryCode;
  return {
    ...profile,
    countryCode: next,
    countryLocked: true,
    countryLockedAt: new Date(at).toISOString(),
  };
}

/** 初回プレイ時に、いま選んでいる国でロックする（登録の確定） */
export function lockCountry(profile, { at = Date.now() } = {}) {
  if (profile.countryLocked) return profile;
  return { ...profile, countryLocked: true, countryLockedAt: new Date(at).toISOString() };
}

/** 国籍が変えられるか（ロック前だけ true） */
export function canChangeCountry(profile) {
  return !profile?.countryLocked;
}

/** 練習データだけを消す（世界ランキングの記録はそのまま） */
export function resetPractice(profile) {
  return { ...profile, practice: defaultPractice() };
}

export function applyPro(profile, on) {
  return { ...profile, pro: Boolean(on) };
}
