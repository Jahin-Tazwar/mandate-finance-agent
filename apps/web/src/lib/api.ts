import {
  Account,
  Action,
  Bill,
  Budget,
  DemoAccount,
  Forecast,
  Mandate,
  PayCycle,
  Persona,
  RuleSuggestion,
  Subscription,
  Transaction,
  TransactionPage,
  Wish,
  WishDetail,
  WishImpact,
  WishInput,
  WishList,
  WishPatch,
  WishPreview,
} from "@mandate/shared";

export type Parser<T> = (value: unknown) => T;

export class ApiError extends Error {
  attemptsLeft?: number;
  retryAfterSeconds?: number;
  issues?: unknown[];

  constructor(
    message: string,
    readonly status: number,
    data?: { attemptsLeft?: number; retryAfterSeconds?: number; issues?: unknown[] }
  ) {
    super(message);
    this.name = "ApiError";
    if (data) {
      this.attemptsLeft = data.attemptsLeft;
      this.retryAfterSeconds = data.retryAfterSeconds;
      this.issues = data.issues;
    }
  }
}

export const parsePersonas: Parser<Persona[]> = (value) => Persona.array().parse(value);
export const parseAccounts: Parser<Account[]> = (value) => Account.array().parse(value);
export const parseBudget: Parser<Budget> = (value) => Budget.parse(value);
export const parseForecast: Parser<Forecast> = (value) => Forecast.parse(value);
export const parsePayCycle: Parser<PayCycle> = (value) => PayCycle.parse(value);
export const parseBills: Parser<Bill[]> = (value) => Bill.array().parse(value);
export const parseSubscriptions: Parser<Subscription[]> = (value) => Subscription.array().parse(value);
export const parseTransactions: Parser<TransactionPage> = (value) => TransactionPage.parse(value);
export const parseActions: Parser<Action[]> = (value) => Action.array().parse(value);
export const parseAction: Parser<Action> = (value) => Action.parse(value);
export const parseMandate: Parser<Mandate> = (value) => Mandate.parse(value);
export const parseWishList: Parser<WishList> = (value) => WishList.parse(value);
export const parseWish: Parser<Wish> = (value) => Wish.parse(value);
export const parseWishDetail: Parser<WishDetail> = (value) => WishDetail.parse(value);
export const parseWishPreview: Parser<WishPreview> = (value) => WishPreview.parse(value);
export const parseWishImpact: Parser<WishImpact> = (value) => WishImpact.parse(value);

export async function apiRequest<T>(
  path: string,
  parse?: Parser<T>,
  options: {
    method?: "GET" | "POST" | "PATCH" | "DELETE" | "HEAD";
    body?: unknown;
    headers?: Record<string, string>;
    signal?: AbortSignal;
  } = {}
): Promise<T> {
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
  const response = await fetch(path, {
    method: options.method ?? "GET",
    credentials: "include",
    signal: options.signal,
    headers: {
      Accept: "application/json",
      ...(isFormData || options.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...options.headers,
    },
    body: isFormData ? (options.body as FormData) : options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (response.status === 204) {
    return null as unknown as T;
  }

  let body: any = null;
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    body = await response.json().catch(() => null);
  }

  if (!response.ok) {
    const serverMessage =
      typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
        ? body.error
        : `Request failed (${response.status})`;
    const message = response.status === 403 && body?.attemptsLeft === undefined
      ? "That isn't your account."
      : serverMessage;
    if (
      response.status === 401 &&
      typeof window !== "undefined" &&
      !path.includes("/auth/login") &&
      !path.includes("/auth/me") &&
      !path.includes("/auth/demo-accounts")
    ) {
      window.dispatchEvent(new Event("moneywise:unauthorized"));
    }
    throw new ApiError(message, response.status, {
      attemptsLeft: body?.attemptsLeft,
      retryAfterSeconds: body?.retryAfterSeconds,
      issues: body?.issues,
    });
  }

  return parse ? parse(body) : (body as T);
}

export function apiGet<T>(path: string, parse?: Parser<T>, signal?: AbortSignal): Promise<T> {
  return apiRequest(path, parse, { method: "GET", signal });
}

// ---------------- API Client Functions ----------------

// System
export const getHealth = (signal?: AbortSignal) =>
  apiRequest<{ ok: boolean; service: string; time: string }>("/api/health", undefined, { signal });

export const resetDemo = (adminKey?: string) =>
  apiRequest<{ ok: boolean; resetAt: string }>("/api/admin/reset", undefined, {
    method: "POST",
    headers: adminKey ? { "x-admin-key": adminKey } : undefined,
  });

// Auth
export const getDemoAccounts = () =>
  apiRequest<DemoAccount[]>("/api/auth/demo-accounts", (val) => DemoAccount.array().parse(val));

export const login = (username: string, password: string) =>
  apiRequest<Persona>("/api/auth/login", (val) => Persona.parse(val), {
    method: "POST",
    body: { username, password },
  });

export const getMe = (signal?: AbortSignal) =>
  apiRequest<{ persona: Persona }>("/api/auth/me", undefined, { signal });

export const logout = () =>
  apiRequest<null>("/api/auth/logout", undefined, { method: "POST" });

// Personas & Bank Data
export const getPersonas = () => apiGet<Persona[]>("/api/personas", parsePersonas);

export const getAccounts = (personaId: string, signal?: AbortSignal) =>
  apiGet<Account[]>(`/api/personas/${encodeURIComponent(personaId)}/accounts`, parseAccounts, signal);

export const getBudget = (personaId: string, month?: string, signal?: AbortSignal) => {
  const query = month ? `?month=${encodeURIComponent(month)}` : "";
  return apiGet<Budget>(`/api/personas/${encodeURIComponent(personaId)}/budget${query}`, parseBudget, signal);
};

export const getForecast = (personaId: string, signal?: AbortSignal) =>
  apiGet<Forecast>(`/api/personas/${encodeURIComponent(personaId)}/forecast`, parseForecast, signal);

export const getPayCycle = (personaId: string, signal?: AbortSignal) =>
  apiGet<PayCycle>(`/api/personas/${encodeURIComponent(personaId)}/pay-cycle`, parsePayCycle, signal);

export const getBills = (personaId: string, signal?: AbortSignal) =>
  apiGet<Bill[]>(`/api/personas/${encodeURIComponent(personaId)}/bills`, parseBills, signal);

export const getSubscriptions = (personaId: string, signal?: AbortSignal) =>
  apiGet<Subscription[]>(`/api/personas/${encodeURIComponent(personaId)}/subscriptions`, parseSubscriptions, signal);

export const getTransactions = (
  personaId: string,
  options?: { limit?: number; offset?: number; category?: string; from?: string; to?: string },
  signal?: AbortSignal
) => {
  const params = new URLSearchParams();
  if (options?.limit) params.set("limit", String(options.limit));
  if (options?.offset) params.set("offset", String(options.offset));
  if (options?.category) params.set("category", options.category);
  if (options?.from) params.set("from", options.from);
  if (options?.to) params.set("to", options.to);
  const qs = params.toString() ? `?${params.toString()}` : "";
  return apiGet<TransactionPage>(`/api/personas/${encodeURIComponent(personaId)}/transactions${qs}`, parseTransactions, signal);
};

// Wishes
export const getWishes = (personaId: string, signal?: AbortSignal) =>
  apiGet<WishList>(`/api/personas/${encodeURIComponent(personaId)}/wishes`, parseWishList, signal);

export const previewWish = (personaId: string, input: WishInput, signal?: AbortSignal) =>
  apiRequest<WishPreview>(`/api/personas/${encodeURIComponent(personaId)}/wishes/preview`, parseWishPreview, {
    method: "POST",
    body: input,
    signal,
  });

export const createWish = (personaId: string, input: WishInput) =>
  apiRequest<Wish>(`/api/personas/${encodeURIComponent(personaId)}/wishes`, parseWish, {
    method: "POST",
    body: input,
  });

export const getWish = (wishId: string, signal?: AbortSignal) =>
  apiGet<WishDetail>(`/api/wishes/${encodeURIComponent(wishId)}`, parseWishDetail, signal);

export const patchWish = (wishId: string, patch: WishPatch) =>
  apiRequest<Wish>(`/api/wishes/${encodeURIComponent(wishId)}`, parseWish, {
    method: "PATCH",
    body: patch,
  });

export const deleteWish = (wishId: string) =>
  apiRequest<null>(`/api/wishes/${encodeURIComponent(wishId)}`, undefined, {
    method: "DELETE",
  });

export const contributeWish = (wishId: string, amountCents: number) =>
  apiRequest<Action>(`/api/wishes/${encodeURIComponent(wishId)}/contribute`, parseAction, {
    method: "POST",
    body: { amountCents },
  });

export const getWishImpact = (personaId: string, amountCents: number, signal?: AbortSignal) =>
  apiGet<WishImpact>(`/api/personas/${encodeURIComponent(personaId)}/wishes/impact?amountCents=${amountCents}`, parseWishImpact, signal);

// Agent & Actions
export const getApprovals = (personaId: string, signal?: AbortSignal) =>
  apiGet<Action[]>(`/api/personas/${encodeURIComponent(personaId)}/approvals`, parseActions, signal);

export const getActions = (personaId: string, limit = 50, signal?: AbortSignal) =>
  apiGet<Action[]>(`/api/personas/${encodeURIComponent(personaId)}/actions?limit=${limit}`, parseActions, signal);

export const decideAction = (actionId: string, decision: "approve" | "reject", pin?: string) =>
  apiRequest<Action>(`/api/actions/${encodeURIComponent(actionId)}/decision`, parseAction, {
    method: "POST",
    body: decision === "approve" ? { decision: "approve", pin } : { decision: "reject" },
  });

export const runPayday = (personaId: string) =>
  apiRequest<{ paycheck: Transaction | null; actions: Action[] }>(
    `/api/personas/${encodeURIComponent(personaId)}/agent/run`,
    undefined,
    { method: "POST", body: { trigger: "payday" } }
  );

export const getKillSwitch = (personaId: string, signal?: AbortSignal) =>
  apiGet<{ enabled: boolean }>(`/api/personas/${encodeURIComponent(personaId)}/killswitch`, undefined, signal);

export const setKillSwitch = (personaId: string, enabled: boolean, pin?: string) =>
  apiRequest<{ enabled: boolean }>(`/api/personas/${encodeURIComponent(personaId)}/killswitch`, undefined, {
    method: "POST",
    body: enabled ? { enabled: true } : { enabled: false, pin },
  });

// Mandate & Rules
export const getMandate = (personaId: string, signal?: AbortSignal) =>
  apiGet<Mandate>(`/api/personas/${encodeURIComponent(personaId)}/mandate`, parseMandate, signal);

export const compileMandate = (personaId: string, text: string, signal?: AbortSignal) =>
  apiRequest<{ policy: unknown; summary: string[]; warnings: string[]; notUnderstood: string[] }>(
    `/api/personas/${encodeURIComponent(personaId)}/mandate/compile`,
    undefined,
    { method: "POST", body: { text }, signal }
  );

export const explainMandate = (personaId: string, sentences: string[]) =>
  apiRequest<{ suggestions: RuleSuggestion[] }>(
    `/api/personas/${encodeURIComponent(personaId)}/mandate/explain`,
    undefined,
    { method: "POST", body: { sentences } }
  );

export const signMandate = (personaId: string, naturalLanguage: string, pin: string) =>
  apiRequest<Mandate & { warnings: string[] }>(
    `/api/personas/${encodeURIComponent(personaId)}/mandate/sign`,
    undefined,
    { method: "POST", body: { naturalLanguage, pin } }
  );

export const checkPolicy = (personaId: string, proposedAction: unknown) =>
  apiRequest<{ action: unknown; decision: "allow" | "require_approval" | "deny"; tier: string; reasons: string[] }>(
    `/api/personas/${encodeURIComponent(personaId)}/policy/check`,
    undefined,
    { method: "POST", body: proposedAction }
  );

// Documents
export interface UploadDocumentResult {
  billId: string;
  extracted: { payee: string; amountCents: number; dueDate: string; accountNumber?: string };
  untrusted: boolean;
  warnings: string[];
  actions: Action[];
}

export const uploadDocument = async (personaId: string, file: File | Blob, filename = "bill.pdf") => {
  const formData = new FormData();
  formData.append("file", file, filename);
  return apiRequest<UploadDocumentResult>(`/api/personas/${encodeURIComponent(personaId)}/documents`, undefined, {
    method: "POST",
    body: formData,
  });
};

// Audit & Anchors
export interface AuditEntry {
  personaId: string | null;
  eventType: string;
  actor: { type: "user" | "agent" | "system"; personaId?: string };
  summary: string;
  payload: Record<string, unknown>;
  seq: number;
  ts: string;
  prevHash: string;
  hash: string;
}

export interface VerifyAuditResult {
  valid: boolean;
  entries: number;
  brokenAt: number | null;
}

export interface Anchor {
  seq: number;
  hash: string;
  chain: string;
  txHash: string;
  explorerUrl: string;
  anchoredAt: string;
  matchesLog: boolean;
}

export const getAudit = (personaId?: string, limit = 100, signal?: AbortSignal) => {
  const params = new URLSearchParams();
  if (personaId) params.set("personaId", personaId);
  params.set("limit", String(limit));
  return apiGet<AuditEntry[]>(`/api/audit?${params.toString()}`, undefined, signal);
};

export const verifyAudit = (signal?: AbortSignal) =>
  apiGet<VerifyAuditResult>("/api/audit/verify", undefined, signal);

export const getAnchorsStatus = (signal?: AbortSignal) =>
  apiGet<{ enabled: boolean; chain: string }>("/api/anchors/status", undefined, signal);

export const getAnchors = (signal?: AbortSignal) =>
  apiGet<Anchor[]>("/api/anchors", undefined, signal);

export const anchorAudit = () =>
  apiRequest<{ anchor: Anchor | null }>("/api/audit/anchor", undefined, { method: "POST" });

export const checkAnchor = (txHash: string) =>
  apiGet<{ txHash: string; onChain: boolean; seq: number; hash: string; matchesLog: boolean }>(
    `/api/anchors/${encodeURIComponent(txHash)}/check`
  );
