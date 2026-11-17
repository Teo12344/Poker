// No-limit Texas Hold'em engine (server-authoritative).
// Messages are sent as language-neutral codes; the browser translates them.
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
  DISCONNECT_MS: 60000,   // remove a player who has been offline this long
  EMPTY_ROOM_MS: 30 * 60000,
};

const rooms = new Map();
let onChange = () => {};
const setOnChange = (f) => { onChange = f; };
const changed = (room) => onChange(room);
const err = (code, params) => ({ error: code, params });

function cleanId(id) {
  return String(id || 'MAIN').toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 20) || 'MAIN';
}
function getRoom(id) {
  id = cleanId(id);
  if (!rooms.has(id)) {
    rooms.set(id, {
      id, seats: Array(CFG.MAX_SEATS).fill(null), byToken: new Map(),
      button: -1, hand: null, handNo: 0, running: false, log: [],
      nextTimer: null, nextAt: 0, turnTimer: null, runTimer: null, emptySince: Date.now(),
    });
  }
  return rooms.get(id);
}
function log(room, k, p) {
  room.log.push({ t: Date.now(), k, p: p || {} });
  if (room.log.length > 80) room.log.shift();
}

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
const seatedCount = (room) => room.seats.filter((p) => p && !p.leaving).length;

// ---------- lobby actions ----------
function join(room, token, name, wantSeat) {
  name = String(name || '').trim().slice(0, 12) || 'Player';
  const existing = token && room.byToken.get(token);
  if (existing && !existing.leaving) {
    existing.name = name;
    changed(room);
    return { token: existing.token, seat: existing.seat };
  }
  let seat = room.seats.findIndex((s) => !s);
  if (Number.isInteger(wantSeat) && wantSeat >= 0 && wantSeat < CFG.MAX_SEATS && !room.seats[wantSeat]) seat = wantSeat;
  if (seat < 0) return err('seatsFull');
  token = crypto.randomBytes(16).toString('hex');
  const p = {
    token, name, seat, chips: CFG.START_CHIPS, connected: false, discAt: Date.now(), sittingOut: false,
    inHand: false, hole: null, bet: 0, total: 0, folded: false, allIn: false,
    acted: false, raiseLocked: false, lastAction: '', timeouts: 0, leaving: false,
  };
  room.seats[seat] = p;
  room.byToken.set(token, p);
  room.emptySince = 0;
  log(room, 'joined', { name });
  maybeStart(room);
  changed(room);
  return { token, seat };
}

function removePlayer(room, p) {
  if (room.seats[p.seat] === p) room.seats[p.seat] = null;
  room.byToken.delete(p.token);
  if (seatedCount(room) === 0) resetRoom(room);
}
function resetRoom(room) {
  clearTimeout(room.nextTimer); clearTimeout(room.turnTimer); clearTimeout(room.runTimer);
  room.nextTimer = null; room.nextAt = 0;
  room.running = false; room.hand = null; room.button = -1;
  room.emptySince = Date.now();
}

function leave(room, token, reason) {
  const p = room.byToken.get(token);
  if (!p) return err('noPlayer');
  if (p.leaving) return { ok: true };
  const h = room.hand;
  log(room, reason === 'idle' ? 'idle' : 'left', { name: p.name });
  if (h && h.players.includes(p.seat)) {
    // keep the seat object until the hand is cleared (pot math still references it)
    p.leaving = true;
    if (!isOver(h) && !p.folded) {
      if (h.toAct === p.seat) { act(room, token, 'fold', null, true); return { ok: true }; }
      p.folded = true; p.lastAction = 'fold';
      const live = livePlayers(room);
      if (live.length === 1) { winUncontested(room, live[0]); return { ok: true }; }
    }
  } else {
    removePlayer(room, p);
  }
  changed(room);
  return { ok: true };
}

function start(room) {
  if (room.running) return { ok: true };
  const n = room.seats.filter((p) => p && p.chips > 0 && !p.sittingOut && !p.leaving).length;
  if (n < 2) return err('needTwo');
  room.running = true;
  log(room, 'start');
  startHand(room);
  return { ok: true };
}

function toggleSitOut(room, token) {
  const p = room.byToken.get(token);
  if (!p) return err('noPlayer');
  p.sittingOut = !p.sittingOut;
  p.timeouts = 0;
  log(room, p.sittingOut ? 'sitout' : 'back', { name: p.name });
  if (!p.sittingOut) maybeStart(room);
  changed(room);
  return { ok: true };
}

function rebuy(room, token) {
  const p = room.byToken.get(token);
  if (!p) return err('noPlayer');
  if (p.chips > 0) return err('rebuyBroke');
  const h = room.hand;
  if (h && h.players.includes(p.seat) && !isOver(h)) return err('rebuyAfter');
  p.chips = CFG.START_CHIPS;
  log(room, 'rebuy', { name: p.name, amount: CFG.START_CHIPS });
  maybeStart(room);
  changed(room);
  return { ok: true };
}

function setConnected(room, token, on) {
  const p = room.byToken.get(token);
  if (!p || p.connected === on) return;
  p.connected = on;
  p.discAt = on ? 0 : Date.now();
  changed(room);
}

function maybeStart(room) {
  if (room.running && (!room.hand || isOver(room.hand)) && !room.nextTimer) scheduleNext(room, 1500);
}
function scheduleNext(room, ms) {
  clearTimeout(room.nextTimer);
  room.nextAt = Date.now() + ms;
  room.nextTimer = setTimeout(() => startHand(room), ms);
}

// remove players who closed the page; forget rooms nobody uses
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    for (const p of room.seats) {
      if (p && !p.connected && !p.leaving && p.discAt && now - p.discAt > CFG.DISCONNECT_MS) leave(room, p.token, 'idle');
    }
    if (seatedCount(room) === 0 && room.emptySince && now - room.emptySince > CFG.EMPTY_ROOM_MS) rooms.delete(room.id);
  }
}, 5000).unref();

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
  log(room, 'hand', { no: room.handNo, dealer: room.seats[btn].name });
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
  log(room, 'board', { street: h.stage, cards: h.board.slice() });
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

  // main + side pots from total contributions
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
    results.push({ amount: pot.amount, winners, score: best, single: pot.eligible.length === 1 });
  }
  for (const p of P) p.bet = 0;
  h.results = { pots: results, won };
  for (const r of results) {
    const names = r.winners.map((s) => room.seats[s].name).join(', ');
    if (r.single) log(room, 'refund', { names, amount: r.amount });
    else log(room, 'win', { names, score: r.score, amount: r.amount });
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
  h.results = { pots: [{ amount: total, winners: [p.seat], score: null }], won: { [p.seat]: total } };
  log(room, 'foldWin', { name: p.name, amount: total });
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
    log(room, 'timeout', { name: p.name });
    act(room, p.token, h.currentBet - p.bet > 0 ? 'fold' : 'check', null, true);
  }, CFG.TURN_MS + 300);
}

function act(room, token, action, amount, auto) {
  const h = room.hand;
  const p = room.byToken.get(token);
  if (!h || !p || isOver(h) || h.toAct !== p.seat) return err('notTurn');
  const toCall = h.currentBet - p.bet;
  const doCall = () => { put(p, toCall); p.lastAction = p.allIn ? 'allin' : 'call'; };

  switch (action) {
    case 'fold': p.folded = true; p.lastAction = 'fold'; break;
    case 'check':
      if (toCall > 0) return err('cantCheck');
      p.lastAction = 'check'; break;
    case 'call':
      if (toCall <= 0) p.lastAction = 'check'; else doCall();
      break;
    case 'raise':
    case 'allin': {
      const maxTo = p.bet + p.chips;
      let to = action === 'allin' ? maxTo : Math.floor(Number(amount));
      if (!Number.isFinite(to)) return err('badAmount');
      if (to >= maxTo) to = maxTo;
      if (to <= h.currentBet || p.raiseLocked) {
        if (action === 'allin' || to === maxTo) { if (toCall <= 0) p.lastAction = 'check'; else doCall(); break; }
        return err(p.raiseLocked ? 'raiseLocked' : 'raiseSmall');
      }
      const minTo = h.currentBet + h.minRaise;
      if (to < minTo && to < maxTo) return err('minRaise', { amount: minTo });
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
      p.lastAction = p.allIn ? 'allin' : wasBet ? 'bet' : 'raise';
      break;
    }
    default: return err('unknown');
  }
  if (!auto) p.timeouts = 0;
  p.acted = true;
  clearTimeout(room.turnTimer);
  log(room, 'action', { name: p.name, act: p.lastAction, amount: ['call', 'bet', 'raise', 'allin'].includes(p.lastAction) ? p.bet : 0 });
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
    room: room.id, now: Date.now(), mySeat: me && !me.leaving ? me.seat : null,
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
