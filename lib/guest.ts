// Each browser gets its own private guest profile (a random id in an httpOnly cookie), so on a public
// site signed-out visitors never see or change each other's meals, reactions or emergency contact.
export const GUEST_COOKIE = "ag_guest";
export const GUEST_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // a year
export const isGuestToken = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);
export const guestUserId = (token: string) => `guest-${token}`;
