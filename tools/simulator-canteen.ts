/**
 * Canteen density simulator.
 * Pushes occupied counts per zone so the heatmap pulses realtime.
 *
 * Usage: pnpm sim:canteen
 */
const API = process.env.API_URL ?? 'http://localhost:4000';
const TOKEN = process.env.INGEST_SERVICE_TOKEN ?? 'dev-ingest-token-change-me';

const ZONES = [
  { code: 'Z-COUNTER', capacity: 8 },
  { code: 'Z-PICKUP', capacity: 15 },
  { code: 'Z-DRINK', capacity: 10 },
  { code: 'Z-A1', capacity: 16 },
  { code: 'Z-A2', capacity: 16 },
  { code: 'Z-B1', capacity: 16 },
  { code: 'Z-B2', capacity: 16 },
  { code: 'Z-VIP', capacity: 8 },
];

// Per-zone current state (smooth random walk for natural look)
const state = new Map<string, number>();
for (const z of ZONES) state.set(z.code, Math.floor(z.capacity * 0.2));

function peakFactor(): number {
  const h = new Date().getHours();
  const m = new Date().getMinutes();
  const t = h + m / 60;
  // Lunch peak around 11:30 - 12:30
  const lunch = Math.exp(-Math.pow(t - 12, 2) / 0.6);
  // Mini-peak afternoon 15:00
  const tea = Math.exp(-Math.pow(t - 15, 2) / 2) * 0.5;
  // Evening 17:30
  const dinner = Math.exp(-Math.pow(t - 17.5, 2) / 1.5) * 0.7;
  return Math.max(0.1, lunch + tea + dinner);
}

async function postZone(code: string, occupied: number) {
  try {
    const res = await fetch(`${API}/api/canteen/ingest/canteen-density`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-service-token': TOKEN },
      body: JSON.stringify({ zoneCode: code, occupied, source: 'sensor' }),
    });
    if (!res.ok) console.error(`[canteen-sim] ${code} ${res.status}`, await res.text());
  } catch (e: any) {
    console.error('[canteen-sim]', e.message);
  }
}

async function tick() {
  const peak = peakFactor();
  const posts: Promise<void>[] = [];
  for (const z of ZONES) {
    const target = Math.floor(z.capacity * Math.min(1.1, peak * (0.4 + Math.random() * 0.7)));
    const curr = state.get(z.code) ?? 0;
    // Move towards target with small random walk
    const diff = target - curr;
    const next = Math.max(0, Math.min(z.capacity + 2, curr + Math.sign(diff) * Math.ceil(Math.abs(diff) * 0.4) + (Math.random() < 0.5 ? -1 : 1)));
    state.set(z.code, next);
    posts.push(postZone(z.code, next));
  }
  await Promise.all(posts);
  const summary = Array.from(state.entries()).map(([c, v]) => `${c}:${v}`).join(' ');
  process.stdout.write(`\r[${new Date().toLocaleTimeString()}] peak=${peak.toFixed(2)}  ${summary}    `);
}

async function main() {
  console.log('🍱 Canteen simulator started. Press Ctrl-C to stop.');
  console.log(`   Posting to ${API}/api/canteen/ingest/canteen-density`);
  while (true) {
    await tick();
    await new Promise(r => setTimeout(r, 3000));
  }
}

main().catch(e => { console.error(e); process.exit(1); });
