import type { FastifyRequest } from "fastify";

export type CurrentUser = {
  id: string;
  email: string;
  role: "student" | "admin" | "lecturer" | "canteen_staff";
};

declare module "fastify" {
  interface FastifyRequest {
    user?: CurrentUser;
  }
}

export type AuthedRequest = FastifyRequest & {
  user: CurrentUser;
};
