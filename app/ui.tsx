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

export function Buddy({ small = false }: { small?: boolean }) {
  return (
    <svg className={small ? "buddy buddy--small" : "buddy"} viewBox="0 0 108 96" role="img" aria-label="Gee, your friendly smiling heart">
      <path d="M54 89C43 79 13 61 13 35 13 17 35 10 48 25l6 8 6-8c13-15 35-8 35 10 0 26-30 44-41 54Z" fill="#F4A8BD" stroke="#5B3A43" strokeWidth="3.5" strokeLinejoin="round" />
      <path d="M38 44v1M70 44v1" stroke="#5B3A43" strokeWidth="5" strokeLinecap="round" />
      <path d="M44 58c6 6 14 6 20 0" fill="none" stroke="#5B3A43" strokeWidth="3.5" strokeLinecap="round" />
      <path d="M25 53c-7-2-10 1-12 5M83 53c7-2 10 1 12 5" fill="none" stroke="#5B3A43" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
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
