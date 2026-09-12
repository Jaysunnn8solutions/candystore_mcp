"use client";

import { useEffect, type RefObject } from "react";

/**
 * The no-scroll claim is arithmetic against two distribution centres, five
 * stores and seven segments. A data change or a longer label can break it
 * silently, so in development the frame says so instead of just clipping.
 */
export function useOverflowWarn(ref: RefObject<HTMLElement | null>, name: string): void {
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    const el = ref.current;
    if (!el) return;
    let last = "";
    const check = () => {
      const overV = el.scrollHeight - el.clientHeight;
      // scrollbar-gutter reserves a couple of pixels that are not overflow.
      const overH = el.scrollWidth - el.clientWidth;
      if (overV <= 1 && overH <= 4) return;
      const msg = `[frame] ${name} overflows by ${overV}px tall / ${overH}px wide (${el.scrollHeight}x${el.scrollWidth} in ${el.clientHeight}x${el.clientWidth})`;
      if (msg === last) return;
      last = msg;
      console.warn(msg);
    };
    const ro = new ResizeObserver(check);
    ro.observe(el);
    check();
    return () => ro.disconnect();
  }, [ref, name]);
}
