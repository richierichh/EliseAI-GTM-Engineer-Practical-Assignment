import { NextRequest, NextResponse } from "next/server";
import {
  authConfigured,
  getSessionCookieName,
  verifySessionToken,
} from "@/lib/auth";

const PUBLIC_PATHS = ["/login", "/api/auth/login", "/api/auth/logout"];

const isPublicPath = (pathname: string): boolean =>
  PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

const isAlwaysAllowed = (pathname: string): boolean =>
  pathname.startsWith("/_next") ||
  pathname === "/favicon.ico";

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  if (isAlwaysAllowed(pathname) || !authConfigured()) {
    return NextResponse.next();
  }

  const token = req.cookies.get(getSessionCookieName())?.value;
  const session = await verifySessionToken(token);
  const isAuthed = Boolean(session);

  if (pathname === "/login" && isAuthed) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  if (isAuthed) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL("/login", req.url);
  url.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/:path*"],
};
