import { Memory } from "@mastra/memory";
import { PostgresStore } from "@mastra/pg";
import type { CheckIn } from "@/lib/gee/agent";

// Gee's memory: every reaction check-in is a Mastra memory thread stored in Neon Postgres
// (Mastra's own mastra_threads / mastra_messages tables). resourceId = the user, so Gee can
// look back over that person's earlier check-ins. The check-in details live in thread metadata.

const g = globalThis as unknown as { __geeStore?: PostgresStore; __geeMemory?: Memory; __geeInit?: Promise<void> };
// Neon requires TLS; spell out verify-full (what "require" already means in pg) to avoid pg's deprecation warning
const connectionString = (process.env.DATABASE_URL ?? "").replace(/sslmode=(require|prefer|verify-ca)/, "sslmode=verify-full");
const store = (g.__geeStore ??= new PostgresStore({ id: "allergeez-neon", connectionString }));
export const geeMemory = (g.__geeMemory ??= new Memory({ storage: store, options: { lastMessages: 40, workingMemory: { enabled: false } } }));
const ready = () => (g.__geeInit ??= store.init().catch(e => { g.__geeInit = undefined; throw e; }));

export type Turn = { role: "user" | "assistant"; content: string };
export type CheckInMeta = {
  kind: "gee-check-in";
  reactionTime: string;
  fields?: CheckIn["fields"];
  done?: boolean;
  emergency?: boolean;
  likelyIrritants?: CheckIn["likelyIrritants"];
  reactionId?: number;
  turns?: number;
};

const msg = (threadId: string, resourceId: string, t: Turn, at: Date) => ({
  id: crypto.randomUUID(), threadId, resourceId, role: t.role, createdAt: at,
  content: { format: 2 as const, parts: [{ type: "text" as const, text: t.content }] },
});

const titleOf = (f?: CheckIn["fields"]) =>
  [f?.symptoms?.slice(0, 2).join(", "), f?.food ? `after ${f.food}` : ""].filter(Boolean).join(" ").slice(0, 80) || "Reaction check-in";

/** Save one exchange (what the user said + Gee's reply) and the check-in state to the thread. */
export async function recordTurn(opts: {
  userId: string; threadId: string; reactionTime: string;
  opening?: Turn[];            // Gee's greeting(s) before the first user message, saved once
  user: string; reply: string; checkIn: Partial<CheckIn>;
}) {
  await ready();
  const { userId, threadId } = opts;
  let thread = await geeMemory.getThreadById({ threadId });
  if (thread && thread.resourceId !== userId) return; // someone else's thread id: never write into it
  const now = Date.now();
  const turns: Turn[] = [];
  if (!thread) {
    thread = await geeMemory.createThread({
      threadId, resourceId: userId, title: "Reaction check-in",
      metadata: { kind: "gee-check-in", reactionTime: opts.reactionTime, turns: 0 } satisfies CheckInMeta,
    });
    turns.push(...(opts.opening ?? []));
  }
  turns.push({ role: "user", content: opts.user }, { role: "assistant", content: opts.reply });
  await geeMemory.saveMessages({ messages: turns.map((t, i) => msg(threadId, userId, t, new Date(now + i))) as any });
  const prev = (thread.metadata ?? {}) as Partial<CheckInMeta>;
  const meta: CheckInMeta = {
    ...prev, kind: "gee-check-in", reactionTime: opts.reactionTime,
    fields: opts.checkIn.fields ?? prev.fields, done: opts.checkIn.done ?? prev.done,
    emergency: !!(opts.checkIn.emergency || prev.emergency),
    likelyIrritants: opts.checkIn.likelyIrritants?.length ? opts.checkIn.likelyIrritants : prev.likelyIrritants,
    turns: (prev.turns ?? 0) + 1,
  };
  await geeMemory.updateThread({ id: threadId, title: titleOf(meta.fields), metadata: meta });
}

/** Mark which saved reaction a check-in became. */
export async function linkReaction(userId: string, threadId: string, reactionId: number) {
  await ready();
  const thread = await geeMemory.getThreadById({ threadId });
  if (!thread || thread.resourceId !== userId) return;
  await geeMemory.updateThread({ id: threadId, title: thread.title ?? "Reaction check-in", metadata: { ...(thread.metadata ?? {}), reactionId } });
}

/** Gee's long-term memory: short notes about this user's earlier check-ins, newest first. */
export async function pastCheckIns(userId: string, excludeThreadId?: string, limit = 5) {
  await ready();
  const res = await geeMemory.listThreads({ filter: { resourceId: userId }, perPage: limit + 1, orderBy: { field: "updatedAt", direction: "DESC" } });
  return (res.threads ?? [])
    .filter(t => t.id !== excludeThreadId && (t.metadata as any)?.kind === "gee-check-in" && (t.metadata as any)?.fields)
    .slice(0, limit)
    .map(t => {
      const m = t.metadata as unknown as CheckInMeta;
      const f = m.fields!;
      const when = new Date(m.reactionTime).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
      return [
        `- ${when}: ${f.symptoms?.join(", ") || "symptoms not given"}`,
        f.severity ? `severity ${f.severity}/10` : "",
        f.food && f.food !== "unknown" ? `after ${f.food}` : "",
        f.timing && f.timing !== "unknown" ? `(${f.timing})` : "",
        m.emergency ? "flagged as possibly serious" : "",
        m.likelyIrritants?.length ? `likely irritants then: ${m.likelyIrritants.map(i => i.name).join(", ")}` : "",
        m.reactionId ? "saved to reaction history" : "not saved",
      ].filter(Boolean).join("; ");
    });
}

const STOP = new Set(["with", "and", "after", "some", "the", "had", "ate", "eating", "food", "meal", "lunch", "dinner", "breakfast", "snack", "unknown", "about", "just"]);
const words = (s: string) => s.toLowerCase().replace(/[^a-z ]+/g, " ").split(/\s+/).filter(w => w.length > 2 && !STOP.has(w)).map(w => (w.length > 4 ? w.replace(/s$/, "") : w));

/** Earlier check-ins whose food or symptoms overlap with what the user is saying now. */
export type MemoryMatch = { text: string; spoken: string };
export async function matchingCheckIns(userId: string, saidNow: string, excludeThreadId?: string): Promise<MemoryMatch[]> {
  await ready();
  const now = new Set(words(saidNow));
  if (!now.size) return [];
  const res = await geeMemory.listThreads({ filter: { resourceId: userId }, perPage: 20, orderBy: { field: "updatedAt", direction: "DESC" } });
  const out: MemoryMatch[] = [];
  for (const t of res.threads ?? []) {
    const m = t.metadata as unknown as CheckInMeta;
    if (t.id === excludeThreadId || m?.kind !== "gee-check-in" || !m.fields) continue;
    const food = words(m.fields.food ?? "").filter(w => now.has(w));
    const sym = words((m.fields.symptoms ?? []).join(" ")).filter(w => now.has(w));
    if (!food.length && !sym.length) continue;
    const d = new Date(m.reactionTime);
    const sameDay = d.toDateString() === new Date().toDateString();
    const when = sameDay ? "earlier today" : `on ${d.toLocaleDateString("en-US", { weekday: "long" })}`;
    const what = m.fields.symptoms?.slice(0, 2).join(" and ") || "a reaction";
    const after = m.fields.food && m.fields.food !== "unknown" ? ` after ${m.fields.food}` : "";
    out.push({
      text: `${when}: ${m.fields.symptoms?.join(", ")}${after} (shared: ${[...new Set([...food, ...sym])].join(", ")})`,
      spoken: `I remember you had ${what}${after} ${when} too.`,
    });
    if (out.length >= 2) break;
  }
  return out;
}

/** The full conversation for one check-in (for reaction history). */
export async function checkInTranscript(userId: string, threadId: string): Promise<Turn[] | null> {
  await ready();
  const thread = await geeMemory.getThreadById({ threadId });
  if (!thread || thread.resourceId !== userId) return null;
  const { messages } = await geeMemory.recall({ threadId, resourceId: userId, perPage: false } as any);
  return (messages as any[])
    .filter(m => m.role === "user" || m.role === "assistant")
    .map(m => ({ role: m.role, content: (m.content?.parts ?? []).filter((p: any) => p.type === "text").map((p: any) => p.text).join(" ") }))
    .filter(t => t.content);
}

/** When a guest signs in, their check-ins move to the account (like meals and reactions). */
export async function claimGuestThreads(fromId: string, toId: string) {
  await ready();
  const res = await geeMemory.listThreads({ filter: { resourceId: fromId }, perPage: false });
  for (const t of res.threads ?? []) await geeMemory.updateThreadResourceId({ threadId: t.id, resourceId: toId } as any);
}
