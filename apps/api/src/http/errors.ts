/** An error that already knows which HTTP status it should produce. */
export class HttpError extends Error {
  // `public readonly status` is TypeScript shorthand: it creates `this.status` and sets it,
  // so we don't have to write `this.status = status` ourselves
  constructor(
    public readonly status: number,
    message: string,
    /** Extra fields for the JSON body, e.g. { attemptsLeft: 3 } after a wrong PIN. */
    public readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

/** e.g. notFound('Persona "zed"') → 404 'Persona "zed" not found' */
export const notFound = (what: string) => new HttpError(404, `${what} not found`);
