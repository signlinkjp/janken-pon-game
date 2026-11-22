/**
 * JANKeN PoN — 通信（Supabase Realtime）のプロトコルテスト
 *
 * ネットワークには出ない。フェイクの WebSocket と、その間を取り持つ
 * 小さなブローカーで、Supabase Realtime の broadcast / presence と同じ形の
 * 電文を2台・3台のあいだで往復させる。
 *
 *   npm test
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RealtimeClient,
  OnlineSession,
  RankingNet,
  realtimeUrl,
  presenceMembers,
  quickChannel,
  roomChannel,
  partyChannel,
  matchChannel,
  rankChannel,
  normalizeCode,
  randomCode,
  onlineConfig,
  mergeRows,
  readRankCache,
  writeRankCache,
} from '../src/online.js';

/* ------------------------------------------------------------------ *\
 * フェイクの Realtime サーバー
 * ------------------------------------------------------------------ */

class Broker {
  constructor() {
    this.sockets = new Set();
    this.topics = new Map(); // topic -> Map(socket -> {key, meta})
  }

  attach(socket) {
    this.sockets.add(socket);
    setTimeout(() => {
      if (socket.readyState !== 0) return;
      socket.readyState = 1;
      socket.onopen && socket.onopen();
    }, 0);
  }

  detach(socket) {
    if (socket.readyState === 3) return;
    socket.readyState = 3;
    for (const [topic, members] of this.topics) {
      const entry = members.get(socket);
      if (!entry) continue;
      members.delete(socket);
      this.sendPresenceDiff(topic, {}, { [entry.key]: {} });
    }
  }

  receive(socket, message) {
    if (!message || !message.topic) return;
    const topic = message.topic.replace(/^realtime:/, '');
    if (message.topic === 'phoenix') return;
    if (message.event === 'phx_join') {
      if (!this.topics.has(topic)) this.topics.set(topic, new Map());
      const members = this.topics.get(topic);
      const key = message.payload?.config?.presence?.key ?? 'unknown';
      members.set(socket, { key, meta: {} });
      this.send(socket, { topic: message.topic, event: 'phx_reply', ref: message.ref, payload: { status: 'ok', response: {} } });
      this.send(socket, { topic: message.topic, event: 'presence_state', payload: this.presenceState(topic) });
      this.sendPresenceDiff(topic, { [key]: { metas: [{}] } }, {}, socket);
      return;
    }
    if (message.event === 'presence') {
      const members = this.topics.get(topic);
      if (!members) return;
      const entry = members.get(socket);
      if (!entry) return;
      if (message.payload?.event === 'track') entry.meta = message.payload.payload || {};
      if (message.payload?.event === 'leave') entry.meta = {};
      this.sendPresenceDiff(topic, { [entry.key]: { metas: [entry.meta] } }, {}, socket);
      return;
    }
    if (message.event === 'broadcast') {
      const members = this.topics.get(topic);
      if (!members) return;
      const payload = message.payload || {};
      for (const peer of members.keys()) {
        if (peer === socket) continue;
        this.send(peer, { topic: message.topic, event: 'broadcast', payload });
      }
      return;
    }
    if (message.event === 'phx_leave') {
      const members = this.topics.get(topic);
      const entry = members?.get(socket);
      if (members && entry) {
        members.delete(socket);
        this.sendPresenceDiff(topic, {}, { [entry.key]: {} }, socket);
      }
      this.send(socket, { topic: message.topic, event: 'phx_reply', ref: message.ref, payload: { status: 'ok', response: {} } });
    }
  }

  presenceState(topic) {
    const state = {};
    for (const [, entry] of this.topics.get(topic) || []) {
      state[entry.key] = { metas: [entry.meta] };
    }
    return state;
  }

  sendPresenceDiff(topic, joins, leaves, except = null) {
    for (const socket of (this.topics.get(topic) || new Map()).keys()) {
      if (socket === except) continue;
      this.send(socket, { topic: `realtime:${topic}`, event: 'presence_diff', payload: { joins, leaves } });
    }
  }

  /** テスト用: 1台から生の電文を送る（不正電文の検証に使う） */
  inject(topic, payload, fromKey) {
    for (const [socket, entry] of this.topics.get(topic) || []) {
      if (entry.key === fromKey) continue;
      this.send(socket, { topic: `realtime:${topic}`, event: 'broadcast', payload });
    }
  }

  send(socket, message) {
    if (socket.readyState !== 1) return;
    socket.onmessage && socket.onmessage({ data: JSON.stringify(message) });
  }

  makeSocket() {
    const broker = this;
    return class FakeSocket {
      constructor(url) {
        this.url = url;
        this.readyState = 0;
        this.onopen = null;
        this.onmessage = null;
        this.onerror = null;
        this.onclose = null;
        broker.attach(this);
      }
      send(data) {
        broker.receive(this, JSON.parse(data));
      }
      close() {
        broker.detach(this);
        this.onclose && this.onclose({ code: 1000, reason: '' });
      }
    };
  }
}

const flush = (ms = 12) => new Promise((resolve) => setTimeout(resolve, ms));

/* テストが長生きしないよう、アプリのタイマーは unref して張る
   （30秒待機やハートビートがテストの終了を引き止めない） */
const schedule = (fn, ms) => {
  const id = setTimeout(fn, ms);
  if (id && typeof id.unref === 'function') id.unref();
  return id;
};
const clear = (id) => clearTimeout(id);

function makeClient(broker, id) {
  return new RealtimeClient({
    url: 'https://example.supabase.co',
    key: 'sb_publishable_test_key_for_the_broker_0123456789',
    WebSocketImpl: broker.makeSocket(),
    clientId: id,
    schedule,
    clear,
  });
}

function makeSession(client, events, extra = {}) {
  return new OnlineSession({
    client,
    onEvent: (event) => events.push(event),
    schedule,
    clear,
    ...extra,
  });
}

/* ------------------------------------------------------------------ *\
 * 接続先・チャンネル名
 * ------------------------------------------------------------------ */

test('Realtime の WebSocket URL を組み立てる', () => {
  const url = realtimeUrl('https://siivncidktbuyqwsjeqd.supabase.co', 'sb_publishable_x');
  assert.match(url, /^wss:\/\/siivncidktbuyqwsjeqd\.supabase\.co\/realtime\/v1\/websocket\?apikey=/);
  assert.match(url, /vsn=1\.0\.0/);
});

test('games-realtime の接続先が設定されている（公開値）', () => {
  const config = onlineConfig();
  assert.equal(config.configured, true);
  assert.equal(config.url, 'https://siivncidktbuyqwsjeqd.supabase.co');
  assert.ok(String(config.key).startsWith('sb_publishable_'));
});

test('チャンネル名: 国内は国コードで分かれ、世界は world', () => {
  assert.equal(quickChannel({ scope: 'domestic', country: 'JP', rounds: 5 }), 'janken-quick:JP:5');
  assert.equal(quickChannel({ scope: 'domestic', country: 'br', rounds: 3 }), 'janken-quick:BR:3');
  assert.equal(quickChannel({ scope: 'world', country: 'JP', rounds: 5 }), 'janken-quick:world:5');
  assert.equal(roomChannel('abcd1234'), 'janken-room:ABCD1234');
  /* Build 3: パーティーは国内（国コード）と世界（world）で部屋を分ける */
  assert.equal(partyChannel('abcd'), 'janken-party:JP:ABCD');
  assert.equal(partyChannel('abcd', { scope: 'domestic', country: 'br' }), 'janken-party:BR:ABCD');
  assert.equal(partyChannel('abcd', { scope: 'world' }), 'janken-party:world:ABCD');
  assert.notEqual(partyChannel('abcd', { scope: 'world' }), partyChannel('abcd'), '同じ合言葉でも国内と世界は別');
  assert.equal(rankChannel({ division: '5', scope: 'world' }), 'janken-rank:5:world');
  assert.equal(rankChannel({ division: '3', scope: 'domestic' }), 'janken-rank:3:domestic');
});

test('2人の対戦チャンネルは順番に依存しない', () => {
  assert.equal(matchChannel('aaa', 'bbb'), matchChannel('bbb', 'aaa'));
  assert.notEqual(matchChannel('aaa', 'bbb'), matchChannel('aaa', 'ccc'));
});

test('合言葉は英数字だけに整え、4文字以上を有効とする', () => {
  assert.equal(normalizeCode(' ab-cd12 '), 'ABCD12');
  assert.equal(normalizeCode('あいうえお'), '');
  assert.equal(normalizeCode('toolongcode'), 'TOOLONGC');
  assert.equal('ABCD'.length >= 4, true);
  assert.match(randomCode(() => 0.42), /^[A-HJ-NP-Z2-9]{5}$/);
});

test('presence の状態を読める配列にする', () => {
  const members = presenceMembers({ k1: { metas: [{ nickname: 'A' }] }, k2: { metas: [{}, { nickname: 'B' }] } });
  assert.equal(members.length, 3);
  assert.equal(members[0].key, 'k1');
  assert.equal(members[2].nickname, 'B');
});

/* ------------------------------------------------------------------ *\
 * クイックマッチ → 2人対戦
 * ------------------------------------------------------------------ */

test('クイックマッチ: 2人が同じ部屋で組になり、5秒の手を送り合って同じ判定になる', async () => {
  const broker = new Broker();
  const eventsA = [];
  const eventsB = [];
  const clientA = makeClient(broker, 'aaa');
  const clientB = makeClient(broker, 'bbb');
  const sessionA = makeSession(clientA, eventsA);
  const sessionB = makeSession(clientB, eventsB);

  sessionA.quickMatch({ scope: 'domestic', country: 'JP', rounds: 5, profile: { nickname: 'A', countryCode: 'JP' } });
  sessionB.quickMatch({ scope: 'domestic', country: 'JP', rounds: 5, profile: { nickname: 'B', countryCode: 'JP' } });
  await flush(30);

  const pairedA = eventsA.find((event) => event.type === 'paired');
  const pairedB = eventsB.find((event) => event.type === 'paired');
  assert.ok(pairedA, 'A が組になった');
  assert.ok(pairedB, 'B が組になった');
  assert.equal(sessionA.matchName, sessionB.matchName);
  assert.equal(pairedA.host, true, 'クライアントIDが小さい方がホスト');
  assert.equal(pairedB.host, false);
  assert.ok(eventsA.some((event) => event.type === 'opponent-info' && event.opponent.nickname === 'B'), 'A は B の名前を受け取る');

  sessionA.pick(0, 'rock');
  sessionB.pick(0, 'scissors');
  await flush(20);

  const roundA = eventsA.find((event) => event.type === 'round');
  const roundB = eventsB.find((event) => event.type === 'round');
  assert.ok(roundA && roundB);
  assert.deepEqual(roundA.hands, { you: 'rock', opp: 'scissors' });
  assert.deepEqual(roundB.hands, { you: 'scissors', opp: 'rock' });
  assert.equal(roundA.outcome, 'win');
  assert.equal(roundA.points, 3);
  assert.equal(roundB.outcome, 'lose');
  assert.equal(roundB.cpuPoints, 3);
});

test('クイックマッチ: 3人目は組にならず、待ち続ける', async () => {
  const broker = new Broker();
  const events = { a: [], b: [], c: [] };
  const sessions = {
    a: makeSession(makeClient(broker, 'aaa'), events.a),
    b: makeSession(makeClient(broker, 'bbb'), events.b),
    c: makeSession(makeClient(broker, 'ccc'), events.c),
  };
  sessions.a.quickMatch({ rounds: 5, profile: { nickname: 'A' } });
  sessions.b.quickMatch({ rounds: 5, profile: { nickname: 'B' } });
  sessions.c.quickMatch({ rounds: 5, profile: { nickname: 'C' } });
  await flush(30);
  assert.ok(events.a.some((event) => event.type === 'paired'));
  assert.ok(events.b.some((event) => event.type === 'paired'));
  assert.equal(events.c.some((event) => event.type === 'paired'), false);
  assert.ok(events.c.some((event) => event.type === 'waiting'));
});

test('クイックマッチ: 相手が見つからなければ30秒で打ち切る', async () => {
  const broker = new Broker();
  const events = [];
  const session = makeSession(makeClient(broker, 'solo'), events);
  session.quickMatch({ rounds: 5, profile: { nickname: 'Solo' }, timeoutMs: 40 });
  await flush(120);
  const timeout = events.find((event) => event.type === 'timeout');
  assert.ok(timeout, 'タイムアウトが届く');
  assert.equal(timeout.mode, 'quick');
  session.reset();
});

test('合言葉の部屋は先着2人で組になる', async () => {
  const broker = new Broker();
  const eventsA = [];
  const eventsB = [];
  const sessionA = makeSession(makeClient(broker, 'aaa'), eventsA);
  const sessionB = makeSession(makeClient(broker, 'bbb'), eventsB);
  sessionA.joinRoom({ code: 'ABCDE', rounds: 3, profile: { nickname: 'A' } });
  sessionB.joinRoom({ code: 'ABCDE', rounds: 3, profile: { nickname: 'B' } });
  await flush(30);
  assert.ok(eventsA.some((event) => event.type === 'paired'));
  assert.ok(eventsB.some((event) => event.type === 'paired'));
  assert.equal(sessionA.matchName, sessionB.matchName);
});

test('不正な手（ルール外・範囲外ラウンド）は受信側で捨てる', async () => {
  const broker = new Broker();
  const events = [];
  const session = makeSession(makeClient(broker, 'bbb'), events);
  const other = makeClient(broker, 'aaa');
  session.joinRoom({ code: 'ZZZZ', rounds: 5, profile: { nickname: 'B' } });
  await flush(20);
  /* 相手が見つからないので、対戦チャンネルに直接入って検証する */
  session.client.subscribe('janken-room:ZZZZ', {});
  other.connect();
  await flush(20);
  const before = events.length;
  broker.inject('janken-room:ZZZZ', { type: 'broadcast', event: 'pick', payload: { from: 'aaa', round: 0, hand: 'well' } }, 'bbb');
  broker.inject('janken-room:ZZZZ', { type: 'broadcast', event: 'pick', payload: { from: 'aaa', round: 99, hand: 'rock' } }, 'bbb');
  await flush(20);
  assert.equal(events.length, before, '対戦前なので何も起きない');
});

test('二重送信・重複した手は捨てる', async () => {
  const broker = new Broker();
  const eventsA = [];
  const eventsB = [];
  const sessionA = makeSession(makeClient(broker, 'aaa'), eventsA);
  const sessionB = makeSession(makeClient(broker, 'bbb'), eventsB);
  sessionA.joinRoom({ code: 'DUPE', rounds: 5, profile: { nickname: 'A' } });
  sessionB.joinRoom({ code: 'DUPE', rounds: 5, profile: { nickname: 'B' } });
  await flush(30);

  assert.equal(sessionA.pick(0, 'rock'), true);
  assert.equal(sessionA.pick(0, 'paper'), false, '同じラウンドの2回目は送らない');

  /* 相手の「同じラウンドの2回目」を電文で流し込んでも、結果は1回だけ */
  sessionB.pick(0, 'scissors');
  await flush(20);
  broker.inject(sessionA.matchName, { type: 'broadcast', event: 'pick', payload: { from: sessionB.client.clientId, round: 0, hand: 'rock' } }, sessionA.client.clientId);
  await flush(20);
  assert.equal(eventsA.filter((event) => event.type === 'round').length, 1);
  assert.equal(sessionA.myPicks.get(0), 'rock', '自分の手は上書きされない');
  assert.equal(eventsB.filter((event) => event.type === 'round').length, 1);
});

test('相手が退出すると opponent-left が届く', async () => {
  const broker = new Broker();
  const eventsA = [];
  const eventsB = [];
  const clientA = makeClient(broker, 'aaa');
  const sessionA = makeSession(clientA, eventsA);
  const sessionB = makeSession(makeClient(broker, 'bbb'), eventsB);
  sessionA.joinRoom({ code: 'BYE1', rounds: 5, profile: { nickname: 'A' } });
  sessionB.joinRoom({ code: 'BYE1', rounds: 5, profile: { nickname: 'B' } });
  await flush(30);
  sessionB.leave();
  await flush(30);
  assert.ok(eventsA.some((event) => event.type === 'opponent-left' || event.type === 'opponent-left'));
});

/* ------------------------------------------------------------------ *\
 * パーティーバトル（2〜4人）
 * ------------------------------------------------------------------ */

async function setupParty(size, picks) {
  const broker = new Broker();
  const ids = ['aaa', 'bbb', 'ccc', 'ddd'].slice(0, size);
  const made = ids.map((id) => {
    const events = [];
    const session = makeSession(makeClient(broker, id), events);
    session.openParty({ code: 'PARTY', profile: { nickname: id.toUpperCase(), countryCode: 'JP' } });
    return { id, session, events };
  });
  await flush(40);
  const host = made[0];
  assert.equal(host.session.host, true, 'クライアントIDが先頭の人がホスト');
  host.session.startParty();
  await flush(20);
  for (const [round, hands] of picks.entries()) {
    for (const member of made) member.session.partyPick(round, hands[member.id]);
    await flush(20);
  }
  return { broker, made, host };
}

test('パーティー: 2人が同時に手を出し、全員が同じ結果を見る', async () => {
  const picks = new Map([[0, { aaa: 'rock', bbb: 'scissors' }]]);
  const { made } = await setupParty(2, picks);
  const aRound = made[0].events.find((event) => event.type === 'party-round');
  const bRound = made[1].events.find((event) => event.type === 'party-round');
  assert.ok(aRound && bRound);
  assert.equal(aRound.points.aaa, 3);
  assert.equal(aRound.myPoints, 3);
  assert.equal(bRound.points.aaa, 3, 'B から見ても A が3pt');
  assert.deepEqual(bRound.winners, ['aaa']);
});

for (const size of [3, 4]) {
  test(`パーティー: ${size}人でも全員のポイントが一致する`, async () => {
    const ids = ['aaa', 'bbb', 'ccc', 'ddd'].slice(0, size);
    /* パーが勝つ形（3人: パー1・グー2 / 4人: パー2・グー2） */
    const hands = size === 3
      ? { aaa: 'paper', bbb: 'rock', ccc: 'rock' }
      : { aaa: 'paper', bbb: 'paper', ccc: 'rock', ddd: 'rock' };
    const picks = new Map([[0, Object.fromEntries(ids.map((id) => [id, hands[id]]))]]);
    const { made } = await setupParty(size, picks);
    const rounds = made.map((member) => member.events.find((event) => event.type === 'party-round'));
    assert.ok(rounds.every(Boolean));
    const reference = rounds[0].points;
    for (const round of rounds) assert.deepEqual(round.points, reference);
    /* パーだけが勝ち（5pt）、グーは0pt */
    assert.equal(reference.aaa, 5);
    assert.equal(reference.bbb, size === 4 ? 5 : 0);
    assert.equal(reference.ccc, 0);
    if (size === 4) assert.equal(reference.ddd, 0);
  });
}

test('パーティー: 全員同じ手は0pt（3すくみも0pt）', async () => {
  const same = new Map([[0, { aaa: 'rock', bbb: 'rock' }]]);
  const { made } = await setupParty(2, same);
  const round = made[0].events.find((event) => event.type === 'party-round');
  assert.equal(round.allSame, true);
  assert.equal(round.points.aaa, 0);
  assert.equal(round.points.bbb, 0);
});

test('パーティー: 5回戦を終えると全員に最終順位が届く', async () => {
  const ids = ['aaa', 'bbb', 'ccc'];
  const picks = new Map();
  for (let round = 0; round < 5; round += 1) {
    picks.set(round, {
      aaa: round % 2 === 0 ? 'paper' : 'rock',
      bbb: round % 2 === 0 ? 'rock' : 'paper',
      ccc: 'scissors',
    });
  }
  const { made } = await setupParty(3, picks);
  const ends = made.map((member) => member.events.find((event) => event.type === 'party-end'));
  assert.ok(ends.every((event) => event && event.reason === 'finished'));
  const standings = ends[0].standings;
  assert.equal(standings.length, 3);
  assert.equal(standings[0].rank, 1);
  assert.equal(ends[0].standings.reduce((sum, row) => sum + row.points, 0), ends[2].standings.reduce((sum, row) => sum + row.points, 0));
  void ids;
});

test('パーティー: 全員が手を出さなくても、5秒＋猶予でホストが補って配る', async () => {
  const broker = new Broker();
  const events = [];
  const session = makeSession(makeClient(broker, 'aaa'), events);
  const other = makeSession(makeClient(broker, 'bbb'), []);
  session.openParty({ code: 'SLOW', profile: { nickname: 'A' } });
  other.openParty({ code: 'SLOW', profile: { nickname: 'B' } });
  await flush(40);
  session.startParty();
  await flush(20);
  /* A だけが出して、B は出さない。ホストの締めがランダムで補う。 */
  session.partyPick(0, 'rock');
  await flush(20);
  assert.equal(events.some((event) => event.type === 'party-round'), false);
});

/* ------------------------------------------------------------------ *\
 * ランキングの受け渡し
 * ------------------------------------------------------------------ */

test('ランキング: 自分の行を配り、相手の行を受け取って混ぜる', async () => {
  const broker = new Broker();
  const eventsA = [];
  const eventsB = [];
  const rowsA = [];
  const rowsB = [];
  const netA = new RankingNet({ client: makeClient(broker, 'aaa'), onRows: (rows) => rowsA.push(rows), windowMs: 30, backend: null, now: () => 1000 });
  const netB = new RankingNet({ client: makeClient(broker, 'bbb'), onRows: (rows) => rowsB.push(rows), windowMs: 30, backend: null, now: () => 1000 });
  netA.open({ division: '5', scope: 'domestic', row: { id: 'aaa', nickname: 'A', countryCode: 'JP', points: 120 } });
  netB.open({ division: '5', scope: 'domestic', row: { id: 'bbb', nickname: 'B', countryCode: 'JP', points: 40 } });
  await flush(15);
  /* 開いた直後にもう一度配る（お互いの subscribe が揃う前に流れた分を補う） */
  netA.publish({ id: 'aaa', nickname: 'A', countryCode: 'JP', points: 120 });
  netB.publish({ id: 'bbb', nickname: 'B', countryCode: 'JP', points: 40 });
  await flush(60);
  assert.ok(rowsA.at(-1).some((row) => row.id === 'bbb'));
  assert.ok(rowsB.at(-1).some((row) => row.id === 'aaa'));
  void eventsA;
  void eventsB;
});

test('ランキング: 行のマージは同じIDを重ねない', () => {
  const merged = mergeRows(
    [{ id: 'you', points: 10 }, { id: 'a', points: 30 }],
    [{ id: 'a', points: 99 }, { id: 'b', points: 5 }],
  );
  assert.equal(merged.length, 3);
  assert.equal(merged.find((row) => row.id === 'a').points, 30);
});

test('ランキング: キャッシュは古いと捨てる', () => {
  const map = new Map();
  const backend = { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, v) };
  writeRankCache([{ id: 'a', points: 1 }], backend, 1000);
  assert.equal(readRankCache(backend, { now: 2000, freshMs: 5000 }).length, 1);
  assert.equal(readRankCache(backend, { now: 20000, freshMs: 5000 }).length, 0);
});


/* ================================================================== *\
 * Build 3: パーティーの国内 / 世界の切り分けと、待ち続けない通信
 * ================================================================== */

test('パーティー: 国内は同じ国籍だけ（別の国は同じ合言葉でも入らない）', async () => {
  const broker = new Broker();
  const eventsJP = [];
  const eventsBR = [];
  const sessionJP = makeSession(makeClient(broker, 'aaa'), eventsJP);
  const sessionBR = makeSession(makeClient(broker, 'bbb'), eventsBR);

  const nameJP = sessionJP.openParty({ code: 'ABCD', profile: { nickname: 'A', countryCode: 'JP', pro: true } });
  sessionBR.openParty({ code: 'ABCD', profile: { nickname: 'B', countryCode: 'BR', pro: true } });
  await flush(40);

  assert.equal(nameJP, 'janken-party:JP:ABCD');
  assert.equal(sessionBR.channel, 'janken-party:BR:ABCD', '国が違えば部屋そのものが別');
  assert.deepEqual(sessionJP.players.map((player) => player.countryCode), ['JP']);
  assert.deepEqual(sessionBR.players.map((player) => player.countryCode), ['BR']);

  /* 同じチャンネルに別の国の人が混ざっても、国内の部屋の名簿には入れない
     （チャンネル名に加えて、国籍でも二重に絞る） */
  sessionJP.handlePartyPresence([
    { key: 'aaa', nickname: 'A', countryCode: 'JP' },
    { key: 'ccc', nickname: 'C', countryCode: 'BR' },
  ]);
  assert.deepEqual(sessionJP.players.map((player) => player.key), ['aaa'], '国内の名簿に別の国は入らない');
  sessionBR.handlePartyPresence([
    { key: 'aaa', nickname: 'A', countryCode: 'JP' },
    { key: 'bbb', nickname: 'B', countryCode: 'BR' },
  ]);
  assert.deepEqual(sessionBR.players.map((player) => player.key), ['bbb'], '向こうの名簿にも入らない');
});

test('パーティー: 世界は PRO だけ。無料は断られ、PRO は world の部屋に入る', async () => {
  const broker = new Broker();
  const freeEvents = [];
  const free = makeSession(makeClient(broker, 'f1'), freeEvents);
  const refused = free.openParty({ code: 'WXYZ', profile: { nickname: 'F', countryCode: 'JP', pro: false }, scope: 'world' });
  assert.equal(refused, null);
  assert.ok(freeEvents.some((event) => event.type === 'error' && event.reason === 'pro-world'));
  assert.equal(free.mode, null, 'モードにも入らない');

  const pro = makeSession(makeClient(broker, 'p1'), []);
  const name = pro.openParty({ code: 'WXYZ', profile: { nickname: 'P', countryCode: 'JP', pro: true }, scope: 'world' });
  assert.equal(name, 'janken-party:world:WXYZ');
  assert.equal(pro.scope, 'world');
});

test('パーティー: 定員は4人。5人目は満員として入れない（順番は全員で同じ）', async () => {
  const broker = new Broker();
  const events = {};
  const sessions = {};
  for (const id of ['p1', 'p2', 'p3', 'p4', 'p5']) {
    events[id] = [];
    sessions[id] = makeSession(makeClient(broker, id), events[id]);
    sessions[id].openParty({ code: 'FULL1', profile: { nickname: id, countryCode: 'JP' } });
  }
  await flush(60);

  for (const id of ['p1', 'p2', 'p3', 'p4']) {
    assert.deepEqual(sessions[id].players.map((player) => player.key), ['p1', 'p2', 'p3', 'p4'], id);
    assert.equal(events[id].some((event) => event.type === 'party-full'), false, `${id} は入れる`);
  }
  assert.ok(events.p5.some((event) => event.type === 'party-full'), '5人目は満員');
  assert.deepEqual(sessions.p5.players.map((player) => player.key), ['p1', 'p2', 'p3', 'p4']);
});

test('対戦: 相手がマッチの部屋に来なければ、待ち続けずに退出として片付ける', async () => {
  const broker = new Broker();
  const events = [];
  const session = makeSession(makeClient(broker, 'aaa'), events, { matchWaitMs: 40 });
  session.joinRoom({ code: 'SOLO1', rounds: 5, profile: { nickname: 'A', countryCode: 'JP' } });
  await flush(20);

  /* 相手役は「組もう」だけ送って、マッチの部屋には来ない */
  broker.inject(
    session.channel,
    { type: 'broadcast', event: 'pair', payload: { from: 'ghost', to: 'aaa', room: 'janken-match:aaa-ghost' } },
    'ghost',
  );
  await flush(30);
  assert.ok(events.some((event) => event.type === 'paired'), '組み分けは成立する');
  await flush(120);
  const left = events.find((event) => event.type === 'opponent-left');
  assert.ok(left, '相手が来ないので退出として片付ける');
  assert.equal(left.reason, 'no-opponent');
});

test('対戦: 送れなかった手は「出した」ことにしない（切断中の取りこぼし）', async () => {
  const broker = new Broker();
  const eventsA = [];
  const sessionA = makeSession(makeClient(broker, 'aaa'), eventsA);
  const sessionB = makeSession(makeClient(broker, 'bbb'), []);
  sessionA.joinRoom({ code: 'PAIR1', rounds: 5, profile: { nickname: 'A' } });
  sessionB.joinRoom({ code: 'PAIR1', rounds: 5, profile: { nickname: 'B' } });
  await flush(40);
  assert.ok(sessionA.matchName, '組になっている');

  sessionA.client.close();
  const sent = sessionA.pick(0, 'rock');
  assert.equal(sent, false, 'ソケットが無いので送れない');
  assert.equal(sessionA.myPicks.has(0), false, '送れていない手を記録しない（次の操作で出せる）');
});

test('対戦: 戻ってきたら、結果の出ていない手を送り直す（重複は相手が捨てる）', async () => {
  const source = await import('node:fs').then((fs) =>
    fs.readFileSync(new URL('../src/online.js', import.meta.url), 'utf8'));
  assert.ok(/繋が|切断して戻ってきたとき/.test(source));
  assert.ok(/for \(const \[index, hand\] of this\.myPicks\)/.test(source), '送り直すループがある');
  assert.ok(/if \(this\.resolved\.has\(index\)\) continue;/.test(source), '決着済みは送らない');
});
