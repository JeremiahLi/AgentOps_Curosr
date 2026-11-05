"use client";

import { usePathname } from "next/navigation";
import { useLayoutEffect, useRef, type ReactNode } from "react";

/**
 * 主内容区是自管滚动容器（不是 window）。
 * 浏览器和 Next 的滚动恢复都作用在 document 上，返回上一页时 main 会被拉回顶部。
 * 按 URL 记住离开前的滚动位置，只在后退 / 前进时恢复。
 */
const mainPositions = new Map<string, number>();
const nestedPositions = new Map<string, number>();

function pageKey(pathname: string) {
  return pathname + window.location.search;
}

let pendingPop = false;
/** 当前文档里发生过客户端跳转。直链打开详情时为 false，返回应去列表而不是跳出站点。 */
let clientNavigated = false;

export function canReturnInApp() {
  return clientNavigated && window.history.length > 1;
}

export function PreserveMainScroll({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const mainRef = useRef<HTMLElement>(null);
  const keyRef = useRef("");
  const ignoreRef = useRef(false);
  const dragRef = useRef(false);
  const pointerRef = useRef(false);
  const userScrollRef = useRef(false);
  const userTimerRef = useRef(0);
  const cancelRestoreRef = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    const main = mainRef.current;
    if (!main) return;

    const snapshot = () => {
      if (ignoreRef.current) return;
      const key = keyRef.current;
      if (!key) return;
      mainPositions.set(key, main.scrollTop);
      for (const node of main.querySelectorAll<HTMLElement>("[data-preserve-scroll]")) {
        const id = node.getAttribute("data-preserve-scroll");
        if (!id) continue;
        nestedPositions.set(`${key}::${id}`, node.scrollTop);
      }
    };

    const armUserScroll = () => {
      cancelRestoreRef.current?.();
      userScrollRef.current = true;
      window.clearTimeout(userTimerRef.current);
      userTimerRef.current = window.setTimeout(() => {
        userScrollRef.current = false;
      }, 500);
    };

    const onScroll = (event: Event) => {
      if (ignoreRef.current) return;
      // 点击进入详情时，按下会先记下位置；按下后的滚动（例如聚焦把容器拉回顶部）不能覆盖它。
      // 只有滚轮/键盘，或按住并移动（拖滚动条）才持续更新。
      if (!dragRef.current && !userScrollRef.current) return;
      if (event.target !== main && !(event.target instanceof HTMLElement && event.target.hasAttribute("data-preserve-scroll"))) {
        return;
      }
      snapshot();
    };

    const onPointerDown = () => {
      cancelRestoreRef.current?.();
      userScrollRef.current = false;
      window.clearTimeout(userTimerRef.current);
      pointerRef.current = true;
      dragRef.current = false;
      snapshot();
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!pointerRef.current || event.buttons === 0) return;
      dragRef.current = true;
    };
    const onPointerUp = () => {
      pointerRef.current = false;
      dragRef.current = false;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === "ArrowDown" ||
        event.key === "ArrowUp" ||
        event.key === "PageDown" ||
        event.key === "PageUp" ||
        event.key === "Home" ||
        event.key === "End" ||
        event.key === " "
      ) {
        cancelRestoreRef.current?.();
        armUserScroll();
      }
    };
    const onPop = () => {
      pendingPop = true;
    };

    main.addEventListener("scroll", onScroll, true);
    window.addEventListener("wheel", armUserScroll, { capture: true, passive: true });
    window.addEventListener("touchmove", armUserScroll, { capture: true, passive: true });
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("pointermove", onPointerMove, true);
    window.addEventListener("pointerup", onPointerUp, true);
    window.addEventListener("pointercancel", onPointerUp, true);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("popstate", onPop);

    return () => {
      main.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("wheel", armUserScroll, true);
      window.removeEventListener("touchmove", armUserScroll, true);
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("pointerup", onPointerUp, true);
      window.removeEventListener("pointercancel", onPointerUp, true);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("popstate", onPop);
      window.clearTimeout(userTimerRef.current);
    };
  }, []);

  useLayoutEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    const key = pageKey(pathname);
    const isPop = pendingPop;
    pendingPop = false;
    if (keyRef.current && keyRef.current !== key) clientNavigated = true;
    keyRef.current = key;
    if (!isPop) return;

    const y = mainPositions.get(key) ?? 0;
    ignoreRef.current = true;
    let stopped = false;
    let raf = 0;

    const apply = () => {
      if (stopped) return;
      const el = mainRef.current;
      if (!el) return;
      if (el.scrollTop !== y) el.scrollTop = y;
      for (const node of el.querySelectorAll<HTMLElement>("[data-preserve-scroll]")) {
        const id = node.getAttribute("data-preserve-scroll");
        if (!id) continue;
        const nested = nestedPositions.get(`${key}::${id}`);
        if (nested == null || node.scrollTop === nested) continue;
        node.scrollTop = nested;
      }
    };

    const resizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(apply);
    });
    const watch = () => {
      resizeObserver.disconnect();
      const content = main.firstElementChild;
      if (content instanceof HTMLElement) resizeObserver.observe(content);
      for (const node of main.querySelectorAll<HTMLElement>("[data-preserve-scroll]")) {
        resizeObserver.observe(node);
      }
    };
    const mutationObserver = new MutationObserver(() => {
      watch();
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(apply);
    });

    let timer = 0;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      ignoreRef.current = false;
      cancelRestoreRef.current = null;
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
    cancelRestoreRef.current = stop;

    watch();
    mutationObserver.observe(main, { childList: true, subtree: true });
    raf = requestAnimationFrame(() => {
      apply();
      raf = requestAnimationFrame(apply);
    });
    timer = window.setTimeout(stop, 4000);

    return () => {
      stop();
    };
  }, [pathname]);

  return (
    <main ref={mainRef} className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
      {children}
    </main>
  );
}
