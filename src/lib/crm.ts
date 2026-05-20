import { prisma } from "./prisma";
import { randomUUID } from "node:crypto";
import { onLeadCreated, onLeadStatusChanged, onLeadEdited } from "./timeline";

export const LEAD_STATUSES = [
  "nuevo",
  "contactado",
  "cualificado",
  "propuesta_enviada",
  "ganado",
  "perdido",
] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number];

export interface CreateLeadInput {
  name: string;
  email: string;
  company?: string | null;
  phone?: string | null;
  message?: string;
  source?: string;
  tags?: string;
}

export interface UpdateLeadInput {
  name?: string;
  email?: string;
  company?: string | null;
  phone?: string | null;
  message?: string;
  status?: LeadStatus;
  source?: string;
  tags?: string;
}

export interface LeadFilters {
  status?: string;
  search?: string;
  tags?: string;
  sort?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

function isValidStatus(s: string): s is LeadStatus {
  return LEAD_STATUSES.includes(s as LeadStatus);
}

function sanitizeSearch(s: string): string {
  return s.replace(/[<>{}`$\\]/g, "").trim();
}

export async function getUserLeads(
  userId: string,
  options?: LeadFilters
): Promise<PaginatedResult<any>> {
  const page = Math.max(1, options?.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, options?.pageSize ?? 50));

  const where: Record<string, unknown> = { userId };

  if (options?.status && isValidStatus(options.status)) {
    where.status = options.status;
  }

  if (options?.search) {
    const s = sanitizeSearch(options.search);
    if (s) {
      where.AND = [
        { userId },
        {
          OR: [
            { name: { contains: s, mode: "insensitive" } },
            { email: { contains: s, mode: "insensitive" } },
            { company: { contains: s, mode: "insensitive" } },
            { message: { contains: s, mode: "insensitive" } },
            { tags: { contains: s, mode: "insensitive" } },
          ],
        },
      ];
      delete where.userId;
    }
  }

  if (options?.tags) {
    const tagList = options.tags.split(",").map((t) => t.trim()).filter(Boolean);
    if (tagList.length > 0) {
      const tagFilters = tagList.map((tag) => ({
        tags: { contains: tag, mode: "insensitive" },
      }));
      const baseWhere = where.AND ? (where.AND as any[]) : [];
      baseWhere.push({ OR: tagFilters });
      where.AND = baseWhere;
      if (!options.search) delete where.userId;
    }
  }

  const [data, total] = await Promise.all([
    prisma.lead.findMany({
      where: where as any,
      orderBy: { updatedAt: options?.sort === "asc" ? "asc" : "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        notes: {
          orderBy: { createdAt: "desc" },
          take: 5,
        },
      },
    }),
    prisma.lead.count({ where: where as any }),
  ]);

  return {
    data,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

export async function getUserLead(leadId: string, userId: string) {
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, userId },
    include: {
      notes: {
        orderBy: { createdAt: "desc" },
      },
    },
  });

  return lead;
}

export async function createUserLead(
  userId: string,
  input: CreateLeadInput
) {
  const lead = await prisma.lead.create({
    data: {
      id: randomUUID(),
      name: input.name.trim(),
      email: input.email.trim().toLowerCase(),
      company: input.company?.trim() || null,
      phone: input.phone?.trim() || null,
      message: (input.message || "").trim(),
      source: input.source?.trim() || "manual",
      tags: input.tags?.trim() || null,
      status: "nuevo",
      userId,
    },
  });

  onLeadCreated(lead.id, userId).catch(() => {});
  const { fireAutomationTriggers } = await import("./automations");
  fireAutomationTriggers(userId, "lead.created", {}, lead.id).catch(() => {});
  return lead;
}

export async function updateUserLead(
  leadId: string,
  userId: string,
  input: UpdateLeadInput
) {
  const existing = await prisma.lead.findFirst({
    where: { id: leadId, userId },
  });

  if (!existing) return null;

  const data: Record<string, unknown> = {};

  if (input.name !== undefined) data.name = input.name.trim();
  if (input.email !== undefined) data.email = input.email.trim().toLowerCase();
  if (input.company !== undefined) data.company = input.company?.trim() || null;
  if (input.phone !== undefined) data.phone = input.phone?.trim() || null;
  if (input.message !== undefined) data.message = input.message.trim();
  if (input.source !== undefined) data.source = input.source.trim();
  if (input.tags !== undefined) data.tags = input.tags.trim() || null;
  if (input.status !== undefined && isValidStatus(input.status)) {
    data.status = input.status;
  }

  const updated = await prisma.lead.update({
    where: { id: leadId },
    data,
  });

  if (input.status && existing.status !== input.status) {
    onLeadStatusChanged(leadId, userId, existing.status, input.status).catch(() => {});
    const { fireAutomationTriggers } = await import("./automations");
    fireAutomationTriggers(
      userId,
      "lead.status_changed",
      { oldStatus: existing.status, newStatus: input.status },
      leadId
    ).catch(() => {});
  } else if (Object.keys(data).length > 0) {
    onLeadEdited(leadId, userId).catch(() => {});
  }

  return updated;
}

export async function deleteUserLead(leadId: string, userId: string) {
  const existing = await prisma.lead.findFirst({
    where: { id: leadId, userId },
  });

  if (!existing) return false;

  await prisma.lead.delete({ where: { id: leadId } });
  return true;
}

export async function addLeadNote(
  leadId: string,
  userId: string,
  text: string
) {
  const existing = await prisma.lead.findFirst({
    where: { id: leadId, userId },
  });

  if (!existing) return null;

  const note = await prisma.leadNote.create({
    data: {
      id: randomUUID(),
      text: text.trim(),
      leadId,
    },
  });

  return note;
}

export async function getLeadNotes(leadId: string, userId: string) {
  const existing = await prisma.lead.findFirst({
    where: { id: leadId, userId },
  });

  if (!existing) return null;

  return prisma.leadNote.findMany({
    where: { leadId },
    orderBy: { createdAt: "desc" },
  });
}

export async function getUserLeadCounts(userId: string) {
  const all = await prisma.lead.count({ where: { userId } });
  const thisMonth = await prisma.lead.count({
    where: {
      userId,
      createdAt: {
        gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
      },
    },
  });
  const ganados = await prisma.lead.count({
    where: { userId, status: "ganado" },
  });
  const activos = await prisma.lead.count({
    where: {
      userId,
      status: { in: ["nuevo", "contactado", "cualificado", "propuesta_enviada"] },
    },
  });

  const porEstado = await Promise.all(
    LEAD_STATUSES.map(async (s) => ({
      estado: s,
      count: await prisma.lead.count({ where: { userId, status: s } }),
    }))
  );

  const conversion = all > 0 ? Math.round((ganados / all) * 100) : 0;

  return { total: all, thisMonth, ganados, activos, conversion, porEstado };
}

export async function getUserRecentActivity(userId: string, limit = 10) {
  return prisma.lead.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    take: limit,
    include: {
      notes: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });
}
