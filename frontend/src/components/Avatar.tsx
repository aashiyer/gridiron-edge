import { useState } from "react";
import { avatarUrl } from "../lib/api";

const PALETTE = ["#6f8cff", "#f59e0b", "#22c55e", "#ec4899", "#14b8a6", "#a855f7"];

export function Avatar({
  userId,
  version,
  name,
  size = 32,
  className = "",
}: {
  userId: number;
  version: number;
  name: string;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size };
  if (version > 0 && !failed) {
    return (
      <img
        src={avatarUrl(userId, version)}
        alt={name}
        style={style}
        onError={() => setFailed(true)}
        className={`rounded-full object-cover shrink-0 border border-[var(--border)] ${className}`}
      />
    );
  }
  return (
    <span
      aria-label={name}
      style={{ ...style, backgroundColor: PALETTE[userId % PALETTE.length], fontSize: size * 0.45 }}
      className={`rounded-full shrink-0 inline-flex items-center justify-center font-bold text-white ${className}`}
    >
      {(name.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
}
