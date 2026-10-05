// Enregistre en vidéo une démo de l'apitester : 10 utilisateurs virtuels envoient
// un document RTF en multipart à POST /test-convert du serveur de test pendant 30 s.
// Le scénario détaillé est décrit dans SCENARIO.md.
//
// Prérequis : ./start.sh lancé (app sur :4200, serveur de test sur :8888).
// Usage     : npm run record        (HEADED=1 npm run record pour suivre à l'écran)
import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_URL = process.env.APP_URL ?? 'http://localhost:4200';
const ECHO_URL = process.env.ECHO_URL ?? 'http://localhost:8888';
const HEADED = process.env.HEADED === '1';
const VUS = 10;
const DURATION_S = 30;
const VIEWPORT = { width: 1440, height: 900 };

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'output');
const STEPS_DIR = join(OUT, 'etapes');
const FIXTURE_NAME = 'rapport-annuel.rtf';
const FIXTURE = join(OUT, FIXTURE_NAME);
const VIDEO = join(OUT, 'demo-test-convert.webm');
const MP4 = join(OUT, 'demo-test-convert.mp4');

// ─── Prérequis ──────────────────────────────────────────────────────────────

async function checkPrerequisites() {
  const fail = (msg) => {
    console.error(`✗ ${msg}`);
    process.exit(1);
  };
  await fetch(APP_URL).catch(() => fail(`L'apitester ne répond pas sur ${APP_URL} : lancez ./start.sh.`));
  await fetch(`${ECHO_URL}/health`).catch(() =>
    fail(`Le serveur de test ne répond pas sur ${ECHO_URL} : lancez ./start.sh.`),
  );
  // Sans fichier, /test-convert répond 400 ; un 404 signale un serveur d'avant /test-convert.
  const probe = await fetch(`${ECHO_URL}/test-convert`, { method: 'POST' });
  if (probe.status === 404) {
    fail(`Le serveur de test ne connaît pas /test-convert : relancez ./start.sh.`);
  }
}

// ─── Document RTF à convertir ───────────────────────────────────────────────

/** Échappe un texte pour RTF : \ { } protégés, accents en \'hh (cp1252), le reste en \uN?. */
const rtf = (s) =>
  s
    .replace(/[\\{}]/g, (c) => `\\${c}`)
    .replace(/[^\x00-\x7f]/g, (c) => {
      const code = c.charCodeAt(0);
      return code < 256 ? `\\'${code.toString(16)}` : `\\u${code}?`;
    });

const SERVICES = ['Population', 'Urbanisme', 'Travaux', 'Enseignement', 'Culture', 'Sports', 'Finances', 'Informatique'];
const CHAPTERS = [
  ['Synthèse de l’année', 'L’année écoulée a été marquée par la poursuite des projets engagés et par une hausse sensible des demandes adressées aux services.'],
  ['Activités des services', 'Chaque service a maintenu un niveau de prestation élevé malgré des effectifs stables et des délais de traitement réduits.'],
  ['Finances', 'Le budget ordinaire présente un résultat équilibré ; les investissements ont été réalisés à hauteur de quatre-vingt-sept pour cent des prévisions.'],
  ['Ressources humaines', 'Le plan de formation a concerné la majorité des agents, avec un accent particulier sur les outils numériques et l’accueil du public.'],
  ['Projets numériques', 'La dématérialisation des démarches s’est étendue : les citoyens peuvent désormais introduire en ligne la plupart de leurs demandes.'],
  ['Environnement', 'Les actions en faveur de la transition énergétique ont permis de réduire la consommation des bâtiments publics.'],
  ['Perspectives', 'Les priorités de l’exercice suivant portent sur la simplification administrative, la sécurité de l’information et la qualité du service.'],
];

const FOLLOW_UPS = [
  'Les indicateurs détaillés ci-dessous comparent les réalisations aux objectifs fixés, service par service.',
  'Les écarts les plus significatifs font l’objet d’une analyse spécifique et d’un plan d’action concerté.',
  'Ces résultats ont été présentés au comité de direction et serviront de base à la planification pluriannuelle.',
];

/** Rapport annuel factice au format RTF (~250 Ko), lisible dans TextEdit ou Word. */
function writeFixture() {
  const out = [
    '{\\rtf1\\ansi\\ansicpg1252\\deff0',
    '{\\fonttbl{\\f0\\fswiss\\fcharset0 Helvetica;}{\\f1\\froman\\fcharset0 Times New Roman;}}',
    '{\\colortbl;\\red31\\green78\\blue121;\\red90\\green90\\blue90;}',
    `{\\info{\\title ${rtf('Rapport annuel 2025')}}{\\author ${rtf('Service communication')}}}`,
    '\\paperw11906\\paperh16838\\margl1134\\margr1134\\margt1134\\margb1134',
    `\\pard\\qc\\sa120\\f0\\fs44\\b\\cf1 ${rtf('Rapport annuel 2025')}\\b0\\cf0\\par`,
    `\\pard\\qc\\sa480\\f0\\fs24\\cf2 ${rtf('Administration communale — document de travail')}\\cf0\\par`,
  ];
  const row = (cells, bold = false) =>
    '\\trowd\\trgaph108\\trleft0\\cellx3400\\cellx5200\\cellx7000\\cellx9600' +
    `\\pard\\intbl\\f0\\fs20${bold ? '\\b' : ''} ${cells.map(rtf).join('\\cell ')}\\cell${bold ? '\\b0' : ''}\\row`;
  let section = 0;
  while (out.join('\n').length < 250_000) {
    for (const [title, intro] of CHAPTERS) {
      section++;
      out.push(`\\pard\\sb360\\sa120\\keepn\\f0\\fs30\\b\\cf1 ${section}. ${rtf(title)}\\b0\\cf0\\par`);
      for (const follow of FOLLOW_UPS) {
        out.push(`\\pard\\qj\\sa160\\f1\\fs22 ${rtf(`${intro} ${follow}`)}\\par`);
      }
      out.push(row(['Service', 'Budget (€)', 'Réalisé (€)', 'Écart'], true));
      SERVICES.forEach((name, i) => {
        const budget = 120_000 + ((section * 7919 + i * 104_729) % 380_000);
        const done = Math.round(budget * (0.82 + ((section + i) % 17) / 100));
        const gap = ((done - budget) / budget) * 100;
        const pct = gap.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
        out.push(row([name, budget.toLocaleString('fr-FR'), done.toLocaleString('fr-FR'), `${pct} %`]));
      });
      out.push('\\pard\\sa200\\par');
    }
  }
  out.push('}');
  writeFileSync(FIXTURE, out.join('\n'), 'latin1');
}

// ─── Aides visuelles injectées dans la page ─────────────────────────────────

const pause = (page, ms) => page.waitForTimeout(ms);
const fr = (n) => Math.round(n).toLocaleString('fr-FR');

/** Affiche (ou met à jour) le bandeau de légende, en bas de l'écran ou en haut (top). */
async function caption(page, title, text, { top = false } = {}) {
  await page.evaluate(
    ({ title, text, top }) => {
      let box = document.getElementById('demo-caption');
      if (!box) {
        box = document.createElement('div');
        box.id = 'demo-caption';
        Object.assign(box.style, {
          position: 'fixed',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 'min(1180px, calc(100% - 48px))',
          zIndex: '99999',
          padding: '14px 20px',
          borderRadius: '10px',
          borderLeft: '6px solid #f59e0b',
          background: 'rgba(2, 6, 23, 0.94)',
          boxShadow: '0 10px 30px rgba(0, 0, 0, 0.6)',
          color: '#e2e8f0',
          font: '16px/1.45 system-ui, -apple-system, sans-serif',
          pointerEvents: 'none',
        });
        document.body.appendChild(box);
      }
      Object.assign(box.style, top ? { top: '24px', bottom: '' } : { top: '', bottom: '24px' });
      box.innerHTML = '';
      const h = document.createElement('div');
      Object.assign(h.style, { fontWeight: '700', fontSize: '18px', color: '#fbbf24', marginBottom: '4px' });
      h.textContent = title;
      const p = document.createElement('div');
      p.style.whiteSpace = 'pre-line';
      p.textContent = text;
      box.append(h, p);
    },
    { title, text, top },
  );
}

/** Fait défiler jusqu'à l'élément et l'entoure (une seule mise en évidence à la fois). */
async function highlight(page, locator) {
  await page.evaluate(() => {
    document.querySelectorAll('[data-demo-hl]').forEach((el) => {
      el.style.outline = el.dataset.demoHl;
      el.style.outlineOffset = '';
      el.removeAttribute('data-demo-hl');
    });
  });
  if (!locator) return;
  await locator.evaluate((el) => {
    el.dataset.demoHl = el.style.outline || '';
    el.style.outline = '3px solid #f59e0b';
    el.style.outlineOffset = '4px';
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
  await pause(page, 700);
}

/**
 * Pose une bande verticale sur la seconde d'indice `index` du graphe et renvoie
 * le point (coordonnées page) où placer la souris pour afficher l'infobulle.
 * L'instance Chart.js est lue via les utilitaires `ng` du mode dev d'Angular ;
 * renvoie null s'ils sont indisponibles. index = null retire la bande.
 */
async function markSecond(page, index) {
  return page.evaluate((index) => {
    document.getElementById('demo-band')?.remove();
    const chart = window.ng?.getComponent?.(document.querySelector('app-chart-panel'))?.chart;
    if (index === null || !chart) return null;
    const x = chart.scales.x;
    const step = x.getPixelForValue(1) - x.getPixelForValue(0);
    const { top, bottom } = chart.chartArea;
    const band = document.createElement('div');
    band.id = 'demo-band';
    Object.assign(band.style, {
      position: 'absolute',
      left: `${x.getPixelForValue(index) - step / 2}px`,
      width: `${step}px`,
      top: `${top}px`,
      height: `${bottom - top}px`,
      background: 'rgba(245, 158, 11, 0.18)',
      borderLeft: '1px dashed #f59e0b',
      borderRight: '1px dashed #f59e0b',
      pointerEvents: 'none',
    });
    chart.canvas.parentElement.appendChild(band);
    const r = chart.canvas.getBoundingClientRect();
    return { x: r.left + x.getPixelForValue(index), y: r.top + top + (bottom - top) * 0.35 };
  }, index);
}

let stepNo = 0;
async function snapshot(page, name) {
  stepNo++;
  await page.screenshot({ path: join(STEPS_DIR, `${String(stepNo).padStart(2, '0')}-${name}.png`) });
}

// ─── Lecture des résultats ──────────────────────────────────────────────────

/** Les secondes du tableau « Stats détaillées » (un bucket par seconde, ordre du graphe). */
async function readBuckets(results) {
  const rows = await results
    .locator('table tbody tr')
    .evaluateAll((trs) => trs.map((tr) => [...tr.cells].map((td) => td.innerText.trim())));
  const n = (s) => Number(String(s).replace(/,/g, '')) || 0;
  return rows.map((c, index) => ({
    index,
    t: n(c[0]),
    req: n(c[1]),
    err: n(c[2]),
    avg: n(c[4]),
    p95: n(c[6]),
    p99: n(c[7]),
    max: n(c[9]),
    size: n(c[10]),
    vus: n(c[11]),
  }));
}

/** Choisit dans les données réelles les secondes qui illustrent les corrélations. */
function pickExamples(buckets, { refSize, minSize }) {
  const active = buckets.filter((b) => b.vus > 0 && b.req > 0);
  const reqs = active.map((b) => b.req).sort((a, b) => a - b);
  const medianReq = reqs[Math.floor(reqs.length / 2)];
  const byP95 = (a, b) => b.p95 - a.p95;

  // ① la seconde la plus lente parmi celles où peu d'appels se terminent
  const slow = active.filter((b) => b.req < medianReq).sort(byP95)[0] ?? [...active].sort(byP95)[0];

  // ② une seconde où P95 = P99 = Max (de préférence la même)
  const merged = slow.p95 === slow.max && slow.p99 === slow.max ? slow : active.find((b) => b.p95 === b.max && b.p99 === b.max);

  // ③ le creux de taille moyenne le plus marqué, expliqué par k réponses tronquées sur N
  let dip = null;
  const lowest = active.filter((b) => b.size > 0 && b.size < refSize * 0.99).sort((a, b) => a.size - b.size)[0];
  if (lowest) {
    const N = lowest.req - lowest.err;
    const k = Math.max(1, Math.round(((refSize - lowest.size) * N) / (refSize - minSize)));
    const exact = Math.abs(((N - k) * refSize + k * minSize) / N - lowest.size) < 2;
    dip = { ...lowest, N, k, exact };
  }
  return { slow, merged, dip, minReq: reqs[0], maxReq: reqs[reqs.length - 1] };
}

// ─── Scénario ───────────────────────────────────────────────────────────────

async function run(page) {
  const request = page.locator('app-request-config');
  const load = page.locator('app-load-config');
  const results = page.locator('app-results');
  const loadField = (label) => load.locator('label').filter({ hasText: label }).locator('input, select');

  await page.goto(APP_URL);
  await page.waitForLoadState('networkidle');

  // 0. Introduction
  await caption(
    page,
    'Démo — test de charge d’un service de conversion de documents',
    `${VUS} utilisateurs virtuels envoient en parallèle un document RTF (rapport annuel, ~250 Ko) à POST /test-convert ` +
      `pendant ${DURATION_S} s. Le serveur de test simule sa conversion (par exemple RTF → PDF) et renvoie le document : ` +
      '75 % en ~1 s, 10 % en 1,5–3 s, 5 % lents (~5 s), 5 % d’erreurs 5xx et 5 % tronqués (moitié de la taille).',
  );
  await pause(page, 8000);
  await snapshot(page, 'introduction');

  // 1. La requête : verbe et URL
  const verb = request.locator('select').first();
  const url = page.getByLabel('URL de la requête');
  await caption(page, '1. La requête', 'On choisit le verbe POST : le document est envoyé dans le corps de la requête.');
  await highlight(page, verb);
  await verb.selectOption('POST');
  await pause(page, 1500);
  await caption(page, '1. La requête', `Puis l’URL de la ressource de conversion du serveur de test : ${ECHO_URL}/test-convert`);
  await highlight(page, url);
  await url.fill('');
  await url.pressSequentially(`${ECHO_URL}/test-convert`, { delay: 45 });
  await pause(page, 1500);
  await snapshot(page, 'requete');

  // 2. Le document : Body → form-data → ligne de type Fichier
  const bodyTab = request.getByRole('button', { name: /^Body/ });
  await caption(page, '2. Le document à convertir', 'Onglet Body : c’est ici qu’on définit le contenu envoyé.');
  await highlight(page, bodyTab);
  await bodyTab.click();
  await pause(page, 1200);

  const formData = request.locator('label').filter({ hasText: /^\s*form-data\s*$/ });
  await caption(
    page,
    '2. Le document à convertir',
    'Type form-data : le corps part en multipart/form-data, le format d’un formulaire d’upload. Le navigateur fixe lui-même le boundary.',
  );
  await highlight(page, formData);
  await formData.click();
  await pause(page, 2000);

  const kv = request.locator('app-kv-table');
  const kvTable = kv.locator('table').locator('..');
  await caption(page, '2. Le document à convertir', 'On ajoute une ligne au formulaire…');
  const addRow = kv.getByRole('button', { name: '+ Ajouter une ligne' });
  await highlight(page, addRow);
  await addRow.click();
  await pause(page, 800);

  const row = kv.locator('tbody tr').first();
  await caption(
    page,
    '2. Le document à convertir',
    '…clé « file » (le nom du champ attendu par le serveur), puis type « Fichier » au lieu de « Texte ».',
  );
  await highlight(page, kvTable);
  await row.getByPlaceholder('clé').pressSequentially('file', { delay: 80 });
  await pause(page, 600);
  await row.locator('select').selectOption({ label: 'Fichier' });
  await pause(page, 1200);

  await caption(
    page,
    '2. Le document à convertir',
    `On sélectionne le document sur le disque : ${FIXTURE_NAME}. Son nom et sa taille s’affichent dans la ligne. ` +
      'Le même document sera envoyé à chaque appel.',
  );
  await row.locator('input[type=file]').setInputFiles(FIXTURE);
  await highlight(page, kvTable);
  await pause(page, 4500);
  await snapshot(page, 'document');

  // 3. Les paramètres du test de charge
  await caption(
    page,
    '3. Les paramètres du test de charge',
    `${VUS} utilisateurs virtuels (VUs) en parallèle, chacun enchaînant les appels sans pause, pendant ${DURATION_S} s.`,
  );
  await highlight(page, loadField('Virtual Users'));
  await loadField('Virtual Users').fill(String(VUS));
  await pause(page, 1500);
  await highlight(page, loadField('Durée (s)'));
  await loadField('Durée (s)').fill(String(DURATION_S));
  await pause(page, 1500);
  await caption(
    page,
    '3. Les paramètres du test de charge',
    'Mode de montée « Fixe » : les 10 VUs démarrent ensemble. « Ramp-up » et « Paliers » permettent une montée progressive.',
  );
  await highlight(page, loadField('Mode de montée'));
  await loadField('Mode de montée').selectOption('fixed');
  await pause(page, 3500);

  await caption(
    page,
    '3. Seuil d’incohérence de taille : 5 %',
    'La taille de référence est la médiane des 5 premières réponses correctes. Toute réponse correcte dont la taille ' +
      's’en écarte de plus de 5 % est signalée comme incohérente : c’est ce qui repérera les documents renvoyés tronqués.',
  );
  await highlight(page, loadField('Seuil incohérence taille (%)'));
  await pause(page, 7000);
  await snapshot(page, 'parametres');

  await caption(
    page,
    'Bon à savoir : 6 connexions par serveur',
    'Le navigateur n’ouvre que 6 connexions simultanées vers un même serveur HTTP/1.1. Avec 10 VUs, 4 appels attendent leur ' +
      'tour : ce temps d’attente est inclus dans les durées mesurées, qui seront donc plus longues que le délai du serveur.',
  );
  await highlight(page, loadField('Virtual Users'));
  await pause(page, 7500);

  // 4. Exécution : suivi en temps réel
  const startBtn = load.getByRole('button', { name: /Lancer le test/ });
  await caption(page, '4. Lancement du test', 'C’est parti !');
  await highlight(page, startBtn);
  await startBtn.click();
  await pause(page, 1200);
  await highlight(page, load.getByText(/En cours/));
  await caption(page, '4. Suivi en temps réel', 'La barre de progression indique le temps écoulé et le nombre de VUs actifs.');
  await pause(page, 2500);

  const chart = page.locator('app-chart-panel');
  await highlight(page, chart.locator(':scope > div'));
  await caption(
    page,
    '4. Suivi en temps réel — le graphe',
    'Rafraîchi chaque seconde ; chaque point = les appels terminés pendant cette seconde. ' +
      'Requêtes/min (bleu), erreurs/min (rouge), temps moyen (vert) et P95 (jaune).',
  );
  await snapshot(page, 'graphe-debut');
  await pause(page, 6000);
  await caption(
    page,
    '4. Suivi en temps réel — le graphe',
    'Les compteurs d’une seconde sont extrapolés à la minute : Erreurs/min = 60 signifie 1 erreur dans la seconde, 120 = 2 erreurs.',
  );
  await pause(page, 5000);

  const toggle = (label) => chart.locator('label').filter({ hasText: label }).locator('input[type=checkbox]');
  await caption(
    page,
    '4. Suivi en temps réel — courbes à la carte',
    'Chaque courbe s’active ou se désactive d’un clic. On ajoute ici le P99 et la durée max, puis la taille moyenne des réponses (violet).',
  );
  await toggle('P99 (ms)').check();
  await pause(page, 1500);
  await toggle('Max (ms)').check();
  await pause(page, 2500);
  await toggle('Taille moyenne (o)').check();
  await pause(page, 4500);
  await snapshot(page, 'graphe-en-cours');

  await caption(page, '4. Fin du test', 'Les 30 s sont écoulées : on attend la fin des derniers appels en cours…');
  await load.getByText('Terminé').waitFor({ timeout: 60_000 });
  await pause(page, 2500);
  await snapshot(page, 'graphe-fin');

  // 5. Lire le graphe : corrélations entre courbes, sur les données réelles du test
  const cards = results.locator('div.grid').first().locator(':scope > div');
  // « Taille réponse\nréf 239,906 o\nmin … » → « Taille réponse : réf 239,906 o · min … »
  const cardText = async (i) => {
    const [label, ...values] = (await cards.nth(i).innerText()).split('\n').map((l) => l.trim()).filter(Boolean);
    return `${label} : ${values.join(' · ')}`;
  };
  const num = (s, re) => Number((s.match(re) ?? [, '0'])[1].replace(/,/g, ''));
  const sizeCard = await cardText(5);
  const refSize = num(sizeCard, /réf ([\d,]+)/);
  const minSize = num(sizeCard, /min ([\d,]+)/);
  const avgRpm = num(await cardText(2), /([\d,]+)/);
  const ex = pickExamples(await readBuckets(results), { refSize, minSize });

  const explain = async (bucket, title, text, name) => {
    await highlight(page, chart.locator(':scope > div'));
    const point = await markSecond(page, bucket.index);
    if (point) await page.mouse.move(point.x, point.y, { steps: 20 });
    await caption(page, title, text, { top: true });
    await pause(page, 1000);
    await snapshot(page, name);
    await pause(page, 9500);
  };

  const s = ex.slow;
  await explain(
    s,
    '5. Lire le graphe ① — temps haut, débit bas',
    `À t = ${s.t} s, ${s.p95 >= 4000 ? 'des conversions lentes (~5 s) se terminent' : 'des conversions plus longues se terminent'} : ` +
      `P95 = ${fr(s.p95)} ms, temps moyen = ${fr(s.avg)} ms… mais seulement ${s.req} réponse${s.req > 1 ? 's' : ''} dans la seconde ` +
      `(${fr(s.req * 60)} req/min, contre ${fr(avgRpm)} en moyenne).\n` +
      'Pourquoi : chaque VU attend sa réponse avant d’envoyer le document suivant ; occupés par des conversions lentes, ' +
      'les VUs terminent moins d’appels : le débit baisse pendant que les temps montent.',
    'correlation-1-temps-debit',
  );

  if (ex.merged) {
    const m = ex.merged;
    await explain(
      m,
      '5. Lire le graphe ② — P95, P99 et Max confondus',
      `À t = ${m.t} s : P95 = P99 = Max = ${fr(m.max)} ms ; les courbes jaune, orange et grise se superposent.\n` +
        `Pourquoi : une seconde ne compte que ${ex.minReq} à ${ex.maxReq} réponses ; son P95 et son P99 sont donc simplement ` +
        'la réponse la plus lente de la seconde. Les percentiles des cartes, eux, portent sur tous les appels du test.',
      'correlation-2-percentiles',
    );
  }

  if (ex.dip) {
    const d = ex.dip;
    const detail = d.exact
      ? ` : ${d.k} document${d.k > 1 ? 's' : ''} tronqué${d.k > 1 ? 's' : ''} parmi ${d.N} réponses ` +
        `((${d.N - d.k} × ${fr(refSize)} + ${d.k} × ${fr(minSize)}) / ${d.N})`
      : ', au lieu de la référence de ' + `${fr(refSize)} o`;
    await explain(
      d,
      '5. Lire le graphe ③ — creux de taille, sans effet sur les temps',
      `À t = ${d.t} s, la taille moyenne tombe à ${fr(d.size)} o${detail}.\n` +
        'Pourquoi : le document tronqué arrive en ~1 s, comme une réponse normale : il ne fait pas monter les temps. ' +
        'Et moins il y a de réponses dans la seconde, plus le creux est profond.',
      'correlation-3-taille',
    );
  }
  await markSecond(page, null);
  await page.mouse.move(5, 5);

  // 6. Résultats : les cartes de synthèse
  const cardCaptions = [
    ['Requêtes', 'Nombre total d’appels envoyés pendant le test, tous résultats confondus.'],
    ['Taux d’erreur', 'Part des appels en erreur (réponse 4xx/5xx, timeout ou erreur réseau), et leur nombre.'],
    ['Débit', 'Nombre moyen d’appels traités par minute.'],
    [
      'Temps de réponse',
      'Durée moyenne, minimale et maximale d’un appel, mesurée par le navigateur. Elle inclut l’attente d’une connexion ' +
        'libre (limite de 6) : la moyenne dépasse donc le délai du serveur (~1 s). Le max correspond aux appels lents.',
    ],
    ['Percentiles', 'P50 : la moitié des appels a duré moins que cette valeur. P95 / P99 : seuls 5 % / 1 % des appels ont été plus lents.'],
    [
      'Taille des réponses',
      'Taille de référence, taille min et max des réponses correctes, et nombre de réponses incohérentes : la carte passe en rouge. ' +
        'Le min vaut la moitié de la référence : ce sont les documents tronqués.',
    ],
  ];
  for (let i = 0; i < cardCaptions.length; i++) {
    const [title, text] = cardCaptions[i];
    await highlight(page, cards.nth(i));
    await caption(page, `6. Résultats — ${title}`, `${await cardText(i)}\n→ ${text}`);
    await pause(page, 6000);
  }
  await snapshot(page, 'resultats');

  // 7. Détail des erreurs
  // Le tableau de l'onglet actif, dans son conteneur à bordure (qui le rognerait).
  const tabTable = () => results.locator('table').last().locator('..');
  const errorsTab = results.getByRole('button', { name: /^Log erreurs/ });
  await caption(page, '7. Détail des erreurs', 'L’onglet « Log erreurs » liste chaque appel en erreur.', { top: true });
  await highlight(page, errorsTab);
  await errorsTab.click();
  await pause(page, 1000);
  await highlight(page, tabTable());
  await caption(
    page,
    '7. Détail des erreurs',
    'Pour chaque erreur : l’heure, le VU, le code HTTP (500, 502, 503), la durée et le message renvoyé par le serveur. ' +
      'Le bouton « Export CSV (erreurs) » permet de les analyser à part.',
    { top: true },
  );
  await pause(page, 8000);
  await snapshot(page, 'erreurs');

  // 8. Incohérences de taille
  const anomaliesTab = results.getByRole('button', { name: /^Incohérences taille/ });
  await caption(
    page,
    '8. Incohérences de taille',
    'L’onglet « Incohérences taille » liste les réponses correctes (HTTP 200) dont la taille est suspecte.',
    { top: true },
  );
  await highlight(page, anomaliesTab);
  await anomaliesTab.click();
  await pause(page, 1000);
  await highlight(page, tabTable());
  await caption(
    page,
    '8. Incohérences de taille',
    'Ici, le document reçu ne fait que la moitié de la taille de référence (écart ≈ −50 %, bien au-delà du seuil de 5 %) : ' +
      'le serveur a répondu 200, mais le contenu est tronqué. Une erreur que le code HTTP seul ne révèle pas.',
    { top: true },
  );
  await pause(page, 9000);
  await snapshot(page, 'incoherences');

  // 9. Conclusion
  await highlight(page, results.getByRole('button', { name: /Export JSON/ }).locator('..'));
  await caption(
    page,
    'Fin de la démo',
    'Les résultats s’exportent en JSON brut ou en CSV (stats par seconde, erreurs, incohérences) pour être archivés ou analysés.',
    { top: true },
  );
  await pause(page, 6000);
  await highlight(page, null);

  return {
    summary: {
      requests: await cardText(0),
      errors: await cardText(1),
      durations: await cardText(3),
      percentiles: await cardText(4),
      sizes: sizeCard,
    },
    examples: ex,
  };
}

// ─── Enregistrement ─────────────────────────────────────────────────────────

await checkPrerequisites();
rmSync(STEPS_DIR, { recursive: true, force: true });
mkdirSync(STEPS_DIR, { recursive: true });
writeFixture();

const browser = await chromium.launch({ channel: 'chrome', headless: !HEADED });
const context = await browser.newContext({ viewport: VIEWPORT, recordVideo: { dir: OUT, size: VIEWPORT } });
const page = await context.newPage();
const video = page.video();

let result;
try {
  result = await run(page);
} finally {
  // La vidéo est finalisée à la fermeture du contexte et doit être copiée
  // avant la fermeture du navigateur.
  await context.close();
  await video.saveAs(VIDEO);
  await video.delete();
  await browser.close();
}

const { summary, examples } = result;
console.log('Résumé du test filmé :');
for (const [k, v] of Object.entries(summary)) console.log(`  ${k.padEnd(12)} ${v}`);
const show = (b) => (b ? `t=${b.t}s req=${b.req} err=${b.err} moy=${b.avg} p95=${b.p95} p99=${b.p99} max=${b.max} taille=${b.size}` : '—');
console.log('Exemples de corrélation :');
console.log(`  ① temps/débit   ${show(examples.slow)}`);
console.log(`  ② percentiles   ${show(examples.merged)}`);
console.log(`  ③ taille        ${show(examples.dip)}${examples.dip ? ` (k=${examples.dip.k}/N=${examples.dip.N}, exact=${examples.dip.exact})` : ''}`);
console.log(`\n✓ Vidéo : ${VIDEO}`);
console.log(`✓ Captures des étapes : ${STEPS_DIR}`);

if (spawnSync('ffmpeg', ['-version']).status === 0) {
  const r = spawnSync(
    'ffmpeg',
    ['-y', '-loglevel', 'error', '-i', VIDEO, '-r', '25', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '22', '-movflags', '+faststart', MP4],
    { stdio: 'inherit' },
  );
  console.log(r.status === 0 ? `✓ Vidéo MP4 : ${MP4}` : '✗ Échec de la conversion MP4.');
} else {
  console.log('ℹ ffmpeg absent : pas de MP4. Installez-le (brew install ffmpeg) puis :');
  console.log(`  ffmpeg -i "${VIDEO}" -r 25 -c:v libx264 -pix_fmt yuv420p -movflags +faststart "${MP4}"`);
}

// Contrôle : la démo doit montrer des requêtes, des erreurs et des incohérences.
const count = (s, re = /([\d,]+)/) => Number((s.match(re) ?? [, '0'])[1].replace(/,/g, ''));
const errors = count(summary.errors, /([\d,]+)\s*erreurs/);
const anomalies = count(summary.sizes, /([\d,]+)\s*incohérence/);
if (count(summary.requests) === 0 || errors === 0 || anomalies === 0) {
  console.error('✗ Le test filmé ne montre pas de requêtes, d’erreurs ou d’incohérences : relancez l’enregistrement.');
  process.exit(1);
}
