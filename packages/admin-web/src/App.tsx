import chroma from "chroma-js";
import { CalendarClock, ChartNoAxesCombined, LayoutDashboard, ListOrdered, LogOut, MapPinned, ReceiptText, Users } from "lucide-react";
import L from "leaflet";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { Navigate, Route, Routes, Link, useLocation, useNavigate } from "react-router-dom";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ImageOverlay, MapContainer, Rectangle, Tooltip as LeafletTooltip } from "react-leaflet";

import { apiFetch, logoutSession, readSession, writeSession, type Session } from "./api";

type DashboardData = {
  studentActiveToday: number;
  attendanceToday: number;
  transactionsTodayAmount: number;
  transactionsTodayCount: number;
  pendingOrders: number;
  insideCampusTotal: number;
  canteenBusiestZone: { name: string; ratio: number } | null;
  topItems: Array<{ menuItemId: string; name: string; quantity: number }>;
};

type AttendanceRow = {
  classId: string;
  classCode: string;
  className: string;
  enrolledCount: number;
  presentCount: number;
  ratio: number;
};

type Order = {
  id: string;
  status: string;
  totalAmount: number;
  pickupTime: string;
  customer: { fullName: string; studentCode: string };
  items: Array<{ name: string; quantity: number }>;
};

type GateLive = {
  ts: string;
  insideCampusTotal: number;
  inPerMinute: number;
  outPerMinute: number;
  gates: Array<{ gateCode: string; inCount: number; outCount: number }>;
};

type GateSeries = Array<{ bucketStart: string; gateCode: string; inCount: number; outCount: number }>;
type HeatmapZone = {
  zoneCode: string;
  name: string;
  occupied: number;
  capacity: number;
  ratio: number;
  level: "low" | "medium" | "high" | "critical";
  bounds: [number, number, number, number];
};

type HeatmapReplayRow = {
  bucketStart: string;
  zoneCode: string;
  zoneName: string;
  avgOccupied: number;
  peakOccupied: number;
  capacity: number;
};

type StudentRow = {
  id: string;
  fullName: string;
  studentCode: string;
  email: string;
  faculty: string;
  className: string;
  walletBalance: number;
};

const currency = new Intl.NumberFormat("vi-VN", {
  style: "currency",
  currency: "VND",
  maximumFractionDigits: 0
});

const useSessionState = () => {
  const [session, setSession] = useState<Session | null>(() => readSession());
  useEffect(() => writeSession(session), [session]);
  return { session, setSession };
};

const usePolling = <T,>(loader: () => Promise<T>, deps: unknown[], interval = 0) => {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const run = async () => {
      try {
        const next = await loader();
        if (alive) {
          setData(next);
          setError(null);
        }
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : "Lỗi hệ thống.");
      } finally {
        if (alive) setLoading(false);
      }
    };
    void run();
    if (!interval) return () => { alive = false; };
    const timer = window.setInterval(run, interval);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, deps);

  return { data, error, loading, setData };
};

const roleMenu = {
  admin: ["/dashboard", "/attendance", "/transactions", "/dining", "/gates", "/canteen", "/reports", "/students"],
  lecturer: ["/dashboard", "/attendance", "/reports", "/students"],
  canteen_staff: ["/dashboard", "/dining", "/canteen", "/reports"],
  student: []
} as const;

const menuItems = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/attendance", label: "Điểm danh", icon: CalendarClock },
  { to: "/transactions", label: "Giao dịch", icon: ReceiptText },
  { to: "/dining", label: "Đơn ăn", icon: ListOrdered },
  { to: "/gates", label: "Live Chart", icon: ChartNoAxesCombined },
  { to: "/canteen", label: "Heatmap", icon: MapPinned },
  { to: "/reports", label: "Báo cáo", icon: ChartNoAxesCombined },
  { to: "/students", label: "Sinh viên", icon: Users }
];

const PortalShell = ({
  session,
  onLogout,
  children
}: {
  session: Session;
  onLogout: () => void;
  children: React.ReactNode;
}) => {
  const location = useLocation();
  const allowed = roleMenu[session.user.role];
  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,_#f5f5f4,_#fff7ed_35%,_#fafaf9_100%)] text-stone-900">
      <div className="mx-auto flex min-h-screen w-full max-w-[1440px] gap-6 px-4 py-4 lg:px-6">
        <aside className="hidden w-72 shrink-0 rounded-[28px] border border-stone-200 bg-stone-950 p-5 text-stone-100 lg:block">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-amber-300/80">UIT Admin Portal</p>
            <h1 className="mt-2 text-2xl font-semibold">{session.user.fullName}</h1>
            <p className="text-sm text-stone-400">{session.user.role}</p>
          </div>
          <nav className="mt-8 space-y-2">
            {menuItems.filter((item) => allowed.includes(item.to as never)).map((item) => {
              const Icon = item.icon;
              const active = location.pathname === item.to;
              return (
                <Link className={`sidebar-link ${active ? "sidebar-link-active" : ""}`} key={item.to} to={item.to}>
                  <Icon size={18} />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
          <button className="danger-link mt-8" onClick={onLogout}>
            <LogOut size={18} />
            <span>Đăng xuất</span>
          </button>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="rounded-[28px] border border-stone-200 bg-white/90 p-4 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.28em] text-amber-700">Smart Campus Integrated System</p>
                <h2 className="mt-1 text-2xl font-semibold text-stone-950">Bảng điều hành demo web-only</h2>
              </div>
              <button className="danger-link lg:hidden" onClick={onLogout}>
                <LogOut size={18} />
                <span>Thoát</span>
              </button>
            </div>
          </header>
          <main className="mt-6 flex-1">{children}</main>
        </div>
      </div>
    </div>
  );
};

const LoginPage = ({ onLoggedIn }: { onLoggedIn: (session: Session) => void }) => {
  const navigate = useNavigate();
  const [email, setEmail] = useState("admin@uit.edu.vn");
  const [password, setPassword] = useState("password123");
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const session = await apiFetch<Session>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password })
      });
      if (!["admin", "lecturer", "canteen_staff"].includes(session.user.role)) {
        throw new Error("Tài khoản này không có quyền vào admin portal.");
      }
      onLoggedIn(session);
      navigate("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không đăng nhập được.");
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[linear-gradient(140deg,_#111827,_#292524_55%,_#f59e0b)] px-4">
      <form className="login-card" onSubmit={submit}>
        <p className="text-xs uppercase tracking-[0.28em] text-amber-300">UIT operations</p>
        <h1 className="mt-2 text-3xl font-semibold text-white">Đăng nhập portal</h1>
        <p className="mt-2 text-sm text-stone-300">Dùng `admin@uit.edu.vn`, `lecturer@uit.edu.vn`, hoặc `canteen@uit.edu.vn`.</p>
        <label className="field mt-6">
          <span>Email</span>
          <input value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <label className="field mt-4">
          <span>Mật khẩu</span>
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        {error ? <p className="mt-3 text-sm text-rose-300">{error}</p> : null}
        <button className="primary-button mt-6 w-full" type="submit">Vào Portal</button>
      </form>
    </div>
  );
};

const DashboardPage = ({ session }: { session: Session }) => {
  const dashboard = usePolling<DashboardData>(() => apiFetch("/api/admin/dashboard", {}, session), [session.access], 10_000);
  const revenue = usePolling<Array<{ date: string; amount: number }>>(() => apiFetch("/api/admin/reports/revenue", {}, session), [session.access], 20_000);
  const attendance = usePolling<AttendanceRow[]>(() => apiFetch("/api/admin/reports/attendance", {}, session), [session.access], 20_000);

  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Sinh viên active hôm nay" value={dashboard.data?.studentActiveToday ?? 0} />
        <MetricCard label="Giao dịch hôm nay" value={currency.format(dashboard.data?.transactionsTodayAmount ?? 0)} />
        <MetricCard label="Đang trong campus" value={dashboard.data?.insideCampusTotal ?? 0} />
        <MetricCard label="Đơn đang chờ xử lý" value={dashboard.data?.pendingOrders ?? 0} />
      </section>
      <section className="grid gap-6 xl:grid-cols-[1.3fr_0.7fr]">
        <div className="surface">
          <div className="surface-header">
            <h3>Doanh thu 7 ngày</h3>
            <span>Payment</span>
          </div>
          <ChartWrap>
            <ResponsiveContainer>
              <AreaChart data={revenue.data ?? []}>
                <defs>
                  <linearGradient id="revenueFill" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.55} />
                    <stop offset="100%" stopColor="#f59e0b" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#e7e5e4" strokeDasharray="4 4" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Area dataKey="amount" fill="url(#revenueFill)" stroke="#d97706" strokeWidth={2} type="monotone" />
              </AreaChart>
            </ResponsiveContainer>
          </ChartWrap>
        </div>
        <div className="surface">
          <div className="surface-header">
            <h3>Top món hôm nay</h3>
            <span>Căng tin</span>
          </div>
          <div className="space-y-3">
            {dashboard.data?.topItems.map((item) => (
              <div className="list-row" key={item.menuItemId}>
                <div>
                  <strong>{item.name}</strong>
                  <p>{item.quantity} suất</p>
                </div>
              </div>
            )) ?? <p className="text-sm text-stone-500">Đang tải top items...</p>}
          </div>
        </div>
      </section>
      <section className="surface">
        <div className="surface-header">
          <h3>Tỷ lệ điểm danh theo lớp</h3>
          <span>Today</span>
        </div>
        <ChartWrap>
          <ResponsiveContainer>
            <BarChart data={attendance.data ?? []}>
              <CartesianGrid stroke="#e7e5e4" strokeDasharray="4 4" />
              <XAxis dataKey="classCode" tick={{ fontSize: 12 }} />
              <YAxis tickFormatter={(value) => `${Math.round(value * 100)}%`} tick={{ fontSize: 12 }} />
              <Tooltip />
              <Bar dataKey="ratio" fill="#0f766e" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartWrap>
      </section>
    </div>
  );
};

const AttendancePage = ({ session }: { session: Session }) => {
  const attendance = usePolling<AttendanceRow[]>(() => apiFetch("/api/admin/reports/attendance", {}, session), [session.access], 10_000);
  return (
    <div className="surface">
      <div className="surface-header">
        <h3>Điểm danh theo lớp</h3>
        <span>Lecturer/Admin</span>
      </div>
      <div className="space-y-3">
        {attendance.data?.map((item) => (
          <div className="list-row" key={item.classId}>
            <div>
              <strong>{item.classCode} · {item.className}</strong>
              <p>{item.presentCount}/{item.enrolledCount} sinh viên</p>
            </div>
            <span>{Math.round(item.ratio * 100)}%</span>
          </div>
        )) ?? <p className="text-sm text-stone-500">Đang tải dữ liệu điểm danh...</p>}
      </div>
    </div>
  );
};

const TransactionsPage = ({ session }: { session: Session }) => {
  const revenue = usePolling<Array<{ date: string; amount: number }>>(() => apiFetch("/api/admin/reports/revenue", {}, session), [session.access], 20_000);
  return (
    <div className="surface">
      <div className="surface-header">
        <h3>Báo cáo giao dịch</h3>
        <button className="secondary-button">Export sẽ bổ sung</button>
      </div>
      <div className="space-y-3">
        {revenue.data?.map((row) => (
          <div className="list-row" key={row.date}>
            <div>
              <strong>{row.date}</strong>
              <p>Doanh thu ngày</p>
            </div>
            <span>{currency.format(row.amount)}</span>
          </div>
        )) ?? <p className="text-sm text-stone-500">Đang tải dữ liệu doanh thu...</p>}
      </div>
    </div>
  );
};

const ORDER_STATUS_STEPS: Array<{ value: string; label: string; color: string }> = [
  { value: "pending", label: "Chờ xác nhận", color: "bg-amber-100 text-amber-800 border-amber-300" },
  { value: "preparing", label: "Đang chuẩn bị", color: "bg-blue-100 text-blue-800 border-blue-300" },
  { value: "ready", label: "Sẵn sàng nhận", color: "bg-emerald-100 text-emerald-800 border-emerald-300" },
  { value: "completed", label: "Đã nhận", color: "bg-stone-100 text-stone-600 border-stone-300" },
];

const DiningPage = ({ session }: { session: Session }) => {
  const orders = usePolling<Order[]>(() => apiFetch("/api/admin/orders", {}, session), [session.access], 4_000);
  const [updating, setUpdating] = useState<string | null>(null);

  const updateStatus = async (id: string, status: string) => {
    setUpdating(id + status);
    try {
      await apiFetch(`/api/orders/${id}/status`, {
        method: "PUT",
        body: JSON.stringify({ status })
      }, session);
      const next = await apiFetch<Order[]>("/api/admin/orders", {}, session);
      orders.setData(next);
    } finally {
      setUpdating(null);
    }
  };

  const active = (orders.data ?? []).filter((o) => o.status !== "completed" && o.status !== "cancelled");
  const done = (orders.data ?? []).filter((o) => o.status === "completed" || o.status === "cancelled");

  return (
    <div className="surface space-y-4">
      <div className="surface-header">
        <h3>Đơn đặt món realtime</h3>
        <span className="text-emerald-600 font-semibold">{active.length} đơn đang xử lý</span>
      </div>

      {/* Active orders */}
      <div className="space-y-3">
        {active.length === 0 && <p className="text-sm text-stone-500">Không có đơn hàng đang chờ.</p>}
        {active.map((order) => {
          const currentStep = ORDER_STATUS_STEPS.find((s) => s.value === order.status);
          return (
            <div className="rounded-3xl border border-stone-200 bg-white shadow-sm p-4" key={order.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <strong>{order.customer.fullName}</strong>
                    <span className="text-xs text-stone-500">{order.customer.studentCode}</span>
                    {currentStep && (
                      <span className={`text-xs rounded-full px-2 py-0.5 border font-medium ${currentStep.color}`}>
                        {currentStep.label}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-stone-600">{order.items.map((item) => `${item.name} ×${item.quantity}`).join(", ")}</p>
                  <p className="mt-1 text-xs text-stone-400">
                    {currency.format(order.totalAmount)} · Nhận lúc {new Date(order.pickupTime).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })} ngày {new Date(order.pickupTime).toLocaleDateString("vi-VN")}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {ORDER_STATUS_STEPS.filter((s) => s.value !== "completed").map((step) => (
                  <button
                    key={step.value}
                    disabled={updating !== null}
                    className={`chip text-xs ${order.status === step.value ? "chip-active" : ""}`}
                    onClick={() => void updateStatus(order.id, step.value)}
                  >
                    {updating === order.id + step.value ? "..." : step.label}
                  </button>
                ))}
                <button
                  disabled={updating !== null}
                  className="chip text-xs text-emerald-700"
                  onClick={() => void updateStatus(order.id, "completed")}
                >
                  {updating === order.id + "completed" ? "..." : "✓ Đã nhận"}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Completed orders */}
      {done.length > 0 && (
        <details className="rounded-2xl border border-stone-200 p-4">
          <summary className="text-sm text-stone-500 cursor-pointer select-none">{done.length} đơn đã hoàn thành</summary>
          <div className="space-y-2 mt-3">
            {done.map((order) => (
              <div className="flex items-center justify-between gap-3 text-sm" key={order.id}>
                <span className="text-stone-600">{order.customer.fullName} — {order.items.map((i) => `${i.name} ×${i.quantity}`).join(", ")}</span>
                <span className="text-stone-400">{currency.format(order.totalAmount)}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
};

const GatesPage = ({ session }: { session: Session }) => {
  const live = usePolling<GateLive>(() => apiFetch("/api/gates/live", {}, session), [session.access], 5_000);
  const series = usePolling<GateSeries>(() => apiFetch("/api/gates/series", {}, session), [session.access], 5_000);

  const chartData = useMemo(() => {
    const grouped = new Map<string, { bucketStart: string; inCount: number; outCount: number }>();
    for (const point of series.data ?? []) {
      const entry = grouped.get(point.bucketStart) ?? { bucketStart: point.bucketStart, inCount: 0, outCount: 0 };
      entry.inCount += point.inCount;
      entry.outCount += point.outCount;
      grouped.set(point.bucketStart, entry);
    }
    return Array.from(grouped.values()).slice(-20);
  }, [series.data]);

  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-3">
        <MetricCard label="Đang trong campus" value={live.data?.insideCampusTotal ?? 0} />
        <MetricCard label="IN / phút" value={live.data?.inPerMinute ?? 0} />
        <MetricCard label="OUT / phút" value={live.data?.outPerMinute ?? 0} />
      </section>
      <section className="surface">
        <div className="surface-header">
          <h3>Gate flow 1 phút</h3>
          <span>Tick 5s</span>
        </div>
        <ChartWrap>
          <ResponsiveContainer>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="inFill" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="#2563eb" stopOpacity={0.45} />
                  <stop offset="100%" stopColor="#2563eb" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="outFill" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="#ef4444" stopOpacity={0.45} />
                  <stop offset="100%" stopColor="#ef4444" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#e7e5e4" strokeDasharray="4 4" />
              <XAxis dataKey="bucketStart" tickFormatter={(value) => new Date(value).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })} tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Area dataKey="inCount" fill="url(#inFill)" stroke="#2563eb" strokeWidth={2} type="monotone" />
              <Area dataKey="outCount" fill="url(#outFill)" stroke="#ef4444" strokeWidth={2} type="monotone" />
            </AreaChart>
          </ResponsiveContainer>
        </ChartWrap>
      </section>
      <section className="surface">
        <div className="surface-header">
          <h3>Per gate breakdown</h3>
          <span>Realtime</span>
        </div>
        <ChartWrap>
          <ResponsiveContainer>
            <BarChart data={live.data?.gates ?? []}>
              <CartesianGrid stroke="#e7e5e4" strokeDasharray="4 4" />
              <XAxis dataKey="gateCode" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Bar dataKey="inCount" fill="#0f766e" radius={[8, 8, 0, 0]} />
              <Bar dataKey="outCount" fill="#b91c1c" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartWrap>
      </section>
    </div>
  );
};

const HeatmapPage = ({ session }: { session: Session }) => {
  const live = usePolling<HeatmapZone[]>(() => apiFetch("/api/canteen/heatmap/live", {}, session), [session.access], 5_000);
  const replay = usePolling<HeatmapReplayRow[]>(() => apiFetch("/api/canteen/heatmap/replay", {}, session), [session.access], 12_000);
  const [step, setStep] = useState(0);

  const groupedReplay = useMemo(() => {
    const grouped = new Map<string, HeatmapReplayRow[]>();
    for (const row of replay.data ?? []) {
      const bucket = grouped.get(row.bucketStart) ?? [];
      bucket.push(row);
      grouped.set(row.bucketStart, bucket);
    }
    return Array.from(grouped.entries()).map(([bucketStart, rows]) => ({ bucketStart, rows }));
  }, [replay.data]);

  const replaySnapshot = groupedReplay[step]?.rows;
  const effectiveZones = replaySnapshot
    ? replaySnapshot.map((row) => ({
        zoneCode: row.zoneCode,
        name: row.zoneName,
        occupied: row.avgOccupied,
        capacity: row.capacity,
        ratio: row.capacity === 0 ? 0 : row.avgOccupied / row.capacity,
        level: row.avgOccupied / row.capacity >= 0.9 ? "critical" : row.avgOccupied / row.capacity >= 0.7 ? "high" : row.avgOccupied / row.capacity >= 0.4 ? "medium" : "low",
        bounds: (live.data?.find((zone) => zone.zoneCode === row.zoneCode)?.bounds ?? [0, 0, 0, 0]) as [number, number, number, number]
      }))
    : (live.data ?? []);

  const colorFor = (ratio: number) =>
    chroma.scale(["#10b981", "#facc15", "#fb923c", "#ef4444"]).domain([0, 1])(Math.min(Math.max(ratio, 0), 1)).alpha(0.55).css();

  return (
    <div className="grid gap-6 xl:grid-cols-[1.3fr_0.7fr]">
      <section className="surface">
        <div className="surface-header">
          <h3>Canteen heatmap</h3>
          <span>Leaflet Simple CRS</span>
        </div>
        <div className="h-[560px] overflow-hidden rounded-3xl border border-stone-200">
          <MapContainer bounds={[[0, 0], [460, 640]]} className="h-full w-full" crs={L.CRS.Simple} zoomControl={false}>
            <ImageOverlay bounds={[[0, 0], [460, 640]]} url="/static/canteen-floor.svg" />
            {effectiveZones.map((zone) => (
              <Rectangle
                bounds={[[zone.bounds[1], zone.bounds[0]], [zone.bounds[3], zone.bounds[2]]]}
                key={zone.zoneCode}
                pathOptions={{
                  fillColor: colorFor(zone.ratio),
                  color: colorFor(Math.max(zone.ratio, 0.2)),
                  fillOpacity: 0.7,
                  weight: 2
                }}
              >
                <LeafletTooltip direction="top" permanent={false}>
                  <div className="text-sm">
                    <strong>{zone.name}</strong>
                    <div>{Math.round(zone.occupied)} / {zone.capacity}</div>
                    <div>{Math.round(zone.ratio * 100)}%</div>
                  </div>
                </LeafletTooltip>
              </Rectangle>
            ))}
          </MapContainer>
        </div>
      </section>
      <section className="space-y-6">
        <div className="surface">
          <div className="surface-header">
            <h3>KPI zone</h3>
            <span>Live</span>
          </div>
          <div className="space-y-3">
            {[...effectiveZones].sort((a, b) => b.ratio - a.ratio).slice(0, 4).map((zone) => (
              <div className="list-row" key={zone.zoneCode}>
                <div>
                  <strong>{zone.name}</strong>
                  <p>{Math.round(zone.occupied)}/{zone.capacity} chỗ</p>
                </div>
                <span>{Math.round(zone.ratio * 100)}%</span>
              </div>
            ))}
          </div>
        </div>
        <div className="surface">
          <div className="surface-header">
            <h3>Replay 1 giờ</h3>
            <span>{groupedReplay[step]?.bucketStart ? new Date(groupedReplay[step].bucketStart).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }) : "Live"}</span>
          </div>
          <input className="w-full" max={Math.max(groupedReplay.length - 1, 0)} min={0} onChange={(event) => setStep(Number(event.target.value))} type="range" value={Math.min(step, Math.max(groupedReplay.length - 1, 0))} />
          <p className="mt-3 text-sm text-stone-500">Replay đang dùng bucket 5 phút từ dữ liệu rollup; asset nền là schematic placeholder nội bộ.</p>
        </div>
      </section>
    </div>
  );
};

const ReportsPage = ({ session }: { session: Session }) => {
  const topItems = usePolling<Array<{ menuItemId: string; name: string; quantity: number }>>(() => apiFetch("/api/admin/reports/top-items", {}, session), [session.access], 20_000);
  return (
    <div className="surface">
      <div className="surface-header">
        <h3>Reports view-first</h3>
        <button className="secondary-button">Export sẽ bổ sung</button>
      </div>
      <div className="space-y-3">
        {topItems.data?.map((row) => (
          <div className="list-row" key={row.menuItemId}>
            <div>
              <strong>{row.name}</strong>
              <p>Top selling item</p>
            </div>
            <span>{row.quantity}</span>
          </div>
        )) ?? <p className="text-sm text-stone-500">Đang tải dữ liệu báo cáo...</p>}
      </div>
    </div>
  );
};

const StudentsPage = ({ session }: { session: Session }) => {
  const students = usePolling<StudentRow[]>(() => apiFetch("/api/admin/students", {}, session), [session.access], 20_000);
  return (
    <div className="surface">
      <div className="surface-header">
        <h3>Danh sách sinh viên</h3>
        <span>Readonly</span>
      </div>
      <div className="space-y-3">
        {students.data?.map((student) => (
          <div className="list-row" key={student.id}>
            <div>
              <strong>{student.fullName} · {student.studentCode}</strong>
              <p>{student.email} · {student.className}</p>
            </div>
            <span>{currency.format(student.walletBalance)}</span>
          </div>
        )) ?? <p className="text-sm text-stone-500">Đang tải danh sách sinh viên...</p>}
      </div>
    </div>
  );
};

const MetricCard = ({ label, value }: { label: string; value: string | number }) => (
  <div className="metric-card">
    <p>{label}</p>
    <strong>{value}</strong>
  </div>
);

const ChartWrap = ({ children }: { children: React.ReactNode }) => <div className="h-80 w-full">{children}</div>;

const Protected = ({ session, onLogout, children }: { session: Session | null; onLogout: () => void; children: React.ReactNode }) => {
  if (!session) return <Navigate replace to="/login" />;
  if (!["admin", "lecturer", "canteen_staff"].includes(session.user.role)) {
    return <Navigate replace to="/login" />;
  }
  return <PortalShell onLogout={onLogout} session={session}>{children}</PortalShell>;
};

export const App = () => {
  const { session, setSession } = useSessionState();
  const handleLogout = async () => {
    await logoutSession(session);
    setSession(null);
  };

  return (
    <Routes>
      <Route element={session ? <Navigate replace to="/dashboard" /> : <LoginPage onLoggedIn={setSession} />} path="/login" />
      <Route
        path="*"
        element={
          <Protected onLogout={() => void handleLogout()} session={session}>
            <Routes>
              <Route element={session ? <DashboardPage session={session} /> : null} path="/dashboard" />
              <Route element={session ? <AttendancePage session={session} /> : null} path="/attendance" />
              <Route element={session ? <TransactionsPage session={session} /> : null} path="/transactions" />
              <Route element={session ? <DiningPage session={session} /> : null} path="/dining" />
              <Route element={session ? <GatesPage session={session} /> : null} path="/gates" />
              <Route element={session ? <HeatmapPage session={session} /> : null} path="/canteen" />
              <Route element={session ? <ReportsPage session={session} /> : null} path="/reports" />
              <Route element={session ? <StudentsPage session={session} /> : null} path="/students" />
              <Route element={<Navigate replace to="/dashboard" />} path="*" />
            </Routes>
          </Protected>
        }
      />
    </Routes>
  );
};
