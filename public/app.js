(() => {
  const $ = (s) => document.querySelector(s);
  const E = window.PokerEval;
  const SUIT = ['♠', '♥', '♦', '♣'];
  const money = (n) => '$' + Math.round(n).toLocaleString('en-US');
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cleanRoom = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 20);

  // ---------- i18n ----------
  let lang = localStorage.getItem('pk_lang') || ((navigator.language || '').toLowerCase().startsWith('ko') ? 'ko' : 'en');
  const t = (k, p = {}) => {
    let s = (I18N[lang] && I18N[lang][k]) ?? I18N.ko[k] ?? k;
    if (typeof s !== 'string') return s;
    return s.replace(/\{(\w+)\}/g, (_, x) => (p[x] ?? ''));
  };
  function applyStatic() {
    document.documentElement.lang = lang;
    document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll('[data-i18n-html]').forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
    document.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
    document.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); });
    document.querySelectorAll('[data-lang-toggle]').forEach((el) => { el.textContent = lang === 'ko' ? 'EN' : '한국어'; });
    $('#logToggle').textContent = $('#logp').classList.contains('collapsed') ? t('expand') : t('collapse');
  }
  document.querySelectorAll('[data-lang-toggle]').forEach((el) => el.addEventListener('click', () => {
    lang = lang === 'ko' ? 'en' : 'ko';
    localStorage.setItem('pk_lang', lang);
    applyStatic(); eqKey = '';
    if (state) render();
    renderHome();
  }));
  const RL = (r) => E.RANK_LABEL[r];
  function describeScore(s) {
    const c = E.category(s), d = E.digits(s), cat = t('cat');
    switch (c) {
      case 8: return d[0] === 12 ? t('royal') : `${cat[8]} (${t('hi', { r: RL(d[0]) })})`;
      case 6: return `${cat[6]} (${t('fh', { a: RL(d[0]), b: RL(d[1]) })})`;
      case 5: case 4: case 0: return `${cat[c]} (${c === 0 ? RL(d[0]) : t('hi', { r: RL(d[0]) })})`;
      case 2: return `${cat[2]} (${RL(d[0])}, ${RL(d[1])})`;
      default: return `${cat[c]} (${RL(d[0])})`;
    }
  }
  const catName = (s) => t('cat')[E.category(s)];
  const cardText = (c) => RL(c >> 2) + SUIT[c & 3];
  function logText(l) {
    const p = { ...l.p };
    if (p.amount != null) p.amount = money(p.amount);
    if (l.k === 'board') { p.street = t(p.street); p.cards = p.cards.map(cardText).join(' '); }
    if (l.k === 'win') p.hand = describeScore(p.score);
    if (l.k === 'action') { p.act = t(l.p.act); p.amount = l.p.amount ? ' ' + money(l.p.amount) : ''; }
    return t('L.' + l.k, p);
  }
  const errText = (j) => t('E.' + j.error, j.params && j.params.amount != null ? { amount: money(j.params.amount) } : {});

  // ---------- app state ----------
  const params = new URLSearchParams(location.search);
  let roomId = cleanRoom(params.get('room'));
  const tokKey = () => 'pk_token_' + roomId;
  let token = roomId ? localStorage.getItem(tokKey()) || '' : '';
  let state = null, es = null, clockOffset = 0, watching = false, screen = 'home';
  let seen = new Set(), seenHand = -1, lastDecisionKey = '', wonShown = new Set();

  function showScreen(s) {
    screen = s;
    $('#home').classList.toggle('hide', s !== 'home');
    $('#game').classList.toggle('hide', s !== 'game');
    document.body.classList.toggle('in-game', s === 'game');
    if (s === 'game') { resize(); maybeFullscreenHint(); }
    else renderHome();
  }

  // ---------- layout ----------
  const POS = [[50, 109], [1, 63], [10, 5], [50, -9], [90, 5], [99, 63]];
  function resize() {
    const top = innerHeight <= 560 ? 44 : 52;
    const u = Math.max(3.2, Math.min((innerWidth - 20) / 116, (innerHeight - top - 10) / 71));
    document.documentElement.style.setProperty('--u', u + 'px');
  }
  addEventListener('resize', () => { resize(); maybeFullscreenHint(); });
  resize();
  const lerp = (p, f) => [p[0] + (50 - p[0]) * f, p[1] + (50 - p[1]) * f];
  function dealerPos(p) {
    const vx = 50 - p[0], vy = (50 - p[1]) * 0.5;
    const len = Math.hypot(vx, vy) || 1;
    const nx = vx / len, ny = vy / len;
    return [p[0] + nx * len * 0.27 - ny * 7.5, (p[1] * 0.5 + ny * len * 0.27 + nx * 7.5) / 0.5];
  }

  // ---------- render helpers ----------
  function cardHTML(c, cls = '') {
    if (c == null) return `<div class="card back ${cls}"></div>`;
    const r = RL(c >> 2), s = c & 3, red = s === 1 || s === 2;
    const center = ['J', 'Q', 'K'].includes(r) ? `<div class="face">${r}</div>` : `<div class="pip">${SUIT[s]}</div>`;
    return `<div class="card ${red ? 'red' : ''} ${cls}"><div class="cr tl"><b>${r}</b><i>${SUIT[s]}</i></div>${center}<div class="cr br"><b>${r}</b><i>${SUIT[s]}</i></div></div>`;
  }
  const CHIP_DEN = [[25000, '#5b2a86'], [5000, '#e2701f'], [1000, '#e8c33a'], [500, '#7b3fb0'], [100, '#1b1b1b'], [25, '#1f8a4c'], [1, '#d9d9d9']];
  function chipsHTML(amount, max = 7) {
    const out = [];
    let a = amount;
    for (const [d, col] of CHIP_DEN) while (a >= d && out.length < max) { out.push(col); a -= d; }
    if (!out.length) out.push('#d9d9d9');
    return out.reverse().map((col, i) => `<div class="chip" style="--c:${col};bottom:calc(var(--u)*${i * 0.32})"></div>`).join('');
  }
  function avatarColor(name) {
    let h = 0;
    for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
    return `linear-gradient(145deg,hsl(${h} 55% 48%),hsl(${(h + 30) % 360} 60% 30%))`;
  }
  const BADGE = { fold: 'fold', check: 'check', call: 'call', bet: 'raise', raise: 'raise', allin: 'allin', SB: 'blind', BB: 'blind' };
  function animClass(key, cls) { if (seen.has(key)) return ''; seen.add(key); return cls; }

  // ---------- equity ----------
  let eqKey = '', eqHist = {}, eqRes = null, allinEq = {}, allinKey = '';
  function computeEquity() {
    const h = state.hand, ms = state.mySeat;
    const me = ms != null ? state.seats[ms] : null;
    if (h && h.revealAll) {
      const shown = state.seats.map((p, i) => (p && p.inHand && !p.folded && p.cards ? i : -1)).filter((i) => i >= 0);
      const k = state.handNo + '|' + h.board.join() + '|' + shown.join();
      if (k !== allinKey && shown.length >= 2) {
        allinKey = k;
        const r = E.multiEquity(shown.map((i) => state.seats[i].cards), h.board, 8000);
        allinEq = {};
        shown.forEach((s, j) => { allinEq[s] = r[j].share; });
      }
    } else { allinEq = {}; allinKey = ''; }

    if (!me || !me.cards || !h || !h.board || me.folded) { eqRes = null; return; }
    const opps = state.seats.filter((p, i) => p && p.inHand && !p.folded && i !== ms);
    const k = state.handNo + '|' + me.cards.join() + '|' + h.board.join() + '|' + opps.length + '|' + (allinEq[ms] != null);
    if (k === eqKey && eqRes) return;
    eqKey = k;
    if (seenHand !== state.handNo) eqHist = {};
    let share, win, tie;
    if (allinEq[ms] != null) { share = allinEq[ms]; win = share; tie = 0; }
    else {
      const r = E.equity(me.cards, h.board, opps.length, opps.length >= 4 ? 7000 : 10000);
      share = r.share; win = r.win; tie = r.tie;
    }
    const stage = h.board.length === 0 ? 'preflop' : h.board.length === 3 ? 'flop' : h.board.length === 4 ? 'turn' : 'river';
    eqHist[stage] = share;
    eqRes = { share, win, tie, opps: opps.length, stage, known: allinEq[ms] != null };
  }
  function handLabel(cards, board) {
    if (board.length >= 3) return describeScore(E.evaluate([...cards, ...board]));
    const [a, b] = cards, ra = a >> 2, rb = b >> 2;
    if (ra === rb) return t('pocket', { r: RL(ra) });
    return `${RL(Math.max(ra, rb))}-${RL(Math.min(ra, rb))} ${(a & 3) === (b & 3) ? t('suited') : t('offsuit')}`;
  }
  function renderEquity() {
    const body = $('#eqBody'), h = state.hand, ms = state.mySeat;
    const me = ms != null ? state.seats[ms] : null;
    if (!eqRes) {
      $('#eqOpp').textContent = '';
      let msg = t('eqIdle');
      if (ms == null) msg = t('eqWatch');
      else if (me && me.folded) msg = t('eqFolded');
      else if (h && h.stage && me && !me.inHand) msg = t('eqNext');
      body.innerHTML = `<div class="eqidle">${msg}</div>`;
      return;
    }
    const r = eqRes;
    $('#eqOpp').textContent = r.known ? t('knownBasis') : t('opps', { n: r.opps });
    let prev = null;
    const hist = ['preflop', 'flop', 'turn', 'river'].map((s) => {
      const v = eqHist[s];
      if (v == null) return `<div><em>${t(s)}</em><b>–</b></div>`;
      let arrow = '';
      if (prev != null) { const d = v - prev; if (Math.abs(d) >= 0.005) arrow = `<span class="${d > 0 ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'}</span>`; }
      prev = v;
      return `<div class="${s === r.stage ? 'cur' : ''}"><em>${t(s)}</em><b>${(v * 100).toFixed(0)}%</b>${arrow}</div>`;
    }).join('');
    const col = r.share >= 0.5 ? '#7ef0a8' : r.share >= 0.25 ? '#f3d27a' : '#ff9a9a';
    body.innerHTML = `
      <div class="eqbig"><b style="color:${col}">${(r.share * 100).toFixed(1)}%</b><span>${t('win')} ${(r.win * 100).toFixed(1)}% · ${t('tie')} ${(r.tie * 100).toFixed(1)}%</span></div>
      <div class="eqbar"><i class="w" style="width:${r.win * 100}%"></i><i class="t" style="width:${r.tie * 100}%"></i></div>
      <div class="eqhand">${esc(handLabel(me.cards, h.board))}<small>${r.known ? t('eqExact') : t('eqSim')}</small></div>
      <div class="eqhist">${hist}</div>`;
  }

  // ---------- main render ----------
  function render() {
    if (screen !== 'game') return;
    const s = state, h = s.hand || {}, ms = s.mySeat;
    if (seenHand !== s.handNo) seen = new Set();
    computeEquity();
    seenHand = s.handNo;

    $('#roomName').textContent = s.room;
    $('#blinds').textContent = `${money(s.cfg.sb)} / ${money(s.cfg.bb)}`;
    $('#handNo').textContent = s.handNo ? '#' + s.handNo : '-';
    const me = ms != null ? s.seats[ms] : null;
    const seated = s.seats.filter((p) => p && !p.leaving).length;
    $('#startBtn').classList.toggle('hide', !me || s.running || seated < 2);
    $('#rebuyBtn').classList.toggle('hide', !me || me.chips > 0 || (me.inHand && h.stage !== 'showdown' && h.stage !== 'done'));
    $('#rebuyBtn').textContent = t('rebuy', { amt: money(s.cfg.start) });
    $('#sitBtn').classList.toggle('hide', !me);
    $('#sitBtn').textContent = me && me.sittingOut ? t('sitBack') : t('sitOut');

    const board = h.board || [];
    let boardHTML = '';
    for (let i = 0; i < 5; i++) boardHTML += board[i] != null ? cardHTML(board[i], animClass(`b${i}-${board[i]}`, 'flip')) : '<div class="slot"></div>';
    $('#board').innerHTML = boardHTML;

    const potShown = h.potCenter || 0;
    $('#pot').innerHTML = `${t('pot')} <span>${money(h.pot || 0)}</span>`;
    $('#pot').classList.toggle('hide', !h.pot);
    $('#potChips').innerHTML = potShown ? chipsHTML(potShown, 9) : '';
    $('#potChips').classList.toggle('hide', !potShown);

    const won = (h.results && h.results.won) || {};
    const onlyRefund = h.results && h.results.pots.every((x) => x.single) && h.stage === 'showdown';
    let html = '';
    for (let d = 0; d < 6; d++) {
      const si = ms != null ? (ms + d) % 6 : d;
      const p = s.seats[si] && !s.seats[si].leaving ? s.seats[si] : null;
      const pos = POS[d];
      const style = `left:${pos[0]}%;top:${pos[1]}%`;
      if (!p) {
        html += ms == null
          ? `<div class="seat" style="${style}"><button class="empty" data-sit="${si}">${t('sit')}</button></div>`
          : `<div class="seat" style="${style}"><div class="empty">${t('emptySeat')}</div></div>`;
        continue;
      }
      const isMe = si === ms, turn = h.toAct === si;
      const cls = ['seat', isMe ? 'me' : '', turn ? 'turn' : '', p.folded ? 'folded' : '', (!p.inHand && h.stage) || p.sittingOut ? 'out' : '', won[si] && !onlyRefund ? 'winner' : ''].join(' ');
      let hole = '<div class="hole"></div>';
      if (p.inHand && p.cards) {
        const size = isMe ? 'lg' : 'sm';
        hole = `<div class="hole ${isMe ? '' : 'rev'}">${p.cards.map((c, k) => cardHTML(c, `${size} ${p.folded ? 'dim' : ''} ${animClass(`h${si}-${k}-${c}`, isMe ? 'deal' : 'flip')}`)).join('')}</div>`;
      } else if (p.hasCards) {
        hole = `<div class="hole">${[0, 1].map((k) => cardHTML(null, `sm ${animClass(`h${si}-${k}-x`, 'deal')}`)).join('')}</div>`;
      }
      let badge = '';
      if (h.stage === 'showdown' && p.cards && !p.folded && board.length >= 3) badge = `<div class="badge hand">${esc(catName(E.evaluate([...p.cards, ...board])))}</div>`;
      else if (p.sittingOut && !p.inHand) badge = `<div class="badge fold">${t('away')}</div>`;
      else if (p.lastAction) badge = `<div class="badge ${BADGE[p.lastAction] || ''}">${esc(t(p.lastAction))}</div>`;

      const eqTag = allinEq[si] != null && h.stage !== 'showdown' ? `<div class="eqtag">${(allinEq[si] * 100).toFixed(0)}%</div>` : '';
      const ringR = 15.5, circ = 2 * Math.PI * ringR;
      const ring = turn ? `<svg viewBox="0 0 36 36"><circle class="trk" cx="18" cy="18" r="${ringR}"/><circle class="tmr" id="ring" cx="18" cy="18" r="${ringR}" stroke-dasharray="${circ}" stroke-dashoffset="0"/></svg>` : '';
      const wk = `${s.handNo}-${si}`;
      const wonFloat = won[si] ? `<div class="wonfloat" ${wonShown.has(wk) ? 'style="animation:none"' : ''}>+${money(won[si])}</div>` : '';
      if (won[si]) wonShown.add(wk);
      const sub = !p.connected ? `<div class="sub offline">${t('offline')}</div>` : p.allIn ? '<div class="sub" style="color:#ff8a8a">ALL-IN</div>' : '';
      html += `<div class="${cls}" style="${style}">
        ${hole}
        <div class="plate">
          <div class="avatar" style="background:${avatarColor(p.name)}">${ring}${esc([...p.name][0].toUpperCase())}</div>
          <div class="info"><div class="nm">${esc(p.name)}${isMe ? ' ' + t('me') : ''}</div><div class="stk">${money(p.chips)}</div>${sub}</div>
          ${eqTag}
        </div>
        ${wonFloat}${badge}
      </div>`;
      if (p.bet > 0) {
        const bp = lerp(pos, d === 0 || d === 3 ? 0.44 : 0.36);
        html += `<div class="betspot" style="left:${bp[0]}%;top:${bp[1]}%"><div class="chipstack">${chipsHTML(p.bet)}</div><div class="betamt">${money(p.bet)}</div></div>`;
      }
      if (h.button === si) {
        const dp = dealerPos(pos);
        html += `<div class="dealer" style="left:${dp[0]}%;top:${dp[1]}%">D</div>`;
      }
    }
    $('#layer').innerHTML = html;
    if (wonShown.size > 300) wonShown = new Set([...wonShown].slice(-50));

    let msg = '';
    if (!s.handNo || !h.stage) {
      if (seated < 2) msg = `${t('waitFriends')} <small>${t('waitFriendsSub')}</small>`;
      else if (!s.running) msg = `${t('ready')} <small>${t('readySub')}</small>`;
      else msg = `${t('nextPrep')} <small>${t('nextPrepSub')}</small>`;
    } else if (h.results) {
      const parts = h.results.pots.filter((p) => !p.single || h.results.pots.length === 1).map((p) => {
        const names = p.winners.map((w) => esc(s.seats[w] ? s.seats[w].name : '?')).join(', ');
        return `<span class="win">${names}</span> ${p.score != null ? '· ' + esc(describeScore(p.score)) + ' ' : ''}· ${money(p.amount)}`;
      });
      msg = parts.join('<br>') + `<small id="nextIn"></small>`;
    } else if (h.revealAll) msg = t('allinMsg');
    else if (h.toAct >= 0 && s.seats[h.toAct]) msg = h.toAct === ms ? t('yourTurn') : esc(t('thinking', { name: s.seats[h.toAct].name }));
    $('#tmsg').innerHTML = msg;

    renderActions();
    renderEquity();
    renderLog();
    document.title = s.actions ? `${t('titleTurn')} · Home Game` : "Home Game · Texas Hold'em";
  }

  // ---------- actions ----------
  let raiseVal = 0, confirmFold = false;
  const kbd = (k) => (matchMedia('(hover:hover)').matches ? `<kbd>${k}</kbd>` : '');
  function clampRaise(v, exact) {
    const a = state.actions;
    v = exact ? Math.floor(v) : Math.round(v / 50) * 50;
    return Math.max(a.minTo, Math.min(a.maxTo, v || a.minTo));
  }
  function presetValue(p) {
    const a = state.actions, h = state.hand;
    const pac = h.pot + a.toCall;
    return clampRaise({ min: a.minTo, half: a.currentBet + pac * 0.5, '3q': a.currentBet + pac * 0.75, pot: a.currentBet + pac, allin: a.maxTo }[p]);
  }
  function renderActions() {
    const a = state.actions, box = $('#act');
    const ms = state.mySeat, me = ms != null ? state.seats[ms] : null;
    box.classList.toggle('myturn', !!a);
    box.classList.toggle('waiting', !a);
    ['#foldBtn', '#callBtn', '#raiseBtn'].forEach((id) => { $(id).disabled = !a; });
    $('#foldBtn').innerHTML = t('fold') + kbd('F');
    if (!a) {
      $('#raiseBox').classList.add('hide');
      $('#callBtn').innerHTML = t('check') + kbd('C');
      $('#raiseBtn').innerHTML = t('raise') + kbd('R');
      const h = state.hand || {};
      $('#actNote').innerHTML = !me ? t('sitToPlay') : (h.toAct >= 0 && state.seats[h.toAct] ? esc(t('turnOf', { name: state.seats[h.toAct].name })) : '');
      return;
    }
    const key = state.handNo + '|' + state.hand.stage + '|' + a.currentBet + '|' + a.myBet;
    if (key !== lastDecisionKey) { lastDecisionKey = key; raiseVal = a.minTo; }
    raiseVal = clampRaise(raiseVal, true);
    $('#callBtn').innerHTML = (a.canCheck ? t('check') : `${a.toCall >= me.chips ? t('allin') : t('call')} ${money(a.toCall)}`) + kbd('C');
    const showRaise = a.canRaise && !(a.toCall >= me.chips);
    $('#raiseBox').classList.toggle('hide', !showRaise);
    $('#raiseBtn').disabled = !showRaise;
    const sl = $('#slider');
    sl.min = a.minTo; sl.max = a.maxTo; sl.step = 50; sl.value = raiseVal;
    if (document.activeElement !== $('#ramt')) $('#ramt').value = raiseVal;
    $('#rangeHint').textContent = t('range', { min: money(a.minTo), max: money(a.maxTo) });
    updateRaiseLabel();
  }
  function updateRaiseLabel() {
    const a = state && state.actions;
    if (!a) return;
    const word = raiseVal >= a.maxTo ? t('allin') : a.currentBet === 0 ? t('bet') : t('raise');
    $('#raiseBtn').innerHTML = `${word} ${money(raiseVal)}${kbd('R')}`;
  }
  $('#slider').addEventListener('input', (e) => { raiseVal = clampRaise(+e.target.value); $('#ramt').value = raiseVal; updateRaiseLabel(); });
  $('#ramt').addEventListener('input', (e) => { const v = +e.target.value; if (state.actions && v) { raiseVal = Math.max(state.actions.minTo, Math.min(state.actions.maxTo, v)); $('#slider').value = raiseVal; updateRaiseLabel(); } });
  $('#ramt').addEventListener('blur', () => { if (state && state.actions) { raiseVal = clampRaise(raiseVal, true); $('#ramt').value = raiseVal; } });
  $('#ramt').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#ramt').blur(); doRaise(); } });
  const stepRaise = (dir) => {
    const a = state && state.actions; if (!a) return;
    const step = state.cfg.bb;
    raiseVal = clampRaise(dir > 0 ? Math.floor(raiseVal / step) * step + step : Math.ceil(raiseVal / step) * step - step, true);
    $('#slider').value = raiseVal; $('#ramt').value = raiseVal; updateRaiseLabel();
  };
  $('#minusBtn').onclick = () => stepRaise(-1);
  $('#plusBtn').onclick = () => stepRaise(1);
  document.querySelectorAll('.presets button').forEach((b) => b.addEventListener('click', () => {
    if (!state.actions) return;
    raiseVal = presetValue(b.dataset.p); $('#slider').value = raiseVal; $('#ramt').value = raiseVal; updateRaiseLabel();
  }));
  function doFold() {
    const a = state.actions;
    if (!a) return;
    if (a.canCheck && !confirmFold) { confirmFold = true; toast(t('checkInstead'), true); setTimeout(() => { confirmFold = false; }, 2500); return; }
    confirmFold = false;
    api('action', { action: 'fold' });
  }
  const doCall = () => state.actions && api('action', { action: state.actions.canCheck ? 'check' : 'call' });
  const doRaise = () => { const a = state.actions; if (!a || !a.canRaise) return; api('action', raiseVal >= a.maxTo ? { action: 'allin' } : { action: 'raise', amount: raiseVal }); };
  $('#foldBtn').onclick = doFold; $('#callBtn').onclick = doCall; $('#raiseBtn').onclick = doRaise;
  addEventListener('keydown', (e) => {
    if (screen !== 'game' || e.target.tagName === 'INPUT' || !state || !state.actions) return;
    const k = e.key.toLowerCase();
    if (k === 'f') doFold(); else if (k === 'c') doCall(); else if (k === 'r') doRaise();
  });

  function renderLog() {
    const ul = $('#log');
    const atBottom = ul.scrollTop + ul.clientHeight >= ul.scrollHeight - 10;
    ul.innerHTML = state.log.map((l) => `<li class="${l.k === 'hand' ? 'sep' : ''}">${esc(logText(l))}</li>`).join('');
    if (atBottom) ul.scrollTop = ul.scrollHeight;
  }
  $('#logHead').onclick = () => { const c = $('#logp').classList.toggle('collapsed'); $('#logToggle').textContent = c ? t('expand') : t('collapse'); $('#log').scrollTop = 1e9; };

  function tick() {
    if (state && screen === 'game') {
      const now = Date.now() + clockOffset, h = state.hand || {};
      const ring = document.getElementById('ring');
      if (ring && h.deadline) {
        const left = Math.max(0, h.deadline - now), frac = left / state.cfg.turnMs;
        ring.setAttribute('stroke-dashoffset', String(+ring.getAttribute('stroke-dasharray') * (1 - frac)));
        ring.style.stroke = frac < 0.25 ? '#ff5a5a' : frac < 0.5 ? '#f3a33a' : '#f3c45a';
        if (state.actions) $('#actNote').innerHTML = t('timeLeft', { n: Math.ceil(left / 1000), act: state.actions.canCheck ? t('check') : t('fold') });
      }
      const ni = document.getElementById('nextIn');
      if (ni && state.nextAt) ni.textContent = t('nextIn', { n: Math.max(0, Math.ceil((state.nextAt - now) / 1000)) });
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // ---------- network ----------
  // ---------- sounds from table events ----------
  let lastLogKey = null, hadActions = false, winPlayed = -1;
  const logKey = (l) => l ? `${l.t}|${l.k}|${JSON.stringify(l.p)}` : '';
  function playSounds(s) {
    const log = s.log || [];
    if (lastLogKey === null) { lastLogKey = logKey(log[log.length - 1]); hadActions = !!s.actions; return; }
    const idx = log.findIndex((l) => logKey(l) === lastLogKey);
    const fresh = idx >= 0 ? log.slice(idx + 1) : log.slice(-2);
    let d = 0;
    for (const l of fresh) {
      if (l.k === 'hand') {
        Sound.play('shuffle', d); d += 520;
        const n = s.seats.filter((p) => p && p.inHand).length;
        for (let i = 0; i < n * 2; i++) Sound.play('card', d + i * 90);
        d += n * 180;
      } else if (l.k === 'action') {
        const a = l.p.act;
        Sound.play(a === 'check' ? 'check' : a === 'fold' ? 'fold' : a === 'call' ? 'chip' : 'chips', d); d += 140;
      } else if (l.k === 'board') {
        const k = l.p.street === 'flop' ? 3 : 1;
        for (let i = 0; i < k; i++) Sound.play('flip', d + i * 160);
        d += k * 160;
      } else if (l.k === 'win' || l.k === 'foldWin' || l.k === 'refund') {
        Sound.play('pot', d); d += 200;
      }
    }
    if (log.length) lastLogKey = logKey(log[log.length - 1]);
    const h = s.hand || {};
    if (h.results && s.mySeat != null && h.results.won && h.results.won[s.mySeat] && winPlayed !== s.handNo) {
      winPlayed = s.handNo; Sound.play('win', d + 100);
    }
    if (s.actions && !hadActions) Sound.play('turn', d + 150);
    hadActions = !!s.actions;
  }
  const soundIcon = () => { $('#soundBtn').textContent = Sound.enabled ? '🔊' : '🔇'; };
  $('#soundBtn').onclick = () => { Sound.toggle(); soundIcon(); };
  soundIcon();

  function connect() {
    if (es) es.close();
    state = null; lastLogKey = null;
    es = new EventSource(`/events?room=${encodeURIComponent(roomId)}&token=${encodeURIComponent(token)}`);
    es.onopen = () => $('#conn').classList.remove('off');
    es.onerror = () => $('#conn').classList.add('off');
    es.onmessage = (e) => {
      state = JSON.parse(e.data);
      clockOffset = state.now - Date.now();
      try { playSounds(state); } catch (err) { /* sound is optional */ }
      if (state.mySeat != null) { watching = false; if (screen !== 'game') showScreen('game'); }
      else if (screen === 'game' && !watching) { showScreen('home'); }
      if (screen === 'game') render(); else renderHome();
    };
  }
  function disconnect() { if (es) es.close(); es = null; state = null; }
  async function api(path, body = {}, quiet) {
    try {
      const res = await fetch('/api/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ room: roomId, token, ...body }) });
      const j = await res.json();
      if (j.error && !quiet) toast(errText(j));
      return j;
    } catch (e) { if (!quiet) toast(t('E.conn')); return {}; }
  }
  let toastT;
  function toast(msg, ok) {
    const el = $('#toast');
    el.textContent = msg; el.className = 'toast show' + (ok ? ' ok' : '');
    clearTimeout(toastT); toastT = setTimeout(() => { el.className = 'toast' + (ok ? ' ok' : ''); }, 2600);
  }
  function setUrl(room) { history.replaceState(null, '', room ? '/?room=' + encodeURIComponent(room) : '/'); }

  // ---------- home ----------
  const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const newCode = () => Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
  $('#heroCards').innerHTML = cardHTML(48, 'hero1') + cardHTML(45, 'hero2'); // A♠ K♥
  $('#nameIn').value = localStorage.getItem('pk_name') || '';
  const lastRoom = () => localStorage.getItem('pk_last_room') || '';

  function renderHome() {
    if (screen !== 'home') return;
    const invited = !!roomId;
    $('#inviteInfo').classList.toggle('hide', !invited);
    $('#inviteBlock').classList.toggle('hide', !invited);
    $('#createBlock').classList.toggle('hide', invited);
    if (invited) {
      $('#iiRoom').textContent = roomId;
      const players = state ? state.seats.filter((p) => p && !p.leaving) : [];
      const full = players.length >= 6;
      $('#iiPlayers').innerHTML = !state ? '…' : players.length
        ? `${t('players', { n: players.length })} · ${players.map((p) => esc(p.name)).join(', ')}${full ? `<br><span class="warn">${t('tableFull')}</span>` : ''}`
        : t('noPlayers');
      $('#joinInviteBtn').disabled = full;
    }
    const lr = lastRoom();
    const showResume = !invited && lr && localStorage.getItem('pk_token_' + lr);
    $('#resumeBtn').classList.toggle('hide', !showResume);
    if (showResume) $('#resumeBtn').textContent = t('resume', { room: lr }) + ' →';
  }

  function getName() {
    const name = $('#nameIn').value.trim();
    if (!name) { toast(t('needName')); $('#nameIn').focus(); return null; }
    localStorage.setItem('pk_name', name);
    return name;
  }
  async function enterRoom(room, name, seat) {
    roomId = cleanRoom(room);
    token = localStorage.getItem(tokKey()) || '';
    const r = await api('join', { name, seat });
    if (!r.token) return;
    token = r.token;
    localStorage.setItem(tokKey(), token);
    localStorage.setItem('pk_last_room', roomId);
    setUrl(roomId);
    watching = false;
    connect();
  }
  $('#createBtn').onclick = () => { const n = getName(); if (n) enterRoom(newCode(), n); };
  $('#joinCodeBtn').onclick = () => {
    const n = getName(); if (!n) return;
    const code = cleanRoom($('#codeIn').value);
    if (!code) { toast(t('needCode')); $('#codeIn').focus(); return; }
    enterRoom(code, n);
  };
  $('#codeIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#joinCodeBtn').click(); } });
  $('#homeForm').addEventListener('submit', (e) => {
    e.preventDefault();
    if (roomId) { const n = getName(); if (n) enterRoom(roomId, n); }
    else $('#createBtn').click();
  });
  $('#watchBtn').onclick = () => { watching = true; showScreen('game'); if (state) render(); };
  $('#otherBtn').onclick = () => { disconnect(); roomId = ''; token = ''; setUrl(''); renderHome(); };
  $('#resumeBtn').onclick = () => {
    roomId = lastRoom(); token = localStorage.getItem(tokKey()) || '';
    setUrl(roomId); connect();
  };

  // ---------- game top bar ----------
  $('#layer').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-sit]');
    if (!b) return;
    let name = localStorage.getItem('pk_name');
    if (!name) { name = (prompt(t('namePrompt')) || '').trim().slice(0, 12); if (!name) return; localStorage.setItem('pk_name', name); }
    enterRoom(roomId, name, +b.dataset.sit);
  });
  $('#inviteBtn').onclick = async () => {
    const link = location.origin + '/?room=' + encodeURIComponent(roomId);
    try {
      if (navigator.share && matchMedia('(pointer:coarse)').matches) { await navigator.share({ title: 'Home Game', text: "Texas Hold'em 🃏", url: link }); return; }
      await navigator.clipboard.writeText(link); toast(t('copied') + ': ' + link, true);
    } catch (err) { if (err && err.name === 'AbortError') return; prompt(t('copyPrompt'), link); }
  };
  $('#startBtn').onclick = () => api('start');
  $('#sitBtn').onclick = () => api('sitout');
  $('#rebuyBtn').onclick = () => api('rebuy');
  async function leaveTable() {
    const me = state && state.mySeat != null;
    if (me) {
      if (!confirm(t('leaveConfirm'))) return;
      await api('leave');
    }
    localStorage.removeItem(tokKey());
    if (localStorage.getItem('pk_last_room') === roomId) localStorage.removeItem('pk_last_room');
    disconnect(); roomId = ''; token = ''; watching = false; setUrl('');
    showScreen('home');
  }
  $('#leaveBtn').onclick = leaveTable;
  $('#homeBtn').onclick = leaveTable;

  // ---------- fullscreen (Android / desktop); iPhone uses "Add to Home Screen" ----------
  const de = document.documentElement;
  const fsSupported = !!(de.requestFullscreen || de.webkitRequestFullscreen) && !/iPhone|iPod/.test(navigator.userAgent);
  const isStandalone = matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || navigator.standalone;
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isTouch = matchMedia('(pointer:coarse)').matches;
  const inFs = () => document.fullscreenElement || document.webkitFullscreenElement;
  function goFullscreen() {
    const fn = de.requestFullscreen || de.webkitRequestFullscreen;
    if (!fn || inFs()) return;
    Promise.resolve(fn.call(de, { navigationUI: 'hide' })).then(() => {
      const so = window.screen.orientation; if (so && so.lock) so.lock('landscape').catch(() => {});
    }).catch(() => {});
  }
  $('#fsBtn').classList.toggle('hide', !fsSupported || isStandalone);
  $('#fsBtn').onclick = () => (inFs() ? (document.exitFullscreen || document.webkitExitFullscreen).call(document) : goFullscreen());
  let wantFs = false;
  function maybeFullscreenHint() {
    // a browser only allows fullscreen from a tap, so arm it and enter on the next touch
    wantFs = fsSupported && isTouch && !isStandalone && screen === 'game' && innerWidth > innerHeight && !inFs();
  }
  document.addEventListener('pointerdown', () => { if (wantFs) { wantFs = false; goFullscreen(); } }, true);
  if (isIOS && !isStandalone) $('#iosHint').classList.remove('hide');

  // keep free hosting awake while the page is open
  setInterval(() => { fetch('/ping').catch(() => {}); }, 4 * 60 * 1000);

  // ---------- boot ----------
  applyStatic();
  showScreen('home');
  if (roomId) connect();
})();
