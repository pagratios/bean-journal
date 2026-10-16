// Decaid's own REST API, as a plugin reaches it on the tablet.
import { optionalObject, text } from "./data";

export const LOCAL = "http://localhost:8080/api/v1";
export type DecaidError = Error & { status?: number; detail?: string };

/**
 * One request to Decaid. An empty answer (the key-value store's 204, a delete) is null. A failure is an Error whose
 * message is an `errors` key of i18n, with Decaid's own words in `detail` for the log.
 */
export async function decaid(path: string, method = "GET", body?: unknown): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(LOCAL + path, {
      method, headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: "error",
    });
  } catch {
    throw new Error("network");
  }
  // Decaid's engine gives text() and json(); json() of an empty body throws, so the text is read and parsed here.
  const raw = await response.text();
  if (!response.ok) {
    let detail = "";
    try { detail = text(optionalObject(JSON.parse(raw)).error).slice(0, 300); } catch { /* no JSON */ }
    const code = response.status === 404 ? "notFound" : response.status === 429 ? "rateLimit" : "requestFailed";
    throw Object.assign(new Error(code), { status: response.status, detail }) as DecaidError;
  }
  if (!raw.trim()) return null;
  try { return JSON.parse(raw); } catch { throw new Error("invalidData"); }
}
