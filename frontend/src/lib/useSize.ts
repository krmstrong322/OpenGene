import { useEffect, useRef, useState } from "react";

/** The rendered size of an element, kept current as it is resized. */
export function useSize<T extends Element>(): [
  React.RefObject<T>,
  { width: number; height: number } | null,
] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setSize((s) =>
        s && s.width === r.width && s.height === r.height ? s : { width: r.width, height: r.height },
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}
