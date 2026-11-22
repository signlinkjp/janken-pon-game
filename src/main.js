/**
 * JANKeN PoN — UI コントローラ（Build 1）
 *
 * core.js（ルール）・countries.js（世界の掛け声）・ranking.js（世界ランキング）
 * ・storage.js（練習データと世界記録）・audio.js（効果音）
 * ・i18n.js（12言語）・pro.js（StoreKit）・online.js（Supabase Realtime）
 * をつないで画面にする。
 *
 * 記録の分け方:
 *   練習データ   … CPU 戦の記録。端末内だけ。リセットできる。ランキングには加算しない。
 *   世界ランキング … 通信対戦の結果だけ。部門（5 / 3）× 指標（総合 / 月別 / 勝率）。
 *                    国内は無料、世界は PRO。
 *   パーティー   … 2〜4人・5回戦。端末内の遊びの記録だけで、どのランキングにも加算しない。
 *   手の率       … 出した手の回数（練習・通信・パーティーすべて）。
 */

import {
  HAND_META,
  HAND_SERIES,
  HAND_COLORS,
  LEVELS,
  ROUND_OPTIONS,
  getRuleset,
  getLevel,
  isLevelUnlocked,
  createMatch,
  playRound,
  matchSummary,
  currentRoundNumber,
  chooseCpuHand,
  resolveTimeout,
  resolveCommit,
  pointsFor,
  rankDelta,
  formatPoints,
  formatRate,
  handRates,
  divisionForRounds,
  divisionLabel,
  ONLINE_TURN_MS,
  PARTY_ROUNDS,
  PARTY_MIN_PLAYERS,
  PARTY_MAX_PLAYERS,
  PARTY_TURN_MS,
  nextChantSide,
  normalizeChantSide,
  pkBoard,
  pkTally,
} from './core.js';
import {
  COUNTRIES,
  countryByCode,
  chantLabel,
  pickOpponent,
  hasCountry,
  DEFAULT_COUNTRY,
} from './countries.js';
import {
  DIVISIONS,
  RANK_METRICS,
  RANK_SCOPES,
  divisionMeta,
  metricMeta,
  scopeMeta,
  leaderboard,
  formatMetric,
  leaderboardWindow,
  pointsToNext,
  rankInDivision,
  totalInDivision,
  MIN_WINRATE_MATCHES,
  isRankedIn,
  matchesToWinRateRank,
} from './ranking.js';
import {
  createProfileStore,
  applyMatch,
  applyParty,
  applyPro,
  resetPractice,
  worldOf,
  entryFor,
  setTextScale,
  setChantSide,
  registerCountry,
  lockCountry,
  canChangeCountry,
  handWinRate,
  handResultOf,
  TEXT_SCALES,
} from './storage.js';
import { createAudioEngine } from './audio.js';
import * as i18n from './i18n.js';
import * as pro from './pro.js';
import * as online from './online.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const params = new URLSearchParams(location.search);
/** ?fast=1 でアニメーション待ちを短縮（自動テスト・スクショ用） */
const SPEED = params.has('fast') ? 0.15 : 1;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms * SPEED)));

const CHANT_MS = 1080;
const AFTER_REVEAL_MS = 1250;
const COUNT_MS = 620;
const STAMP_COOLDOWN_MS = 4000;
const STAMP_VISIBLE_MS = 2400;
const IDLE_WARN_MS = 45000;
const IDLE_HOME_MS = 60000;
const MAX_CONSECUTIVE_TIMEOUTS = 3;
const PARTY_AFTER_ROUND_MS = 1900;

/** 定型スタンプ（自由入力チャットは持たない） */
const STAMPS = Object.freeze([
  { id: 'hello', label: 'よろしく！', icon: '1f44b' },
  { id: 'nice', label: 'ナイス！', icon: '1f44d' },
  { id: 'close', label: 'いい勝負', icon: '1f91d' },
  { id: 'nervous', label: 'ドキドキ…', icon: '1f497' },
  { id: 'haha', label: 'あいこでしょ', icon: '1f605' },
  { id: 'thanks', label: 'ありがとう', icon: '1f64f' },
]);


const store = createProfileStore();
const sound = createAudioEngine({ muted: false });

const app = {
  profile: store.load(),
  mode: 'practice', // practice | online | party
  view: 'home',
  matchKind: 'cpu', // cpu | online
  match: null,
  phase: 'idle', // idle | thinking | chant | waiting | reveal | done
  roundCpu: null,
  pickedHand: null,
  selectedHand: null,
  timedOut: false,
  forcedCpu: [],
  matchHands: [],
  consecutiveTimeouts: 0,
  timer: { raf: 0, ms: 0, start: 0, warned: false },
  rankBefore: null,
  rankAfter: null,
  division: divisionForRounds(5),
  rankView: { division: divisionForRounds(5), metric: 'total', scope: 'domestic' },
  summary: null,
  toastTimer: 0,
  resetArmed: false,
  resetTimer: 0,
  stampCooldownUntil: 0,
  stampCpuCooldownUntil: 0,
  stampTimer: 0,
  lastInput: Date.now(),
  idleWarned: false,
  detailRow: null,
  sheetStack: [],
  matchToken: 0,
  turnMs: 0,
  /* 通信 */
  online: {
    scope: 'domestic',
    rounds: 5,
    session: null,
    client: null,
    net: null,
    peerRows: [],
    netKey: '',
    opponent: null,
    pendingRound: null,
    waitingTimer: 0,
  },
  /* パーティー（Build 3: 国内=無料 / 世界=PRO） */
  party: {
    session: null,
    scope: 'domestic',
    code: null,
    players: [],
    round: 0,
    hands: {},
    points: new Map(),
    history: [],
    standings: [],
    isHost: false,
    phase: 'idle',
    selected: null,
    timer: { raf: 0, ms: 0, start: 0, warned: false },
    startedAt: 0,
  },
  locale: 'ja',
  demoKey: null,
  /* Build 2: かけ声の出どころ（self = 左側の自分 / opp = 右側の相手） */
  chantSide: 'self',
};

app.locale = app.profile.locale;
app.chantSide = normalizeChantSide(app.profile.chantSide);
sound.setMuted(!app.profile.sound);
applyTextScale();

const T = (key, vars = {}) => i18n.t(key, app.locale, vars);
const P = (key) => i18n.prose(key, app.locale);

/* ------------------------------------------------------------------ *\
 * 画面切り替え・トースト
 * ------------------------------------------------------------------ */

function showScreen(name) {
  /* Build 5: プレイ画面を離れるときは、鳴っているかけ声を止める */
  if (name !== 'play') sound.stopVoice();
  app.view = name;
  $$('.screen').forEach((screen) => {
    screen.classList.toggle('is-active', screen.id === `screen-${name}`);
  });
  app.lastInput = Date.now();
  app.idleWarned = false;
}

function toast(message, ms = 1900) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('is-on');
  clearTimeout(app.toastTimer);
  app.toastTimer = setTimeout(() => el.classList.remove('is-on'), ms);
}

function displayName() {
  return app.profile.nickname?.trim() || 'PLAYER';
}

function persist(next) {
  app.profile = store.save(next);
  return app.profile;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

function isPro() {
  return Boolean(app.profile.pro);
}

function countryName(country) {
  return app.locale === 'ja' ? country.nameJa : country.nameEn;
}

/* ------------------------------------------------------------------ *\
 * 文字サイズ（Build 2）
 * ------------------------------------------------------------------ */

/** 設定の文字サイズを html の data-text-size に出す（CSS の --ts が切り替わる） */
function applyTextScale() {
  const scale = TEXT_SCALES.includes(app.profile.textScale) ? app.profile.textScale : 'standard';
  document.documentElement.dataset.textSize = scale;
}

function changeTextScale(scale) {
  if (!TEXT_SCALES.includes(scale)) return;
  persist(setTextScale(app.profile, scale));
  applyTextScale();
  renderSettings();
  sound.play('select');
  toast(T('toast.textSize'), 1200);
}

/* ------------------------------------------------------------------ *\
 * 手の率
 * ------------------------------------------------------------------ */

function playerHandRates(series = HAND_SERIES) {
  const rates = handRates(app.profile.handCounts, series);
  return Object.fromEntries(rates.map((entry) => [entry.hand, entry.rate]));
}

function stackHtml(counts, series) {
  const rates = handRates(counts, series);
  const total = rates.reduce((sum, entry) => sum + entry.count, 0);
  return `<div class="hb">${rates
    .map(
      (entry) =>
        `<i class="hb__seg" style="width:${total ? (entry.count / total) * 100 : 0}%;background:${HAND_COLORS[entry.hand] ?? '#8e9ad0'}"></i>`,
    )
    .join('')}</div>`;
}

/**
 * 「その手を出したときの勝率」の1行（あいこを除いた勝負で数える）。
 * データが無い（相手のプロフィールなど）ときは空文字。
 */
function handWinLine(results, hand) {
  if (!results) return '';
  const row = handResultOf(results, hand);
  const rate = handWinRate(results, hand);
  const decided = row.wins + row.losses;
  if (rate == null) {
    const label = decided === 0 && row.ties > 0 ? `あいこ${row.ties}` : 'まだ勝負なし';
    return `<span class="handrow__win is-empty">勝率 —（${label}）</span>`;
  }
  const ties = row.ties ? `・あいこ${row.ties}` : '';
  return `<span class="handrow__win">勝率 <b>${formatRate(rate, 0)}</b>（${row.wins}勝${row.losses}敗${ties}）</span>`;
}

function handRowsHtml(counts, series, { results = null } = {}) {
  const rates = handRates(counts, series);
  return rates
    .map(
      (entry) => `<div class="handrow">
        <img src="${HAND_META[entry.hand].asset}" alt="${HAND_META[entry.hand].labelJa}" />
        <span class="handrow__name">${HAND_META[entry.hand].labelJa}</span>
        <span class="handrow__bar"><i style="width:${(entry.rate * 100).toFixed(1)}%;background:${HAND_COLORS[entry.hand] ?? '#8e9ad0'}"></i></span>
        <b>${formatRate(entry.rate, 0)}</b>
        <em>${entry.count}回</em>
        ${handWinLine(results, entry.hand)}
      </div>`,
    )
    .join('');
}

function miniRateHtml(rates) {
  if (!rates) return '';
  const rock = rates.rock ?? 0;
  const scissors = rates.scissors ?? 0;
  const paper = rates.paper ?? 0;
  return `<span class="mini-rate" title="グー${formatRate(rock, 0)} / チョキ${formatRate(scissors, 0)} / パー${formatRate(paper, 0)}">
    <i style="width:${rock * 100}%;background:${HAND_COLORS.rock}"></i>
    <i style="width:${scissors * 100}%;background:${HAND_COLORS.scissors}"></i>
    <i style="width:${paper * 100}%;background:${HAND_COLORS.paper}"></i>
  </span>`;
}

/* ------------------------------------------------------------------ *\
 * 通信の準備（Supabase Realtime）
 * ------------------------------------------------------------------ */

function realtimeClient() {
  if (app.online.client) return app.online.client;
  if (!online.onlineConfigured()) return null;
  const config = online.onlineConfig();
  app.online.client = new online.RealtimeClient({ url: config.url, key: config.key });
  setInterval(() => {
    if (!app.online.client) return;
    if (app.view === 'play' || app.view === 'party' || !$('#overlay').hidden) app.online.client.checkAlive();
  }, 1000);
  return app.online.client;
}

/** 自分の識別子（通信していないデモでは固定のキー） */
function selfKey() {
  return app.online.client?.clientId ?? app.demoKey ?? 'you';
}

function onlineSession() {
  const client = realtimeClient();
  if (!client) return null;
  if (app.online.session) return app.online.session;
  app.online.session = new online.OnlineSession({
    client,
    onEvent: handleOnlineEvent,
  });
  return app.online.session;
}

function ensureRankNet({ division, scope }) {
  const key = `${division}:${scope}`;
  if (app.online.netKey === key) return;
  const client = realtimeClient();
  if (!client) return;
  app.online.netKey = key;
  if (!app.online.net) {
    app.online.net = new online.RankingNet({
      client,
      onRows: (rows) => {
        app.online.peerRows = rows;
        if ($('#sheet-ranking').hidden === false) renderRanking();
      },
    });
  }
  app.online.net.open({ division, scope, row: netRowFor(division, scope) });
}

function netRowFor(divisionId, scope) {
  /* 国内は world、世界（PRO）は global の記録を送る */
  const entry = entryFor(app.profile, divisionId, scope);
  return {
    id: selfKey(),
    nickname: displayName(),
    countryCode: app.profile.countryCode,
    points: entry.points,
    monthlyPoints: entry.monthly?.points ?? 0,
    weeklyPoints: entry.weekly?.points ?? 0,
    matches: entry.matches,
    wins: entry.wins,
    losses: entry.losses,
    ties: entry.ties,
    winRate: entry.matches > 0 ? entry.wins / entry.matches : 0,
    handRates: playerHandRates(),
    pro: isPro(),
    updatedAt: Date.now(),
    scope,
  };
}

function peerRowsFor(scope) {
  const rows = app.online.peerRows ?? [];
  if (scope !== 'domestic') return rows;
  return rows.filter((row) => row.countryCode === app.profile.countryCode);
}

/* ------------------------------------------------------------------ *\
 * HOME
 * ------------------------------------------------------------------ */

function renderHome() {
  const profile = app.profile;
  const country = countryByCode(profile.countryCode);
  const division = divisionForRounds(profile.rounds);
  const scope = isPro() ? 'world' : 'domestic';
  const world = entryFor(profile, division, scope);

  $('#home-flag img').src = country.flag;
  $('#home-country-name').textContent = countryName(country);
  const countryCta = $('#btn-country .country-btn__cta');
  if (countryCta) {
    countryCta.textContent = app.profile.countryLocked ? `🔒 ${T('settings.country')}` : '国をかえる';
  }
  if ($('#nickname').value !== profile.nickname) $('#nickname').value = profile.nickname;
  $('#home-points').textContent = formatPoints(world.points);
  const scopeLabel = isPro() ? T('rank.world') : T('rank.domestic');
  $('#home-rank').textContent = `${scopeLabel} ${rankInDivision(world.points, division)}位`;
  document.body.classList.toggle('is-pro', isPro());

  renderModes();
  renderRounds();
  renderLevels();
  renderScope();
  renderPractice();
  renderSoundButton();
  renderTicker();
  renderDivisionStrip();
  renderCta();
}

function renderModes() {
  $$('#mode-cards .mode-card').forEach((card) => {
    const mode = card.dataset.mode;
    card.classList.toggle('is-active', app.mode === mode);
    card.classList.remove('is-locked');
    card.setAttribute('aria-pressed', String(app.mode === mode));
  });
  $('#panel-practice').hidden = app.mode !== 'practice';
  $('#panel-online').hidden = app.mode !== 'online';
  $('#panel-party').hidden = app.mode !== 'party';
  $$('[data-pro-only]').forEach((el) => {
    el.hidden = isPro();
  });
}

function renderCta() {
  const label = $('#play-label');
  const sub = $('#play-sub');
  if (app.mode === 'practice') {
    const level = getLevel(app.profile.levelId);
    label.textContent = T('home.play', { n: app.profile.rounds });
    sub.textContent = `${level.label} ・ ${(level.thinkingTimeMs / 1000).toFixed(1)}s ・ CLASSIC`;
  } else if (app.mode === 'online') {
    const scope = app.online.scope === 'world' ? T('online.world') : T('online.domestic');
    label.textContent = T('online.quick');
    sub.textContent = `${scope} ・ ${app.online.rounds}${T('home.rounds')} ・ 5.0s`;
  } else {
    label.textContent = T('party.create');
    sub.textContent = `${T(`online.${app.party.scope}`)} ・ ${PARTY_MIN_PLAYERS}–${PARTY_MAX_PLAYERS} ・ ${PARTY_ROUNDS}回戦 ・ 5.0s`;
  }
}

function setMode(mode) {
  /* Build 3: パーティーは国内（同じ国籍）なら無料。世界だけが PRO */
  app.mode = mode;
  sound.play('select');
  renderHome();
}

function renderDivisionStrip() {
  const strip = $('#division-strip');
  if (!strip) return;
  const current = divisionForRounds(app.profile.rounds);
  for (const division of DIVISIONS) {
    const entry = worldOf(app.profile, division.id);
    const rank = rankInDivision(entry.points, division.id);
    $(`#strip-rank-${division.id}`).textContent = `${rank}位`;
    $(`#strip-pts-${division.id}`).textContent = `${formatPoints(entry.points)}pt`;
    const item = $(`.ds-item[data-division="${division.id}"]`);
    item.classList.toggle('is-active', division.id === current);
    item.classList.toggle('is-champion', rank === 1);
  }
  const championCount = DIVISIONS.filter((division) => rankInDivision(worldOf(app.profile, division.id).points, division.id) === 1).length;
  $('#division-goal').textContent =
    championCount === 2 ? '2冠達成！' : championCount === 1 ? '2冠まであと1部門' : T('rank.twoCrowns');
}

function renderTicker() {
  const track = $('#ticker-track');
  if (!track) return;
  const items = COUNTRIES.map(
    (country) => `<span class="world-ticker__item"><img src="${country.flag}" alt="" />${escapeHtml(chantLabel(country))}</span>`,
  ).join('');
  track.innerHTML = items + items;
}

function renderRounds() {
  const wrap = $('#rounds-seg');
  wrap.innerHTML = '';
  for (const rounds of ROUND_OPTIONS) {
    const active = Number(app.profile.rounds) === rounds;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = active ? 'is-active' : '';
    button.dataset.rounds = String(rounds);
    button.setAttribute('aria-pressed', String(active));
    button.innerHTML = `<span>${rounds}${T('home.rounds')}</span><em>${rounds === 5 ? 'STANDARD' : 'SPEED'}</em>`;
    button.addEventListener('click', () => {
      if (Number(app.profile.rounds) === rounds) return;
      sound.play('select');
      persist({ ...app.profile, rounds });
      renderHome();
    });
    wrap.appendChild(button);
  }
  const mini = $('#online-rounds-seg');
  if (mini) {
    mini.innerHTML = '';
    for (const rounds of ROUND_OPTIONS) {
      const active = app.online.rounds === rounds;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = active ? 'is-active' : '';
      button.dataset.rounds = String(rounds);
      button.textContent = `${rounds}${T('home.rounds')}`;
      button.addEventListener('click', () => {
        app.online.rounds = rounds;
        sound.play('click');
        renderHome();
        if ($('#sheet-online').hidden === false) renderOnlineSheet();
      });
      mini.appendChild(button);
    }
  }
}

function renderLevels() {
  const wrap = $('#level-row');
  wrap.innerHTML = '';
  for (const level of Object.values(LEVELS)) {
    const active = app.profile.levelId === level.id;
    const unlocked = isLevelUnlocked(level.id, isPro());
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `level${active ? ' is-active' : ''}${unlocked ? '' : ' is-locked'}`;
    button.dataset.level = level.id;
    button.setAttribute('aria-pressed', String(active));
    button.innerHTML = `
      <span class="level__name">${T(`level.${level.id}`)}</span>
      <span class="level__time">${(level.thinkingTimeMs / 1000).toFixed(1)}s</span>
      ${unlocked ? '' : '<span class="level__lock"><img src="assets/icons/1f512.svg" alt="PRO" /></span>'}
    `;
    button.addEventListener('click', () => {
      if (!isLevelUnlocked(level.id, isPro())) {
        sound.play('locked');
        openSheet('pro');
        toast('MASTER は JANKeN PoN PRO で解放');
        return;
      }
      sound.play('select');
      persist({ ...app.profile, levelId: level.id });
      renderHome();
    });
    wrap.appendChild(button);
  }
}

function renderScope() {
  for (const wrap of [$('#scope-seg'), $('#online-scope-seg')]) {
    if (!wrap) continue;
    wrap.innerHTML = '';
    for (const scope of RANK_SCOPES) {
      const active = app.online.scope === scope.id;
      const locked = scope.id === 'world' && !isPro();
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `${active ? 'is-active' : ''}${locked ? ' is-locked' : ''}`;
      button.dataset.scope = scope.id;
      button.innerHTML = `${scope.id === 'world' ? '🌏' : '🏠'} ${scope.id === 'world' ? T('online.world') : T('online.domestic')}${locked ? ' <em>PRO</em>' : ''}`;
      button.addEventListener('click', () => {
        if (locked) {
          sound.play('locked');
          openSheet('pro');
          toast(T('online.proWorld'));
          return;
        }
        app.online.scope = scope.id;
        sound.play('click');
        renderHome();
        if ($('#sheet-online').hidden === false) renderOnlineSheet();
      });
      wrap.appendChild(button);
    }
  }
  const note = $('#online-panel-note');
  if (note) {
    note.textContent = app.online.scope === 'world'
      ? '世界の通信対戦は PRO。1手5秒固定。'
      : '国内ランキングは無料。1手5秒固定。';
  }
  const modeNote = $('#online-mode-note');
  if (modeNote) modeNote.textContent = T(app.online.scope === 'world' ? 'mode.onlineNoteWorld' : 'mode.onlineNote');
}

function practiceLine(practice) {
  if (!practice || practice.matches <= 0) return T('home.noData');
  const parts = [`${practice.matches}試合`, `${practice.wins}勝 ${practice.losses}敗`];
  if (practice.ties > 0) parts.push(`${practice.ties}分`);
  return parts.join(' ・ ');
}

function renderPractice() {
  const practice = app.profile.practice;
  $('#practice-stats').textContent = practiceLine(practice);
  $('#practice-points').textContent = `${formatPoints(practice.points)} pt`;
  const button = $('#btn-practice-reset');
  button.textContent = app.resetArmed ? T('home.resetArmed') : T('home.reset');
  button.classList.toggle('is-armed', app.resetArmed);
  button.disabled = practice.matches === 0;
}

function armPracticeReset() {
  if (app.profile.practice.matches === 0) {
    toast(T('home.noData'), 1400);
    return;
  }
  if (!app.resetArmed) {
    app.resetArmed = true;
    renderPractice();
    clearTimeout(app.resetTimer);
    app.resetTimer = setTimeout(() => {
      app.resetArmed = false;
      renderPractice();
    }, 3200);
    return;
  }
  app.resetArmed = false;
  clearTimeout(app.resetTimer);
  persist(resetPractice(app.profile));
  renderPractice();
  renderStats();
  sound.play('click');
  toast(T('toast.resetDone'));
}

/* Build 6: サウンド／かけ声の ON/OFF。設定の行とプレイ中のボタンは同じ値を見る */
function soundAriaLabel(on) {
  return `${T('settings.sound')}: ${on ? T('misc.on') : T('misc.off')}`;
}

/** プレイ中（1対1・パーティー）のトグルを、いまのサウンド設定に合わせる */
function paintSoundToggles() {
  const on = Boolean(app.profile.sound);
  const label = on ? T('misc.on') : T('misc.off');
  const icon = on ? 'assets/icons/1f50a.svg' : 'assets/icons/1f507.svg';
  const aria = soundAriaLabel(on);
  for (const [buttonId, iconId, labelId] of [
    ['#btn-play-sound', '#play-sound-icon', '#play-sound-label'],
    ['#btn-party-sound', '#party-sound-icon', '#party-sound-label'],
  ]) {
    const button = $(buttonId);
    if (!button) continue;
    button.classList.toggle('is-muted', !on);
    button.setAttribute('aria-pressed', String(on));
    button.setAttribute('aria-label', aria);
    const image = $(iconId);
    if (image) image.src = icon;
    const text = $(labelId);
    if (text) text.textContent = label;
  }
}

/**
 * サウンド ON/OFF を切り替える（設定・プレイ中・パーティーのどこから押しても同じ）。
 * OFF にした瞬間に鳴っている音（かけ声を含む）は止まり、ON に戻すとすぐ鳴る。
 */
function toggleSound({ announce = true } = {}) {
  const soundOn = !app.profile.sound;
  persist({ ...app.profile, sound: soundOn });
  /* 実際の音量はここで切り替える（鳴っている途中の音も止まる） */
  sound.setMuted(!soundOn);
  if (soundOn) {
    sound.unlock();
    sound.play('select');
  }
  renderSoundButton();
  renderSettings();
  if (announce) toast(`${T('settings.sound')} ${soundOn ? T('misc.on') : T('misc.off')}`, 1200);
  return soundOn;
}

function renderSoundButton() {
  const button = $('#btn-sound');
  button.classList.toggle('is-muted', !app.profile.sound);
  button.setAttribute('aria-label', soundAriaLabel(app.profile.sound));
  button.setAttribute('aria-pressed', String(Boolean(app.profile.sound)));
  const state = $('#set-sound-state');
  if (state) state.textContent = app.profile.sound ? T('misc.on') : T('misc.off');
  paintSoundToggles();
  renderBell();
}

function renderBell() {
  const muted = app.profile.stampsMuted;
  $('#bell-icon').src = muted ? 'assets/icons/1f515.svg' : 'assets/icons/1f514.svg';
  $('#btn-bell').classList.toggle('is-muted', muted);
  $('#btn-bell').setAttribute('aria-label', muted ? 'スタンプ通知をオンにする' : 'スタンプ通知をミュートする');
  const state = $('#set-stamps-state');
  if (state) state.textContent = muted ? T('misc.off') : T('misc.on');
}

/* ------------------------------------------------------------------ *\
 * 称号
 * ------------------------------------------------------------------ */

function divisionStanding(profile, divisionId) {
  const points = worldOf(profile, divisionId).points;
  return { divisionId, points, rank: rankInDivision(points, divisionId) };
}

function standingList(profile = app.profile) {
  return DIVISIONS.map((division) => divisionStanding(profile, division.id)).map((standing) => ({
    ...standing,
    champion: standing.rank === 1,
  }));
}

function titlesHtml() {
  const champions = standingList().filter((standing) => standing.champion);
  if (!champions.length) return '';
  const chips = champions
    .map((standing) => `<span class="title-chip"><img src="assets/icons/1f451.svg" alt="" />${divisionMeta(standing.divisionId).trophy}</span>`)
    .join('');
  return chips + (champions.length === 2 ? '<span class="title-chip title-chip--double">2冠</span>' : '');
}

/* ------------------------------------------------------------------ *\
 * PLAY（1対1: CPU / 通信）
 * ------------------------------------------------------------------ */

function setTint(country) {
  $('#screen-play').style.setProperty('--tint', country.tint);
  $('#opponent').style.setProperty('--tint', country.tint);
}

function renderPlayChrome() {
  const match = app.match;
  const set = getRuleset(match.rulesetId);
  const opponent = countryByCode(match.opponent?.code);
  const me = countryByCode(app.profile.countryCode);
  const onlineMatch = app.matchKind === 'online';

  setTint(opponent);
  $('#opp-flag img').src = opponent.flag;
  $('#opp-name').textContent = onlineMatch
    ? (app.online.opponent?.nickname || countryName(opponent))
    : countryName(opponent);
  const level = getLevel(match.levelId);
  $('#opp-level').textContent = onlineMatch
    ? `ONLINE ・ 5.0s`
    : `CPU ${level.label} ・ ${(level.thinkingTimeMs / 1000).toFixed(1)}s`;
  renderChant();
  $('#cpu-flag img').src = opponent.flag;
  $('#you-flag img').src = me.flag;
  $('#cpu-label').textContent = onlineMatch ? 'OPPONENT' : 'CPU';

  $('#legend').innerHTML = set.hands
    .map(
      (hand) => `<span class="legend__item">
        <img src="${HAND_META[hand].asset}" alt="${HAND_META[hand].labelJa}" />
        <span>${HAND_META[hand].labelJa}</span><b>${pointsFor(hand, set.id)}pt</b>
      </span>`,
    )
    .join('');

  const handbar = $('#handbar');
  handbar.innerHTML = '';
  set.hands.forEach((hand, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'handbtn';
    button.dataset.hand = hand;
    button.innerHTML = `
      <span class="handbtn__key">${index + 1}</span>
      <img src="${HAND_META[hand].asset}" alt="${HAND_META[hand].labelJa}" />
      <span class="handbtn__name">${HAND_META[hand].labelJa}</span>
      <span class="handbtn__pts">${pointsFor(hand, set.id)}pt</span>
    `;
    button.addEventListener('click', () => selectHand(hand));
    handbar.appendChild(button);
  });

  renderPk();

  renderPips();
  renderBell();
  paintSoundToggles();
  renderStampGrid();
  $('#play-points').textContent = '0';
  $('#play-cpu').textContent = onlineMatch ? `${app.online.opponent?.nickname ?? 'OPP'} 0` : 'CPU 0';
  $('#stamp-pop').hidden = true;
  $('#timer-num').textContent = ((onlineMatch ? ONLINE_TURN_MS : level.thinkingTimeMs) / 1000).toFixed(1);
}

function renderPips() {
  const match = app.match;
  const wrap = $('#pips');
  wrap.innerHTML = '';
  for (let i = 0; i < match.rounds; i += 1) {
    const round = match.history[i];
    const pip = document.createElement('span');
    pip.className = 'pip';
    if (round) pip.classList.add(`is-${round.outcome}`);
    else if (i === match.roundIndex && app.phase === 'thinking') pip.classList.add('is-current');
    wrap.appendChild(pip);
  }
  $('#play-points').textContent = formatPoints(match.playerPoints);
  $('#play-cpu').textContent = app.matchKind === 'online'
    ? `${app.online.opponent?.nickname ?? 'OPP'} ${formatPoints(match.cpuPoints)}`
    : `CPU ${formatPoints(match.cpuPoints)}`;
  $('#arena-round').textContent = `R${currentRoundNumber(match)}/${match.rounds}`;
  renderPk();
}

/* ------------------------------------------------------------------ *\
 * かけ声（自分の国 ⇄ 相手の国）— Build 2
 * ------------------------------------------------------------------ */

/** いま掛け声を出している国（左の自分が既定） */
function chantCountry() {
  const me = countryByCode(app.profile.countryCode);
  const opponent = countryByCode(app.match?.opponent?.code);
  return app.chantSide === 'opp' ? opponent : me;
}

function chantSideName() {
  return app.chantSide === 'opp' ? T('play.chantOpp') : T('play.chantSelf');
}

/** バナー（小さいかけ声）と中央の大きいかけ声を、いまの出どころに合わせる */
function renderChant() {
  const country = chantCountry();
  const words = country.chantParts
    .map((part) => `<span class="chant__w">${escapeHtml(part)}</span>`)
    .join('');
  const banner = $('#opp-chant');
  if (banner) {
    banner.innerHTML = `<span class="chant-src"><img src="${country.flag}" alt="" /></span>${words}`;
    banner.classList.toggle('is-opp', app.chantSide === 'opp');
  }
  const big = $('#big-chant');
  if (big) big.innerHTML = words;
  const toggle = $('#btn-chant-toggle');
  if (toggle) {
    toggle.classList.toggle('is-opp', app.chantSide === 'opp');
    toggle.setAttribute('aria-pressed', String(app.chantSide === 'opp'));
    toggle.setAttribute(
      'aria-label',
      `${T('play.chantToggle')}（いま: ${chantSideName()}）`,
    );
  }
}

/** かけ声切替ボタン。オフラインのCPU戦でも通信対戦でも同じ */
function toggleChantSide() {
  app.chantSide = nextChantSide(app.chantSide);
  persist(setChantSide(app.profile, app.chantSide));
  renderChant();
  sound.play('click');
  toast(`${chantSideName()}: ${countryName(chantCountry())}`, 1500);
}

/* ------------------------------------------------------------------ *\
 * PK戦風の履歴ボード — Build 2
 * ------------------------------------------------------------------ */

/**
 * 出した手の履歴を、サッカーのPK戦のように並べる。
 * 左が自分・右が相手、右上の記号が ○勝 / ×負 / △引分。
 */
function renderPk() {
  const cells = $('#pks-cells');
  if (!cells) return;
  if (!app.match) {
    cells.innerHTML = '';
    return;
  }
  const board = pkBoard(app.match.history, app.match.rounds);
  const current = app.match.roundIndex + 1;
  cells.innerHTML = board
    .map((cell) => {
      const state = cell.done
        ? `is-${cell.outcome}`
        : cell.index === current
          ? 'is-pending is-current is-your-turn'
          : 'is-pending';
      const youHand = cell.playerHand
        ? `<img src="${HAND_META[cell.playerHand].asset}" alt="" />`
        : '<span class="pk__q">?</span>';
      const oppHand = cell.cpuHand
        ? `<img src="${HAND_META[cell.cpuHand].asset}" alt="" />`
        : '<span class="pk__q">?</span>';
      return `<div class="pk ${state}" data-round="${cell.index}" aria-label="R${cell.index} ${cell.mark}">
        <span class="pk__no">R${cell.index}</span>
        <span class="pk__mark">${cell.mark}</span>
        <span class="pk__hands">${youHand}<span class="pk__vs">v</span>${oppHand}</span>
      </div>`;
    })
    .join('');
  const tally = pkTally(app.match.history);
  const tallyEl = $('#pks-tally');
  if (tallyEl) tallyEl.textContent = `○${tally.wins} ×${tally.losses} △${tally.ties}`;
}

function resetArena() {
  /* Build 5: 次のラウンドに入る前に、前のラウンドの声を止める */
  sound.stopVoice();
  $('#cpu-pod').classList.remove('is-revealed');
  $('#you-pod').classList.remove('is-revealed');
  const verdict = $('#verdict');
  verdict.classList.remove('is-on', 'is-win', 'is-lose', 'is-tie');
  $('#floatpts').classList.remove('is-on');
  $('#screen-play').classList.remove('flash-win', 'flash-lose');
  $('#timer').classList.remove('is-urgent', 'is-timeup');
  $('#timer-hint').textContent = T('play.choose');
  $$('.chant__w').forEach((el) => el.classList.remove('is-active'));
  $('#play-chant').classList.remove('is-decided');
  const handbar = $('#handbar');
  handbar.classList.remove('is-locked');
  $$('.handbtn', handbar).forEach((button) => {
    button.classList.remove('is-picked', 'is-dim');
    button.setAttribute('aria-pressed', 'false');
  });
  $('#timer-fill').style.width = '100%';
}
function makeRng(seed) {
  let state = Number(seed) >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
}

/** CPU 練習のマッチ */
function startMatch({
  levelId = app.profile.levelId,
  rounds = app.profile.rounds,
  opponentCode = null,
  seed = null,
} = {}) {
  const level = getLevel(levelId);
  const division = divisionForRounds(rounds);
  const opponent = opponentCode
    ? countryByCode(opponentCode)
    : pickOpponent({ exclude: app.profile.countryCode, rng: seed == null ? Math.random : makeRng(seed) });

  /* 初回プレイで国籍を登録（以後は変更不可） */
  if (!app.profile.countryLocked) persist(lockCountry(app.profile));

  app.matchToken += 1;
  app.matchKind = 'cpu';
  app.turnMs = level.thinkingTimeMs;
  app.match = createMatch({
    rulesetId: 'standard',
    levelId,
    rounds,
    opponent: { code: opponent.code, nameJa: opponent.nameJa },
    startedAt: new Date().toISOString(),
  });
  app.phase = 'idle';
  app.pickedHand = null;
  app.timedOut = false;
  app.matchHands = [];
  app.consecutiveTimeouts = 0;
  app.division = division;
  app.rankBefore = null;
  app.rankAfter = null;
  app.summary = null;
  app.online.pendingRound = null;
  app.rng = seed == null ? Math.random : makeRng(seed);
  app.level = level;
  app.stampCpuCooldownUntil = 0;

  renderPlayChrome();
  showScreen('play');
  sound.play('whoosh');
  sound.preloadVoice([app.profile.countryCode, opponent.code]);
  beginRound();
  setTimeout(() => receiveStamp('hello'), 700);
}

/** 通信対戦のマッチ（相手が決まったあと） */
function startOnlineMatch(opponent) {
  const rounds = app.online.rounds;
  const country = countryByCode(opponent?.countryCode ?? app.profile.countryCode);
  if (!app.profile.countryLocked) persist(lockCountry(app.profile));
  app.matchToken += 1;
  app.matchKind = 'online';
  app.turnMs = ONLINE_TURN_MS;
  app.online.opponent = opponent;
  app.online.pendingRound = null;
  app.match = createMatch({
    rulesetId: 'standard',
    levelId: 'normal',
    rounds,
    opponent: { code: country.code, nameJa: country.nameJa },
    startedAt: new Date().toISOString(),
  });
  app.phase = 'idle';
  app.pickedHand = null;
  app.timedOut = false;
  app.matchHands = [];
  app.consecutiveTimeouts = 0;
  app.division = divisionForRounds(rounds);
  app.rankBefore = rankInDivision(entryFor(app.profile, app.division, app.online.scope).points, app.division);
  app.rankAfter = null;
  app.summary = null;
  app.stampCpuCooldownUntil = 0;
  closeSheet();
  renderPlayChrome();
  showScreen('play');
  sound.play('whoosh');
  sound.preloadVoice([app.profile.countryCode, country.code]);
  beginRound();
}

function beginRound() {
  const match = app.match;
  if (!match || match.finished) return;
  if (app.consecutiveTimeouts >= MAX_CONSECUTIVE_TIMEOUTS) {
    abortMatch('放置が続いたため、マッチを終了しました（記録は残りません）');
    return;
  }
  app.phase = 'thinking';
  app.pickedHand = null;
  app.selectedHand = null;
  app.timedOut = false;
  app.roundCpu = app.matchKind === 'online'
    ? null
    : (app.forcedCpu.length
      ? app.forcedCpu.shift()
      : chooseCpuHand({
          levelId: match.levelId,
          history: match.history,
          rulesetId: match.rulesetId,
          rng: app.rng ?? Math.random,
        }));

  resetArena();
  renderPips();
  renderLockButton();
  startTimer(app.turnMs);
}

function startTimer(ms) {
  const start = performance.now();
  app.timer = { raf: 0, ms, start, warned: false };
  const step = (now) => {
    if (app.phase !== 'thinking') return;
    const remain = Math.max(0, ms - (now - start));
    const ratio = ms > 0 ? remain / ms : 0;
    $('#timer-fill').style.width = `${ratio * 100}%`;
    $('#timer-num').textContent = (remain / 1000).toFixed(1);
    const urgent = remain <= 1200;
    $('#timer').classList.toggle('is-urgent', urgent);
    if (urgent && !app.timer.warned) {
      app.timer.warned = true;
      sound.play('urgent');
    }
    if (remain <= 0) {
      handleTimeout();
      return;
    }
    app.timer.raf = requestAnimationFrame(step);
  };
  app.timer.raf = requestAnimationFrame(step);
}

function stopTimer() {
  if (app.timer.raf) cancelAnimationFrame(app.timer.raf);
  app.timer.raf = 0;
}

function handleTimeout() {
  if (app.phase !== 'thinking') return;
  /* 5秒（CPU練習はレベルごとの秒数）の締切。最後に選んでいた手があればそれで確定。 */
  if (!app.selectedHand) {
    $('#timer').classList.add('is-timeup');
    $('#timer-hint').textContent = T('play.timeup');
  }
  commitRound({ timedOut: !app.selectedHand });
}

/**
 * 手をタップしたとき（Build 2）。
 * ここでは「選択中」のハイライトだけを付け、確定・送信・公開はしない。
 * 締切（カウントの 0）まで、何度でも別の手に選び直せる。
 */
function selectHand(hand) {
  if (app.phase !== 'thinking') return;
  if (!getRuleset('standard').hands.includes(hand)) return;
  app.selectedHand = hand;
  $$('.handbtn').forEach((button) => {
    button.classList.toggle('is-picked', button.dataset.hand === hand);
    button.classList.remove('is-dim');
    button.setAttribute('aria-pressed', String(button.dataset.hand === hand));
  });
  $('#timer-hint').textContent = T('play.selected');
  renderLockButton();
  sound.play('click');
}

/**
 * 「これで決定（ロック）」ボタン（Build 3）。
 * 手を選んでいるあいだだけ出し、押した瞬間に確定して「ぽん！」へ進む。
 * 押さなければ、従来どおり締切まで何度でも選び直せる。
 */
function renderLockButton() {
  const playButton = $('#btn-lock');
  const partyButton = $('#btn-party-lock');
  const playHand = app.view === 'play' && app.phase === 'thinking' ? app.selectedHand : null;
  const partyHand = app.view === 'party' && app.party.phase === 'thinking' ? app.party.selected : null;
  if (playButton) {
    playButton.hidden = !playHand;
    const label = $('#lock-hand');
    if (label) label.textContent = playHand ? HAND_META[playHand].labelJa : '';
  }
  if (partyButton) {
    partyButton.hidden = !partyHand;
    const label = $('#party-lock-hand');
    if (label) label.textContent = partyHand ? HAND_META[partyHand].labelJa : '';
  }
}

/** かけ声の最後の拍で、自分と相手の手を同時に開く */
function openPods(cpuHand) {
  /* 前に始めた試合のかけ声が残っていて、もう次に移っているときは何も開かない
     （開始直後に古いかけ声の最後の拍が来ても落ちないように・Build 7） */
  if (!HAND_META[app.pickedHand] || !HAND_META[cpuHand]) return;
  $('#you-hand-img').src = HAND_META[app.pickedHand].asset;
  $('#you-pod').classList.add('is-revealed');
  $('#cpu-hand-img').src = HAND_META[cpuHand].asset;
  $('#cpu-pod').classList.add('is-revealed');
  sound.play('reveal');
}

/**
 * 締切の確定（Build 2）。
 * 最後に選んでいた手（未選択ならランダム）を確定し、通信対戦ではここで初めて相手に送る。
 * かけ声は確定後。相手の手が届いてから、かけ声の「ぽん！」で両方の手が開く。
 */
async function commitRound({ timedOut = false } = {}) {
  if (app.phase !== 'thinking') return;
  const { hand, timedOut: resolvedTimeout } = resolveCommit(app.selectedHand, {
    rulesetId: 'standard',
    rng: app.rng ?? Math.random,
  });
  const isTimeout = Boolean(timedOut || resolvedTimeout);
  stopTimer();
  app.phase = 'chant';
  /* Build 5: 決定したら、それまで鳴っていた声を止めてから「ぽん！」へ */
  sound.stopVoice();
  app.pickedHand = hand;
  app.timedOut = isTimeout;
  renderLockButton();
  app.consecutiveTimeouts = isTimeout ? app.consecutiveTimeouts + 1 : 0;
  $('#stamp-pop').hidden = true;

  if (app.matchKind === 'online' && app.online.session) {
    /* 確定前に送らない（相手の画面に中間の選択を見せない） */
    app.online.session.pick(app.match.roundIndex, hand, { timeout: isTimeout });
  }

  $('#handbar').classList.add('is-locked');
  $$('.handbtn').forEach((button) => {
    button.classList.toggle('is-picked', button.dataset.hand === hand);
    button.classList.toggle('is-dim', button.dataset.hand !== hand);
  });
  $('#timer-fill').style.width = '0%';
  $('#timer-num').textContent = '0.0';
  $('#timer-hint').textContent = isTimeout ? T('play.timeup') : T('play.seeno');

  const token = app.matchToken;

  if (app.matchKind === 'online') {
    /* 相手の手がもう届いていれば、すぐかけ声へ。まだなら待つ（お互いに見せない） */
    const pending = app.online.pendingRound;
    if (pending && pending.round === app.match.roundIndex) {
      app.online.pendingRound = null;
      await chantAndReveal(pending.hands.opp, token);
    } else {
      app.phase = 'waiting';
      $('#timer-hint').textContent = T('play.waiting');
      $('#timer-num').textContent = '—';
    }
    return;
  }

  await chantAndReveal(app.roundCpu, token);
}

/** かけ声 → 最後の拍で両方の手が開く → 勝敗 */
async function chantAndReveal(cpuHand, token = app.matchToken) {
  if (!HAND_META[cpuHand]) return;
  /* 開く手をここで固定する。相手の手が締切と同時に届くと、revealRound が
     読む app.roundCpu はまだ空（pending として持っただけ）なので、
     引数で渡さないと「cpu hand null」で止まる（Build 3 で修正）。 */
  app.roundCpu = cpuHand;
  app.phase = 'chant';
  await runChant({ onFinal: () => openPods(cpuHand) });
  if (token !== app.matchToken) return;
  if (app.phase === 'idle' || !app.match) return;
  await revealRound(cpuHand);
}

async function runChant({ onFinal = null } = {}) {
  const small = $$('#opp-chant .chant__w');
  const big = $$('#big-chant .chant__w');
  const count = Math.max(small.length, big.length);
  const step = CHANT_MS / Math.max(1, count);
  /* Build 5: いま表示しているかけ声の国（自分 / 切替ボタンで選んだ相手）の声で読む。
     前のラウンドの声が残っていても、playVoice が先に止めてから鳴らす。 */
  sound.playVoice(chantCountry().code)?.catch?.(() => {});
  for (let i = 0; i < count; i += 1) {
    $$('.chant__w').forEach((word) => word.classList.remove('is-active'));
    small[i]?.classList.add('is-active');
    big[i]?.classList.add('is-active');
    if (i === count - 1 && onFinal) onFinal();
    sound.play('chant');
    await wait(step);
  }
  $$('.chant__w').forEach((word) => word.classList.remove('is-active'));
}

/** 1ラウンドを決める（手はもう開いている） */
async function revealRound(cpuHand = app.roundCpu) {
  const token = app.matchToken;
  if (!app.match || app.match.finished) return;
  if (!HAND_META[cpuHand] || !HAND_META[app.pickedHand]) return;
  app.phase = 'reveal';
  const next = playRound(app.match, {
    playerHand: app.pickedHand,
    cpuHand,
    timedOut: app.timedOut,
  });
  app.match = next;
  app.matchHands.push(app.pickedHand);
  const round = next.history[next.history.length - 1];
  const previousPoints = next.playerPoints - round.points;

  /* 念のため両方が開いていることを確かめてから判定を出す */
  if (!$('#you-pod').classList.contains('is-revealed') || !$('#cpu-pod').classList.contains('is-revealed')) {
    openPods(cpuHand);
  }

  $('#play-chant').classList.add('is-decided');
  const verdict = $('#verdict');
  verdict.classList.add('is-on', `is-${round.outcome}`);
  $('#verdict-label').textContent =
    round.outcome === 'win' ? T('play.win') : round.outcome === 'lose' ? T('play.lose') : T('play.draw');
  $('#verdict-pts').textContent =
    round.outcome === 'win' ? `+${round.points}` : round.outcome === 'lose' ? `+${round.cpuPoints}` : '±0';

  if (round.outcome === 'win') {
    $('#screen-play').classList.add('flash-win');
    $('#floatpts').textContent = `+${round.points}pt`;
    $('#floatpts').classList.add('is-on');
    sound.play('win');
    setTimeout(() => $('#floatpts').classList.remove('is-on'), 1000);
    receiveStamp('nice');
  } else if (round.outcome === 'lose') {
    $('#screen-play').classList.add('flash-lose');
    sound.play('lose');
    receiveStamp('close');
  } else {
    sound.play('tie');
  }

  renderPips();
  animateNumber($('#play-points'), next.playerPoints, previousPoints, 480);

  await wait(AFTER_REVEAL_MS);
  if (token !== app.matchToken) return;
  if (next.finished) finishMatch();
  else beginRound();
}

/** 通信の相手の手が届いたときの1ラウンド（かけ声から、両方の手を同時に開く） */
async function applyOnlineRound(event) {
  if (!app.match || app.phase === 'idle' || app.match.finished) return;
  if (event.round !== app.match.roundIndex) return;
  /* 自分の締切前（選んでいる途中）なら、まだ開かない。確定後に使う。 */
  if (app.phase === 'thinking' || app.phase === 'chant') {
    app.online.pendingRound = event;
    return;
  }
  if (app.phase !== 'waiting') return;
  app.online.pendingRound = null;
  app.roundCpu = event.hands.opp;
  await chantAndReveal(app.roundCpu, app.matchToken);
}

function animateNumber(el, to, from = null, ms = COUNT_MS) {
  const start = from ?? (Number(String(el.textContent).replace(/[^\d-]/g, '')) || 0);
  if (SPEED < 1) {
    el.textContent = formatPoints(to);
    return;
  }
  const t0 = performance.now();
  const tick = (now) => {
    const t = Math.min(1, (now - t0) / ms);
    const eased = 1 - (1 - t) ** 3;
    el.textContent = formatPoints(start + (to - start) * eased);
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function abortMatch(message) {
  stopTimer();
  app.matchToken += 1;
  app.phase = 'idle';
  app.match = null;
  app.online.pendingRound = null;
  if (app.online.session && app.matchKind === 'online') app.online.session.leave();
  $('#stamp-pop').hidden = true;
  renderHome();
  showScreen('home');
  toast(message || 'マッチをやめました', 2400);
}

/* ------------------------------------------------------------------ *\
 * ONLINE（クイックマッチ / 合言葉）
 * ------------------------------------------------------------------ */

function openOnline() {
  if (!online.onlineConfigured()) {
    toast(T('toast.offline'), 2400);
    return;
  }
  if (app.online.scope === 'world' && !isPro()) {
    openSheet('pro');
    toast(T('online.proWorld'));
    return;
  }
  openSheet('online');
  renderOnlineSheet();
  startQuick();
}

function renderOnlineSheet() {
  const session = app.online.session;
  const status = $('#online-status');
  const title = $('#online-status-title');
  const sub = $('#online-status-sub');
  const state = session ? session.status : '';
  status.classList.toggle('is-live', Boolean(session));
  const scope = app.online.scope === 'world' ? T('online.world') : T('online.domestic');
  if (!session || session.mode !== 'quick') {
    title.textContent = `${scope} ・ ${T('online.quick')}`;
    sub.textContent = `${app.online.rounds}回戦 ・ ${T('online.turn')}`;
    return;
  }
  const remain = Math.ceil((session.remainingMs ?? 0) / 1000);
  if (state === 'timeout') {
    title.textContent = T('online.timeout');
    sub.textContent = T('online.toCpu');
    return;
  }
  title.textContent = T('online.waiting', { n: remain });
  sub.textContent = `${session.presence.length}人接続中 ・ ${app.online.rounds}回戦`;
}

function startQuick() {
  /* 無料は同じ国籍の国内ルームだけ。世界（国籍をまたぐ）は PRO。 */
  if (app.online.scope === 'world' && !isPro()) {
    app.online.scope = 'domestic';
    openSheet('pro');
    toast(T('online.proWorld'), 2200);
    return;
  }
  const session = onlineSession();
  if (!session) {
    toast(T('toast.offline'), 2200);
    return;
  }
  sound.play('click');
  $('#btn-online-retry').hidden = true;
  app.online.pendingRound = null;
  session.quickMatch({
    scope: app.online.scope,
    country: app.profile.countryCode,
    rounds: app.online.rounds,
    profile: app.profile,
  });
  if (app.online.waitingTimer) clearInterval(app.online.waitingTimer);
  app.online.waitingTimer = setInterval(() => {
    if ($('#sheet-online').hidden === false) renderOnlineSheet();
    if (!app.online.session || app.online.session.mode !== 'quick') clearInterval(app.online.waitingTimer);
  }, 500);
}

function joinRoom() {
  const code = online.normalizeCode($('#online-code').value);
  if (!online.isValidCode(code)) {
    toast('合言葉は4文字以上（英数字）', 1800);
    return;
  }
  const session = onlineSession();
  if (!session) {
    toast(T('toast.offline'), 2200);
    return;
  }
  $('#online-code').value = code;
  renderOnlineSheet();
  session.joinRoom({ code, rounds: app.online.rounds, profile: app.profile });
}

function handleOnlineEvent(event) {
  switch (event.type) {
    case 'waiting':
      if (app.view === 'home' && $('#sheet-online').hidden === false) renderOnlineSheet();
      break;
    case 'paired':
      sound.play('select');
      startOnlineMatch(event.opponent);
      break;
    case 'round':
      if (!app.match || app.matchKind !== 'online') break;
      if (app.phase === 'thinking') {
        /* 相手が先に決めた。自分の手を選ぶまで持っておく */
        app.online.pendingRound = event;
        $('#timer-hint').textContent = T('play.waiting');
        break;
      }
      applyOnlineRound(event);
      break;
    case 'opponent-pick':
      if (app.phase === 'waiting') $('#timer-hint').textContent = T('play.waiting');
      break;
    case 'opponent-left':
      if (app.view === 'play' && app.match && !app.match.finished) {
        abortMatch('相手が退出しました（このマッチは記録されません）');
      }
      break;
    case 'timeout':
      renderOnlineSheet();
      $('#btn-online-retry').hidden = false;
      toast(T('online.timeout'), 2400);
      break;
    case 'stamp':
      if (app.profile.stampsMuted) break;
      receiveStamp(event.id, { fromOther: true });
      break;
    case 'party-lobby':
      updatePartyLobby(event);
      break;
    case 'party-started':
      startPartyMatch();
      break;
    case 'party-pick':
      if (app.party.phase === 'thinking' && event.from !== selfKey()) markPartyPicked(event.from);
      break;
    case 'party-full':
      toast(T('party.full'), 2400);
      app.online.session?.leave();
      app.party.phase = 'lobby';
      openSheet('party');
      break;
    case 'party-round':
      applyPartyRound(event);
      break;
    case 'party-end':
      finishParty(event);
      break;
    case 'error':
      toast(T('toast.offline'), 2200);
      break;
    default:
      break;
  }
}

/* ------------------------------------------------------------------ *\
 * PARTY（2〜4人・5回戦）
 * ------------------------------------------------------------------ */

function openParty() {
  if (!online.onlineConfigured()) {
    toast(T('toast.offline'), 2400);
    return;
  }
  /* 世界を選んだまま PRO が切れていたら、国内に戻す（無料でも遊べる） */
  if (app.party.scope === 'world' && !isPro()) app.party.scope = 'domestic';
  openSheet('party');
  renderPartyScope();
  createPartyRoom();
}

/** パーティーの範囲（国内 = 同じ国籍・無料 / 世界 = PRO） */
function renderPartyScope() {
  const wrap = $('#party-scope-seg');
  if (!wrap) return;
  wrap.innerHTML = '';
  /* 無料から遊べる国内を先に、PRO の世界を後ろに（既定は国内） */
  const scopes = [...RANK_SCOPES].sort((a, b) => (a.id === 'domestic' ? -1 : 1) - (b.id === 'domestic' ? -1 : 1));
  for (const scope of scopes) {
    const locked = scope.id === 'world' && !isPro();
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.scope = scope.id;
    button.innerHTML = `${scope.id === 'world' ? '🌏' : '🏠'} ${T(`online.${scope.id}`)}${locked ? ' <em>PRO</em>' : ''}`;
    button.className = `${app.party.scope === scope.id ? 'is-active' : ''}${locked ? ' is-locked' : ''}`;
    button.setAttribute('aria-pressed', String(app.party.scope === scope.id));
    button.addEventListener('click', () => setPartyScope(scope.id));
    wrap.appendChild(button);
  }
  const note = $('#party-scope-note');
  if (note) note.textContent = T('party.scopeNote');
}

function setPartyScope(scope) {
  const next = scope === 'world' ? 'world' : 'domestic';
  if (next === app.party.scope) return;
  if (next === 'world' && !isPro()) {
    sound.play('locked');
    openSheet('pro');
    toast(T('online.proWorld'));
    return;
  }
  sound.play('click');
  app.party.scope = next;
  /* 部屋は範囲ごとに別なので、切り替えたら新しい合言葉で入り直す */
  app.party.code = null;
  app.party.players = [];
  renderPartyScope();
  createPartyRoom();
}

function createPartyRoom() {
  const session = onlineSession();
  if (!session) {
    toast(T('toast.offline'), 2200);
    return;
  }
  const code = online.randomCode();
  app.party.code = code;
  app.party.players = [];
  app.party.phase = 'lobby';
  app.party.isHost = false;
  const value = $('#party-code-value');
  if (value) value.textContent = code;
  renderPartyScope();
  renderPartyLobby(null);
  session.openParty({ code, profile: app.profile, scope: app.party.scope });
}

function joinPartyRoom() {
  const code = online.normalizeCode($('#party-code-input').value);
  if (!online.isValidCode(code)) {
    toast('合言葉は4文字以上（英数字）', 1800);
    return;
  }
  const session = onlineSession();
  if (!session) {
    toast(T('toast.offline'), 2200);
    return;
  }
  app.party.code = code;
  app.party.phase = 'lobby';
  $('#party-code-value').textContent = code;
  renderPartyScope();
  renderPartyLobby(null);
  session.openParty({ code, profile: app.profile, mode: 'join', scope: app.party.scope });
}

function updatePartyLobby(event) {
  app.party.isHost = event.isHost;
  app.party.players = event.players;
  if (event.scope) app.party.scope = event.scope;
  renderPartyScope();
  if (app.party.code) $('#party-code-value').textContent = app.party.code;
  renderPartyLobby(event);
  if (event.started && app.party.phase === 'lobby' && app.view !== 'party') startPartyMatch();
}

function renderPartyLobby(event) {
  const wrap = $('#party-lobby');
  if (!wrap) return;
  const players = app.party.players.length ? app.party.players : [];
  $('#party-count').textContent = `${players.length} / ${PARTY_MAX_PLAYERS}`;
  wrap.innerHTML = players.length
    ? players.map((player) => {
        const country = countryByCode(player.countryCode);
        const you = player.key === selfKey();
        return `<div class="lobby-row${you ? ' is-you' : ''}">
          <span class="lobby-row__flag"><img src="${country.flag}" alt="" /></span>
          <b>${escapeHtml(player.nickname)}${you ? ' (YOU)' : ''}</b>
          <span class="lobby-row__host">${player.key === players[0]?.key ? 'HOST' : ''}</span>
        </div>`;
      }).join('')
    : `<p class="lobby-empty">${T('online.waiting', { n: 30 })}</p>`;
  const start = $('#btn-party-start');
  const canStart = Boolean(event?.isHost) && players.length >= PARTY_MIN_PLAYERS;
  start.hidden = !canStart;
  start.disabled = !canStart;
}

function startPartyMatch() {
  const session = app.online.session;
  if (!session || app.party.phase === 'playing') return;
  app.demoPartyFreeze = false;
  app.party.phase = 'playing';
  app.party.round = 0;
  app.party.hands = {};
  app.party.history = [];
  app.party.points = new Map(app.party.players.map((player) => [player.key, 0]));
  app.party.startedAt = Date.now();
  closeSheet();
  renderPartyChrome();
  showScreen('party');
  beginPartyRound();
}

function renderPartyChrome() {
  const me = countryByCode(app.profile.countryCode);
  $('#party-round-label').textContent = `ROUND ${app.party.round + 1} / ${PARTY_ROUNDS}`;
  $('#party-my-points').textContent = formatPoints(app.party.points.get(selfKey()) ?? 0);
  paintSoundToggles();
  const pips = $('#party-pips');
  pips.innerHTML = '';
  for (let i = 0; i < PARTY_ROUNDS; i += 1) {
    const pip = document.createElement('span');
    pip.className = 'pip';
    const round = app.party.history[i];
    if (round) pip.classList.add('is-draw');
    else if (i === app.party.round) pip.classList.add('is-current');
    pips.appendChild(pip);
  }
  const grid = $('#party-grid');
  grid.dataset.size = String(Math.max(2, Math.min(PARTY_MAX_PLAYERS, app.party.players.length)));
  grid.innerHTML = app.party.players.map((player) => {
    const country = countryByCode(player.countryCode);
    const you = player.key === selfKey();
    return `<div class="ppod${you ? ' is-you' : ''}" data-key="${player.key}">
      <span class="ppod__flag"><img src="${country.flag}" alt="" /></span>
      <b class="ppod__name">${escapeHtml(player.nickname)}${you ? ' <em>YOU</em>' : ''}</b>
      <span class="ppod__face"><span class="ppod__q">?</span><img class="ppod__hand" src="assets/icons/270a.svg" alt="" /></span>
      <span class="ppod__pts">0</span>
      <span class="ppod__state"></span>
    </div>`;
  }).join('');
  $$('#party-grid .ppod.is-you .ppod__flag').forEach((el) => {
    el.querySelector('img').src = me.flag;
  });
  const handbar = $('#party-handbar');
  handbar.innerHTML = '';
  getRuleset('standard').hands.forEach((hand, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'handbtn';
    button.dataset.hand = hand;
    button.innerHTML = `
      <span class="handbtn__key">${index + 1}</span>
      <img src="${HAND_META[hand].asset}" alt="${HAND_META[hand].labelJa}" />
      <span class="handbtn__name">${HAND_META[hand].labelJa}</span>
      <span class="handbtn__pts">${pointsFor(hand, 'standard')}pt</span>
    `;
    button.addEventListener('click', () => selectPartyHand(hand));
    handbar.appendChild(button);
  });
  const chant = countryByCode(app.profile.countryCode).chantParts
    .map((part) => `<span class="chant__w">${escapeHtml(part)}</span>`)
    .join('');
  $('#party-big-chant').innerHTML = chant;
}

function beginPartyRound() {
  app.party.phase = 'thinking';
  app.party.selected = null;
  $('#party-verdict').classList.remove('is-on', 'is-win', 'is-lose', 'is-tie');
  $('#party-chant').classList.remove('is-decided');
  $('#party-timer-hint').textContent = T('play.choose');
  $('#party-timer').classList.remove('is-urgent', 'is-timeup');
  $$('#party-grid .ppod').forEach((pod) => {
    pod.classList.remove('is-revealed', 'is-picked');
    pod.querySelector('.ppod__pts').textContent = String(app.party.points.get(pod.dataset.key) ?? 0);
    pod.querySelector('.ppod__state').textContent = '';
  });
  $$('#party-handbar .handbtn').forEach((b) => b.classList.remove('is-picked', 'is-dim'));
  $('#party-handbar').classList.remove('is-locked');
  renderLockButton();
  renderPartyPips();
  startPartyTimer(PARTY_TURN_MS);
}

function renderPartyPips() {
  $('#party-round-label').textContent = `ROUND ${Math.min(app.party.round + 1, PARTY_ROUNDS)} / ${PARTY_ROUNDS}`;
  $('#party-my-points').textContent = formatPoints(app.party.points.get(selfKey()) ?? 0);
  const pips = $('#party-pips');
  pips.innerHTML = '';
  for (let i = 0; i < PARTY_ROUNDS; i += 1) {
    const pip = document.createElement('span');
    pip.className = 'pip';
    const round = app.party.history[i];
    if (round) pip.classList.add('is-draw');
    else if (i === app.party.round) pip.classList.add('is-current');
    pips.appendChild(pip);
  }
}

function startPartyTimer(ms) {
  const start = performance.now();
  app.party.timer = { raf: 0, ms, start, warned: false };
  const step = (now) => {
    if (app.party.phase !== 'thinking') return;
    const remain = Math.max(0, ms - (now - start));
    $('#party-timer-fill').style.width = `${(ms > 0 ? remain / ms : 0) * 100}%`;
    $('#party-timer-num').textContent = (remain / 1000).toFixed(1);
    const urgent = remain <= 1200;
    $('#party-timer').classList.toggle('is-urgent', urgent);
    if (urgent && !app.party.timer.warned) {
      app.party.timer.warned = true;
      sound.play('urgent');
    }
    if (remain <= 0) {
      /* 締切。最後に選んでいた手があればそれで確定（Build 2） */
      if (!app.party.selected) {
        $('#party-timer').classList.add('is-timeup');
        $('#party-timer-hint').textContent = T('play.timeup');
      }
      commitPartyHand({ timedOut: !app.party.selected });
      return;
    }
    app.party.timer.raf = requestAnimationFrame(step);
  };
  app.party.timer.raf = requestAnimationFrame(step);
}

function stopPartyTimer() {
  if (app.party.timer.raf) cancelAnimationFrame(app.party.timer.raf);
  app.party.timer.raf = 0;
}

function selectPartyHand(hand) {
  if (app.party.phase !== 'thinking') return;
  if (!getRuleset('standard').hands.includes(hand)) return;
  app.party.selected = hand;
  $$('#party-handbar .handbtn').forEach((button) => {
    button.classList.toggle('is-picked', button.dataset.hand === hand);
    button.classList.remove('is-dim');
  });
  $('#party-timer-hint').textContent = T('play.selected');
  renderLockButton();
  sound.play('click');
}

/** 5秒の締切で確定。ここで初めて手を送る（途中の選択は見せない） */
function commitPartyHand({ timedOut = false } = {}) {
  if (app.party.phase !== 'thinking') return;
  const session = app.online.session;
  if (!session) return;
  const { hand, timedOut: resolvedTimeout } = resolveCommit(app.party.selected, {
    rulesetId: 'standard',
    rng: Math.random,
  });
  const isTimeout = Boolean(timedOut || resolvedTimeout);
  app.party.phase = 'chant';
  app.party.hands[selfKey()] = hand;
  app.party.picked = true;
  stopPartyTimer();
  renderLockButton();
  session.partyPick(app.party.round, hand, { timeout: isTimeout });
  $$('#party-handbar .handbtn').forEach((button) => {
    button.classList.toggle('is-picked', button.dataset.hand === hand);
    button.classList.toggle('is-dim', button.dataset.hand !== hand);
  });
  $('#party-handbar').classList.add('is-locked');
  $('#party-timer-fill').style.width = '0%';
  $('#party-timer-num').textContent = '0.0';
  /* 決定したら「相手を待っています」（全員そろうとホストが開く） */
  $('#party-timer-hint').textContent = isTimeout ? T('play.timeup') : T('play.waiting');
  const pod = $(`#party-grid .ppod.is-you`);
  if (pod) {
    pod.classList.add('is-picked');
    pod.querySelector('.ppod__state').textContent = '✓';
  }
  sound.play('whoosh');
}

function markPartyPicked(key) {
  const pod = $(`#party-grid .ppod[data-key="${key}"]`);
  if (!pod) return;
  pod.classList.add('is-picked');
  pod.querySelector('.ppod__state').textContent = '✓';
}

function applyPartyRound(event) {
  if (app.party.phase === 'idle') return;
  app.party.phase = 'reveal';
  app.party.history[event.round] = event;
  app.party.points = new Map(app.party.players.map((player) => [player.key, app.party.points.get(player.key) ?? 0]));
  for (const [key, points] of Object.entries(event.points)) {
    app.party.points.set(key, (app.party.points.get(key) ?? 0) + points);
  }
  $$('#party-grid .ppod').forEach((pod) => {
    const key = pod.dataset.key;
    const hand = event.hands[key];
    const points = event.points[key] ?? 0;
    pod.classList.add('is-revealed');
    pod.querySelector('.ppod__hand').src = HAND_META[hand]?.asset ?? HAND_META.rock.asset;
    pod.querySelector('.ppod__pts').textContent = String(app.party.points.get(key) ?? 0);
    pod.querySelector('.ppod__state').textContent = points > 0 ? `+${points}` : '±0';
    pod.classList.toggle('is-winner', event.winners.includes(key));
  });
  const verdict = $('#party-verdict');
  verdict.classList.add('is-on', event.myPoints > 0 ? 'is-win' : event.threeWay || event.allSame ? 'is-tie' : 'is-lose');
  $('#party-verdict-label').textContent = event.threeWay
    ? '3すくみ 0pt'
    : event.allSame
      ? 'あいこ 0pt'
      : event.myPoints > 0 ? `+${event.myPoints}pt` : '±0';
  $('#party-verdict-pts').textContent = '';
  $('#party-chant').classList.add('is-decided');
  sound.play(event.myPoints > 0 ? 'win' : 'tie');
  renderPartyPips();
  setTimeout(() => {
    if (app.party.phase !== 'reveal') return;
    if (event.last) return; // party-end が来る
    if (app.demoPartyFreeze) return; // スクショ用のデモは止めたまま
    app.party.round = event.round + 1;
    beginPartyRound();
  }, PARTY_AFTER_ROUND_MS * SPEED);
}

function finishParty(event) {
  if (app.party.phase === 'done') return;
  app.party.phase = 'done';
  stopPartyTimer();
  const standings = Array.isArray(event.standings) && event.standings.length ? event.standings : [];
  app.party.standings = standings;
  const mine = standings.find((row) => row.isYou || row.id === selfKey());
  const champion = Boolean(mine && mine.rank === 1);

  /* パーティーの結果はランキングに加算しない（端末内の記録だけ） */
  persist(applyParty(app.profile, { points: mine?.points ?? 0, champion, hands: Object.values(app.party.hands ?? {}) }));

  const verdict = $('#party-result-verdict');
  verdict.className = `result-head__verdict is-${champion ? 'win' : 'draw'}`;
  verdict.textContent = champion ? 'CHAMPION' : `#${mine?.rank ?? '—'}`;
  $('#party-result-points').textContent = String(mine?.points ?? 0);
  $('#party-result-sub').textContent = `PARTY ・ ${PARTY_ROUNDS} ROUNDS ・ ${standings.length} PLAYERS`;
  $('#party-standings').innerHTML = standings
    .map((row) => {
      const country = countryByCode(row.countryCode || app.profile.countryCode);
      const you = row.isYou || row.id === selfKey();
      return `<div class="standing-row${you ? ' is-you' : ''}">
        <span class="standing-row__rank">${row.rank}</span>
        <span class="standing-row__flag"><img src="${country.flag}" alt="" /></span>
        <b>${escapeHtml(row.nickname || 'PLAYER')}${you ? ' (YOU)' : ''}</b>
        <span class="standing-row__pts">${formatPoints(row.points)} pt</span>
        ${row.rank === 1 ? '<img class="standing-row__crown" src="assets/icons/1f451.svg" alt="CHAMPION" />' : ''}
      </div>`;
    })
    .join('');
  $('#party-result-rounds').innerHTML = (app.party.history || [])
    .filter(Boolean)
    .map((round) => {
      const hands = app.party.players
        .map((player) => `<span class="round-hand"><img src="${HAND_META[round.hands[player.key]]?.asset ?? HAND_META.rock.asset}" alt="" /></span>`)
        .join('');
      return `<div class="round-row is-draw">
        <span class="round-row__no">R${round.round + 1}</span>
        ${hands}
        <span class="round-row__pts">${round.threeWay ? '3すくみ' : round.allSame ? 'あいこ' : round.winners.length ? `${round.winners.length}人勝ち` : '±0'}</span>
      </div>`;
    })
    .join('');

  showScreen('party-result');
  sound.play(champion ? 'fanfare' : 'tie');
  if (app.online.session) app.online.session.leave({ bye: false });
}

/* ------------------------------------------------------------------ *\
 * STAMPS
 * ------------------------------------------------------------------ */

function renderStampGrid() {
  const grid = $('#stamp-grid');
  if (!grid) return;
  grid.innerHTML = '';
  for (const stamp of STAMPS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'stamp';
    button.dataset.stamp = stamp.id;
    button.innerHTML = `<img src="assets/icons/${stamp.icon}.svg" alt="" /><span>${stamp.label}</span>`;
    button.addEventListener('click', () => sendStamp(stamp.id));
    grid.appendChild(button);
  }
  updateStampCooldown();
}

function updateStampCooldown() {
  const remain = Math.max(0, app.stampCooldownUntil - Date.now());
  const cool = $('#stamp-cool');
  if (cool) {
    cool.textContent = remain > 0 ? `つぎは あと ${(remain / 1000).toFixed(1)} 秒` : T('stamp.cool');
    cool.classList.toggle('is-cooling', remain > 0);
  }
  $$('#stamp-grid .stamp').forEach((button) => {
    button.disabled = remain > 0;
  });
  const trigger = $('#btn-stamp');
  if (trigger) trigger.classList.toggle('is-cooling', remain > 0);
}

function showStampBubble(side, stamp) {
  const el = side === 'cpu' ? $('#cpu-stamp') : $('#you-stamp');
  if (!el) return;
  el.innerHTML = `<img src="assets/icons/${stamp.icon}.svg" alt="" /><span>${stamp.label}</span>`;
  el.classList.remove('is-on');
  void el.offsetWidth;
  el.classList.add('is-on');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('is-on'), STAMP_VISIBLE_MS);
}

function sendStamp(id) {
  if (app.view !== 'play') return;
  const stamp = STAMPS.find((item) => item.id === id);
  if (!stamp) return;
  if (Date.now() < app.stampCooldownUntil) {
    sound.play('locked');
    return;
  }
  app.stampCooldownUntil = Date.now() + STAMP_COOLDOWN_MS;
  showStampBubble('you', stamp);
  sound.play('select');
  if (app.matchKind === 'online' && app.online.session) app.online.session.sendStamp(id);
  updateStampCooldown();
  clearInterval(app.stampTimer);
  app.stampTimer = setInterval(() => {
    updateStampCooldown();
    if (Date.now() >= app.stampCooldownUntil) clearInterval(app.stampTimer);
  }, 200);
}

function receiveStamp(id, { fromOther = false } = {}) {
  if (app.profile.stampsMuted) return;
  const stamp = STAMPS.find((item) => item.id === id);
  if (!stamp) return;
  const now = Date.now();
  if (now < app.stampCpuCooldownUntil) return;
  app.stampCpuCooldownUntil = now + 3200;
  showStampBubble('cpu', stamp);
  if (!fromOther) return;
}

function toggleStampsMuted() {
  const next = !app.profile.stampsMuted;
  persist({ ...app.profile, stampsMuted: next });
  renderBell();
  if (next) {
    $('#cpu-stamp').classList.remove('is-on');
    $('#you-stamp').classList.remove('is-on');
  }
  sound.play('click');
  toast(next ? 'スタンプをミュートしました' : 'スタンプを受け取ります');
}

/* ------------------------------------------------------------------ *\
 * RESULT（1対1）
 * ------------------------------------------------------------------ */

function finishMatch() {
  app.phase = 'done';
  /* Build 5: 結果へ移る前に、鳴っているかけ声を止める */
  sound.stopVoice();
  const summary = matchSummary(app.match);
  const division = divisionForRounds(app.match.rounds);
  const ranked = app.matchKind === 'online';
  /* 通信対戦は、そのときの範囲（国内 / 世界）のランキングにだけ加算する。
     無料の国内戦は、世界ランキングには一切入らない（Build 2）。 */
  const scope = ranked ? app.online.scope : 'domestic';
  app.resultScope = scope;
  const beforePoints = entryFor(app.profile, division, scope).points;
  const afterPoints = beforePoints + summary.playerPoints;
  app.division = division;
  app.rankBefore = rankInDivision(beforePoints, division);
  app.rankAfter = ranked ? rankInDivision(afterPoints, division) : app.rankBefore;
  app.summary = summary;
  app.resultRanked = ranked;

  const updated = applyMatch(app.profile, {
    matchPoints: summary.playerPoints,
    cpuPoints: summary.cpuPoints,
    verdict: summary.verdict,
    rank: ranked ? app.rankAfter : null,
    rounds: app.match.rounds,
    hands: app.matchHands,
    /* 手ごとの勝率（Build 3）。ラウンドごとの手と勝敗を渡す（あいこも数える） */
    handRounds: app.match.history.map((round) => ({ hand: round.playerHand, outcome: round.outcome })),
    ranked,
    scope,
  });
  persist(updated);

  renderResult(summary);
  showScreen('result');
  receiveStamp('thanks');

  if (summary.verdict === 'win') sound.play('fanfare');
  else if (summary.verdict === 'lose') sound.play('lose');
  else sound.play('tie');
  if (ranked && app.rankAfter < app.rankBefore) setTimeout(() => sound.play('rankUp'), 700);
  if (ranked && app.online.session) app.online.session.leave();
}

function playerForRanking(divisionId = app.division, scope = app.rankView?.scope ?? 'domestic') {
  const entry = entryFor(app.profile, divisionId, scope);
  return {
    nickname: displayName(),
    countryCode: app.profile.countryCode,
    points: entry.points,
    monthlyPoints: entry.monthly?.points ?? 0,
    weeklyPoints: entry.weekly?.points ?? 0,
    matches: entry.matches,
    wins: entry.wins,
    losses: entry.losses,
    ties: entry.ties,
    winRate: entry.matches > 0 ? entry.wins / entry.matches : 0,
    handRates: playerHandRates(),
    pro: isPro(),
  };
}

function renderResult(summary) {
  const verdict = summary.verdict;
  const meta = divisionMeta(app.division);
  const el = $('#result-verdict');
  el.className = `result-head__verdict is-${verdict}`;
  el.textContent = verdict === 'win' ? T('play.win') : verdict === 'lose' ? T('play.lose') : T('play.draw');
  const opponentLabel = app.matchKind === 'online' ? (app.online.opponent?.nickname ?? 'OPP') : 'CPU';
  $('#result-sub').textContent = `YOU ${summary.playerPoints} ・ ${opponentLabel} ${summary.cpuPoints} ・ ${meta.short}`;
  animateNumber($('#result-points'), summary.playerPoints, 0, 900);

  const ranked = app.resultRanked;
  $('#rank-card').hidden = !ranked;
  $('#result-note').hidden = ranked;
  if (ranked) {
    $('#rank-scope-label').textContent = app.resultScope === 'world' ? T('result.world') : T('result.domestic');
    $('#rank-division').textContent = meta.label;
    $('#rank-before').textContent = `${app.rankBefore}位`;
    $('#rank-after').textContent = `${app.rankAfter}位`;
    const delta = rankDelta(app.rankBefore, app.rankAfter);
    const badge = $('#rank-gain');
    badge.classList.remove('is-down', 'is-flat');
    if (delta > 0) badge.textContent = `▲${delta}`;
    else if (delta < 0) {
      badge.textContent = `▼${Math.abs(delta)}`;
      badge.classList.add('is-down');
    } else {
      badge.textContent = 'KEEP';
      badge.classList.add('is-flat');
    }
    $('#result-total').textContent = formatPoints(entryFor(app.profile, app.division, app.resultScope).points);
    $('#rank-total').textContent = `/ ${totalInDivision(app.division, peerRowsFor(app.online.scope))}人中`;
  }

  const practice = app.profile.practice;
  $('#practice-delta').textContent = `+${formatPoints(summary.playerPoints)}pt`;
  $('#practice-result-stats').textContent = practiceLine(practice);
  $('#practice-result-points').textContent = `${formatPoints(practice.points)} pt`;

  renderResultHandstats(summary);

  const wrap = $('#result-rounds');
  wrap.innerHTML = summary.perRound
    .map((round) => {
      const tag = round.outcome === 'win' ? 'WIN' : round.outcome === 'lose' ? 'LOSE' : 'DRAW';
      const pts = round.outcome === 'win' ? `+${round.points}pt` : round.outcome === 'lose' ? '0pt' : '±0';
      return `<div class="round-row is-${round.outcome}">
        <span class="round-row__no">R${round.index}</span>
        <span class="round-hand"><img src="${HAND_META[round.playerHand].asset}" alt="" /></span>
        <span class="round-row__vs">vs</span>
        <span class="round-hand"><img src="${HAND_META[round.cpuHand].asset}" alt="" /></span>
        <span class="round-row__pts"><span class="round-row__tag">${tag}</span> ${pts}</span>
      </div>`;
    })
    .join('');

  const rows = leaderboard({
    division: app.division,
    metric: 'total',
    scope: app.online.scope,
    player: playerForRanking(),
    peers: peerRowsFor(app.online.scope),
  });
  const toNext = pointsToNext(rows);
  $('#result-hint').innerHTML = !ranked
    ? ''
    : toNext > 0
      ? `次の順位まで <b>あと ${formatPoints(toNext)} pt</b>`
      : `${meta.label} トップ！`;

  $('#again-sub').textContent = app.matchKind === 'online'
    ? `ONLINE ・ ${app.match.rounds}回戦 ・ 5.0s`
    : `${getLevel(app.match.levelId).label} ・ CLASSIC ・ ${app.match.rounds}回戦`;
}

function renderResultHandstats(summary) {
  const series = HAND_SERIES;
  const youCounts = {};
  const oppCounts = {};
  for (const round of summary.perRound) {
    youCounts[round.playerHand] = (youCounts[round.playerHand] ?? 0) + 1;
    oppCounts[round.cpuHand] = (oppCounts[round.cpuHand] ?? 0) + 1;
  }

  $('#handstats-legend').innerHTML = series
    .map((hand) => `<span class="hs-legend"><img src="${HAND_META[hand].asset}" alt="" />${HAND_META[hand].labelJa}</span>`)
    .join('');

  const sideRow = (label, counts, tint) => `
    <div class="hs-row">
      <span class="hs-row__label" style="color:${tint}">${label}</span>
      ${stackHtml(counts, series)}
      <span class="hs-row__nums">${handRates(counts, series).map((entry) => formatRate(entry.rate, 0)).join(' / ')}</span>
    </div>`;

  const oppLabel = app.matchKind === 'online' ? 'OPP' : 'CPU';
  $('#handstats-rows').innerHTML =
    sideRow('YOU', youCounts, '#0b6fa8') + sideRow(oppLabel, oppCounts, 'rgba(15,31,58,.5)');
}

/* ------------------------------------------------------------------ *\
 * RANKING（部門 × 指標 × 範囲）
 * ------------------------------------------------------------------ */

function renderAxisTabs() {
  const metricWrap = $('#metric-tabs');
  metricWrap.innerHTML = '';
  for (const metric of RANK_METRICS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.metric = metric.id;
    button.textContent = T(`rank.${metric.id}`);
    button.className = app.rankView.metric === metric.id ? 'is-active' : '';
    button.setAttribute('aria-pressed', String(app.rankView.metric === metric.id));
    button.addEventListener('click', () => {
      sound.play('click');
      setRankingView({ metric: metric.id });
    });
    metricWrap.appendChild(button);
  }

  const scopeWrap = $('#scope-tabs');
  scopeWrap.innerHTML = '';
  for (const scope of RANK_SCOPES) {
    const locked = scope.id === 'world' && !isPro();
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.scope = scope.id;
    button.innerHTML = `${T(`rank.${scope.id}`)}${locked ? ' 🔒' : ''}`;
    button.className = `${app.rankView.scope === scope.id ? 'is-active' : ''}${locked ? ' is-locked' : ''}`;
    button.setAttribute('aria-pressed', String(app.rankView.scope === scope.id));
    button.addEventListener('click', () => {
      if (locked) {
        sound.play('locked');
        openSheet('pro');
        toast(T('online.proWorld'));
        return;
      }
      sound.play('click');
      setRankingView({ scope: scope.id });
    });
    scopeWrap.appendChild(button);
  }

  $$('#div-tabs button').forEach((button) => {
    const active = button.dataset.div === app.rankView.division;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', String(active));
  });
}

function setRankingView({ division, metric, scope } = {}) {
  if (division) app.rankView.division = String(division);
  if (metric) app.rankView.metric = metric;
  if (scope) app.rankView.scope = scope;
  ensureRankNet({ division: app.rankView.division, scope: app.rankView.scope });
  renderRanking();
}

/**
 * ランキング行の3色バー（✊✌️✋）が何を表すかの凡例。
 * バーの色は HAND_COLORS ひとつを元にしているので、行の色と必ず一致する。
 */
function renderRankLegend(locked = false) {
  const wrap = $('#rank-legend');
  if (!wrap) return;
  wrap.hidden = Boolean(locked);
  if (locked) return;
  wrap.innerHTML = `<span class="rank-legend__label">手の率</span>${HAND_SERIES.map(
    (hand) => `<span class="rank-legend__item"><i style="background:${HAND_COLORS[hand]}"></i>${HAND_META[hand].labelJa}</span>`,
  ).join('')}`;
}

function renderRanking() {
  const divisionId = app.rankView.division;
  const metricId = app.rankView.metric;
  const scopeId = app.rankView.scope;
  const meta = divisionMeta(divisionId);
  const metric = metricMeta(metricId);
  const scope = scopeMeta(scopeId);
  const locked = scopeId === 'world' && !isPro();
  $('.rank-list').hidden = locked;
  $('#rank-me').hidden = locked;
  $('#titles-line').hidden = locked;
  $('#rank-locked').hidden = !locked;

  const player = playerForRanking(divisionId, scopeId);
  const peers = locked ? [] : peerRowsFor(scopeId);
  const rows = leaderboard({ division: divisionId, metric: metricId, scope: scopeId, player, peers });
  const me = rows.find((row) => row.isYou);
  const country = countryByCode(me.countryCode);
  /* 勝率ランキングは 5戦以上だけが対象（Build 3）。圏外なら「あと何戦」で案内する */
  const meRanked = isRankedIn(me, metricId);
  const needMatches = matchesToWinRateRank(me.matches);
  const rankedCount = rows.filter((row) => row.qualified !== false).length;

  $('#ranking-title').textContent = `${scope.longLabel}`;
  $('#ranking-caption').textContent = `${meta.label} ・ ${T(`rank.${metricId}`)} ・ ${rankedCount}人`;

  renderAxisTabs();
  renderRankLegend(locked);

  $('#rank-me').innerHTML = `
    <div class="rank-me__rank">${meRanked ? `<b>${me.rank}</b><span>位</span>` : '<b class="is-outside">—</b><span>圏外</span>'}</div>
    <div class="rank-me__flag"><img src="${country.flag}" alt="${countryName(country)}" /></div>
    <div class="rank-me__name">${escapeHtml(me.nickname)}<span class="rank-row__you">YOU</span>${
      meRanked && me.rank === 1 ? '<span class="rank-row__crown"><img src="assets/icons/1f451.svg" alt="" />CHAMPION</span>' : ''
    }<span class="rank-me__mini">${miniRateHtml(me.handRates)}<em>手の率</em></span></div>
    <div class="rank-me__pts">${
      meRanked
        ? `${formatMetric(me, metricId)}${metricId === 'winrate' ? '' : `<span style="font-size:9px;color:var(--ink-faint)"> ${metric.unit}</span>`}`
        : `<em class="rank-me__need">あと${needMatches}戦</em>`
    }</div>
  `;

  const note = $('#rank-note');
  if (note) {
    if (metricId === 'winrate' && !locked) {
      note.hidden = false;
      note.textContent = `※勝率ランキングは${MIN_WINRATE_MATCHES}戦以上が対象です。${
        meRanked ? '' : `あなたは${me.matches}戦 — あと${needMatches}戦でランクイン。`}`;
    } else {
      note.hidden = true;
    }
  }

  const championCount = standingList().filter((standing) => standing.champion).length;
  const titles = titlesHtml();
  const outsideChip = meRanked
    ? ''
    : `<span class="title-chip title-chip--pending">勝率ランキングは${MIN_WINRATE_MATCHES}戦から（あと${needMatches}戦）</span>`;
  const baseTitle =
    titles ||
    (!meRanked
      ? ''
      : me.rank === 1
        ? '<span class="title-chip"><img src="assets/icons/1f451.svg" alt="" />このランキングの1位</span>'
        : `<span class="title-chip title-chip--pending">${meta.trophy}まで あと${Math.max(1, me.rank - 1)}人</span>`);
  $('#titles-line').innerHTML =
    baseTitle + outsideChip +
    (championCount === 1 ? '<span class="title-chip title-chip--pending">2冠まで あと1部門</span>' : '');

  const top = rows.slice(0, 3);
  const windowRows = leaderboardWindow(rows, { radius: 3 });
  const merged = [...top];
  for (const row of windowRows) {
    if (!merged.some((item) => item.id === row.id)) merged.push(row);
  }

  $('#rank-list').innerHTML = merged
    .map((row, index) => {
      const prev = merged[index - 1];
      const gap = prev && row.rank - prev.rank > 1 ? '<div class="rank-row__gap">…</div>' : '';
      return `${gap}${rankRowHtml(row, metricId, metric.unit)}`;
    })
    .join('');

  $$('#rank-list .rank-row').forEach((element) => {
    element.addEventListener('click', () => {
      const row = rows.find((item) => item.id === element.dataset.rowId);
      if (row) openPlayer(row);
    });
  });
}

function rankRowHtml(row, metricId, unit) {
  const country = countryByCode(row.countryCode);
  const topClass = row.rank === 1 ? ' is-top1' : row.rank === 2 ? ' is-top2' : row.rank === 3 ? ' is-top3' : '';
  const outside = row.qualified === false;
  const secondary = metricId === 'winrate'
    ? `${countryName(country)} ・ ${row.matches}試合${outside ? `<span class="rank-row__outside">5戦未満</span>` : ''}`
    : countryName(country);
  const rates = isPro() ? miniRateHtml(row.handRates) : '';
  return `<div class="rank-row${row.isYou ? ' is-you' : ''}${row.pro ? ' is-pro' : ''}${outside ? ' is-outside' : ''}" data-row-id="${row.id}" role="button" tabindex="0">
    <span class="rank-row__no${topClass}">${outside ? '—' : row.rank}</span>
    <span class="rank-row__flag"><img src="${country.flag}" alt="${countryName(country)}" /></span>
    <span class="rank-row__id">
      <span class="rank-row__name">${escapeHtml(row.nickname)}${row.isYou ? '<span class="rank-row__you">YOU</span>' : ''}</span>
      <span class="rank-row__country">${secondary}${rates}</span>
    </span>
    <span class="rank-row__pts">${formatMetric(row, metricId)}${metricId === 'winrate' ? '' : `<em>${unit}</em>`}</span>
  </div>`;
}

function openPlayer(row) {
  app.detailRow = row;
  const country = countryByCode(row.countryCode);
  const metricId = app.rankView.metric;
  const metric = metricMeta(metricId);
  const rates = row.handRates ?? { rock: 0, scissors: 0, paper: 0 };
  const wins = row.wins ?? Math.round((row.winRate ?? 0) * (row.matches ?? 0));
  const losses = row.losses ?? Math.max(0, (row.matches ?? 0) - wins);

  $('#player-name').textContent = `${row.nickname}${row.isYou ? '（あなた）' : ''}`;
  $('#player-sub').textContent =
    row.subtitle ?? `${countryName(country)} ・ ${divisionMeta(app.rankView.division).label} ・ ${row.rank}位`;

  const showRates = isPro() || row.isYou;
  $('#player-body').innerHTML = `
    <div class="pd-top">
      <div class="pd-flag"><img src="${country.flag}" alt="${countryName(country)}" /></div>
      <div class="pd-metric">
        <span>${T(`rank.${metricId}`)}</span>
        <b>${row.isYou || row.matches ? `${formatMetric(row, metricId)}<em>${metric.unit}</em>` : '—'}</b>
      </div>
      <div class="pd-record">
        <span>${row.matches ?? 0}試合</span>
        <b>${wins}勝 ${losses}敗</b>
      </div>
    </div>
    ${showRates
      ? `<div class="stat-block">
          <div class="stat-block__head"><span>手の率</span><span>勝率 ${formatRate(row.winRate ?? 0, 0)}</span></div>
          <div class="handrows">${handRowsHtml(
            { rock: Math.round(rates.rock * 100), scissors: Math.round(rates.scissors * 100), paper: Math.round(rates.paper * 100) },
            HAND_SERIES,
            { results: row.isYou ? app.profile.handResults ?? {} : null },
          )}</div>
        </div>`
      : `<div class="pro-lock-note"><img src="assets/icons/1f512.svg" alt="" /><span>相手の手の率（✊✌️✋%）は PRO の機能です。</span></div>`}
    <p class="sheet__note">${row.isYou
      ? 'あなたの手の率は、この端末で出した手の回数から計算しています。勝率は、あいこを除いて数えます。'
      : 'ランキングの相手は、同じチャンネルに接続しているプレイヤーです（接続が無いときはローカルのライバル）。'}${
      row.qualified === false ? ` 勝率ランキングは${MIN_WINRATE_MATCHES}戦以上が対象です。` : ''}</p>
  `;
  openSheet('player', { nested: true });
}

/* ------------------------------------------------------------------ *\
 * STATS
 * ------------------------------------------------------------------ */

function renderStats() {
  const counts = app.profile.handCounts;
  const totalHands = HAND_SERIES.reduce((sum, hand) => sum + (counts[hand] ?? 0), 0);
  $('#stats-hands-count').textContent = `${totalHands} 手`;
  $('#stats-hands').innerHTML = handRowsHtml(counts, HAND_SERIES, { results: app.profile.handResults ?? {} });

  const practice = app.profile.practice;
  const party = app.profile.party ?? { matches: 0, wins: 0, points: 0 };
  const world5 = worldOf(app.profile, '5');
  const world3 = worldOf(app.profile, '3');
  const rate5 = world5.matches > 0 ? world5.wins / world5.matches : 0;
  const rate3 = world3.matches > 0 ? world3.wins / world3.matches : 0;

  $('#stat-grid').innerHTML = `
    <div class="stat">
      <span>練習</span>
      <b>${practice.matches}試合</b>
      <em>${practice.wins}勝 ${practice.losses}敗${practice.ties ? ` ${practice.ties}分` : ''}</em>
    </div>
    <div class="stat">
      <span>パーティー</span>
      <b>${party.matches}試合</b>
      <em>${party.wins}回 優勝 ・ ${formatPoints(party.points)} pt</em>
    </div>
    <div class="stat">
      <span>5回戦部門</span>
      <b>${rankInDivision(world5.points, '5')}位</b>
      <em>${formatPoints(world5.points)} pt ・ 勝率 ${formatRate(rate5, 0)}</em>
    </div>
    <div class="stat">
      <span>3回戦部門</span>
      <b>${rankInDivision(world3.points, '3')}位</b>
      <em>${formatPoints(world3.points)} pt ・ 勝率 ${formatRate(rate3, 0)}</em>
    </div>
  `;
}

function renderSettings() {
  const practice = app.profile.practice;
  $('#set-sound-state').textContent = app.profile.sound ? T('misc.on') : T('misc.off');
  $('#set-stamps-state').textContent = app.profile.stampsMuted ? T('misc.off') : T('misc.on');
  $('#set-practice-count').textContent = `${practice.matches}試合`;
  $('#set-language-state').textContent = i18n.localeMeta(app.locale).label;

  /* ニックネーム（変更できる）と国籍（初回登録後ロック） */
  const nick = $('#set-nickname');
  if (nick && nick.value !== app.profile.nickname) nick.value = app.profile.nickname;
  const country = countryByCode(app.profile.countryCode);
  const state = $('#set-country-state');
  if (state) {
    state.textContent = `${countryName(country)} ${app.profile.countryLocked ? '🔒' : '›'}`;
    state.classList.toggle('is-locked', Boolean(app.profile.countryLocked));
  }
  const lockNote = $('#country-lock-note');
  if (lockNote) lockNote.hidden = !app.profile.countryLocked;
  const confirm = $('#btn-country-confirm');
  if (confirm) confirm.hidden = Boolean(app.profile.countryLocked);

  /* 文字サイズ */
  $$('#text-size-seg button').forEach((button) => {
    const active = button.dataset.textSize === app.profile.textScale;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

/* ------------------------------------------------------------------ *\
 * COUNTRY / LANGUAGE / PRO
 * ------------------------------------------------------------------ */

function renderCountryGrid() {
  const grid = $('#country-grid');
  const locked = !canChangeCountry(app.profile);
  const lockNote = $('#country-lock-note');
  if (lockNote) lockNote.hidden = !locked;
  const confirm = $('#btn-country-confirm');
  if (confirm) confirm.hidden = locked;
  grid.innerHTML = '';
  for (const country of COUNTRIES) {
    const current = country.code === app.profile.countryCode;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `country-item${current ? ' is-active is-current' : ''}${locked && !current ? ' is-disabled' : ''}`;
    if (locked && !current) button.setAttribute('aria-disabled', 'true');
    button.innerHTML = `
      <img src="${country.flag}" alt="${countryName(country)}" />
      <span class="country-item__name">${countryName(country)}</span>
      <span class="country-item__chant">${escapeHtml(chantLabel(country))}</span>
      ${country.code === DEFAULT_COUNTRY ? '<span class="country-item__home">HOME</span>' : ''}
    `;
    button.addEventListener('click', () => {
      /* 国籍は初回登録後は変えられない（ニックネームだけが変えられる） */
      if (!canChangeCountry(app.profile)) {
        sound.play('locked');
        toast(T('toast.countryLocked'), 1800);
        return;
      }
      sound.play('select');
      persist({ ...app.profile, countryCode: country.code });
      renderCountryGrid();
      renderHome();
      if (app.match) $('#you-flag img').src = country.flag;
      toast(`${countryName(country)} で挑戦します`);
    });
    grid.appendChild(button);
  }
}

/** 「この国で登録する」— ここで国籍を確定し、以後は変更不可にする */
function confirmCountry() {
  if (app.profile.countryLocked) {
    toast(T('toast.countryLocked'), 1600);
    return;
  }
  persist(registerCountry(app.profile, app.profile.countryCode));
  const country = countryByCode(app.profile.countryCode);
  renderCountryGrid();
  renderHome();
  renderSettings();
  sound.play('select');
  toast(T('toast.countryRegistered'), 2200);
  void country;
}

function renderLanguageGrid() {
  const grid = $('#lang-grid');
  grid.innerHTML = '';
  for (const locale of i18n.LOCALES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `lang-item${locale.id === app.locale ? ' is-active' : ''}`;
    button.dataset.locale = locale.id;
    button.innerHTML = `<b>${locale.label}</b><span>${locale.id}</span>`;
    button.addEventListener('click', () => {
      setLocale(locale.id);
      renderLanguageGrid();
      sound.play('select');
    });
    grid.appendChild(button);
  }
}

function setLocale(id) {
  if (!i18n.isLocale(id)) return;
  app.locale = id;
  persist({ ...app.profile, locale: id });
  document.documentElement.lang = i18n.localeMeta(id).tag;
  applyLanguage();
  toast(T('toast.lang'), 1400);
}

function applyLanguage() {
  i18n.applyI18n(document, app.locale);
  renderHome();
  renderStats();
  renderSettings();
  renderHowto();
  renderPrivacy();
  if ($('#sheet-ranking').hidden === false) renderRanking();
  if ($('#sheet-online').hidden === false) renderOnlineSheet();
}

function renderHowto() {
  const list = $('#howto-list');
  if (!list) return;
  const steps = ['s1', 's2', 's3', 's4', 's5', 's6'];
  list.innerHTML = steps
    .map((key) => `<li><b>${P(`howto.${key}.title`)}</b><span>${P(`howto.${key}.body`)}</span></li>`)
    .join('');
  $('#howto-legend').innerHTML = getRuleset('standard').hands
    .map((hand) => `<span class="howto-legend__item"><img src="${HAND_META[hand].asset}" alt="" />${HAND_META[hand].labelJa} ${pointsFor(hand, 'standard')}pt</span>`)
    .join('');
  $('#legal-note').textContent = P('legal.lead');
}

function renderPrivacy() {
  const body = $('#legal-body');
  if (!body) return;
  const sections = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9'];
  body.innerHTML =
    `<p class="legal__lead">${P('legal.lead')}</p>` +
    sections
      .map((key) => `<h4>${P(`legal.${key}`)}</h4><p>${P(`legal.${key}.body`)}</p>`)
      .join('') +
    `<h4>Contact</h4><p>${P('legal.contact')}</p>` +
    (i18n.proseLocale(app.locale) === 'en' && app.locale !== 'en'
      ? `<p class="legal__note">${T('legal.note')}</p>`
      : '');
}

function renderProSheet() {
  const on = isPro();
  const price = pro.fallbackPrice(app.locale);
  $('#pro-price-amount').textContent = app.profile.proPrice || price;
  $('#btn-pro-buy').hidden = on;
  $('#btn-pro-restore').hidden = on;
  $('#pro-owned').hidden = !on;
  const diag = pro.diagnostic();
  const diagEl = $('#pro-diag');
  diagEl.hidden = !diag;
  diagEl.textContent = diag ? `${T('pro.diag')}: ${diag}` : '';
  const toggle = $('#btn-pro-toggle');
  toggle.hidden = !pro.previewAllowed();
  toggle.classList.toggle('is-on', on);
  $('#pro-switch-state').textContent = on ? T('misc.on') : T('misc.off');
  $('.pro-switch__label', toggle).textContent = on ? T('pro.previewOn') : T('pro.preview');
  $('#pro-preview-note').hidden = !pro.previewAllowed();
}

function setPro(on) {
  let next = applyPro(app.profile, on);
  if (!on) {
    if (LEVELS[next.levelId]?.pro) next = { ...next, levelId: 'normal' };
    if (app.online.scope === 'world') app.online.scope = 'domestic';
    if (app.rankView.scope === 'world') app.rankView.scope = 'domestic';
    /* 世界パーティーを開いていたら、国内に戻す（無料でも続けられる） */
    if (app.party.scope === 'world') app.party.scope = 'domestic';
  }
  persist(next);
  renderHome();
  renderProSheet();
  /* パーティーのシートが開いていれば、国内/世界のボタンも描き直す */
  if ($('#sheet-party') && $('#sheet-party').hidden === false) renderPartyScope();
  if ($('#sheet-ranking').hidden === false) renderRanking();
  sound.play(on ? 'proUnlock' : 'click');
  toast(on ? T('toast.proOn') : T('toast.proOff'));
}

async function buyPro() {
  sound.play('click');
  const result = await pro.purchase();
  if (result.status === 'success') {
    setPro(true);
    return;
  }
  if (result.status === 'preview') {
    toast(T('toast.proOn'));
    return;
  }
  renderProSheet();
  toast(result.status === 'cancelled' ? '購入をキャンセルしました' : '購入を完了できませんでした');
}

async function restorePro() {
  sound.play('click');
  const result = await pro.restore();
  if (result.status === 'restored') setPro(true);
  else {
    renderProSheet();
    toast(result.status === 'nothing' ? '復元できる購入がありません' : '復元できませんでした');
  }
}

/* ------------------------------------------------------------------ *\
 * SHEETS
 * ------------------------------------------------------------------ */

function openSheet(name, { keepToast = false, nested = false } = {}) {
  if (!keepToast) $('#toast').classList.remove('is-on');
  const current = $$('.sheet').find((sheet) => !sheet.hidden)?.dataset.sheet;
  if (!nested) app.sheetStack = [];
  else if (current && current !== name) app.sheetStack.push(current);
  if (name === 'ranking') {
    /* 開くたびに、いまのチャンネルから行を集め直す（2.5秒だけ待つ） */
    app.online.netKey = '';
    ensureRankNet({ division: app.rankView.division, scope: app.rankView.scope });
    renderRanking();
  }
  if (name === 'country') renderCountryGrid();
  if (name === 'pro') renderProSheet();
  if (name === 'stats') renderStats();
  if (name === 'settings') renderSettings();
  if (name === 'howto') renderHowto();
  if (name === 'privacy') renderPrivacy();
  if (name === 'language') renderLanguageGrid();
  if (name === 'online') renderOnlineSheet();
  if (name === 'party') renderPartyLobby(null);
  $$('.sheet').forEach((sheet) => {
    sheet.hidden = sheet.dataset.sheet !== name;
  });
  $('#overlay').hidden = false;
  app.lastInput = Date.now();
  sound.play('click');
}

function closeSheet() {
  const previous = app.sheetStack.pop();
  if (previous) {
    $$('.sheet').forEach((sheet) => {
      sheet.hidden = sheet.dataset.sheet !== previous;
    });
    app.lastInput = Date.now();
    return;
  }
  $('#overlay').hidden = true;
  app.lastInput = Date.now();
  /* 待機中のマッチングは閉じたら止める（部屋は残す） */
  if (app.online.session && app.online.session.mode === 'quick' && !app.match) {
    app.online.session.leave({ bye: true });
    if (app.online.waitingTimer) clearInterval(app.online.waitingTimer);
  }
}

/* ------------------------------------------------------------------ *\
 * 放置の自動処理
 * ------------------------------------------------------------------ */

function startIdleWatch() {
  setInterval(() => {
    const idle = Date.now() - app.lastInput;
    if (idle < IDLE_WARN_MS) return;

    if (app.view === 'play' && app.phase === 'thinking' && !app.idleWarned) {
      app.idleWarned = true;
      toast(`しばらく操作がないため、自動で手を選びます（${MAX_CONSECUTIVE_TIMEOUTS}回続くと終了）`, 2600);
    }
    if (idle >= IDLE_HOME_MS) {
      if (!$('#overlay').hidden) {
        closeSheet();
        app.lastInput = Date.now();
        return;
      }
      if (app.view === 'play') {
        abortMatch('操作がなかったため、マッチを終了しました（記録は残りません）');
        app.lastInput = Date.now();
        return;
      }
      if (app.view === 'party') {
        if (app.online.session) app.online.session.leave();
        app.party.phase = 'idle';
        renderHome();
        showScreen('home');
        toast('操作がなかったため、パーティーを終了しました');
        app.lastInput = Date.now();
        return;
      }
      if (app.view === 'result' || app.view === 'party-result') {
        renderHome();
        showScreen('home');
        toast('操作がなかったため、タイトルに戻りました');
        app.lastInput = Date.now();
      }
    }
  }, 4000);
}

/* ------------------------------------------------------------------ *\
 * イベント
 * ------------------------------------------------------------------ */

function bindEvents() {
  $$('.ds-item').forEach((button) => {
    button.addEventListener('click', () => {
      const rounds = Number(button.dataset.division) === 3 ? 3 : 5;
      if (Number(app.profile.rounds) === rounds) return;
      sound.play('select');
      persist({ ...app.profile, rounds });
      renderHome();
    });
  });

  $$('#mode-cards .mode-card').forEach((card) => {
    card.addEventListener('click', () => setMode(card.dataset.mode));
  });

  $('#btn-play').addEventListener('click', () => {
    sound.unlock();
    sound.play('select');
    if (app.mode === 'practice') startMatch();
    else if (app.mode === 'online') openOnline();
    else openParty();
  });

  $('#btn-online-open').addEventListener('click', openOnline);

  $('#btn-quit').addEventListener('click', () => {
    if (app.match && !app.match.finished) {
      abortMatch('マッチをやめました（記録は加算されません）');
      return;
    }
    renderHome();
    showScreen('home');
  });

  $('#btn-party-quit').addEventListener('click', () => {
    if (app.online.session) app.online.session.leave();
    app.party.phase = 'idle';
    renderHome();
    showScreen('home');
    toast('パーティーを退出しました');
  });

  $('#btn-again').addEventListener('click', () => {
    sound.play('select');
    if (app.matchKind === 'online') {
      openOnline();
      return;
    }
    startMatch({ levelId: app.match?.levelId, rounds: app.match?.rounds });
  });

  $('#btn-home').addEventListener('click', () => {
    renderHome();
    showScreen('home');
  });

  $('#btn-party-home').addEventListener('click', () => {
    renderHome();
    showScreen('home');
  });

  $('#btn-party-again').addEventListener('click', () => {
    openSheet('party');
    createPartyRoom();
  });

  $('#btn-result-ranking').addEventListener('click', () => openSheet('ranking'));
  $('#btn-country').addEventListener('click', () => openSheet('country'));
  $('#btn-country-confirm').addEventListener('click', confirmCountry);
  $('#set-country').addEventListener('click', () => openSheet('country', { nested: true }));
  $('#btn-chant-toggle').addEventListener('click', toggleChantSide);

  /* 文字サイズ（設定） */
  $$('#text-size-seg button').forEach((button) => {
    button.addEventListener('click', () => changeTextScale(button.dataset.textSize));
  });

  /* 設定のニックネーム（国籍と違って、いつでも変えられる） */
  const settingNickname = $('#set-nickname');
  settingNickname.addEventListener('input', () => {
    const value = settingNickname.value.slice(0, 12);
    persist({ ...app.profile, nickname: value });
    if ($('#nickname').value !== app.profile.nickname) $('#nickname').value = app.profile.nickname;
    if ($('#sheet-ranking').hidden === false) renderRanking();
  });
  settingNickname.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') settingNickname.blur();
  });
  $('#btn-help').addEventListener('click', () => openSheet('howto'));

  $('#practice-strip').addEventListener('click', (event) => {
    if (event.target.closest('#btn-practice-reset')) return;
    openSheet('stats');
  });
  $('#practice-strip').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openSheet('stats');
    }
  });
  $('#btn-practice-reset').addEventListener('click', (event) => {
    event.stopPropagation();
    armPracticeReset();
  });

  $$('.tabbar button').forEach((button) => {
    button.addEventListener('click', () => openSheet(button.dataset.nav));
  });

  $$('#div-tabs button').forEach((button) => {
    button.addEventListener('click', () => {
      sound.play('click');
      setRankingView({ division: button.dataset.div });
    });
  });

  $$('[data-close]').forEach((button) => button.addEventListener('click', closeSheet));
  $('#overlay').addEventListener('click', (event) => {
    if (event.target === $('#overlay')) closeSheet();
  });

  $('#btn-pro-toggle').addEventListener('click', () => setPro(!isPro()));
  $('#btn-pro-buy').addEventListener('click', buyPro);
  $('#btn-pro-restore').addEventListener('click', restorePro);
  $('#btn-rank-pro').addEventListener('click', () => openSheet('pro', { nested: true }));

  $('#btn-sound').addEventListener('click', () => toggleSound());
  /* Build 6: プレイ中・パーティーのヘッダーからも、同じサウンド設定を切り替える */
  $('#btn-play-sound')?.addEventListener('click', () => toggleSound());
  $('#btn-party-sound')?.addEventListener('click', () => toggleSound());

  /* これで決定（ロック）。押した瞬間に確定し、CPU はすぐ「ぽん！」、
     通信は「相手を待っています」になる（相手も決めたら即オープン） */
  $('#btn-lock')?.addEventListener('click', () => {
    if (app.phase !== 'thinking' || !app.selectedHand) return;
    sound.play('select');
    commitRound();
  });
  $('#btn-party-lock')?.addEventListener('click', () => {
    if (app.party.phase !== 'thinking' || !app.party.selected) return;
    sound.play('select');
    commitPartyHand();
  });

  $('#btn-bell').addEventListener('click', toggleStampsMuted);
  $('#btn-stamp').addEventListener('click', () => {
    const pop = $('#stamp-pop');
    pop.hidden = !pop.hidden;
    updateStampCooldown();
  });
  $('#btn-opp-info').addEventListener('click', () => {
    if (!app.match) return;
    const opponent = countryByCode(app.match.opponent?.code);
    const counts = app.match.history.reduce((acc, round) => {
      acc[round.cpuHand] = (acc[round.cpuHand] ?? 0) + 1;
      return acc;
    }, {});
    const rates = handRates(counts, HAND_SERIES);
    openPlayer({
      id: 'opponent',
      nickname: app.matchKind === 'online' ? (app.online.opponent?.nickname ?? 'OPPONENT') : `${countryName(opponent)} CPU`,
      countryCode: opponent.code,
      subtitle: `このマッチの傾向 ・ ${app.match.history.length}ラウンド`,
      points: 0,
      monthlyPoints: 0,
      matches: app.match.history.length,
      winRate: 0,
      handRates: Object.fromEntries(rates.map((entry) => [entry.hand, entry.rate])),
    });
  });

  $('#set-language').addEventListener('click', () => openSheet('language', { nested: true }));
  $('#set-howto').addEventListener('click', () => openSheet('howto', { nested: true }));
  $('#set-privacy').addEventListener('click', () => openSheet('privacy', { nested: true }));
  $('#set-sound').addEventListener('click', () => $('#btn-sound').click());
  $('#set-stamps').addEventListener('click', toggleStampsMuted);
  $('#set-practice').addEventListener('click', () => {
    armPracticeReset();
    renderSettings();
  });

  /* 通信 */
  $('#btn-quick').addEventListener('click', startQuick);
  $('#btn-room-join').addEventListener('click', joinRoom);
  $('#btn-online-retry').addEventListener('click', () => {
    $('#btn-online-retry').hidden = true;
    startQuick();
  });
  $('#btn-online-cpu').addEventListener('click', () => {
    if (app.online.session) app.online.session.leave();
    closeSheet();
    setMode('practice');
    startMatch();
  });
  $('#online-code').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') joinRoom();
  });

  /* パーティー */
  $('#btn-party-create').addEventListener('click', createPartyRoom);
  $('#btn-party-join').addEventListener('click', joinPartyRoom);
  $('#btn-party-start').addEventListener('click', () => {
    if (app.online.session) app.online.session.startParty();
  });
  $('#btn-party-copy').addEventListener('click', async () => {
    const code = app.party.code || '';
    try {
      await navigator.clipboard.writeText(code);
      toast('合言葉をコピーしました');
    } catch {
      toast(`合言葉: ${code}`);
    }
  });
  $('#party-code-input').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') joinPartyRoom();
  });

  const nickname = $('#nickname');
  nickname.addEventListener('input', () => {
    persist({ ...app.profile, nickname: nickname.value.slice(0, 12) });
    if (!$('#sheet-ranking').hidden) renderRanking();
  });
  nickname.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') nickname.blur();
  });

  document.addEventListener('pointerdown', (event) => {
    app.lastInput = Date.now();
    if (!event.target.closest('#stamp-pop') && !event.target.closest('#btn-stamp')) {
      $('#stamp-pop').hidden = true;
    }
  });
  document.addEventListener('keydown', (event) => {
    app.lastInput = Date.now();
    if (event.key === 'Escape') {
      if (!$('#stamp-pop').hidden) {
        $('#stamp-pop').hidden = true;
        return;
      }
      closeSheet();
      return;
    }
    if ($('#overlay').hidden === false) return;
    if (app.view === 'play' && app.phase === 'thinking') {
      const hands = getRuleset('standard').hands;
      const index = Number(event.key) - 1;
      if (Number.isInteger(index) && hands[index]) selectHand(hands[index]);
    }
    if (app.view === 'party' && app.party.phase === 'thinking') {
      const hands = getRuleset('standard').hands;
      const index = Number(event.key) - 1;
      if (Number.isInteger(index) && hands[index]) selectPartyHand(hands[index]);
    }
    if (app.view === 'result' && event.key === 'Enter') $('#btn-again').click();
  });

  document.addEventListener('pointerdown', () => {
    /* iOS はユーザー操作の中でしか音を起こせない。毎回起こし直す（ミュート中も用意だけする） */
    sound.unlock();
  });

  /* iOS で戻ってきたとき、ソケットと音を起こし直す */
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (app.online.client) app.online.client.wake();
    sound.wake();
  });
}

/* ------------------------------------------------------------------ *\
 * boot
 * ------------------------------------------------------------------ */

function boot() {
  if (!hasCountry(app.profile.countryCode)) app.profile.countryCode = DEFAULT_COUNTRY;
  if (!i18n.isLocale(app.locale)) app.locale = i18n.detectLocale(navigator.language);
  document.documentElement.lang = i18n.localeMeta(app.locale).tag;
  app.division = divisionForRounds(app.profile.rounds);
  app.rankView.division = app.division;
  app.rankView.scope = isPro() ? 'world' : 'domestic';
  if (!isPro()) app.online.scope = 'domestic';
  app.chantSide = normalizeChantSide(app.profile.chantSide);
  applyTextScale();
  bindEvents();
  i18n.applyI18n(document, app.locale);
  renderHome();
  showScreen('home');
  renderProSheet();
  renderStats();
  renderHowto();
  renderPrivacy();
  startIdleWatch();

  /* ネイティブでは Apple の答えで PRO を確定する（プレビューは体験スイッチ） */
  if (pro.mode() === 'store') {
    pro.refresh().then((entitled) => {
      if (entitled === true && !app.profile.pro) setPro(true);
      renderProSheet();
    });
    pro.loadPrice().then((product) => {
      if (product?.price) {
        persist({ ...app.profile, proPrice: product.price });
        renderProSheet();
      }
    });
  }

  window.JANKeNPoN = {
    version: '1.0.0',
    build: 7,
    get profile() {
      return app.profile;
    },
    get textScale() {
      return app.profile.textScale;
    },
    get countryLocked() {
      return Boolean(app.profile.countryLocked);
    },
    get chant() {
      return { side: app.chantSide, country: chantCountry().code };
    },
    get pk() {
      return app.match ? pkBoard(app.match.history, app.match.rounds) : [];
    },
    setTextScale: changeTextScale,
    toggleChantSide,
    /* Build 6: プレイ中のサウンド ON/OFF（設定と同じ） */
    toggleSound,
    get soundOn() {
      return Boolean(app.profile.sound);
    },
    confirmCountry,
    get audio() {
      return {
        state: sound.state,
        sessionType: sound.sessionType,
        unlocked: sound.unlocked,
        silenceActive: sound.silenceActive,
        gain: sound.gain,
        /* Build 5: いま鳴っているかけ声の国コード（鳴っていなければ null） */
        voice: sound.voice,
      };
    },
    unlockAudio: () => sound.unlock(),
    get match() {
      return app.match;
    },
    get phase() {
      return app.phase;
    },
    get mode() {
      return app.mode;
    },
    get rank() {
      return { before: app.rankBefore, after: app.rankAfter, division: app.division };
    },
    get rankView() {
      return { ...app.rankView };
    },
    get online() {
      return {
        scope: app.online.scope,
        rounds: app.online.rounds,
        mode: app.online.session?.mode ?? null,
        matchName: app.online.session?.matchName ?? null,
        presence: app.online.session?.presence?.length ?? 0,
        remainingMs: app.online.session?.remainingMs ?? 0,
        configured: online.onlineConfigured(),
      };
    },
    get party() {
      return {
        code: app.party.code,
        players: app.party.players.map((player) => player.nickname),
        round: app.party.round,
        phase: app.party.phase,
      };
    },
    /** テスト用: 「これで決定」を押したのと同じ */
    lock() {
      if (app.view === 'party') {
        if (app.party.phase === 'thinking' && app.party.selected) commitPartyHand();
        return app.party.phase;
      }
      if (app.phase === 'thinking' && app.selectedHand) commitRound();
      return app.phase;
    },
    get lockVisible() {
      const button = app.view === 'party' ? $('#btn-party-lock') : $('#btn-lock');
      return Boolean(button && !button.hidden);
    },
    summary: () => (app.match ? matchSummary(app.match) : null),
    startMatch,
    choose: selectHand,
    commit: commitRound,
    forceCpuHand(hand) {
      app.forcedCpu.push(hand);
    },
    openSheet,
    closeSheet,
    setPro,
    setMode,
    setRankingView,
    renderRanking,
    renderStats,
    openPlayer,
    sendStamp,
    setLocale,
    startQuick,
    joinRoom: (code) => {
      $('#online-code').value = code;
      joinRoom();
    },
    createParty: createPartyRoom,
    /** ネットワーク無しで通信対戦の画面を確認する（スクショ用） */
    async demoOnlineMatch(opponent = { nickname: 'Kai', countryCode: 'US' }) {
      app.matchToken += 1;
      app.matchKind = 'online';
      app.turnMs = ONLINE_TURN_MS;
      app.online.opponent = opponent;
      app.online.scope = 'domestic';
      app.online.rounds = 5;
      const country = countryByCode(opponent.countryCode);
      app.match = createMatch({
        rulesetId: 'standard',
        levelId: 'normal',
        rounds: 5,
        opponent: { code: country.code, nameJa: country.nameJa },
      });
      app.phase = 'idle';
      app.matchHands = [];
      app.consecutiveTimeouts = 0;
      renderPlayChrome();
      closeSheet();
      showScreen('play');
      beginRound();
      return true;
    },
    async demoParty(size = 3) {
      const others = [
        { nickname: 'Kai', countryCode: 'US' },
        { nickname: 'Yui', countryCode: 'JP' },
        { nickname: 'Luca', countryCode: 'IT' },
      ].slice(0, Math.max(1, size - 1));
      app.online.session = { leave() {}, partyPick() {}, startParty() {}, mode: 'party' };
      app.demoKey = 'you-demo';
      app.party.players = [
        { key: 'you-demo', nickname: displayName(), countryCode: app.profile.countryCode },
        ...others.map((player, index) => ({ key: `demo-${index}`, ...player })),
      ];
      app.demoPartyFreeze = true;
      app.party.phase = 'playing';
      app.party.round = 0;
      app.party.history = [];
      app.party.points = new Map(app.party.players.map((player) => [player.key, 0]));
      app.party.code = app.party.code || 'DEMO1';
      renderPartyChrome();
      showScreen('party');
      beginPartyRound();
      return app.party.players.length;
    },
    async demoPartyRound() {
      const handOf = { 'you-demo': 'paper', 'demo-0': 'rock', 'demo-1': 'scissors', 'demo-2': 'rock' };
      const event = {
        round: app.party.round,
        hands: Object.fromEntries(app.party.players.map((player) => [player.key, handOf[player.key] ?? 'rock'])),
        winners: ['you-demo'],
        points: { 'you-demo': 5 },
        myPoints: 5,
        threeWay: false,
        allSame: false,
        last: app.party.round >= PARTY_ROUNDS - 1,
      };
      applyPartyRound(event);
      return event;
    },
    async demoPartyResult() {
      finishParty({
        type: 'party-end',
        reason: 'finished',
        standings: app.party.players.map((player, index) => ({
          id: player.key,
          nickname: player.nickname,
          countryCode: player.countryCode,
          points: index === 0 ? 18 : index === 1 ? 12 : 7,
          rank: index + 1,
          isYou: index === 0,
        })),
      });
      return true;
    },
    resetPractice() {
      persist(resetPractice(app.profile));
      renderHome();
      renderStats();
    },
    setRounds(rounds) {
      persist({ ...app.profile, rounds: Number(rounds) === 3 ? 3 : 5 });
      renderHome();
    },
    setNickname(name) {
      persist({ ...app.profile, nickname: String(name).slice(0, 12) });
      $('#nickname').value = app.profile.nickname;
      renderHome();
    },
  };
}

boot();
