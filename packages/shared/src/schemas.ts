import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

export const topupSchema = z.object({
  amount: z.number().positive().max(5_000_000)
});

export const attendanceCheckinSchema = z.object({
  beaconUuid: z.string().uuid().optional(),
  qrToken: z.string().min(8).optional(),
  classId: z.string().optional()
}).refine((value) => value.beaconUuid || value.qrToken, {
  message: "Beacon UUID hoặc QR token là bắt buộc."
});

export const orderItemSchema = z.object({
  menuItemId: z.string(),
  quantity: z.number().int().min(1).max(20)
});

export const createOrderSchema = z.object({
  items: z.array(orderItemSchema).min(1),
  pickupTime: z.string().datetime()
});

export const updateOrderStatusSchema = z.object({
  status: z.enum(["pending", "preparing", "ready", "completed", "cancelled"])
});

export const pickupOrderSchema = z.object({
  pickupToken: z.string().min(8)
});

export const gateIngestSchema = z.object({
  gateCode: z.string().min(3),
  direction: z.enum(["in", "out"]),
  method: z.enum(["qr", "rfid", "face", "manual"]),
  occurredAt: z.string().datetime(),
  deviceId: z.string().min(3),
  userId: z.string().optional()
});

export const canteenDensityIngestSchema = z.object({
  zoneCode: z.string().min(3),
  occupied: z.number().int().min(0).max(500),
  source: z.enum(["sensor", "camera", "order_proxy", "manual"]),
  measuredAt: z.string().datetime().optional()
});
