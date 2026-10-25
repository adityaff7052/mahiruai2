import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { LIVE_MODEL, LIVE_API_VERSION, buildLiveConfig } from "./mahiru-config";

export type KeyCheckStatus = "ok" | "failed" | "not_configured" | "same_as_primary";
export type KeyDiagnostics = { primary: KeyCheckStatus; backup: KeyCheckStatus; selected: "primary" | "backup" };

function errorInfo(error: unknown): { status?: number; text: string } {
  if (!error || typeof error !== "object") return { text: String(error ?? "").toLowerCase() };
  const value = error as Record<string, unknown>;
  const response = value["response"] && typeof value["response"] === "object" ? value["response"] as Record<string, unknown> : undefined;
  const nested = value["error"] && typeof value["error"] === "object" ? value["error"] as Record<string, unknown> : undefined;
  const rawStatus = value["status"] ?? value["statusCode"] ?? response?.["status"] ?? nested?.["code"];
  const parsed = typeof rawStatus === "number" ? rawStatus : Number(rawStatus);
  const status = Number.isFinite(parsed) ? parsed : undefined;
  const text = [value["message"], value["code"], value["status"], value["statusText"], response?.["statusText"], nested?.["message"], nested?.["status"]]
    .filter((part) => typeof part === "string" || typeof part === "number").join(" ").toLowerCase();
  return { status, text };
}

/** Only an error class, never the key or raw provider payload, is sent to the browser. */
function shouldTryBackup(error: unknown): boolean {
  const { status, text } = errorInfo(error);
  if (status === 401 || status === 403 || status === 429) return true;
  return /resource[_ -]?exhausted|quota|rate[ -]?limit|too many requests|api.?key.{0,32}(invalid|not valid|rejected|denied)|(?:invalid|not valid).{0,24}api.?key|unauthenticated|unauthorized|permission[_ -]?denied|billing|forbidden/i.test(text);
}

const liveTokenInput = z.object({ includeHistory: z.boolean().optional() }).transform((value) => ({ includeHistory: value.includeHistory === true }));

async function createLiveToken(apiKey: string, includeHistory = false): Promise<string> {
  const { GoogleGenAI, Modality } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: LIVE_API_VERSION } });
  const now = Date.now();
  const token = await ai.authTokens.create({
    config: {
      uses: 1,
      expireTime: new Date(now + 30 * 60_000).toISOString(),
      newSessionExpireTime: new Date(now + 5 * 60_000).toISOString(),
      liveConnectConstraints: {
        model: LIVE_MODEL,
        config: { ...buildLiveConfig(Modality, includeHistory), sessionResumption: {} },
      },
      httpOptions: { apiVersion: LIVE_API_VERSION },
    },
  });
  if (!token.name) throw new Error("Gemini did not return a temporary Live token.");
  return token.name;
}

/**
 * Mints a primary token and, when configured, validates that the backup key can
 * also mint a token. Only statuses are returned; key values never leave server code.
 */
export const mintLiveToken = createServerFn({ method: "POST" })
  .inputValidator(liveTokenInput)
  .handler(async ({ data }) => {
  const includeHistory = data.includeHistory;
  const primary = process.env["GEMINI_API_KEY"]?.trim();
  const backup = process.env["GEMINI_API_KEY_BACKUP"]?.trim();
  if (!primary && !backup) throw new Error("Configure GEMINI_API_KEY and/or GEMINI_API_KEY_BACKUP in the server environment.");

  if (!primary && backup) {
    try {
      const token = await createLiveToken(backup, includeHistory);
      return { token, model: LIVE_MODEL, keyDiagnostics: { primary: "not_configured", backup: "ok", selected: "backup" } satisfies KeyDiagnostics };
    } catch {
      throw new Error("Gemini Live token creation failed with the configured backup key. Check its access, model availability, and quota.");
    }
  }

  let primaryToken: string;
  try {
    primaryToken = await createLiveToken(primary!, includeHistory);
  } catch (primaryError) {
    // Try the backup for any primary token-minting failure. This also provides
    // resilience to temporary provider/network errors, not only quota responses.
    if (!backup || backup === primary) {
      const category = shouldTryBackup(primaryError) ? "access, model availability, or quota" : "connectivity or model availability";
      throw new Error(`Gemini primary key failed to create a Live token. Check its ${category}.`);
    }
    try {
      const backupToken = await createLiveToken(backup, includeHistory);
      return { token: backupToken, model: LIVE_MODEL, keyDiagnostics: { primary: "failed", backup: "ok", selected: "backup" } satisfies KeyDiagnostics };
    } catch {
      throw new Error("Both Gemini keys failed to create a Live token. Check each key's project, model access, network, and quota.");
    }
  }

  let backupStatus: KeyCheckStatus = "not_configured";
  if (backup) {
    if (backup === primary) {
      backupStatus = "same_as_primary";
    } else {
      try {
        await createLiveToken(backup, includeHistory);
        backupStatus = "ok";
      } catch {
        backupStatus = "failed";
      }
    }
  }

  return {
    token: primaryToken,
    model: LIVE_MODEL,
    keyDiagnostics: { primary: "ok", backup: backupStatus, selected: "primary" } satisfies KeyDiagnostics,
  };
});

/** Used once when the live session itself reports a quota or key-authorization failure. */
export const mintLiveTokenBackup = createServerFn({ method: "POST" })
  .inputValidator(liveTokenInput)
  .handler(async ({ data }) => {
  const includeHistory = data.includeHistory;
  const primary = process.env["GEMINI_API_KEY"]?.trim();
  const backup = process.env["GEMINI_API_KEY_BACKUP"]?.trim();
  if (!backup) throw new Error("The backup Gemini API key is not configured on the server.");
  if (backup === primary) throw new Error("The backup key must be different from the primary key to provide failover.");
  try {
    const token = await createLiveToken(backup, includeHistory);
    return { token, model: LIVE_MODEL, keyDiagnostics: { primary: primary ? "failed" : "not_configured", backup: "ok", selected: "backup" } satisfies KeyDiagnostics };
  } catch {
    throw new Error("The backup Gemini key could not create a Live token. Check its project, model access, and quota.");
  }
});
