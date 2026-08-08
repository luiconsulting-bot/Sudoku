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
      const c = [type, m[4], Number(m[5]), Number(m[3])];
      if (m[7]) c.push(m[7], Number(m[8]));
      cands.push(c);
    }
    if (cands.length === 0) return null; // senza candidati il codice è inservibile

    return [1, ufrag, pwd, fp.replace(/:/g, ''), setupIdx, cands];
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
      let l = `a=candidate:${i + 1} 1 udp ${prio} ${ip} ${port} typ ${CAND_IN[type] || 'host'}`;
      if (raddr) l += ` raddr ${raddr} rport ${rport}`;
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

  // Quali candidati contiene un SDP. Serve a sapere *prima* di condividere un
  // codice se quel codice ha qualche speranza di funzionare fuori dalla LAN.
  function candidateSummary(sdp) {
    const out = { host: 0, srflx: 0, prflx: 0, relay: 0, mdns: 0 };
    const re = /^a=candidate:\S+ (\d+) udp \d+ (\S+) \d+ typ (\w+)/gim;
    let m;
    while ((m = re.exec(sdp)) !== null) {
      if (m[1] !== '1') continue;
      const type = m[3].toLowerCase();
      if (type in out) out[type]++;
      if (/\.local$/i.test(m[2])) out.mdns++;
    }
    // Un candidato "raggiungibile da fuori" è ciò che permette a due dispositivi
    // su reti diverse di trovarsi. Gli host (e ancor più quelli mDNS `.local`)
    // valgono solo dentro la stessa rete.
    out.routable = out.srflx + out.relay + out.prflx;
    return out;
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
  function waitForIce(pc, opts = {}) {
    const maxMs = opts.maxMs || 10000;
    const graceMs = opts.graceMs || 500;
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
        if (type === 'srflx' || type === 'relay') {
          // Abbiamo un indirizzo raggiungibile da fuori: un attimo per
          // raccoglierne altri e poi basta, senza aspettare il tetto.
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

  function RTCTransport() {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const handlers = { message: null, state: null };
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
      async createInvite(onProgress) {
        bindChannel(pc.createDataChannel('sudoku', { ordered: true }));
        await pc.setLocalDescription(await pc.createOffer());
        await waitForIce(pc, { onProgress });
        return pc.localDescription.sdp;
      },

      // Host: applica la risposta del guest e la connessione si apre
      async acceptAnswer(code) {
        await pc.setRemoteDescription({ type: 'answer', sdp: decodeDesc(code) });
      },

      // Guest: applica l'invito e restituisce l'SDP della risposta
      async joinWithInvite(code, onProgress) {
        await pc.setRemoteDescription({ type: 'offer', sdp: decodeDesc(code) });
        await pc.setLocalDescription(await pc.createAnswer());
        await waitForIce(pc, { onProgress });
        return pc.localDescription.sdp;
      },

      // Compatto o lungo sono due *scritture* dello stesso SDP: passare da una
      // all'altra non richiede di rinegoziare nulla, basta ricodificare.
      describe(useLong) {
        if (!pc.localDescription) return '';
        return encodeDesc(pc.localDescription.sdp, useLong);
      },

      // Che tipo di indirizzi contiene il nostro codice
      summary() {
        return pc.localDescription ? candidateSummary(pc.localDescription.sdp) : null;
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
    encodeDesc,
    decodeDesc,
    extractCode,
    compactSdp,
    expandSdp,
    candidateSummary,
    supported: typeof RTCPeerConnection === 'function',
  };
})();
