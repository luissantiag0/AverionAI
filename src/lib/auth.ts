import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import { compare, hash } from "bcryptjs";
import { Prisma } from "@prisma/client";
import type { User } from "@prisma/client";

import { prisma } from "./prisma";
import { sendWelcomeEmail } from "./emailAutomation";
import { logger } from "./logger";

import {
  ADMIN_SESSION_DURATION_MS,
  generateSessionToken,
} from "./session";

type AuthUser = Pick<
  User,
  "id" | "email" | "passwordHash" | "role" | "createdAt"
> &
  Partial<
    Pick<
      User,
      | "name"
      | "adminSessionToken"
      | "adminSessionStartedAt"
      | "isPremium"
      | "premiumSince"
      | "subscriptionStatus"
      | "subscriptionCurrentPeriodEnd"
      | "trialStartedAt"
      | "trialEndsAt"
    >
  >;

type UserColumnSupport = {
  adminSessionToken: boolean;
  adminSessionStartedAt: boolean;
  isPremium: boolean;
  premiumSince: boolean;
  subscriptionStatus: boolean;
  subscriptionCurrentPeriodEnd: boolean;
  name: boolean;
  trialStartedAt: boolean;
  trialEndsAt: boolean;
};

const USER_COLUMN_CACHE_MS = 30_000;

let userColumnSupportCache:
  | {
      checkedAt: number;
      value: UserColumnSupport;
    }
  | undefined;

const baseUserSelect = {
  id: true,
  email: true,
  passwordHash: true,
  role: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

const missingColumnFallback: UserColumnSupport = {
  adminSessionToken: false,
  adminSessionStartedAt: false,
  isPremium: false,
  premiumSince: false,
  subscriptionStatus: false,
  subscriptionCurrentPeriodEnd: false,
  name: false,
  trialStartedAt: false,
  trialEndsAt: false,
};

const resetUserColumnSupportCache = () => {
  userColumnSupportCache = undefined;
};

const isMissingColumnError = (error: unknown) => {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2022"
  ) {
    return true;
  }

  return String(error).includes("does not exist");
};

const getUserColumnSupport =
  async (): Promise<UserColumnSupport> => {
    const now = Date.now();

    if (
      userColumnSupportCache &&
      now - userColumnSupportCache.checkedAt < USER_COLUMN_CACHE_MS
    ) {
      return userColumnSupportCache.value;
    }

    try {
      const rows = await prisma.$queryRaw<
        Array<{ column_name: keyof UserColumnSupport }>
      >`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'User'
          AND column_name IN (
            'adminSessionToken',
            'adminSessionStartedAt',
            'isPremium',
            'premiumSince',
            'subscriptionStatus',
            'subscriptionCurrentPeriodEnd',
            'name',
            'trialStartedAt',
            'trialEndsAt'
          )
      `;

      const columns = new Set(
        rows.map((row) => row.column_name)
      );

      const value = {
        adminSessionToken:
          columns.has("adminSessionToken"),
        adminSessionStartedAt:
          columns.has("adminSessionStartedAt"),
        isPremium:
          columns.has("isPremium"),
        premiumSince:
          columns.has("premiumSince"),
        subscriptionStatus:
          columns.has("subscriptionStatus"),
        subscriptionCurrentPeriodEnd:
          columns.has("subscriptionCurrentPeriodEnd"),
        name:
          columns.has("name"),
        trialStartedAt:
          columns.has("trialStartedAt"),
        trialEndsAt:
          columns.has("trialEndsAt"),
      };

      userColumnSupportCache = {
        checkedAt: now,
        value,
      };

      return value;
    } catch (error) {
      console.error(
        "[auth] No se pudo inspeccionar la tabla User:",
        error
      );

      return missingColumnFallback;
    }
  };

const buildUserSelect = async () => {
  const support =
    await getUserColumnSupport();

  return {
    ...baseUserSelect,
    ...(support.name ? { name: true } : {}),
    ...(support.adminSessionStartedAt
      ? { adminSessionStartedAt: true }
      : {}),
    ...(support.isPremium ? { isPremium: true } : {}),
    ...(support.premiumSince ? { premiumSince: true } : {}),
    ...(support.subscriptionStatus
      ? { subscriptionStatus: true }
      : {}),
    ...(support.subscriptionCurrentPeriodEnd
      ? { subscriptionCurrentPeriodEnd: true }
      : {}),
    ...(support.trialStartedAt
      ? { trialStartedAt: true }
      : {}),
    ...(support.trialEndsAt
      ? { trialEndsAt: true }
      : {}),
  } satisfies Prisma.UserSelect;
};

const findUserByEmail = async (
  email: string
): Promise<AuthUser | null> => {
  try {
    return (await prisma.user.findUnique({
      where: {
        email,
      },
      select: await buildUserSelect(),
    })) as AuthUser | null;
  } catch (error) {
    if (!isMissingColumnError(error)) {
      throw error;
    }

    resetUserColumnSupportCache();

    return (await prisma.user.findUnique({
      where: {
        email,
      },
      select: baseUserSelect,
    })) as AuthUser | null;
  }
};

const findUserById = async (
  id: string
): Promise<AuthUser | null> => {
  try {
    return (await prisma.user.findUnique({
      where: {
        id,
      },
      select: await buildUserSelect(),
    })) as AuthUser | null;
  } catch (error) {
    if (!isMissingColumnError(error)) {
      throw error;
    }

    resetUserColumnSupportCache();

    return (await prisma.user.findUnique({
      where: {
        id,
      },
      select: baseUserSelect,
    })) as AuthUser | null;
  }
};

const findUserBySessionToken = async (
  storedToken: string
): Promise<AuthUser | null> => {
  const support =
    await getUserColumnSupport();

  if (!support.adminSessionToken) {
    return null;
  }

  try {
    return (await prisma.user.findFirst({
      where: {
        adminSessionToken: storedToken,
      },
      select: await buildUserSelect(),
    })) as AuthUser | null;
  } catch (error) {
    if (!isMissingColumnError(error)) {
      throw error;
    }

    resetUserColumnSupportCache();
    return null;
  }
};

const getSessionSecret = () =>
  (
    process.env.SESSION_SECRET ||
    process.env.AUTH_SECRET ||
    process.env.DATABASE_URL ||
    "averion-local-session-secret"
  ).trim();

const signSessionPayload = (payload: string) =>
  createHmac("sha256", getSessionSecret())
    .update(payload)
    .digest("base64url");

const safeEqual = (a: string, b: string) => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);

  if (left.length !== right.length) {
    return false;
  }

  return timingSafeEqual(left, right);
};

const signDbSession = (
  storedToken: string,
  startedAtMs: number,
  user: Pick<AuthUser, "id" | "passwordHash">
) =>
  signSessionPayload(
    `db.${storedToken}.${startedAtMs}.${user.id}.${user.passwordHash}`
  );

const signStatelessSession = (
  userId: string,
  startedAtMs: number,
  passwordHash: string
) =>
  signSessionPayload(
    `stateless.${userId}.${startedAtMs}.${passwordHash}`
  );

const buildDbSessionCookie = (
  storedToken: string,
  startedAt: Date,
  user: Pick<AuthUser, "id" | "passwordHash">
) => {
  const startedAtMs = startedAt.getTime();
  const signature =
    signDbSession(storedToken, startedAtMs, user);

  return `db.${storedToken}.${startedAtMs}.${signature}`;
};

const buildStatelessSessionCookie = (
  user: Pick<AuthUser, "id" | "passwordHash">,
  startedAt: Date
) => {
  const startedAtMs = startedAt.getTime();
  const signature =
    signStatelessSession(
      user.id,
      startedAtMs,
      user.passwordHash
    );

  return `stateless.${user.id}.${startedAtMs}.${signature}`;
};

const parseSessionToken = (token: string) => {
  const parts = token.split(".");

  if (parts.length === 4 && parts[0] === "db") {
    return {
      kind: "db" as const,
      storedToken: parts[1],
      startedAtMs: Number(parts[2]),
      signature: parts[3],
    };
  }

  if (parts.length === 4 && parts[0] === "stateless") {
    return {
      kind: "stateless" as const,
      userId: parts[1],
      startedAtMs: Number(parts[2]),
      signature: parts[3],
    };
  }

  return {
    kind: "legacy-db" as const,
    storedToken: token,
  };
};

const isExpired = (startedAt: Date) =>
  Date.now() - startedAt.getTime() >
  ADMIN_SESSION_DURATION_MS;

const storeDbSession = async (
  user: Pick<AuthUser, "id">,
  storedToken: string,
  startedAt: Date
) => {
  const support =
    await getUserColumnSupport();

  if (!support.adminSessionToken) {
    return false;
  }

  const data: Prisma.UserUpdateInput = {
    adminSessionToken: storedToken,
    ...(support.adminSessionStartedAt
      ? { adminSessionStartedAt: startedAt }
      : {}),
  };

  try {
    await prisma.user.update({
      where: {
        id: user.id,
      },
      data,
      select: {
        id: true,
      },
    });

    return true;
  } catch (error) {
    if (isMissingColumnError(error)) {
      resetUserColumnSupportCache();
      console.warn(
        "[auth] Columnas de sesion no migradas; usando sesion firmada temporal."
      );
      return false;
    }

    console.error(
      "[auth] No se pudo guardar la sesion en DB:",
      error
    );
    return false;
  }
};

const setDbSessionStartedAt = async (
  userId: string,
  startedAt: Date
) => {
  const support =
    await getUserColumnSupport();

  if (!support.adminSessionStartedAt) {
    return false;
  }

  try {
    await prisma.user.update({
      where: {
        id: userId,
      },
      data: {
        adminSessionStartedAt: startedAt,
      },
      select: {
        id: true,
      },
    });

    return true;
  } catch (error) {
    if (isMissingColumnError(error)) {
      resetUserColumnSupportCache();
      return false;
    }

    console.error(
      "[auth] No se pudo actualizar el inicio de sesion:",
      error
    );
    return false;
  }
};

const clearStoredSession = async (userId: string) => {
  const support =
    await getUserColumnSupport();

  const data: Prisma.UserUpdateInput = {};

  if (support.adminSessionToken) {
    data.adminSessionToken = null;
  }

  if (support.adminSessionStartedAt) {
    data.adminSessionStartedAt = null;
  }

  if (Object.keys(data).length === 0) {
    return;
  }

  try {
    await prisma.user.update({
      where: {
        id: userId,
      },
      data,
      select: {
        id: true,
      },
    });
  } catch (error) {
    if (isMissingColumnError(error)) {
      resetUserColumnSupportCache();
      return;
    }

    console.error(
      "[auth] No se pudo limpiar la sesion:",
      error
    );
  }
};

const withSessionStartedAt = (
  user: AuthUser,
  startedAt?: Date
): AuthUser => ({
  ...user,
  ...(startedAt
    ? { adminSessionStartedAt: startedAt }
    : {}),
});

const createSession = async (
  user: Pick<AuthUser, "id" | "passwordHash">
) => {
  const startedAt = new Date();
  const storedToken = generateSessionToken();
  const stored = await storeDbSession(user, storedToken, startedAt);

  const token = stored
    ? buildDbSessionCookie(storedToken, startedAt, user)
    : buildStatelessSessionCookie(user, startedAt);

  return { token, startedAt };
};

// ─── PUBLIC API ─────────────────────────────────────────────────

export const loginAdmin = async (
  email: string,
  password: string
) => {
  try {
    const user = await findUserByEmail(email);

    if (!user) {
      return null;
    }

    const validPassword = await compare(password, user.passwordHash);

    if (!validPassword) {
      return null;
    }

    const { token, startedAt } = await createSession(user);

    return {
      user: withSessionStartedAt(user, startedAt),
      token,
    };
  } catch (error) {
    console.error("[auth] Error en loginAdmin:", error);
    return null;
  }
};

export const loginUser = loginAdmin;

export interface RegisterResult {
  user: AuthUser;
  token: string;
}

export const registerUser = async (
  name: string,
  email: string,
  password: string,
  referralCode?: string
): Promise<RegisterResult> => {
  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });

  if (existing) {
    throw new Error("EMAIL_TAKEN");
  }

  const passwordHash = await hash(password, 12);

  const now = new Date();
  const trialEndsAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const user = await prisma.user.create({
    data: {
      name,
      email,
      passwordHash,
      role: "client",
      trialStartedAt: now,
      trialEndsAt,
    },
    select: await buildUserSelect(),
  });

  if (referralCode) {
    const { applyReferral } = await import("./automations");
    applyReferral(referralCode, user.id).catch(() => {});
  }

  const { token, startedAt } = await createSession(user);

  logger.audit("user.register", user.id, { name, email, trialHours: 24 });
  sendWelcomeEmail(email, name).catch(() => {});

  return {
    user: withSessionStartedAt(user, startedAt),
    token,
  };
};

export const getCurrentAdmin = async (token?: string) => {
  if (!token) {
    return null;
  }

  try {
    const parsed = parseSessionToken(token);

    if (parsed.kind === "stateless") {
      if (!Number.isFinite(parsed.startedAtMs)) {
        return null;
      }

      const startedAt = new Date(parsed.startedAtMs);

      if (isExpired(startedAt)) {
        return null;
      }

      const user = await findUserById(parsed.userId);

      if (!user) {
        return null;
      }

      const expected = signStatelessSession(
        user.id,
        parsed.startedAtMs,
        user.passwordHash
      );

      if (!safeEqual(expected, parsed.signature)) {
        return null;
      }

      return withSessionStartedAt(user, startedAt);
    }

    const user = await findUserBySessionToken(parsed.storedToken);

    if (!user) {
      return null;
    }

    const parsedStartedAt =
      parsed.kind === "db" &&
      Number.isFinite(parsed.startedAtMs)
        ? new Date(parsed.startedAtMs)
        : undefined;

    if (parsed.kind === "db") {
      if (!parsedStartedAt) {
        return null;
      }

      const expected = signDbSession(
        parsed.storedToken,
        parsed.startedAtMs,
        user
      );

      if (!safeEqual(expected, parsed.signature)) {
        return null;
      }
    }

    const startedAt =
      parsedStartedAt ||
      user.adminSessionStartedAt ||
      undefined;

    if (startedAt && isExpired(startedAt)) {
      await clearStoredSession(user.id);
      return null;
    }

    if (!startedAt) {
      const now = new Date();
      const stored = await setDbSessionStartedAt(user.id, now);

      if (!stored) {
        return null;
      }

      return withSessionStartedAt(user, now);
    }

    return withSessionStartedAt(user, startedAt);
  } catch (error) {
    console.error(
      "[auth] Error recuperando la sesion actual:",
      error
    );
    return null;
  }
};

export const getCurrentUser = getCurrentAdmin;

export const userHasPremiumAccess = (
  user?:
    | (Pick<User, "role"> &
        Partial<
          Pick<
            User,
            | "isPremium"
            | "subscriptionStatus"
            | "subscriptionCurrentPeriodEnd"
            | "trialEndsAt"
          >
        >)
    | null
) => {
  if (!user) {
    return false;
  }

  if (
    user.role === "premium" ||
    user.role === "admin" ||
    user.role === "owner"
  ) {
    return true;
  }

  if (user.trialEndsAt && new Date() < user.trialEndsAt) {
    return true;
  }

  if (user.isPremium === true) {
    if (user.subscriptionCurrentPeriodEnd) {
      return new Date() < user.subscriptionCurrentPeriodEnd;
    }

    return true;
  }

  return (
    user.subscriptionStatus === "active" ||
    user.subscriptionStatus === "trialing"
  );
};

export const userIsAdmin = (
  user?: Pick<User, "role"> | null
) => {
  if (!user) return false;
  return (
    user.role === "admin" || user.role === "owner"
  );
};

export const getCurrentPremiumUser =
  async (token?: string) => {
    const user = await getCurrentAdmin(token);

    if (!user || !userHasPremiumAccess(user)) {
      return null;
    }

    return user;
  };

export const logoutAdmin = async (userId: string) => {
  await clearStoredSession(userId);
};

export const logoutUser = logoutAdmin;

export const getTrialRemainingMs = (
  user?: { trialEndsAt?: Date | null } | null
): number => {
  if (!user?.trialEndsAt) return 0;
  const remaining = user.trialEndsAt.getTime() - Date.now();
  return Math.max(0, remaining);
};
