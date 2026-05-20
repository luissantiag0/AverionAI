import type { APIRoute } from "astro";
import { getCurrentUser } from "../../../lib/auth";
import { toggleAutomation, deleteAutomation } from "../../../lib/automations";
import { SESSION_COOKIE } from "../../../lib/session";

export const prerender = false;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export const PATCH: APIRoute = async ({ params, cookies }) => {
  const token = cookies.get(SESSION_COOKIE)?.value;
  const user = await getCurrentUser(token);
  if (!user) return json(401, { error: "No autorizado" });

  const auto = await toggleAutomation(params.id!, user.id);
  if (!auto) return json(404, { error: "No encontrada" });
  return json(200, auto);
};

export const DELETE: APIRoute = async ({ params, cookies }) => {
  const token = cookies.get(SESSION_COOKIE)?.value;
  const user = await getCurrentUser(token);
  if (!user) return json(401, { error: "No autorizado" });

  const ok = await deleteAutomation(params.id!, user.id);
  if (!ok) return json(404, { error: "No encontrada" });
  return json(200, { success: true });
};
