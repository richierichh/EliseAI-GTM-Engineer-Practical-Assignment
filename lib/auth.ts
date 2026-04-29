const SESSION_COOKIE = "elise_demo_session";
const SESSION_TTL_SECONDS = 60 * 60 * 8; // 8 hours

type SessionPayload = {
  email: string;
  exp: number;
};

const textEncoder = new TextEncoder();

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

const sanitizeSecret = (v: string): string => v.trim();

const timingSafeEqual = (a: string, b: string): boolean => {
  const aBytes = textEncoder.encode(a);
  const bBytes = textEncoder.encode(b);
  let diff = aBytes.length ^ bBytes.length;
  const max = Math.max(aBytes.length, bBytes.length);
  for (let i = 0; i < max; i += 1) {
    diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  }
  return diff === 0;
};

const hmacSha256Hex = async (value: string, secret: string): Promise<string> => {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, textEncoder.encode(value));
  return toHex(new Uint8Array(sig));
};

const parsePayload = (raw: string): SessionPayload | null => {
  try {
    const parsed = JSON.parse(raw) as Partial<SessionPayload>;
    if (
      !parsed ||
      typeof parsed.email !== "string" ||
      typeof parsed.exp !== "number"
    ) {
      return null;
    }
    return { email: parsed.email, exp: parsed.exp };
  } catch {
    return null;
  }
};

export function getAuthEnv() {
  return {
    adminEmail: process.env.DEMO_ADMIN_EMAIL?.trim() ?? "",
    adminPassword: process.env.DEMO_ADMIN_PASSWORD?.trim() ?? "",
    sessionSecret: sanitizeSecret(process.env.DEMO_SESSION_SECRET ?? ""),
  };
}

export function authConfigured(): boolean {
  const { adminEmail, adminPassword, sessionSecret } = getAuthEnv();
  return Boolean(adminEmail && adminPassword && sessionSecret);
}

export function getSessionCookieName(): string {
  return SESSION_COOKIE;
}

export function getSessionTtlSeconds(): number {
  return SESSION_TTL_SECONDS;
}

export async function credentialsMatch(
  email: string,
  password: string
): Promise<boolean> {
  const { adminEmail, adminPassword } = getAuthEnv();
  if (!adminEmail || !adminPassword) return false;
  return (
    timingSafeEqual(email.trim().toLowerCase(), adminEmail.toLowerCase()) &&
    timingSafeEqual(password, adminPassword)
  );
}

export async function signSession(email: string): Promise<string | null> {
  const { sessionSecret } = getAuthEnv();
  if (!sessionSecret) return null;

  const payload: SessionPayload = {
    email: email.trim().toLowerCase(),
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  const payloadRaw = JSON.stringify(payload);
  const signature = await hmacSha256Hex(payloadRaw, sessionSecret);
  return `${encodeURIComponent(payloadRaw)}.${signature}`;
}

export async function verifySessionToken(
  token: string | undefined
): Promise<SessionPayload | null> {
  if (!token) return null;
  const { sessionSecret } = getAuthEnv();
  if (!sessionSecret) return null;

  const idx = token.lastIndexOf(".");
  if (idx <= 0 || idx >= token.length - 1) return null;

  const encodedPayload = token.slice(0, idx);
  const providedSig = token.slice(idx + 1);
  let payloadRaw = "";
  try {
    payloadRaw = decodeURIComponent(encodedPayload);
  } catch {
    return null;
  }

  const expectedSig = await hmacSha256Hex(payloadRaw, sessionSecret);
  if (!timingSafeEqual(providedSig, expectedSig)) return null;

  const payload = parsePayload(payloadRaw);
  if (!payload) return null;
  if (payload.exp <= Math.floor(Date.now() / 1000)) return null;
  return payload;
}
