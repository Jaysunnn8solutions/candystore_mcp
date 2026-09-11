import { ZodError } from "zod";

/** Shared error translation for the JSON routes. */
export function handleApiError(err: unknown): Response {
  if (err instanceof ZodError) {
    return Response.json({ error: "Invalid parameters", issues: err.issues }, { status: 400 });
  }
  if (err instanceof SyntaxError) {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }
  throw err;
}

/** Merge query-string params with an optional JSON body into one object. */
export async function requestInput(request: Request): Promise<Record<string, unknown>> {
  const query = Object.fromEntries(new URL(request.url).searchParams);
  delete query.v; // cache-busting version tag from the client, not a parameter
  if (request.method === "POST") {
    const body = (await request.json()) as Record<string, unknown>;
    return { ...query, ...body };
  }
  return query;
}
