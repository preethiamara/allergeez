import type { NextRequest } from "next/server";
import { auth } from "@/lib/auth/server";
import { GUEST_COOKIE, GUEST_COOKIE_MAX_AGE, isGuestToken } from "@/lib/guest";

// Sign-in is optional, so every page and API stays public. The proxy is still needed on "/" to finish
// Google sign-in (it swaps the one-time verifier in the return URL for a session cookie) and to refresh sessions.
const neonAuth = auth.middleware({ publicRoutes: ["/", "/api"] });

export default async function proxy(request: NextRequest) {
  const response = await neonAuth(request);
  // First visit: give this browser its own private guest profile
  if (!isGuestToken(request.cookies.get(GUEST_COOKIE)?.value)) {
    response.cookies.set(GUEST_COOKIE, crypto.randomUUID(), {
      httpOnly: true, sameSite: "lax", path: "/", maxAge: GUEST_COOKIE_MAX_AGE,
      secure: request.nextUrl.protocol === "https:" || request.headers.get("x-forwarded-proto") === "https",
    });
  }
  return response;
}

export const config = { matcher: ["/"] };
