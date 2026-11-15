import { sql } from "@/lib/db";
import { getSessionUser, type SessionUser } from "@/lib/auth/server";

/** Data owner for signed-out use (shared on this device/demo, like before login existed). */
export const GUEST_ID = "demo";

/**
 * Who owns the data for this request: the signed-in account, or the shared guest profile.
 * The first time an account signs in with no data of its own, it takes over the guest data
 * so nothing logged before signing in is lost.
 */
export async function getActor(): Promise<{ userId: string; user: SessionUser | null }> {
  const user = await getSessionUser();
  if (!user) return { userId: GUEST_ID, user: null };
  await claimGuestData(user.id);
  return { userId: user.id, user };
}

const claimed = new Set<string>();
async function claimGuestData(userId: string) {
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
