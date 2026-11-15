import { neon } from "@neondatabase/serverless";
// The Neon driver talks to Postgres over fetch(). Next.js can cache fetch() during page renders,
// which made queries return stale results and writes silently not run. Never cache database calls.
export const sql = neon(process.env.DATABASE_URL!, { fetchOptions: { cache: "no-store" } });
