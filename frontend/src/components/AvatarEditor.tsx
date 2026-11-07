import { useRef, useState } from "react";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/AuthContext";
import { Avatar } from "./Avatar";

const OUTPUT_SIZE = 512;

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("unsupported"));
    };
    img.src = url;
  });
}

const VIEW = 280;
const MAX_ZOOM = 5;

interface CropState {
  zoom: number;
  x: number;
  y: number;
  rot: number;
}

const INITIAL: CropState = { zoom: 1, x: 0, y: 0, rot: 0 };

function dims(img: HTMLImageElement, rot: number) {
  const odd = rot % 2 === 1;
  return { w: odd ? img.naturalHeight : img.naturalWidth, h: odd ? img.naturalWidth : img.naturalHeight };
}

function clampCrop(img: HTMLImageElement, c: CropState): CropState {
  const { w, h } = dims(img, c.rot);
  const cover = VIEW / Math.min(w, h);
  const dw = w * cover * c.zoom;
  const dh = h * cover * c.zoom;
  const mx = Math.max(0, (dw - VIEW) / 2);
  const my = Math.max(0, (dh - VIEW) / 2);
  return { ...c, x: Math.max(-mx, Math.min(mx, c.x)), y: Math.max(-my, Math.min(my, c.y)) };
}

function renderCrop(img: HTMLImageElement, c: CropState): string {
  const canvas = document.createElement("canvas");
  canvas.width = OUTPUT_SIZE;
  canvas.height = OUTPUT_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("unsupported");
  const { w, h } = dims(img, c.rot);
  const cover = VIEW / Math.min(w, h);
  const k = OUTPUT_SIZE / VIEW;
  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
  ctx.translate(OUTPUT_SIZE / 2 + c.x * k, OUTPUT_SIZE / 2 + c.y * k);
  ctx.rotate((c.rot * Math.PI) / 2);
  ctx.scale(cover * c.zoom * k, cover * c.zoom * k);
  ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
  return canvas.toDataURL("image/jpeg", 0.92);
}

function Cropper({ img, initial, onCancel, onApply }: { img: HTMLImageElement; initial: CropState; onCancel: () => void; onApply: (c: CropState) => void }) {
  const [crop, setCrop] = useState<CropState>(() => clampCrop(img, initial));
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);

  const update = (next: Partial<CropState>) => setCrop((c) => clampCrop(img, { ...c, ...next }));
  const setZoom = (z: number) => update({ zoom: Math.max(1, Math.min(MAX_ZOOM, z)) });

  function down(e: React.PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: crop.zoom };
    }
  }
  function move(e: React.PointerEvent) {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      setZoom((pinch.current.zoom * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.current.dist);
    } else if (pointers.current.size === 1) {
      setCrop((c) => clampCrop(img, { ...c, x: c.x + e.clientX - prev.x, y: c.y + e.clientY - prev.y }));
    }
  }
  function up(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  }

  const { w, h } = dims(img, crop.rot);
  const cover = VIEW / Math.min(w, h);
  const scale = cover * crop.zoom;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" role="dialog" aria-label="Adjust profile picture">
      <div className="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-xl p-5 flex flex-col gap-4">
        <div className="text-sm font-bold text-[var(--text)]">Adjust your photo</div>
        <div
          className="relative mx-auto overflow-hidden rounded-xl bg-black cursor-grab active:cursor-grabbing"
          style={{ width: VIEW, height: VIEW, touchAction: "none" }}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onWheel={(e) => setZoom(crop.zoom * (e.deltaY < 0 ? 1.08 : 0.92))}
        >
          <img
            src={img.src}
            alt=""
            draggable={false}
            className="absolute select-none max-w-none"
            style={{
              left: VIEW / 2 + crop.x,
              top: VIEW / 2 + crop.y,
              width: img.naturalWidth,
              height: img.naturalHeight,
              transform: `translate(-50%, -50%) rotate(${crop.rot * 90}deg) scale(${scale})`,
              transformOrigin: "center",
            }}
          />
          <div className="absolute inset-0 pointer-events-none rounded-full" style={{ boxShadow: "0 0 0 999px rgba(0,0,0,0.55)", border: "2px solid rgba(255,255,255,0.85)" }} />
        </div>
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => setZoom(crop.zoom / 1.15)} className="w-8 h-8 rounded-full border border-[var(--border)] text-lg leading-none text-[var(--text)]" aria-label="Zoom out">
            −
          </button>
          <input
            type="range"
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            value={crop.zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="flex-1 accent-[var(--accent)]"
            aria-label="Zoom"
          />
          <button type="button" onClick={() => setZoom(crop.zoom * 1.15)} className="w-8 h-8 rounded-full border border-[var(--border)] text-lg leading-none text-[var(--text)]" aria-label="Zoom in">
            +
          </button>
        </div>
        <div className="flex items-center justify-between gap-2">
          <div className="flex gap-2">
            <button type="button" onClick={() => update({ rot: (crop.rot + 3) % 4, x: 0, y: 0 })} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--text)]">
              ⟲ Rotate
            </button>
            <button type="button" onClick={() => update({ rot: (crop.rot + 1) % 4, x: 0, y: 0 })} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--text)]">
              ⟳ Rotate
            </button>
            <button type="button" onClick={() => setCrop({ ...INITIAL })} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--text-muted)]">
              Reset
            </button>
          </div>
        </div>
        <p className="text-[11px] text-[var(--text-faint)]">Drag to reposition. Pinch, scroll or use the slider to zoom. The circle is what shows.</p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--text-muted)]">
            Cancel
          </button>
          <button type="button" onClick={() => onApply(crop)} className="rounded-lg bg-[var(--accent)] text-[var(--accent-text)] px-5 py-2 text-sm font-semibold">
            Use this
          </button>
        </div>
      </div>
    </div>
  );
}

export function AvatarEditor() {
  const { user, refreshUser } = useAuth();
  const fileInput = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [source, setSource] = useState<HTMLImageElement | null>(null);
  const [cropping, setCropping] = useState(false);
  const [lastCrop, setLastCrop] = useState<CropState>(INITIAL);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  if (!user) return null;

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setMessage(null);
    try {
      setSource(await loadImage(file));
      setLastCrop(INITIAL);
      setCropping(true);
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
      setSource(null);
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
          {preview && source && (
            <button
              type="button"
              onClick={() => setCropping(true)}
              disabled={busy}
              className="rounded-lg border border-[var(--border)] bg-[var(--surface)] hover:border-[var(--accent)]/50 text-[var(--text)] font-semibold py-2 px-4 text-sm transition-colors disabled:opacity-60"
            >
              Adjust
            </button>
          )}
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
        {cropping && source && (
          <Cropper
            img={source}
            initial={lastCrop}
            onCancel={() => setCropping(false)}
            onApply={(c) => {
              setLastCrop(c);
              setPreview(renderCrop(source, c));
              setCropping(false);
            }}
          />
        )}
        {message && <div className={`text-xs ${message.ok ? "text-emerald-400" : "text-[var(--destructive)]"}`}>{message.text}</div>}
      </div>
    </section>
  );
}
