export const metadata = { title: "AllergyAid" };
export default function Root({ children }: { children: React.ReactNode }) {
  return (<html lang="en"><body suppressHydrationWarning style={{ fontFamily: "system-ui", margin: 0, background: "#fafafa" }}>{children}</body></html>);
}
