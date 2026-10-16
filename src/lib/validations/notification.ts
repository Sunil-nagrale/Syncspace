import { z } from "zod";

export const listNotificationsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().trim().optional(),
  filter: z.enum(["all", "unread"]).default("all"),
});

export const mentionSuggestionsQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
});
