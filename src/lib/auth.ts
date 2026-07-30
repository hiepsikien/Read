import { getIronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";
import type { SessionUser } from "./types";

export interface SessionData {
  user?: SessionUser;
}

const password =
  process.env.SESSION_SECRET ||
  "read-mvp-dev-secret-change-in-production-32chars";

export const sessionOptions: SessionOptions = {
  password,
  cookieName: "read_session",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  },
};

export async function getSession() {
  return getIronSession<SessionData>(await cookies(), sessionOptions);
}

export async function requireUser() {
  const session = await getSession();
  if (!session.user) {
    throw new Error("UNAUTHORIZED");
  }
  return session.user;
}

export async function requirePublisher() {
  const user = await requireUser();
  if (user.role !== "publisher") {
    throw new Error("FORBIDDEN");
  }
  return user;
}
