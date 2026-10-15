import {
  Account,
  Bill,
  Budget,
  Forecast,
  PayCycle,
  Persona,
  Subscription,
  TransactionPage,
} from "@mandate/shared";

export type Parser<T> = (value: unknown) => T;

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
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

export async function apiRequest<T>(
  path: string,
  parse: Parser<T>,
  options: { method?: "GET" | "POST" | "PATCH"; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const response = await fetch(path, {
    method: options.method ?? "GET",
    signal: options.signal,
    headers: {
      Accept: "application/json",
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
        ? body.error
        : `Request failed (${response.status})`;
    throw new ApiError(message, response.status);
  }

  return parse(body);
}

export function apiGet<T>(path: string, parse: Parser<T>, signal?: AbortSignal): Promise<T> {
  return apiRequest(path, parse, { signal });
}
