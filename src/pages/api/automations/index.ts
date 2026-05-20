import type { APIRoute } from "astro";
import { getCurrentUser } from "../../../lib/auth";
import { getUserAutomations, createAutomation, getUserAutomationStats } from "../../../lib/automations";
import { SESSION_COOKIE } from "../../../lib/session";

export const prerender = false;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export const GET: APIRoute = async ({ cookies, url }) => {
  const token = cookies.get(SESSION_COOKIE)?.value;
  const user = await getCurrentUser(token);
  if (!user) return json(401, { error: "No autorizado" });

  const stats = url.searchParams.get("stats") === "true";
  if (stats) {
    const data = await getUserAutomationStats(user.id);
    return json(200, data);
  }

  const automations = await getUserAutomations(user.id);
  return json(200, automations);
};

export const POST: APIRoute = async ({ request, cookies }) => {
  const token = cookies.get(SESSION_COOKIE)?.value;
  const user = await getCurrentUser(token);
  if (!user) return json(401, { error: "No autorizado" });

  const body = await request.json().catch(() => null);
  if (!body || !body.name || !body.triggerType || !body.actions?.length) {
    return json(400, { error: "Faltan campos requeridos" });
  }

  try {
    const automation = await createAutomation(user.id, {
      name: body.name,
      description: body.description,
      triggerType: body.triggerType,
      triggerConfig: body.triggerConfig,
      actions: body.actions,
    });
    return json(201, automation);
  } catch (e) {
    return json(500, { error: "Error al crear automatizacion" });
  }
};
