import {
  Account,
  AuthMeResponse,
  Bill,
  Budget,
  DemoAccount,
  Forecast,
  PayCycle,
  Persona,
  Subscription,
  TransactionPage,
} from "@mandate/shared";

export type Parser<T> = (value: unknown) => T;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly attemptsLeft?: number,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "ApiError";
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
export const parseDemoAccounts: Parser<DemoAccount[]> = (value) => DemoAccount.array().parse(value);

export async function apiRequest<T>(
  path: string,
  parse: Parser<T>,
  options: { method?: "GET" | "POST" | "PATCH"; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const response = await fetch(path, {
    method: options.method ?? "GET",
    signal: options.signal,
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    let attemptsLeft: number | undefined;
    let retryAfterSeconds: number | undefined;

    if (typeof body === "object" && body !== null) {
      if ("error" in body && typeof body.error === "string") {
        message = body.error;
      }
      if ("attemptsLeft" in body && typeof body.attemptsLeft === "number") {
        attemptsLeft = body.attemptsLeft;
      }
      if ("retryAfterSeconds" in body && typeof body.retryAfterSeconds === "number") {
        retryAfterSeconds = body.retryAfterSeconds;
      }
    }

    throw new ApiError(message, response.status, attemptsLeft, retryAfterSeconds);
  }

  return parse(body);
}

export function apiGet<T>(path: string, parse: Parser<T>, signal?: AbortSignal): Promise<T> {
  return apiRequest(path, parse, { signal });
}

export async function fetchAuthMe(): Promise<Persona | null> {
  try {
    const res = await apiRequest("/api/auth/me", (val) => AuthMeResponse.parse(val));
    return res.persona;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      return null;
    }
    // Also if API is down or not responding, let caller handle or return null
    return null;
  }
}

export async function fetchDemoAccounts(): Promise<DemoAccount[]> {
  return apiGet("/api/auth/demo-accounts", parseDemoAccounts);
}

export async function apiLogin(username: string, password: string): Promise<Persona> {
  return apiRequest(
    "/api/auth/login",
    (val) => Persona.parse(val),
    {
      method: "POST",
      body: { username, password },
    },
  );
}

export async function apiLogout(): Promise<void> {
  await fetch("/api/auth/logout", {
    method: "POST",
    credentials: "include",
    headers: {
      Accept: "application/json",
    },
  });
}
