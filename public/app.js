(() => {
  const $ = (s) => document.querySelector(s);
  const E = window.PokerEval;
  const SUIT = ['♠', '♥', '♦', '♣'];
  const money = (n) => '$' + Math.round(n).toLocaleString('en-US');
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const STAGE_KO = { preflop: '프리플랍', flop: '플랍', turn: '턴', river: '리버' };

  const params = new URLSearchParams(location.search);
  let roomId = (params.get('room') || 'main').replace(/[^\w-]/g, '').slice(0, 20) || 'main';
  const tokKey = () => 'pk_token_' + roomId;
  let token = localStorage.getItem(tokKey()) || '';
  let state = null, es = null, clockOffset = 0, wantSeat = null, watching = false;
  let seen = new Set(), seenHand = -1, lastDecisionKey = '', lastWonKey = '';

  // ---------- layout ----------
  // display positions (percent of table box), index 0 = bottom (you), clockwise
  const POS = [[50, 109], [1, 63], [10, 5], [50, -9], [90, 5], [99, 63]];
  function resize() {
    const top = innerHeight <= 560 ? 44 : 52;
    const u = Math.max(3.2, Math.min((innerWidth - 20) / 116, (innerHeight - top - 10) / 71));
    document.documentElement.style.setProperty('--u', u + 'px');
  }
  addEventListener('resize', resize); resize();
  const lerp = (p, f) => [p[0] + (50 - p[0]) * f, p[1] + (50 - p[1]) * f];
  function dealerPos(p) {
    const vx = 50 - p[0], vy = (50 - p[1]) * 0.5; // in u-space (table is 100u x 50u)
    const len = Math.hypot(vx, vy) || 1;
    const nx = vx / len, ny = vy / len;
    const x = p[0] + nx * len * 0.27 + -ny * 7.5, y = p[1] * 0.5 + ny * len * 0.27 + nx * 7.5;
    return [x, y / 0.5];
  }

  // ---------- rendering helpers ----------
  function cardHTML(c, cls = '') {
    if (c == null) return `<div class="card back ${cls}"></div>`;
    const r = E.RANK_LABEL[c >> 2], s = c & 3, red = s === 1 || s === 2;
    const center = ['J', 'Q', 'K'].includes(r) ? `<div class="face">${r}</div>` : `<div class="pip">${SUIT[s]}</div>`;
    return `<div class="card ${red ? 'red' : ''} ${cls}"><div class="cr tl"><b>${r}</b><i>${SUIT[s]}</i></div>${center}<div class="cr br"><b>${r}</b><i>${SUIT[s]}</i></div></div>`;
  }
  const CHIP_DEN = [[25000, '#5b2a86'], [5000, '#e2701f'], [1000, '#e8c33a'], [500, '#7b3fb0'], [100, '#1b1b1b'], [25, '#1f8a4c'], [1, '#d9d9d9']];
  function chipsHTML(amount, max = 7) {
    const out = [];
    let a = amount;
    for (const [d, col] of CHIP_DEN) {
      while (a >= d && out.length < max) { out.push(col); a -= d; }
    }
    if (!out.length) out.push('#d9d9d9');
    return out.reverse().map((col, i) => `<div class="chip" style="--c:${col};bottom:calc(var(--u)*${i * 0.32})"></div>`).join('');
  }
  function avatarColor(name) {
    let h = 0;
    for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
    return `linear-gradient(145deg,hsl(${h} 55% 48%),hsl(${(h + 30) % 360} 60% 30%))`;
  }
  const BADGE = { '폴드': 'fold', '체크': 'check', '콜': 'call', '벳': 'raise', '레이즈': 'raise', '올인': 'allin', SB: 'blind', BB: 'blind' };
  function animClass(key, cls) {
    if (seen.has(key)) return '';
    seen.add(key);
    return cls;
  }

  // ---------- equity ----------
  let eqKey = '', eqHist = {}, eqRes = null, allinEq = {}, allinKey = '';
  function computeEquity() {
    const h = state.hand, ms = state.mySeat;
    const me = ms != null ? state.seats[ms] : null;
    // all-in runout: equity for every revealed hand (TV style)
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
    if (k === eqKey) return;
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
    if (board.length >= 3) return E.describe(E.evaluate([...cards, ...board]));
    const [a, b] = cards, ra = a >> 2, rb = b >> 2;
    const L = (r) => E.RANK_LABEL[r];
    if (ra === rb) return `포켓 페어 (${L(ra)}${L(rb)})`;
    const hi = Math.max(ra, rb), lo = Math.min(ra, rb);
    return `${L(hi)}-${L(lo)} ${(a & 3) === (b & 3) ? "수티드" : "오프수트"}`;
  }
  function renderEquity() {
    const body = $('#eqBody'), h = state.hand, ms = state.mySeat;
    const me = ms != null ? state.seats[ms] : null;
    if (!eqRes) {
      $('#eqOpp').textContent = '';
      let msg = '핸드가 시작되면 표시됩니다';
      if (ms == null) msg = '구경 중이에요';
      else if (me && me.folded) msg = '이번 핸드는 폴드했어요';
      else if (h && h.stage && me && !me.inHand) msg = '다음 핸드부터 참여합니다';
      body.innerHTML = `<div class="eqidle">${msg}</div>`;
      return;
    }
    const r = eqRes;
    $('#eqOpp').textContent = r.known ? '공개된 패 기준' : `상대 ${r.opps}명`;
    const order = ['preflop', 'flop', 'turn', 'river'];
    let prev = null;
    const hist = order.map((s) => {
      const v = eqHist[s];
      if (v == null) return `<div><em>${STAGE_KO[s]}</em><b>–</b></div>`;
      let arrow = '';
      if (prev != null) { const d = v - prev; if (Math.abs(d) >= 0.005) arrow = `<span class="${d > 0 ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'}</span>`; }
      prev = v;
      return `<div class="${s === r.stage ? 'cur' : ''}"><em>${STAGE_KO[s]}</em><b>${(v * 100).toFixed(0)}%</b>${arrow}</div>`;
    }).join('');
    const pct = (r.share * 100).toFixed(1);
    const col = r.share >= 0.5 ? '#7ef0a8' : r.share >= 0.25 ? '#f3d27a' : '#ff9a9a';
    body.innerHTML = `
      <div class="eqbig"><b style="color:${col}">${pct}%</b><span>승 ${(r.win * 100).toFixed(1)}% · 무 ${(r.tie * 100).toFixed(1)}%</span></div>
      <div class="eqbar"><i class="w" style="width:${r.win * 100}%"></i><i class="t" style="width:${r.tie * 100}%"></i></div>
      <div class="eqhand">${handLabel(me.cards, h.board)}<small>${r.known ? '모든 패가 공개되어 정확히 계산했어요' : '상대 패를 모른다고 가정한 시뮬레이션 결과예요'}</small></div>
      <div class="eqhist">${hist}</div>`;
  }

  // ---------- main render ----------
  function render() {
    const s = state, h = s.hand || {}, ms = s.mySeat;
    if (seenHand !== s.handNo) { seen = new Set(); }
    computeEquity();
    seenHand = s.handNo;

    $('#roomName').textContent = s.room;
    $('#blinds').textContent = `${money(s.cfg.sb)} / ${money(s.cfg.bb)}`;
    $('#handNo').textContent = s.handNo ? '#' + s.handNo : '-';
    const me = ms != null ? s.seats[ms] : null;
    const seated = s.seats.filter((p) => p).length;
    $('#startBtn').classList.toggle('hide', !me || s.running || seated < 2);
    $('#rebuyBtn').classList.toggle('hide', !me || me.chips > 0 || (me.inHand && h.stage !== 'showdown' && h.stage !== 'done'));
    $('#sitBtn').classList.toggle('hide', !me);
    $('#sitBtn').textContent = me && me.sittingOut ? '자리로 돌아가기' : '자리 비우기';
    $('#leaveBtn').classList.toggle('hide', !me);
    $('#overlay').classList.toggle('hide', !!me || watching);

    // board
    const board = h.board || [];
    const winCards = new Set();
    let boardHTML = '';
    for (let i = 0; i < 5; i++) {
      boardHTML += board[i] != null ? cardHTML(board[i], animClass(`b${i}-${board[i]}`, 'flip')) : '<div class="slot"></div>';
    }
    $('#board').innerHTML = boardHTML;

    // pot
    const potShown = h.potCenter || 0;
    $('#pot').innerHTML = `팟 <span>${money(h.pot || 0)}</span>`;
    $('#pot').classList.toggle('hide', !h.pot);
    $('#potChips').innerHTML = potShown ? chipsHTML(potShown, 9) : '';
    $('#potChips').classList.toggle('hide', !potShown);

    // seats
    const won = (h.results && h.results.won) || {};
    let html = '';
    for (let d = 0; d < 6; d++) {
      const si = ms != null ? (ms + d) % 6 : d;
      const p = s.seats[si];
      const pos = POS[d];
      const style = `left:${pos[0]}%;top:${pos[1]}%`;
      if (!p) {
        html += ms == null
          ? `<div class="seat" style="${style}"><button class="empty" data-sit="${si}">앉기</button></div>`
          : `<div class="seat" style="${style}"><div class="empty">빈 자리</div></div>`;
        continue;
      }
      const isMe = si === ms;
      const turn = h.toAct === si;
      const cls = ['seat', isMe ? 'me' : '', turn ? 'turn' : '', p.folded ? 'folded' : '', (!p.inHand && h.stage) || p.sittingOut ? 'out' : '', won[si] && !(h.results.pots.every((x) => x.single) && h.stage === 'showdown') ? 'winner' : ''].join(' ');
      let hole = '';
      if (p.hasCards || (p.inHand && isMe && p.cards)) {
        if (p.cards) {
          const size = isMe ? 'lg' : 'sm';
          hole = `<div class="hole ${isMe ? '' : 'rev'}">${p.cards.map((c, k) => cardHTML(c, `${size} ${p.folded ? 'dim' : ''} ${animClass(`h${si}-${k}-${c}`, isMe ? 'deal' : 'flip')}`)).join('')}</div>`;
        } else {
          hole = `<div class="hole">${[0, 1].map((k) => cardHTML(null, `sm ${animClass(`h${si}-${k}-x`, 'deal')}`)).join('')}</div>`;
        }
      } else if (isMe && p.folded && p.cards) {
        hole = `<div class="hole">${p.cards.map((c) => cardHTML(c, 'lg dim')).join('')}</div>`;
      } else hole = `<div class="hole"></div>`;

      // badge
      let badge = '';
      const showHand = (h.stage === 'showdown') && p.cards && !p.folded && board.length >= 3;
      if (showHand) badge = `<div class="badge hand">${esc(E.describe(E.evaluate([...p.cards, ...board])).replace(/ \(.*\)/, ''))}</div>`;
      else if (p.sittingOut && !p.inHand) badge = `<div class="badge fold">자리 비움</div>`;
      else if (p.lastAction) badge = `<div class="badge ${BADGE[p.lastAction] || ''}">${esc(p.lastAction)}</div>`;

      const eqTag = allinEq[si] != null && h.stage !== 'showdown' ? `<div class="eqtag">${(allinEq[si] * 100).toFixed(0)}%</div>` : '';
      const ringR = 15.5, circ = 2 * Math.PI * ringR;
      const ring = turn ? `<svg viewBox="0 0 36 36"><circle class="trk" cx="18" cy="18" r="${ringR}"/><circle class="tmr" id="ring" cx="18" cy="18" r="${ringR}" stroke-dasharray="${circ}" stroke-dashoffset="0"/></svg>` : '';
      const wk = `${s.handNo}-${si}`;
      const wonFloat = won[si] ? `<div class="wonfloat" ${lastWonKey.includes('|' + wk) ? 'style="animation:none"' : ''}>+${money(won[si])}</div>` : '';
      const sub = !p.connected ? '<div class="sub offline">연결 끊김</div>' : p.allIn ? '<div class="sub" style="color:#ff8a8a">ALL-IN</div>' : '';
      html += `<div class="${cls}" style="${style}">
        ${hole}
        <div class="plate">
          <div class="avatar" style="background:${avatarColor(p.name)}">${ring}${esc([...p.name][0].toUpperCase())}</div>
          <div class="info"><div class="nm">${esc(p.name)}${isMe ? ' (나)' : ''}</div><div class="stk">${money(p.chips)}</div>${sub}</div>
          ${eqTag}
        </div>
        ${wonFloat}
        ${badge}
      </div>`;
      if (p.bet > 0) {
        const bp = lerp(pos, d === 0 ? 0.44 : d === 3 ? 0.44 : 0.36);
        html += `<div class="betspot" style="left:${bp[0]}%;top:${bp[1]}%"><div class="chipstack">${chipsHTML(p.bet)}</div><div class="betamt">${money(p.bet)}</div></div>`;
      }
      if (h.button === si) {
        const dp = dealerPos(pos);
        html += `<div class="dealer" style="left:${dp[0]}%;top:${dp[1]}%">D</div>`;
      }
    }
    $('#layer').innerHTML = html;
    Object.keys(won).forEach((k) => { lastWonKey += '|' + `${s.handNo}-${k}`; });
    if (lastWonKey.length > 2000) lastWonKey = lastWonKey.slice(-500);

    // center message
    let msg = '';
    if (!s.handNo || !h.stage) {
      if (seated < 2) msg = '친구를 기다리는 중… <small>상단의 "초대 링크 복사"로 친구를 불러주세요</small>';
      else if (!s.running) msg = '준비 완료 <small>"게임 시작"을 누르면 딜이 시작됩니다</small>';
      else msg = '다음 핸드를 준비하는 중… <small>칩이 있는 플레이어가 2명 이상 필요해요</small>';
    } else if (h.results) {
      const parts = h.results.pots.filter((p) => !p.single || h.results.pots.length === 1).map((p) => {
        const names = p.winners.map((w) => esc(s.seats[w] ? s.seats[w].name : '?')).join(', ');
        return `<span class="win">${names}</span> ${p.hand ? '· ' + esc(p.hand) + ' ' : ''}· ${money(p.amount)}`;
      });
      msg = parts.join('<br>') + `<small id="nextIn"></small>`;
    } else if (h.revealAll) msg = '올인! 남은 카드를 공개합니다';
    else if (h.toAct >= 0 && s.seats[h.toAct]) msg = h.toAct === ms ? '당신 차례입니다' : `${esc(s.seats[h.toAct].name)} 님 생각 중…`;
    $('#tmsg').innerHTML = msg;

    renderActions();
    renderEquity();
    renderLog();
    document.title = s.actions ? '🔔 당신 차례! · Home Game' : 'Home Game · 텍사스 홀덤';
  }

  // ---------- actions ----------
  let raiseVal = 0;
  function presetValue(p) {
    const a = state.actions, h = state.hand;
    const potAfterCall = h.pot + a.toCall;
    const map = { min: a.minTo, half: a.currentBet + potAfterCall * 0.5, '3q': a.currentBet + potAfterCall * 0.75, pot: a.currentBet + potAfterCall, allin: a.maxTo };
    return clampRaise(map[p]);
  }
  function clampRaise(v) {
    const a = state.actions;
    v = Math.round(v / 50) * 50;
    return Math.max(a.minTo, Math.min(a.maxTo, v || a.minTo));
  }
  function renderActions() {
    const a = state.actions, box = $('#act');
    const ms = state.mySeat, me = ms != null ? state.seats[ms] : null;
    box.classList.toggle('myturn', !!a);
    box.classList.toggle('waiting', !a);
    ['#foldBtn', '#callBtn', '#raiseBtn'].forEach((id) => { $(id).disabled = !a; });
    if (!a) {
      $('#raiseBox').classList.add('hide');
      $('#callBtn').innerHTML = '체크<kbd>C</kbd>';
      $('#raiseBtn').innerHTML = '레이즈<kbd>R</kbd>';
      const h = state.hand || {};
      $('#actNote').innerHTML = !me ? '테이블에 앉으면 플레이할 수 있어요' : (h.toAct >= 0 && state.seats[h.toAct] ? `${esc(state.seats[h.toAct].name)} 님 차례` : '');
      return;
    }
    const key = state.handNo + '|' + state.hand.stage + '|' + a.currentBet + '|' + a.myBet;
    if (key !== lastDecisionKey) { lastDecisionKey = key; raiseVal = a.minTo; }
    raiseVal = clampRaise(raiseVal);
    $('#callBtn').innerHTML = (a.canCheck ? '체크' : a.toCall >= me.chips ? `올인 ${money(a.toCall)}` : `콜 ${money(a.toCall)}`) + '<kbd>C</kbd>';
    const showRaise = a.canRaise && a.maxTo > a.currentBet && !(a.toCall >= me.chips);
    $('#raiseBox').classList.toggle('hide', !showRaise);
    $('#raiseBtn').disabled = !showRaise;
    const sl = $('#slider');
    sl.min = a.minTo; sl.max = a.maxTo; sl.step = 50; sl.value = raiseVal;
    if (document.activeElement !== $('#ramt')) $('#ramt').value = raiseVal;
    updateRaiseLabel();
  }
  function updateRaiseLabel() {
    const a = state.actions;
    if (!a) return;
    const word = raiseVal >= a.maxTo ? '올인' : a.currentBet === 0 ? '벳' : '레이즈';
    $('#raiseBtn').innerHTML = `${word} ${money(raiseVal)}<kbd>R</kbd>`;
  }
  $('#slider').addEventListener('input', (e) => { raiseVal = clampRaise(+e.target.value); $('#ramt').value = raiseVal; updateRaiseLabel(); });
  $('#ramt').addEventListener('input', (e) => { const v = +e.target.value; if (state.actions && v) { raiseVal = Math.max(state.actions.minTo, Math.min(state.actions.maxTo, v)); $('#slider').value = raiseVal; updateRaiseLabel(); } });
  $('#ramt').addEventListener('blur', () => { if (state.actions) { raiseVal = clampRaise(raiseVal); $('#ramt').value = raiseVal; } });
  document.querySelectorAll('.presets button').forEach((b) => b.addEventListener('click', () => {
    if (!state.actions) return;
    raiseVal = presetValue(b.dataset.p); $('#slider').value = raiseVal; $('#ramt').value = raiseVal; updateRaiseLabel();
  }));
  function doFold() {
    const a = state.actions;
    if (!a) return;
    if (a.canCheck && !confirmFold) { confirmFold = true; toast('체크가 가능해요. 그래도 폴드하려면 한 번 더 누르세요', true); setTimeout(() => { confirmFold = false; }, 2500); return; }
    confirmFold = false;
    api('action', { action: 'fold' });
  }
  let confirmFold = false;
  const doCall = () => state.actions && api('action', { action: state.actions.canCheck ? 'check' : 'call' });
  const doRaise = () => { const a = state.actions; if (!a || !a.canRaise) return; api('action', raiseVal >= a.maxTo ? { action: 'allin' } : { action: 'raise', amount: raiseVal }); };
  $('#foldBtn').onclick = doFold; $('#callBtn').onclick = doCall; $('#raiseBtn').onclick = doRaise;
  addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || !state || !state.actions) return;
    const k = e.key.toLowerCase();
    if (k === 'f') doFold(); else if (k === 'c') doCall(); else if (k === 'r') doRaise();
  });

  // ---------- log ----------
  function renderLog() {
    const ul = $('#log');
    const atBottom = ul.scrollTop + ul.clientHeight >= ul.scrollHeight - 10;
    ul.innerHTML = state.log.map((l) => `<li class="${l.msg.startsWith('──') ? 'sep' : ''}">${esc(l.msg)}</li>`).join('');
    if (atBottom) ul.scrollTop = ul.scrollHeight;
  }
  $('#logHead').onclick = () => { const c = $('#logp').classList.toggle('collapsed'); $('#logToggle').textContent = c ? '펼치기 ▾' : '접기 ▴'; $('#log').scrollTop = 1e9; };

  // ---------- timers (turn ring + next hand countdown) ----------
  function tick() {
    if (state) {
      const now = Date.now() + clockOffset, h = state.hand || {};
      const ring = document.getElementById('ring');
      if (ring && h.deadline) {
        const left = Math.max(0, h.deadline - now), frac = left / state.cfg.turnMs;
        const circ = +ring.getAttribute('stroke-dasharray');
        ring.setAttribute('stroke-dashoffset', String(circ * (1 - frac)));
        ring.style.stroke = frac < 0.25 ? '#ff5a5a' : frac < 0.5 ? '#f3a33a' : '#f3c45a';
        if (state.actions) {
          const sec = Math.ceil(left / 1000);
          $('#actNote').innerHTML = `남은 시간 <b>${sec}초</b> · 시간이 지나면 자동 ${state.actions.canCheck ? '체크' : '폴드'}`;
        }
      }
      const ni = document.getElementById('nextIn');
      if (ni && state.nextAt) ni.textContent = `다음 핸드 ${Math.max(0, Math.ceil((state.nextAt - now) / 1000))}초 후`;
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // ---------- network ----------
  function connect() {
    if (es) es.close();
    es = new EventSource(`/events?room=${encodeURIComponent(roomId)}&token=${encodeURIComponent(token)}`);
    es.onopen = () => $('#conn').classList.remove('off');
    es.onerror = () => $('#conn').classList.add('off');
    es.onmessage = (e) => {
      state = JSON.parse(e.data);
      clockOffset = state.now - Date.now();
      if (token && state.mySeat == null && !watching && !autoJoinTried) autoRejoin();
      render();
    };
  }
  let autoJoinTried = false;
  async function autoRejoin() {
    // token unknown to server (e.g. server restarted): rejoin with saved name
    autoJoinTried = true;
    const name = localStorage.getItem('pk_name');
    if (!name) return;
    const r = await api('join', { name }, true);
    if (r && r.token) { token = r.token; localStorage.setItem(tokKey(), token); connect(); }
  }
  async function api(path, body = {}, quiet) {
    try {
      const res = await fetch('/api/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ room: roomId, token, ...body }) });
      const j = await res.json();
      if (j.error && !quiet) toast(j.error);
      return j;
    } catch (e) { if (!quiet) toast('서버에 연결할 수 없어요'); return {}; }
  }
  let toastT;
  function toast(msg, ok) {
    const t = $('#toast');
    t.textContent = msg; t.className = 'toast show' + (ok ? ' ok' : '');
    clearTimeout(toastT); toastT = setTimeout(() => { t.className = 'toast' + (ok ? ' ok' : ''); }, 2600);
  }

  // ---------- lobby ----------
  $('#nameIn').value = localStorage.getItem('pk_name') || '';
  $('#roomIn').value = roomId === 'main' ? '' : roomId;
  $('#joinForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#nameIn').value.trim();
    const room = ($('#roomIn').value.trim() || 'main').replace(/[^\w-]/g, '').slice(0, 20) || 'main';
    if (!name) return;
    localStorage.setItem('pk_name', name);
    if (room !== roomId) {
      roomId = room; token = localStorage.getItem(tokKey()) || '';
      history.replaceState(null, '', roomId === 'main' ? '/' : '/?room=' + roomId);
    }
    const r = await api('join', { name, seat: wantSeat });
    wantSeat = null;
    if (r.token) { token = r.token; localStorage.setItem(tokKey(), token); watching = false; autoJoinTried = true; connect(); }
  });
  $('#watchBtn').onclick = () => { watching = true; $('#overlay').classList.add('hide'); };
  $('#layer').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sit]');
    if (!b) return;
    wantSeat = +b.dataset.sit; watching = false;
    $('#overlay').classList.remove('hide'); $('#nameIn').focus();
  });
  $('#inviteBtn').onclick = async () => {
    const link = location.origin + (roomId === 'main' ? '/' : '/?room=' + roomId);
    try { await navigator.clipboard.writeText(link); toast('초대 링크를 복사했어요: ' + link, true); }
    catch { prompt('이 링크를 친구에게 보내세요', link); }
  };
  $('#startBtn').onclick = () => api('start');
  $('#sitBtn').onclick = () => api('sitout');
  $('#rebuyBtn').onclick = () => api('rebuy');
  $('#leaveBtn').onclick = async () => {
    if (!confirm('테이블에서 나갈까요? 칩은 초기화됩니다.')) return;
    await api('leave');
    localStorage.removeItem(tokKey()); token = ''; watching = false; autoJoinTried = true; connect();
  };

  // keep free hosting (e.g. Render) awake while someone has the page open
  setInterval(() => { fetch('/ping').catch(() => {}); }, 4 * 60 * 1000);

  connect();
})();
