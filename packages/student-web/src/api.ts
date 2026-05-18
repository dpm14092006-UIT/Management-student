import type { Session } from "./types";

const API_BASE = import.meta.env.VITE_API_URL ?? "";
const SESSION_KEY = "scis-student-session";

export const readSession = (): Session | null => {
  const raw = window.localStorage.getItem(SESSION_KEY);
  return raw ? (JSON.parse(raw) as Session) : null;
};

export const writeSession = (session: Session | null) => {
  if (!session) {
    window.localStorage.removeItem(SESSION_KEY);
    return;
  }
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
};

export const logoutSession = async (session?: Session | null) => {
  const active = session ?? readSession();
  if (active?.access) {
    try {
      await fetch(`${API_BASE}/api/auth/logout`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${active.access}`
        }
      });
    } catch {
      // Ignore network errors during local session cleanup.
    }
  }
  writeSession(null);
};

const refreshSession = async (session: Session) => {
  const response = await fetch(`${API_BASE}/api/auth/refresh`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({ refresh: session.refresh })
  });

  if (!response.ok) {
    writeSession(null);
    throw new Error("Phiên đăng nhập đã hết hạn.");
  }

  const next = (await response.json()) as Session;
  writeSession(next);
  return next;
};

export const apiFetch = async <T>(path: string, init: RequestInit = {}, session?: Session | null): Promise<T> => {
  const activeSession = session ?? readSession();
  const headers = new Headers(init.headers ?? {});
  if (!headers.has("content-type") && init.body) {
    headers.set("content-type", "application/json");
  }
  if (activeSession?.access) {
    headers.set("authorization", `Bearer ${activeSession.access}`);
  }

  let response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers
  });

  if (response.status === 401 && activeSession?.refresh) {
    const nextSession = await refreshSession(activeSession);
    const retryHeaders = new Headers(init.headers ?? {});
    if (!retryHeaders.has("content-type") && init.body) {
      retryHeaders.set("content-type", "application/json");
    }
    retryHeaders.set("authorization", `Bearer ${nextSession.access}`);
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: retryHeaders
    });
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => ({ message: "Lỗi hệ thống." }));
    throw new Error(payload.message ?? "Lỗi hệ thống.");
  }

  return response.json() as Promise<T>;
};
