import { cookies } from "next/headers";
import { sql } from "@/lib/db";
import { getSessionUser, type SessionUser } from "@/lib/auth/server";
import { GUEST_COOKIE, GUEST_COOKIE_MAX_AGE, guestUserId, isGuestToken } from "@/lib/guest";

/** This browser's private guest profile id (set by proxy.ts; created here if an API is called first). */
async function guestId(): Promise<string> {
  const jar = await cookies();
  let token = jar.get(GUEST_COOKIE)?.value;
  if (!isGuestToken(token)) {
    token = crypto.randomUUID();
    // Allowed in API routes; page renders can't set cookies (proxy.ts covers those)
    try { jar.set(GUEST_COOKIE, token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: GUEST_COOKIE_MAX_AGE, secure: process.env.NODE_ENV === "production" }); } catch {}
  }
  return guestUserId(token);
}

/**
 * Who owns the data for this request: the signed-in account, or this browser's private guest profile.
 * The first time an account signs in with no data of its own, it takes over this browser's guest data
 * so nothing logged before signing in is lost.
 */
export async function getActor(): Promise<{ userId: string; user: SessionUser | null }> {
  const [user, guest] = await Promise.all([getSessionUser(), guestId()]);
  if (!user) return { userId: guest, user: null };
  await claimGuestData(user.id, guest);
  return { userId: user.id, user };
}

const claimed = new Set<string>();
async function claimGuestData(userId: string, GUEST_ID: string) {
  if (claimed.has(userId)) return;
  claimed.add(userId);
  try {
    const [owned] = await sql`select
      (select count(*) from meals where user_id = ${userId}) +
      (select count(*) from reactions where user_id = ${userId}) +
      (select count(*) from profiles where id = ${userId}) as n`;
    if (Number(owned.n) > 0) return;
    await sql`update meals set user_id = ${userId} where user_id = ${GUEST_ID}`;
    await sql`update reactions set user_id = ${userId} where user_id = ${GUEST_ID}`;
    await sql`update profiles set id = ${userId} where id = ${GUEST_ID}`;
    // Gee's saved check-ins (Mastra memory threads) move to the account too
    const { claimGuestThreads } = await import("@/lib/gee/memory");
    await claimGuestThreads(GUEST_ID, userId).catch(e => console.error("[session] moving Gee conversations failed", e));
  } catch (e) {
    claimed.delete(userId);
    console.error("[session] claiming guest data failed", e);
  }
}
