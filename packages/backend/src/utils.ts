export const formatCurrency = (value: number) =>
  new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0
  }).format(value);

export const startOfDayUtc = (date = new Date()) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

export const startOfMinute = (date: Date) => {
  const copy = new Date(date);
  copy.setUTCSeconds(0, 0);
  return copy;
};

export const startOfFiveMinuteBucket = (date: Date) => {
  const copy = new Date(date);
  const minutes = copy.getUTCMinutes();
  copy.setUTCMinutes(minutes - (minutes % 5), 0, 0);
  return copy;
};

export const toLevel = (ratio: number): "low" | "medium" | "high" | "critical" => {
  if (ratio >= 0.9) return "critical";
  if (ratio >= 0.7) return "high";
  if (ratio >= 0.4) return "medium";
  return "low";
};
