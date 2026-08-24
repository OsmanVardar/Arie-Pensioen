import { CONFIG, BERICHTEN } from './_data.js';

const NTFY = 'https://ntfy.sh';

export default async function handler(req, res) {
  // ---- toegang -----------------------------------------------------------
  // Vercel Cron stuurt zelf "Authorization: Bearer <CRON_SECRET>" mee zodra de
  // env-variabele CRON_SECRET bestaat. Een externe cron mag ?secret=... gebruiken.
  const geheim = process.env.CRON_SECRET;
  const params = new URL(req.url, 'http://x').searchParams;

  if (geheim) {
    const viaHeader = req.headers.authorization === `Bearer ${geheim}`;
    const viaQuery = params.get('secret') === geheim;
    if (!viaHeader && !viaQuery) {
      res.status(401).json({ fout: 'geen toegang' });
      return;
    }
  }

  const droog = params.get('droog') === '1';
  const tijdzone = CONFIG.tijdzone || 'Europe/Amsterdam';
  const nummer = (process.env.ARIE_TELEFOON || CONFIG.telefoon || '').replace(/[^0-9]/g, '');
  const topic = process.env.NTFY_TOPIC || CONFIG.ntfyTopic;

  if (!topic) {
    res.status(500).json({ fout: 'geen ntfy-topic ingesteld' });
    return;
  }

  // ---- welke dag is het ---------------------------------------------------
  const vandaag = new Intl.DateTimeFormat('en-CA', {
    timeZone: tijdzone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());

  const dagen = Math.round(
    (Date.parse(CONFIG.pensioendatum + 'T12:00:00Z') - Date.parse(vandaag + 'T12:00:00Z')) / 86400000
  );

  // het aftellen kan later beginnen dan het eerste bericht
  const overslaanTot = params.get('dag') !== null ? null : CONFIG.startDag;
  const doelDag = params.get('dag') !== null ? Number(params.get('dag')) : dagen;

  if (overslaanTot !== null && dagen > overslaanTot) {
    res.status(200).json({
      verstuurd: false,
      reden: `aftellen begint op ${CONFIG.startdatum} (dag ${CONFIG.startDag})`,
      datum: vandaag, dagen,
    });
    return;
  }

  const bericht = BERICHTEN.find((b) => b.dag === doelDag);
  if (!bericht) {
    res.status(200).json({ verstuurd: false, reden: 'geen bericht voor deze dag', datum: vandaag, dagen: doelDag });
    return;
  }

  // het introblok hoort alleen bij het allereerste bericht dat verstuurd wordt
  const tekst = CONFIG.introTekst && bericht.dag === CONFIG.startDag
    ? CONFIG.introTekst
    : bericht.tekst;

  // ---- links en titel ----------------------------------------------------
  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const siteUrl = CONFIG.siteUrl || `${proto}://${host}/${CONFIG.slug}/`;
  const waUrl = `https://wa.me/${nummer}?text=${encodeURIComponent(tekst)}`;

  let titel;
  if (bericht.dag === 0) {
    titel = `${CONFIG.naam} is vandaag met pensioen`;
  } else {
    titel = `Nog ${bericht.dag} ${bericht.dag === 1 ? 'dag' : 'dagen'}`;
    if (typeof bericht.dienstenTeGaan === 'number') {
      titel += ` en ${bericht.dienstenTeGaan} ${bericht.dienstenTeGaan === 1 ? 'dienst' : 'diensten'}`;
    }
    titel += ` - bericht voor ${CONFIG.naam}`;
  }

  const tags = ['calendar'];
  if (bericht.mijlpalen?.length) tags.push('star');

  const payload = {
    topic,
    title: titel,
    message: tekst,
    priority: 4,
    tags,
    click: siteUrl,
    actions: [
      { action: 'view', label: 'Openen in WhatsApp', url: waUrl, clear: true },
      { action: 'view', label: 'Site openen', url: siteUrl },
    ],
  };

  if (droog) {
    res.status(200).json({ verstuurd: false, droog: true, dagen: bericht.dag, titel, payload });
    return;
  }

  // ---- pushen ------------------------------------------------------------
  try {
    const antwoord = await fetch(NTFY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!antwoord.ok) {
      const body = await antwoord.text();
      res.status(502).json({ verstuurd: false, status: antwoord.status, body: body.slice(0, 500) });
      return;
    }

    res.status(200).json({
      verstuurd: true, dagen: bericht.dag, datum: vandaag, titel,
      dienst: bericht.dienst ?? null, mijlpalen: bericht.mijlpalen ?? [],
    });
  } catch (e) {
    res.status(502).json({ verstuurd: false, fout: String(e) });
  }
}
