/* ============================================================
   Sudoku — configurazione
   Unico file da modificare per attivare il ponte (TURN).
   ============================================================ */

window.SUDOKU_CONFIG = {
  // Indirizzo del Worker che conia le credenziali TURN a scadenza.
  // Vuoto = nessun ponte: il gioco funziona come prima, peer-to-peer puro.
  // Vedi turn-worker/README.md per il ritaglia-e-incolla del deploy.
  //
  turnEndpoint: 'https://sudoku1v1.lui-consulting.workers.dev',
};
