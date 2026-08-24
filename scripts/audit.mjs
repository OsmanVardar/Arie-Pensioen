// Zoekt berichten die uitgaan van een kantoorbaan of een maandag-t/m-vrijdagritme.
// Handig bij ploegendienst: die aannames kloppen dan niet.
//
//   node scripts/audit.mjs           -> samenvatting per categorie
//   node scripts/audit.mjs --lijst   -> ook per bericht welke woorden erin zitten

import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const detail = process.argv.includes('--lijst');

const CATEGORIEEN = {
  'weekdagritme': /\b(vrijdagmiddag|vrijdagen|vrijdag|maandagochtend|maandagen|maandag|zaterdag|zondagmiddag|zondagen|zondag|weekend|werkweek|werkdag|werkdagen|doordeweekse)\b/gi,
  'kantoorbaan': /\b(kantoor|kantoormedewerker|printer|Excel|vergadering|vergaderingen|overleg|mailtjes|mails?|Postvak|bureaula|bureau|wachtwoord|laptop|functioneringsgesprek|sparren|agenda|salarisstrook|collega|collega's|overdracht|koffieautomaat)\b/gi,
  'wekker': /\b(wekker|uitslapen|opstaan)\b/gi,
  'seizoen of feestdag': /\b(Sinterklaas|pakjesavond|kerst|kerstavond|kerstdag|oudjaar|jaarwisseling|Pasen|Paasdag|carnaval|carnavalszondag|Koningsdag|Halloween|advent|Driekoningen|Valentijnsdag|zomertijd|wintertijd|Aswoensdag|Blue Monday|Dierendag|Thanksgiving|Black Friday)\b/gi,
};

const KOP = /^###\s+(\d+)\s*\|\s*(\d{4}-\d{2}-\d{2})\s*$/;

const berichten = [];
for (const bestand of readdirSync(join(root, 'content')).filter((f) => f.endsWith('.md')).sort()) {
  let huidig = null;
  for (const regel of readFileSync(join(root, 'content', bestand), 'utf8').split(/\r?\n/)) {
    const kop = regel.match(KOP);
    if (kop) {
      if (huidig) berichten.push(huidig);
      huidig = { dag: Number(kop[1]), datum: kop[2], bestand, regels: [] };
    } else if (huidig) huidig.regels.push(regel);
  }
  if (huidig) berichten.push(huidig);
}
berichten.sort((a, b) => b.dag - a.dag);

const totalen = {};
const geraakt = new Set();

for (const b of berichten) {
  const tekst = b.regels.join('\n');
  b.treffers = {};
  for (const [cat, regex] of Object.entries(CATEGORIEEN)) {
    const woorden = [...new Set((tekst.match(regex) || []).map((w) => w.toLowerCase()))];
    if (woorden.length) {
      b.treffers[cat] = woorden;
      totalen[cat] = (totalen[cat] || 0) + 1;
      if (cat !== 'seizoen of feestdag') geraakt.add(b.dag);
    }
  }
}

console.log(`\n${berichten.length} berichten gescand.\n`);
for (const [cat, aantal] of Object.entries(totalen).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(aantal).padStart(3)}  ${cat}`);
}
console.log(`\n  ${String(geraakt.size).padStart(3)}  berichten raken minstens één werkritme-aanname`);
console.log(`  ${String(berichten.length - geraakt.size).padStart(3)}  berichten zijn ritme-neutraal\n`);

if (detail) {
  console.log('Per bericht:\n');
  for (const b of berichten) {
    const cats = Object.entries(b.treffers).filter(([c]) => c !== 'seizoen of feestdag');
    if (!cats.length) continue;
    console.log(`  dag ${String(b.dag).padStart(3)} (${b.datum})  ` +
      cats.map(([c, w]) => `${c}: ${w.join(', ')}`).join('  |  '));
  }
  console.log('');
}

// zwaarste gevallen: waar het weekdagritme de kern van de grap is
const kern = berichten.filter((b) => {
  const t = b.regels.join(' ').toLowerCase();
  return /\b(en het is vrijdag|nog \w+ vrijdagen|laatste vrijdag|vrijdagmiddag|maandagochtend|nog \w+ maandagen|laatste maandag|het is zaterdag|laatste zondag|nog \w+ zondagen)\b/.test(t);
});
console.log(`Zwaarste gevallen (weekdag is de kern van de grap): ${kern.length}`);
console.log('  dagen: ' + kern.map((b) => b.dag).join(', ') + '\n');
