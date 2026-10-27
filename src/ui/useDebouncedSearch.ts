import { useEffect, useState } from "react";

export function useDebouncedSearch(value: string, scope: string) {
  const [settled, setSettled] = useState({ scope, value });
  const [composing, setComposing] = useState(false);
  useEffect(() => {
    if (settled.scope !== scope) {
      setSettled({ scope, value });
      setComposing(false);
      return;
    }
    if (composing || settled.value === value) return;
    const timer = setTimeout(() => setSettled({ scope, value }), 300);
    return () => clearTimeout(timer);
  }, [value, scope, settled.scope, settled.value, composing]);
  return {
    query: settled.scope === scope ? settled.value : value,
    onCompositionStart: () => setComposing(true),
    onCompositionEnd: () => setComposing(false),
  };
}
