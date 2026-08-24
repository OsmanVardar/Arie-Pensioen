// Test de dagelijkse push zonder Vercel.
//
//   node scripts/testpush.mjs            -> droogloop, verstuurt niets, laat alleen zien wat er zou gebeuren
//   node scripts/testpush.mjs --echt     -> verstuurt de push van vandaag echt naar ntfy
//   node scripts/testpush.mjs --dag 42   -> doet alsof het dag 42 is (werkt met beide varianten)

import handler from '../api/cron.js';

const args = process.argv.slice(2);
const echt = args.includes('--echt');
const dagIndex = args.indexOf('--dag');
const forceerDag = dagIndex !== -1 ? Number(args[dagIndex + 1]) : null;

const origFetch = globalThis.fetch;

if (!echt) {
  globalThis.fetch = async (url, opties) => {
    const body = JSON.parse(opties.body);
    console.log('\n--- zou POSTen naar ' + url + ' ---\n');
    console.log('topic  :', body.topic);
    console.log('titel  :', body.title);
    console.log('click  :', body.click);
    for (const a of body.actions) console.log('actie  :', a.label, '->', a.url.slice(0, 110) + (a.url.length > 110 ? '…' : ''));
    console.log('\nbericht:\n' + body.message + '\n');
    return { ok: true, status: 200, text: async () => 'ok' };
  };
}

if (forceerDag !== null) {
  // datum terugrekenen zodat de handler denkt dat het die dag is
  const { CONFIG } = await import('../api/_data.js');
  const doel = new Date(Date.parse(CONFIG.pensioendatum + 'T12:00:00Z') - forceerDag * 86400000);
  const EchtDate = Date;
  globalThis.Date = class extends EchtDate {
    constructor(...a) { return a.length ? new EchtDate(...a) : new EchtDate(doel); }
    static now() { return doel.getTime(); }
    static parse(s) { return EchtDate.parse(s); }
  };
}

const req = { headers: { host: 'localhost:3000', 'x-forwarded-proto': 'http' }, url: '/api/cron' };
const res = {
  status(code) { this._code = code; return this; },
  json(data) { console.log('antwoord ' + this._code + ':', JSON.stringify(data)); },
};

delete process.env.CRON_SECRET;
await handler(req, res);

globalThis.fetch = origFetch;
if (!echt) console.log('\n(droogloop - er is niets verstuurd. Gebruik --echt om het wel te doen.)\n');
