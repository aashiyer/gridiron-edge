import { useRef, useState } from "react";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/AuthContext";
import { Avatar } from "./Avatar";

const OUTPUT_SIZE = 512;

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("unsupported"));
    };
    img.src = url;
  });
}

function squareCrop(img: HTMLImageElement): string {
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  const sx = (img.naturalWidth - side) / 2;
  const sy = Math.max(0, (img.naturalHeight - side) * 0.4);
  const canvas = document.createElement("canvas");
  canvas.width = OUTPUT_SIZE;
  canvas.height = OUTPUT_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("unsupported");
  ctx.drawImage(img, sx, sy, side, side, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
  return canvas.toDataURL("image/jpeg", 0.9);
}

export function AvatarEditor() {
  const { user, refreshUser } = useAuth();
  const fileInput = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  if (!user) return null;

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setMessage(null);
    try {
      setPreview(squareCrop(await loadImage(file)));
    } catch {
      setPreview(null);
      setMessage({ ok: false, text: "Your browser couldn't read that image. Try a JPG or PNG." });
    }
  }

  async function save() {
    if (!preview) return;
    setBusy(true);
    setMessage(null);
    try {
      await api.uploadAvatar(preview);
      await refreshUser();
      setPreview(null);
      setMessage({ ok: true, text: "Profile picture updated." });
    } catch (e) {
      setMessage({ ok: false, text: e instanceof ApiError ? e.message : "Couldn't save the picture." });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setMessage(null);
    try {
      await api.deleteAvatar();
      await refreshUser();
      setPreview(null);
      setMessage({ ok: true, text: "Profile picture removed." });
    } catch (e) {
      setMessage({ ok: false, text: e instanceof ApiError ? e.message : "Couldn't remove the picture." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="max-w-sm">
      <h2 className="text-sm font-bold uppercase tracking-widest text-[var(--text-muted)] mb-4">Profile Picture</h2>
      <div className="flex flex-col gap-4 rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm p-4">
        <div className="flex items-center gap-4">
          {preview ? (
            <img src={preview} alt="New profile picture preview" className="w-24 h-24 rounded-full object-cover border border-[var(--border)]" />
          ) : (
            <Avatar userId={user.user_id} version={user.avatar_version} name={user.display_name} size={96} />
          )}
          <div className="text-xs text-[var(--text-muted)] leading-relaxed">
            {preview ? "Looks good? Save it, or pick a different photo." : "Shown next to your name on the leaderboard and in exports."}
          </div>
        </div>
        <input ref={fileInput} type="file" accept="image/*" onChange={onPick} className="hidden" />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={busy}
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] hover:border-[var(--accent)]/50 text-[var(--text)] font-semibold py-2 px-4 text-sm transition-colors disabled:opacity-60"
          >
            {user.avatar_version > 0 || preview ? "Choose a different photo" : "Choose a photo"}
          </button>
          {preview && (
            <button
              type="button"
              onClick={save}
              disabled={busy}
              className="rounded-lg bg-[var(--accent)] hover:bg-[var(--accent)]/90 text-[var(--accent-text)] font-semibold py-2 px-5 text-sm shadow-sm transition-colors disabled:opacity-60"
            >
              {busy ? "Saving…" : "Save photo"}
            </button>
          )}
          {!preview && user.avatar_version > 0 && (
            <button type="button" onClick={remove} disabled={busy} className="text-xs font-semibold text-[var(--text-faint)] hover:text-rose-400 px-2 py-2">
              Remove
            </button>
          )}
        </div>
        {message && <div className={`text-xs ${message.ok ? "text-emerald-400" : "text-[var(--destructive)]"}`}>{message.text}</div>}
      </div>
    </section>
  );
}
