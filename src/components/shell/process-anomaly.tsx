"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

type Panel = {
  open: boolean;
  hasAnomaly: boolean;
};

type ProcessAnomalyContextValue = {
  panel: Panel | null;
  toggle: () => void;
  bind: (panel: Panel, onToggle: () => void) => void;
  unbind: () => void;
};

const ProcessAnomalyContext = createContext<ProcessAnomalyContextValue | null>(null);

/**
 * 会话详情页把「过程异常」面板登记到顶栏铃铛。
 * toggle 放在 ref 里，避免每次开关都换成新函数、把顶栏和详情页串成循环更新。
 */
export function ProcessAnomalyProvider({ children }: { children: ReactNode }) {
  const [panel, setPanel] = useState<Panel | null>(null);
  const toggleRef = useRef<(() => void) | null>(null);

  const bind = useCallback((next: Panel, onToggle: () => void) => {
    toggleRef.current = onToggle;
    setPanel((prev) =>
      prev && prev.open === next.open && prev.hasAnomaly === next.hasAnomaly ? prev : next,
    );
  }, []);

  const unbind = useCallback(() => {
    toggleRef.current = null;
    setPanel(null);
  }, []);

  const toggle = useCallback(() => {
    toggleRef.current?.();
  }, []);

  const value = useMemo(
    () => ({ panel, toggle, bind, unbind }),
    [panel, toggle, bind, unbind],
  );

  return (
    <ProcessAnomalyContext.Provider value={value}>{children}</ProcessAnomalyContext.Provider>
  );
}

export function useProcessAnomaly() {
  const ctx = useContext(ProcessAnomalyContext);
  if (!ctx) throw new Error("useProcessAnomaly 必须在 ProcessAnomalyProvider 内使用");
  return ctx;
}

/** 会话详情挂载期间，把过程异常面板交给顶栏铃铛控制。 */
export function useBindProcessAnomaly(open: boolean, hasAnomaly: boolean, onToggle: () => void) {
  const { bind, unbind } = useProcessAnomaly();

  useEffect(() => {
    bind({ open, hasAnomaly }, onToggle);
  }, [bind, open, hasAnomaly, onToggle]);

  useEffect(() => unbind, [unbind]);
}
