// Icons and the "Gee" mascot, taken from the AllerGeez Figma Make design.
import type { ReactNode } from "react";

const PATHS: Record<string, ReactNode> = {
  home: <><path d="m3 10 9-7 9 7" /><path d="M5 9v11h14V9M9 20v-6h6v6" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  history: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></>,
  camera: <><path d="M4 7h3l1.5-2h7L17 7h3v12H4z" /><circle cx="12" cy="13" r="3.5" /></>,
  image: <><rect x="3" y="4" width="18" height="16" rx="3" /><circle cx="9" cy="10" r="2" /><path d="m4 17 4-4 3 3 3-3 6 6" /></>,
  pen: <path d="m4 20 4.2-1 11-11a2.1 2.1 0 0 0-3-3l-11 11zM14.5 6.5l3 3" />,
  microphone: <><rect x="8" y="3" width="8" height="12" rx="4" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8" /></>,
  arrow: <path d="m5 12 14 0m-5-5 5 5-5 5" />,
  back: <path d="m19 12-14 0m5 5-5-5 5-5" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  shield: <><path d="M12 3 5 6v5c0 4.6 2.7 8 7 10 4.3-2 7-5.4 7-10V6z" /><path d="M9.5 12.2 11.2 14l3.7-4" /></>,
  spark: <><path d="M12 2c.6 5.1 2.9 7.4 8 8-5.1.6-7.4 2.9-8 8-.6-5.1-2.9-7.4-8-8 5.1-.6 7.4-2.9 8-8Z" /><path d="M19 17c.2 1.9 1.1 2.8 3 3-1.9.2-2.8 1.1-3 3-.2-1.9-1.1-2.8-3-3 1.9-.2 2.8-1.1 3-3Z" /></>,
  check: <path d="m5 12 4.5 4.5L19 7" />,
  chevron: <path d="m9 6 6 6-6 6" />,
  phone: <path d="M7.2 3.5 4.7 5.2c-.8.5-.9 1.6-.6 2.5 2.1 6 6.1 10 12.1 12.1.9.3 2 .2 2.5-.6l1.7-2.5-4.7-2.1-1.4 1.7c-2.9-1.3-5.1-3.5-6.4-6.4l1.7-1.4z" />,
  alert: <><path d="M12 3 2.8 20h18.4z" /><path d="M12 9v5M12 17.5v.1" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  trash: <path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" />,
  // Additions in the same style for features the design doesn't cover
  speaker: <><path d="M4 9v6h4l5 4V5L8 9z" /><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" /></>,
  message: <path d="M4 5h16v11H9l-5 4z" />,
  medical: <path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z" />,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.1" /></>,
  user: <><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>,
  food: <><path d="M12 20.94c1.5 0 2.75 1.06 4 1.06 3 0 6-8 6-12.22A4.91 4.91 0 0 0 17 5c-2.22 0-4 1.44-5 2-1-.56-2.78-2-5-2a4.9 4.9 0 0 0-5 4.78C2 14 5 22 8 22c1.25 0 2.5-1.06 4-1.06Z" /><path d="M10 2c1 .5 2 2 2 5" /></>,
  flask: <><path d="M10 2v5.5L4.5 18A2 2 0 0 0 6.2 21h11.6a2 2 0 0 0 1.7-3L14 7.5V2" /><path d="M8.5 2h7M7 15h10" /></>,
  flag: <><path d="M5 21V4" /><path d="M5 4h11l-2 4 2 4H5" /></>,
  logout: <><path d="M15 4h4v16h-4" /><path d="M10 8l-4 4 4 4M6 12h10" /></>,
  flip: <><path d="M4 12a8 8 0 0 1 13.7-5.7L20 8" /><path d="M20 4v4h-4" /><path d="M20 12a8 8 0 0 1-13.7 5.7L4 16" /><path d="M4 20v-4h4" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 22, strokeWidth = 1.8 }: { name: IconName; size?: number; strokeWidth?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {PATHS[name]}
    </svg>
  );
}

export type BuddyVariant = "default" | "wave" | "boxing" | "cookie";
const BUDDY: Record<BuddyVariant, [string, string]> = {
  default: ["/mascots/gee-default.png", "Gee, your friendly smiling heart"],
  wave: ["/mascots/gee-wave.png", "Gee winking and waving hello"],
  boxing: ["/mascots/gee-boxing.png", "Gee ready to fight allergies with boxing gloves"],
  cookie: ["/mascots/gee-cookie.png", "Gee eating a cookie"],
};

/** Gee, the heart mascot. */
export function Buddy({ small = false, variant = "default", className = "" }: { small?: boolean; variant?: BuddyVariant; className?: string }) {
  const [src, alt] = BUDDY[variant];
  const cls = ["buddy", small ? "buddy--small" : "", variant !== "default" ? `buddy--${variant}` : "", className].filter(Boolean).join(" ");
  return <img className={cls} src={src} alt={alt} draggable={false} />;
}

export type SafetyStatus = "safe" | "caution" | "warning";
/** The colored Gee heart with a "% safe" badge used by Test a food. */
export function SafetyHeart({ percentage, status }: { percentage: number; status: SafetyStatus }) {
  const src = status === "safe" ? "/mascots/gee-safety-safe.png" : status === "caution" ? "/mascots/gee-safety-caution.png" : "/mascots/gee-safety-warning.png";
  const alt = status === "safe" ? "Green Gee: looks safe" : status === "caution" ? "Yellow Gee: use caution" : "Red Gee: allergen warning";
  return (
    <div className="safety-heart-container">
      <img src={src} alt={alt} className="safety-heart-img" draggable={false} />
      <div className="safety-heart-badge"><strong>{percentage}%</strong><small>Safe</small></div>
    </div>
  );
}

export function GoogleLogo({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335" />
    </svg>
  );
}

/** Gee with a cookie (shown after a meal is saved). */
export function BuddyInBowl({ className = "" }: { className?: string }) {
  return <Buddy variant="cookie" className={`buddy-in-bowl ${className}`.trim()} />;
}

export function AppHeader({ title, onBack, onEmergency, right }: { title: string; onBack?: () => void; onEmergency?: () => void; right?: ReactNode }) {
  return (
    <header className="app-header">
      <div className="app-header__side">
        {onBack ? <button className="icon-button" onClick={onBack} aria-label="Go back"><Icon name="back" /></button> : <Buddy small />}
      </div>
      <span className="app-header__title">{title}</span>
      {right ?? <button className="sos-mini" onClick={onEmergency}>SOS</button>}
    </header>
  );
}
