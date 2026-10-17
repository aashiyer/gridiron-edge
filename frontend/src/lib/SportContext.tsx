import { createContext, useCallback, useContext, useState } from "react";
import type { ReactNode } from "react";
import { getSport, setActiveSport } from "./api";
import type { Sport } from "./api";

interface SportContextValue {
  sport: Sport;
  setSport: (sport: Sport) => void;
}

const SportContext = createContext<SportContextValue | null>(null);

export function SportProvider({ children }: { children: ReactNode }) {
  const [sport, setSportState] = useState<Sport>(getSport());

  const setSport = useCallback((next: Sport) => {
    setActiveSport(next);
    setSportState(next);
  }, []);

  return <SportContext.Provider value={{ sport, setSport }}>{children}</SportContext.Provider>;
}

export function useSport(): SportContextValue {
  const ctx = useContext(SportContext);
  if (!ctx) throw new Error("useSport must be used inside SportProvider");
  return ctx;
}
