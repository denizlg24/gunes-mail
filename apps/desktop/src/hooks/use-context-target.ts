"use client";

import { useCallback, useRef, useState } from "react";

/**
 * One context menu shared by many rows: rows record what was right-clicked
 * during the bubbling contextmenu event, and the menu refuses to open when
 * the click landed on empty space.
 */
export function useContextTarget<T>() {
  const ref = useRef<T | null>(null);
  const [target, setTargetState] = useState<T | null>(null);
  const [open, setOpen] = useState(false);

  const setTarget = useCallback((value: T) => {
    ref.current = value;
    setTargetState(value);
  }, []);

  const resetCapture = useCallback(() => {
    ref.current = null;
  }, []);

  const onOpenChange = useCallback((next: boolean) => {
    if (next && !ref.current) return;
    setOpen(next);
  }, []);

  return { target, setTarget, open, onOpenChange, resetCapture };
}
