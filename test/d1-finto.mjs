/* Un D1 finto, ma con dentro SQLite vero (`node:sqlite`): così le prove dello
   scambio eseguono le stesse query che girano su Cloudflare, invece di una
   loro imitazione. L'interfaccia è quella che usa il Worker, non tutta quella
   di D1: se un giorno servisse altro, il Worker fallirà qui prima che sul
   campo. */
// `node:sqlite` è ancora dichiarato sperimentale e lo annuncia a ogni avvio.
// L'avviso non riguarda il progetto — qui SQLite serve solo alle prove — e in
// mezzo al referto delle prove è solo rumore.
const avvisa = process.emitWarning;
process.emitWarning = (w, ...resto) => {
  if (String(w).includes('SQLite is an experimental')) return;
  avvisa.call(process, w, ...resto);
};

const { DatabaseSync } = await import('node:sqlite');

export function creaD1() {
  const db = new DatabaseSync(':memory:');
  return {
    async exec(sql) { db.exec(sql); },
    prepare(sql) {
      const stmt = db.prepare(sql);
      let args = [];
      const api = {
        bind(...a) { args = a; return api; },
        async run() { return { success: true, ...stmt.run(...args) }; },
        async first() { return stmt.get(...args) ?? null; },
        async all() { return { results: stmt.all(...args) }; },
      };
      return api;
    },
  };
}
