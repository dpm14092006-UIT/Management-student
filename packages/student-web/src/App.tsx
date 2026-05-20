import { Home, IdCard, Map, Salad, UserRound, Wallet, CalendarDays, LogOut, Flame, Activity } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { io } from "socket.io-client";

import { apiFetch, logoutSession, readSession, writeSession } from "./api";
import type { Session, SessionUser } from "./types";

type MenuItem = {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  imageUrl: string;
  prepTimeMin: number;
  stockToday: number;
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
};

type Order = {
  id: string;
  status: string;
  totalAmount: number;
  totalCalories: number;
  pickupTime: string;
  qrCode: string;
  pickupToken: string;
  createdAt: string;
  items: Array<{ id: string; name: string; quantity: number; unitPrice: number; calories: number }>;
};

type DailyNutrition = {
  date: string;
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  dailyTarget: number;
  progress: number;
  items: Array<{ name: string; quantity: number; calories: number }>;
  orderCount: number;
};

type AttendanceStat = {
  enrolledCount: number;
  presentCount: number;
  ratio: number;
};

type HeatmapZone = {
  zoneCode: string;
  name: string;
  occupied: number;
  capacity: number;
  ratio: number;
  level: "low" | "medium" | "high" | "critical";
};

const currency = new Intl.NumberFormat("vi-VN", {
  style: "currency",
  currency: "VND",
  maximumFractionDigits: 0
});

const FALLBACK_FOOD_IMG =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 96 96'><rect fill='%23292524' width='96' height='96' rx='16'/><text x='50%25' y='52%25' fill='%23f59e0b' font-family='sans-serif' font-size='32' font-weight='700' text-anchor='middle' dominant-baseline='middle'>🍽</text></svg>";

const resolveMenuImage = (item: MenuItem) => {
  // Demo seed images are remote and can expire; keep the PWA stable offline/local.
  if (!item.imageUrl || item.imageUrl.startsWith("https://images.unsplash.com/")) {
    return FALLBACK_FOOD_IMG;
  }
  return item.imageUrl;
};

const handleImgError = (event: React.SyntheticEvent<HTMLImageElement>) => {
  const target = event.currentTarget;
  if (target.src !== FALLBACK_FOOD_IMG) {
    target.src = FALLBACK_FOOD_IMG;
  }
};

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
        if (alive) {
          setError(err instanceof Error ? err.message : "Đã có lỗi xảy ra.");
        }
      } finally {
        if (alive) setLoading(false);
      }
    };

    void run();
    if (!interval) {
      return () => {
        alive = false;
      };
    }

    const timer = window.setInterval(run, interval);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, deps);

  return { data, error, loading, setData };
};

const AppShell = ({
  user,
  onLogout,
  children
}: {
  user: SessionUser;
  onLogout: () => void;
  children: React.ReactNode;
}) => {
  const location = useLocation();
  const items = [
    { to: "/", label: "Trang chủ", icon: Home },
    { to: "/dining", label: "Căn tin", icon: Salad },
    { to: "/nutrition", label: "Calo", icon: Flame },
    { to: "/wallet", label: "Ví", icon: Wallet },
    { to: "/attendance", label: "Điểm danh", icon: CalendarDays },
    { to: "/profile", label: "Hồ sơ", icon: UserRound }
  ];

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(245,158,11,0.18),_transparent_28%),linear-gradient(180deg,_#0c0a09_0%,_#1c1917_100%)] text-stone-100">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-4 pb-24 pt-5">
        <header className="mb-4 rounded-3xl border border-white/10 bg-white/8 p-4 backdrop-blur">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.28em] text-amber-200/80">UIT Student PWA</p>
              <h1 className="mt-1 text-xl font-semibold">{user.fullName}</h1>
              <p className="text-sm text-stone-300">{user.studentCode} · {user.className}</p>
            </div>
            <button className="icon-button" onClick={onLogout} title="Đăng xuất">
              <LogOut size={18} />
            </button>
          </div>
        </header>

        <main className="flex-1">{children}</main>

        <nav className="fixed bottom-4 left-1/2 z-20 flex w-[calc(100%-1.5rem)] max-w-md -translate-x-1/2 items-center justify-between rounded-3xl border border-white/10 bg-stone-950/88 px-3 py-2 shadow-2xl shadow-black/40 backdrop-blur">
          {items.map((item) => {
            const Icon = item.icon;
            const active = location.pathname === item.to;
            return (
              <Link key={item.to} className={`nav-item ${active ? "nav-item-active" : ""}`} to={item.to}>
                <Icon size={18} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
};

const LoginPage = ({ onLoggedIn }: { onLoggedIn: (session: Session) => void }) => {
  const navigate = useNavigate();
  const [email, setEmail] = useState("20520001@gm.uit.edu.vn");
  const [password, setPassword] = useState("password123");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const session = await apiFetch<Session>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password })
      });
      onLoggedIn(session);
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không đăng nhập được.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[linear-gradient(160deg,_#0c0a09,_#292524_60%,_#451a03)] px-4 text-stone-100">
      <form className="card w-full max-w-md space-y-4" onSubmit={submit}>
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-amber-300">Smart Campus Integrated System</p>
          <h1 className="mt-2 text-3xl font-semibold">Đăng nhập sinh viên</h1>
          <p className="mt-2 text-sm text-stone-300">Bản web-only cho demo 6 module tại UIT.</p>
        </div>
        <div className="space-y-3">
          <label className="field">
            <span>Email</span>
            <input value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <label className="field">
            <span>Mật khẩu</span>
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
        </div>
        {error ? <p className="text-sm text-rose-300">{error}</p> : null}
        <button className="primary-button w-full" disabled={loading} type="submit">
          {loading ? "Đang đăng nhập..." : "Vào PWA"}
        </button>
      </form>
    </div>
  );
};

const HomePage = ({ session }: { session: Session }) => {
  const qr = usePolling<{ token: string; expiresIn: number }>(() => apiFetch("/api/students/me/qrcode", {}, session), [session.access], 55_000);
  // Profile data changes rarely; 60s poll is plenty.
  const me = usePolling<{ walletBalance: number; classes: Array<{ id: string; name: string; roomLabel: string }> }>(
    () => apiFetch("/api/students/me", {}, session),
    [session.access],
    60_000
  );
  const nutrition = usePolling<DailyNutrition>(
    () => apiFetch("/api/students/me/nutrition/daily", {}, session),
    [session.access],
    60_000
  );

  return (
    <div className="space-y-4">
      <section className="hero-card">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-amber-200/80">Digital Student ID</p>
            <h2 className="mt-1 text-2xl font-semibold">{session.user.studentCode}</h2>
            <p className="text-sm text-stone-300">{session.user.faculty}</p>
          </div>
          <IdCard className="text-amber-300" size={28} />
        </div>
        <div className="mt-4 grid grid-cols-[1fr_120px] gap-4">
          <div className="rounded-3xl bg-stone-900/70 p-4">
            <p className="text-sm text-stone-300">QR đổi sau mỗi 60 giây để chống chụp lại.</p>
            <p className="mt-4 text-3xl font-semibold">{currency.format(me.data?.walletBalance ?? session.user.walletBalance ?? 0)}</p>
            <p className="text-sm text-stone-400">Số dư ví hiện tại</p>
          </div>
          <div className="rounded-3xl bg-white p-3">
            {qr.data?.token ? <QRCodeSVG height={96} value={qr.data.token} width={96} /> : <div className="qr-placeholder">...</div>}
          </div>
        </div>
      </section>

      <Link
        to="/nutrition"
        className="block rounded-3xl border border-orange-300/20 bg-gradient-to-br from-orange-500/15 to-amber-500/5 p-4 transition active:scale-[0.99]"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-orange-500/20">
              <Flame className="text-orange-300" size={22} />
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-orange-200/80">Calo hôm nay</p>
              <p className="text-xl font-semibold text-stone-100 m-0">
                {nutrition.data?.calories ?? 0}
                <span className="ml-1 text-xs text-stone-400">/ {nutrition.data?.dailyTarget ?? 2000} kcal</span>
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs text-stone-400 m-0">{nutrition.data?.orderCount ?? 0} đơn</p>
            <p className="text-[11px] text-orange-300 m-0">Xem chi tiết →</p>
          </div>
        </div>
        <div className="mt-3 h-2 rounded-full bg-stone-900/80 overflow-hidden">
          <div
            className={`h-full transition-all duration-500 ${
              (nutrition.data?.calories ?? 0) > (nutrition.data?.dailyTarget ?? 2000) ? "bg-rose-400" : "bg-orange-400"
            }`}
            style={{ width: `${Math.min(((nutrition.data?.calories ?? 0) / (nutrition.data?.dailyTarget ?? 2000)) * 100, 100)}%` }}
          />
        </div>
      </Link>

      <section className="card">
        <div className="section-header">
          <h3>Ca học hôm nay</h3>
          <p className="text-sm text-stone-400 m-0">{me.data?.classes.length ?? 0} lớp</p>
        </div>
        <div className="space-y-3">
          {me.data?.classes.map((course) => (
            <div className="list-row" key={course.id}>
              <div>
                <strong>{course.name}</strong>
                <p className="text-xs text-stone-400 mt-0.5">{course.roomLabel}</p>
              </div>
            </div>
          )) ?? <p className="text-sm text-stone-400">Đang tải dữ liệu lớp học...</p>}
        </div>
      </section>
    </div>
  );
};

const AttendancePage = ({ session }: { session: Session }) => {
  const me = usePolling<{ classes: Array<{ id: string; name: string; roomLabel: string }> }>(() => apiFetch("/api/students/me", {}, session), [session.access], 30_000);
  const [beaconUuid, setBeaconUuid] = useState("550e8400-e29b-41d4-a716-446655440001");
  const [selectedClass, setSelectedClass] = useState<string>("");
  const [message, setMessage] = useState<string | null>(null);
  const [stats, setStats] = useState<AttendanceStat | null>(null);

  useEffect(() => {
    if (me.data?.classes[0] && !selectedClass) setSelectedClass(me.data.classes[0].id);
  }, [me.data, selectedClass]);

  useEffect(() => {
    if (!selectedClass) return;
    void apiFetch<AttendanceStat>(`/api/attendance/stats/class/${selectedClass}`, {}, session).then(setStats).catch(() => undefined);
  }, [selectedClass, session]);

  const submit = async () => {
    const response = await apiFetch<{ className: string; alreadyCheckedIn: boolean }>("/api/attendance/checkin", {
      method: "POST",
      body: JSON.stringify({ beaconUuid, classId: selectedClass })
    }, session);
    setMessage(response.alreadyCheckedIn ? `Bạn đã được ghi nhận vào lớp ${response.className}.` : `Đã điểm danh lớp ${response.className}.`);
    const refreshed = await apiFetch<AttendanceStat>(`/api/attendance/stats/class/${selectedClass}`, {}, session);
    setStats(refreshed);
  };

  return (
    <div className="space-y-4">
      <section className="card space-y-4">
        <div className="section-header">
          <h3>Tự động điểm danh</h3>
          <span>Bluetooth + QR</span>
        </div>
        <p className="text-sm text-stone-300">Web Bluetooth sẽ được bật khi trình duyệt hỗ trợ. Bản demo hiện ưu tiên beacon UUID hoặc QR fallback.</p>
        <label className="field">
          <span>Lớp học</span>
          <select value={selectedClass} onChange={(event) => setSelectedClass(event.target.value)}>
            {me.data?.classes.map((course) => (
              <option key={course.id} value={course.id}>
                {course.name} · {course.roomLabel}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Beacon UUID</span>
          <input value={beaconUuid} onChange={(event) => setBeaconUuid(event.target.value)} />
        </label>
        <button className="primary-button" onClick={() => void submit()}>Check-in bằng beacon</button>
        {message ? <p className="text-sm text-emerald-300">{message}</p> : null}
      </section>
      <section className="card">
        <div className="section-header">
          <h3>Tỷ lệ tham gia hôm nay</h3>
          <span>{Math.round((stats?.ratio ?? 0) * 100)}%</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="metric-box">
            <strong>{stats?.presentCount ?? 0}</strong>
            <span>Đã điểm danh</span>
          </div>
          <div className="metric-box">
            <strong>{stats?.enrolledCount ?? 0}</strong>
            <span>Tổng đăng ký</span>
          </div>
        </div>
      </section>
    </div>
  );
};

const WalletPage = ({ session }: { session: Session }) => {
  const wallet = usePolling<{ balance: number }>(() => apiFetch("/api/wallet/balance", {}, session), [session.access], 30_000);
  const transactions = usePolling<Array<{ id: string; type: string; amount: number; description: string; createdAt: string }>>(
    () => apiFetch("/api/wallet/transactions", {}, session),
    [session.access],
    30_000
  );
  const [amount, setAmount] = useState(200000);

  const topup = async () => {
    await apiFetch("/api/wallet/topup", {
      method: "POST",
      body: JSON.stringify({ amount })
    }, session);
    const [nextWallet, nextTransactions] = await Promise.all([
      apiFetch<{ balance: number }>("/api/wallet/balance", {}, session),
      apiFetch<Array<{ id: string; type: string; amount: number; description: string; createdAt: string }>>("/api/wallet/transactions", {}, session)
    ]);
    wallet.setData(nextWallet);
    transactions.setData(nextTransactions);
  };

  return (
    <div className="space-y-4">
      <section className="hero-card">
        <p className="text-xs uppercase tracking-[0.25em] text-amber-200/80">Digital Wallet</p>
        <h2 className="mt-2 text-3xl font-semibold">{currency.format(wallet.data?.balance ?? 0)}</h2>
        <p className="mt-2 text-sm text-stone-300">Nạp ví mock để trình diễn thanh toán căn tin không tiền mặt.</p>
      </section>
      <section className="card space-y-3">
        <div className="section-header">
          <h3>Nạp tiền demo</h3>
          <span>Mock</span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {[100000, 200000, 500000].map((value) => (
            <button key={value} className={`chip ${amount === value ? "chip-active" : ""}`} onClick={() => setAmount(value)}>
              {currency.format(value)}
            </button>
          ))}
        </div>
        <button className="primary-button" onClick={() => void topup()}>Nạp tiền</button>
      </section>
      <section className="card">
        <div className="section-header">
          <h3>Lịch sử giao dịch</h3>
          <p className="text-sm text-stone-400 m-0">{transactions.data?.length ?? 0} giao dịch</p>
        </div>
        <div className="space-y-3">
          {transactions.data?.map((transaction) => (
            <div className="list-row" key={transaction.id}>
              <div>
                <strong>{transaction.description}</strong>
                <p>{new Date(transaction.createdAt).toLocaleString("vi-VN")}</p>
              </div>
              <span>{currency.format(transaction.amount)}</span>
            </div>
          )) ?? <p className="text-sm text-stone-400">Chưa có giao dịch.</p>}
        </div>
      </section>
    </div>
  );
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Chờ xác nhận",
  preparing: "Đang chuẩn bị",
  ready: "Sẵn sàng nhận",
  completed: "Đã nhận",
  cancelled: "Đã huỷ"
};

const STATUS_COLOR: Record<string, string> = {
  pending: "text-amber-300 bg-amber-900/30",
  preparing: "text-blue-300 bg-blue-900/30",
  ready: "text-emerald-300 bg-emerald-900/30",
  completed: "text-stone-400 bg-stone-800/40",
  cancelled: "text-rose-300 bg-rose-900/30"
};

const ALL_CATEGORIES = "Tất cả";

const localDatetimeNow = (offsetMs = 0) => {
  const d = new Date(Date.now() + offsetMs);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const DiningPage = ({ session }: { session: Session }) => {
  // Menu rarely changes — fetch once, no polling.
  // Orders/wallet updated via Socket.IO instantly; polling is a backup safety net.
  const menu = usePolling<MenuItem[]>(() => apiFetch("/api/menu", {}, session), [session.access], 0);
  const orders = usePolling<Order[]>(() => apiFetch("/api/orders/me", {}, session), [session.access], 30_000);
  const wallet = usePolling<{ balance: number }>(() => apiFetch("/api/wallet/balance", {}, session), [session.access], 30_000);
  const [cart, setCart] = useState<Record<string, number>>({});

  useEffect(() => {
    const socket = io({ path: "/socket.io" });
    socket.emit("join:orders", session.user.id);
    socket.on("order:status", () => {
      void apiFetch<Order[]>("/api/orders/me", {}, session).then(orders.setData).catch(() => {});
    });
    socket.on("order:new", () => {
      void apiFetch<Order[]>("/api/orders/me", {}, session).then(orders.setData).catch(() => {});
    });
    return () => { socket.disconnect(); };
  }, [session.access]);
  const [activeCategory, setActiveCategory] = useState(ALL_CATEGORIES);
  const [pickupTime, setPickupTime] = useState(() => localDatetimeNow(30 * 60 * 1000));
  const [submitting, setSubmitting] = useState(false);
  const [orderMessage, setOrderMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const updateCart = (itemId: string, nextQuantity: (current: number) => number) => {
    setOrderMessage(null);
    setCart((current) => ({
      ...current,
      [itemId]: Math.max(nextQuantity(current[itemId] ?? 0), 0)
    }));
  };

  const categories = useMemo(() => {
    const cats = Array.from(new Set((menu.data ?? []).map((item) => item.category)));
    return [ALL_CATEGORIES, ...cats.sort()];
  }, [menu.data]);

  const filteredMenu = useMemo(
    () => (menu.data ?? []).filter((item) => activeCategory === ALL_CATEGORIES || item.category === activeCategory),
    [menu.data, activeCategory]
  );

  const selectedItems = useMemo(
    () =>
      (menu.data ?? [])
        .filter((item) => (cart[item.id] ?? 0) > 0)
        .map((item) => ({ ...item, quantity: cart[item.id] ?? 0 })),
    [cart, menu.data]
  );

  const total = selectedItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const totalCalories = selectedItems.reduce((sum, item) => sum + item.calories * item.quantity, 0);
  const balance = wallet.data?.balance ?? 0;
  const walletLoading = total > 0 && wallet.data === null && !wallet.error;
  const insufficient = wallet.data !== null && balance < total && total > 0;
  const pickupDate = new Date(pickupTime);
  const pickupInvalid = Number.isNaN(pickupDate.getTime());
  const pickupInPast = !pickupInvalid && pickupDate <= new Date();

  const placeOrder = async () => {
    if (submitting) return;
    setOrderMessage(null);

    if (!selectedItems.length) {
      setOrderMessage({ kind: "error", text: "Vui lòng chọn ít nhất một món trước khi đặt." });
      return;
    }
    if (walletLoading) {
      setOrderMessage({ kind: "error", text: "Đang kiểm tra số dư ví, vui lòng thử lại sau vài giây." });
      return;
    }
    if (wallet.error) {
      setOrderMessage({ kind: "error", text: `Không kiểm tra được số dư ví: ${wallet.error}` });
      return;
    }
    if (insufficient) {
      setOrderMessage({ kind: "error", text: `Số dư không đủ. Cần thêm ${currency.format(total - balance)} trước khi đặt món.` });
      return;
    }
    if (pickupInvalid || pickupInPast) {
      setOrderMessage({ kind: "error", text: "Vui lòng chọn giờ nhận món trong tương lai." });
      return;
    }

    setSubmitting(true);
    try {
      await apiFetch("/api/orders", {
        method: "POST",
        body: JSON.stringify({
          items: selectedItems.map((item) => ({ menuItemId: item.id, quantity: item.quantity })),
          pickupTime: pickupDate.toISOString()
        })
      }, session);
      setCart({});
      setPickupTime(localDatetimeNow(30 * 60 * 1000));
      const [nextOrders, nextWallet] = await Promise.all([
        apiFetch<Order[]>("/api/orders/me", {}, session),
        apiFetch<{ balance: number }>("/api/wallet/balance", {}, session)
      ]);
      orders.setData(nextOrders);
      wallet.setData(nextWallet);
      setOrderMessage({ kind: "success", text: "Đặt món thành công! Chúng tôi sẽ thông báo khi món sẵn sàng." });
    } catch (err) {
      setOrderMessage({ kind: "error", text: err instanceof Error ? err.message : "Không đặt được món." });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {orderMessage ? (
        <div
          aria-live={orderMessage.kind === "error" ? "assertive" : "polite"}
          className={`fixed bottom-24 left-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 rounded-2xl border px-4 py-3 text-sm font-medium shadow-2xl backdrop-blur ${
            orderMessage.kind === "success"
              ? "border-emerald-300/30 bg-emerald-950/95 text-emerald-100"
              : "border-rose-300/30 bg-rose-950/95 text-rose-100"
          }`}
          role={orderMessage.kind === "error" ? "alert" : "status"}
        >
          {orderMessage.text}
        </div>
      ) : null}

      {/* Menu section */}
      <section className="card">
        <div className="section-header">
          <h3>Smart Dining</h3>
          <p className="text-amber-300 font-semibold text-sm m-0">{currency.format(balance)}</p>
        </div>

        {/* Category filter tabs */}
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-none mt-2">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`chip flex-shrink-0 ${activeCategory === cat ? "chip-active" : ""}`}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="space-y-3 mt-1">
          {menu.error ? (
            <p className="text-sm text-rose-300">Không tải được menu: {menu.error}</p>
          ) : menu.data === null ? (
            <p className="text-sm text-stone-400">Đang tải món...</p>
          ) : filteredMenu.length === 0 ? (
            <p className="text-sm text-stone-400">Không có món nào trong danh mục này.</p>
          ) : (
            filteredMenu.map((item) => (
              <div className="menu-card" key={item.id}>
                <img alt={item.name} src={resolveMenuImage(item)} loading="lazy" decoding="async" onError={handleImgError} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-1">
                    <strong className="leading-tight">{item.name}</strong>
                    <span className="text-xs text-stone-400 flex-shrink-0">{item.prepTimeMin} phút</span>
                  </div>
                  <p className="text-xs text-stone-400 mt-0.5 line-clamp-2">{item.description}</p>
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-orange-300/90">
                    <Flame size={11} />
                    <span>{item.calories} kcal</span>
                    <span className="text-stone-500">·</span>
                    <span className="text-stone-400">P {item.protein}g · F {item.fat}g · C {item.carbs}g</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="font-semibold">{currency.format(item.price)}</span>
                    <div className="quantity-control">
                      <button onClick={() => updateCart(item.id, (current) => current - 1)}>-</button>
                      <strong>{cart[item.id] ?? 0}</strong>
                      <button onClick={() => updateCart(item.id, (current) => current + 1)}>+</button>
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      {/* Cart section */}
      <section className="card space-y-3">
        <div className="section-header">
          <h3>Giỏ hàng</h3>
          <p className={`font-semibold text-sm m-0 ${total > 0 ? (insufficient ? "text-rose-300" : "text-emerald-300") : "text-stone-400"}`}>{currency.format(total)}</p>
        </div>

        {selectedItems.length > 0 && (
          <>
            <div className="space-y-1 text-sm text-stone-300">
              {selectedItems.map((item) => (
                <div key={item.id} className="flex justify-between">
                  <span>{item.name} × {item.quantity}</span>
                  <span>{currency.format(item.price * item.quantity)}</span>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between rounded-2xl border border-orange-300/20 bg-orange-500/10 px-3 py-2 text-sm text-orange-200">
              <span className="flex items-center gap-2"><Flame size={14} /> Tổng calo</span>
              <strong>{totalCalories} kcal</strong>
            </div>
          </>
        )}

        {insufficient && (
          <p className="text-xs text-rose-300 bg-rose-900/20 rounded-xl px-3 py-2">
            Số dư không đủ. Cần thêm {currency.format(total - balance)} — vui lòng nạp tiền trước.
          </p>
        )}

        <label className="field">
          <span>Giờ nhận món</span>
          <input
            type="datetime-local"
            value={pickupTime}
            min={localDatetimeNow(5 * 60 * 1000)}
            onChange={(e) => setPickupTime(e.target.value)}
          />
        </label>
        {(pickupInvalid || pickupInPast) && <p className="text-xs text-rose-300">Vui lòng chọn thời gian trong tương lai.</p>}

        <button
          className="primary-button w-full"
          disabled={submitting}
          onClick={() => void placeOrder()}
        >
          {submitting ? "Đang đặt..." : `Đặt ngay${total > 0 ? ` · ${currency.format(total)}` : ""}`}
        </button>
        {orderMessage ? (
          <p className={`text-sm rounded-xl px-3 py-2 ${orderMessage.kind === "success" ? "text-emerald-300 bg-emerald-900/20" : "text-rose-300 bg-rose-900/20"}`}>
            {orderMessage.text}
          </p>
        ) : null}
      </section>

      {/* My Orders section */}
      <section className="card">
        <div className="section-header">
          <h3>Đơn hàng của tôi</h3>
          <p className="text-stone-400 text-sm m-0">{orders.data?.length ?? 0} đơn</p>
        </div>
        <div className="space-y-3">
          {orders.data === null ? (
            <p className="text-sm text-stone-400">Đang tải...</p>
          ) : orders.data.length === 0 ? (
            <p className="text-sm text-stone-400">Chưa có đơn hàng.</p>
          ) : (
            orders.data.map((order) => (
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-3" key={order.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <strong>{currency.format(order.totalAmount)}</strong>
                      <span className={`text-xs rounded-full px-2 py-0.5 font-medium ${STATUS_COLOR[order.status] ?? "text-stone-400"}`}>
                        {STATUS_LABEL[order.status] ?? order.status}
                      </span>
                    </div>
                    <p className="text-xs text-stone-400 mt-1">
                      {order.items.map((item) => `${item.name} ×${item.quantity}`).join(", ")}
                    </p>
                    {order.totalCalories > 0 && (
                      <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-orange-300">
                        <Flame size={11} /> {order.totalCalories} kcal
                      </p>
                    )}
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-xs text-stone-400">Nhận lúc</p>
                    <p className="text-sm font-medium">
                      {new Date(order.pickupTime).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}
                    </p>
                    <p className="text-xs text-stone-500">
                      {new Date(order.pickupTime).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" })}
                    </p>
                  </div>
                </div>
                {order.status === "ready" && (
                  <div className="border-t border-white/10 pt-3 flex flex-col items-center gap-2">
                    <p className="text-xs text-emerald-300 font-medium">Quét QR để nhận món tại quầy</p>
                    <div className="rounded-2xl bg-white p-3">
                      <QRCodeSVG value={order.qrCode} size={120} />
                    </div>
                    <p className="text-xs text-stone-500 font-mono">{order.qrCode}</p>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
};

const NutritionPage = ({ session }: { session: Session }) => {
  const nutrition = usePolling<DailyNutrition>(
    () => apiFetch("/api/students/me/nutrition/daily", {}, session),
    [session.access],
    30_000
  );

  // Live update khi đặt đơn mới hoặc đổi trạng thái.
  useEffect(() => {
    const socket = io({ path: "/socket.io" });
    socket.emit("join:orders", session.user.id);
    const refresh = () => {
      void apiFetch<DailyNutrition>("/api/students/me/nutrition/daily", {}, session).then(nutrition.setData).catch(() => {});
    };
    socket.on("order:new", refresh);
    socket.on("order:status", refresh);
    return () => { socket.disconnect(); };
  }, [session.access]);

  if (nutrition.error) {
    return <p className="text-sm text-rose-300">Không tải được dữ liệu calo: {nutrition.error}</p>;
  }

  const data = nutrition.data;
  const progressPct = Math.round((data?.progress ?? 0) * 100);
  const overTarget = (data?.calories ?? 0) > (data?.dailyTarget ?? 2000);

  return (
    <div className="space-y-4">
      <section className="hero-card">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-amber-200/80">Theo dõi calo hôm nay</p>
            <h2 className="mt-1 flex items-baseline gap-2">
              <span className="text-3xl font-semibold">{data?.calories ?? 0}</span>
              <span className="text-sm text-stone-300">/ {data?.dailyTarget ?? 2000} kcal</span>
            </h2>
            <p className="mt-1 text-xs text-stone-400">
              {data?.orderCount ?? 0} đơn · {new Date().toLocaleDateString("vi-VN", { weekday: "long", day: "2-digit", month: "2-digit" })}
            </p>
          </div>
          <Flame className="text-orange-400" size={32} />
        </div>

        <div className="mt-4">
          <div className="h-3 rounded-full bg-stone-900/80 overflow-hidden">
            <div
              className={`h-full transition-all duration-500 ${
                overTarget ? "bg-rose-400" : progressPct > 75 ? "bg-amber-400" : "bg-emerald-400"
              }`}
              style={{ width: `${Math.min(progressPct, 100)}%` }}
            />
          </div>
          <div className="mt-1 flex justify-between text-[11px] text-stone-400">
            <span>{progressPct}% mục tiêu</span>
            {overTarget && <span className="text-rose-300">Đã vượt khuyến nghị</span>}
          </div>
        </div>
      </section>

      <section className="card">
        <div className="section-header">
          <h3>Macro hôm nay</h3>
          <Activity size={16} className="text-amber-300" />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="metric-box">
            <strong>{data?.protein ?? 0}g</strong>
            <span>Protein</span>
          </div>
          <div className="metric-box">
            <strong>{data?.fat ?? 0}g</strong>
            <span>Chất béo</span>
          </div>
          <div className="metric-box">
            <strong>{data?.carbs ?? 0}g</strong>
            <span>Carbs</span>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="section-header">
          <h3>Chi tiết món hôm nay</h3>
          <span>{data?.items.length ?? 0} món</span>
        </div>
        {data === null ? (
          <p className="text-sm text-stone-400">Đang tải...</p>
        ) : data.items.length === 0 ? (
          <p className="text-sm text-stone-400">Chưa đặt món nào hôm nay. Mở "Căn tin" để bắt đầu!</p>
        ) : (
          <div className="space-y-2">
            {data.items.map((entry, idx) => (
              <div className="list-row" key={`${entry.name}-${idx}`}>
                <div className="flex-1 min-w-0">
                  <strong className="block truncate">{entry.name}</strong>
                  <p className="text-xs text-stone-400 m-0">× {entry.quantity}</p>
                </div>
                <span className="inline-flex items-center gap-1 text-orange-300 text-sm font-medium">
                  <Flame size={12} /> {entry.calories} kcal
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card text-xs text-stone-400">
        <p className="leading-relaxed">
          <strong className="text-stone-200">Lưu ý:</strong> Số calo tính dựa trên đơn hàng đã đặt hôm nay (bao gồm pending, preparing, ready, completed). Mục tiêu 2000 kcal chỉ là khuyến nghị tổng quát, có thể khác với nhu cầu thực tế của bạn.
        </p>
      </section>
    </div>
  );
};

const CanteenPage = ({ session }: { session: Session }) => {
  const heatmap = usePolling<HeatmapZone[]>(() => apiFetch("/api/canteen/heatmap/live", {}, session), [session.access], 15_000);
  return (
    <div className="space-y-4">
      <section className="hero-card">
        <p className="text-xs uppercase tracking-[0.25em] text-amber-200/80">Canteen Preview</p>
        <h2 className="mt-2 text-2xl font-semibold">Xem nhanh chỗ trống trước giờ ăn</h2>
        <p className="mt-2 text-sm text-stone-300">Bản sinh viên chỉ hiển thị mức đông/vắng để chọn khu ít hàng chờ.</p>
      </section>
      <section className="grid grid-cols-2 gap-3">
        {heatmap.data?.map((zone) => (
          <div className={`zone-card zone-${zone.level}`} key={zone.zoneCode}>
            <div className="flex items-center justify-between gap-2">
              <strong>{zone.name}</strong>
              <span>{Math.round(zone.ratio * 100)}%</span>
            </div>
            <p>{zone.occupied}/{zone.capacity} chỗ</p>
          </div>
        )) ?? <p className="text-sm text-stone-400">Đang tải heatmap...</p>}
      </section>
    </div>
  );
};

const ProfilePage = ({ session }: { session: Session }) => (
  <div className="space-y-4">
    <section className="card">
      <div className="section-header">
        <h3>Thông tin sinh viên</h3>
        <span>UIT</span>
      </div>
      <div className="space-y-3">
        <div className="list-row"><strong>Họ tên</strong><span>{session.user.fullName}</span></div>
        <div className="list-row"><strong>MSSV</strong><span>{session.user.studentCode}</span></div>
        <div className="list-row"><strong>Email</strong><span>{session.user.email}</span></div>
        <div className="list-row"><strong>Khoa</strong><span>{session.user.faculty}</span></div>
        <div className="list-row"><strong>Lớp</strong><span>{session.user.className}</span></div>
      </div>
    </section>
  </div>
);

const Protected = ({
  session,
  children,
  onLogout
}: {
  session: Session | null;
  children: React.ReactNode;
  onLogout: () => void;
}) => {
  if (!session) return <Navigate replace to="/login" />;
  return <AppShell onLogout={onLogout} user={session.user}>{children}</AppShell>;
};

export const App = () => {
  const { session, setSession } = useSessionState();
  const handleLogout = async () => {
    await logoutSession(session);
    setSession(null);
  };

  return (
    <Routes>
      <Route element={session ? <Navigate replace to="/" /> : <LoginPage onLoggedIn={setSession} />} path="/login" />
      <Route
        path="*"
        element={
          <Protected onLogout={() => void handleLogout()} session={session}>
            <Routes>
              <Route element={session ? <HomePage session={session} /> : null} path="/" />
              <Route element={session ? <AttendancePage session={session} /> : null} path="/attendance" />
              <Route element={session ? <WalletPage session={session} /> : null} path="/wallet" />
              <Route element={session ? <DiningPage session={session} /> : null} path="/dining" />
              <Route element={session ? <NutritionPage session={session} /> : null} path="/nutrition" />
              <Route element={session ? <CanteenPage session={session} /> : null} path="/canteen" />
              <Route element={session ? <ProfilePage session={session} /> : null} path="/profile" />
            </Routes>
          </Protected>
        }
      />
    </Routes>
  );
};
