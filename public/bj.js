(() => {
  const $ = (s) => document.querySelector(s);
  const { Game, handValue, isBlackjack, cardValue } = window.BJ;
  const SUIT = ['♠', '♥', '♦', '♣'];
  const RL = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const money = (n) => '$' + Math.round(n).toLocaleString('en-US');
  const START = 50000;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- text ----------
  const TXT = {
    ko: {
      dealer: '딜러', bank: '보유 칩', shoe: '1덱 · 매 판 새로 셔플', stats: '{w}승 {l}패 {p}무', hint: 'AI 추천',
      placeBet: '칩을 눌러 베팅하고 <b>딜</b>을 누르세요', betHere: 'BET', clear: '지우기', x2: '2배', allin: '올인', deal: '딜',
      dealAgain: '다시 딜 · {amt}', hit: '히트', stand: '스탠드', double: '더블', split: '스플릿',
      insQ: '딜러 오픈 카드가 A예요. 인슈어런스를 걸까요?', insYes: '인슈어런스 {amt}', insNo: '안 함', evenQ: '블랙잭이에요! 딜러가 A라서 이븐 머니를 받을 수 있어요',
      evenYes: '이븐 머니 받기', insWin: '인슈어런스 적중 +{amt}', insLose: '인슈어런스 실패',
      yourTurn: '당신 차례예요', handN: '{n}번째 핸드', dealerTurn: '딜러가 카드를 받는 중…',
      r_win: '승리', r_lose: '패배', r_push: '푸시', r_blackjack: '블랙잭!', r_bust: '버스트',
      netPos: '+{amt}', netNeg: '−{amt}', netZero: '본전', dealerBust: '딜러 버스트!', dealerBJ: '딜러 블랙잭',
      broke: '칩이 다 떨어졌어요', rebuy: '{amt} 다시 받기', shuffled: '새 카드 6덱을 섞었어요',
      rec: 'AI 추천', recNI: 'AI 추천: 인슈어런스는 거는 게 손해예요',
      soft: '소프트', bjVal: '블랙잭', rotate: '가로 화면에서 더 크게 보여요', homeTitle: '홈으로',
      notEnough: '칩이 부족해요',
    },
    en: {
      dealer: 'DEALER', bank: 'Bankroll', shoe: '1 deck · fresh shuffle every hand', stats: '{w}W {l}L {p}P', hint: 'AI hint',
      placeBet: 'Tap chips to bet, then press <b>Deal</b>', betHere: 'BET', clear: 'Clear', x2: '2×', allin: 'All-in', deal: 'Deal',
      dealAgain: 'Deal again · {amt}', hit: 'Hit', stand: 'Stand', double: 'Double', split: 'Split',
      insQ: 'Dealer shows an Ace. Take insurance?', insYes: 'Insurance {amt}', insNo: 'No thanks', evenQ: 'Blackjack! Dealer shows an Ace — take even money?',
      evenYes: 'Take even money', insWin: 'Insurance won +{amt}', insLose: 'Insurance lost',
      yourTurn: 'Your move', handN: 'Hand {n}', dealerTurn: 'Dealer is drawing…',
      r_win: 'WIN', r_lose: 'LOSE', r_push: 'PUSH', r_blackjack: 'BLACKJACK!', r_bust: 'BUST',
      netPos: '+{amt}', netNeg: '−{amt}', netZero: 'Break even', dealerBust: 'Dealer busts!', dealerBJ: 'Dealer blackjack',
      broke: "You're out of chips", rebuy: 'Rebuy {amt}', shuffled: 'Shuffled a fresh 6-deck shoe',
      rec: 'AI pick', recNI: 'AI hint: insurance is a losing bet',
      soft: 'soft', bjVal: 'Blackjack', rotate: 'Looks bigger in landscape', homeTitle: 'Home',
      notEnough: 'Not enough chips',
    },
  };
  let lang = localStorage.getItem('pk_lang') || ((navigator.language || '').toLowerCase().startsWith('ko') ? 'ko' : 'en');
  const t = (k, p = {}) => (TXT[lang][k] ?? TXT.ko[k] ?? k).replace(/\{(\w+)\}/g, (_, x) => p[x] ?? '');

  // ---------- persistence ----------
  const saved = JSON.parse(localStorage.getItem('pk_bj') || '{}');
  const g = new Game(Number.isFinite(saved.chips) ? saved.chips : START);
  const stats = saved.stats || { w: 0, l: 0, p: 0 };
  g.bet = Math.min(saved.lastBet || 1000, g.chips);
  const save = () => localStorage.setItem('pk_bj', JSON.stringify({ chips: g.chips + (g.phase === 'over' || g.phase === 'bet' ? 0 : g.hands.reduce((s, h) => s + h.bet, 0) + g.insurance), lastBet: g.lastBet || g.bet, stats }));
  let hintOn = localStorage.getItem('pk_bj_hint') === '1';
  let busy = false, msgOverride = '';

  // ---------- sizing ----------
  function resize() {
    const top = innerHeight <= 560 ? 44 : 52;
    const bar = innerHeight <= 560 ? 84 : innerWidth <= 640 ? 150 : 128;
    document.body.style.setProperty('--barh', bar + 'px');
    const W = Math.min(innerWidth - 24, 1500), H = innerHeight - top - bar - 16;
    const bu = Math.max(4, Math.min(W / 100, H / 60));
    const cu = Math.max(4.5, Math.min(W / 40, H / 46));
    document.body.style.setProperty('--bu', bu + 'px');
    document.body.style.setProperty('--cu', cu + 'px');
  }
  addEventListener('resize', resize); resize();

  // ---------- rendering ----------
  function cardHTML(c, cls = '') {
    if (c == null) return `<div class="card back ${cls}"></div>`;
    const r = RL[c >> 2], s = c & 3, red = s === 1 || s === 2;
    const center = ['J', 'Q', 'K'].includes(r) ? `<div class="face">${r}</div>` : `<div class="pip">${SUIT[s]}</div>`;
    return `<div class="card ${red ? 'red' : ''} ${cls}"><div class="cr tl"><b>${r}</b><i>${SUIT[s]}</i></div>${center}<div class="cr br"><b>${r}</b><i>${SUIT[s]}</i></div></div>`;
  }
  const CHIPS = [[100, '#1b1b1b'], [500, '#7b3fb0'], [1000, '#e8c33a'], [5000, '#e2701f'], [25000, '#5b2a86']];
  function chipsHTML(amount, max = 9) {
    const out = [];
    let a = amount;
    for (const [d, col] of [...CHIPS].reverse()) while (a >= d && out.length < max) { out.push(col); a -= d; }
    return out.reverse().map((col, i) => `<div class="chip" style="--c:${col};bottom:calc(var(--u)*${i * 0.32})"></div>`).join('');
  }
  function valueBadge(cards, hiddenSecond) {
    const shown = hiddenSecond ? cards.slice(0, 1) : cards;
    if (!shown.length) return '';
    const { total, soft } = handValue(shown);
    if (!hiddenSecond && isBlackjack(cards)) return `<b class="val bjv">${t('bjVal')}</b>`;
    const cls = total > 21 ? 'bust' : total === 21 ? 'twentyone' : '';
    const txt = soft && total < 21 ? `${total - 10} / ${total}` : total;
    return `<b class="val ${cls}">${txt}</b>`;
  }

  // keys of cards already on the table, so only new ones animate
  let shownKeys = new Set(), roundId = 0;
  function render() {
    const d = g.dealer;
    // dealer
    $('#dealerLabelBox').innerHTML = `<span>${t('dealer')}</span>${d.cards.length ? valueBadge(d.cards, d.hidden) : ''}`;
    $('#dealerHand').innerHTML = d.cards.map((c, i) => {
      const hidden = i === 1 && d.hidden;
      const key = `${roundId}-d${i}-${hidden ? 'x' : c}`;
      const isNew = !shownKeys.has(key);
      const anim = isNew ? (i === 1 && !hidden && shownKeys.has(`${roundId}-d1-x`) ? 'flipin' : 'fly') : '';
      return cardHTML(hidden ? null : c, `${anim}" data-k="${key}`);
    }).join('');

    // player hands
    const multi = g.hands.length > 1;
    $('#playerHands').innerHTML = g.hands.map((h, hi) => {
      const active = g.phase === 'play' && hi === g.active;
      const cards = h.cards.map((c, i) => {
        const key = `${roundId}-p${hi}-${i}-${c}`;
        const dbl = h.doubled && i === 2 ? 'dbl' : '';
        return cardHTML(c, `${dbl} ${shownKeys.has(key) ? '' : 'fly'}" data-k="${key}`);
      }).join('');
      const res = h.result ? `<div class="res ${h.result}">${t('r_' + h.result)}${h.payout > h.bet ? ' +' + money(h.payout - h.bet) : ''}</div>` : '';
      const dim = multi && g.phase === 'play' && !active ? 'dim' : '';
      return `<div class="phand ${active && multi ? 'active' : ''} ${dim}">
        ${res}
        <div class="bjhand">${cards}</div>
        <div class="meta">${valueBadge(h.cards)}${multi || h.doubled ? `<span class="hbet">${money(h.bet)}</span>` : ''}</div>
      </div>`;
    }).join('');

    // bet circle
    const inRound = g.phase !== 'bet' && g.phase !== 'over';
    const circleBet = inRound ? g.hands.reduce((s, h) => s + h.bet, 0) : g.bet;
    $('#betChips').innerHTML = circleBet ? chipsHTML(circleBet) : '';
    $('#betVal').textContent = circleBet ? money(circleBet) : '';
    $('#betCircle').classList.toggle('empty', !circleBet);
    $('#betCircle').dataset.label = t('betHere');

    // shoe & discard
    $('#shoePill').textContent = t('shoe');
    $('#statsPill').textContent = t('stats', stats);

    // bank
    $('#bankLabel').textContent = t('bank');
    $('#bank').textContent = money(g.chips);

    renderMsg();
    renderControls();
    animateNew();
  }

  function renderMsg() {
    let m = '';
    if (msgOverride) m = msgOverride;
    else if (g.phase === 'bet') m = g.chips + g.bet <= 0 ? t('broke') : t('placeBet');
    else if (g.phase === 'insurance') m = isBlackjack(g.hands[0].cards) ? t('evenQ') : t('insQ');
    else if (g.phase === 'play') m = g.hands.length > 1 ? `${t('handN', { n: g.active + 1 })} · ${t('yourTurn')}` : t('yourTurn');
    else if (g.phase === 'dealer') m = t('dealerTurn');
    else if (g.phase === 'over') {
      const dv = handValue(g.dealer.cards).total;
      const sub = isBlackjack(g.dealer.cards) ? t('dealerBJ') : dv > 21 ? t('dealerBust') : '';
      const ins = g.insuranceResult === 'win' ? t('insWin', { amt: money(g.insurance * 2) }) : g.insuranceResult === 'lose' ? t('insLose') : '';
      const net = g.net;
      const big = net > 0 ? `<span class="big pos">${t('netPos', { amt: money(net) })}</span>` : net < 0 ? `<span class="big neg">${t('netNeg', { amt: money(-net) })}</span>` : `<span class="big neu">${t('netZero')}</span>`;
      m = big + [sub, ins].filter(Boolean).join(' · ');
    }
    if (hintOn && !busy) {
      const hnt = g.hint();
      if (hnt === 'NI') m += `<small>${t('recNI')}</small>`;
    }
    $('#msg').innerHTML = m;
  }

  function btn(cls, label, key, action, disabled, rec) {
    return `<button class="abtn ${cls}${rec ? ' rec' : ''}" data-a="${action}" ${disabled ? 'disabled' : ''} ${rec ? `data-rec="${t('rec')}"` : ''}>${label}${key ? `<kbd>${key}</kbd>` : ''}</button>`;
  }
  function renderControls() {
    const c = $('#controls');
    let html = '';
    const lock = busy;
    if (g.phase === 'bet' || g.phase === 'over') {
      if (g.chips <= 0 && g.bet <= 0) {
        html = btn('dealbtn', t('rebuy', { amt: money(START) }), '', 'rebuy', lock);
      } else {
        html = CHIPS.map(([v, col]) => `<button class="chipbtn" style="--c:${col}" data-chip="${v}" ${lock || g.bet + v > g.chips ? 'disabled' : ''}><span>${v >= 1000 ? v / 1000 + 'K' : v}</span></button>`).join('');
        html += '<span class="sep"></span>';
        html += btn('ghost', t('clear'), '', 'clear', lock || !g.bet);
        html += btn('ghost', t('x2'), '', 'x2', lock || !g.bet || g.bet * 2 > g.chips);
        html += btn('ghost', t('allin'), '', 'allin', lock || !g.chips);
        html += btn('dealbtn', g.phase === 'over' && g.bet ? t('dealAgain', { amt: money(g.bet) }) : t('deal'), 'Space', 'deal', lock || !g.bet);
      }
    } else if (g.phase === 'insurance') {
      const amt = Math.floor(g.lastBet / 2);
      const even = isBlackjack(g.hands[0].cards);
      html = btn('double', even ? t('evenYes') : t('insYes', { amt: money(amt) }), 'Y', 'insYes', lock || !g.canInsure())
        + btn('stand', t('insNo'), 'N', 'insNo', lock, hintOn && !lock);
    } else if (g.phase === 'play') {
      const rec = hintOn && !lock ? g.hint() : null;
      html = btn('hit', t('hit'), 'H', 'hit', lock, rec === 'H')
        + btn('stand', t('stand'), 'S', 'stand', lock, rec === 'S')
        + btn('double', t('double'), 'D', 'double', lock || !g.canDouble(), rec === 'D')
        + btn('split', t('split'), 'P', 'split', lock || !g.canSplit(), rec === 'P');
    } else {
      html = btn('hit', t('hit'), '', 'x', true) + btn('stand', t('stand'), '', 'x', true) + btn('double', t('double'), '', 'x', true) + btn('split', t('split'), '', 'x', true);
    }
    c.innerHTML = html;
    if (matchMedia('(hover:none)').matches) c.querySelectorAll('kbd').forEach((k) => k.remove());
  }

  // fly each new card from the shoe, one after another
  let flyDelay = 0;
  function animateNew() {
    const shoe = $('#shoe').getBoundingClientRect();
    const sx = shoe.left + shoe.width / 2, sy = shoe.top + shoe.height / 2;
    let i = 0;
    document.querySelectorAll('.card[data-k]').forEach((el) => {
      const k = el.dataset.k;
      if (shownKeys.has(k)) return;
      shownKeys.add(k);
      if (el.classList.contains('flipin')) Sound.play('flip');
      if (el.classList.contains('fly')) {
        const r = el.getBoundingClientRect();
        el.style.setProperty('--dx', `${sx - (r.left + r.width / 2)}px`);
        el.style.setProperty('--dy', `${sy - (r.top + r.height / 2)}px`);
        const delay = (flyDelay + i++) * 300;
        el.style.animationDelay = `${delay}ms`;
        Sound.play('card', delay);
      }
    });
    const total = flyDelay + i;
    flyDelay = 0;
    return total * 230 + (total ? 380 : 0);
  }
  // render and wait until the card animations finish
  async function show(extraFly = 0) {
    flyDelay = extraFly;
    render();
    const pending = [...document.querySelectorAll('.card.fly')].filter((el) => el.style.animationDelay).length;
    await sleep(pending * 300 + (pending ? 280 : 0));
  }

  // ---------- flow ----------
  async function act(a, arg) {
    if (busy) return;
    switch (a) {
      case 'chip': if (!g.addBet(arg)) toast(t('notEnough')); else Sound.play('chip'); if (g.phase === 'over') resetTable(); save(); render(); return;
      case 'clear': g.clearBet(); Sound.play('click'); if (g.phase === 'over') resetTable(); render(); return;
      case 'x2': if (g.bet * 2 <= g.chips) { g.bet *= 2; Sound.play('chips'); } if (g.phase === 'over') resetTable(); render(); return;
      case 'allin': g.allIn(); Sound.play('chips'); if (g.phase === 'over') resetTable(); render(); return;
      case 'rebuy': g.chips = START; g.bet = 1000; save(); render(); return;
      case 'deal': return deal();
      case 'insYes': case 'insNo':
        busy = true; if (a === 'insYes') Sound.play('chip'); g.takeInsurance(a === 'insYes'); await afterAction(); return;
      case 'hit': case 'stand': case 'double': case 'split':
        busy = true;
        {
          const h = g.hand;
          if (a === 'double' || a === 'split') Sound.play('chips');
          g[a]();
          if (h && (a === 'hit' || a === 'double') && handValue(h.cards).total > 21) Sound.play('bust', 450);
        }
        await afterAction(); return;
    }
  }
  function resetTable() {
    // leaving the results screen: clear the old cards but keep the bet
    g.phase = 'bet'; g.hands = []; g.dealer = { cards: [], hidden: true }; roundId++; shownKeys = new Set();
  }
  async function deal() {
    if (!g.bet || g.bet > g.chips) return;
    busy = true;
    if (g.phase === 'over') resetTable();
    roundId++; shownKeys = new Set();
    g.deal();
    save();
    // hide the dealt cards, shuffle first, then deal one card at a time:
    // player, dealer, player, dealer (face down)
    const finalDealer = g.dealer.cards.slice(), finalHand = g.hands[0].cards.slice();
    const phase = g.phase, hidden = g.dealer.hidden;
    const results = g.hands.map((h) => h.result);
    g.hands.forEach((h) => { h.result = null; });
    g.phase = 'dealing';
    g.hands[0].cards = []; g.dealer.cards = []; g.dealer.hidden = true;
    render();
    Sound.play('shuffle');
    await sleep(650);
    const steps = [[1, 0], [1, 1], [2, 1], [2, 2]];
    for (const [p, dd] of steps) {
      g.hands[0].cards = finalHand.slice(0, p);
      g.dealer.cards = finalDealer.slice(0, dd);
      g.dealer.hidden = true;
      await show();
    }
    g.phase = phase; g.dealer.hidden = hidden;
    if (!hidden) { await show(); await sleep(450); } // instant blackjack: flip the hole card first
    g.hands.forEach((h, i) => { h.result = results[i]; }); // dealer/player blackjack: flip
    await afterAction(true);
  }
  async function afterAction(fromDeal) {
    busy = true;
    await show();
    if (g.phase === 'dealer') {
      await sleep(350);
      await show(); // hole card flips
      await sleep(500);
      while (g.dealerNeedsCard()) { g.dealerHit(); await show(); await sleep(350); }
      g.settle();
    }
    if (g.phase === 'over') finishRound();
    busy = false;
    render();
  }
  function finishRound() {
    for (const h of g.hands) {
      if (h.result === 'win' || h.result === 'blackjack') stats.w++;
      else if (h.result === 'push') stats.p++;
      else stats.l++;
    }
    save();
    const anyBJ = g.hands.some((h) => h.result === 'blackjack');
    const allBust = g.hands.every((h) => h.result === 'bust');
    Sound.play(anyBJ ? 'blackjack' : g.net > 0 ? 'win' : g.net < 0 ? (allBust ? 'lose' : 'lose') : 'push', allBust ? 500 : 150);
    const nf = $('#netFlash');
    nf.textContent = g.net > 0 ? '+' + money(g.net) : g.net < 0 ? '−' + money(-g.net) : '';
    nf.style.color = g.net > 0 ? '#7ef0a8' : '#ff8a8a';
    nf.classList.remove('show'); void nf.offsetWidth; if (g.net) nf.classList.add('show');
  }

  // ---------- input ----------
  $('#controls').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-chip]');
    if (chip) return act('chip', +chip.dataset.chip);
    const b = e.target.closest('[data-a]');
    if (b && !b.disabled) act(b.dataset.a);
  });
  addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    const map = { play: { h: 'hit', s: 'stand', d: 'double', p: 'split' }, insurance: { y: 'insYes', n: 'insNo' } };
    if ((g.phase === 'bet' || g.phase === 'over') && (k === ' ' || k === 'enter')) { e.preventDefault(); act('deal'); return; }
    const a = map[g.phase] && map[g.phase][k];
    if (!a) return;
    if (a === 'double' && !g.canDouble()) return;
    if (a === 'split' && !g.canSplit()) return;
    act(a);
  });
  $('#hintToggle').checked = hintOn;
  $('#hintToggle').addEventListener('change', (e) => { hintOn = e.target.checked; localStorage.setItem('pk_bj_hint', hintOn ? '1' : '0'); render(); });
  const soundIcon = () => { $('#soundBtn').textContent = Sound.enabled ? '🔊' : '🔇'; };
  $('#soundBtn').addEventListener('click', () => { Sound.toggle(); soundIcon(); });
  soundIcon();
  $('#langBtn').addEventListener('click', () => { lang = lang === 'ko' ? 'en' : 'ko'; localStorage.setItem('pk_lang', lang); applyStatic(); render(); });
  function applyStatic() {
    document.documentElement.lang = lang;
    $('#langBtn').textContent = lang === 'ko' ? 'EN' : '한국어';
    $('#hintLabel').textContent = t('hint');
    $('#homeLink').title = t('homeTitle');
    $('#rotateTxt').textContent = t('rotate');
  }
  let toastT;
  function toast(msg, ok) {
    const el = $('#toast');
    el.textContent = msg; el.className = 'toast show' + (ok ? ' ok' : '');
    clearTimeout(toastT); toastT = setTimeout(() => { el.className = 'toast' + (ok ? ' ok' : ''); }, 2400);
  }
  addEventListener('resize', () => render());

  applyStatic();
  render();
})();
