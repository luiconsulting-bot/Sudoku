/* ============================================================
   Sudoku — livello di rete
   Un'interfaccia sola, due implementazioni:
     · LocalTransport — due schede dello stesso browser (prova rapida)
     · RTCTransport   — due dispositivi diversi, peer-to-peer via WebRTC
   Nessuna dipendenza dal DOM: questo file si prova dalla console.
   ============================================================ */

(function () {
  'use strict';

  /* ---------- Codifica dei codici di collegamento ---------- */

  // Un SDP completo è ~1,5 kB e in base64 diventa illeggibile. Trasmettiamo solo
  // i campi indispensabili e ricostruiamo l'SDP dall'altra parte: il codice passa
  // da ~2000 a ~300 caratteri, abbastanza corto da mandare su una chat.
  // `S1:`  codice compatto (predefinito)
  // `S1L:` codice lungo, SDP integrale — via di scampo se la ricostruzione
  //        non piace a un browser: più brutto, ma senza margine di errore.
  const PREFIX_COMPACT = 'S1:';
  const PREFIX_LONG = 'S1L:';

  const SETUP = ['actpass', 'active', 'passive'];
  const CAND_OUT = { host: 0, srflx: 1, prflx: 2, relay: 3 };
  const CAND_IN = ['host', 'srflx', 'prflx', 'relay'];

  function b64urlEncode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function b64urlDecode(str) {
    const b64 = String(str).replace(/-/g, '+').replace(/_/g, '/');
    const pad = '='.repeat((4 - (b64.length % 4)) % 4);
    const bin = atob(b64 + pad);
    const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  // Con il ponte attivo un telefono può produrre venti e più candidati, e il
  // codice arriva a superare i mille caratteri — scomodo da mandare e da
  // incollare. Per collegarsi ne bastano pochi: si tengono i migliori di ogni
  // tipo, per priorità decrescente, conservando l'ordine originale.
  const MAX_PER_TYPE = 2;

  // La famiglia dell'indirizzo: 4, 6, oppure 0 per i nomi mDNS `.local`, che
  // la nascondono. Serve al taglio qui sotto.
  function famiglia(ip) {
    const s = String(ip);
    if (s.includes(':')) return 6;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(s)) return 4;
    return 0; // nome mDNS: la famiglia si scopre solo risolvendolo
  }

  // Il taglio si fa per tipo **e per famiglia di indirizzo**, non per solo tipo.
  // Il motivo è costato una serata di prove sul campo: un PC con IPv4 e IPv6
  // raccoglie dieci candidati dal ponte, cinque per famiglia, e Chrome dà
  // priorità più alta a quelli IPv6. Tenendo i due migliori e basta partivano
  // due relay IPv6, mentre il telefono in 5G mandava due relay IPv4. Due
  // candidati di famiglie diverse non formano nemmeno una coppia: ICE non
  // prova niente e il collegamento fallisce *pur avendo il ponte attivo da
  // entrambe le parti* — il caso che sembrava inspiegabile.
  function trimCandidates(cands) {
    const perGruppo = new Map();
    for (const c of cands) {
      const chiave = c[0] + '/' + famiglia(c[1]);
      const lista = perGruppo.get(chiave) || [];
      lista.push(c);
      perGruppo.set(chiave, lista);
    }
    const tenuti = new Set();
    for (const lista of perGruppo.values()) {
      lista.sort((a, b) => b[3] - a[3]); // priorità ICE decrescente
      for (const c of lista.slice(0, MAX_PER_TYPE)) tenuti.add(c);
    }
    return cands.filter((c) => tenuti.has(c));
  }

  // SDP → array compatto, oppure null se manca qualcosa di essenziale
  function compactSdp(sdp) {
    const one = (re) => {
      const m = re.exec(sdp);
      return m ? m[1].trim() : null;
    };
    const ufrag = one(/^a=ice-ufrag:(.+)$/m);
    const pwd = one(/^a=ice-pwd:(.+)$/m);
    const fp = one(/^a=fingerprint:sha-256 (.+)$/im);
    const setup = one(/^a=setup:(\w+)$/m);
    if (!ufrag || !pwd || !fp || !setup) return null;
    const setupIdx = SETUP.indexOf(setup);
    if (setupIdx < 0) return null;

    const cands = [];
    // Solo UDP e solo componente 1: con BUNDLE il resto è ridondante
    const re = /^a=candidate:(\S+) (\d+) udp (\d+) (\S+) (\d+) typ (\w+)(?: raddr (\S+) rport (\d+))?/gim;
    let m;
    while ((m = re.exec(sdp)) !== null) {
      if (m[2] !== '1') continue;
      const type = CAND_OUT[m[6].toLowerCase()];
      if (type === undefined) continue;
      // `raddr`/`rport` non si trasmettono: per ICE sono informativi (Chrome
      // stesso li azzera negli srflx che pubblica), occupano fino a quaranta
      // caratteri l'uno e nel codice di risposta di un telefono in 5G finivano
      // per esporre il suo IPv6 pubblico. Si ricostruiscono a destinazione.
      cands.push([type, m[4], Number(m[5]), Number(m[3])]);
    }
    if (cands.length === 0) return null; // senza candidati il codice è inservibile

    return [1, ufrag, pwd, fp.replace(/:/g, ''), setupIdx, trimCandidates(cands)];
  }

  // Array compatto → SDP valido per un canale dati
  function expandSdp(arr) {
    if (!Array.isArray(arr) || arr[0] !== 1) throw new Error('formato del codice non riconosciuto');
    const [, ufrag, pwd, fpHex, setupIdx, cands] = arr;
    if (!ufrag || !pwd || !fpHex || !Array.isArray(cands)) throw new Error('codice incompleto');
    const hex = String(fpHex).match(/.{2}/g);
    if (!hex) throw new Error('impronta del certificato non valida');

    const lines = [
      'v=0',
      'o=- 1 2 IN IP4 127.0.0.1',
      's=-',
      't=0 0',
      'a=group:BUNDLE 0',
      'a=msid-semantic: WMS',
      'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
      'c=IN IP4 0.0.0.0',
      `a=ice-ufrag:${ufrag}`,
      `a=ice-pwd:${pwd}`,
      `a=fingerprint:sha-256 ${hex.join(':').toUpperCase()}`,
      `a=setup:${SETUP[setupIdx] || 'actpass'}`,
      'a=mid:0',
      'a=sctp-port:5000',
      'a=max-message-size:262144',
    ];

    cands.forEach((c, i) => {
      const [type, ip, port, prio, raddr, rport] = c;
      const tipo = CAND_IN[type] || 'host';
      let l = `a=candidate:${i + 1} 1 udp ${prio} ${ip} ${port} typ ${tipo}`;
      // La grammatica dell'SDP vuole `raddr` per tutto ciò che non è `host`.
      // Se il codice non lo porta (dalla versione che ha smesso di spedirlo) si
      // rimette quello neutro, della stessa famiglia dell'indirizzo.
      if (raddr) l += ` raddr ${raddr} rport ${rport}`;
      else if (tipo !== 'host') l += ` raddr ${famiglia(ip) === 6 ? '::' : '0.0.0.0'} rport 0`;
      lines.push(l);
    });
    lines.push('a=end-of-candidates');

    return lines.join('\r\n') + '\r\n';
  }

  function encodeDesc(sdp, useLong) {
    if (!useLong) {
      const compact = compactSdp(sdp);
      if (compact) return PREFIX_COMPACT + b64urlEncode(JSON.stringify(compact));
      // Nessun candidato utilizzabile o SDP inatteso: meglio un codice lungo
      // che un codice compatto rotto.
    }
    return PREFIX_LONG + b64urlEncode(sdp);
  }

  // Estrae il codice da quello che l'utente ha incollato, che nella realtà è
  // raramente il codice nudo: può essere un link intero, avere spazi o capi di
  // riga aggiunti dalla chat, ed è normale che la tastiera del telefono
  // "corregga" il prefisso in minuscolo. Il payload invece resta come è: è
  // base64url, dove maiuscole e minuscole contano.
  const CODE_RE = /S1(L?):([A-Za-z0-9_-]{16,})/i;
  const asCandidate = (m) => ({ long: m[1].toUpperCase() === 'L', payload: m[2] });

  function codeCandidates(text) {
    const s = String(text || '');
    const out = [];

    // Prima il codice come token a sé: il payload finisce dove finiscono i
    // caratteri ammessi, quindi un codice incollato *dentro una frase* non si
    // porta dietro le parole che lo seguono.
    const direct = CODE_RE.exec(s);
    if (direct) out.push(asCandidate(direct));

    // Poi il ripiego per il codice spezzato su più righe da chi l'ha inoltrato:
    // qui gli spazi vanno tolti, ma solo come seconda ipotesi perché su una
    // frase intera incollerebbe il codice al testo vicino.
    const flat = CODE_RE.exec(s.replace(/\s+/g, ''));
    if (flat && (!direct || flat[2] !== direct[2])) out.push(asCandidate(flat));

    return out;
  }

  const extractCode = (text) => codeCandidates(text)[0] || null;

  function decodeDesc(code) {
    const candidates = codeCandidates(code);
    if (candidates.length === 0) {
      throw new Error(String(code || '').trim()
        ? 'in quello che hai incollato non trovo un codice del gioco'
        : 'codice vuoto');
    }
    for (const c of candidates) {
      try {
        return c.long ? b64urlDecode(c.payload)
          : expandSdp(JSON.parse(b64urlDecode(c.payload)));
      } catch { /* si prova l'ipotesi successiva */ }
    }
    throw new Error('il codice sembra incompleto o alterato: rifallo copiare per intero');
  }

  /* ---------- Trasporto locale (due schede dello stesso browser) ---------- */

  // Non è uno scarto: permette di sviluppare e provare tutta la logica del duello
  // senza due dispositivi in mano e senza reti di mezzo.
  function LocalTransport(room) {
    const channel = new BroadcastChannel('sudoku.duo.' + (room || 'local'));
    const handlers = { message: null, state: null };
    let closed = false;

    channel.onmessage = (e) => {
      if (!closed && handlers.message) handlers.message(e.data);
    };

    return {
      kind: 'local',
      onMessage(fn) { handlers.message = fn; },
      onStateChange(fn) {
        handlers.state = fn;
        // Il canale è utilizzabile da subito: nessuna negoziazione da attendere
        setTimeout(() => { if (!closed && handlers.state) handlers.state('open'); }, 0);
      },
      send(msg) { if (!closed) channel.postMessage(msg); },
      close() {
        if (closed) return;
        closed = true;
        try { channel.close(); } catch { /* già chiuso */ }
        if (handlers.state) handlers.state('closed');
      },
    };
  }

  /* ---------- Trasporto WebRTC (due dispositivi diversi) ---------- */

  const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ];

  /* ---------- Il ponte (TURN) ---------- */

  // Lo STUN dice a un dispositivo qual è il suo indirizzo pubblico, ma non serve
  // a nulla quando la rete non lascia passare il traffico diretto — il caso
  // tipico della rete mobile. Lì serve un TURN, che inoltra i pacchetti per
  // conto dei due peer.
  //
  // Le credenziali TURN non possono stare qui: questa pagina è pubblica e
  // chiunque le userebbe. Vengono quindi chieste a un endpoint che le conia a
  // scadenza (un Worker Cloudflare, vedi turn-worker/), tenendo il token segreto
  // dalla sua parte. Senza endpoint configurato non cambia niente: si resta
  // peer-to-peer puro, che è il comportamento predefinito.

  const TURN_FETCH_TIMEOUT_MS = 5000;
  const TURN_OVERRIDE_KEY = 'sudoku.turn.v1';

  function turnEndpoint() {
    try {
      // `?turn=<url>` permette di provare un endpoint senza ripubblicare il
      // sito; una volta indicato resta memorizzato. `?turn=` vuoto lo azzera.
      const fromUrl = new URLSearchParams(location.search).get('turn');
      if (fromUrl !== null) {
        if (fromUrl) localStorage.setItem(TURN_OVERRIDE_KEY, fromUrl);
        else localStorage.removeItem(TURN_OVERRIDE_KEY);
      }
      const saved = localStorage.getItem(TURN_OVERRIDE_KEY);
      if (saved) return saved;
    } catch { /* localStorage non disponibile: si usa la configurazione */ }
    const cfg = window.SUDOKU_CONFIG;
    return (cfg && cfg.turnEndpoint) || '';
  }

  // Accetta le forme in cui i vari servizi restituiscono gli ICE server:
  // { iceServers: {...} } (Cloudflare), { iceServers: [...] }, oppure un array
  function normalizeIceServers(data) {
    const raw = data && data.iceServers !== undefined ? data.iceServers : data;
    const list = Array.isArray(raw) ? raw : (raw ? [raw] : []);
    return list.filter((s) => s && s.urls && (
      Array.isArray(s.urls) ? s.urls.length : String(s.urls).length
    ));
  }

  let icePromise = null;

  // Risolve una volta sola per sessione: le credenziali hanno una scadenza
  // lunga e non ha senso chiederle a ogni partita.
  function iceConfig() {
    if (icePromise) return icePromise;
    const endpoint = turnEndpoint();

    if (!endpoint) {
      icePromise = Promise.resolve({ servers: ICE_SERVERS, bridge: 'off' });
      return icePromise;
    }

    icePromise = (async () => {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TURN_FETCH_TIMEOUT_MS);
        const res = await fetch(endpoint, { signal: controller.signal });
        clearTimeout(timer);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const extra = normalizeIceServers(await res.json());
        if (extra.length === 0) throw new Error('risposta senza iceServers');
        return { servers: ICE_SERVERS.concat(extra), bridge: 'on', count: extra.length };
      } catch (err) {
        // Il ponte non deve mai impedire un tentativo diretto: se non risponde
        // si prosegue senza, dicendolo.
        return { servers: ICE_SERVERS, bridge: 'error', error: err.message || String(err) };
      }
    })();
    return icePromise;
  }

  // Quali candidati contiene un SDP. Serve a sapere *prima* di condividere un
  // codice se quel codice ha qualche speranza di funzionare fuori dalla LAN.
  function candidateSummary(sdp) {
    const out = { host: 0, srflx: 0, prflx: 0, relay: 0, mdns: 0, v4: 0, v6: 0, fam: {} };
    const re = /^a=candidate:\S+ (\d+) udp \d+ (\S+) \d+ typ (\w+)/gim;
    let m;
    while ((m = re.exec(sdp)) !== null) {
      if (m[1] !== '1') continue;
      const type = m[3].toLowerCase();
      const fam = famiglia(m[2]);
      if (type in out) out[type]++;
      if (/\.local$/i.test(m[2])) out.mdns++;
      if (fam === 4) out.v4++;
      else if (fam === 6) out.v6++;
      // Tipo e famiglia insieme: è la coppia che decide se due elenchi di
      // candidati possono incontrarsi. Un relay IPv6 e un relay IPv4 non
      // formano nessuna coppia, e contarli entrambi come «2 dal ponte»
      // nasconde proprio il caso che fa fallire il collegamento.
      const chiave = type + (fam ? '/v' + fam : '');
      out.fam[chiave] = (out.fam[chiave] || 0) + 1;
    }
    // Un candidato "raggiungibile da fuori" è ciò che permette a due dispositivi
    // su reti diverse di trovarsi. Gli host (e ancor più quelli mDNS `.local`)
    // valgono solo dentro la stessa rete.
    out.routable = out.srflx + out.relay + out.prflx;
    return out;
  }

  // "host 2 · relay/v4 2 · relay/v6 2" — la riga da leggere per capire se due
  // elenchi hanno qualcosa in comune.
  function summaryDetail(s) {
    if (!s) return 'nessuno';
    const parti = Object.entries(s.fam).map(([k, n]) => `${k} ${n}`);
    return parti.join(' · ') || 'nessuno';
  }

  // Le famiglie di indirizzi con cui questo codice può uscire dalla propria
  // rete. IPv4 e IPv6 sono due reti separate: un candidato dell'una non viene
  // nemmeno provato contro uno dell'altra, quindi due codici senza famiglie in
  // comune non hanno alcuna possibilità di collegarsi.
  function routableFamilies(s) {
    if (!s || !s.fam) return [];
    return ['v4', 'v6'].filter((f) => ['srflx', 'prflx', 'relay']
      .some((tipo) => s.fam[`${tipo}/${f}`]));
  }

  // I candidati vanno tutti dentro il codice: non c'è un canale per mandarne
  // altri dopo, quindi bisogna attendere la raccolta prima di mostrarlo.
  //
  // Attenzione al compromesso: su molte reti `iceGatheringState` non diventa
  // mai `complete` (lo STUN non risponde e la raccolta resta aperta), quindi un
  // tetto serve — ma se il tetto è troppo basso si finisce per pubblicare un
  // codice con soli candidati locali, che tra due dispositivi diversi non
  // funzionerà mai. Perciò: si esce presto appena si ha un indirizzo pubblico,
  // e solo in mancanza di quello si aspetta fino in fondo.
  //
  // Un secondo tranello, scoperto in uso reale: il candidato del ponte (`relay`)
  // arriva **sempre dopo** quello STUN (`srflx`), perché allocare il canale sul
  // server TURN richiede un giro in più. Uscire al primo srflx significa quindi
  // pubblicare un codice senza il ponte — che risulta «attivo» ma non serve a
  // niente. Perciò, quando il ponte c'è, si aspetta il suo candidato.
  //
  // Terzo tranello, dello stesso ceppo: i candidati del ponte non arrivano
  // insieme. Cloudflare offre cinque indirizzi e un dispositivo con IPv4 e IPv6
  // ne alloca uno per famiglia su ciascuno: dieci risposte in fila, non una.
  // Chiudere mezzo secondo dopo la *prima* lasciava fuori tutte le altre — e se
  // la prima famiglia era l'IPv6, dal codice sparivano i relay IPv4, cioè
  // proprio quelli che il telefono in 5G poteva raggiungere. Perciò l'attesa si
  // riapre a ogni candidato utile: finisce quando smettono di arrivarne, non al
  // primo.
  function waitForIce(pc, opts = {}) {
    const needRelay = !!opts.needRelay;
    const maxMs = opts.maxMs || (needRelay ? 15000 : 10000);
    const graceMs = opts.graceMs || 600;
    const onProgress = opts.onProgress;

    return new Promise((resolve) => {
      if (pc.iceGatheringState === 'complete') return resolve();
      let done = false;
      let grace = null;

      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(hard);
        clearTimeout(grace);
        pc.removeEventListener('icegatheringstatechange', onChange);
        pc.removeEventListener('icecandidate', onCandidate);
        resolve();
      };

      const onCandidate = (e) => {
        if (!e.candidate) return finish(); // null = raccolta conclusa
        const type = (/ typ (\w+)/.exec(e.candidate.candidate) || [])[1];
        if (onProgress) onProgress(type);

        // Con il ponte attivo solo il suo candidato chiude l'attesa: uno srflx
        // non basta, perché il relay arriverebbe subito dopo e resterebbe fuori.
        const enough = needRelay ? type === 'relay' : (type === 'srflx' || type === 'relay');
        if (enough) {
          // Ogni candidato utile rimanda la chiusura: così la raccolta segue la
          // raffica invece di troncarla al primo.
          clearTimeout(grace);
          grace = setTimeout(finish, graceMs);
        }
      };

      const onChange = () => { if (pc.iceGatheringState === 'complete') finish(); };
      const hard = setTimeout(finish, maxMs);
      pc.addEventListener('icegatheringstatechange', onChange);
      pc.addEventListener('icecandidate', onCandidate);
    });
  }

  /* ---------- Il referto tecnico ---------- */

  // Da qui non si esce su Internet e l'attraversamento NAT vero non è
  // riproducibile: l'unica fonte di verità è un tentativo su dispositivi reali,
  // che però avviene lontano da chi legge il codice. Il referto è il modo di
  // farsi raccontare cosa è successo: quali candidati sono partiti, quali sono
  // arrivati, che errori hanno dato i server, come sono cambiati gli stati.
  // Senza, resta solo «non si collega», che non distingue cause diverse.
  function makeDiag(pc, serverCount) {
    const t0 = Date.now();
    const diag = {
      servers: serverCount,
      errors: new Map(),   // "codice url" → quante volte
      states: [],          // [ms, etichetta]
      gathered: null,      // candidati raccolti da noi
      sent: null,          // candidati davvero finiti nel codice (dopo il taglio)
      received: null,      // candidati arrivati dall'avversario
    };

    const segna = (etichetta) => {
      const ultimo = diag.states[diag.states.length - 1];
      if (ultimo && ultimo[1] === etichetta) return;
      diag.states.push([Date.now() - t0, etichetta]);
    };

    // L'evento più informativo di tutti, e finora ignorato: dice se il ponte ha
    // rifiutato le credenziali (401), se non ha risposto (701), e per quale URL.
    pc.addEventListener('icecandidateerror', (e) => {
      // L'URL si tiene per intero, `?transport=` compreso: il ponte di
      // Cloudflare offre cinque indirizzi e sapere *quale* ha fallito è
      // metà della diagnosi.
      const chiave = `${e.errorCode || '?'} ${e.url || '?'}`
        + (e.errorText ? ' — ' + e.errorText : '');
      diag.errors.set(chiave, (diag.errors.get(chiave) || 0) + 1);
    });
    pc.addEventListener('icegatheringstatechange', () => segna('raccolta:' + pc.iceGatheringState));
    pc.addEventListener('iceconnectionstatechange', () => segna('ice:' + pc.iceConnectionState));
    pc.addEventListener('connectionstatechange', () => segna('conn:' + pc.connectionState));
    segna('avvio');
    return diag;
  }

  // Le coppie di candidati come le vede il browser: è lì che si legge se ICE ha
  // provato qualcosa e cosa ha risposto. Zero coppie con candidati da entrambe
  // le parti significa che nessuna combinazione era compatibile — il sintomo
  // delle due famiglie di indirizzi che non si incontrano.
  async function pairReport(pc) {
    const righe = [];
    try {
      const stats = await pc.getStats();
      const locali = new Map();
      const remoti = new Map();
      stats.forEach((x) => {
        if (x.type === 'local-candidate') locali.set(x.id, x);
        if (x.type === 'remote-candidate') remoti.set(x.id, x);
      });
      const conta = new Map();
      let scelta = null;
      stats.forEach((x) => {
        if (x.type !== 'candidate-pair') return;
        conta.set(x.state, (conta.get(x.state) || 0) + 1);
        if (x.nominated || x.selected) scelta = x;
      });
      const parti = [...conta].map(([st, n]) => `${st} ${n}`);
      righe.push('coppie: ' + (parti.join(' · ') || 'nessuna'));
      const descrivi = (c) => (c
        ? `${c.candidateType} ${c.address || '(nascosto)'}:${c.port}`
        : '?');
      if (scelta) {
        righe.push(`scelta: ${descrivi(locali.get(scelta.localCandidateId))}`
          + ` → ${descrivi(remoti.get(scelta.remoteCandidateId))}`);
      }
    } catch (err) {
      righe.push('coppie: non leggibili (' + (err.message || err) + ')');
    }
    return righe;
  }

  function RTCTransport(iceServers) {
    const servers = iceServers || ICE_SERVERS;
    const pc = new RTCPeerConnection({ iceServers: servers });
    const handlers = { message: null, state: null };
    const diag = makeDiag(pc, servers.length);
    let dc = null;
    let closed = false;
    let lastState = null;

    const setState = (s) => {
      if (closed && s !== 'closed') return;
      if (s === lastState) return;
      lastState = s;
      if (handlers.state) handlers.state(s);
    };

    function bindChannel(channel) {
      dc = channel;
      dc.onopen = () => setState('open');
      dc.onclose = () => setState('closed');
      dc.onmessage = (e) => {
        if (!handlers.message) return;
        try { handlers.message(JSON.parse(e.data)); } catch { /* messaggio illeggibile */ }
      };
    }

    pc.ondatachannel = (e) => bindChannel(e.channel);
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') setState('failed');
      else if (pc.connectionState === 'disconnected') setState('closed');
    };

    return {
      kind: 'rtc',
      onMessage(fn) { handlers.message = fn; },
      onStateChange(fn) { handlers.state = fn; setState('connecting'); },

      // Host: crea l'offerta e restituisce il codice di invito
      async createInvite(onProgress, needRelay) {
        bindChannel(pc.createDataChannel('sudoku', { ordered: true }));
        await pc.setLocalDescription(await pc.createOffer());
        await waitForIce(pc, { onProgress, needRelay });
        diag.gathered = candidateSummary(pc.localDescription.sdp);
        return pc.localDescription.sdp;
      },

      // Host: applica la risposta del guest e la connessione si apre.
      // Una risposta si applica una volta sola: dopo, lo stato è `stable` e un
      // secondo tentativo fallirebbe con un errore incomprensibile. Succede
      // facilmente, perché incollare avvia il collegamento da sé e chi preme
      // comunque «Collega» ne scatena un altro.
      async acceptAnswer(code) {
        if (pc.signalingState !== 'have-local-offer') return false;
        const sdp = decodeDesc(code);
        diag.received = candidateSummary(sdp);
        await pc.setRemoteDescription({ type: 'answer', sdp });
        return true;
      },

      // Guest: applica l'invito e restituisce l'SDP della risposta
      async joinWithInvite(code, onProgress, needRelay) {
        const sdp = decodeDesc(code);
        diag.received = candidateSummary(sdp);
        await pc.setRemoteDescription({ type: 'offer', sdp });
        await pc.setLocalDescription(await pc.createAnswer());
        await waitForIce(pc, { onProgress, needRelay });
        diag.gathered = candidateSummary(pc.localDescription.sdp);
        return pc.localDescription.sdp;
      },

      // Compatto o lungo sono due *scritture* dello stesso SDP: passare da una
      // all'altra non richiede di rinegoziare nulla, basta ricodificare.
      describe(useLong) {
        if (!pc.localDescription) return '';
        return encodeDesc(pc.localDescription.sdp, useLong);
      },

      // Che tipo di indirizzi contiene il nostro codice. Attenzione: quelli
      // *spediti*, non quelli raccolti. La differenza non è un dettaglio — il
      // taglio può ridurre dieci candidati dal ponte a quattro — e mostrare i
      // raccolti significava rassicurare («10 dal ponte») su indirizzi che
      // all'avversario non arrivavano.
      summary(useLong) {
        if (!pc.localDescription) return null;
        const s = candidateSummary(decodeDesc(encodeDesc(pc.localDescription.sdp, useLong)));
        diag.sent = s;
        return s;
      },

      // Che indirizzi ci ha mandato l'avversario. Il confronto con i nostri è
      // l'unica diagnosi possibile del caso «ponte attivo da entrambe le parti
      // e niente collegamento».
      peerSummary() { return diag.received; },

      // Il referto in chiaro, da copiare e mandare a chi guarda il codice.
      async report() {
        const righe = [];
        const s = (etichetta, sommario) => {
          if (sommario) righe.push(`${etichetta}: ${summaryDetail(sommario)}`);
        };
        righe.push(`server ICE: ${diag.servers}`);
        s('raccolti', diag.gathered || (pc.localDescription
          ? candidateSummary(pc.localDescription.sdp) : null));
        s('spediti', diag.sent);
        s('ricevuti', diag.received);
        if (diag.errors.size) {
          for (const [chiave, n] of diag.errors) {
            righe.push(`errore ICE ×${n}: ${chiave}`);
          }
        } else {
          righe.push('errori ICE: nessuno');
        }
        righe.push(...await pairReport(pc));
        righe.push('stati: ' + diag.states.map(([ms, e]) => `${(ms / 1000).toFixed(1)}s ${e}`).join(' → '));
        return righe;
      },

      send(msg) {
        if (closed || !dc || dc.readyState !== 'open') return;
        dc.send(JSON.stringify(msg));
      },

      close() {
        if (closed) return;
        closed = true;
        try { if (dc) dc.close(); } catch { /* ignora */ }
        try { pc.close(); } catch { /* ignora */ }
        setState('closed');
      },
    };
  }

  window.SudokuNet = {
    PROTO: 1,
    LocalTransport,
    RTCTransport,
    iceConfig,
    waitForIce,
    turnEndpoint,
    normalizeIceServers,
    encodeDesc,
    decodeDesc,
    summaryDetail,
    routableFamilies,
    extractCode,
    compactSdp,
    expandSdp,
    candidateSummary,
    supported: typeof RTCPeerConnection === 'function',
  };
})();
