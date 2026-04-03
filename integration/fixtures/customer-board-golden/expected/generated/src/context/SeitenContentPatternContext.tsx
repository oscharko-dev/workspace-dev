/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, type ReactNode } from "react";

export interface SeitenContentPattern1State {
  requierdLabelText: string;
}

export interface SeitenContentPatternContextState {
  SeitenContentPattern1: Partial<Record<string, SeitenContentPattern1State>>;
}

const emptyPatternState: SeitenContentPatternContextState = {
  "SeitenContentPattern1": {}
};

const SeitenContentPatternContext = createContext<SeitenContentPatternContextState>(emptyPatternState);

interface SeitenContentPatternContextProviderProps {
  initialState: SeitenContentPatternContextState;
  children: ReactNode;
}

export function SeitenContentPatternContextProvider({ initialState, children }: SeitenContentPatternContextProviderProps) {
  return <SeitenContentPatternContext.Provider value={initialState}>{children}</SeitenContentPatternContext.Provider>;
}

 
export const useSeitenContentPatternContext = (): SeitenContentPatternContextState => {
  return useContext(SeitenContentPatternContext);
};
