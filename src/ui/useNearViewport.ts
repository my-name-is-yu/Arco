import { useEffect, useRef, useState } from "react";

// Start previews just before they enter the scroll viewport. Unmounting their
// query consumes its AbortSignal and removes reads still waiting in the queue.
export function useNearViewport<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    if (near || !ref.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setNear(true);
        observer.disconnect();
      },
      { rootMargin: "200px" },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [near]);
  return { ref, near };
}
