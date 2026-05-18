import crypto from "node:crypto";

import jwt from "jsonwebtoken";

import { config } from "./config";

export type AuthPayload = {
  sub: string;
  role: string;
  email: string;
  jti?: string;
};

export const signAccessToken = (payload: AuthPayload) =>
  jwt.sign(payload, config.jwtAccessSecret, { expiresIn: config.accessTtlSeconds });

export const signRefreshToken = (payload: AuthPayload) =>
  jwt.sign(payload, config.jwtRefreshSecret, { expiresIn: config.refreshTtlSeconds });

export const verifyAccessToken = (token: string) =>
  jwt.verify(token, config.jwtAccessSecret) as AuthPayload;

export const verifyRefreshToken = (token: string) =>
  jwt.verify(token, config.jwtRefreshSecret) as AuthPayload;

export const createSignedToken = (payload: Record<string, unknown>, ttlSeconds: number) => {
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  const body = JSON.stringify({ ...payload, expiresAt });
  const signature = crypto.createHmac("sha256", config.qrHmacSecret).update(body).digest("hex");
  return Buffer.from(JSON.stringify({ payload: body, signature })).toString("base64url");
};

export const verifySignedToken = <T>(token: string): T => {
  const decoded = JSON.parse(Buffer.from(token, "base64url").toString("utf8")) as {
    payload: string;
    signature: string;
  };
  const expected = crypto.createHmac("sha256", config.qrHmacSecret).update(decoded.payload).digest("hex");
  if (expected !== decoded.signature) {
    throw new Error("Invalid signature");
  }
  const payload = JSON.parse(decoded.payload) as T & { expiresAt: number };
  if (payload.expiresAt < Math.floor(Date.now() / 1000)) {
    throw new Error("Expired token");
  }
  return payload;
};
