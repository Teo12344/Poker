// Texas Hold'em hand evaluator + equity calculator (shared by server and browser)
(function (root) {
  const RANKS = '23456789TJQKA';
  const SUITS = 'shdc';
  const RANK_LABEL = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const CAT = ['하이 카드', '원 페어', '투 페어', '트리플', '스트레이트', '플러시', '풀 하우스', '포카드', '스트레이트 플러시'];
  const B5 = 13 ** 5;

  function topBits(mask, n) {
    const out = [];
    for (let r = 12; r >= 0 && out.length < n; r--) if (mask & (1 << r)) out.push(r);
    return out;
  }
  function straightHigh(mask) {
    for (let h = 12; h >= 4; h--) {
      const m = 0x1f << (h - 4);
      if ((mask & m) === m) return h;
    }
    if ((mask & 0x100f) === 0x100f) return 3; // A-2-3-4-5
    return -1;
  }
  function score(cat, ks) {
    let v = cat;
    for (let i = 0; i < 5; i++) v = v * 13 + (i < ks.length ? ks[i] : 0);
    return v;
  }

  // cards: ints 0..51 (rank = c>>2, suit = c&3). Works for 2..7 cards. Higher = better.
  function evaluate(cards) {
    const rc = new Uint8Array(13);
    const sc = [0, 0, 0, 0], sm = [0, 0, 0, 0];
    let mask = 0;
    for (let i = 0; i < cards.length; i++) {
      const c = cards[i], r = c >> 2, s = c & 3;
      rc[r]++; sc[s]++; sm[s] |= 1 << r; mask |= 1 << r;
    }
    let fs = -1;
    for (let s = 0; s < 4; s++) if (sc[s] >= 5) fs = s;
    if (fs >= 0) {
      const sh = straightHigh(sm[fs]);
      if (sh >= 0) return score(8, [sh]);
    }
    let quads = -1;
    const trips = [], pairs = [];
    for (let r = 12; r >= 0; r--) {
      if (rc[r] === 4) quads = r;
      else if (rc[r] === 3) trips.push(r);
      else if (rc[r] === 2) pairs.push(r);
    }
    if (quads >= 0) return score(7, [quads, ...topBits(mask & ~(1 << quads), 1)]);
    if (trips.length && (trips.length > 1 || pairs.length)) {
      const p = trips.length > 1 ? Math.max(trips[1], pairs.length ? pairs[0] : -1) : pairs[0];
      return score(6, [trips[0], p]);
    }
    if (fs >= 0) return score(5, topBits(sm[fs], 5));
    const sh = straightHigh(mask);
    if (sh >= 0) return score(4, [sh]);
    if (trips.length) return score(3, [trips[0], ...topBits(mask & ~(1 << trips[0]), 2)]);
    if (pairs.length >= 2) {
      const a = pairs[0], b = pairs[1];
      return score(2, [a, b, ...topBits(mask & ~(1 << a) & ~(1 << b), 1)]);
    }
    if (pairs.length) return score(1, [pairs[0], ...topBits(mask & ~(1 << pairs[0]), 3)]);
    return score(0, topBits(mask, 5));
  }

  function category(s) { return Math.floor(s / B5); }
  function digits(s) {
    const d = [];
    let v = s % B5;
    for (let i = 0; i < 5; i++) { d.unshift(v % 13); v = Math.floor(v / 13); }
    return d;
  }
  function describe(s) {
    const c = category(s), d = digits(s), L = (i) => RANK_LABEL[d[i]];
    switch (c) {
      case 8: return d[0] === 12 ? '로열 플러시' : `스트레이트 플러시 (${L(0)} 하이)`;
      case 7: return `포카드 (${L(0)})`;
      case 6: return `풀 하우스 (${L(0)} / ${L(1)})`;
      case 5: return `플러시 (${L(0)} 하이)`;
      case 4: return `스트레이트 (${L(0)} 하이)`;
      case 3: return `트리플 (${L(0)})`;
      case 2: return `투 페어 (${L(0)}, ${L(1)})`;
      case 1: return `원 페어 (${L(0)})`;
      default: return `하이 카드 (${L(0)})`;
    }
  }

  function remainingDeck(used) {
    const u = new Set(used), d = [];
    for (let c = 0; c < 52; c++) if (!u.has(c)) d.push(c);
    return d;
  }

  // Equity of `hole` vs `nOpp` unknown random hands. Returns {win, tie, share}.
  function equity(hole, board, nOpp, iters) {
    iters = iters || 8000;
    if (nOpp <= 0) return { win: 1, tie: 0, share: 1 };
    const deck = remainingDeck([...hole, ...board]);
    const need = 5 - board.length;
    const draw = need + 2 * nOpp;
    const mine = new Array(7), opp = new Array(7);
    let win = 0, tie = 0, share = 0;
    for (let it = 0; it < iters; it++) {
      for (let i = 0; i < draw; i++) {
        const j = i + Math.floor(Math.random() * (deck.length - i));
        const t = deck[i]; deck[i] = deck[j]; deck[j] = t;
      }
      let k = 0;
      for (let i = 0; i < board.length; i++) { mine[i + 2] = opp[i + 2] = board[i]; }
      for (let i = board.length; i < 5; i++) { mine[i + 2] = opp[i + 2] = deck[k++]; }
      mine[0] = hole[0]; mine[1] = hole[1];
      const my = evaluate(mine);
      let best = -1, nBest = 0;
      for (let o = 0; o < nOpp; o++) {
        opp[0] = deck[k++]; opp[1] = deck[k++];
        const v = evaluate(opp);
        if (v > best) { best = v; nBest = 1; } else if (v === best) nBest++;
      }
      if (my > best) { win++; share++; }
      else if (my === best) { tie++; share += 1 / (nBest + 1); }
    }
    return { win: win / iters, tie: tie / iters, share: share / iters };
  }

  // Equity when every hand is known (all-in runouts). hands: [[c,c],...]. Returns share per hand.
  function multiEquity(hands, board, iters) {
    const deck = remainingDeck([...hands.flat(), ...board]);
    const need = 5 - board.length;
    const n = hands.length;
    const shares = new Array(n).fill(0), wins = new Array(n).fill(0);
    let total = 0;
    const cards = new Array(7);
    const evalBoard = (b) => {
      const vals = hands.map((h) => {
        cards[0] = h[0]; cards[1] = h[1];
        for (let i = 0; i < 5; i++) cards[i + 2] = b[i];
        return evaluate(cards);
      });
      const best = Math.max(...vals);
      const w = vals.filter((v) => v === best).length;
      vals.forEach((v, i) => { if (v === best) { shares[i] += 1 / w; if (w === 1) wins[i]++; } });
      total++;
    };
    if (need === 0) evalBoard(board);
    else if (need <= 2) {
      // exact enumeration
      if (need === 1) for (const a of deck) evalBoard([...board, a]);
      else for (let i = 0; i < deck.length; i++) for (let j = i + 1; j < deck.length; j++) evalBoard([...board, deck[i], deck[j]]);
    } else {
      iters = iters || 6000;
      const b = new Array(5);
      for (let it = 0; it < iters; it++) {
        for (let i = 0; i < need; i++) {
          const j = i + Math.floor(Math.random() * (deck.length - i));
          const t = deck[i]; deck[i] = deck[j]; deck[j] = t;
        }
        for (let i = 0; i < board.length; i++) b[i] = board[i];
        for (let i = 0; i < need; i++) b[board.length + i] = deck[i];
        evalBoard(b);
      }
    }
    return shares.map((s, i) => ({ share: s / total, win: wins[i] / total }));
  }

  const api = { RANKS, SUITS, RANK_LABEL, CAT, evaluate, category, describe, equity, multiEquity };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PokerEval = api;
})(this);
