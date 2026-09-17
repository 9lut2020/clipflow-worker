import type { Context } from "hono";

export type SortOrder = "asc" | "desc";

export type ListQuery<TSort extends string = string> = {
  page: number;
  limit: number;
  offset: number;
  q?: string;
  sortBy: TSort;
  sortOrder: SortOrder;
};

export class ApiQueryError extends Error {
  constructor(message: string, public readonly fields?: Record<string, string>) {
    super(message);
    this.name = "ApiQueryError";
  }
}

export function parseListQuery<TSort extends string>(
  c: Context,
  options: {
    allowedSort: readonly TSort[];
    defaultSort: TSort;
    defaultLimit?: number;
    maxLimit?: number;
  },
): ListQuery<TSort> {
  const pageRaw = c.req.query("page") ?? "1";
  const limitRaw = c.req.query("limit") ?? String(options.defaultLimit ?? 20);
  const page = Number(pageRaw);
  const limit = Number(limitRaw);
  const maxLimit = options.maxLimit ?? 100;
  const q = c.req.query("q")?.trim();
  const sortBy = (c.req.query("sortBy") ?? options.defaultSort) as TSort;
  const sortOrder = (c.req.query("sortOrder") ?? "desc") as SortOrder;

  const fields: Record<string, string> = {};
  if (!Number.isInteger(page) || page < 1) fields.page = "page must be an integer greater than 0";
  if (!Number.isInteger(limit) || limit < 1 || limit > maxLimit) fields.limit = `limit must be between 1 and ${maxLimit}`;
  if (q && q.length > 100) fields.q = "q must not exceed 100 characters";
  if (!options.allowedSort.includes(sortBy)) fields.sortBy = `sortBy must be one of: ${options.allowedSort.join(", ")}`;
  if (sortOrder !== "asc" && sortOrder !== "desc") fields.sortOrder = "sortOrder must be asc or desc";
  if (Object.keys(fields).length) throw new ApiQueryError("Invalid query parameters", fields);

  return { page, limit, offset: (page - 1) * limit, q: q || undefined, sortBy, sortOrder };
}

export function parseOptionalBoolean(value?: string) {
  if (value === undefined || value === "") return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new ApiQueryError("Invalid query parameters", { boolean: "Expected true or false" });
}

export function parseDate(value: string | undefined, field: string) {
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(new Date(`${value}T00:00:00Z`).getTime())) {
    throw new ApiQueryError("Invalid query parameters", { [field]: "Expected YYYY-MM-DD" });
  }
  return value;
}

export function parseMultiValue(c: Context, key: string): string[] {
  const url = new URL(c.req.url);
  return url.searchParams.getAll(key).flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean);
}

export function paginated<T>(items: T[], total: number, page: number, limit: number, context?: unknown) {
  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
  return {
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrevious: page > 1,
    },
    ...(context === undefined ? {} : { context }),
  };
}

export function apiError(c: Context, status: 400 | 401 | 403 | 404 | 409 | 422 | 500, code: string, message: string, errors?: unknown) {
  return c.json({ status: "error", code, message, data: null, ...(errors ? { errors } : {}) }, status);
}

export function handleApiError(c: Context, error: unknown) {
  if (error instanceof ApiQueryError) return apiError(c, 400, "VALIDATION_ERROR", error.message, error.fields);
  console.error("[API_ERROR]", error);
  return apiError(c, 500, "INTERNAL_ERROR", "Internal server error");
}
