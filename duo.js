/* ============================================================
   Sudoku — duello a due (1 contro 1)
   Stesso puzzle, due griglie separate: vince chi finisce primo.
   Il motore di gioco resta quello del single player; qui c'è solo il
   coordinamento tra i due giocatori.
   ============================================================ */

(function () {
  'use strict';

  const S = window.Sudoku;
  const Net = window.SudokuNet;
  if (!S || !Net) return; // senza motore o rete non c'è nulla da coordinare

  const PROTO = Net.PROTO;
  const HEARTBEAT_MS = 2000;   // ogni quanto diciamo "sono qui"
  const SILENCE_WARN_MS = 6000;  // oltre questo l'avversario è "in dubbio"
  const SILENCE_LOST_MS = 20000; // oltre questo chiediamo cosa fare
  const COUNTDOWN_FROM = 3;
  const SETTLE_WAIT_MS = 1500;   // attesa per un arrivo quasi in contemporanea

  /* ---------- Stato del duello ---------- */

  const duo = {
    transport: null,
    role: null,            // 'host' | 'guest'
    useLocal: false,       // trasporto a due schede invece di WebRTC
    name: 'AAA',
    opponent: '???',
    difficulty: 'medio',
    seed: 0,
    phase: 'idle',         // idle | connecting | preparing | countdown | playing | finished
    iAmReady: false,
    theyReady: false,
    mine: null,            // {won, seconds, errors, hints}
    theirs: null,
    theirProgress: null,   // ultimo `progress` ricevuto, per l'ombra e i contatori
    theirArrivedFirst: false,
    settleId: null,
    countId: null,
    hbId: null,
    progId: null,
    watchId: null,
    ageId: null,          // aggiorna l'età dell'invito mostrata all'host
    inviteAt: 0,
    lastSeen: 0,
    lostAsked: false,
    rematchMine: false,
    rematchTheirs: false,
  };

  /* ---------- Elementi ---------- */

  const $ = (id) => document.getElementById(id);

  const el = {
    open: $('duo'),
    overlay: $('duo-overlay'),
    steps: {
      menu: $('duo-step-menu'),
      host: $('duo-step-host'),
      guest: $('duo-step-guest'),
      code: $('duo-step-code'),
    },
    name: $('duo-name'),
    difficulty: $('duo-difficulty'),
    create: $('duo-create'),
    join: $('duo-join'),
    challenge: $('duo-challenge'),
    localToggle: $('duo-local'),
    localNote: $('duo-local-note'),
    close: $('duo-close'),

    invite: $('duo-invite'),
    inviteCopy: $('duo-invite-copy'),
    inviteShare: $('duo-invite-share'),
    inviteAge: $('duo-invite-age'),
    inviteNew: $('duo-invite-new'),
    answerIn: $('duo-answer-in'),
    answerOk: $('duo-answer-ok'),
    hostStatus: $('duo-host-status'),
    hostBack: $('duo-host-back'),
    long: $('duo-long'),
    longG: $('duo-long-g'),

    inviteIn: $('duo-invite-in'),
    joinGo: $('duo-join-go'),
    answerOut: $('duo-answer-out'),
    answerCopy: $('duo-answer-copy'),
    answerShare: $('duo-answer-share'),
    guestStatus: $('duo-guest-status'),
    guestBack: $('duo-guest-back'),

    codeIn: $('duo-code-in'),
    codeGo: $('duo-code-go'),
    codeCurrent: $('duo-code-current'),
    codeCopy: $('duo-code-copy'),
    codeBack: $('duo-code-back'),

    countOverlay: $('duo-count'),
    countNum: $('duo-count-n'),

    hud: $('duo-hud'),
    oppName: $('duo-opp-name'),
    oppTime: $('duo-opp-time'),
    oppFilled: $('duo-opp-filled'),
    oppErrors: $('duo-opp-errors'),
    oppHints: $('duo-opp-hints'),
    shadow: $('duo-shadow'),
    link: $('duo-link'),
    leave: $('duo-leave'),

    resultOverlay: $('duo-result'),
    resultIcon: $('duo-result-icon'),
    resultTitle: $('duo-result-title'),
    resultMsg: $('duo-result-msg'),
    resultMine: $('duo-result-mine'),
    resultTheirs: $('duo-result-theirs'),
    rematch: $('duo-rematch'),
    resultClose: $('duo-result-close'),
  };

  if (!el.open || !el.overlay) return; // pagina senza la UI del multiplayer

  let slots = null;

  /* ---------- Utilità ---------- */

  function showStep(name) {
    for (const [key, node] of Object.entries(el.steps)) {
      if (node) node.hidden = key !== name;
    }
  }

  function openLobby() {
    if (!slots) {
      slots = S.createSlots(el.name);
      slots.onEnter = () => createMatch();
    }
    slots.setValue(S.loadLastName());
    el.difficulty.value = S.getState().difficulty;
    el.answerIn.value = '';
    el.inviteIn.value = '';
    el.codeIn.value = '';
    setStatus(el.hostStatus, '');
    setStatus(el.guestStatus, '');
    refreshCurrentCode();
    showStep('menu');
    el.overlay.hidden = false;
  }

  function closeLobby() {
    el.overlay.hidden = true;
  }

  function setStatus(node, text, kind) {
    if (!node) return;
    node.textContent = text || '';
    node.className = 'duo__status' + (kind ? ` duo__status--${kind}` : '');
  }

  // navigator.clipboard non è disponibile in contesti non sicuri (file://):
  // in quel caso si ripiega sulla selezione più execCommand.
  async function copyText(text, node) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        S.showToast('Copiato');
        return;
      }
    } catch { /* si prova con il metodo vecchio */ }
    if (node && node.select) {
      node.select();
      try {
        if (document.execCommand('copy')) { S.showToast('Copiato'); return; }
      } catch { /* niente da fare */ }
    }
    S.showToast('Copia manualmente il codice selezionato');
  }

  async function shareText(text, label) {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Sudoku — duello', text });
        return;
      } catch { /* condivisione annullata: si ripiega sulla copia */ }
    }
    await copyText(text, label);
  }

  const inviteLink = (code) => location.href.split('#')[0] + '#j=' + code;

  /* ---------- Codici: scrittura compatta o lunga ---------- */

  // Compatto e lungo sono due scritture dello stesso SDP, quindi la casella può
  // essere spuntata anche *dopo* aver generato il codice: si ricodifica e basta,
  // senza rifare la connessione. (Prima non era così e la casella non faceva
  // nulla se spuntata a codice già generato.)
  function renderInvite() {
    if (!duo.transport || !duo.transport.describe) return;
    const code = duo.transport.describe(el.long.checked);
    if (code) el.invite.value = inviteLink(code);
  }

  function renderAnswer() {
    if (!duo.transport || !duo.transport.describe) return;
    const code = duo.transport.describe(el.longG.checked);
    if (code) el.answerOut.value = code;
  }

  // Senza un indirizzo raggiungibile da fuori il codice vale solo dentro la
  // stessa rete: meglio dirlo prima di mandarlo, invece di lasciare che il
  // collegamento fallisca senza spiegazioni.
  function localOnlyWarning() {
    const s = duo.transport && duo.transport.summary && duo.transport.summary();
    if (!s || s.routable > 0) return null;
    return 'Non ho trovato un indirizzo pubblico: questo codice funzionerà solo se '
      + 'siete sulla stessa rete Wi-Fi. Su reti diverse usate «Sfida con un codice».';
  }

  /* ---------- Freschezza dell'invito ---------- */

  // Il varco che il router apre verso l'esterno si chiude dopo poco se non passa
  // traffico: un invito mandato e aperto qualche minuto dopo può non collegarsi
  // più. Non possiamo tenerlo aperto, ma possiamo dire quanti secondi ha.
  function startInviteAge() {
    stopInviteAge();
    duo.inviteAt = Date.now();
    renderInviteAge();
    duo.ageId = setInterval(renderInviteAge, 1000);
  }

  function stopInviteAge() {
    clearInterval(duo.ageId);
    duo.ageId = null;
  }

  function renderInviteAge() {
    if (!el.inviteAge) return;
    const sec = Math.floor((Date.now() - duo.inviteAt) / 1000);
    if (sec < 60) {
      el.inviteAge.textContent = `Invito appena creato (${sec}s) — è il momento buono.`;
      el.inviteAge.className = 'duo__age duo__age--fresh';
    } else {
      const min = Math.floor(sec / 60);
      el.inviteAge.textContent = `Invito creato ${min} ${min === 1 ? 'minuto' : 'minuti'} fa: `
        + 'se non si collega, generane uno nuovo.';
      el.inviteAge.className = 'duo__age duo__age--stale';
    }
  }

  /* ---------- Collegamento ---------- */

  function attach(transport) {
    duo.transport = transport;
    transport.onMessage(onMessage);
    transport.onStateChange(onTransportState);
  }

  function onTransportState(st) {
    if (st === 'open') {
      duo.lastSeen = Date.now();
      stopInviteAge(); // collegati: l'età dell'invito non conta più
      startHeartbeat();
      if (duo.role === 'guest') {
        send({ t: 'hello', proto: PROTO, name: duo.name });
        setStatus(el.guestStatus, 'Collegato, in attesa del puzzle…', 'ok');
      } else {
        setStatus(el.hostStatus, 'Collegato, in attesa dell’avversario…', 'ok');
      }
      updateLink('ok');
    } else if (st === 'failed') {
      const msg = 'Collegamento non riuscito. Provate sulla stessa rete Wi-Fi, '
        + 'oppure usate la sfida con codice.';
      setStatus(duo.role === 'host' ? el.hostStatus : el.guestStatus, msg, 'bad');
      updateLink('bad');
    } else if (st === 'closed') {
      updateLink('bad');
    }
  }

  function send(msg) {
    if (duo.transport) duo.transport.send(msg);
  }

  async function createMatch() {
    duo.role = 'host';
    duo.name = slots.getValue();
    S.saveLastName(duo.name);
    duo.difficulty = el.difficulty.value;
    duo.phase = 'connecting';

    if (duo.useLocal) {
      attach(Net.LocalTransport('local'));
      showStep('host');
      el.invite.value = '(prova su due schede: apri questa pagina in un’altra '
        + 'scheda e premi «Unisciti»)';
      el.answerIn.parentElement.hidden = true;
      setStatus(el.hostStatus, 'In attesa dell’altra scheda…');
      return;
    }

    if (!Net.supported) {
      setStatus(el.hostStatus, 'Questo browser non supporta WebRTC.', 'bad');
      showStep('host');
      return;
    }

    showStep('host');
    el.answerIn.parentElement.hidden = false;
    el.invite.value = '';
    el.inviteAge.textContent = '';
    setStatus(el.hostStatus, 'Cerco un percorso di rete…');
    try {
      const transport = Net.RTCTransport();
      attach(transport);
      await transport.createInvite((type) => {
        if (type === 'srflx' || type === 'relay') {
          setStatus(el.hostStatus, 'Indirizzo pubblico trovato, preparo l’invito…');
        }
      });
      renderInvite();
      startInviteAge();
      const warn = localOnlyWarning();
      setStatus(el.hostStatus, warn || 'Manda il link all’avversario, poi incolla qui il '
        + 'codice di risposta che ti rimanda.', warn ? 'bad' : null);
    } catch (err) {
      setStatus(el.hostStatus, 'Non riesco a preparare l’invito: ' + err.message, 'bad');
    }
  }

  async function regenerateInvite() {
    stopInviteAge();
    if (duo.transport) { duo.transport.close(); duo.transport = null; }
    el.answerIn.value = '';
    await createMatch();
  }

  async function acceptAnswer() {
    const code = el.answerIn.value.trim();
    if (!code) {
      setStatus(el.hostStatus, 'Incolla il codice di risposta dell’avversario.', 'bad');
      return;
    }
    setStatus(el.hostStatus, 'Collego…');
    try {
      await duo.transport.acceptAnswer(code);
    } catch (err) {
      setStatus(el.hostStatus, 'Codice di risposta non valido: ' + err.message, 'bad');
    }
  }

  async function joinMatch(prefilled) {
    duo.role = 'guest';
    duo.name = slots ? slots.getValue() : S.loadLastName();
    S.saveLastName(duo.name);
    duo.phase = 'connecting';

    if (duo.useLocal) {
      attach(Net.LocalTransport('local'));
      showStep('guest');
      el.inviteIn.parentElement.hidden = true;
      el.answerOut.parentElement.hidden = true;
      setStatus(el.guestStatus, 'Mi collego all’altra scheda…');
      return;
    }

    showStep('guest');
    el.inviteIn.parentElement.hidden = false;
    el.answerOut.parentElement.hidden = false;
    if (prefilled) el.inviteIn.value = prefilled;
    el.answerOut.value = '';
    setStatus(el.guestStatus, prefilled
      ? 'Invito ricevuto: premi «Genera risposta».'
      : 'Incolla il link o il codice che ti ha mandato l’avversario.');
  }

  async function generateAnswer() {
    const raw = el.inviteIn.value.trim();
    if (!raw) {
      setStatus(el.guestStatus, 'Incolla prima il link o il codice dell’invito.', 'bad');
      return;
    }
    const code = raw.includes('#j=') ? raw.split('#j=')[1].trim() : raw;
    setStatus(el.guestStatus, 'Cerco un percorso di rete…');
    try {
      const transport = Net.RTCTransport();
      attach(transport);
      await transport.joinWithInvite(code, (type) => {
        if (type === 'srflx' || type === 'relay') {
          setStatus(el.guestStatus, 'Indirizzo pubblico trovato, preparo la risposta…');
        }
      });
      renderAnswer();
      const warn = localOnlyWarning();
      setStatus(el.guestStatus, warn || 'Rimanda subito questo codice all’avversario '
        + 'e aspetta il via.', warn ? 'bad' : null);
    } catch (err) {
      setStatus(el.guestStatus, 'Invito non valido: ' + err.message, 'bad');
    }
  }

  /* ---------- Protocollo ---------- */

  function onMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    duo.lastSeen = Date.now();

    switch (msg.t) {
      case 'ping': send({ t: 'pong' }); return;
      case 'pong': return;

      case 'hello': {
        if (duo.role !== 'host') return;
        if (msg.proto !== PROTO) {
          setStatus(el.hostStatus, 'L’avversario ha una versione diversa del gioco: '
            + 'aggiornate entrambi la pagina.', 'bad');
          return;
        }
        duo.opponent = msg.name || '???';
        beginMatch(S.randomSeed());
        return;
      }

      case 'welcome': {
        if (duo.role !== 'guest') return;
        if (msg.proto !== PROTO) {
          setStatus(el.guestStatus, 'L’avversario ha una versione diversa del gioco: '
            + 'aggiornate entrambi la pagina.', 'bad');
          return;
        }
        duo.opponent = msg.name || '???';
        duo.difficulty = msg.difficulty;
        prepareRound(msg.difficulty, msg.seed);
        return;
      }

      case 'ready': {
        duo.theyReady = true;
        maybeStart();
        return;
      }

      case 'start': {
        if (duo.role === 'guest') runCountdown();
        return;
      }

      case 'progress': {
        duo.theirProgress = msg;
        renderOpponent();
        return;
      }

      case 'finished': {
        duo.theirs = { won: !!msg.won, seconds: msg.seconds, errors: msg.errors, hints: msg.hints };
        if (duo.role === 'host') {
          if (!duo.mine) duo.theirArrivedFirst = true;
          settle();
        }
        return;
      }

      case 'result': {
        if (duo.role !== 'guest') return;
        applyResult(msg, 'guest');
        return;
      }

      case 'rematch': {
        duo.rematchTheirs = true;
        S.showToast(`${duo.opponent} vuole la rivincita`);
        updateRematchButton();
        if (duo.role === 'host') maybeRematch(); // solo l'host sceglie il puzzle
        return;
      }

      case 'bye': {
        S.showToast(`${duo.opponent} ha lasciato il duello`);
        updateLink('bad');
        return;
      }

      default: return; // tipo sconosciuto: le versioni future possono aggiungerne
    }
  }

  /* ---------- Svolgimento della partita ---------- */

  // Host: sceglie il puzzle e lo annuncia
  function beginMatch(seed) {
    duo.rematchMine = false;
    duo.rematchTheirs = false;
    send({
      t: 'welcome',
      proto: PROTO,
      name: duo.name,
      mode: 'duel',
      difficulty: duo.difficulty,
      seed,
    });
    prepareRound(duo.difficulty, seed);
  }

  // Entrambi: generano lo stesso puzzle dal seed e annunciano di essere pronti
  function prepareRound(difficulty, seed) {
    duo.seed = seed;
    duo.difficulty = difficulty;
    duo.phase = 'preparing';
    duo.iAmReady = false;
    duo.theyReady = false;
    duo.mine = null;
    duo.theirs = null;
    duo.theirProgress = null;
    duo.theirArrivedFirst = false;
    duo.lostAsked = false;
    clearTimeout(duo.settleId);

    closeLobby();
    el.resultOverlay.hidden = true;
    showHud(true);
    renderOpponent();

    S.startGame({
      difficulty,
      seed,
      mode: 'duel',
      autostart: false,
      onReady: () => {
        duo.iAmReady = true;
        send({ t: 'ready' });
        maybeStart();
      },
    });
  }

  function maybeStart() {
    if (duo.phase !== 'preparing' || !duo.iAmReady || !duo.theyReady) return;
    if (duo.role === 'host') send({ t: 'start' });
    runCountdown();
  }

  function runCountdown() {
    if (duo.phase === 'countdown' || duo.phase === 'playing') return;
    duo.phase = 'countdown';
    let n = COUNTDOWN_FROM;
    el.countNum.textContent = n;
    el.countOverlay.hidden = false;
    clearInterval(duo.countId);
    duo.countId = setInterval(() => {
      n--;
      if (n > 0) {
        el.countNum.textContent = n;
        return;
      }
      clearInterval(duo.countId);
      el.countNum.textContent = 'VIA!';
      setTimeout(() => {
        el.countOverlay.hidden = true;
        beginPlaying();
      }, 450);
    }, 700);
  }

  function beginPlaying() {
    duo.phase = 'playing';
    S.beginPrepared();
    startProgress();
  }

  function startProgress() {
    clearInterval(duo.progId);
    duo.progId = setInterval(() => {
      if (duo.phase !== 'playing') return;
      const p = S.getProgress();
      send({
        t: 'progress',
        filled: p.filled,
        errors: p.errors,
        hints: p.hints,
        elapsed: p.elapsed,
        cells: p.cells.join(''),
      });
    }, 1000);
  }

  /* ---------- Esito ---------- */

  S.on('complete', (res) => {
    if (S.getState().mode !== 'duel' || duo.phase === 'finished') return;
    duo.mine = res;
    send({ t: 'finished', won: res.won, seconds: res.seconds, errors: res.errors, hints: res.hints });
    if (duo.role === 'host') settle();
    else setStatus(el.guestStatus, '');
  });

  // Solo l'host decide, così i due schermi non possono dire cose diverse.
  // Se conosce un solo risultato attende un attimo: due arrivi quasi in
  // contemporanea vanno confrontati sui tempi, non sull'ordine di arrivo.
  function settle() {
    if (duo.phase === 'finished') return;
    if (duo.mine && duo.theirs) return decide();
    clearTimeout(duo.settleId);
    duo.settleId = setTimeout(decide, SETTLE_WAIT_MS);
  }

  function decide() {
    if (duo.phase === 'finished') return;
    clearTimeout(duo.settleId);

    const host = duo.mine;
    const guest = duo.theirs;
    // Un risultato con won: false significa "ha esaurito i 3 errori"; un
    // risultato assente significa invece "sta ancora giocando", ed è una
    // differenza decisiva: chi è ancora in gioco batte chi è già fuori.
    const hostOut = !!host && !host.won;
    const guestOut = !!guest && !guest.won;
    let winner;

    if (host && host.won && guest && guest.won) {
      // Entrambi hanno completato: vince il tempo minore, a parità chi è
      // arrivato prima all'host
      if (host.seconds !== guest.seconds) winner = host.seconds < guest.seconds ? 'host' : 'guest';
      else winner = duo.theirArrivedFirst ? 'guest' : 'host';
    } else if (host && host.won) {
      winner = 'host';
    } else if (guest && guest.won) {
      winner = 'guest';
    } else if (hostOut && guestOut) {
      winner = 'draw'; // fuori entrambi, nessuno ha completato la griglia
    } else if (guestOut) {
      winner = 'host';
    } else if (hostOut) {
      winner = 'guest';
    } else {
      winner = 'draw';
    }

    const payload = { t: 'result', winner, host, guest };
    send(payload);
    applyResult(payload, 'host');
  }

  function applyResult(msg, myRole) {
    if (duo.phase === 'finished') return;
    duo.phase = 'finished';
    clearInterval(duo.progId);
    clearTimeout(duo.settleId);

    const iWon = msg.winner === myRole;
    const draw = msg.winner === 'draw';

    // Un risultato assente significa "stava ancora giocando": nel pannello è più
    // utile mostrare dove era arrivato che una riga vuota.
    const reported = myRole === 'host' ? msg.host : msg.guest;
    const reportedTheirs = myRole === 'host' ? msg.guest : msg.host;
    const p = S.getProgress();
    const mine = reported || { won: false, seconds: p.elapsed, errors: p.errors, hints: p.hints, partial: true };
    const theirs = reportedTheirs || (duo.theirProgress
      ? {
        won: false,
        seconds: duo.theirProgress.elapsed,
        errors: duo.theirProgress.errors,
        hints: duo.theirProgress.hints,
        partial: true,
      }
      : null);

    S.abortGame(); // chi stava ancora giocando si ferma qui
    recordOutcome(iWon, iWon && reported && reported.won ? reported.seconds : null);

    // Il motivo della sconfitta non è lo stesso: aver esaurito gli errori è
    // diverso dall'essere stati battuti sul tempo.
    const iRanOut = reported && !reported.won;
    const theyRanOut = reportedTheirs && !reportedTheirs.won;

    el.resultIcon.textContent = draw ? '🤝' : iWon ? '🏆' : '💥';
    el.resultTitle.textContent = draw ? 'Pari' : iWon ? 'Hai vinto!' : 'Hai perso';
    el.resultMsg.textContent = draw
      ? 'Nessuno dei due ha completato la griglia.'
      : iWon
        ? (theyRanOut
          ? `${duo.opponent} ha esaurito gli errori disponibili.`
          : `Hai completato il puzzle prima di ${duo.opponent}.`)
        : (iRanOut
          ? 'Hai esaurito gli errori disponibili.'
          : `${duo.opponent} ha completato il puzzle prima di te.`);

    el.resultMine.innerHTML = resultLine('Tu', mine);
    el.resultTheirs.innerHTML = resultLine(duo.opponent, theirs);

    duo.rematchMine = false;
    duo.rematchTheirs = false;
    updateRematchButton();
    el.resultOverlay.hidden = false;
  }

  // Nella prova su due schede i due giocatori condividono lo stesso localStorage:
  // la stessa partita finirebbe contata sia come vittoria sia come sconfitta, e
  // l'una sovrascriverebbe l'altra. In prova non si registra niente.
  function recordOutcome(iWon, seconds) {
    if (duo.transport && duo.transport.kind === 'local') return;
    S.recordDuel(duo.difficulty, iWon, seconds);
  }

  function resultLine(who, r) {
    if (!r) return `<span class="duo__who">${who}</span><span class="duo__val">—</span><span></span>`;
    const time = r.won
      ? S.formatTime(r.seconds)
      : `${S.formatTime(r.seconds)} · non completato`;
    return `<span class="duo__who">${who}</span>`
      + `<span class="duo__val">${time}</span>`
      + `<span class="duo__pen">❌${r.errors} 💡${r.hints}</span>`;
  }

  /* ---------- Rivincita ---------- */

  function askRematch() {
    if (duo.rematchMine) return;
    duo.rematchMine = true;
    send({ t: 'rematch' });
    updateRematchButton();
    if (duo.role === 'host') maybeRematch();
  }

  function maybeRematch() {
    if (!duo.rematchMine || !duo.rematchTheirs) return;
    beginMatch(S.randomSeed());
  }

  function updateRematchButton() {
    if (!el.rematch) return;
    const waiting = duo.rematchMine && !duo.rematchTheirs;
    el.rematch.textContent = waiting
      ? `In attesa di ${duo.opponent}…`
      : duo.rematchTheirs && !duo.rematchMine
        ? `Rivincita (${duo.opponent} è pronto)`
        : 'Rivincita';
    el.rematch.disabled = waiting;
  }

  /* ---------- Presenza dell'avversario ---------- */

  function startHeartbeat() {
    clearInterval(duo.hbId);
    duo.hbId = setInterval(() => send({ t: 'ping' }), HEARTBEAT_MS);
    clearInterval(duo.watchId);
    duo.watchId = setInterval(watchConnection, 1000);
  }

  function watchConnection() {
    if (!duo.transport || duo.phase === 'idle') return;
    const silence = Date.now() - duo.lastSeen;
    if (silence > SILENCE_LOST_MS && duo.phase === 'playing' && !duo.lostAsked) {
      duo.lostAsked = true;
      askWhatToDo();
    } else if (silence > SILENCE_WARN_MS) {
      updateLink('warn');
    } else {
      updateLink('ok');
    }
  }

  function updateLink(kind) {
    if (!el.link) return;
    const text = kind === 'ok' ? '● collegato'
      : kind === 'warn' ? '● connessione instabile…'
        : '● non collegato';
    el.link.textContent = text;
    el.link.className = 'duo__link duo__link--' + kind;
  }

  // Una rete caduta non deve costare la partita: si scegli
  function askWhatToDo() {
    clearInterval(duo.progId);
    el.resultIcon.textContent = '📡';
    el.resultTitle.textContent = 'Connessione perduta';
    el.resultMsg.textContent = `Non ricevo più nulla da ${duo.opponent} da un po’. `
      + 'Puoi prendere la vittoria a tavolino oppure finire il puzzle da solo.';
    el.resultMine.innerHTML = '';
    el.resultTheirs.innerHTML = '';
    el.rematch.textContent = 'Vinci a tavolino';
    el.rematch.disabled = false;
    el.rematch.onclick = () => {
      el.rematch.onclick = null;
      duo.phase = 'finished';
      S.abortGame();
      recordOutcome(true, null); // vittoria sì, ma il puzzle non è stato completato
      el.resultOverlay.hidden = true;
      leaveDuel(false);
      S.showToast('Duello vinto a tavolino');
    };
    el.resultClose.textContent = 'Continua da solo';
    el.resultOverlay.hidden = false;
  }

  /* ---------- Uscita ---------- */

  function leaveDuel(sayBye) {
    if (sayBye) send({ t: 'bye' });
    clearInterval(duo.hbId);
    clearInterval(duo.progId);
    clearInterval(duo.watchId);
    clearInterval(duo.countId);
    clearTimeout(duo.settleId);
    stopInviteAge();
    if (duo.transport) duo.transport.close();
    duo.transport = null;
    duo.phase = 'idle';
    duo.role = null;
    showHud(false);
    el.countOverlay.hidden = true;
    S.convertToSolo();
  }

  function showHud(on) {
    if (el.hud) el.hud.hidden = !on;
    if (on && el.shadow && el.shadow.children.length === 0) {
      for (let i = 0; i < 81; i++) {
        const cell = document.createElement('div');
        cell.className = 'shadow__cell';
        el.shadow.appendChild(cell);
      }
    }
  }

  function renderOpponent() {
    el.oppName.textContent = duo.opponent;
    const p = duo.theirProgress;
    el.oppTime.textContent = p ? S.formatTime(p.elapsed) : '—';
    el.oppFilled.textContent = p ? `${p.filled}/81` : '—';
    el.oppErrors.textContent = p ? `${p.errors}/${S.MAX_MISTAKES}` : '—';
    el.oppHints.textContent = p ? `${p.hints}/${S.MAX_HINTS}` : '—';

    if (!el.shadow || el.shadow.children.length !== 81) return;
    const cells = p && typeof p.cells === 'string' ? p.cells : '';
    for (let i = 0; i < 81; i++) {
      el.shadow.children[i].classList.toggle('shadow__cell--on', cells[i] === '1');
    }
  }

  /* ---------- Sfida con codice (senza collegamento) ---------- */

  function refreshCurrentCode() {
    if (!el.codeCurrent) return;
    const st = S.getState();
    el.codeCurrent.value = st.seed
      ? S.makeMatchCode(st.difficulty, st.seed)
      : '(nessuna partita in corso)';
  }

  function startFromCode() {
    const parsed = S.parseMatchCode(el.codeIn.value);
    if (!parsed) {
      S.showToast('Codice non valido: usa il formato MEDIO-7F3A2B');
      return;
    }
    closeLobby();
    S.startGame({ difficulty: parsed.difficulty, seed: parsed.seed, mode: 'solo' });
    S.showToast('Stesso puzzle del tuo avversario: buona fortuna');
  }

  /* ---------- Collegamenti della UI ---------- */

  el.open.addEventListener('click', openLobby);
  el.close.addEventListener('click', closeLobby);
  el.overlay.addEventListener('click', (e) => { if (e.target === el.overlay) closeLobby(); });

  el.create.addEventListener('click', () => createMatch());
  el.join.addEventListener('click', () => joinMatch());
  el.challenge.addEventListener('click', () => { refreshCurrentCode(); showStep('code'); });
  el.localToggle.addEventListener('click', () => {
    duo.useLocal = !duo.useLocal;
    el.localToggle.setAttribute('aria-pressed', String(duo.useLocal));
    el.localNote.hidden = !duo.useLocal;
  });

  el.inviteCopy.addEventListener('click', () => copyText(el.invite.value, el.invite));
  el.inviteShare.addEventListener('click', () => shareText(el.invite.value, el.invite));
  el.inviteNew.addEventListener('click', regenerateInvite);
  el.answerOk.addEventListener('click', acceptAnswer);
  el.hostBack.addEventListener('click', () => { stopInviteAge(); leaveDuel(false); showStep('menu'); });

  el.joinGo.addEventListener('click', generateAnswer);
  el.answerCopy.addEventListener('click', () => copyText(el.answerOut.value, el.answerOut));
  el.answerShare.addEventListener('click', () => shareText(el.answerOut.value, el.answerOut));
  el.guestBack.addEventListener('click', () => { leaveDuel(false); showStep('menu'); });

  // La scelta compatto/lungo si applica al codice già mostrato, senza rigenerarlo
  el.long.addEventListener('change', renderInvite);
  el.longG.addEventListener('change', renderAnswer);

  el.codeGo.addEventListener('click', startFromCode);
  el.codeCopy.addEventListener('click', () => copyText(el.codeCurrent.value, el.codeCurrent));
  el.codeBack.addEventListener('click', () => showStep('menu'));

  el.rematch.addEventListener('click', () => { if (!el.rematch.onclick) askRematch(); });
  el.resultClose.addEventListener('click', () => {
    el.resultOverlay.hidden = true;
    el.resultClose.textContent = 'Chiudi';
    el.rematch.onclick = null;
    leaveDuel(duo.phase !== 'idle');
  });
  el.leave.addEventListener('click', () => {
    if (!confirm('Vuoi davvero abbandonare il duello?')) return;
    leaveDuel(true);
    S.showToast('Duello abbandonato');
  });

  // Nella lobby la tastiera pilota le iniziali, come nella schermata dei record
  document.addEventListener('keydown', (e) => {
    if (el.overlay.hidden) return;
    if (!el.steps.menu.hidden && slots) {
      const tag = e.target.tagName;
      if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') slots.handleKey(e);
    }
    if (e.key === 'Escape') closeLobby();
  });

  window.addEventListener('beforeunload', () => { if (duo.transport) send({ t: 'bye' }); });

  /* ---------- Avvio: un link di invito apre direttamente la lobby ---------- */

  // La partita in solitaria dietro l'overlay resta quella che era: chi chiude la
  // lobby senza collegarsi trova il suo Sudoku dove l'aveva lasciato.
  function maybeJoinFromHash() {
    const hash = location.hash || '';
    if (!hash.startsWith('#j=')) return;
    const code = hash.slice(3);
    history.replaceState(null, '', location.pathname + location.search);
    if (duo.transport) leaveDuel(true); // un nuovo invito sostituisce il precedente
    openLobby();
    joinMatch(code);
  }

  // Aprire un invito con il gioco già aperto cambia solo il frammento dell'URL:
  // il browser non ricarica la pagina, quindi l'evento va intercettato a parte.
  window.addEventListener('hashchange', maybeJoinFromHash);
  maybeJoinFromHash();
})();
