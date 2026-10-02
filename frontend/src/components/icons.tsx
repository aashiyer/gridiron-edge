type IconProps = { className?: string };

const base = "none";

export function HomeIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill={base} className={className}>
      <path d="M3 9.5 10 3l7 6.5M5 8v8h10V8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function TargetIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill={base} className={className}>
      <circle cx="10" cy="10" r="6.5" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="10" cy="10" r="3" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="10" cy="10" r="0.9" fill="currentColor" />
    </svg>
  );
}

export function ListIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill={base} className={className}>
      <path d="M7 5h9M7 10h9M7 15h9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="3.5" cy="5" r="1" fill="currentColor" />
      <circle cx="3.5" cy="10" r="1" fill="currentColor" />
      <circle cx="3.5" cy="15" r="1" fill="currentColor" />
    </svg>
  );
}

export function ChartIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill={base} className={className}>
      <path d="M4 16V9M10 16V4M16 16v-6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M3 16.5h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function MoreIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className}>
      <circle cx="6" cy="6" r="1.6" />
      <circle cx="14" cy="6" r="1.6" />
      <circle cx="6" cy="14" r="1.6" />
      <circle cx="14" cy="14" r="1.6" />
    </svg>
  );
}

export function RankIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill={base} className={className}>
      <path
        d="M3 16.5V11M8.5 16.5V4M14 16.5V8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path d="M2 16.5h15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function ScaleIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill={base} className={className}>
      <path d="M10 3v13M6 16h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M10 5 4 6.5 6 11h6l-2-4.5L10 5ZM10 5l6 1.5-2 4.5h6l-2-4.5L10 5" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

export function CalendarIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill={base} className={className}>
      <rect x="3.5" y="4.5" width="13" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3.5 8h13M7 3v3M13 3v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function TrophyIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill={base} className={className}>
      <path d="M6 4h8v5a4 4 0 0 1-8 0V4Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M6 5H4a2 2 0 0 0 2 4M14 5h2a2 2 0 0 1-2 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M10 13v2.5M7.5 17h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function SunIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill={base} className={className}>
      <circle cx="10" cy="10" r="3.4" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M10 2.5v2M10 15.5v2M17.5 10h-2M4.5 10h-2M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4M15.3 15.3l-1.4-1.4M6.1 6.1 4.7 4.7"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function MoonIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill={base} className={className}>
      <path
        d="M16.5 12.3A7 7 0 0 1 7.7 3.5a7 7 0 1 0 8.8 8.8Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function GearIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill={base} className={className}>
      <path
        d="M8.4 3.2h3.2l.5 2.03c.5.16.97.39 1.4.68l1.94-.82 2.26 2.26-.82 1.94c.29.43.52.9.68 1.4l2.03.5v3.2l-2.03.5a5.4 5.4 0 0 1-.68 1.4l.82 1.94-2.26 2.26-1.94-.82a5.4 5.4 0 0 1-1.4.68l-.5 2.03H8.4l-.5-2.03a5.4 5.4 0 0 1-1.4-.68l-1.94.82-2.26-2.26.82-1.94a5.4 5.4 0 0 1-.68-1.4L.41 11.8V8.6l2.03-.5c.16-.5.39-.97.68-1.4l-.82-1.94L4.56 2.5l1.94.82c.43-.29.9-.52 1.4-.68l.5-2.03Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
        transform="translate(-0.4 -0.4) scale(0.92)"
      />
      <circle cx="10" cy="10" r="2.6" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

export function PersonIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className}>
      <circle cx="10" cy="6.8" r="3.6" />
      <path d="M3 17.2c0-3.87 3.13-7 7-7s7 3.13 7 7v.3H3v-.3Z" />
    </svg>
  );
}

export function LogoMark({ className, bg = "var(--card)" }: IconProps & { bg?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className}>
      <g transform="rotate(-38 12 12)">
        <ellipse cx="12" cy="12" rx="10.4" ry="6.4" fill="currentColor" />
        <path
          d="M6.3 12h11.4M9.6 9.3v5.4M12 8.9v6.2M14.4 9.3v5.4"
          stroke={bg}
          strokeWidth="1.25"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}

export function ShieldIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill={base} className={className}>
      <path
        d="M10 2.5 16 4.5v4.2c0 4-2.6 6.9-6 8.3-3.4-1.4-6-4.3-6-8.3V4.5L10 2.5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M7.3 10 9.2 12l3.5-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
