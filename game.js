// No-limit Texas Hold'em engine (server-authoritative)
const crypto = require('crypto');
const E = require('./public/eval.js');

const CFG = {
  START_CHIPS: 50000,
  SB: 250,
  BB: 500,
  MAX_SEATS: 6,
  TURN_MS: 30000,
  NEXT_MS: 7000,
  FOLD_NEXT_MS: 3500,
  RUNOUT_MS: 1400,
};

const rooms = new Map();
let onChange = () => {};
const setOnChange = (f) => { onChange = f; };
const changed = (room) => onChange(room);

function cleanId(id) {
  return String(id || 'main').replace(/[^\w-]/g, '').slice(0, 20) || 'main';
}
function getRoom(id) {
  id = cleanId(id);
  if (!rooms.has(id)) {
    rooms.set(id, {
      id, seats: Array(CFG.MAX_SEATS).fill(null), byToken: new Map(),
      button: -1, hand: null, handNo: 0, running: false, log: [],
      nextTimer: null, nextAt: 0, turnTimer: null, runTimer: null,
    });
  }
  return rooms.get(id);
}
function log(room, msg) {
  room.log.push({ t: Date.now(), msg });
  if (room.log.length > 80) room.log.shift();
}
const money = (n) => '$' + n.toLocaleString('en-US');
const cardStr = (c) => E.RANK_LABEL[c >> 2] + '♠♥♦♣'[c & 3];

function nextSeat(from, pred) {
  const N = CFG.MAX_SEATS;
  for (let k = 1; k <= N; k++) {
    const i = (((from + k) % N) + N) % N;
    if (pred(i)) return i;
  }
  return -1;
}
function newDeck() {
  const d = [...Array(52).keys()];
  for (let i = 51; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}
function put(p, amt) {
  amt = Math.max(0, Math.min(amt, p.chips));
  p.chips -= amt; p.bet += amt; p.total += amt;
  if (p.chips === 0) p.allIn = true;
}
const isOver = (h) => h.stage === 'showdown' || h.stage === 'done';
const handPlayers = (room) => room.hand.players.map((i) => room.seats[i]);
const livePlayers = (room) => handPlayers(room).filter((p) => !p.folded);

// ---------- lobby actions ----------
function join(room, token, name, wantSeat) {
  name = String(name || '').trim().slice(0, 12) || 'Player';
  const existing = token && room.byToken.get(token);
  if (existing) {
    existing.name = name;
    changed(room);
    return { token: existing.token, seat: existing.seat };
  }
  let seat = room.seats.findIndex((s) => !s);
  if (Number.isInteger(wantSeat) && wantSeat >= 0 && wantSeat < CFG.MAX_SEATS && !room.seats[wantSeat]) seat = wantSeat;
  if (seat < 0) return { error: `자리가 꽉 찼어요 (최대 ${CFG.MAX_SEATS}명)` };
  token = crypto.randomBytes(16).toString('hex');
  const p = {
    token, name, seat, chips: CFG.START_CHIPS, connected: false, sittingOut: false,
    inHand: false, hole: null, bet: 0, total: 0, folded: false, allIn: false,
    acted: false, raiseLocked: false, lastAction: '', timeouts: 0, leaving: false,
  };
  room.seats[seat] = p;
  room.byToken.set(token, p);
  log(room, `${name} 님이 입장했습니다`);
  maybeStart(room);
  changed(room);
  return { token, seat };
}

function removePlayer(room, p) {
  if (room.seats[p.seat] === p) room.seats[p.seat] = null;
  room.byToken.delete(p.token);
}

function leave(room, token) {
  const p = room.byToken.get(token);
  if (!p) return { error: '플레이어를 찾을 수 없어요' };
  const h = room.hand;
  log(room, `${p.name} 님이 나갔습니다`);
  if (h && h.players.includes(p.seat)) {
    p.leaving = true;
    if (!isOver(h) && !p.folded) {
      if (h.toAct === p.seat) return act(room, token, 'fold', null, true);
      p.folded = true; p.lastAction = '폴드';
      const live = livePlayers(room);
      if (live.length === 1) return winUncontested(room, live[0]);
    }
  } else removePlayer(room, p);
  changed(room);
  return { ok: true };
}

function start(room) {
  if (room.running) return { ok: true };
  const n = room.seats.filter((p) => p && p.chips > 0 && !p.sittingOut).length;
  if (n < 2) return { error: '최소 2명이 앉아 있어야 시작할 수 있어요' };
  room.running = true;
  log(room, '게임을 시작합니다');
  startHand(room);
  return { ok: true };
}

function toggleSitOut(room, token) {
  const p = room.byToken.get(token);
  if (!p) return { error: '플레이어를 찾을 수 없어요' };
  p.sittingOut = !p.sittingOut;
  p.timeouts = 0;
  log(room, `${p.name} 님이 ${p.sittingOut ? '자리를 비웠습니다' : '돌아왔습니다'}`);
  if (!p.sittingOut) maybeStart(room);
  changed(room);
  return { ok: true };
}

function rebuy(room, token) {
  const p = room.byToken.get(token);
  if (!p) return { error: '플레이어를 찾을 수 없어요' };
  if (p.chips > 0) return { error: '칩이 다 떨어졌을 때만 다시 받을 수 있어요' };
  const h = room.hand;
  if (h && h.players.includes(p.seat) && !isOver(h)) return { error: '이번 핸드가 끝난 뒤에 받을 수 있어요' };
  p.chips = CFG.START_CHIPS;
  log(room, `${p.name} 님이 ${money(CFG.START_CHIPS)}로 다시 시작합니다`);
  maybeStart(room);
  changed(room);
  return { ok: true };
}

function setConnected(room, token, on) {
  const p = room.byToken.get(token);
  if (p && p.connected !== on) { p.connected = on; changed(room); }
}

function maybeStart(room) {
  if (room.running && (!room.hand || isOver(room.hand)) && !room.nextTimer) scheduleNext(room, 1500);
}
function scheduleNext(room, ms) {
  clearTimeout(room.nextTimer);
  room.nextAt = Date.now() + ms;
  room.nextTimer = setTimeout(() => startHand(room), ms);
}

// ---------- hand flow ----------
function startHand(room) {
  clearTimeout(room.nextTimer); clearTimeout(room.turnTimer); clearTimeout(room.runTimer);
  room.nextTimer = null; room.nextAt = 0;
  room.seats.forEach((p) => { if (p && p.leaving) removePlayer(room, p); });

  const elig = (i) => { const p = room.seats[i]; return !!p && p.chips > 0 && !p.sittingOut; };
  const seatsIn = [...Array(CFG.MAX_SEATS).keys()].filter(elig);
  room.seats.forEach((p) => {
    if (!p) return;
    Object.assign(p, { inHand: false, hole: null, bet: 0, total: 0, folded: false, allIn: false, acted: false, raiseLocked: false, lastAction: '' });
  });
  if (seatsIn.length < 2) { room.hand = null; changed(room); return; }

  room.handNo++;
  const btn = nextSeat(room.button, elig);
  room.button = btn;
  const headsUp = seatsIn.length === 2;
  const sb = headsUp ? btn : nextSeat(btn, elig);
  const bb = nextSeat(sb, elig);
  const deck = newDeck();
  const h = {
    deck, board: [], stage: 'preflop', sb, bb, players: seatsIn,
    currentBet: 0, minRaise: CFG.BB, toAct: -1, deadline: 0, results: null, revealAll: false,
  };
  room.hand = h;
  for (const i of seatsIn) {
    const p = room.seats[i];
    p.inHand = true;
    p.hole = [deck.pop(), deck.pop()];
  }
  put(room.seats[sb], CFG.SB); room.seats[sb].lastAction = 'SB';
  put(room.seats[bb], CFG.BB); room.seats[bb].lastAction = 'BB';
  h.currentBet = Math.max(room.seats[sb].bet, room.seats[bb].bet);
  log(room, `── 핸드 #${room.handNo} · 딜러 ${room.seats[btn].name} ──`);
  advance(room, bb);
}

function advance(room, from) {
  const h = room.hand;
  const live = livePlayers(room);
  if (live.length === 1) return winUncontested(room, live[0]);
  const canAct = live.filter((p) => !p.allIn);
  const pending = canAct.filter((p) => !p.acted || p.bet < h.currentBet);
  let complete = pending.length === 0;
  if (!complete && canAct.length === 1 && canAct[0].bet >= h.currentBet) complete = true;
  if (complete) return endRound(room);
  h.toAct = nextSeat(from, (i) => pending.some((p) => p.seat === i));
  h.deadline = Date.now() + CFG.TURN_MS;
  setTurnTimer(room);
  changed(room);
}

function endRound(room) {
  const h = room.hand;
  clearTimeout(room.turnTimer);
  for (const p of handPlayers(room)) {
    p.bet = 0; p.acted = false; p.raiseLocked = false;
    if (!p.folded && !p.allIn) p.lastAction = '';
  }
  h.currentBet = 0; h.minRaise = CFG.BB; h.toAct = -1;
  if (h.stage === 'river') return showdown(room);
  const canAct = livePlayers(room).filter((p) => !p.allIn);
  if (canAct.length <= 1) return runOut(room);
  dealNext(room);
  advance(room, room.button);
}

function dealNext(room) {
  const h = room.hand;
  h.deck.pop(); // burn
  if (h.board.length === 0) { h.board.push(h.deck.pop(), h.deck.pop(), h.deck.pop()); h.stage = 'flop'; }
  else { h.board.push(h.deck.pop()); h.stage = h.board.length === 4 ? 'turn' : 'river'; }
  const label = { flop: '플랍', turn: '턴', river: '리버' }[h.stage];
  log(room, `${label}: ${h.board.map(cardStr).join(' ')}`);
}

function runOut(room) {
  const h = room.hand;
  h.revealAll = true; h.toAct = -1;
  changed(room);
  const step = () => {
    if (room.hand !== h) return;
    if (h.board.length >= 5) return showdown(room);
    dealNext(room);
    changed(room);
    room.runTimer = setTimeout(step, CFG.RUNOUT_MS);
  };
  room.runTimer = setTimeout(step, CFG.RUNOUT_MS);
}

function orderFromButton(room, seats) {
  const N = CFG.MAX_SEATS;
  return [...seats].sort((a, b) => ((a - room.button - 1 + N) % N) - ((b - room.button - 1 + N) % N));
}

function showdown(room) {
  const h = room.hand;
  clearTimeout(room.turnTimer);
  h.stage = 'showdown'; h.toAct = -1; h.revealAll = true;
  const P = handPlayers(room);
  const scores = new Map();
  for (const p of P) if (!p.folded) scores.set(p.seat, E.evaluate([...p.hole, ...h.board]));

  // build main + side pots from total contributions
  const contrib = P.map((p) => ({ p, amt: p.total }));
  const pots = [];
  while (contrib.some((c) => c.amt > 0)) {
    const live = contrib.filter((c) => c.amt > 0 && !c.p.folded);
    if (!live.length) {
      const rest = contrib.reduce((s, c) => s + c.amt, 0);
      contrib.forEach((c) => { c.amt = 0; });
      if (pots.length) pots[pots.length - 1].amount += rest;
      break;
    }
    const lvl = Math.min(...live.map((c) => c.amt));
    let amount = 0;
    for (const c of contrib) { const t = Math.min(c.amt, lvl); amount += t; c.amt -= t; }
    const eligible = live.map((c) => c.p.seat);
    const prev = pots[pots.length - 1];
    if (prev && prev.eligible.length === eligible.length && prev.eligible.every((s) => eligible.includes(s))) prev.amount += amount;
    else pots.push({ amount, eligible });
  }

  const won = {};
  const results = [];
  for (const pot of pots) {
    let best = -1;
    for (const s of pot.eligible) best = Math.max(best, scores.get(s));
    const winners = orderFromButton(room, pot.eligible.filter((s) => scores.get(s) === best));
    const share = Math.floor(pot.amount / winners.length);
    let rem = pot.amount - share * winners.length;
    for (const s of winners) {
      const amt = share + (rem > 0 ? 1 : 0);
      if (rem > 0) rem--;
      room.seats[s].chips += amt;
      won[s] = (won[s] || 0) + amt;
    }
    results.push({ amount: pot.amount, winners, hand: E.describe(best), single: pot.eligible.length === 1 });
  }
  for (const p of P) { p.bet = 0; }
  h.results = { pots: results, won };
  for (const r of results) {
    const names = r.winners.map((s) => room.seats[s].name).join(', ');
    log(room, r.single ? `${names} 님이 ${money(r.amount)} 회수` : `${names} 님 승리 · ${r.hand} · ${money(r.amount)}`);
  }
  scheduleNext(room, CFG.NEXT_MS);
  changed(room);
}

function winUncontested(room, p) {
  const h = room.hand;
  clearTimeout(room.turnTimer); clearTimeout(room.runTimer);
  const total = handPlayers(room).reduce((s, q) => s + q.total, 0);
  p.chips += total;
  for (const q of handPlayers(room)) q.bet = 0;
  h.stage = 'done'; h.toAct = -1;
  h.results = { pots: [{ amount: total, winners: [p.seat], hand: null }], won: { [p.seat]: total } };
  log(room, `${p.name} 님이 ${money(total)} 획득 (모두 폴드)`);
  scheduleNext(room, CFG.FOLD_NEXT_MS);
  changed(room);
  return { ok: true };
}

function setTurnTimer(room) {
  clearTimeout(room.turnTimer);
  const h = room.hand, seat = h.toAct;
  room.turnTimer = setTimeout(() => {
    if (room.hand !== h || h.toAct !== seat) return;
    const p = room.seats[seat];
    p.timeouts++;
    if (p.timeouts >= 2 || !p.connected) p.sittingOut = true;
    log(room, `${p.name} 님 시간 초과`);
    act(room, p.token, h.currentBet - p.bet > 0 ? 'fold' : 'check', null, true);
  }, CFG.TURN_MS + 300);
}

function act(room, token, action, amount, auto) {
  const h = room.hand;
  const p = room.byToken.get(token);
  if (!h || !p || isOver(h) || h.toAct !== p.seat) return { error: '지금은 당신 차례가 아니에요' };
  const toCall = h.currentBet - p.bet;
  const doCall = () => { put(p, toCall); p.lastAction = p.allIn ? '올인' : '콜'; };

  switch (action) {
    case 'fold': p.folded = true; p.lastAction = '폴드'; break;
    case 'check':
      if (toCall > 0) return { error: '체크할 수 없어요. 콜/레이즈/폴드 중에 고르세요' };
      p.lastAction = '체크'; break;
    case 'call':
      if (toCall <= 0) p.lastAction = '체크'; else doCall();
      break;
    case 'raise':
    case 'allin': {
      const maxTo = p.bet + p.chips;
      let to = action === 'allin' ? maxTo : Math.floor(Number(amount));
      if (!Number.isFinite(to)) return { error: '금액이 올바르지 않아요' };
      if (to >= maxTo) to = maxTo;
      if (to <= h.currentBet || p.raiseLocked) {
        // can't raise: only a call (possibly all-in for less) is possible
        if (action === 'allin' || to === maxTo) { if (toCall <= 0) p.lastAction = '체크'; else doCall(); break; }
        return { error: p.raiseLocked ? '숏 올인 이후라 다시 레이즈할 수 없어요' : '레이즈 금액이 너무 적어요' };
      }
      const minTo = h.currentBet + h.minRaise;
      if (to < minTo && to < maxTo) return { error: `최소 ${money(minTo)}까지 레이즈해야 해요` };
      const wasBet = h.currentBet === 0;
      const raiseSize = to - h.currentBet;
      put(p, to - p.bet);
      const others = livePlayers(room).filter((q) => q !== p && !q.allIn);
      if (raiseSize >= h.minRaise) {
        h.minRaise = raiseSize;
        for (const q of others) { q.acted = false; q.raiseLocked = false; }
      } else {
        // short all-in: doesn't reopen raising for players who already acted
        for (const q of others) if (q.acted) { q.acted = false; q.raiseLocked = true; }
      }
      h.currentBet = to;
      p.lastAction = p.allIn ? '올인' : wasBet ? '벳' : '레이즈';
      break;
    }
    default: return { error: '알 수 없는 액션' };
  }
  if (!auto) p.timeouts = 0;
  p.acted = true;
  clearTimeout(room.turnTimer);
  const amt = ['콜', '벳', '레이즈', '올인'].includes(p.lastAction) ? ` ${money(p.bet)}` : '';
  log(room, `${p.name}: ${p.lastAction}${amt}`);
  advance(room, p.seat);
  return { ok: true };
}

// ---------- per-player view (hides other players' cards) ----------
function view(room, token) {
  const h = room.hand;
  const me = token ? room.byToken.get(token) : null;
  const seats = room.seats.map((p) => {
    if (!p) return null;
    const inH = !!(h && p.inHand);
    let cards = null;
    if (inH && p.hole) {
      if (p === me) cards = p.hole;
      else if (h.revealAll && !p.folded) cards = p.hole;
    }
    return {
      name: p.name, chips: p.chips, bet: inH ? p.bet : 0, total: inH ? p.total : 0,
      inHand: inH, folded: inH && p.folded, allIn: inH && p.allIn,
      hasCards: inH && !p.folded, cards, connected: p.connected,
      sittingOut: p.sittingOut, lastAction: inH ? p.lastAction : '', leaving: p.leaving,
    };
  });
  let actions = null;
  if (h && me && !isOver(h) && h.toAct === me.seat) {
    const toCall = Math.min(h.currentBet - me.bet, me.chips);
    const maxTo = me.bet + me.chips;
    actions = {
      toCall, canCheck: h.currentBet - me.bet <= 0,
      canRaise: !me.raiseLocked && maxTo > h.currentBet,
      minTo: Math.min(h.currentBet + h.minRaise, maxTo), maxTo,
      currentBet: h.currentBet, myBet: me.bet,
    };
  }
  const pot = h ? handPlayers(room).reduce((s, p) => s + p.total, 0) : 0;
  const betsOut = h ? handPlayers(room).reduce((s, p) => s + p.bet, 0) : 0;
  return {
    room: room.id, now: Date.now(), mySeat: me ? me.seat : null,
    seats, handNo: room.handNo, running: room.running, nextAt: room.nextAt,
    cfg: { sb: CFG.SB, bb: CFG.BB, start: CFG.START_CHIPS, turnMs: CFG.TURN_MS, maxSeats: CFG.MAX_SEATS },
    hand: h ? {
      stage: h.stage, board: h.board, button: room.button, sb: h.sb, bb: h.bb,
      toAct: h.toAct, deadline: h.deadline, pot, potCenter: pot - betsOut,
      currentBet: h.currentBet, results: h.results, revealAll: h.revealAll,
    } : { button: room.button },
    actions, log: room.log.slice(-40),
  };
}

module.exports = { CFG, getRoom, cleanId, join, leave, start, toggleSitOut, rebuy, setConnected, act, view, setOnChange, rooms };
