import "dotenv/config";

const required = (name: string) => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
};

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  logLevel: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "production" ? "info" : "debug"),
  port: Number(process.env.PORT ?? 4000),
  trustedProxy: process.env.TRUSTED_PROXY === "true",
  corsOrigin: (process.env.CORS_ORIGIN ?? "http://localhost:5173,http://localhost:5174").split(","),
  jwtAccessSecret: required("JWT_ACCESS_SECRET"),
  jwtRefreshSecret: required("JWT_REFRESH_SECRET"),
  accessTtlSeconds: Number(process.env.JWT_ACCESS_TTL ?? 900),
  refreshTtlSeconds: Number(process.env.JWT_REFRESH_TTL ?? 604800),
  ingestServiceToken: required("INGEST_SERVICE_TOKEN"),
  qrHmacSecret: required("QR_HMAC_SECRET"),
  qrTtlSeconds: Number(process.env.QR_TTL_SECONDS ?? 60),
  redisUrl: required("REDIS_URL"),
  appBaseUrl: process.env.APP_BASE_URL ?? "http://localhost:4000"
};
