import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import sensible from "@fastify/sensible";
import fastifyStatic from "@fastify/static";
import {
  OrderStatus,
  Prisma,
  Role,
  TransactionStatus,
  TransactionType
} from "@prisma/client";
import {
  attendanceCheckinSchema,
  canteenDensityIngestSchema,
  createOrderSchema,
  gateIngestSchema,
  loginSchema,
  pickupOrderSchema,
  topupSchema,
  updateOrderStatusSchema
} from "@scis/shared";
import bcrypt from "bcryptjs";
import Fastify from "fastify";
import { nanoid } from "nanoid";

import { createSignedToken, signAccessToken, signRefreshToken, verifyAccessToken, verifyRefreshToken, verifySignedToken } from "./auth";
import { config } from "./config";
import { prisma } from "./db";
import { emitRoom, createRealtime } from "./realtime";
import { redis, redisSubscriber } from "./redis";
import type { AuthedRequest, CurrentUser } from "./types";
import { startOfDayUtc, startOfFiveMinuteBucket, startOfMinute, toLevel } from "./utils";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = Fastify({
  logger: {
    level: config.logLevel
  },
  trustProxy: config.trustedProxy
});

const publish = async (channel: string, payload: unknown) => {
  // Try Redis pubsub first — subscriber will trigger emit. If Redis is unavailable,
  // fall back to direct Socket.IO emit. Never do both, otherwise events double-fire.
  try {
    await redis.publish(channel, JSON.stringify(payload));
  } catch {
    await emitRoom(channel as never, payload);
  }
};

const refreshKey = (userId: string) => `auth:refresh:${userId}`;

const issueSession = async (user: {
  id: string;
  email: string;
  role: Role;
  fullName: string;
  studentCode?: string | null;
  faculty?: string | null;
  className?: string | null;
  wallet?: { balance: Prisma.Decimal } | null;
}) => {
  const refreshId = nanoid(24);
  const payload = {
    sub: user.id,
    role: user.role,
    email: user.email,
    jti: refreshId
  };
  const access = signAccessToken(payload);
  const refresh = signRefreshToken(payload);
  await redis.set(refreshKey(user.id), refreshId, "EX", config.refreshTtlSeconds).catch(() => {
    // Redis unavailable in dev — sessions won't persist across server restarts
  });

  return {
    access,
    refresh,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      studentCode: user.studentCode,
      faculty: user.faculty,
      className: user.className,
      walletBalance: Number(user.wallet?.balance ?? 0)
    }
  };
};

const revokeSession = async (userId: string) => {
  await redis.del(refreshKey(userId)).catch(() => {});
};

const checkRefreshSession = async (payload: CurrentUser & { jti?: string }) => {
  const stored = await redis.get(refreshKey(payload.id)).catch(() => null);
  // When Redis is unavailable, allow any valid refresh token (dev mode)
  if (stored === null) return Boolean(payload.jti);
  return Boolean(stored && payload.jti && stored === payload.jti);
};

const getRequestUser = async (request: AuthedRequest) => {
  const user = await prisma.user.findUnique({
    where: { id: request.user.id },
    include: {
      wallet: true
    }
  });

  if (!user) {
    throw app.httpErrors.unauthorized("Người dùng không tồn tại.");
  }

  return user;
};

const authGuard = async (request: AuthedRequest) => {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw app.httpErrors.unauthorized("Thiếu access token.");
  }

  try {
    const payload = verifyAccessToken(header.slice(7));
    request.user = {
      id: payload.sub,
      email: payload.email,
      role: payload.role as CurrentUser["role"]
    };
  } catch {
    throw app.httpErrors.unauthorized("Access token không hợp lệ.");
  }
};

const requireRoles = (roles: Role[]) => async (request: AuthedRequest) => {
  await authGuard(request);
  if (!roles.includes(request.user.role as Role)) {
    throw app.httpErrors.forbidden("Bạn không có quyền truy cập.");
  }
};

const ingestGuard = async (request: AuthedRequest) => {
  if (request.headers["x-service-token"] !== config.ingestServiceToken) {
    throw app.httpErrors.unauthorized("Sai service token.");
  }
};

const summarizeOrders = async () => {
  const orders = await prisma.order.findMany({
    include: {
      items: {
        include: {
          menuItem: true
        }
      },
      user: true
    },
    orderBy: {
      createdAt: "desc"
    },
    take: 200
  });

  return orders.map((order) => ({
    id: order.id,
    status: order.status,
    totalAmount: Number(order.totalAmount),
    pickupTime: order.pickupTime,
    createdAt: order.createdAt,
    qrCode: order.qrCode,
    pickupToken: order.pickupToken,
    customer: {
      id: order.user.id,
      fullName: order.user.fullName,
      studentCode: order.user.studentCode
    },
    items: order.items.map((item) => ({
      id: item.menuItemId,
      name: item.menuItem.name,
      quantity: item.quantity,
      unitPrice: Number(item.unitPrice)
    }))
  }));
};

const getInsideCampusTotal = async () => {
  const stored = await redis.get("campus:inside").catch(() => null);
  return Number(stored ?? 0);
};

const setInsideCampusTotal = async (direction: "in" | "out") => {
  try {
    const value = direction === "in" ? await redis.incr("campus:inside") : await redis.decr("campus:inside");
    if (value < 0) {
      await redis.set("campus:inside", "0").catch(() => {});
      return 0;
    }
    return value;
  } catch {
    return 0;
  }
};

const getGateLiveSnapshot = async () => {
  const since = new Date(Date.now() - 60_000);
  const recentEvents = await prisma.gateEvent.findMany({
    where: {
      occurredAt: {
        gte: since
      }
    },
    include: {
      gate: true
    }
  });

  const byGate = new Map<string, { gateCode: string; inCount: number; outCount: number }>();
  let inPerMinute = 0;
  let outPerMinute = 0;

  for (const event of recentEvents) {
    const entry = byGate.get(event.gate.code) ?? {
      gateCode: event.gate.code,
      inCount: 0,
      outCount: 0
    };
    if (event.direction === "in") {
      entry.inCount += 1;
      inPerMinute += 1;
    } else {
      entry.outCount += 1;
      outPerMinute += 1;
    }
    byGate.set(event.gate.code, entry);
  }

  return {
    ts: new Date().toISOString(),
    insideCampusTotal: await getInsideCampusTotal(),
    inPerMinute,
    outPerMinute,
    gates: Array.from(byGate.values())
  };
};

const upsertGateStat = async (gateId: string, direction: "in" | "out", occurredAt: Date) => {
  const bucketStart = startOfMinute(occurredAt);
  const existing = await prisma.gateStat1m.findUnique({
    where: {
      bucketStart_gateId: {
        bucketStart,
        gateId
      }
    }
  });
  if (existing) {
    await prisma.gateStat1m.update({
      where: {
        bucketStart_gateId: {
          bucketStart,
          gateId
        }
      },
      data: direction === "in" ? { inCount: { increment: 1 } } : { outCount: { increment: 1 } }
    });
    return;
  }
  await prisma.gateStat1m.create({
    data: {
      bucketStart,
      gateId,
      inCount: direction === "in" ? 1 : 0,
      outCount: direction === "out" ? 1 : 0
    }
  });
};

const upsertCanteenStat = async (zoneId: string, occupied: number, measuredAt: Date) => {
  const bucketStart = startOfFiveMinuteBucket(measuredAt);
  const existing = await prisma.canteenDensity5m.findUnique({
    where: {
      bucketStart_zoneId: {
        bucketStart,
        zoneId
      }
    }
  });

  if (!existing) {
    await prisma.canteenDensity5m.create({
      data: {
        bucketStart,
        zoneId,
        avgOccupied: new Prisma.Decimal(occupied),
        peakOccupied: occupied
      }
    });
    return;
  }

  const nextAvg = (Number(existing.avgOccupied) + occupied) / 2;
  await prisma.canteenDensity5m.update({
    where: {
      bucketStart_zoneId: {
        bucketStart,
        zoneId
      }
    },
    data: {
      avgOccupied: new Prisma.Decimal(nextAvg.toFixed(2)),
      peakOccupied: Math.max(existing.peakOccupied, occupied)
    }
  });
};

const getHeatmapSnapshot = async () => {
  const zones = await prisma.canteenZone.findMany({
    include: {
      densities: {
        orderBy: {
          measuredAt: "desc"
        },
        take: 1
      }
    }
  });
  return zones.map((zone) => {
    const latest = zone.densities[0];
    const occupied = latest?.occupied ?? 0;
    const ratio = zone.capacity === 0 ? 0 : occupied / zone.capacity;
    return {
      zoneCode: zone.code,
      name: zone.name,
      occupied,
      capacity: zone.capacity,
      ratio,
      level: toLevel(ratio),
      bounds: [zone.xMin, zone.yMin, zone.xMax, zone.yMax]
    };
  });
};

app.register(sensible);
app.register(helmet, {
  crossOriginResourcePolicy: false
});
app.register(rateLimit, {
  max: 200,
  timeWindow: "1 minute",
  skipOnError: true
});
app.register(cors, {
  origin: config.corsOrigin,
  credentials: true
});

app.register(fastifyStatic, {
  root: path.resolve(process.cwd(), "src/public"),
  prefix: "/static/"
});

app.get("/healthz", async () => {
  const [dbPing, redisPing] = await Promise.all([
    prisma.$queryRaw`SELECT 1`,
    redis.ping()
  ]);
  return {
    status: "ok",
    now: new Date().toISOString(),
    checks: {
      database: Array.isArray(dbPing) ? "ok" : "unknown",
      redis: redisPing === "PONG" ? "ok" : "degraded"
    }
  };
});

app.post("/api/auth/login", {
  config: {
    rateLimit: {
      max: 10,
      timeWindow: "1 minute"
    }
  }
}, async (request, reply) => {
  const payload = loginSchema.parse(request.body);
  const user = await prisma.user.findUnique({
    where: { email: payload.email },
    include: { wallet: true }
  });

  if (!user || !(await bcrypt.compare(payload.password, user.passwordHash))) {
    return reply.status(401).send({ message: "Sai email hoặc mật khẩu." });
  }

  return issueSession(user);
});

app.post("/api/auth/refresh", async (request, reply) => {
  const refresh = (request.body as { refresh?: string })?.refresh;
  if (!refresh) {
    return reply.status(400).send({ message: "Thiếu refresh token." });
  }
  try {
    const payload = verifyRefreshToken(refresh);
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      include: { wallet: true }
    });
    if (!user) {
      return reply.status(401).send({ message: "Người dùng không còn tồn tại." });
    }
    const validSession = await checkRefreshSession({
      id: payload.sub,
      email: payload.email,
      role: payload.role as CurrentUser["role"],
      jti: payload.jti
    });
    if (!validSession) {
      return reply.status(401).send({ message: "Refresh token đã bị thu hồi." });
    }
    return issueSession(user);
  } catch {
    return reply.status(401).send({ message: "Refresh token không hợp lệ." });
  }
});

app.post("/api/auth/logout", { preHandler: authGuard }, async (request: AuthedRequest) => {
  await revokeSession(request.user.id);
  return { success: true };
});

app.get("/api/auth/me", { preHandler: authGuard }, async (request: AuthedRequest) => {
  const user = await getRequestUser(request);
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    studentCode: user.studentCode,
    faculty: user.faculty,
    className: user.className,
    walletBalance: Number(user.wallet?.balance ?? 0)
  };
});

app.get("/api/students/me", { preHandler: requireRoles([Role.student]) }, async (request: AuthedRequest) => {
  const student = await prisma.user.findUniqueOrThrow({
    where: { id: request.user.id },
    include: {
      wallet: true,
      enrollments: {
        include: {
          class: true
        }
      }
    }
  });
  return {
    id: student.id,
    fullName: student.fullName,
    email: student.email,
    studentCode: student.studentCode,
    faculty: student.faculty,
    className: student.className,
    walletBalance: Number(student.wallet?.balance ?? 0),
    classes: student.enrollments.map((item) => ({
      id: item.class.id,
      code: item.class.code,
      name: item.class.name,
      roomLabel: item.class.roomLabel
    }))
  };
});

app.get("/api/students/me/qrcode", { preHandler: requireRoles([Role.student]) }, async (request: AuthedRequest) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: request.user.id } });
  return {
    token: createSignedToken(
      {
        kind: "student-id",
        userId: user.id,
        studentCode: user.studentCode
      },
      60
    ),
    expiresIn: 60
  };
});

app.post("/api/attendance/checkin", { preHandler: requireRoles([Role.student]) }, async (request: AuthedRequest, reply) => {
  const payload = attendanceCheckinSchema.parse(request.body);
  const beacon = payload.beaconUuid
    ? await prisma.beacon.findUnique({
        where: { uuid: payload.beaconUuid }
      })
    : null;
  const course = payload.classId
    ? await prisma.class.findUnique({ where: { id: payload.classId } })
    : beacon
      ? await prisma.class.findFirst({ where: { beaconId: beacon.id } })
      : null;

  if (!course) {
    return reply.status(404).send({ message: "Không tìm thấy lớp học tương ứng." });
  }

  const sessionDate = startOfDayUtc();
  const existing = await prisma.attendance.findUnique({
    where: {
      userId_classId_sessionDate: {
        userId: request.user.id,
        classId: course.id,
        sessionDate
      }
    }
  });

  if (!existing) {
    await prisma.attendance.create({
      data: {
        userId: request.user.id,
        classId: course.id,
        beaconId: beacon?.id,
        sessionDate,
        method: payload.beaconUuid ? "ble" : payload.qrToken ? "qr" : "manual"
      }
    });
  }

  return {
    success: true,
    className: course.name,
    roomLabel: course.roomLabel,
    alreadyCheckedIn: Boolean(existing)
  };
});

app.get("/api/attendance/class/:classId", { preHandler: requireRoles([Role.admin, Role.lecturer]) }, async (request) => {
  const { classId } = request.params as { classId: string };
  const list = await prisma.attendance.findMany({
    where: { classId },
    include: {
      user: true,
      class: true
    },
    orderBy: {
      checkInTime: "desc"
    }
  });
  return list.map((item) => ({
    id: item.id,
    studentName: item.user.fullName,
    studentCode: item.user.studentCode,
    className: item.class.name,
    checkInTime: item.checkInTime,
    method: item.method
  }));
});

app.get("/api/attendance/stats/class/:classId", { preHandler: requireRoles([Role.admin, Role.lecturer, Role.student]) }, async (request) => {
  const { classId } = request.params as { classId: string };
  const [course, presentCount] = await Promise.all([
    prisma.class.findUnique({
      where: { id: classId },
      include: { enrollments: true }
    }),
    prisma.attendance.count({
      where: {
        classId,
        sessionDate: startOfDayUtc()
      }
    })
  ]);
  if (!course) {
    return { enrolledCount: 0, presentCount: 0, ratio: 0 };
  }
  return {
    enrolledCount: course.enrollments.length,
    presentCount,
    ratio: course.enrollments.length === 0 ? 0 : presentCount / course.enrollments.length
  };
});

app.get("/api/wallet/balance", { preHandler: requireRoles([Role.student]) }, async (request: AuthedRequest) => {
  const user = await getRequestUser(request);
  return {
    balance: Number(user.wallet?.balance ?? 0)
  };
});

app.post("/api/wallet/topup", { preHandler: requireRoles([Role.student]) }, async (request: AuthedRequest) => {
  const payload = topupSchema.parse(request.body);
  await prisma.wallet.update({
    where: { userId: request.user.id },
    data: {
      balance: {
        increment: new Prisma.Decimal(payload.amount)
      }
    }
  });
  await prisma.transaction.create({
    data: {
      userId: request.user.id,
      type: TransactionType.topup,
      amount: new Prisma.Decimal(payload.amount),
      description: "Nạp tiền ví SCIS",
      status: TransactionStatus.success
    }
  });
  return { success: true };
});

app.get("/api/wallet/transactions", { preHandler: requireRoles([Role.student]) }, async (request: AuthedRequest) => {
  const transactions = await prisma.transaction.findMany({
    where: { userId: request.user.id },
    orderBy: {
      createdAt: "desc"
    }
  });
  return transactions.map((item) => ({
    id: item.id,
    type: item.type,
    amount: Number(item.amount),
    description: item.description,
    status: item.status,
    createdAt: item.createdAt
  }));
});

app.get("/api/menu", async () => {
  const items = await prisma.menuItem.findMany({
    where: { available: true },
    orderBy: [{ category: "asc" }, { name: "asc" }]
  });
  return items.map((item) => ({
    id: item.id,
    name: item.name,
    description: item.description,
    price: Number(item.price),
    category: item.category,
    imageUrl: item.imageUrl,
    prepTimeMin: item.prepTimeMin,
    stockToday: item.stockToday
  }));
});

app.post("/api/orders", { preHandler: requireRoles([Role.student]) }, async (request: AuthedRequest, reply) => {
  const payload = createOrderSchema.parse(request.body);
  const itemIds = payload.items.map((item) => item.menuItemId);
  const menuItems = await prisma.menuItem.findMany({
    where: { id: { in: itemIds } }
  });

  const itemLookup = new Map(menuItems.map((item) => [item.id, item]));
  let totalAmount = 0;
  for (const item of payload.items) {
    const found = itemLookup.get(item.menuItemId);
    if (!found) {
      return reply.status(404).send({ message: "Có món không tồn tại trong menu." });
    }
    totalAmount += Number(found.price) * item.quantity;
  }

  const wallet = await prisma.wallet.findUniqueOrThrow({
    where: { userId: request.user.id }
  });

  if (Number(wallet.balance) < totalAmount) {
    return reply.status(400).send({ message: "Số dư không đủ để đặt món." });
  }

  const order = await prisma.$transaction(async (tx) => {
    await tx.wallet.update({
      where: { userId: request.user.id },
      data: {
        balance: {
          decrement: new Prisma.Decimal(totalAmount)
        }
      }
    });

    const created = await tx.order.create({
      data: {
        userId: request.user.id,
        totalAmount: new Prisma.Decimal(totalAmount),
        pickupTime: new Date(payload.pickupTime),
        qrCode: `SCIS-${nanoid(10)}`,
        pickupToken: createSignedToken({ kind: "pickup", userId: request.user.id, nonce: nanoid(8) }, 1800),
        items: {
          create: payload.items.map((item) => {
            const menuItem = itemLookup.get(item.menuItemId)!;
            return {
              menuItemId: item.menuItemId,
              quantity: item.quantity,
              unitPrice: menuItem.price
            };
          })
        }
      },
      include: {
        items: true
      }
    });

    await tx.transaction.create({
      data: {
        userId: request.user.id,
        type: TransactionType.payment,
        amount: new Prisma.Decimal(totalAmount),
        description: `Thanh toán đơn ${created.id}`,
        status: TransactionStatus.success,
        refOrderId: created.id
      }
    });

    return created;
  });

  const orders = await summarizeOrders();
  const payloadOut = orders.find((item) => item.id === order.id);
  await publish("order:new", payloadOut);

  return payloadOut;
});

app.get("/api/orders/me", { preHandler: requireRoles([Role.student]) }, async (request: AuthedRequest) => {
  const all = await summarizeOrders();
  return all
    .filter(o => o.customer.id === request.user.id)
    .map((order) => ({
      id: order.id,
      status: order.status,
      totalAmount: order.totalAmount,
      pickupTime: order.pickupTime,
      qrCode: order.qrCode,
      pickupToken: order.pickupToken,
      createdAt: order.createdAt,
      items: order.items.map((item) => ({
        id: item.id,
        name: item.name,
        quantity: item.quantity,
        unitPrice: item.unitPrice
      }))
    }));
});

app.put("/api/orders/:id/status", { preHandler: requireRoles([Role.admin, Role.canteen_staff]) }, async (request, reply) => {
  const { id } = request.params as { id: string };
  const payload = updateOrderStatusSchema.parse(request.body);
  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) {
    return reply.status(404).send({ message: "Không tìm thấy đơn hàng." });
  }
  const updated = await prisma.order.update({
    where: { id },
    data: {
      status: payload.status as OrderStatus
    }
  });
  await publish("order:status", {
    id: updated.id,
    status: updated.status,
    userId: order.userId
  });
  return {
    id: updated.id,
    status: updated.status
  };
});

app.post("/api/orders/:id/pickup", { preHandler: requireRoles([Role.admin, Role.canteen_staff, Role.student]) }, async (request, reply) => {
  const { id } = request.params as { id: string };
  const payload = pickupOrderSchema.parse(request.body);
  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) {
    return reply.status(404).send({ message: "Không tìm thấy đơn hàng." });
  }
  try {
    verifySignedToken(payload.pickupToken);
  } catch {
    return reply.status(400).send({ message: "Mã nhận món không hợp lệ." });
  }
  const updated = await prisma.order.update({
    where: { id },
    data: {
      status: "completed"
    }
  });
  await publish("order:status", {
    id: updated.id,
    status: updated.status,
    userId: order.userId
  });
  return {
    id: updated.id,
    status: updated.status
  };
});

app.get("/api/admin/orders", { preHandler: requireRoles([Role.admin, Role.canteen_staff]) }, async () => summarizeOrders());

app.post("/api/ingest/gate-event", { preHandler: ingestGuard }, async (request, reply) => {
  const payload = gateIngestSchema.parse(request.body);
  const gate = await prisma.gate.findUnique({ where: { code: payload.gateCode } });
  if (!gate) {
    return reply.status(404).send({ message: "Gate code không tồn tại." });
  }

  const occurredAt = new Date(payload.occurredAt);
  await prisma.gateEvent.create({
    data: {
      gateId: gate.id,
      userId: payload.userId,
      direction: payload.direction,
      method: payload.method,
      occurredAt,
      deviceId: payload.deviceId
    }
  });

  await upsertGateStat(gate.id, payload.direction, occurredAt);
  const insideCampusTotal = await setInsideCampusTotal(payload.direction);
  await publish("gate:event", {
    gateCode: gate.code,
    direction: payload.direction,
    occurredAt: occurredAt.toISOString()
  });
  const snapshot = await getGateLiveSnapshot();
  snapshot.insideCampusTotal = insideCampusTotal;
  await publish("gate:tick", snapshot);
  return { success: true };
});

app.get("/api/gates/live", { preHandler: requireRoles([Role.admin, Role.lecturer, Role.canteen_staff]) }, async () => getGateLiveSnapshot());

app.get("/api/gates/series", { preHandler: requireRoles([Role.admin, Role.lecturer, Role.canteen_staff]) }, async (request) => {
  const query = request.query as { gate?: string; granularity?: string; from?: string; to?: string };
  const from = query.from ? new Date(query.from) : new Date(Date.now() - 60 * 60 * 1000);
  const to = query.to ? new Date(query.to) : new Date();
  const gateCode = query.gate && query.gate !== "ALL" ? query.gate : undefined;
  const stats = await prisma.gateStat1m.findMany({
    where: {
      bucketStart: {
        gte: from,
        lte: to
      },
      gate: gateCode ? { code: gateCode } : undefined
    },
    include: {
      gate: true
    },
    orderBy: {
      bucketStart: "asc"
    }
  });
  return stats.map((item) => ({
    bucketStart: item.bucketStart,
    gateCode: item.gate.code,
    inCount: item.inCount,
    outCount: item.outCount
  }));
});

app.post("/api/canteen/ingest/canteen-density", { preHandler: ingestGuard }, async (request, reply) => {
  const payload = canteenDensityIngestSchema.parse(request.body);
  const zone = await prisma.canteenZone.findUnique({ where: { code: payload.zoneCode } });
  if (!zone) {
    return reply.status(404).send({ message: "Zone code không tồn tại." });
  }
  const measuredAt = payload.measuredAt ? new Date(payload.measuredAt) : new Date();
  await prisma.canteenDensity.create({
    data: {
      zoneId: zone.id,
      occupied: payload.occupied,
      measuredAt,
      source: payload.source
    }
  });
  await upsertCanteenStat(zone.id, payload.occupied, measuredAt);
  const snapshot = await getHeatmapSnapshot();
  await publish("canteen:tick", {
    ts: new Date().toISOString(),
    zones: snapshot
  });
  return { success: true };
});

app.get("/api/canteen/zones", { preHandler: requireRoles([Role.admin, Role.student, Role.canteen_staff]) }, async () => {
  const zones = await prisma.canteenZone.findMany({
    orderBy: {
      code: "asc"
    }
  });
  return zones.map((zone) => ({
    id: zone.id,
    code: zone.code,
    name: zone.name,
    capacity: zone.capacity,
    bounds: [zone.xMin, zone.yMin, zone.xMax, zone.yMax],
    floor: zone.floor
  }));
});

app.get("/api/canteen/heatmap/live", { preHandler: requireRoles([Role.admin, Role.student, Role.canteen_staff]) }, async () => getHeatmapSnapshot());

app.get("/api/canteen/heatmap/replay", { preHandler: requireRoles([Role.admin, Role.student, Role.canteen_staff]) }, async (request) => {
  const query = request.query as { from?: string; to?: string };
  const from = query.from ? new Date(query.from) : new Date(Date.now() - 60 * 60 * 1000);
  const to = query.to ? new Date(query.to) : new Date();
  const stats = await prisma.canteenDensity5m.findMany({
    where: {
      bucketStart: {
        gte: from,
        lte: to
      }
    },
    include: {
      zone: true
    },
    orderBy: [{ bucketStart: "asc" }, { zone: { code: "asc" } }]
  });
  return stats.map((item) => ({
    bucketStart: item.bucketStart,
    zoneCode: item.zone.code,
    zoneName: item.zone.name,
    avgOccupied: Number(item.avgOccupied),
    peakOccupied: item.peakOccupied,
    capacity: item.zone.capacity
  }));
});

app.get("/api/admin/dashboard", { preHandler: requireRoles([Role.admin, Role.lecturer, Role.canteen_staff]) }, async () => {
  const [studentsCount, todayAttendanceCount, transactionsToday, ordersPending, topItems, liveGate, heatmap] = await Promise.all([
    prisma.user.count({ where: { role: Role.student } }),
    prisma.attendance.count({
      where: { sessionDate: startOfDayUtc() }
    }),
    prisma.transaction.findMany({
      where: {
        createdAt: {
          gte: startOfDayUtc()
        },
        status: TransactionStatus.success
      }
    }),
    prisma.order.count({
      where: {
        status: {
          in: ["pending", "preparing"]
        }
      }
    }),
    prisma.orderItem.groupBy({
      by: ["menuItemId"],
      _sum: { quantity: true },
      orderBy: {
        _sum: { quantity: "desc" }
      },
      take: 5
    }),
    getGateLiveSnapshot(),
    getHeatmapSnapshot()
  ]);

  const menuIds = topItems.map((item) => item.menuItemId);
  const menuItems = await prisma.menuItem.findMany({
    where: {
      id: { in: menuIds }
    }
  });
  const topItemMap = new Map(menuItems.map((item) => [item.id, item.name]));

  return {
    studentActiveToday: studentsCount,
    attendanceToday: todayAttendanceCount,
    transactionsTodayAmount: transactionsToday.reduce((sum, item) => sum + Number(item.amount), 0),
    transactionsTodayCount: transactionsToday.length,
    pendingOrders: ordersPending,
    insideCampusTotal: liveGate.insideCampusTotal,
    canteenBusiestZone: [...heatmap].sort((a, b) => b.ratio - a.ratio)[0] ?? null,
    topItems: topItems.map((item) => ({
      menuItemId: item.menuItemId,
      name: topItemMap.get(item.menuItemId) ?? item.menuItemId,
      quantity: item._sum.quantity ?? 0
    }))
  };
});

app.get("/api/admin/reports/revenue", { preHandler: requireRoles([Role.admin, Role.canteen_staff]) }, async () => {
  const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const transactions = await prisma.transaction.findMany({
    where: {
      createdAt: { gte: from },
      type: TransactionType.payment,
      status: TransactionStatus.success
    },
    orderBy: {
      createdAt: "asc"
    }
  });
  const grouped = new Map<string, number>();
  for (const item of transactions) {
    const key = item.createdAt.toISOString().slice(0, 10);
    grouped.set(key, (grouped.get(key) ?? 0) + Number(item.amount));
  }
  return Array.from(grouped.entries()).map(([date, amount]) => ({ date, amount }));
});

app.get("/api/admin/reports/attendance", { preHandler: requireRoles([Role.admin, Role.lecturer]) }, async () => {
  const classes = await prisma.class.findMany({
    include: {
      enrollments: true,
      attendances: {
        where: {
          sessionDate: startOfDayUtc()
        }
      }
    }
  });
  return classes.map((item) => ({
    classId: item.id,
    classCode: item.code,
    className: item.name,
    enrolledCount: item.enrollments.length,
    presentCount: item.attendances.length,
    ratio: item.enrollments.length === 0 ? 0 : item.attendances.length / item.enrollments.length
  }));
});

app.get("/api/admin/reports/top-items", { preHandler: requireRoles([Role.admin, Role.canteen_staff]) }, async () => {
  const items = await prisma.orderItem.groupBy({
    by: ["menuItemId"],
    _sum: {
      quantity: true
    },
    orderBy: {
      _sum: { quantity: "desc" }
    },
    take: 10
  });
  const menuItems = await prisma.menuItem.findMany({
    where: { id: { in: items.map((item) => item.menuItemId) } }
  });
  const nameMap = new Map(menuItems.map((item) => [item.id, item.name]));
  return items.map((item) => ({
    menuItemId: item.menuItemId,
    name: nameMap.get(item.menuItemId) ?? item.menuItemId,
    quantity: item._sum.quantity ?? 0
  }));
});

app.get("/api/admin/students", { preHandler: requireRoles([Role.admin, Role.lecturer]) }, async () => {
  const students = await prisma.user.findMany({
    where: { role: Role.student },
    include: {
      wallet: true
    },
    orderBy: { studentCode: "asc" }
  });
  return students.map((student) => ({
    id: student.id,
    fullName: student.fullName,
    studentCode: student.studentCode,
    email: student.email,
    faculty: student.faculty,
    className: student.className,
    walletBalance: Number(student.wallet?.balance ?? 0)
  }));
});

app.setErrorHandler((error, _request, reply) => {
  const normalized = error as { issues?: unknown; message?: string; statusCode?: number };
  app.log.error(error);
  if (normalized && typeof normalized === "object" && "issues" in normalized) {
    return reply.status(400).send({
      message: "Dữ liệu không hợp lệ.",
      issues: normalized.issues
    });
  }
  // Preserve original HTTP status (e.g. 401/403/404 from httpErrors) — without
  // this, the apiFetch refresh-on-401 logic never fires.
  const status = typeof normalized.statusCode === "number" && normalized.statusCode >= 400 && normalized.statusCode < 600
    ? normalized.statusCode
    : 500;
  return reply.status(status).send({
    message: normalized.message || "Đã có lỗi xảy ra."
  });
});

app.addHook("onClose", async () => {
  await Promise.allSettled([
    prisma.$disconnect(),
    redis.quit(),
    redisSubscriber.quit()
  ]);
});

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "Shutting down SCIS backend");
  await app.close();
  process.exit(0);
};

const start = async () => {
  await createRealtime(app.server);
  await app.listen({
    port: config.port,
    host: "0.0.0.0"
  });
};

start().catch(async (error) => {
  app.log.error(error);
  await prisma.$disconnect();
  process.exit(1);
});

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
