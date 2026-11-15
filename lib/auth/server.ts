import { createNeonAuth } from "@neon/auth/next/server";

// Neon Managed Better Auth: email + password and Google sign-in.
// Google uses Neon's shared OAuth credentials in development; add your own in the Neon Console before launch.
export const auth = createNeonAuth({
  baseUrl: process.env.NEON_AUTH_BASE_URL!,
  cookies: { secret: process.env.NEON_AUTH_COOKIE_SECRET! },
});

export type SessionUser = { id: string; name: string; email: string; image?: string | null };

/** The signed-in user, or null when browsing signed out. */
export async function getSessionUser(): Promise<SessionUser | null> {
  try {
    const { data } = await auth.getSession();
    const u = data?.user;
    return u ? { id: u.id, name: u.name ?? "", email: u.email ?? "", image: u.image ?? null } : null;
  } catch (e) {
    console.error("[auth] getSession failed", e);
    return null;
  }
}
