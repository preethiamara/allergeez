"use client";
import { useState } from "react";
import { authClient } from "@/lib/auth/client";
import type { SessionUser } from "@/lib/auth/server";
import { AppHeader, GoogleLogo, Icon } from "./ui";

const usernameOf = (u: SessionUser) => (u.email.split("@")[0] || u.name || "user").toLowerCase().replace(/[^a-z0-9._]/g, "");
export const initialsOf = (u: SessionUser) =>
  (u.name || u.email).split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join("") || "ME";

const friendly = (msg?: string) => {
  const m = (msg ?? "").toLowerCase();
  if (m.includes("invalid") && (m.includes("password") || m.includes("credential"))) return "That email and password don’t match. Try again or sign up.";
  if (m.includes("already") || m.includes("exists")) return "There’s already an account with that email. Log in instead.";
  if (m.includes("password") && (m.includes("short") || m.includes("length"))) return "Use a password with at least 8 characters.";
  return msg || "Something went wrong. Please try again.";
};

export default function ProfileScreen({ user, contact, onSaveContact, onBack }: {
  user: SessionUser | null;
  contact: { name: string; phone: string };
  onSaveContact: (c: { name: string; phone: string }) => Promise<void>;
  onBack: () => void;
}) {
  const [mode, setMode] = useState<"signup" | "login">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<"" | "email" | "google" | "logout">("");
  const [error, setError] = useState("");
  const [c, setC] = useState(contact);
  const [contactState, setContactState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [contactError, setContactError] = useState("");

  // After signing in, make sure the browser actually kept the login cookie, then reload so the
  // server loads this account's data. Safari (and any plain-http address other than localhost)
  // rejects Neon Auth's secure-only cookies, which looks like "sign up did nothing".
  const COOKIE_BLOCKED = "Your account is ready, but this browser blocked the login cookie. Open the app over https (for example https://localhost:3000) or use Chrome, then log in.";
  async function finish() {
    const { data } = await authClient.getSession().catch(() => ({ data: null }));
    if (!data?.user) throw new Error(COOKIE_BLOCKED);
    window.location.href = "/";
  }
  const insecure = typeof window !== "undefined" && window.location.protocol === "http:" && !["localhost", "127.0.0.1"].includes(window.location.hostname);

  async function submitEmail(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setBusy("email"); setError("");
    try {
      const res = mode === "signup"
        ? await authClient.signUp.email({ email: email.trim(), password, name: email.trim().split("@")[0] })
        : await authClient.signIn.email({ email: email.trim(), password });
      if (res.error) throw new Error(res.error.message);
      await finish();
    } catch (err: any) { setError(friendly(err?.message)); setBusy(""); }
  }

  async function google() {
    setBusy("google"); setError("");
    try {
      const { error } = await authClient.signIn.social({
        provider: "google",
        callbackURL: `${window.location.origin}/`,
        errorCallbackURL: `${window.location.origin}/`,
      });
      if (error) throw new Error(error.message);
    } catch (err: any) { setError(friendly(err?.message)); setBusy(""); }
  }

  async function logOut() {
    setBusy("logout");
    try { await authClient.signOut(); } finally { window.location.href = "/"; }
  }

  async function saveContact() {
    setContactState("saving"); setContactError("");
    try { await onSaveContact({ name: c.name.trim(), phone: c.phone.trim() }); setContactState("saved"); setTimeout(() => setContactState("idle"), 2500); }
    catch (err: any) { setContactState("error"); setContactError(err?.message ?? "Couldn’t save"); }
  }

  const contactCard = (
    <section className="profile-card emergency-contact-card">
      <div className="profile-card__heading">
        <span className="profile-card__icon profile-card__icon--alert"><Icon name="alert" size={18} /></span>
        <div><strong>emergency contact:</strong><small>Quickly reach for severe allergy reactions</small></div>
      </div>
      <div className="profile-field">
        <label htmlFor="emergency-contact-name">name:</label>
        <input id="emergency-contact-name" type="text" value={c.name} onChange={e => setC({ ...c, name: e.target.value })} placeholder="Contact name" />
      </div>
      <div className="profile-field">
        <label htmlFor="emergency-contact-number">number:</label>
        <input id="emergency-contact-number" type="tel" value={c.phone} onChange={e => setC({ ...c, phone: e.target.value })} placeholder="Phone number" />
      </div>
      {contactState === "saved" && <p className="profile-success-hint"><Icon name="check" size={16} /> Emergency contact saved!</p>}
      {contactState === "error" && <p className="save-error">{contactError}</p>}
      <button type="button" className="primary-button" style={{ marginTop: 12 }} onClick={saveContact} disabled={contactState === "saving"}>
        {contactState === "saving" ? "Saving…" : "Save contact details"}
      </button>
    </section>
  );

  return (
    <div className="screen profile-screen">
      <AppHeader title="Profile" onBack={onBack} right={<div className="app-header__side" />} />
      {user ? (
        <div className="profile-view">
          <section className="profile-header-card">
            <div className="profile-avatar-large">
              {user.image ? <img src={user.image} alt="" referrerPolicy="no-referrer" /> : <span>{initialsOf(user)}</span>}
            </div>
            <h2 className="profile-username">@{usernameOf(user)}</h2>
            <p className="profile-email">{user.email}</p>
          </section>
          {contactCard}
          <section className="profile-actions-card">
            <button type="button" className="text-button profile-switch-btn" onClick={logOut} disabled={busy === "logout"}>
              {busy === "logout" ? "Logging out…" : "Switch account / Log out"}
            </button>
          </section>
        </div>
      ) : (
        <div className="profile-auth-view">
          <section className="page-intro page-intro--compact">
            <p className="eyebrow">Profile</p>
            <h2>{mode === "signup" ? "Sign up" : "Log in"}</h2>
            <p>{mode === "signup" ? "Keep your allergy clues, emergency contacts, and logs synced." : "Access your allergy records and emergency profile."}</p>
          </section>
          {insecure && (
            <p className="save-error" role="alert">
              Sign-in needs a secure (https) address. You opened the app at {window.location.host} over http, so your browser will refuse the login.
              Use the https link instead.
            </p>
          )}
          <form className="profile-form-card" onSubmit={submitEmail}>
            <strong className="profile-form-title">{mode === "signup" ? "sign up:" : "log in:"}</strong>
            <div className="profile-field">
              <label htmlFor="auth-email">email</label>
              <input id="auth-email" type="email" required autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@example.com" />
            </div>
            <div className="profile-field">
              <label htmlFor="auth-password">password</label>
              <input id="auth-password" type="password" required minLength={8} autoComplete={mode === "signup" ? "new-password" : "current-password"}
                value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" />
            </div>
            {error && <p className="save-error" role="alert">{error}</p>}
            <button type="submit" className="primary-button" style={{ marginTop: 14 }} disabled={!!busy}>
              {busy === "email" ? (mode === "signup" ? "Creating account…" : "Logging in…") : mode === "signup" ? "Sign up" : "Log in"}
            </button>
            <div className="auth-divider"><span>or</span></div>
            <button type="button" className="google-button" onClick={google} disabled={!!busy}>
              <GoogleLogo /><span>{busy === "google" ? "Opening Google…" : "sign in with google"}</span>
            </button>
            <div className="auth-switch-link">
              <span>{mode === "signup" ? "Already have an account? " : "Don't have an account? "}</span>
              <button type="button" className="link-btn" onClick={() => { setMode(mode === "signup" ? "login" : "signup"); setError(""); }}>
                {mode === "signup" ? "log in" : "sign up"}
              </button>
            </div>
          </form>
          <p className="profile-guest-note">You can keep using allergeez without an account. Signing in saves your history to your account.</p>
          {contactCard}
        </div>
      )}
    </div>
  );
}
