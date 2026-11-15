import { auth } from "@/lib/auth/server";

// Sign-in is optional, so every page and API stays public. The proxy is still needed on "/" to finish
// Google sign-in (it swaps the one-time verifier in the return URL for a session cookie) and to refresh sessions.
export default auth.middleware({ publicRoutes: ["/", "/api"] });

export const config = { matcher: ["/"] };
