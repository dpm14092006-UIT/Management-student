import type { Server as HttpServer } from "node:http";

import { Server } from "socket.io";

import { redisSubscriber } from "./redis";

type RealtimeChannels = "gate:event" | "gate:tick" | "canteen:tick" | "order:new" | "order:status";

let io: Server | null = null;

const emitOrderEvent = (channel: string, payload: unknown) => {
  io?.to("orders:staff").emit(channel, payload);
  const userId = (payload as Record<string, unknown>)?.userId;
  if (typeof userId === "string") {
    io?.to(`orders:user:${userId}`).emit(channel, payload);
  }
};

export const createRealtime = async (server: HttpServer) => {
  io = new Server(server, {
    cors: {
      origin: true,
      credentials: true
    }
  });

  io.on("connection", (socket) => {
    socket.join("gates");
    socket.join("canteen");

    socket.on("join:orders", (userId: unknown) => {
      if (typeof userId === "string" && userId.length > 0) {
        socket.join(`orders:user:${userId}`);
      }
    });
  });

  redisSubscriber.on("message", (channel, message) => {
    try {
      const payload = JSON.parse(message);
      if (channel === "gate:event" || channel === "gate:tick") io?.to("gates").emit(channel, payload);
      if (channel === "canteen:tick") io?.to("canteen").emit(channel, payload);
      if (channel === "order:new" || channel === "order:status") emitOrderEvent(channel, payload);
    } catch {}
  });

  redisSubscriber
    .subscribe("gate:event", "gate:tick", "canteen:tick", "order:new", "order:status")
    .catch(() => {
      console.warn("[realtime] Redis unavailable — Socket.IO pubsub disabled, direct emit only.");
    });

  return io;
};

export const emitRoom = async (channel: RealtimeChannels, payload: unknown) => {
  if (channel === "gate:event" || channel === "gate:tick") {
    io?.to("gates").emit(channel, payload);
  }
  if (channel === "canteen:tick") {
    io?.to("canteen").emit(channel, payload);
  }
  if (channel === "order:new" || channel === "order:status") {
    emitOrderEvent(channel, payload);
  }
};
