import type { NextFunction, Request, Response } from "express";
import { compareSync } from "bcryptjs";
import jwt from "jsonwebtoken";
import { config } from "./config.js";
import { stateStore } from "./store.js";
import type { SessionUser } from "./types.js";

export interface AuthenticatedRequest extends Request {
  user?: SessionUser;
}

export function createSessionToken(user: SessionUser) {
  return jwt.sign(user, config.jwtSecret, { expiresIn: "7d" });
}

export function authMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const token = req.cookies?.[config.cookieName];

  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    req.user = jwt.verify(token, config.jwtSecret) as SessionUser;
    next();
  } catch {
    res.status(401).json({ error: "Invalid session" });
  }
}

export function login(username: string, password: string) {
  const user = stateStore.getState().users.find((entry) => entry.username === username);

  if (!user || !compareSync(password, user.passwordHash)) {
    return null;
  }

  const sessionUser: SessionUser = {
    id: user.id,
    username: user.username,
    role: user.role
  };

  stateStore.update((draft) => {
    const draftUser = draft.users.find((entry) => entry.id === user.id);
    if (draftUser) {
      draftUser.lastLoginAt = new Date().toISOString();
    }
  });

  return sessionUser;
}
