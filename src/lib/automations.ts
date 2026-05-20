import { prisma } from "./prisma";
import { randomUUID } from "node:crypto";

export type AutomationTrigger =
  | "lead.created"
  | "lead.status_changed"
  | "lead.inactive";

export async function getUserAutomations(userId: string) {
  return prisma.automation.findMany({
    where: { userId },
    include: { actions: { orderBy: { order: "asc" } } },
    orderBy: { createdAt: "desc" },
  });
}

export async function createAutomation(
  userId: string,
  data: {
    name: string;
    description?: string;
    triggerType: AutomationTrigger;
    triggerConfig?: string;
    actions: { actionType: string; config?: string; order: number }[];
  }
) {
  return prisma.automation.create({
    data: {
      id: randomUUID(),
      name: data.name,
      description: data.description || null,
      triggerType: data.triggerType,
      triggerConfig: data.triggerConfig || null,
      userId,
      actions: {
        create: data.actions.map((a) => ({
          id: randomUUID(),
          actionType: a.actionType,
          config: a.config || null,
          order: a.order,
        })),
      },
    },
    include: { actions: { orderBy: { order: "asc" } } },
  });
}

export async function toggleAutomation(id: string, userId: string) {
  const auto = await prisma.automation.findFirst({ where: { id, userId } });
  if (!auto) return null;
  return prisma.automation.update({
    where: { id },
    data: { active: !auto.active },
  });
}

export async function deleteAutomation(id: string, userId: string) {
  const auto = await prisma.automation.findFirst({ where: { id, userId } });
  if (!auto) return false;
  await prisma.automation.delete({ where: { id } });
  return true;
}

export async function matchAutomations(
  userId: string,
  trigger: AutomationTrigger,
  context: Record<string, unknown>
) {
  const automations = await prisma.automation.findMany({
    where: { userId, active: true, triggerType: trigger },
    include: { actions: { orderBy: { order: "asc" } } },
  });

  return automations.filter((a) => {
    if (!a.triggerConfig) return true;
    try {
      const config = JSON.parse(a.triggerConfig);
      if (trigger === "lead.status_changed") {
        if (config.from && context.oldStatus !== config.from) return false;
        if (config.to && context.newStatus !== config.to) return false;
      }
      if (trigger === "lead.inactive") {
        if (config.days && typeof context.inactiveDays === "number") {
          return (context.inactiveDays as number) >= config.days;
        }
      }
      return true;
    } catch {
      return true;
    }
  });
}

export async function executeAutomation(
  automation: {
    id: string;
    triggerType: string;
    actions: { actionType: string; config: string | null; order: number }[];
  },
  userId: string,
  triggerEntityId?: string,
  triggerType?: string
) {
  const execution = await prisma.automationExecution.create({
    data: {
      id: randomUUID(),
      status: "running",
      triggeredBy: triggerType || automation.triggerType,
      triggerEntityId,
      automationId: automation.id,
    },
  });

  let allSuccess = true;

  for (const action of automation.actions) {
    const actionExec = await prisma.automationActionExecution.create({
      data: {
        id: randomUUID(),
        actionType: action.actionType,
        status: "running",
        executionId: execution.id,
      },
    });

    try {
      const result = await executeAction(action, triggerEntityId, userId);
      await prisma.automationActionExecution.update({
        where: { id: actionExec.id },
        data: { status: "success", result: JSON.stringify(result), completedAt: new Date() },
      });
    } catch (error) {
      allSuccess = false;
      await prisma.automationActionExecution.update({
        where: { id: actionExec.id },
        data: { status: "failed", result: (error as Error).message, completedAt: new Date() },
      });
    }
  }

  await prisma.automationExecution.update({
    where: { id: execution.id },
    data: { status: allSuccess ? "success" : "failed", completedAt: new Date() },
  });

  return execution;
}

async function executeAction(
  action: { actionType: string; config: string | null },
  triggerEntityId?: string,
  userId?: string
): Promise<Record<string, unknown>> {
  const config = action.config ? JSON.parse(action.config) : {};

  switch (action.actionType) {
    case "lead.move":
      if (triggerEntityId && config.targetStatus) {
        await prisma.lead.update({
          where: { id: triggerEntityId },
          data: { status: config.targetStatus },
        });
        return { moved: true, to: config.targetStatus };
      }
      break;

    case "note.add":
      if (triggerEntityId && config.text) {
        await prisma.leadNote.create({
          data: { id: randomUUID(), text: `[auto] ${config.text}`, leadId: triggerEntityId },
        });
        return { noteAdded: true };
      }
      break;

    case "tag.add":
      if (triggerEntityId && config.tag && userId) {
        const lead = await prisma.lead.findFirst({ where: { id: triggerEntityId, userId } });
        if (lead) {
          const currentTags = lead.tags ? lead.tags.split(",").map((t) => t.trim()).filter(Boolean) : [];
          if (!currentTags.includes(config.tag)) {
            currentTags.push(config.tag);
            await prisma.lead.update({ where: { id: triggerEntityId }, data: { tags: currentTags.join(", ") } });
          }
          return { tagsAdded: [config.tag] };
        }
      }
      break;

    case "ai.classify":
      return { classified: true, note: "AI classification requires external provider" };

    case "email.send":
      return { email: true, note: "Email sending requires Resend integration" };

    default:
      return { executed: action.actionType };
  }

  return {};
}

export async function getUserAutomationStats(userId: string) {
  const total = await prisma.automation.count({ where: { userId } });
  const active = await prisma.automation.count({ where: { userId, active: true } });

  const executions = await prisma.automationExecution.findMany({
    where: {
      automation: { userId },
      createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    },
    include: { actions: true, automation: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  const todayTotal = executions.length;
  const todaySuccess = executions.filter((e) => e.status === "success").length;
  const todayErrors = todayTotal - todaySuccess;
  const minutesSaved = todayTotal * 15;
  const health = todayTotal > 0 ? Math.round((todaySuccess / todayTotal) * 100) : 100;

  const leadsProcessed = executions.filter((e) => e.triggerEntityId).length;

  return {
    total,
    active,
    executionsToday: todayTotal,
    successToday: todaySuccess,
    errorsToday: todayErrors,
    minutesSaved,
    health,
    leadsProcessed,
    recentExecutions: executions,
  };
}

export async function getLeadExecutions(leadId: string, userId: string) {
  return prisma.automationExecution.findMany({
    where: {
      triggerEntityId: leadId,
      automation: { userId },
    },
    include: { actions: true, automation: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
}

export async function fireAutomationTriggers(
  userId: string,
  trigger: AutomationTrigger,
  context: Record<string, unknown>,
  triggerEntityId?: string
) {
  const automations = await matchAutomations(userId, trigger, context);
  return Promise.allSettled(
    automations.map((a) => executeAutomation(a, userId, triggerEntityId, trigger))
  );
}

export async function generateReferralCode(userId: string, name: string): Promise<string> {
  const code = name.toUpperCase().slice(0, 4).replace(/[^A-Z]/g, "") + userId.slice(0, 6).toUpperCase();
  try {
    await prisma.user.update({ where: { id: userId }, data: { referralCode: code } });
  } catch {
    const fallback = userId.slice(0, 8).toUpperCase();
    await prisma.user.update({ where: { id: userId }, data: { referralCode: fallback } });
  }
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { referralCode: true } });
  return user?.referralCode || userId.slice(0, 8).toUpperCase();
}

export async function applyReferral(referralCode: string, newUserId: string) {
  const referrer = await prisma.user.findUnique({ where: { referralCode } });
  if (!referrer) return null;
  await prisma.user.update({
    where: { id: newUserId },
    data: { referredBy: referrer.id, referralDiscount: 20 },
  });
  return referrer.id;
}
