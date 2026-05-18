# SCIS - Smart Campus Integrated System (UIT)

He thong demo web-only cho UIT, gom 3 thanh phan chay cung nhau:

- `packages/backend`: Fastify + Prisma + Socket.IO
- `packages/student-web`: PWA cho sinh vien
- `packages/admin-web`: portal cho admin, lecturer, canteen staff

6 module dang hoat dong trong ban nay:

1. Digital Student ID
2. Automated Attendance
3. Digital Wallet
4. Smart Dining
5. Live Gate Analytics
6. Canteen Heatmap

## Yeu cau

- Node.js >= 20
- pnpm 9
- Docker Desktop

## Chay nhanh

```powershell
cd D:\Management
pnpm.cmd install
docker compose up -d postgres redis
pnpm.cmd -F @scis/backend prisma migrate dev --name init
pnpm.cmd -F @scis/backend seed
```

Mo 5 terminal:

```powershell
pnpm.cmd dev:backend
pnpm.cmd dev:admin
pnpm.cmd dev:student
pnpm.cmd sim:gate
pnpm.cmd sim:canteen
```

## URL

- Backend: `http://localhost:4000`
- Health: `http://localhost:4000/healthz`
- Student PWA: `http://localhost:5173`
- Admin Portal: `http://localhost:5174`
- Floor plan asset: `http://localhost:4000/static/canteen-floor.svg`

## Tai khoan demo

| Role | Email | Password |
|---|---|---|
| Admin | `admin@uit.edu.vn` | `password123` |
| Lecturer | `lecturer@uit.edu.vn` | `password123` |
| Canteen Staff | `canteen@uit.edu.vn` | `password123` |
| Student | `20520001@gm.uit.edu.vn` -> `20520020@gm.uit.edu.vn` | `password123` |

## Ghi chu quan trong

- `packages/backend/.env` da duoc dat rieng de Prisma va backend chay on dinh trong workspace hien tai.
- Attendance demo dung beacon UUID `550e8400-e29b-41d4-a716-446655440001`.
- `sim:gate` va `sim:canteen` dang bam dung ingest contract cua backend.
- Reports hien la view-first; nut export chua lam that.

## Cau truc

```text
D:\Management
|-- packages
|   |-- shared
|   |-- backend
|   |-- student-web
|   `-- admin-web
|-- tools
|   |-- simulator-gate.ts
|   |-- simulator-canteen.ts
|   `-- demo-script.md
|-- docker-compose.yml
|-- PLAN.md
`-- package.json
```
