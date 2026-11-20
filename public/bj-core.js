// Blackjack rules engine (no UI). Rules: 1 deck shuffled fresh before every hand, dealer hits soft 17 (H17),
// blackjack pays 3:2, dealer peeks for blackjack, insurance pays 2:1, double on any first two cards,
// double after split, split up to 4 hands, split aces receive one card each.
(function (root) {
  const DECKS = 1;
  const MAX_HANDS = 4;

  const rank = (c) => c >> 2;                    // 0..12 => 2..A
  const cardValue = (c) => { const r = rank(c); return r === 12 ? 11 : r >= 8 ? 10 : r + 2; };
  const isAce = (c) => rank(c) === 12;

  function handValue(cards) {
    let total = 0, aces = 0;
    for (const c of cards) { total += cardValue(c); if (isAce(c)) aces++; }
    while (total > 21 && aces) { total -= 10; aces--; }
    return { total, soft: aces > 0 };
  }
  const isBlackjack = (cards) => cards.length === 2 && handValue(cards).total === 21;

  function rand(n) {
    if (root.crypto && root.crypto.getRandomValues) {
      const a = new Uint32Array(1); root.crypto.getRandomValues(a); return a[0] % n;
    }
    return Math.floor(Math.random() * n);
  }
  function newShoe() {
    const s = [];
    for (let d = 0; d < DECKS; d++) for (let c = 0; c < 52; c++) s.push(c);
    for (let i = s.length - 1; i > 0; i--) { const j = rand(i + 1); [s[i], s[j]] = [s[j], s[i]]; }
    return s;
  }

  // ---- basic strategy (1 deck, dealer hits soft 17, double after split, no surrender) ----
  // returns 'H' hit, 'S' stand, 'D' double, 'P' split
  function strategy(cards, upCard, canDouble, canSplit) {
    const up = cardValue(upCard); // 2..11
    const { total, soft } = handValue(cards);
    const D = (cond, otherwise) => (cond ? (canDouble ? 'D' : otherwise) : null);
    if (canSplit && cards.length === 2 && cardValue(cards[0]) === cardValue(cards[1])) {
      const v = cardValue(cards[0]);
      if (v === 11 || v === 8) return 'P';
      if (v === 9 && ![7, 10, 11].includes(up)) return 'P';
      if ((v === 7 || v === 6 || v === 3 || v === 2) && up <= 7) return 'P';
      if (v === 4 && (up === 5 || up === 6)) return 'P';
    }
    if (soft && cards.length >= 2 && total <= 21 && total >= 13) {
      if (total >= 20) return 'S';
      if (total === 19) return up === 6 ? (canDouble ? 'D' : 'S') : 'S';
      if (total === 18) {
        if (up >= 3 && up <= 6) return D(true, 'S');
        return up <= 8 ? 'S' : 'H';
      }
      if (total === 17) return D(up >= 2 && up <= 6, 'H') || 'H';
      return D(up >= 4 && up <= 6, 'H') || 'H';
    }
    if (total >= 17) return 'S';
    if (total >= 13) return up <= 6 ? 'S' : 'H';
    if (total === 12) return up >= 4 && up <= 6 ? 'S' : 'H';
    if (total === 11) return D(true, 'H');
    if (total === 10) return D(up <= 9, 'H') || 'H';
    if (total === 9) return D(up <= 6, 'H') || 'H';
    if (total === 8) return D(up === 5 || up === 6, 'H') || 'H';
    return 'H';
  }

  class Game {
    constructor(chips) {
      this.chips = chips;
      this.bet = 0;          // bet staged for the next round
      this.lastBet = 0;
      this.shoe = newShoe();
      this.shoeSize = this.shoe.length;
      this.reshuffled = true;
      this.phase = 'bet';    // bet | insurance | play | dealer | over
      this.dealer = { cards: [], hidden: true };
      this.hands = [];
      this.active = 0;
      this.insurance = 0;
      this.insuranceResult = null;
      this.net = 0;
    }
    draw() { return this.shoe.pop(); }
    get hand() { return this.hands[this.active]; }
    get up() { return this.dealer.cards[0]; }
    get remaining() { return this.shoe.length; }

    // ----- betting -----
    addBet(v) { if (this.phase !== 'bet' && this.phase !== 'over') return false; if (this.bet + v > this.chips) return false; this.bet += v; return true; }
    clearBet() { if (this.phase === 'bet' || this.phase === 'over') this.bet = 0; }
    allIn() { if (this.phase === 'bet' || this.phase === 'over') this.bet = this.chips; }

    // ----- round -----
    // deals the four opening cards; returns the order they were dealt for animation
    deal() {
      if (this.bet <= 0 || this.bet > this.chips) return null;
      this.shoe = newShoe(); // fresh, fully shuffled deck every hand
      this.reshuffled = true;
      this.chips -= this.bet;
      this.lastBet = this.bet;
      this.hands = [{ cards: [], bet: this.bet, done: false, doubled: false, splitAces: false, fromSplit: false, result: null, payout: 0 }];
      this.dealer = { cards: [], hidden: true };
      this.active = 0; this.insurance = 0; this.insuranceResult = null; this.net = 0;
      const h = this.hands[0];
      h.cards.push(this.draw()); this.dealer.cards.push(this.draw());
      h.cards.push(this.draw()); this.dealer.cards.push(this.draw());
      if (isAce(this.up)) this.phase = 'insurance';
      else this.afterInsurance();
      return true;
    }
    canInsure() { return this.phase === 'insurance' && this.chips >= Math.floor(this.lastBet / 2); }
    takeInsurance(take) {
      if (this.phase !== 'insurance') return;
      if (take && this.canInsure()) { this.insurance = Math.floor(this.lastBet / 2); this.chips -= this.insurance; }
      this.afterInsurance();
    }
    afterInsurance() {
      const dealerBJ = cardValue(this.up) >= 10 && isBlackjack(this.dealer.cards);
      if (this.insurance) {
        if (dealerBJ) { this.chips += this.insurance * 3; this.insuranceResult = 'win'; }
        else this.insuranceResult = 'lose';
      }
      if (dealerBJ || isBlackjack(this.hands[0].cards)) {
        this.hands[0].done = true;
        this.dealer.hidden = false;
        this.settle();
        return;
      }
      this.phase = 'play';
      this.autoAdvance();
    }

    // ----- player actions -----
    canDouble() { const h = this.hand; return this.phase === 'play' && h && h.cards.length === 2 && !h.splitAces && this.chips >= h.bet; }
    canSplit() {
      const h = this.hand;
      return this.phase === 'play' && h && h.cards.length === 2 && cardValue(h.cards[0]) === cardValue(h.cards[1])
        && this.hands.length < MAX_HANDS && this.chips >= h.bet && !h.splitAces;
    }
    hint() {
      if (this.phase === 'insurance') return 'NI';
      if (this.phase !== 'play') return null;
      return strategy(this.hand.cards, this.up, this.canDouble(), this.canSplit());
    }
    hit() {
      if (this.phase !== 'play') return false;
      const h = this.hand;
      h.cards.push(this.draw());
      if (handValue(h.cards).total >= 21) h.done = true;
      this.autoAdvance();
      return true;
    }
    stand() { if (this.phase !== 'play') return false; this.hand.done = true; this.autoAdvance(); return true; }
    double() {
      if (!this.canDouble()) return false;
      const h = this.hand;
      this.chips -= h.bet; h.bet *= 2; h.doubled = true;
      h.cards.push(this.draw());
      h.done = true;
      this.autoAdvance();
      return true;
    }
    split() {
      if (!this.canSplit()) return false;
      const h = this.hand;
      const aces = isAce(h.cards[0]);
      this.chips -= h.bet;
      const second = { cards: [h.cards.pop()], bet: h.bet, done: false, doubled: false, splitAces: aces, fromSplit: true, result: null, payout: 0 };
      h.splitAces = aces; h.fromSplit = true;
      this.hands.splice(this.active + 1, 0, second);
      h.cards.push(this.draw());
      if (aces) {
        second.cards.push(this.draw());
        h.done = true; second.done = true;
      } else if (handValue(h.cards).total === 21) h.done = true;
      this.autoAdvance();
      return true;
    }
    // move to the next unfinished hand; deal its second card if it came from a split
    autoAdvance() {
      while (this.active < this.hands.length) {
        const h = this.hands[this.active];
        if (h.cards.length === 1) { h.cards.push(this.draw()); if (handValue(h.cards).total === 21) h.done = true; }
        if (!h.done) return;
        this.active++;
      }
      this.phase = 'dealer';
      this.dealer.hidden = false;
    }

    // ----- dealer -----
    dealerNeedsCard() {
      if (this.phase !== 'dealer') return false;
      if (this.hands.every((h) => handValue(h.cards).total > 21)) return false;
      const { total, soft } = handValue(this.dealer.cards);
      return total < 17 || (total === 17 && soft); // hits soft 17 (H17)
    }
    dealerHit() { this.dealer.cards.push(this.draw()); }
    finishDealer() { while (this.dealerNeedsCard()) this.dealerHit(); this.settle(); }

    settle() {
      const d = handValue(this.dealer.cards).total;
      const dealerBJ = isBlackjack(this.dealer.cards);
      let returned = 0, staked = 0;
      for (const h of this.hands) {
        const v = handValue(h.cards).total;
        const bj = isBlackjack(h.cards) && !h.fromSplit;
        let pay = 0, result;
        if (bj && dealerBJ) { result = 'push'; pay = h.bet; }
        else if (bj) { result = 'blackjack'; pay = h.bet + Math.floor(h.bet * 1.5); }
        else if (dealerBJ) { result = 'lose'; }
        else if (v > 21) { result = 'bust'; }
        else if (d > 21) { result = 'win'; pay = h.bet * 2; }
        else if (v > d) { result = 'win'; pay = h.bet * 2; }
        else if (v === d) { result = 'push'; pay = h.bet; }
        else { result = 'lose'; }
        h.result = result; h.payout = pay;
        returned += pay; staked += h.bet;
      }
      this.chips += returned;
      this.net = returned - staked + (this.insuranceResult === 'win' ? this.insurance * 2 : this.insuranceResult === 'lose' ? -this.insurance : 0);
      this.phase = 'over';
      this.bet = Math.min(this.lastBet, this.chips); // keep the same bet for the next round
      this.active = -1;
    }
  }

  const api = { Game, handValue, cardValue, isBlackjack, strategy, rank, DECKS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BJ = api;
})(typeof window !== 'undefined' ? window : globalThis);
