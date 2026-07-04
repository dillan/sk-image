// Seeds the running SK Image plugin with synthetic (scrubbed) sample images + collections so the
// documentation screenshots have realistic content. Generates images with sharp and uploads them
// over the plugin's HTTP API. Node 18+ (global fetch/FormData/Blob). Idempotent: skips if seeded.
import sharp from 'sharp';

const BASE = process.env.SIGNALK_URL || 'http://localhost:3000';
const API = `${BASE}/plugins/sk-image`;

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function diagramSvg(title, subtitle, accent = '#2e9bff') {
  const v = (n, f) => Array.from({ length: n }, (_, i) => f(i)).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800">
    <rect width="1200" height="800" fill="#0e1720"/>
    <g stroke="#1c2a38" stroke-width="1">
      ${v(24, (i) => `<line x1="${i * 50}" y1="0" x2="${i * 50}" y2="800"/>`)}
      ${v(16, (i) => `<line x1="0" y1="${i * 50}" x2="1200" y2="${i * 50}"/>`)}
    </g>
    <rect x="60" y="60" width="1080" height="620" fill="none" stroke="${accent}" stroke-width="3" rx="10"/>
    <circle cx="300" cy="300" r="80" fill="none" stroke="#6cbaff" stroke-width="4"/>
    <path d="M300 210 L520 300 L300 390 Z" fill="none" stroke="#f4bf2d" stroke-width="4"/>
    <rect x="640" y="230" width="360" height="240" fill="none" stroke="${accent}" stroke-width="4" rx="8"/>
    <text x="90" y="720" fill="#e8edf2" font-family="system-ui, sans-serif" font-size="46" font-weight="700">${esc(title)}</text>
    <text x="90" y="760" fill="#8593a1" font-family="system-ui, sans-serif" font-size="24">${esc(subtitle)}</text>
  </svg>`;
}

function photoSvg(title) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1067">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#20516f"/><stop offset="0.6" stop-color="#0d2a3d"/><stop offset="1" stop-color="#07131d"/>
    </linearGradient></defs>
    <rect width="1600" height="1067" fill="url(#g)"/>
    <circle cx="1250" cy="230" r="120" fill="#f4d06b" opacity="0.85"/>
    <path d="M0 760 Q400 700 800 760 T1600 760 V1067 H0 Z" fill="#08161f" opacity="0.7"/>
    <path d="M0 840 Q500 790 1000 840 T1600 840 V1067 H0 Z" fill="#050e15" opacity="0.85"/>
    <text x="60" y="1000" fill="#e8edf2" font-family="system-ui, sans-serif" font-size="52" font-weight="700">${esc(title)}</text>
  </svg>`;
}

const png = (svg) => sharp(Buffer.from(svg)).png().toBuffer();
const jpegWithExif = (svg, { make, model, date }) =>
  sharp(Buffer.from(svg))
    .withExif({ IFD0: { Make: make, Model: model }, ExifIFD: { DateTimeOriginal: date } })
    .jpeg({ quality: 82 })
    .toBuffer();

async function upload(name, buffer, type) {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type }), name);
  const res = await fetch(`${API}/images`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`upload ${name} -> ${res.status} ${await res.text()}`);
  return res.json();
}
async function createCollection(name) {
  const res = await fetch(`${API}/collections`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`collection ${name} -> ${res.status}`);
  return res.json();
}
const addTo = (cid, iid) => fetch(`${API}/collections/${cid}/images/${iid}`, { method: 'POST' });

async function main() {
  const existing = await (await fetch(`${API}/images`)).json();
  if (Array.isArray(existing) && existing.length > 0) {
    console.log(`already seeded (${existing.length} images) — skipping`);
    return;
  }

  const deckPlan = await upload(
    'deck-plan.png',
    await png(diagramSvg('Deck plan', 'Cleats, winches, jammers — Test Vessel')),
    'image/png',
  );
  const sailPlan = await upload(
    'sail-plan.png',
    await png(diagramSvg('Sail plan', 'Main + headsail reefing points', '#6cbaff')),
    'image/png',
  );
  const safety = await upload(
    'safety-equipment.png',
    await png(diagramSvg('Safety equipment', 'Life raft, EPIRB, flares, fire ports', '#ff9f0a')),
    'image/png',
  );
  const electrical = await upload(
    'electrical-panel.png',
    await png(diagramSvg('Electrical panel', 'DC distribution + battery banks', '#34c759')),
    'image/png',
  );

  const anchorage = await upload(
    'anchorage.jpg',
    await jpegWithExif(photoSvg('Anchorage (synthetic)'), {
      make: 'Boaty',
      model: 'DeckCam 4K',
      date: '2024:07:12 18:32:04',
    }),
    'image/jpeg',
  );
  const engineRoom = await upload(
    'engine-room.jpg',
    await jpegWithExif(photoSvg('Engine room'), {
      make: 'Boaty',
      model: 'EngineCam',
      date: '2024:06:03 09:14:20',
    }),
    'image/jpeg',
  );
  const galley = await upload(
    'galley.jpg',
    await jpegWithExif(photoSvg('Galley'), {
      make: 'Boaty',
      model: 'CabinCam',
      date: '2024:05:20 12:02:41',
    }),
    'image/jpeg',
  );

  const deck = await createCollection('Deck & rigging');
  await addTo(deck.id, deckPlan.id);
  await addTo(deck.id, sailPlan.id);
  const safetyCol = await createCollection('Safety');
  await addTo(safetyCol.id, safety.id);
  await addTo(safetyCol.id, electrical.id);
  const photos = await createCollection('Reference photos');
  await addTo(photos.id, anchorage.id);
  await addTo(photos.id, engineRoom.id);
  await addTo(photos.id, galley.id);

  console.log('seeded 7 images + 3 collections');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
