export const roles = ["student", "admin", "lecturer", "canteen_staff"] as const;
export type Role = (typeof roles)[number];

export type Direction = "in" | "out";
export type AttendanceMethod = "ble" | "qr" | "manual";
export type TransactionType = "topup" | "payment" | "refund";
export type TransactionStatus = "success" | "pending" | "failed";
export type OrderStatus = "pending" | "preparing" | "ready" | "completed" | "cancelled";
export type DensitySource = "sensor" | "camera" | "order_proxy" | "manual";

export type GateLiveSnapshot = {
  ts: string;
  insideCampusTotal: number;
  inPerMinute: number;
  outPerMinute: number;
  gates: Array<{
    gateCode: string;
    inCount: number;
    outCount: number;
  }>;
};

export type HeatmapZoneSnapshot = {
  zoneCode: string;
  name: string;
  occupied: number;
  capacity: number;
  ratio: number;
  level: "low" | "medium" | "high" | "critical";
};
