# SCIS - Demo Script (15-20 phut)

> Khan gia: Board of Rectors, IT sponsor, business sponsor, lecturer

## Setup truoc demo

```powershell
cd D:\Management
docker compose up -d postgres redis
pnpm.cmd dev:backend
pnpm.cmd dev:admin
pnpm.cmd dev:student
pnpm.cmd sim:gate
pnpm.cmd sim:canteen
```

Kiem tra nhanh:

```powershell
curl http://localhost:4000/healthz
```

## Luong demo

### 0:00 - 2:00 | Digital Student ID

1. Mo admin portal `http://localhost:5174`.
2. Mo student PWA `http://localhost:5173`.
3. Dang nhap student `20520001@gm.uit.edu.vn / password123`.
4. Vao trang chu, chi QR rotating 60 giay va so du vi.

### 2:00 - 5:00 | Automated Attendance

1. Vao tab `Diem danh`.
2. Chon lop `IT001`.
3. De beacon UUID mac dinh `550e8400-e29b-41d4-a716-446655440001`.
4. Bam `Check-in bang beacon`.
5. O admin portal, mo `Diem danh` de xem ti le tham gia theo lop.

### 5:00 - 9:00 | Wallet + Smart Dining

1. Vao tab `Vi`, nap them `200,000 VND`.
2. Vao tab `Can tin`, them 2 mon vao gio hang.
3. Chon gio nhan mon, bam `Dat ngay`.
4. O admin portal, mo `Don an` va doi trang thai `pending -> preparing -> ready`.
5. Quay lai PWA, xem order duoc cap nhat va QR pickup hien ra khi don `ready`.

### 9:00 - 13:00 | Live Gate Analytics

1. O admin portal mo `Live Chart`.
2. Chi KPI `Dang trong campus`.
3. Chi area chart vao/ra theo minute.
4. Chi breakdown theo 3 cong: `GATE-A`, `GATE-B`, `GATE-PARKING`.
5. Giai thich du lieu den tu simulator, Redis counter, va Socket.IO tick 5 giay.

### 13:00 - 17:00 | Canteen Heatmap

1. O admin portal mo `Heatmap`.
2. Chi floor plan canteen va 8 zone doi mau theo mat do.
3. Hover de xem `occupied/capacity/ratio`.
4. Keo slider replay 1 gio de xem du lieu bucket 5 phut.
5. O PWA sinh vien, vao tab `Heatmap` de xem ban preview nhanh khu dong/vang.

### 17:00 - 20:00 | Dashboard + Reports

1. O admin portal mo `Dashboard`.
2. Chi 4 KPI tong quan, chart doanh thu 7 ngay, top items, va attendance.
3. Mo `Bao cao` va nhan manh day la ban view-first; export se bo sung sau.

## Fallback nhanh

- Neu backend dung: chay lai `pnpm.cmd dev:backend`
- Neu simulator gate dung: chay lai `pnpm.cmd sim:gate`
- Neu simulator canteen dung: chay lai `pnpm.cmd sim:canteen`
- Neu browser khong ho tro Web Bluetooth: dung fallback beacon UUID/QR nhu luong demo
