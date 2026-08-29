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
  const HANDSHAKE_TIMEOUT_MS = 25000; // oltre questo il collegamento non ci sarà

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
    bridge: null,         // esito dell'interrogazione al ponte TURN
    handshakeId: null,    // sorveglia che il collegamento si apra davvero
    ageId: null,          // aggiorna l'età dell'invito mostrata all'host
    inviteAt: 0,
    stanza: null,         // codice della cassetta postale, se lo scambio è attivo
    ritirato: false,      // l'avversario ha già ritirato l'invito
    pollId: null,         // sondaggio della risposta
    rinfrescoId: null,    // sostituzione periodica dell'invito non ancora ritirato
    rinfreschi: 0,
    stanzaOspite: null,   // la stanza da cui si è entrati, per chi risponde
    stanzaUsata: null,    // l'ultima stanza usata: il referto deve poterla dire
                          // anche a scambio concluso, che è quando lo si legge
    raccolta: false,      // la risposta è stata raccolta dalla cassetta
    sondaggi: 0,          // quante volte si è chiesto «c'è la risposta?»
    depositata: null,     // esito del deposito della risposta, per chi risponde
    scambioNote: [],      // cosa è successo alla cassetta postale, in ordine
    answering: false,     // risposta in preparazione (evita doppioni da input+click)
    answeredFor: null,    // payload dell'invito per cui la risposta è già pronta
    connecting: false,
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
    hostNet: $('duo-host-net'),
    guestNet: $('duo-guest-net'),
    version: $('duo-version'),
    hostBack: $('duo-host-back'),
    long: $('duo-long'),
    longG: $('duo-long-g'),
    room: $('duo-room'),
    roomCode: $('duo-room-code'),
    roomLink: $('duo-room-link'),
    roomShare: $('duo-room-share'),
    guestRoom: $('duo-guest-room'),
    roomCopy: $('duo-room-copy'),
    reportBox: $('duo-report-box'),
    report: $('duo-report'),
    reportCopy: $('duo-report-copy'),

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
  if (el.version) el.version.textContent = S.APP_VERSION;

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
    if (el.reportBox) { el.reportBox.hidden = true; el.reportBox.open = false; }
    fermaScambio();
    duo.scambioNote = [];
    duo.depositata = null;
    duo.stanzaOspite = null;
    duo.stanzaUsata = null;
    duo.raccolta = false;
    mostraPassiManuali(true);
    mostraPassiGuest(true);
    if (el.guestRoom) el.guestRoom.hidden = true;
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

  /* ---------- Lo scambio automatico ---------- */

  // Quanto spesso si chiede se la risposta è arrivata. Un secondo e mezzo è
  // impercettibile per chi aspetta e sono quattro richieste in tutto.
  const RACCOLTA_MS = 1500;
  // Ogni quanto si sostituisce l'invito che nessuno ha ancora ritirato, e per
  // quante volte. Oltre i quattro minuti chi ha ricevuto il link non arriverà
  // più, e continuare significherebbe tenere aperte allocazioni sul ponte.
  const RINFRESCO_MS = 30000;
  const RINFRESCHI_MAX = 8;

  const campoDi = (node) => (node && node.closest ? node.closest('.duo__field') : null);

  // Il diario dello scambio. I due referti di ieri raccontavano metà storia
  // ciascuno e nessuno dei due diceva **di quale stanza** stesse parlando: con
  // quel dato mancante, «la risposta non è arrivata» e «la risposta è finita in
  // un'altra stanza» sono indistinguibili — e sono guasti diversi.
  const NOTE_MAX = 12;

  function notaScambio(testo) {
    const da = duo.inviteAt ? (Date.now() - duo.inviteAt) / 1000 : 0;
    duo.scambioNote.push(`${da.toFixed(1)}s ${testo}`);
    if (duo.scambioNote.length > NOTE_MAX) duo.scambioNote.shift();
  }

  // I due passi manuali: si nascondono quando la cassetta postale funziona, e
  // ricompaiono tali e quali se non funziona. Non è una modalità a parte —
  // è la stessa schermata con un passaggio in meno.
  function mostraPassiManuali(on) {
    const campoInvito = campoDi(el.invite);
    const campoRisposta = campoDi(el.answerIn);
    if (campoInvito) campoInvito.hidden = !on;
    if (campoRisposta) campoRisposta.hidden = !on;
    if (el.inviteAge) el.inviteAge.hidden = !on;
  }

  // I due passi di chi risponde — incolla il link, rimanda il codice — servono
  // solo allo scambio a mano. Con la cassetta postale non c'è niente da
  // incollare e niente da rimandare: lasciarli visibili significa mostrare due
  // istruzioni da eseguire che non vanno eseguite, e nel primo campo finisce
  // pure l'invito per intero, seicento caratteri che non riguardano nessuno.
  function mostraPassiGuest(on) {
    const campoInvito = campoDi(el.inviteIn);
    const campoRisposta = campoDi(el.answerOut);
    if (campoInvito) campoInvito.hidden = !on;
    if (campoRisposta) campoRisposta.hidden = !on;
    const casella = el.longG && el.longG.closest('.duo__check');
    if (casella) casella.hidden = !on; // «codice lungo» riguarda solo i codici a mano
  }

  function fermaScambio() {
    if (duo.stanza) notaScambio(`stanza ${duo.stanza} abbandonata`);
    clearTimeout(duo.pollId);
    clearTimeout(duo.rinfrescoId);
    duo.pollId = null;
    duo.rinfrescoId = null;
    duo.stanza = null;
    duo.ritirato = false;
    duo.rinfreschi = 0;
    duo.sondaggi = 0;
    if (el.room) el.room.hidden = true;
  }

  // Chi invita: deposita l'invito e mostra il codice breve. Se qualcosa non va
  // — Worker spento, D1 non collegato, rete che non esce — si torna in silenzio
  // allo scambio a mano: il gioco deve restare giocabile senza.
  async function apriStanza(zitto) {
    if (!Net.Scambio.configurato()) { mostraPassiManuali(true); return false; }
    try {
      duo.stanza = await Net.Scambio.apri(duo.transport.describe(el.long.checked));
      duo.stanzaUsata = duo.stanza;
      duo.raccolta = false;
      notaScambio(`aperta stanza ${duo.stanza}`);
    } catch (err) {
      duo.stanza = null;
      notaScambio('apertura stanza fallita: ' + (err.message || err));
      mostraPassiManuali(true);
      S.showToast('Scambio automatico non disponibile: si fa a mano');
      return false;
    }
    duo.ritirato = false;
    duo.rinfreschi = 0;
    mostraPassiManuali(false);
    renderStanza(zitto);
    attendiRisposta();
    programmaRinfresco();
    return true;
  }

  function renderStanza(zitto) {
    if (!el.room || !duo.stanza) return;
    el.room.hidden = false;
    el.roomCode.textContent = duo.stanza;
    el.roomLink.value = inviteLink(duo.stanza);
    if (!zitto) {
      setStatus(el.hostStatus, 'Mandagli il codice: appena lo apre partite. '
        + 'Non deve rimandarti niente.');
    }
  }

  // Il sondaggio. Non è un'attesa passiva: dice anche quando l'avversario ha
  // ritirato l'invito, che è il momento in cui smette di avere senso
  // rinfrescarlo.
  function attendiRisposta() {
    clearTimeout(duo.pollId);
    duo.pollId = setTimeout(async () => {
      if (!duo.stanza || duo.phase !== 'connecting') return;
      duo.sondaggi += 1;
      try {
        const esito = await Net.Scambio.raccogli(duo.stanza);
        if (esito.risposta) {
          duo.raccolta = true;
          notaScambio(`risposta raccolta da ${duo.stanza}`);
          clearTimeout(duo.rinfrescoId);
          duo.stanza = null;
          await usaRisposta(esito.risposta);
          return;
        }
        if (esito.ritirato && !duo.ritirato) {
          duo.ritirato = true;
          notaScambio(`invito ritirato dall’avversario (${duo.stanza})`);
          clearTimeout(duo.rinfrescoId);
          setStatus(el.hostStatus, 'Invito aperto dall’avversario, aspetto la risposta…');
        }
      } catch (err) {
        if (err.status === 404) {
          // La stanza è scaduta: l'invito che ha in mano non vale più.
          notaScambio(`stanza ${duo.stanza} sparita (404) dopo ${duo.sondaggi} sondaggi`);
          fermaScambio();
          mostraPassiManuali(true);
          setStatus(el.hostStatus, 'Il codice è scaduto: premi «Genera un nuovo '
            + 'invito» e ridàgli quello nuovo.', 'bad');
          return;
        }
        // Un intoppo di rete non è un fallimento: si riprova al giro dopo.
      }
      attendiRisposta();
    }, RACCOLTA_MS);
  }

  async function usaRisposta(codice) {
    setStatus(el.hostStatus, 'Risposta arrivata, collego…');
    try {
      await duo.transport.acceptAnswer(codice);
      watchHandshake(el.hostStatus);
    } catch (err) {
      setStatus(el.hostStatus, 'La risposta è arrivata ma non è utilizzabile: '
        + err.message, 'bad');
      renderReport(true);
    }
  }

  // Il pezzo che va oltre la velocità: finché nessuno ha ritirato l'invito, se
  // ne prepara uno nuovo. Un invito raccolto cinque minuti dopo porta indirizzi
  // di cinque minuti prima, e il varco che il router aveva aperto si è già
  // richiuso — è il guasto che questo scambio esiste per togliere di mezzo.
  function programmaRinfresco() {
    clearTimeout(duo.rinfrescoId);
    if (duo.ritirato || duo.rinfreschi >= RINFRESCHI_MAX) return;
    duo.rinfrescoId = setTimeout(rinfrescaInvito, RINFRESCO_MS);
  }

  async function rinfrescaInvito() {
    if (!duo.stanza || duo.ritirato || duo.phase !== 'connecting') return;
    duo.rinfreschi += 1;
    const vecchio = duo.transport;
    let nuovo = null;
    try {
      const ice = duo.bridge || await Net.iceConfig();
      nuovo = Net.RTCTransport(ice.servers);
      await nuovo.createInvite(null, ice.bridge === 'on');
      const esito = await Net.Scambio.rinfresca(duo.stanza, nuovo.describe(el.long.checked));

      // Fra il sondaggio e questo momento l'avversario può aver ritirato
      // l'invito vecchio: in quel caso è quello che lui ha in mano, e il nuovo
      // va buttato — non il contrario.
      if (esito.ritirato) {
        nuovo.close();
        duo.ritirato = true;
        notaScambio('rinfresco scartato: l’invito era già stato ritirato');
        return;
      }
      notaScambio(`invito rinfrescato (${duo.rinfreschi}º)`);
      attach(nuovo);
      renderInvite();
      renderNet(el.hostNet);
      if (vecchio) vecchio.close();
    } catch (err) {
      if (nuovo) nuovo.close();
      // Un rinfresco mancato non rompe niente: l'invito di prima resta valido.
    }
    programmaRinfresco();
  }

  // Chi risponde, arrivando da un codice di stanza: ritira l'invito, prepara la
  // risposta e la deposita. Nessun codice da rimandare a mano.
  async function entraDaStanza(stanza) {
    duo.role = 'guest';
    duo.name = slots ? slots.getValue() : S.loadLastName();
    S.saveLastName(duo.name);
    duo.phase = 'connecting';
    showStep('guest');
    el.inviteIn.value = '';
    el.answerOut.value = '';
    duo.stanzaOspite = stanza;
    duo.stanzaUsata = stanza;
    duo.inviteAt = duo.inviteAt || Date.now();
    duo.depositata = null;
    notaScambio(`entro nella stanza ${stanza}`);
    // Da qui in poi non c'è niente da fare a mano: via i due passi, e al loro
    // posto di quale partita si tratta.
    mostraPassiGuest(false);
    if (el.guestRoom) { el.guestRoom.hidden = false; el.guestRoom.textContent = stanza; }
    setStatus(el.guestStatus, 'Ritiro l’invito…');

    let invito;
    try {
      invito = await Net.Scambio.ritira(stanza);
      notaScambio(`invito ritirato da ${stanza}`);
    } catch (err) {
      notaScambio(`ritiro fallito da ${stanza}: ${err.message || err}`);
      // Senza invito non si va da nessuna parte: si riaprono i passi a mano,
      // che restano una strada percorribile.
      if (el.guestRoom) el.guestRoom.hidden = true;
      mostraPassiGuest(true);
      setStatus(el.guestStatus, err.status === 404
        ? 'Questo codice non vale più: fattene mandare uno nuovo, oppure incolla '
          + 'qui il link dell’invito.'
        : 'Non riesco a ritirare l’invito: ' + err.message, 'bad');
      return;
    }

    el.inviteIn.value = invito;
    await generateAnswer();
    if (!el.answerOut.value) return; // generateAnswer ha già detto cosa non va

    try {
      await Net.Scambio.deposita(stanza, el.answerOut.value);
      duo.depositata = true;
      notaScambio(`risposta depositata in ${stanza}`);
      setStatus(el.guestStatus, 'Risposta mandata. Aspetta il via…', 'ok');
    } catch (err) {
      // La risposta c'è ma non è partita: torna a galla il solo passo che
      // serve, cioè rimandarla a mano.
      duo.depositata = false;
      notaScambio(`deposito fallito in ${stanza}: ${err.message || err}`);
      const campo = campoDi(el.answerOut);
      if (campo) campo.hidden = false;
      setStatus(el.guestStatus, 'Non riesco a mandare la risposta: rimandagli '
        + 'questo codice a mano.', 'bad');
    }
  }

  // Senza un indirizzo raggiungibile da fuori il codice vale solo dentro la
  // stessa rete: meglio dirlo prima di mandarlo, invece di lasciare che il
  // collegamento fallisca senza spiegazioni.
  // Diagnosi unica dello stato della rete. Le tre schermate che ne parlano
  // devono dire la stessa cosa: prima erano tre testi separati, e infatti sono
  // invecchiati ognuno per conto suo quando è arrivato il ponte — parlavano di
  // «nessun server intermedio» mentre il ponte era già in funzione.
  //
  //   warning — prima di condividere il codice: vale la pena mandarlo?
  //   failure — dopo un tentativo fallito: di chi è il problema e cosa si fa?
  function networkDiagnosis() {
    const s = netSummary();
    const b = duo.bridge && duo.bridge.bridge;
    const relay = s ? s.relay : 0;
    const routable = s ? s.routable : 0;

    let warning = null;
    if (s) {
      if (b === 'on' && relay === 0) {
        warning = 'Il ponte risponde ma non ha fornito un suo indirizzo: controlla la '
          + 'TURN Server App su Cloudflare. Senza, in rete mobile non funzionerà.';
      } else if (relay === 0 && routable === 0) {
        warning = b === 'error'
          ? 'Il ponte non risponde e il telefono non ha un indirizzo pubblico: '
            + 'questo codice vale solo sulla stessa rete Wi-Fi.'
          : 'Nessun indirizzo pubblico: questo codice vale solo sulla stessa rete '
            + 'Wi-Fi. Su reti diverse usate «Sfida con un codice».';
      }
    }

    let failure;
    const incompatibili = famiglieIncompatibili();
    if (incompatibili) {
      // La diagnosi che mancava, e che spiegava il caso rimasto senza risposta:
      // due dispositivi con il ponte attivo e nessun collegamento perché i loro
      // indirizzi appartengono a famiglie diverse. Un indirizzo IPv6 e uno IPv4
      // non si parlano: ICE non forma nemmeno una coppia e non prova nulla.
      failure = 'Nessun collegamento: i vostri indirizzi non sono compatibili — '
        + `qui ${incompatibili.miei}, dall’altra parte ${incompatibili.suoi}. `
        + 'Controllate di avere la stessa versione (è in fondo alla pagina) e '
        + 'riprovate; se si ripete, mettetevi sulla stessa Wi-Fi.';
    } else if (relay > 0) {
      // Il caso raro: il ponte era davvero in uso e non è bastato.
      failure = 'Nessun collegamento, nonostante il ponte fosse in uso. Prova a '
        + 'generare un nuovo invito; se si ripete, mettetevi sulla stessa Wi-Fi.';
    } else if (b === 'on') {
      failure = 'Nessun collegamento. Il ponte risponde ma non fornisce un suo '
        + 'indirizzo: il problema è nella TURN Server App su Cloudflare.';
    } else if (routable === 0) {
      failure = 'Nessun collegamento. Il tuo telefono non ha esposto un indirizzo '
        + 'pubblico: mettetevi sulla stessa rete Wi-Fi e riprovate.';
    } else {
      failure = 'Nessun collegamento. Gli indirizzi c’erano, ma la rete non lascia '
        + 'passare il collegamento diretto: è tipico della rete mobile, e senza '
        + 'ponte non c’è rimedio. Provate sulla stessa Wi-Fi.';
    }

    return { warning, failure };
  }

  const localOnlyWarning = () => networkDiagnosis().warning;

  // IPv4 e IPv6 sono due reti che non si parlano: un candidato dell'una non può
  // nemmeno essere provato contro uno dell'altra. Se i due codici non hanno
  // nessuna famiglia in comune fra gli indirizzi buoni per uscire dalla LAN,
  // il collegamento non aveva alcuna possibilità, e dirlo è meglio che
  // rimandare l'utente sulla stessa Wi-Fi senza spiegazioni.
  function famiglieIncompatibili() {
    const t = duo.transport;
    const miei = netSummary();
    const suoi = t && t.peerSummary ? t.peerSummary() : null;
    if (!miei || !suoi) return null;
    const a = Net.routableFamilies(miei);
    const b = Net.routableFamilies(suoi);
    if (!a.length || !b.length) return null; // manca del tutto un indirizzo pubblico: altro caso
    if (a.some((f) => b.includes(f))) return null;
    const nome = (l) => l.map((f) => (f === 'v4' ? 'IPv4' : 'IPv6')).join(' e ');
    return { miei: `solo ${nome(a)}`, suoi: `solo ${nome(b)}` };
  }

  // Il riassunto è quello del codice generato per ultimo: lo aggiorna
  // `describe()`, cioè il momento in cui il codice viene scritto.
  const netSummary = () =>
    (duo.transport && duo.transport.summary ? duo.transport.summary() : null);

  function statoPonte() {
    const b = duo.bridge;
    if (!b || b.bridge === 'off') return 'non configurato';
    if (b.bridge === 'on') return `attivo (${b.count || 1} server)`;
    return `non raggiungibile (${b.error})`;
  }

  // Referto in chiaro degli indirizzi trovati. Serve a chi prova: «0 pubblici»
  // e «2 pubblici» sono due problemi diversi con due rimedi diversi, e senza
  // vederlo scritto non c'è modo di distinguerli da fuori.
  function renderNet(node) {
    if (!node) return;
    const s = netSummary();
    if (!s) { node.textContent = ''; return; }
    const parti = [];
    if (s.routable) parti.push(`${s.routable} pubblic${s.routable === 1 ? 'o' : 'i'}`);
    if (s.host) parti.push(`${s.host} local${s.host === 1 ? 'e' : 'i'}${s.mdns ? ' (mDNS)' : ''}`);
    if (s.relay) parti.push(`${s.relay} dal ponte`);
    // IPv4 e IPv6 vanno detti: un indirizzo IPv6 e uno IPv4 non si parlano, e
    // due referti che si somigliano possono essere incompatibili proprio lì.
    const fam = [];
    if (s.v4) fam.push(`IPv4 ${s.v4}`);
    if (s.v6) fam.push(`IPv6 ${s.v6}`);
    const dettaglio = fam.length ? ` (${fam.join(' · ')})` : '';
    node.textContent = `Indirizzi nel codice: ${parti.join(' · ') || 'nessuno'}${dettaglio}.`
      + ` Ponte: ${statoPonte()}.`;
    node.className = 'duo__net' + (s.routable ? '' : ' duo__net--warn');
  }

  /* ---------- Referto tecnico ---------- */

  // Le prove non attraversano NAT veri: quando un collegamento fallisce sul
  // campo, questo referto è l'unica traccia di cosa sia successo. Va chiesto a
  // *entrambi* i dispositivi, perché il difetto tipico — indirizzi che non si
  // incontrano — si vede solo mettendo i due elenchi a confronto.
  async function renderReport(apri) {
    if (!el.reportBox || !el.report) return;
    const t = duo.transport;
    if (!t || !t.report) { el.reportBox.hidden = true; return; }
    el.reportBox.hidden = false;
    let righe;
    try {
      righe = await t.report();
    } catch (err) {
      righe = ['referto non leggibile: ' + (err.message || err)];
    }
    // La riga che mancava: **quale stanza**. Due referti che non la nominano non
    // permettono di distinguere «la risposta non è partita» da «la risposta è
    // finita in un'altra stanza», che hanno rimedi opposti.
    const stanza = duo.stanza || duo.stanzaOspite || duo.stanzaUsata;
    const scambio = [];
    if (stanza) scambio.push(`stanza: ${stanza}`);
    else if (Net.Scambio.configurato()) scambio.push('stanza: nessuna (scambio a mano)');
    if (duo.role !== 'guest' && stanza) {
      // Raccogliere la risposta implica che l'invito era stato ritirato, anche
      // se nessun sondaggio ha fatto in tempo a vederlo.
      scambio.push(`ritirato dall’avversario: ${duo.ritirato || duo.raccolta ? 'sì' : 'no'}`);
      scambio.push(`sondaggi: ${duo.sondaggi} · rinfreschi: ${duo.rinfreschi}`);
    }
    if (duo.role === 'guest' && duo.depositata !== null) {
      scambio.push(`risposta depositata: ${duo.depositata ? 'sì' : 'NO'}`);
    }

    el.report.value = [
      `Sudoku ${S.APP_VERSION} · ${duo.role === 'guest' ? 'chi risponde' : 'chi invita'}`,
      `ponte: ${statoPonte()}`,
      ...scambio,
      ...righe,
      ...(duo.scambioNote.length ? ['scambio: ' + duo.scambioNote.join(' → ')] : []),
    ].join('\n');
    if (apri) el.reportBox.open = true;
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
    renderReport(false);
    if (st === 'open') {
      duo.lastSeen = Date.now();
      stopInviteAge(); // collegati: l'età dell'invito non conta più
      clearTimeout(duo.handshakeId);
      startHeartbeat();
      if (duo.role === 'guest') {
        send({ t: 'hello', proto: PROTO, name: duo.name });
        setStatus(el.guestStatus, 'Collegato, in attesa del puzzle…', 'ok');
      } else {
        setStatus(el.hostStatus, 'Collegato, in attesa dell’avversario…', 'ok');
      }
      updateLink('ok');
    } else if (st === 'failed') {
      setStatus(duo.role === 'host' ? el.hostStatus : el.guestStatus,
        networkDiagnosis().failure, 'bad');
      renderReport(true);
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
    fermaScambio();
    mostraPassiManuali(true);
    el.answerIn.parentElement.hidden = false;
    el.invite.value = '';
    el.inviteAge.textContent = '';
    setStatus(el.hostStatus, 'Cerco un percorso di rete…');
    try {
      const ice = await Net.iceConfig();
      duo.bridge = ice;
      const transport = Net.RTCTransport(ice.servers);
      attach(transport);
      await transport.createInvite((type) => {
        if (type === 'relay') setStatus(el.hostStatus, 'Ponte agganciato, preparo l’invito…');
        else if (type === 'srflx') setStatus(el.hostStatus, 'Indirizzo pubblico trovato, cerco il ponte…');
      }, ice.bridge === 'on');
      renderInvite();
      startInviteAge();
      renderNet(el.hostNet);
      renderReport(false);
      // Il messaggio si mette *prima* di andare alla cassetta postale: l'invito
      // è già pronto, e lasciare «Cerco un percorso di rete…» mentre si aspetta
      // il Worker significa mostrare per otto secondi uno stato non più vero.
      const warn = localOnlyWarning();
      setStatus(el.hostStatus, warn || 'Manda il link all’avversario, poi incolla qui il '
        + 'codice di risposta che ti rimanda.', warn ? 'bad' : null);
      // Se lo scambio automatico riesce, il messaggio lo riscrive lui — a meno
      // che ci sia un avviso sulla rete, che è più importante di un'istruzione.
      await apriStanza(!!warn);
    } catch (err) {
      setStatus(el.hostStatus, 'Non riesco a preparare l’invito: ' + err.message, 'bad');
    }
  }

  async function regenerateInvite() {
    stopInviteAge();
    fermaScambio();
    clearTimeout(duo.handshakeId);
    if (duo.transport) { duo.transport.close(); duo.transport = null; }
    el.answerIn.value = '';
    await createMatch();
    // Trappola da segnalare: la risposta calcolata sull'invito precedente non
    // vale più per questo, e chi l'ha già ricevuto sta guardando un link morto.
    S.showToast('Invito nuovo: rimanda il link, quello di prima non vale più');
  }

  // Chi si scambia i codici lo fa in una chat o in una bozza di posta, che li
  // accumula: capita di incollare tutto il blocco. Si dà retta all'ultimo, ma
  // va detto — perché la risposta di un tentativo precedente viene accettata
  // senza errori e poi non si collega mai.
  function avvisaPiuCodici(testo, node) {
    const n = Net.countCodes(testo);
    if (n > 1) {
      S.showToast(`Nell’incollato ci sono ${n} codici: uso l’ultimo`);
      setStatus(node, `Attenzione: ho trovato ${n} codici in quello che hai `
        + 'incollato e sto usando l’ultimo. Se non è quello giusto, incolla solo '
        + 'il codice più recente.');
    }
    return n;
  }

  async function acceptAnswer() {
    if (duo.connecting) return;
    const code = el.answerIn.value;
    if (!Net.extractCode(code)) {
      setStatus(el.hostStatus, 'Incolla il codice di risposta dell’avversario.', 'bad');
      return;
    }
    avvisaPiuCodici(code, el.hostStatus);
    if (!duo.transport || !duo.transport.acceptAnswer) {
      setStatus(el.hostStatus, 'L’invito non è più valido: generane uno nuovo.', 'bad');
      return;
    }
    duo.connecting = true;
    setStatus(el.hostStatus, 'Collego…');
    try {
      const applicata = await duo.transport.acceptAnswer(code);
      if (applicata === false) {
        // La risposta era già stata applicata: incollare avvia il collegamento
        // da sé, quindi premere «Collega» dopo è normale e non è un errore.
        setStatus(el.hostStatus, 'Risposta già accettata: sto collegando…');
        return;
      }
      watchHandshake(el.hostStatus);
    } catch (err) {
      setStatus(el.hostStatus, 'Codice di risposta non valido: ' + err.message, 'bad');
    } finally {
      duo.connecting = false;
    }
  }

  // Il codice accettato non significa collegamento riuscito: l'attraversamento
  // della rete può non riuscire mai, e senza questo controllo la schermata
  // resterebbe su «Collego…» per sempre. Passato il tempo, si dice cosa è
  // andato storto — distinguendo i due casi, che hanno rimedi diversi.
  function watchHandshake(node) {
    clearTimeout(duo.handshakeId);
    duo.handshakeId = setTimeout(() => {
      if (duo.phase !== 'connecting' || !duo.transport) return; // già partito
      setStatus(node, networkDiagnosis().failure, 'bad');
      renderReport(true);
    }, HANDSHAKE_TIMEOUT_MS);
  }

  async function joinMatch(prefilled) {
    // Un codice di stanza porta allo scambio automatico: niente da rimandare.
    const stanza = !duo.useLocal && Net.Scambio.configurato()
      ? Net.Scambio.extractRoom(prefilled) : null;
    if (stanza) return entraDaStanza(stanza);

    duo.role = 'guest';
    duo.name = slots ? slots.getValue() : S.loadLastName();
    S.saveLastName(duo.name);
    duo.phase = 'connecting';

    if (duo.useLocal) {
      attach(Net.LocalTransport('local'));
      showStep('guest');
      mostraPassiGuest(false);
      setStatus(el.guestStatus, 'Mi collego all’altra scheda…');
      return;
    }

    showStep('guest');
    if (prefilled) el.inviteIn.value = prefilled;
    el.answerOut.value = '';
    mostraPassiGuest(true);
    if (el.guestRoom) el.guestRoom.hidden = true;

    // Arrivando da un link l'invito c'è già: generare la risposta da soli evita
    // un passaggio manuale che non aggiunge nulla.
    if (prefilled && Net.extractCode(prefilled)) {
      setStatus(el.guestStatus, 'Invito ricevuto, preparo la risposta…');
      generateAnswer();
      return;
    }
    setStatus(el.guestStatus, 'Incolla il link o il codice che ti ha mandato l’avversario.');
  }

  async function generateAnswer() {
    const code = el.inviteIn.value;
    const stanza = !duo.useLocal && Net.Scambio.configurato()
      ? Net.Scambio.extractRoom(code) : null;
    if (stanza) return entraDaStanza(stanza);
    const found = Net.extractCode(code);
    if (!found) {
      setStatus(el.guestStatus, 'Incolla il link o il codice dell’invito.', 'bad');
      return;
    }
    if (duo.answering) return;
    avvisaPiuCodici(code, el.guestStatus);

    // Una risposta vale per un invito solo. Rigenerarla per lo stesso invito
    // renderebbe inutile quella già mandata all'avversario.
    if (duo.transport && duo.answeredFor === found.payload) {
      setStatus(el.guestStatus, 'La risposta è già pronta qui sotto: rimandala all’avversario.');
      return;
    }
    if (duo.transport) { duo.transport.close(); duo.transport = null; } // invito diverso

    duo.answering = true;
    duo.answeredFor = found.payload;
    setStatus(el.guestStatus, 'Cerco un percorso di rete…');
    try {
      const ice = await Net.iceConfig();
      duo.bridge = ice;
      const transport = Net.RTCTransport(ice.servers);
      attach(transport);
      await transport.joinWithInvite(code, (type) => {
        if (type === 'relay') setStatus(el.guestStatus, 'Ponte agganciato, preparo la risposta…');
        else if (type === 'srflx') setStatus(el.guestStatus, 'Indirizzo pubblico trovato, cerco il ponte…');
      }, ice.bridge === 'on');
      renderAnswer();
      renderNet(el.guestNet);
      renderReport(false);
      // Invito servito: solo ora si può ripulire l'URL. Toglierlo prima significa
      // perderlo se il telefono ricarica o ripristina la pagina dalla cache.
      if (/[#&]j=/.test(location.hash)) {
        history.replaceState(null, '', location.pathname + location.search);
      }
      const warn = localOnlyWarning();
      setStatus(el.guestStatus, warn || 'Rimanda subito questo codice all’avversario '
        + 'e aspetta il via.', warn ? 'bad' : null);
      watchHandshake(el.guestStatus); // se non si apre nulla, dirlo invece di tacere
    } catch (err) {
      setStatus(el.guestStatus, 'Invito non valido: ' + err.message, 'bad');
    } finally {
      duo.answering = false;
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
    clearTimeout(duo.handshakeId);
    stopInviteAge();
    fermaScambio();
    if (duo.transport) duo.transport.close();
    duo.transport = null;
    duo.phase = 'idle';
    duo.role = null;
    showHud(false);
    el.countOverlay.hidden = true;
    S.convertToSolo();
  }

  // I dati del giocatore, durante il duello, stanno sotto quelli
  // dell'avversario e incolonnati come i suoi. Il nodo è **lo stesso** della
  // barra in alto, spostato e poi rimesso a posto: due contatori separati
  // sarebbero due cose da tenere d'accordo, e prima o poi una delle due mente.
  function spostaMieiDati(nelDuello) {
    const stats = document.querySelector('.toolbar__stats');
    const barra = document.querySelector('.toolbar');
    const slot = $('duo-mine-slot');
    const cornice = $('duo-mine');
    const celle = $('stat-filled');
    const aiuti = $('stat-hints');
    const record = $('stat-best');
    if (!stats || !barra || !slot || !cornice) return;
    // In duello le quattro colonne sono le stesse dell'avversario — tempo,
    // celle, errori, aiuti — perché il confronto sia un'occhiata e non una
    // lettura. Il record, in duello, non dice niente di utile: torna quando si
    // torna a giocare da soli, e con lui la barra di sempre.
    if (celle) celle.hidden = !nelDuello;
    if (aiuti) aiuti.hidden = !nelDuello;
    if (record) record.hidden = nelDuello;
    cornice.hidden = !nelDuello;
    (nelDuello ? slot : barra).appendChild(stats);
  }

  function showHud(on) {
    spostaMieiDati(on);
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

  if (el.roomCopy) {
    el.roomCopy.addEventListener('click', () => copyText(el.roomLink.value, el.roomLink));
  }
  if (el.roomShare) {
    el.roomShare.addEventListener('click', () => shareText(
      `Sfida a Sudoku — codice ${duo.stanza}\n${el.roomLink.value}`, el.roomLink));
  }
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
  el.long.addEventListener('change', () => { renderInvite(); renderNet(el.hostNet); });
  el.longG.addEventListener('change', () => { renderAnswer(); renderNet(el.guestNet); });

  if (el.reportBox) {
    // Il referto invecchia in fretta: si rilegge ogni volta che lo si apre,
    // altrimenti mostra la fotografia di dieci secondi prima.
    el.reportBox.addEventListener('toggle', () => { if (el.reportBox.open) renderReport(false); });
  }
  if (el.reportCopy) {
    el.reportCopy.addEventListener('click', async () => {
      await renderReport(false);
      copyText(el.report.value, el.report);
    });
  }

  // Su un telefono ogni tocco in più è attrito: appena nel campo compare un
  // codice valido si procede da soli, senza aspettare la pressione del pulsante.
  el.inviteIn.addEventListener('input', () => {
    if (Net.extractCode(el.inviteIn.value)) generateAnswer();
  });

  el.answerIn.addEventListener('input', () => {
    if (duo.connecting) return;
    if (Net.extractCode(el.answerIn.value)) acceptAnswer();
  });

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
  let handledInvite = null;

  function maybeJoinFromHash() {
    const m = /[#&]j=([^&\s]+)/.exec(location.hash || '');
    if (!m) return;
    const code = m[1];
    if (code === handledInvite) return; // già preso in carico: non ripetere
    handledInvite = code;
    if (duo.transport) leaveDuel(true); // un nuovo invito sostituisce il precedente
    openLobby();
    joinMatch(code);
  }

  // Tre strade portano qui, e servono tutte tre:
  //  · caricamento normale del link;
  //  · `hashchange`, perché con il gioco già aperto un invito cambia solo il
  //    frammento e il browser non ricarica nulla;
  //  · `pageshow`, perché iOS può ripristinare la pagina dalla cache
  //    avanti/indietro senza rieseguire lo script.
  window.addEventListener('hashchange', maybeJoinFromHash);
  window.addEventListener('pageshow', maybeJoinFromHash);
  maybeJoinFromHash();
})();
