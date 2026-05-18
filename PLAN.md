# SCIS — Smart Campus Integrated System (UIT)
## PLAN CHI TIẾT — Web System cho Sinh viên

> Phạm vi: **WEB-ONLY** (PWA cho sinh viên + Admin Portal). Mobile native được lược bỏ — dùng PWA responsive thay thế để demo trên điện thoại vẫn chạy được.

---

## 0. Tổng quan phạm vi

### Module bắt buộc (theo bối cảnh)
1. **Digital Student ID** — Thẻ SV số (QR rotating)
2. **Automated Attendance** — Điểm danh tự động (Bluetooth Beacon → Web Bluetooth API + fallback QR Beacon)
3. **Digital Wallet** — Ví điện tử, nạp/trừ tiền
4. **Smart Dining** — Đặt món trước, QR pickup

### Module MỞ RỘNG (yêu cầu mới của bạn)
5. **Live Chart — Số người vào Campus** (Gate Analytics realtime)
6. **Heatmap Canteen** — Mật độ người tại các zone căn tin theo thời gian

### Roles
- `student` — PWA student app
- `lecturer` — Web (xem điểm danh lớp)
- `canteen_staff` — Web (quản lý đơn đặt món)
- `admin` — Web (dashboard, reports, live chart, heatmap)
- `gate_device` — service account cho cổng/beacon đẩy event

---

## 1. Kiến trúc hệ thống

```
┌──────────────────────────────────────────────────────────────────┐
│                       CLIENT (Web Only)                          │
│  ┌────────────────────────┐    ┌──────────────────────────────┐  │
│  │  Student PWA           │    │  Admin / Staff Portal        │  │
│  │  React + Vite + TS     │    │  React + Vite + TS           │  │
│  │  Tailwind + shadcn/ui  │    │  shadcn/ui + Recharts        │  │
│  │  Service Worker + IDB  │    │  Leaflet (heatmap canteen)   │  │
│  └─────────┬──────────────┘    └──────────────┬───────────────┘  │
└────────────┼───────────────────────────────────┼──────────────────┘
             │ HTTPS REST + WSS                  │
             ▼                                   ▼
┌──────────────────────────────────────────────────────────────────┐
│                       API GATEWAY (Nginx)                        │
└──────────────────────────────┬───────────────────────────────────┘
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│                  APPLICATION TIER — Node.js                      │
│  Fastify + TypeScript                                            │
│  ├── REST API  (CRUD, auth, business logic)                      │
│  ├── WebSocket Hub (Socket.IO)  ← live chart, heatmap, orders    │
│  ├── Worker Queue (BullMQ)      ← report export, notif fanout    │
│  └── Cron Jobs                  ← heatmap rollup, gate stats     │
└──────────┬──────────────────────────┬────────────────────────────┘
           ▼                          ▼
┌────────────────────┐      ┌──────────────────────────────────────┐
│  PostgreSQL 16     │      │  Redis 7                             │
│  - OLTP            │      │  - Sessions / JWT blacklist          │
│  - Reporting view  │      │  - Pub/Sub (realtime fanout)         │
│  - PostGIS opt.    │      │  - Cache (menu, dashboard KPIs)      │
└────────────────────┘      │  - Rate-limit + sliding-window count │
                            └──────────────────────────────────────┘
                               ▲
                               │
┌──────────────────────────────────────────────────────────────────┐
│           HARDWARE / EDGE (simulated for demo)                   │
│  - Gate cameras / RFID  → POST /ingest/gate-event                │
│  - BLE Beacons          → Web Bluetooth (browser-side) hoặc QR   │
│  - Canteen zone sensors → POST /ingest/canteen-density           │
│  - Simulator script     → giả lập gate + canteen traffic         │
└──────────────────────────────────────────────────────────────────┘
```

### Tech stack rationale
| Layer | Lựa chọn | Lý do |
|---|---|---|
| Backend | **Node.js + Fastify + TS** | Fastify nhanh hơn Express ~2x, schema validation built-in, dev-experience tốt với TS |
| Frontend | **React 18 + Vite + TS** | Vite HMR cực nhanh, ecosystem chart/map đầy đủ |
| Realtime | **Socket.IO** | Auto-reconnect, rooms, fallback long-polling — match đúng nhu cầu live chart/heatmap |
| DB | **PostgreSQL 16** | Free, mạnh, có `JSONB`, time-series ổn cho gate events; PostGIS optional nếu cần geofence |
| Cache/Pub-Sub | **Redis 7** | Pub/sub fanout realtime, cache dashboard, rate-limit |
| ORM | **Prisma** | Type-safe, migration tốt, schema rõ |
| Auth | **JWT (access 15m + refresh 7d)** + bcrypt | Stateless API, refresh rotate trong Redis |
| Charts | **Recharts** (line/bar/pie) + **deck.gl** hoặc **heatmap.js** cho canteen |
| Map/Floor | **Leaflet + Simple CRS** (canteen floor plan as image, không cần GIS thật) |
| Container | **Docker Compose** (dev) → có thể đẩy GCP Cloud Run sau |

---

## 2. Database Schema (PostgreSQL — Prisma)

### Tables cốt lõi (giữ từ bối cảnh)
```
users(id, student_code, email, password_hash, full_name, faculty,
      class, photo_url, role, created_at, updated_at)
wallets(id, user_id FK, balance NUMERIC(12,2), updated_at)
transactions(id, user_id FK, type ENUM(topup,payment,refund),
             amount, description, ref_order_id, status, created_at)
classes(id, code UNIQUE, name, instructor_id FK→users, schedule JSONB)
class_enrollments(class_id, user_id, PRIMARY KEY(class_id,user_id))
beacons(id, uuid UNIQUE, room_label, class_id FK, active BOOL)
attendance(id, user_id, class_id, beacon_id, session_date,
           check_in_time, method ENUM(ble,qr,manual),
           UNIQUE(user_id, class_id, session_date))
menu_items(id, name, description, price, category, image_url,
           prep_time_min, available BOOL, stock_today INT)
orders(id, user_id, total_amount, pickup_time, status, qr_code,
       created_at)
order_items(order_id, menu_item_id, quantity, unit_price)
```

### Tables MỚI (cho Live Chart + Heatmap)
```sql
-- Gates: định nghĩa các cổng vào campus
gates(
  id UUID PRIMARY KEY,
  code TEXT UNIQUE,           -- 'GATE-A', 'GATE-B', 'GATE-PARKING'
  name TEXT,
  direction ENUM('in','out','both'),
  active BOOL DEFAULT true
)

-- Mỗi lần ai đó qua cổng → 1 event
gate_events(
  id BIGSERIAL PRIMARY KEY,
  gate_id UUID REFERENCES gates(id),
  user_id UUID REFERENCES users(id) NULL,  -- NULL nếu khách
  direction ENUM('in','out'),
  occurred_at TIMESTAMPTZ NOT NULL,
  method ENUM('qr','rfid','face','manual'),
  device_id TEXT
);
CREATE INDEX idx_gate_events_time ON gate_events(occurred_at DESC);
CREATE INDEX idx_gate_events_gate_time ON gate_events(gate_id, occurred_at DESC);

-- Rollup pre-aggregated theo phút (cho live chart load nhanh)
gate_stats_1m(
  bucket_start TIMESTAMPTZ,
  gate_id UUID,
  in_count INT,
  out_count INT,
  PRIMARY KEY(bucket_start, gate_id)
);

-- Canteen zones: vùng trên sơ đồ căn tin
canteen_zones(
  id UUID PRIMARY KEY,
  code TEXT UNIQUE,             -- 'Z-A1', 'Z-A2', 'Z-COUNTER'
  name TEXT,
  capacity INT,                  -- sức chứa tối đa
  -- toạ độ trên floor plan (image-based, Leaflet Simple CRS)
  x_min INT, y_min INT, x_max INT, y_max INT,
  floor INT DEFAULT 1
)

-- Mật độ tức thời (push từ sensor / camera / simulator)
canteen_density(
  id BIGSERIAL PRIMARY KEY,
  zone_id UUID REFERENCES canteen_zones(id),
  occupied INT NOT NULL,         -- số người ước lượng
  measured_at TIMESTAMPTZ NOT NULL,
  source ENUM('sensor','camera','order_proxy','manual')
);
CREATE INDEX idx_canteen_density_time ON canteen_density(measured_at DESC);

-- Rollup 5 phút (heatmap chơi mượt)
canteen_density_5m(
  bucket_start TIMESTAMPTZ,
  zone_id UUID,
  avg_occupied NUMERIC(6,2),
  peak_occupied INT,
  PRIMARY KEY(bucket_start, zone_id)
);
```

### Indexing & Performance
- Partition `gate_events` theo tháng (`PARTITION BY RANGE (occurred_at)`) khi >10M rows.
- Rollup jobs (cron 1 phút): aggregate `gate_events` → `gate_stats_1m`, `canteen_density` → `canteen_density_5m`.
- Materialized view `mv_dashboard_kpis` refresh mỗi 30s.

---

## 3. API Endpoints

### 3.1 Auth
- `POST /api/auth/login` → `{access, refresh, user}`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `GET  /api/auth/me`

### 3.2 Student
- `GET  /api/students/me`
- `GET  /api/students/me/qrcode` → returns short-lived signed QR (60s TTL)
- `GET  /api/students/me/attendance?from&to`
- `GET  /api/students/me/transactions?cursor`

### 3.3 Attendance
- `POST /api/attendance/checkin` — body `{ beacon_uuid | qr_token, lat?, lng? }`
- `GET  /api/attendance/class/:classId?date=`  (lecturer/admin)
- `GET  /api/attendance/stats/class/:classId`  (tỉ lệ tham gia)
- `GET  /api/attendance/export/:classId.xlsx`

### 3.4 Wallet
- `GET  /api/wallet/balance`
- `POST /api/wallet/topup`           — mock gateway
- `POST /api/wallet/pay`             — body `{order_id|qr_token}`
- `GET  /api/wallet/transactions`

### 3.5 Dining
- `GET  /api/menu` — public, cache 30s
- `POST /api/orders`
- `GET  /api/orders/me`
- `PUT  /api/orders/:id/status`     — staff only
- `POST /api/orders/:id/pickup`     — quét QR nhận món
- `WS   ws:/orders` — staff dashboard nhận order mới realtime

### 3.6 Gate / Live Chart (MỚI)
- `POST /api/ingest/gate-event` — service token; body `{gate_code, user_id?, direction, method, occurred_at}`
- `GET  /api/gates` — list gates
- `GET  /api/gates/live` → snapshot hiện tại (số người trong campus)
- `GET  /api/gates/series?gate=ALL&granularity=1m&from&to` — historical line chart
- `WS   ws:/gates` — push event realtime:
  - `gate:event` `{gate, direction, user?, ts}`
  - `gate:tick`  `{ts, in_per_min, out_per_min, inside_campus_total}` (server emit mỗi 5s)

### 3.7 Canteen Heatmap (MỚI)
- `POST /api/ingest/canteen-density` — service token; body `{zone_code, occupied, measured_at}`
- `GET  /api/canteen/zones` — toạ độ + capacity
- `GET  /api/canteen/floor-plan` — image URL
- `GET  /api/canteen/heatmap/live` → snapshot per zone `[{zone_id, occupied, ratio}]`
- `GET  /api/canteen/heatmap/replay?date&from&to&step=5m` — historical, để admin scrub timeline
- `WS   ws:/canteen` — `canteen:tick` mỗi 5s

### 3.8 Admin / Reports
- `GET  /api/admin/dashboard`
- `GET  /api/admin/reports/revenue?range=7d|30d`
- `GET  /api/admin/reports/attendance?class&from&to`
- `GET  /api/admin/reports/top-items`
- `POST /api/admin/exports/:type` → BullMQ job → email link/download

### Conventions
- Auth: `Authorization: Bearer <jwt>`
- Pagination: cursor-based `?cursor=&limit=`
- Errors: RFC 7807 problem+json
- Validation: Zod schema + Fastify json-schema

---

## 4. Realtime — Live Chart & Heatmap chi tiết

### 4.1 Live Chart (số người vào Campus)

**Data flow**
```
Gate device → POST /ingest/gate-event
   → write to gate_events
   → INCR Redis counter `campus:inside`
   → publish 'gate:event' to Redis channel
   → Socket.IO Hub fanout to room `gates:*`

Cron 5s (server) → snapshot rate-per-min từ sliding window 60s trong Redis
   → emit 'gate:tick' to room
```

**UI Admin**
- Big number card: **"Hiện đang trong campus: 1,234"** (counter animation)
- Multi-series line chart: in/min vs out/min, 60 phút gần nhất (Recharts)
- Bar chart per gate (today total in/out)
- Toggle granularity: 1m / 5m / 15m / 1h
- Date picker để xem replay (gọi `/gates/series`)

**Performance**
- WS chỉ broadcast diff (event) + tick (5s). Không push raw stream.
- Client buffer 5s, batch render bằng `requestAnimationFrame`.
- Historical fetched 1 lần khi load; new ticks appended in-place.

### 4.2 Heatmap Canteen

**Data flow**
```
Source A (real): camera/people-counter → POST /ingest/canteen-density
Source B (proxy): khi order pickup tại zone X → +1 occupied (demo)
Source C (sim): simulator script chạy nền

→ Redis HSET `canteen:live` { zone_id: occupied }
→ Publish 'canteen:tick' mỗi 5s với toàn bộ snapshot
```

**UI Admin**
- **Leaflet map** với Simple CRS, layer là ảnh sơ đồ căn tin (`/public/canteen-floor.png`).
- Mỗi `canteen_zone` là 1 rectangle overlay, fill color theo `occupied / capacity`:
  - `< 30%` → xanh
  - `30–70%` → vàng
  - `70–90%` → cam
  - `> 90%` → đỏ + pulse animation
- Hover zone → tooltip: zone name, occupied/capacity, ratio
- Slider timeline ở dưới để **scrub replay** giờ vừa qua (đọc từ `canteen_density_5m`)
- Toggle: Live / Replay
- Stats panel: peak hour today, busiest zone, recommend zone trống

**Algo tô màu**: tô gradient bằng `chroma.js`, smooth transition 500ms giữa các tick.

---

## 5. UI/UX — Pages

### Student PWA
| Route | Mục đích |
|---|---|
| `/login` | Email + password |
| `/` | Home: thẻ ID QR (rotating 60s), số dư ví, action nhanh |
| `/attendance` | Lịch sử + nút "Check-in" (Web Bluetooth → fallback QR scan) |
| `/wallet` | Số dư, nạp tiền (mock), lịch sử |
| `/dining` | Menu grid, cart, đặt món, "Đơn của tôi" |
| `/dining/order/:id` | Trạng thái + QR pickup |
| `/profile` | Info, settings |

### Admin Portal
| Route | Mục đích |
|---|---|
| `/admin` | Dashboard tổng hợp (KPIs + **Live Chart** + mini heatmap) |
| `/admin/gates` | **Live Chart full** — multi-series, per-gate breakdown, replay |
| `/admin/canteen` | **Heatmap full** + replay slider + analytics |
| `/admin/students` | CRUD sinh viên |
| `/admin/attendance` | Theo lớp, export Excel |
| `/admin/transactions` | Filter, export |
| `/admin/menu` | CRUD menu (canteen staff) |
| `/admin/orders` | Realtime queue đơn đặt món |
| `/admin/reports` | Báo cáo doanh thu / điểm danh / top món |

### Design system
- Tailwind + shadcn/ui (Radix primitives)
- Dark mode hỗ trợ
- Mobile-first cho student (PWA installable)
- i18n: VI mặc định, EN tùy chọn (i18next)

---

## 6. Bảo mật

| Mục | Biện pháp |
|---|---|
| Password | bcrypt cost 12 |
| Token | JWT RS256 (access 15m, refresh 7d, rotate) |
| QR Student ID | HMAC signed, TTL 60s, single-use |
| QR Payment | One-time nonce, server-side verify, expire 2 phút |
| Rate limit | Fastify rate-limit + Redis sliding window |
| Input | Zod + Fastify schema validation |
| SQL | Prisma parameterized (anti-SQLi) |
| XSS | React auto-escape + CSP header |
| CSRF | SameSite=Lax cookie cho refresh, header token cho access |
| HTTPS | Let's Encrypt + HSTS |
| Audit log | Bảng `audit_logs` cho thao tác admin |
| Service ingest endpoints | API key + IP allowlist |

---

## 7. Sample / Seed Data

- 50 sinh viên (10 lớp × 5 SV)
- 5 lớp học mỗi tuần 3 buổi
- 5 beacons (1/room)
- 20 menu items (3 category)
- 3 gates (`GATE-A`, `GATE-B`, `GATE-PARKING`)
- 8 canteen zones (Z-A1..Z-A4 bàn ăn, Z-COUNTER quầy, Z-PICKUP, Z-DRINK, Z-LINE)
- Simulator script sinh: 200 gate events/min (giờ cao điểm), 800/min (đầu giờ); canteen 11:00–13:30 tăng tải.

---

## 8. Cấu trúc thư mục

```
C:\Management\
├── PLAN.md                   ← file này
├── README.md
├── docker-compose.yml        ← postgres + redis + backend + nginx
├── .env.example
├── packages/
│   ├── backend/
│   │   ├── src/
│   │   │   ├── app.ts
│   │   │   ├── server.ts
│   │   │   ├── plugins/   (auth, prisma, redis, socketio, ratelimit)
│   │   │   ├── modules/
│   │   │   │   ├── auth/
│   │   │   │   ├── students/
│   │   │   │   ├── attendance/
│   │   │   │   ├── wallet/
│   │   │   │   ├── dining/
│   │   │   │   ├── gates/        ← LIVE CHART
│   │   │   │   ├── canteen/      ← HEATMAP
│   │   │   │   ├── admin/
│   │   │   │   └── ingest/
│   │   │   ├── realtime/  (socket hub, redis pubsub)
│   │   │   ├── workers/   (rollup, export)
│   │   │   └── lib/       (jwt, crypto, qr)
│   │   ├── prisma/schema.prisma
│   │   ├── prisma/seed.ts
│   │   └── tests/
│   ├── student-web/          ← PWA
│   │   ├── src/
│   │   │   ├── pages/ (Home, Attendance, Wallet, Dining, Profile)
│   │   │   ├── components/
│   │   │   ├── hooks/ (useAuth, useSocket, useWebBluetooth)
│   │   │   ├── lib/
│   │   │   └── sw.ts
│   │   └── vite.config.ts
│   ├── admin-web/
│   │   ├── src/
│   │   │   ├── pages/ (Dashboard, Gates, Canteen, Students, ...)
│   │   │   ├── components/ (LiveChart, CanteenHeatmap, KpiCard)
│   │   │   ├── hooks/
│   │   │   └── lib/
│   │   └── vite.config.ts
│   └── shared/               ← types, zod schemas, constants
└── tools/
    ├── simulator-gate.ts     ← giả lập gate events
    ├── simulator-canteen.ts  ← giả lập density
    └── demo-script.md
```

---

## 9. Lộ trình thực hiện (chunked, có thể chạy từng phần)

### ▶ Phase 0 — Scaffold (30–45 phút)
- Tạo monorepo (pnpm workspaces)
- Docker Compose: Postgres 16, Redis 7
- Init Prisma schema (toàn bộ tables ở Section 2)
- Init backend Fastify + auth skeleton
- Init student-web + admin-web (Vite + React + TS + Tailwind + shadcn)
- Seed script tạo 50 SV + menu + zones + gates

### ▶ Phase 1 — Auth + Student core (~1.5h)
- Login, JWT, refresh
- `/students/me`, QR Digital ID (rotating)
- Wallet topup + balance
- Student PWA: Login + Home + Wallet

### ▶ Phase 2 — Attendance (~1.5h)
- Beacon checkin endpoint
- Web Bluetooth scan (fallback QR)
- Lecturer/Admin view class attendance
- Export Excel

### ▶ Phase 3 — Dining (~1.5h)
- Menu CRUD
- Order flow (place → preparing → ready → pickup QR)
- Staff dashboard realtime (WS)

### ▶ Phase 4 — **LIVE CHART Gate Analytics** (~2h)
- Ingest endpoint + auth (service token)
- Redis counter + sliding window
- WS room `gates` + tick emitter
- Admin page: KPI counter + multi-series line + per-gate bar
- Replay mode
- Simulator gate events

### ▶ Phase 5 — **HEATMAP Canteen** (~2.5h)
- Ingest endpoint
- Leaflet Simple CRS với floor plan
- Zone overlay + color gradient
- WS room `canteen` + tick
- Replay slider
- Simulator density

### ▶ Phase 6 — Admin Dashboard + Reports (~1.5h)
- KPI cards
- Revenue chart (Recharts)
- Top items, attendance rate
- Export Excel/PDF (exceljs / pdfkit) qua BullMQ

### ▶ Phase 7 — Polish & Demo Prep (~1h)
- Sample data đẹp
- Dark mode, loading states, error boundaries
- README hướng dẫn chạy
- `demo-script.md` 20-phút walkthrough
- Health checks `/healthz`, `/readyz`

**Tổng cộng demo-ready: ~12 giờ thực làm (chia 5–7 buổi).**

---

## 10. Deployment

### Local dev
```powershell
docker compose up -d postgres redis
pnpm -F backend prisma migrate dev
pnpm -F backend prisma db seed
pnpm dev   # chạy tất cả: backend + student-web + admin-web
```

### Production (GCP)
- Cloud SQL (Postgres)
- Memorystore (Redis)
- Cloud Run (backend) + Cloud Run (jobs/workers)
- Cloud Storage (menu images, floor plan)
- Static web: Firebase Hosting hoặc Cloud Storage + Cloud CDN
- Secrets: Secret Manager
- Logs: Cloud Logging + error tracking Sentry

---

## 11. Demo Script (20 phút)

1. **0–2'** — Mở student PWA, login `20520001@gm.uit.edu.vn`, show Digital ID QR
2. **2–5'** — Web Bluetooth check-in lớp (giả lập beacon từ máy khác), notification thành công, admin xem danh sách
3. **5–9'** — Wallet: nạp 100k, đặt món "Cơm gà + Trà đào", quét QR pickup, lịch sử
4. **9–13'** — **LIVE CHART**: chạy simulator gate, show counter "đang trong campus" nhảy realtime, multi-line chart, replay 30 phút trước
5. **13–17'** — **HEATMAP CANTEEN**: zone đổi màu theo simulator, peak 12:00, replay slider rê lại 11:30
6. **17–20'** — Admin dashboard: KPIs, top món, doanh thu tuần, export báo cáo Excel

---

## 12. Rủi ro & Mitigation

| Rủi ro | Mitigation |
|---|---|
| Web Bluetooth không hỗ trợ Safari iOS | Fallback QR Beacon (1 mã QR cố định mỗi phòng) |
| WS reconnection storm | Backoff + jitter, server limit 5k connections |
| Heatmap lag với 100+ zones | Batch update 5s tick, RAF render, virtualize |
| Demo hardware không sẵn | Simulator scripts đã built-in |
| Data nhạy cảm SV | Mask MSSV trong UI public, full chỉ cho admin |

---

## 13. Câu hỏi cần xác nhận trước khi build

1. **Backend**: chốt **Node.js + Fastify + TS** chứ? (alternative: Spring Boot, NestJS, Django)
2. **DB**: chốt **Postgres** thay Oracle cho demo? (Oracle nặng license)
3. **Mobile native**: bỏ hẳn, chỉ làm **PWA** chứ?
4. Có cần **multi-tenant** (nhiều campus) không? — default: single-tenant UIT
5. **Floor plan canteen**: bạn có ảnh sẵn không, hay dùng placeholder SVG do tôi generate?
