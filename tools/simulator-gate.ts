/**
 * Gate event simulator.
 * Posts gate-events to backend so live chart updates realtime.
 *
 * Usage: pnpm sim:gate
 */
const API = process.env.API_URL ?? 'http://localhost:4000';
const TOKEN = process.env.INGEST_SERVICE_TOKEN ?? 'dev-ingest-token-change-me';

const GATES = ['GATE-A', 'GATE-B', 'GATE-PARKING'];

// Diurnal weight: people-flow heavier 7-9am, 11-13, 17-19
function trafficWeight(): number {
  const h = new Date().getHours();
  if (h >= 7 && h <= 9) return 4;
  if (h >= 11 && h <= 13) return 3;
  if (h >= 17 && h <= 19) return 3.5;
  if (h >= 21 || h < 6) return 0.3;
  return 1.5;
}

function pickGate(): string {
  return GATES[Math.floor(Math.random() * GATES.length)]!;
}

function pickDirection(): 'in' | 'out' {
  const h = new Date().getHours();
  // Morning skews IN, evening skews OUT
  const inBias = h < 12 ? 0.7 : h < 17 ? 0.5 : 0.3;
  return Math.random() < inBias ? 'in' : 'out';
}

async function postEvent() {
  const body = {
    gateCode: pickGate(),
    direction: pickDirection(),
    method: 'qr',
    occurredAt: new Date().toISOString(),
    deviceId: `sim-${Math.floor(Math.random() * 9999)}`,
  };
  try {
    const res = await fetch(`${API}/api/ingest/gate-event`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-service-token': TOKEN },
      body: JSON.stringify(body),
    });
    if (!res.ok) console.error(`[gate-sim] ${res.status}`, await res.text());
  } catch (e: any) {
    console.error('[gate-sim]', e.message);
  }
}

async function main() {
  console.log('🚪 Gate simulator started. Press Ctrl-C to stop.');
  console.log(`   Posting to ${API}/api/ingest/gate-event`);

  // Continuous trickle: 1 event every 300-1500 ms scaled by weight.
  // Await the batch so we don't stampede the backend's Prisma pool.
  while (true) {
    const w = trafficWeight();
    const eventsThisTick = Math.max(1, Math.floor(Math.random() * 4 * w));
    const batch = Array.from({ length: eventsThisTick }, () => postEvent());
    await Promise.all(batch);
    const delay = 500 + Math.random() * 1500;
    process.stdout.write(`. (${new Date().toLocaleTimeString()}: ${eventsThisTick} events, w=${w.toFixed(1)})\r`);
    await new Promise(r => setTimeout(r, delay));
  }
}

main().catch(e => { console.error(e); process.exit(1); });
