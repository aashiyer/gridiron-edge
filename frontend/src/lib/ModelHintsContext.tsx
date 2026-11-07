import { createContext, useCallback, useContext, useState } from "react";
import type { ReactNode } from "react";

const KEY = "pickSixModelHints";

function read(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

interface Value {
  show: boolean;
  setShow: (v: boolean) => void;
}

const Ctx = createContext<Value | null>(null);

export function ModelHintsProvider({ children }: { children: ReactNode }) {
  const [show, setShowState] = useState<boolean>(read());
  const setShow = useCallback((v: boolean) => {
    setShowState(v);
    try {
      localStorage.setItem(KEY, v ? "on" : "off");
    } catch {
      /* private mode: keep it in memory only */
    }
  }, []);
  return <Ctx.Provider value={{ show, setShow }}>{children}</Ctx.Provider>;
}

export function useModelHints(): Value {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useModelHints must be used inside ModelHintsProvider");
  return ctx;
}
