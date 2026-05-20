import type { APIRoute } from "astro";
import { prisma } from "../../../lib/prisma";
import { randomUUID, createHmac } from "node:crypto";

const RESET_TOKEN_SECRET = process.env.RESET_TOKEN_SECRET || process.env.AUTH_SECRET || "reset-secret-fallback";
const RESET_TOKEN_EXPIRY_MS = 60 * 60 * 1000;

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

const checkRateLimit = (key: string, maxAttempts: number, windowMs: number): boolean => {
  const now = Date.now();
  const entry = rateLimitMap.get(key);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= maxAttempts) return false;
  entry.count++;
  return true;
};

const generateResetToken = (userId: string): string => {
  const payload = `${userId}.${Date.now()}.${randomUUID()}`;
  const signature = createHmac("sha256", RESET_TOKEN_SECRET).update(payload).digest("hex");
  return `${payload}.${signature}`;
};

const verifyResetToken = (token: string): { userId: string; valid: boolean } => {
  const parts = token.split(".");
  if (parts.length !== 4) return { userId: "", valid: false };

  const [userId, timestamp, _uuid, signature] = parts;
  const payload = `${userId}.${timestamp}.${_uuid}`;
  const expectedSignature = createHmac("sha256", RESET_TOKEN_SECRET).update(payload).digest("hex");

  if (signature !== expectedSignature) return { userId: "", valid: false };

  const tokenAge = Date.now() - parseInt(timestamp, 10);
  if (tokenAge > RESET_TOKEN_EXPIRY_MS) return { userId: "", valid: false };

  return { userId, valid: true };
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { action, email, token, newPassword } = body;

    if (action === "request") {
      const ip = request.headers.get("x-forwarded-for") || "unknown";
      if (!checkRateLimit(`reset:${ip}`, 3, 15 * 60 * 1000)) {
        return new Response(JSON.stringify({ error: "Demasiados intentos. Espera 15 minutos." }), { status: 429 });
      }

      if (!email) {
        return new Response(JSON.stringify({ error: "Email requerido." }), { status: 400 });
      }

      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) {
        return new Response(JSON.stringify({ success: true, message: "Si el email existe, recibiras un enlace de recuperacion." }), { status: 200 });
      }

      const resetToken = generateResetToken(user.id);
      const expiresAt = new Date(Date.now() + RESET_TOKEN_EXPIRY_MS);

      await prisma.user.update({
        where: { id: user.id },
        data: { resetToken, resetTokenExpiresAt: expiresAt },
      });

      const resetUrl = `${process.env.PUBLIC_URL || "https://averionai.es"}/reset-password?token=${resetToken}`;

      console.log(`[password-reset] Reset URL for ${email}: ${resetUrl}`);

      return new Response(JSON.stringify({
        success: true,
        message: "Si el email existe, recibiras un enlace de recuperacion.",
        resetUrl: process.env.NODE_ENV === "development" ? resetUrl : undefined,
      }), { status: 200 });
    }

    if (action === "reset") {
      if (!token || !newPassword) {
        return new Response(JSON.stringify({ error: "Token y nueva contraseña requeridos." }), { status: 400 });
      }

      if (newPassword.length < 8) {
        return new Response(JSON.stringify({ error: "La contraseña debe tener al menos 8 caracteres." }), { status: 400 });
      }

      const { userId, valid } = verifyResetToken(token);
      if (!valid) {
        return new Response(JSON.stringify({ error: "Token invalido o expirado." }), { status: 400 });
      }

      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        return new Response(JSON.stringify({ error: "Usuario no encontrado." }), { status: 404 });
      }

      const { hash } = await import("bcryptjs");
      const passwordHash = await hash(newPassword, 12);

      await prisma.user.update({
        where: { id: userId },
        data: { passwordHash, resetToken: null, resetTokenExpiresAt: null },
      });

      return new Response(JSON.stringify({ success: true, message: "Contraseña actualizada correctamente." }), { status: 200 });
    }

    return new Response(JSON.stringify({ error: "Accion no valida." }), { status: 400 });
  } catch (error) {
    console.error("[password-reset] Error:", error);
    return new Response(JSON.stringify({ error: "Error interno del servidor." }), { status: 500 });
  }
};
