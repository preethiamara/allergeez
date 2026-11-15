// Icons and the "Gee" mascot, taken from the AllerGeez Figma Make design.
import type { ReactNode } from "react";

// Hand-drawn ("sketchy") icon set from the Figma design; a few extras keep the same look via the sketch filter
const PATHS: Record<string, ReactNode> = {
  home: <><path d="M2.8 11.2 C5.5 8.2 9.2 4.5 11.5 2.6 C11.8 2.3 12.4 2.3 12.7 2.6 C15.1 4.5 18.7 8.2 21.3 11.2" /><path d="M5.2 10.2 C5 14 4.8 18.2 5.2 20.2 C5.4 20.8 6 21.2 6.7 21.2 C9.8 21 14.5 21 17.5 21.2 C18.2 21.2 18.8 20.7 18.9 20 C19.2 18 19.1 14.2 18.9 10.2" /><path d="M9.5 21 C9.5 17.2 9.8 14.8 12 14.8 C14.2 14.8 14.5 17.2 14.5 21" /></>,
  plus: <><path d="M12.2 4.2 C11.9 8.5 12.1 15.5 11.9 19.8" /><path d="M4.2 12.2 C8.5 11.9 15.5 12.1 19.8 11.9" /></>,
  history: <><path d="M4.2 12.5 C4.5 17 8.2 20.8 12.8 20.5 C17.2 20.2 20.5 16.5 20.2 12 C19.9 7.5 16.2 4 11.8 4.2 C8.5 4.4 5.8 6.5 4.8 9.5" /><path d="M2.5 7.2 L4.8 9.8 L8.2 8.2" /><path d="M12 7.8 V12.2 L15.2 14.5" /></>,
  camera: <><path d="M3.5 8.8 C3.2 12 3.2 16.5 3.8 19.2 C4.1 20.2 5 20.8 6.2 20.8 H17.8 C19 20.8 19.9 20.2 20.2 19.2 C20.8 16.5 20.8 12 20.5 8.8 C20.2 7.8 19.2 7.2 18 7.2 H15.8 L14.5 4.8 C14.2 4.2 13.5 4 12.8 4 H11.2 C10.5 4 9.8 4.2 9.5 4.8 L8.2 7.2 H6 C4.8 7.2 3.8 7.8 3.5 8.8 Z" /><path d="M12 10.2 C14.2 10.2 15.8 11.8 15.8 14 C15.8 16.2 14.2 17.8 12 17.8 C9.8 17.8 8.2 16.2 8.2 14 C8.2 11.8 9.8 10.2 12 10.2 Z" /><path d="M17.5 9.8 H17.6" /></>,
  image: <><path d="M3.8 5.8 C3.5 10 3.5 15 4 18.5 C4.2 19.5 5.2 20.2 6.5 20.2 H17.5 C18.8 20.2 19.8 19.5 20 18.5 C20.5 15 20.5 10 20.2 5.8 C20 4.8 19 4 17.8 4 H6.2 C5 4 4 4.8 3.8 5.8 Z" /><path d="M8.8 9 C8.8 9.8 9.2 10.2 10 10.2 C10.8 10.2 11.2 9.8 11.2 9 C11.2 8.2 10.8 7.8 10 7.8 C9.2 7.8 8.8 8.2 8.8 9 Z" /><path d="M4.5 17.5 C7.2 13.5 9.5 13.2 11.8 15.8 C13.5 13.5 16.2 12.8 19.5 16.8" /></>,
  pen: <><path d="M4.2 19.8 L4 15.5 C4 15.2 4.2 14.8 4.5 14.5 L14.8 4.2 C15.5 3.5 16.8 3.5 17.5 4.2 L19.8 6.5 C20.5 7.2 20.5 8.5 19.8 9.2 L9.5 19.5 C9.2 19.8 8.8 20 8.5 20 L4.2 19.8 Z" /><path d="M13.5 5.5 L18.5 10.5" /><path d="M7 16.8 L4.2 19.8 L7.2 17" /></>,
  microphone: <><path d="M8.5 7 C8.5 4.8 10 3.2 12 3.2 C14 3.2 15.5 4.8 15.5 7 V12 C15.5 14.2 14 15.8 12 15.8 C10 15.8 8.5 14.2 8.5 12 Z" /><path d="M5.5 11 C5.5 15 8.5 18 12 18 C15.5 18 18.5 15 18.5 11" /><path d="M12 18 V21.2 M8.5 21.2 H15.5" /></>,
  arrow: <><path d="M4.2 12.2 C8.5 11.8 14.2 12.2 19.2 12" /><path d="M14.2 6.8 C16 8.5 18.2 10.8 19.5 12 C18.2 13.2 16 15.5 14.2 17.2" /></>,
  back: <><path d="M19.8 12.2 C15.5 11.8 9.8 12.2 4.8 12" /><path d="M9.8 6.8 C8 8.5 5.8 10.8 4.5 12 C5.8 13.2 8 15.5 9.8 17.2" /></>,
  close: <><path d="M5.8 5.8 C9.2 9.5 14.5 14.8 18.2 18.2" /><path d="M18.2 5.8 C14.5 9.5 9.2 14.8 5.8 18.2" /></>,
  shield: <><path d="M12 2.8 C14.5 4.2 17.8 5.2 19.5 5.8 C19.2 11.5 18.2 17.2 12 21.2 C5.8 17.2 4.8 11.5 4.5 5.8 C6.2 5.2 9.5 4.2 12 2.8 Z" /><path d="M8.8 12.2 L11 14.5 L15.2 9.8" /></>,
  spark: <><path d="M12 2.5 C12.5 7 14 8.5 18.5 9 C14 9.5 12.5 11 12 15.5 C11.5 11 10 9.5 5.5 9 C10 8.5 11.5 7 12 2.5 Z" /><path d="M18.5 16.5 C18.8 18.5 19.5 19.2 21.5 19.5 C19.5 19.8 18.8 20.5 18.5 22.5 C18.2 20.5 17.5 19.8 15.5 19.5 C17.5 19.2 18.2 18.5 18.5 16.5 Z" /></>,
  check: <path d="M4.5 12.2 C6.2 14 8 16 9.8 17.5 C12.8 13.5 16.2 9.2 19.8 6.5" />,
  chevron: <path d="M9.2 5.8 C11.8 8.8 14.2 11.2 15.5 12.2 C14.2 13.2 11.8 15.8 9.2 18.2" />,
  phone: <path d="M7 3.8 C5.2 4.8 4 6.8 4.2 8.8 C4.8 14.2 9.8 19.2 15.2 19.8 C17.2 20 19.2 18.8 20.2 17 L17.8 13.8 C17.2 13.2 16.2 13.2 15.5 13.8 L14.2 15 C11.2 13.5 10.5 12.8 9 9.8 L10.2 8.5 C10.8 7.8 10.8 6.8 10.2 6.2 L7 3.8 Z" />,
  alert: <><path d="M12 3.2 C12.8 3.2 13.5 3.8 13.8 4.5 L21.2 18 C21.8 18.8 21.5 19.8 20.8 20.2 C20.2 20.5 19.8 20.8 19.2 20.8 H4.8 C3.8 20.8 3 20 3 19 C3 18.5 3.2 18 3.5 17.8 L10.5 4.5 C10.8 3.8 11.2 3.2 12 3.2 Z" /><path d="M12 9.2 V14.2 M12 17.5 H12.1" /></>,
  clock: <><path d="M12 2.8 C17.2 2.5 21.2 6.8 21 12 C20.8 17.2 16.8 21.2 12 21 C6.8 20.8 2.8 16.8 3 12 C3.2 6.8 6.8 2.8 12 2.8 Z" /><path d="M12 7.2 V12.2 L15.5 14.5" /></>,
  trash: <><path d="M5.8 7.5 L6.8 19.2 C7 20.2 7.8 20.8 8.8 20.8 H15.2 C16.2 20.8 17 20.2 17.2 19.2 L18.2 7.5" /><path d="M3.8 7.5 H20.2 M10 4.8 C10 4 10.5 3.5 11.2 3.5 H12.8 C13.5 3.5 14 4 14 4.8 V7.5 H10 V4.8 Z" /><path d="M9.8 11.5 V16.8 M14.2 11.5 V16.8" /></>,
  // Additions in the same style for features the design doesn't cover
  speaker: <><path d="M4 9v6h4l5 4V5L8 9z" /><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" /></>,
  message: <path d="M4 5h16v11H9l-5 4z" />,
  medical: <path d="M8.8 3.5 C8.8 2.8 9.2 2.5 10 2.5 H14 C14.8 2.5 15.2 2.8 15.2 3.5 V8.8 H19.8 C20.5 8.8 21 9.2 21 10 V14 C21 14.8 20.5 15.2 19.8 15.2 H15.2 V19.8 C15.2 20.5 14.8 21 14 21 H10 C9.2 21 8.8 20.5 8.8 19.8 V15.2 H4.2 C3.5 15.2 3 14.8 3 14 V10 C3 9.2 3.5 8.8 4.2 8.8 H8.8 Z" />,
  info: <><path d="M12 2.8 C17.2 2.5 21.2 6.8 21 12 C20.8 17.2 16.8 21.2 12 21 C6.8 20.8 2.8 16.8 3 12 C3.2 6.8 6.8 2.8 12 2.8 Z" /><path d="M12 7.5 H12.1 M12 11.2 V16.8" /></>,
  user: <><path d="M12 3.5 C14.5 3.5 16.5 5.5 16.5 8 C16.5 10.5 14.5 12.5 12 12.5 C9.5 12.5 7.5 10.5 7.5 8 C7.5 5.5 9.5 3.5 12 3.5 Z" /><path d="M5.2 20.5 C5.5 16.2 8.5 14.8 12 14.8 C15.5 14.8 18.5 16.2 18.8 20.5" /></>,
  food: <><path d="M12 20.5 C10.5 20.5 8.2 21.2 6.5 19.8 C4.5 18 3.5 14 3.5 10.5 C3.5 6.8 6.2 5 8.8 5 C10.5 5 11.5 6 12 6.5 C12.5 6 13.5 5 15.2 5 C17.8 5 20.5 6.8 20.5 10.5 C20.5 14 19.5 18 17.5 19.8 C15.8 21.2 13.5 20.5 12 20.5 Z" /><path d="M12 2.5 C12.5 3.8 12.5 5.2 11.8 6.5" /></>,
  flask: <><path d="M9.8 2.8 H14.2 M10.5 2.8 V7.5 L5.2 18 C4.5 19.2 5.2 20.8 6.8 20.8 H17.2 C18.8 20.8 19.5 19.2 18.8 18 L13.5 7.5 V2.8" /><path d="M7.2 14.8 C9.5 14 14.5 14 16.8 14.8" /></>,
  flag: <><path d="M5 21V4" /><path d="M5 4h11l-2 4 2 4H5" /></>,
  logout: <><path d="M15 4h4v16h-4" /><path d="M10 8l-4 4 4 4M6 12h10" /></>,
  flip: <><path d="M4 12a8 8 0 0 1 13.7-5.7L20 8" /><path d="M20 4v4h-4" /><path d="M20 12a8 8 0 0 1-13.7 5.7L4 16" /><path d="M4 20v-4h4" /></>,
  search: <><path d="M11 3.5 C15.2 3.5 18.5 6.8 18.5 11 C18.5 15.2 15.2 18.5 11 18.5 C6.8 18.5 3.5 15.2 3.5 11 C3.5 6.8 6.8 3.5 11 3.5 Z" /><path d="M16.5 16.5 L21.2 21.2" /></>,
  menu: <><path d="M5 3.5 C8.8 3.2 15.2 3.2 19 3.5 C19.7 3.6 20.2 4.2 20.2 5 V19 C20.2 19.8 19.7 20.4 19 20.5 C15.2 20.8 8.8 20.8 5 20.5 C4.3 20.4 3.8 19.8 3.8 19 V5 C3.8 4.2 4.3 3.6 5 3.5 Z" /><path d="M7.2 8 H16.8 M7.2 12 H16.8 M7.2 16 H13.8" /><path d="M7.2 6 H12.8" /></>,
  profile: <><path d="M12 3.5 C14.5 3.5 16.5 5.5 16.5 8 C16.5 10.5 14.5 12.5 12 12.5 C9.5 12.5 7.5 10.5 7.5 8 C7.5 5.5 9.5 3.5 12 3.5 Z" /><path d="M5.2 20.5 C5.5 16.2 8.5 14.8 12 14.8 C15.5 14.8 18.5 16.2 18.8 20.5" /></>,
  sos: null, // drawn as the SOS bell image, see Icon
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 22, strokeWidth = 2.4 }: { name: IconName; size?: number; strokeWidth?: number }) {
  if (name === "sos") {
    return <img src="/icons/sos.png" alt="" width={size} height={size} className="sos-icon-img" draggable={false}
      style={{ display: "block", width: size, height: size, objectFit: "contain", borderRadius: "50%" }} />;
  }
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className="sketchy-icon">
      {PATHS[name]}
    </svg>
  );
}

/** The SVG filter that gives icons their hand-drawn wobble (render once, near the app root). */
export function SketchFilter() {
  return (
    <svg width="0" height="0" className="sr-only" aria-hidden="true" style={{ position: "absolute", pointerEvents: "none" }}>
      <defs>
        <filter id="allergeez-sketch-filter" x="-20%" y="-20%" width="140%" height="140%">
          <feTurbulence type="fractalNoise" baseFrequency="0.045" numOctaves={3} result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale={2.0} xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </defs>
    </svg>
  );
}

export type BuddyVariant = "default" | "wave" | "boxing" | "cookie" | "starry";
const BUDDY: Record<BuddyVariant, [string, string]> = {
  default: ["/mascots/gee-default.png", "Gee, your friendly smiling heart"],
  wave: ["/mascots/gee-wave.png", "Gee winking and waving hello"],
  boxing: ["/mascots/gee-boxing.png", "Gee ready to fight allergies with boxing gloves"],
  cookie: ["/mascots/gee-cookie.png", "Gee eating a cookie"],
  starry: ["/mascots/gee-starry.png", "Gee with starry eyes, waiting to munch with you"],
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
      {right ?? <button className="sos-mini" onClick={onEmergency} aria-label="Open emergency help"><Icon name="sos" size={39} /></button>}
    </header>
  );
}
