/* JANKeN PoN — 通信対戦の電文（Supabase Realtime / `games-realtime`）

   このファイルだけがソケットを開く。Supabase Realtime（Phoenix channels）の
   2つの機能だけを使う:

     broadcast  チャンネルに小さな JSON を流す（全員に届く）
     presence   いま誰がそのチャンネルにいるか（名前・国・PRO・回戦数）

   データベースのテーブルも、アクセスポリシーも、Edge Function も、認証アカウントも
   使わない。部屋はチャンネル名そのもので、対戦は online.js のメッセージ列で進む。
   URL かキーが無ければアプリはここに来ない（CPU練習がそのまま動く）。

   国際固定ルール（core.js の ONLINE_RULES）:
     ・1手 5秒（相手も自分も同じ。レベルで変えられない）
     ・マッチング待機は30秒で打ち切り
     ・パーティーは 2〜4人・5回戦。結果はどのランキングにも加算しない

   通信の安全:
     ・自由入力のチャットは無い（定型スタンプのみ・4秒あき）
     ・受信した手は core.validateOnlinePick で検証（不正手・二重送信・範囲外ラウンド）
     ・本文サイズの上限（payloadTooLarge）

   依存は WebSocket ひとつだけ。SDK は積まない。 */

import {
  ONLINE_TURN_MS,
  MATCH_TIMEOUT_MS,
  PARTY_ROUNDS,
  PARTY_MIN_PLAYERS,
  PARTY_MAX_PLAYERS,
  validateOnlinePick,
  validateStamp,
  payloadTooLarge,
  scoreRound,
  scoreCpuRound,
  scorePartyRound,
  partyStandings,
  getRuleset,
  resolveTimeout,
} from './core.js';

/* ------------------------------------------------------------------ *\
 * 接続先（Supabase → Project Settings → API の公開値）
 *
 * `games-realtime` プロジェクトは Realtime 専用で、テーブルもストレージも無い。
 * publishable キーはアプリに載せる前提の公開値。CODE DUEL / ICE WOLF と同じ値。
 * ------------------------------------------------------------------ */

export const SUPABASE_URL = 'https://siivncidktbuyqwsjeqd.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_lrs0ilfAGmibFiiP4DHYaA_Bk7lgzuZ';

/** `window.JANKeN_PON_ONLINE = {url, key, off}` でプレビュー側から差し替え可能 */
function injected() {
  if (typeof window === 'undefined') return null;
  const value = window.JANKeN_PON_ONLINE;
  return value && typeof value === 'object' ? value : null;
}

export function onlineConfig() {
  const extra = injected();
  const url = (extra && extra.url) || SUPABASE_URL;
  const key = (extra && extra.key) || SUPABASE_ANON_KEY;
  const off = Boolean(extra && extra.off);
  const configured = !off && Boolean(url && key && /^https:\/\//.test(url) && String(key).length > 20);
  return { url, key, configured };
}

export function onlineConfigured() {
  return onlineConfig().configured;
}

/* ------------------------------------------------------------------ *\
 * チャンネル名
 * ------------------------------------------------------------------ */

/* チャンネル名の接頭辞（ドキュメント用。実際の名前は下の関数が作る） */
export const CHANNEL_PREFIX = 'janken';

/** クイックマッチ: 国内は国コードで絞り、世界は world。回戦数も部屋を分ける */
export function quickChannel({ scope = 'domestic', country = 'JP', rounds = 5 } = {}) {
  const where = scope === 'world' ? 'world' : String(country || 'JP').toUpperCase();
  return `janken-quick:${where}:${Number(rounds) === 3 ? 3 : 5}`;
}

/** 合言葉の部屋（2人対戦・パーティー共通の名前空間は分ける） */
export function roomChannel(code) {
  return `janken-room:${normalizeCode(code)}`;
}

export function partyChannel(code) {
  return `janken-party:${normalizeCode(code)}`;
}

/** 2人の対戦チャンネル（クライアントID2つを並べた決定的な名前） */
export function matchChannel(keyA, keyB) {
  return `janken-match:${[String(keyA), String(keyB)].sort().join('-')}`;
}

/** ランキングの受け渡しチャンネル（部門 × 範囲） */
export function rankChannel({ division = '5', scope = 'domestic' } = {}) {
  return `janken-rank:${String(division)}:${scope === 'world' ? 'world' : 'domestic'}`;
}

/** 合言葉の整形（英数字のみ・最大8文字。日本語の合言葉は使わない＝入力ミスと通報の温床を避ける） */
export function normalizeCode(code) {
  return String(code || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8);
}

export function isValidCode(code) {
  return normalizeCode(code).length >= 4;
}

/** 部屋コードの候補（紛らわしい 0/O/1/I を除く） */
export function randomCode(random = Math.random) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 5; i += 1) out += alphabet[Math.floor(random() * alphabet.length)];
  return out;
}

/* ------------------------------------------------------------------ *\
 * Realtime クライアント（Phoenix channels over one WebSocket）
 * ------------------------------------------------------------------ */

export function realtimeUrl(baseUrl, anonKey) {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/realtime/v1/websocket';
  url.search = `?apikey=${encodeURIComponent(anonKey)}&vsn=1.0.0`;
  return url.toString();
}

/** Presence は {key: {metas: [...]}} で来る。読める形の配列にする。 */
export function presenceMembers(state = {}) {
  const members = [];
  for (const [key, value] of Object.entries(state || {})) {
    const metas = Array.isArray(value && value.metas) ? value.metas : [];
    for (const meta of metas) members.push({ key, ...meta });
  }
  return members;
}

const HEARTBEAT_MS = 25000;
const MAX_RETRY_MS = 15000;
const CONNECT_TIMEOUT_MS = 5000;
const JOIN_TIMEOUT_MS = 7000;
const WEDGE_DIALS = 3;

export class RealtimeClient {
  constructor({
    url,
    key,
    WebSocketImpl = typeof WebSocket !== 'undefined' ? WebSocket : null,
    schedule = setTimeout,
    clear = clearTimeout,
    random = Math.random,
    now = () => Date.now(),
    clientId = null,
  } = {}) {
    this.url = url;
    this.key = key;
    this.WebSocketImpl = WebSocketImpl;
    /* setTimeout をそのまま持つと、メソッド呼び出しの this が変わって
       「Illegal invocation」になる。必ず包んで呼ぶ。 */
    this.schedule = (fn, ms) => schedule(fn, ms);
    this.clear = (id) => clear(id);
    this.random = random;
    this.now = now;
    this.socket = null;
    this.topics = new Map();
    this.status = 'idle';
    this.closed = false;
    this.ref = 0;
    this.retry = 0;
    this.heartbeatId = null;
    this.retryId = null;
    this.clientId = clientId || `jkp${Math.floor(random() * 1e9).toString(36)}`;
    this.onStatus = null;
    this.lastFrameAt = 0;
    this.lastError = '';
    this.connectingSince = 0;
    this.openedAt = 0;
    this.dials = 0;
    this.stuckDials = 0;
    this.wedged = false;
    this.sent = 0;
    this.received = 0;
  }

  /** 画面に出す1行（すべて実際に起きたこと） */
  step() {
    const socket = this.socket;
    const readyState = socket ? socket.readyState : -1;
    const state = readyState === 0
      ? 'connecting'
      : readyState === 1
        ? 'open'
        : readyState > 1
          ? 'closed'
          : this.retryId
            ? 'redial'
            : 'none';
    const joined = [...this.topics.values()].some((entry) => entry.joined);
    return {
      state, readyState, joined, dials: this.dials, stuck: this.stuckDials,
      wedged: this.wedged, sent: this.sent, received: this.received, lastError: this.lastError,
    };
  }

  connect() {
    if (this.socket && (this.socket.readyState === 0 || this.socket.readyState === 1)) return;
    if (!this.WebSocketImpl) {
      this.setStatus('unavailable');
      return;
    }
    this.closed = false;
    this.setStatus(this.status === 'reconnecting' ? 'reconnecting' : 'connecting');
    let socket;
    try {
      socket = new this.WebSocketImpl(realtimeUrl(this.url, this.key));
    } catch (error) {
      this.lastError = `ws-new: ${(error && error.message) || 'refused'}`;
      this.setStatus('error');
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    this.dials += 1;
    this.connectingSince = this.now();
    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.retry = 0;
      this.stuckDials = 0;
      this.wedged = false;
      this.connectingSince = 0;
      this.openedAt = this.now();
      this.lastFrameAt = this.now();
      this.lastError = '';
      this.setStatus('open');
      this.startHeartbeat();
      for (const name of this.topics.keys()) {
        const entry = this.topics.get(name);
        if (entry) entry.joinRetried = false;
        this.sendJoin(name);
      }
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      this.handleMessage(event && event.data);
    };
    socket.onerror = (event) => {
      if (this.socket !== socket) return;
      const detail = event && (event.message || event.type);
      this.lastError = detail ? `ws-error: ${detail}` : 'ws-error';
      this.setStatus('error');
    };
    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      const code = event && typeof event.code === 'number' ? event.code : '?';
      const reason = event && event.reason ? ` ${event.reason}` : '';
      this.lastError = `ws-close ${code}${reason}`.trim();
      this.socket = null;
      this.connectingSince = 0;
      this.stopHeartbeat();
      if (this.closed) return;
      this.setStatus('reconnecting');
      this.scheduleReconnect();
    };
  }

  scheduleReconnect() {
    if (this.closed) return;
    const step = Math.min(MAX_RETRY_MS, 500 * 2 ** this.retry);
    const wait = Math.round(step * (0.75 + this.random() * 0.5));
    this.retry += 1;
    if (this.retryId) this.clear(this.retryId);
    this.retryId = this.schedule(() => {
      this.retryId = null;
      this.connect();
    }, wait);
    this.setStatus('reconnecting');
  }

  setStatus(status) {
    if (this.status === status) return;
    this.status = status;
    if (this.onStatus) this.onStatus(status);
    for (const entry of this.topics.values()) {
      if (entry.handlers && entry.handlers.onStatus) entry.handlers.onStatus(status);
    }
  }

  cycle(reason) {
    const socket = this.socket;
    this.socket = null;
    this.connectingSince = 0;
    this.stopHeartbeat();
    this.lastError = reason;
    if (reason === 'stalled' || String(reason).startsWith('ws-connecting')) {
      this.stuckDials += 1;
      this.wedged = this.stuckDials >= WEDGE_DIALS;
    }
    if (socket && socket.readyState <= 1) {
      try {
        socket.close();
      } catch {
        /* already gone */
      }
    }
    this.setStatus('reconnecting');
    this.scheduleReconnect();
  }

  /** ソケットがまだ何か運んでいるか（1秒に1回、画面側が呼ぶ） */
  checkAlive(now = this.now()) {
    if (this.closed) return false;
    const socket = this.socket;
    if (!socket) {
      if (!this.retryId) this.connect();
      return false;
    }
    if (socket.readyState === 0) {
      const waited = this.connectingSince ? now - this.connectingSince : 0;
      if (waited > CONNECT_TIMEOUT_MS) {
        this.lastError = `ws-connecting ${Math.round(waited / 1000)}s`;
        this.cycle(this.lastError);
        return false;
      }
      return true;
    }
    if (socket.readyState === 1) this.checkJoin(now);
    if (socket.readyState > 1) {
      this.socket = null;
      this.stopHeartbeat();
      this.scheduleReconnect();
      return false;
    }
    if (now - (this.lastFrameAt || now) > HEARTBEAT_MS * 2 + 5000) {
      this.cycle('stalled');
      return false;
    }
    return true;
  }

  wake(now = this.now()) {
    if (this.closed) return false;
    if (!this.socket) {
      if (!this.retryId) this.connect();
      return false;
    }
    if (now - (this.lastFrameAt || 0) < HEARTBEAT_MS) return true;
    this.cycle('wake');
    return false;
  }

  checkJoin(now = this.now()) {
    if (!this.openedAt) return;
    for (const [name, entry] of this.topics) {
      if (entry.joined) continue;
      const since = entry.joinSentAt || this.openedAt;
      const waited = now - since;
      if (entry.joinRetried !== true && waited > JOIN_TIMEOUT_MS) {
        entry.joinRetried = true;
        this.sendJoin(name);
        continue;
      }
      if (waited > JOIN_TIMEOUT_MS * 2) {
        entry.lastError = entry.lastError || 'join-silent';
        this.lastError = entry.lastError;
        if (entry.handlers.onStatus) entry.handlers.onStatus('error');
      }
    }
  }

  startHeartbeat() {
    this.stopHeartbeat();
    const beat = () => {
      this.sendRaw({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: `hb${(this.ref += 1)}` });
      this.heartbeatId = this.schedule(beat, HEARTBEAT_MS);
    };
    this.heartbeatId = this.schedule(beat, HEARTBEAT_MS);
  }

  stopHeartbeat() {
    if (this.heartbeatId) this.clear(this.heartbeatId);
    this.heartbeatId = null;
  }

  subscribe(name, handlers = {}) {
    if (this.topics.has(name)) {
      const existing = this.topics.get(name);
      existing.handlers = handlers;
      return name;
    }
    this.topics.set(name, { handlers, joined: false, joinRef: String((this.ref += 1)), presence: {} });
    if (this.socket && this.socket.readyState === 1) this.sendJoin(name);
    else this.connect();
    return name;
  }

  sendJoin(name) {
    const entry = this.topics.get(name);
    if (!entry) return;
    entry.joined = false;
    entry.tracked = null;
    entry.joinSentAt = this.now();
    this.sendRaw({
      topic: `realtime:${name}`,
      event: 'phx_join',
      payload: {
        access_token: this.key,
        config: {
          broadcast: { ack: false, self: false },
          presence: { key: this.clientId, enabled: true },
          postgres_changes: [],
        },
      },
      ref: entry.joinRef,
      join_ref: entry.joinRef,
    });
  }

  broadcast(name, event, payload) {
    const entry = this.topics.get(name);
    if (!entry) return false;
    this.sendRaw({
      topic: `realtime:${name}`,
      event: 'broadcast',
      payload: { type: 'broadcast', event, payload },
      ref: null,
      join_ref: entry.joinRef,
    });
    return true;
  }

  track(name, meta) {
    const entry = this.topics.get(name);
    if (!entry) return false;
    const body = JSON.stringify(meta || {});
    if (entry.tracked === body) return true;
    const sent = this.sendRaw({
      topic: `realtime:${name}`,
      event: 'presence',
      payload: { type: 'presence', event: 'track', payload: meta || {} },
      ref: null,
      join_ref: entry.joinRef,
    });
    if (sent) entry.tracked = body;
    return sent;
  }

  unsubscribe(name) {
    const entry = this.topics.get(name);
    if (!entry) return;
    this.sendRaw({ topic: `realtime:${name}`, event: 'phx_leave', payload: {}, ref: String((this.ref += 1)) });
    this.topics.delete(name);
  }

  joined(name) {
    return Boolean(this.topics.get(name)?.joined);
  }

  sendRaw(message) {
    if (!this.socket || this.socket.readyState !== 1) return false;
    try {
      this.socket.send(JSON.stringify(message));
      this.sent += 1;
      return true;
    } catch {
      return false;
    }
  }

  handleMessage(raw) {
    let message;
    try {
      message = JSON.parse(typeof raw === 'string' ? raw : String(raw));
    } catch {
      return;
    }
    if (!message || !message.topic) return;
    this.received += 1;
    this.lastFrameAt = this.now();
    const name = message.topic.startsWith('realtime:') ? message.topic.slice('realtime:'.length) : message.topic;
    const entry = this.topics.get(name);
    if (!entry) return;

    if (message.event === 'phx_reply') {
      if (message.ref == null || String(message.ref) !== entry.joinRef) return;
      const ok = message.payload && message.payload.status === 'ok';
      const wasJoined = entry.joined;
      entry.joined = ok;
      if (ok && !wasJoined && entry.handlers.onStatus) entry.handlers.onStatus('joined');
      if (!ok) {
        const response = (message.payload && message.payload.response) || {};
        entry.lastError = response.reason || response.message || 'join rejected';
        this.lastError = entry.lastError;
        if (entry.handlers.onStatus) entry.handlers.onStatus('error');
      }
      return;
    }
    if (message.event === 'system') {
      const payload = message.payload || {};
      if (payload.status === 'error') {
        entry.lastError = payload.message || 'system error';
        this.lastError = entry.lastError;
        entry.joined = false;
        if (entry.handlers.onStatus) entry.handlers.onStatus('error');
      }
      return;
    }
    if (message.event === 'presence_state') {
      entry.presence = message.payload || {};
      if (entry.handlers.onPresence) {
        entry.handlers.onPresence({ state: entry.presence, joins: null, leaves: null, members: presenceMembers(entry.presence) });
      }
      return;
    }
    if (message.event === 'presence_diff') {
      const diff = message.payload || {};
      for (const key of Object.keys(diff.leaves || {})) delete entry.presence[key];
      for (const [key, value] of Object.entries(diff.joins || {})) entry.presence[key] = value;
      if (entry.handlers.onPresence) {
        entry.handlers.onPresence({ state: entry.presence, joins: diff.joins || null, leaves: diff.leaves || null, members: presenceMembers(entry.presence) });
      }
      return;
    }
    if (message.event === 'broadcast') {
      const payload = message.payload || {};
      if (entry.handlers.onBroadcast) entry.handlers.onBroadcast(payload.event, payload.payload);
      return;
    }
    if (message.event === 'phx_error' || message.event === 'phx_close') {
      entry.joined = false;
      if (entry.handlers.onStatus) entry.handlers.onStatus('closed');
    }
  }

  close() {
    this.closed = true;
    this.stopHeartbeat();
    if (this.retryId) this.clear(this.retryId);
    this.retryId = null;
    this.topics.clear();
    if (this.socket && this.socket.readyState <= 1) this.socket.close();
    this.socket = null;
    this.setStatus('closed');
  }
}

/* ------------------------------------------------------------------ *\
 * 2人対戦・クイックマッチ・合言葉の部屋
 * ------------------------------------------------------------------ */

const JOIN_WAIT_MS = 8000;
const OPPONENT_GRACE_MS = 1500;

export class OnlineSession {
  constructor({
    client,
    onEvent = () => {},
    now = () => Date.now(),
    schedule = setTimeout,
    clear = clearTimeout,
    random = Math.random,
  } = {}) {
    this.client = client;
    this.onEvent = onEvent;
    this.now = now;
    this.schedule = (fn, ms) => schedule(fn, ms);
    this.clear = (id) => clear(id);
    this.random = random;
    this.mode = null; // 'quick' | 'room' | 'party'
    this.scope = 'domestic';
    this.rounds = 5;
    this.profile = { nickname: '', countryCode: 'JP', pro: false };
    this.channel = null;
    this.matchName = null;
    this.host = false;
    this.opponent = null;
    this.myPicks = new Map();
    this.oppPicks = new Map();
    this.seen = new Set();
    this.resolved = new Set();
    this.waitTimer = null;
    this.deadline = 0;
    this.presence = [];
    this.players = [];
    this.partyPoints = new Map();
    this.partyRound = -1;
    this.partyPicks = new Map();
    this.partyTimer = null;
    this.partyOver = false;
    /* 画面に出す待機の残り秒（テストと UI のため） */
    this.remainingMs = 0;
    this.knownNames = new Map();
  }

  emit(event) {
    try {
      this.onEvent(event);
    } catch {
      /* 画面側の不具合で通信を止めない */
    }
  }

  /**
   * チャンネルを開く。presence の track は join の返事（joined）の後で送る。
   * ソケットが開く前に送ると Supabase に捨てられるため、ここで順番を守る。
   */
  openChannel(name, meta, handlers = {}) {
    this.trackMeta = this.trackMeta ?? new Map();
    this.trackMeta.set(name, meta);
    this.client.subscribe(name, {
      ...handlers,
      onStatus: (status) => {
        if (status === 'joined') {
          const current = this.trackMeta.get(name);
          if (current) this.client.track(name, current);
        }
        if (handlers.onStatus) handlers.onStatus(status);
      },
    });
  }

  meta(extra = {}) {
    return {
      nickname: String(this.profile.nickname || 'PLAYER').slice(0, 12),
      countryCode: String(this.profile.countryCode || 'JP').toUpperCase(),
      pro: Boolean(this.profile.pro),
      rounds: this.rounds,
      ...extra,
    };
  }

  /* --- クイックマッチ / 合言葉の部屋 ------------------------------- */

  quickMatch({ scope = 'domestic', country = 'JP', rounds = 5, profile = {}, timeoutMs = MATCH_TIMEOUT_MS } = {}) {
    this.reset();
    this.mode = 'quick';
    this.scope = scope === 'world' ? 'world' : 'domestic';
    /* 世界（国籍をまたぐ）対戦は PRO だけ。無料は同じ国籍の国内ルームに出る */
    if (this.scope === 'world' && !profile?.pro) {
      this.mode = null;
      this.emit({ type: 'error', reason: 'pro-world' });
      return null;
    }
    this.rounds = Number(rounds) === 3 ? 3 : 5;
    this.profile = { ...profile, countryCode: country || profile.countryCode || 'JP' };
    const name = quickChannel({ scope: this.scope, country: this.profile.countryCode, rounds: this.rounds });
    this.openWaiting(name, { timeoutMs });
    return name;
  }

  joinRoom({ code, rounds = 5, profile = {} } = {}) {
    this.reset();
    this.mode = 'room';
    this.rounds = Number(rounds) === 3 ? 3 : 5;
    this.profile = { ...profile };
    const name = roomChannel(code);
    this.openWaiting(name, { timeoutMs: 0 });
    return name;
  }

  openWaiting(name, { timeoutMs = MATCH_TIMEOUT_MS } = {}) {
    this.channel = name;
    this.deadline = timeoutMs > 0 ? this.now() + timeoutMs : 0;
    this.remainingMs = timeoutMs;
    this.openChannel(name, this.meta({ mode: this.mode, host: false }), {
      onStatus: (status) => {
        if (status === 'error') this.emit({ type: 'error', reason: 'join' });
      },
      onPresence: ({ members }) => this.handleWaitingPresence(members),
      onBroadcast: (event, payload) => this.handleWaitingBroadcast(event, payload),
    });
    if (timeoutMs > 0) {
      this.waitTimer = this.schedule(() => {
        this.waitTimer = null;
        if (!this.matchName) {
          this.remainingMs = 0;
          this.emit({ type: 'timeout', mode: this.mode });
        }
      }, timeoutMs);
      /* 待機中の残り秒を1秒ごとに知らせる（上限つき：30秒 + 1秒） */
      this.tickEverySecond();
    }
  }

  tickEverySecond() {
    if (this.tickTimer) this.clear(this.tickTimer);
    const step = () => {
      if (!this.deadline || this.matchName) {
        this.tickTimer = null;
        return;
      }
      this.remainingMs = Math.max(0, this.deadline - this.now());
      this.emit({
        type: 'waiting',
        mode: this.mode,
        present: this.presence.length,
        remainingMs: this.remainingMs,
      });
      if (this.remainingMs <= 0) {
        this.tickTimer = null;
        return;
      }
      this.tickTimer = this.schedule(step, 1000);
    };
    this.tickTimer = this.schedule(step, 1000);
  }

  handleWaitingPresence(members) {
    const mine = this.client.clientId;
    const roster = members.filter((member) => member && member.key).map((member) => {
      if (member.nickname) this.knownNames.set(member.key, String(member.nickname).slice(0, 12));
      return { ...member, nickname: member.nickname || this.knownNames.get(member.key) || '' };
    });
    this.presence = roster;
    if (this.matchName) return;

    const keys = [...new Set(roster.map((member) => member.key))].sort();
    const index = keys.indexOf(mine);
    if (index < 0) return;

    if (this.mode === 'room') {
      /* 合言葉の部屋は先着2人。並び順で先の人が部屋を作る */
      if (keys.length >= 2 && keys.slice(0, 2).includes(mine)) {
        const first = keys[0] === mine;
        if (first) this.pairWith(keys[1], { initiator: true });
        else this.emit({ type: 'waiting', mode: this.mode, present: keys.length, remainingMs: 0 });
      }
      return;
    }

    /* クイックマッチ: 並び順で 0-1, 2-3 … と組む。余った1人は待ち続ける。
       組むのは並び順で先の人だけ。後の人は相手からの `pair` 電文で入る
       （先の人が待機チャンネルを離れる早さに左右されないため）。 */
    const pairStart = index % 2 === 0 ? index : index - 1;
    const partner = pairStart === index ? keys[pairStart + 1] : null;
    if (partner) {
      this.pairWith(partner, { initiator: true });
      return;
    }
    this.emit({ type: 'waiting', mode: this.mode, present: keys.length, remainingMs: this.remainingMs });
  }

  /** 待機チャンネルで受け取るのは「組もう」の合図だけ */
  handleWaitingBroadcast(event, payload) {
    if (event !== 'pair' || !payload || typeof payload !== 'object') return;
    if (payload.to !== this.client.clientId) return;
    if (this.matchName) return;
    const from = typeof payload.from === 'string' ? payload.from : '';
    if (!from) return;
    this.pairWith(from, { initiator: false, room: payload.room });
  }

  pairWith(partnerKey, { initiator = false, room = null } = {}) {
    if (!partnerKey || this.matchName) return;
    const name = typeof room === 'string' && room.startsWith('janken-match:')
      ? room
      : matchChannel(this.client.clientId, partnerKey);
    this.matchName = name;
    this.host = this.client.clientId < partnerKey;
    if (this.waitTimer) {
      this.clear(this.waitTimer);
      this.waitTimer = null;
    }
    if (this.tickTimer) {
      this.clear(this.tickTimer);
      this.tickTimer = null;
    }
    /* 相手に「このチャンネルに来て」と伝えてから、待機チャンネルを離れる
       （離脱はマッチチャンネルに入れた後） */
    if (initiator) {
      this.client.broadcast(this.channel, 'pair', {
        from: this.client.clientId,
        to: partnerKey,
        room: name,
      });
    }
    const partnerMeta = this.presence.find((member) => member.key === partnerKey) ?? {};
    if (partnerMeta.nickname) this.knownNames.set(partnerKey, partnerMeta.nickname);
    this.opponent = {
      key: partnerKey,
      nickname: partnerMeta.nickname || this.knownNames.get(partnerKey) || 'PLAYER',
      countryCode: partnerMeta.countryCode || 'JP',
      pro: Boolean(partnerMeta.pro),
    };
    const waiting = this.channel;
    this.channel = name;
    this.openChannel(name, this.meta({ mode: 'match' }), {
      onStatus: (status) => {
        if (status === 'joined') {
          /* マッチチャンネルに入れたら、もう待機チャンネルには用がない */
          if (waiting && waiting !== name) this.client.unsubscribe(waiting);
          this.client.broadcast(name, 'hello', {
            from: this.client.clientId,
            ...this.meta({ host: this.host }),
          });
        }
        if (status === 'error') this.emit({ type: 'error', reason: 'match-join' });
      },
      onPresence: ({ members }) => this.handleMatchPresence(members),
      onBroadcast: (event, payload) => this.handleMatchBroadcast(event, payload),
    });
    this.started = true;
    this.leftNotified = false;
    this.opponentSeen = false;
    this.emit({
      type: 'paired',
      mode: 'match',
      host: this.host,
      rounds: this.rounds,
      opponent: this.opponent,
    });
  }

  handleMatchPresence(members) {
    if (!this.matchName || !this.opponent) return;
    const keys = members.map((member) => member.key);
    if (keys.includes(this.opponent.key)) {
      /* 一度でも相手を見た。これ以降に消えたら「退出」として扱う */
      this.opponentSeen = true;
      return;
    }
    /* 自分が先に入った直後は、相手がまだ来ていないだけ。退出とは違う */
    if (!this.opponentSeen || !this.started || this.leftNotified) return;
    this.leftNotified = true;
    this.emit({ type: 'opponent-left' });
  }

  handleMatchBroadcast(event, payload) {
    const mine = this.client.clientId;
    if (!payload || typeof payload !== 'object') return;
    if (payloadTooLarge(payload)) return;
    if (event === 'hello') {
      if (payload.from === mine) return;
      const nickname = String(payload.nickname || '').slice(0, 12);
      if (nickname) this.knownNames.set(payload.from, nickname);
      this.opponent = {
        key: payload.from,
        nickname: nickname || this.knownNames.get(payload.from) || 'PLAYER',
        countryCode: payload.countryCode || 'JP',
        pro: Boolean(payload.pro),
      };
      this.emit({ type: 'opponent-info', opponent: this.opponent });
      return;
    }
    if (event === 'pick') {
      const valid = validateOnlinePick(payload, { self: mine, rounds: this.rounds, seen: this.seen });
      if (!valid.ok) return;
      this.seen.add(`${valid.from}:${valid.round}`);
      this.oppPicks.set(valid.round, valid.hand);
      this.emit({ type: 'opponent-pick', round: valid.round });
      this.tryResolve(valid.round);
      return;
    }
    if (event === 'stamp') {
      const valid = validateStamp(payload, {
        self: mine,
        allowed: ['hello', 'nice', 'close', 'nervous', 'haha', 'thanks'],
        lastAt: this.lastStampAt ?? 0,
        now: this.now(),
      });
      if (!valid.ok) return;
      this.lastStampAt = this.now();
      this.emit({ type: 'stamp', id: valid.id, from: valid.from });
      return;
    }
    if (event === 'bye') {
      if (payload.from === mine) return;
      this.emit({ type: 'opponent-left' });
    }
  }

  /** 自分の手を送る（5秒切れのときは timeout: true で、出た手をそのまま送る） */
  pick(round, hand, { timeout = false } = {}) {
    if (!this.matchName) return false;
    const index = Number(round);
    if (!Number.isInteger(index) || index < 0 || index >= this.rounds) return false;
    if (!getRuleset('standard').hands.includes(hand)) return false;
    if (this.myPicks.has(index)) return false; // 二重送信を弾く
    this.myPicks.set(index, hand);
    this.client.broadcast(this.matchName, 'pick', {
      from: this.client.clientId,
      round: index,
      hand,
      timeout: Boolean(timeout),
      at: this.now(),
    });
    this.tryResolve(index);
    return true;
  }

  /** 5秒たっても自分の手が決まっていなければ、ランダムな手を送る */
  timeoutPick(round) {
    if (this.myPicks.has(Number(round))) return false;
    const { hand } = resolveTimeout('standard', this.random);
    return this.pick(round, hand);
  }

  tryResolve(round) {
    const index = Number(round);
    if (!this.matchName || this.resolved.has(index)) return null;
    if (!this.myPicks.has(index) || !this.oppPicks.has(index)) return null;
    const you = this.myPicks.get(index);
    const opp = this.oppPicks.get(index);
    this.resolved.add(index);
    const { outcome, points } = scoreRound(you, opp, 'standard');
    const cpuPoints = scoreCpuRound(you, opp, 'standard');
    const event = {
      type: 'round',
      round: index,
      hands: { you, opp },
      outcome,
      points,
      cpuPoints,
    };
    this.emit(event);
    return event;
  }

  sendStamp(id) {
    if (!this.matchName) return false;
    this.client.broadcast(this.matchName, 'stamp', { from: this.client.clientId, id });
    return true;
  }

  /* --- パーティーバトル（2〜4人・5回戦） --------------------------- */

  openParty({ code, profile = {}, mode = 'create' } = {}) {
    this.reset();
    this.mode = 'party';
    this.rounds = PARTY_ROUNDS;
    this.profile = { ...profile };
    this.partyMode = mode;
    const name = partyChannel(code);
    this.channel = name;
    this.partyOver = false;
    this.openChannel(name, this.meta({ mode: 'party', joined: this.now() }), {
      onStatus: (status) => {
        if (status === 'error') this.emit({ type: 'error', reason: 'party-join' });
      },
      onPresence: ({ members }) => this.handlePartyPresence(members),
      onBroadcast: (event, payload) => this.handlePartyBroadcast(event, payload),
    });
    return name;
  }

  handlePartyPresence(members) {
    const mine = this.client.clientId;
    const roster = members
      .filter((member) => member && member.key)
      .map((member) => {
        if (member.nickname) this.knownNames.set(member.key, String(member.nickname).slice(0, 12));
        return {
          key: member.key,
          nickname: member.nickname || this.knownNames.get(member.key) || 'PLAYER',
          countryCode: member.countryCode || 'JP',
          pro: Boolean(member.pro),
        };
      })
      .sort((a, b) => String(a.key).localeCompare(String(b.key)));
    this.presence = roster;
    if (!roster.some((player) => player.key === mine)) return;
    const wasHost = this.host;
    this.host = roster[0].key === mine;
    if (this.started && wasHost !== this.host && this.partyRound >= 0 && !this.partyOver) {
      /* ホストが抜けたら、次の人が引き継ぐのではなく安全に終了する（結果の食い違いを防ぐ） */
      if (!this.host) {
        this.emit({ type: 'party-end', reason: 'host-left', standings: this.standings() });
        this.partyOver = true;
        return;
      }
    }
    if (this.started && roster.length < PARTY_MIN_PLAYERS) {
      this.emit({ type: 'party-end', reason: 'players-left', standings: this.standings() });
      this.partyOver = true;
      return;
    }
    this.players = roster;
    this.emit({
      type: 'party-lobby',
      isHost: this.host,
      players: roster,
      max: PARTY_MAX_PLAYERS,
      min: PARTY_MIN_PLAYERS,
      started: Boolean(this.started),
      round: this.partyRound,
    });
  }

  handlePartyBroadcast(event, payload) {
    const mine = this.client.clientId;
    if (!payload || typeof payload !== 'object') return;
    if (payloadTooLarge(payload)) return;

    if (event === 'party-start') {
      if (payload.from === mine) return;
      this.started = true;
      this.rounds = Number(payload.rounds) === PARTY_ROUNDS ? PARTY_ROUNDS : PARTY_ROUNDS;
      this.partyRound = -1;
      this.partyPoints = new Map(this.players.map((player) => [player.key, 0]));
      this.emit({ type: 'party-started', round: 0, players: this.players });
      return;
    }
    if (event === 'party-pick') {
      if (payload.from === mine) return;
      const round = Number(payload.round);
      if (!Number.isInteger(round) || round < 0 || round >= this.rounds) return;
      if (!getRuleset('standard').hands.includes(payload.hand)) return;
      const key = `${payload.from}:${round}`;
      if (this.partyPicks.has(key)) return;
      this.partyPicks.set(key, payload.hand);
      this.emit({ type: 'party-pick', from: payload.from, round, count: this.partyPickCount(round) });
      /* ホストは、全員の手が揃った時点で配る */
      if (this.host && this.partyRound === round) this.maybeReveal(round, { complete: false });
      return;
    }
    if (event === 'party-reveal') {
      /* 採点はホストが配る手で全員同じになる（タイムアウトのランダムも一致する） */
      const round = Number(payload.round);
      if (!Number.isInteger(round) || round < 0 || round >= this.rounds) return;
      const picks = payload.picks && typeof payload.picks === 'object' ? payload.picks : {};
      const hands = {};
      for (const player of this.players) {
        const hand = picks[player.key];
        if (getRuleset('standard').hands.includes(hand)) hands[player.key] = hand;
      }
      if (Object.keys(hands).length < PARTY_MIN_PLAYERS) return;
      this.applyPartyRound(round, hands);
      return;
    }
    if (event === 'party-final') {
      if (this.partyOver) return;
      this.partyOver = true;
      const standings = Array.isArray(payload.standings) && payload.standings.length
        ? payload.standings
        : this.standings();
      this.emit({ type: 'party-end', reason: 'finished', standings });
      return;
    }
  }

  partyPickCount(round) {
    let count = 0;
    for (const [key, value] of this.partyPicks) {
      if (key.endsWith(`:${round}`) && value) count += 1;
    }
    return count;
  }

  startParty() {
    if (this.mode !== 'party' || !this.host) return false;
    if (this.players.length < PARTY_MIN_PLAYERS) return false;
    this.started = true;
    this.partyRound = -1;
    this.partyPoints = new Map(this.players.map((player) => [player.key, 0]));
    this.client.broadcast(this.channel, 'party-start', {
      from: this.client.clientId,
      rounds: PARTY_ROUNDS,
    });
    this.emit({ type: 'party-started', round: 0, players: this.players });
    return true;
  }

  /** パーティーの1手（全員が同じ5秒で出す） */
  partyPick(round, hand, { timeout = false } = {}) {
    if (this.mode !== 'party' || this.partyOver) return false;
    const index = Number(round);
    if (!Number.isInteger(index) || index < 0 || index >= this.rounds) return false;
    if (!getRuleset('standard').hands.includes(hand)) return false;
    const key = `${this.client.clientId}:${index}`;
    if (this.partyPicks.has(key)) return false;
    this.partyPicks.set(key, hand);
    this.client.broadcast(this.channel, 'party-pick', {
      from: this.client.clientId,
      round: index,
      hand,
      timeout: Boolean(timeout),
    });
    this.emit({ type: 'party-pick', from: this.client.clientId, round: index, count: this.partyPickCount(index) });
    if (this.host) this.maybeReveal(index, { complete: false });
    return true;
  }

  /**
   * ホストの締め。全員の手が揃ったらすぐ、揃わなければ 5秒 + 1.5秒の猶予で
   * 欠けた手をランダムで補って配る（全員が同じ結果を見る）。
   */
  maybeReveal(round, { complete = false } = {}) {
    const index = Number(round);
    if (this.mode !== 'party' || !this.host || this.partyOver) return null;
    if (this.partyRound !== index) {
      this.partyRound = index;
      this.partyPicks = new Map([...this.partyPicks].filter(([key]) => key.endsWith(`:${index}`)));
      if (this.partyTimer) this.clear(this.partyTimer);
      this.partyTimer = this.schedule(() => {
        this.partyTimer = null;
        this.maybeReveal(index, { complete: true });
      }, ONLINE_TURN_MS + OPPONENT_GRACE_MS);
      this.emit({ type: 'party-round-start', round: index, players: this.players });
    }
    const picks = {};
    let missing = false;
    for (const player of this.players) {
      const hand = this.partyPicks.get(`${player.key}:${index}`);
      if (hand) picks[player.key] = hand;
      else missing = true;
    }
    if (missing && !complete) return null;
    if (missing) {
      for (const player of this.players) {
        if (!picks[player.key]) picks[player.key] = resolveTimeout('standard', this.random).hand;
      }
    }
    if (this.partyTimer) {
      this.clear(this.partyTimer);
      this.partyTimer = null;
    }
    this.client.broadcast(this.channel, 'party-reveal', {
      from: this.client.clientId,
      round: index,
      picks,
    });
    this.applyPartyRound(index, picks);
    return picks;
  }

  applyPartyRound(round, hands) {
    if (this.partyRevealed?.has(round)) return null;
    this.partyRevealed = this.partyRevealed ?? new Set();
    this.partyRevealed.add(round);
    const score = scorePartyRound(hands);
    for (const [key, points] of Object.entries(score.points)) {
      this.partyPoints.set(key, (this.partyPoints.get(key) ?? 0) + points);
    }
    const event = {
      type: 'party-round',
      round,
      hands,
      winners: score.winners,
      points: score.points,
      myPoints: score.points[this.client.clientId] ?? 0,
      threeWay: score.threeWay,
      allSame: score.allSame,
      standings: this.standings(),
      last: round >= this.rounds - 1,
    };
    this.emit(event);
    if (round >= this.rounds - 1) {
      this.partyOver = true;
      const standings = this.standings();
      if (this.host) {
        this.client.broadcast(this.channel, 'party-final', {
          from: this.client.clientId,
          standings,
        });
      }
      this.emit({ type: 'party-end', reason: 'finished', standings });
    }
    return event;
  }

  standings() {
    const players = this.players.map((player) => ({
      id: player.key,
      nickname: player.nickname,
      countryCode: player.countryCode,
      points: this.partyPoints.get(player.key) ?? 0,
      isYou: player.key === this.client.clientId,
    }));
    return partyStandings(players);
  }

  /* --- 共通 ------------------------------------------------------- */

  reset() {
    if (this.channel) this.client.unsubscribe(this.channel);
    if (this.waitTimer) this.clear(this.waitTimer);
    if (this.tickTimer) this.clear(this.tickTimer);
    if (this.partyTimer) this.clear(this.partyTimer);
    this.waitTimer = null;
    this.tickTimer = null;
    this.partyTimer = null;
    this.mode = null;
    this.channel = null;
    this.matchName = null;
    this.host = false;
    this.opponent = null;
    this.myPicks = new Map();
    this.oppPicks = new Map();
    this.seen = new Set();
    this.resolved = new Set();
    this.presence = [];
    this.players = [];
    this.partyPoints = new Map();
    this.partyPicks = new Map();
    this.partyRevealed = new Set();
    this.partyRound = -1;
    this.partyOver = false;
    this.started = false;
    this.opponentSeen = false;
    this.leftNotified = false;
    this.remainingMs = 0;
    this.deadline = 0;
    this.lastStampAt = 0;
    this.trackMeta = new Map();
    this.knownNames = new Map();
  }

  /** 退出（相手に bye を送ってからチャンネルを離れる） */
  leave({ bye = true } = {}) {
    if (bye && this.matchName) {
      this.client.broadcast(this.matchName, 'bye', { from: this.client.clientId });
    }
    this.reset();
    this.emit({ type: 'left' });
  }
}

/* ------------------------------------------------------------------ *\
 * ランキングの受け渡し（ローカル保存 + Supabase 連携口）
 *
 * `games-realtime` は Realtime 専用でテーブルを持たないため、ランキングは
 * チャンネル上の broadcast で「自分の行」を配り合い、受け取った行を端末に
 * キャッシュして順位に混ぜる。誰も答えなければローカルのライバルだけで
 * 表示する（安全なフォールバック。テストもこの経路で動く）。
 * ------------------------------------------------------------------ */

export const RANK_CACHE_KEY = 'janken-pon.peers.v1';
export const RANK_FRESH_MS = 10 * 60 * 1000;

export function mergeRows(local = [], peers = []) {
  const byId = new Map();
  for (const row of local) if (row && row.id) byId.set(row.id, row);
  for (const row of peers) {
    if (!row || !row.id) continue;
    const existing = byId.get(row.id);
    /* 同じIDは新しい updated_at を優先（自分の行はローカルが正） */
    if (!existing) byId.set(row.id, row);
    else if (row.updatedAt && existing.updatedAt && row.updatedAt > existing.updatedAt) byId.set(row.id, row);
  }
  return [...byId.values()];
}

export function readRankCache(backend = typeof localStorage !== 'undefined' ? localStorage : null, { now = Date.now(), freshMs = RANK_FRESH_MS } = {}) {
  if (!backend) return [];
  try {
    const raw = backend.getItem(RANK_CACHE_KEY);
    if (!raw) return [];
    const saved = JSON.parse(raw);
    if (!saved || !Array.isArray(saved.rows)) return [];
    if (now - Number(saved.savedAt ?? 0) > freshMs) return [];
    return saved.rows.filter((row) => row && typeof row.id === 'string');
  } catch {
    return [];
  }
}

export function writeRankCache(rows, backend = typeof localStorage !== 'undefined' ? localStorage : null, at = Date.now()) {
  if (!backend) return false;
  try {
    backend.setItem(RANK_CACHE_KEY, JSON.stringify({ savedAt: at, rows: rows.slice(0, 200) }));
    return true;
  } catch {
    return false;
  }
}

export class RankingNet {
  constructor({ client, onRows = () => {}, backend = typeof localStorage !== 'undefined' ? localStorage : null, now = () => Date.now(), schedule = setTimeout, clear = clearTimeout, windowMs = 2500 } = {}) {
    this.client = client;
    this.onRows = onRows;
    this.backend = backend;
    this.now = now;
    this.schedule = (fn, ms) => schedule(fn, ms);
    this.clear = (id) => clear(id);
    this.windowMs = windowMs;
    this.channel = null;
    this.peers = new Map();
    this.timer = null;
  }

  cached() {
    return readRankCache(this.backend, { now: this.now() });
  }

  /** 自分の行を配り、少しの間だけ他の行を集める */
  open({ division = '5', scope = 'domestic', row = null } = {}) {
    this.close();
    this.channel = rankChannel({ division, scope });
    this.client.subscribe(this.channel, {
      onBroadcast: (event, payload) => {
        if (event !== 'row' || !payload || !payload.row || typeof payload.row !== 'object') return;
        if (payloadTooLarge(payload)) return;
        const incoming = payload.row;
        if (typeof incoming.id !== 'string' || incoming.id.length > 40) return;
        this.peers.set(incoming.id, {
          ...incoming,
          nickname: String(incoming.nickname ?? 'PLAYER').slice(0, 16),
          countryCode: String(incoming.countryCode ?? 'JP').toUpperCase().slice(0, 2),
          points: Math.max(0, Math.round(Number(incoming.points) || 0)),
          monthlyPoints: Math.max(0, Math.round(Number(incoming.monthlyPoints) || 0)),
          weeklyPoints: Math.max(0, Math.round(Number(incoming.weeklyPoints) || 0)),
          matches: Math.max(0, Math.round(Number(incoming.matches) || 0)),
          winRate: Math.min(1, Math.max(0, Number(incoming.winRate) || 0)),
          updatedAt: Number(incoming.updatedAt) || this.now(),
        });
      },
    });
    if (row) this.publish(row);
    this.timer = this.schedule(() => {
      this.timer = null;
      const rows = [...this.peers.values()];
      writeRankCache(rows, this.backend, this.now());
      this.onRows(rows);
    }, this.windowMs);
    return this.channel;
  }

  publish(row) {
    if (!this.channel || !row) return false;
    return this.client.broadcast(this.channel, 'row', { row });
  }

  close() {
    if (this.timer) this.clear(this.timer);
    this.timer = null;
    if (this.channel) this.client.unsubscribe(this.channel);
    this.channel = null;
    this.peers.clear();
  }
}
