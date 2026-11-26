"use client";

import { useEffect, useState } from "react";

const KEY = "portal-large-text";

/** "Larger text" option (spec 5.10); remembered on this device only. */
export function TextSizeToggle() {
  const [large, setLarge] = useState(false);
  useEffect(() => {
    let saved = false;
    try {
      saved = localStorage.getItem(KEY) === "1";
    } catch {}
    if (saved) apply(true, setLarge);
  }, []);
  return (
    <button
      type="button"
      onClick={() => apply(!large, setLarge)}
      aria-pressed={large}
      className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-100"
    >
      {large ? "Normal text size" : "Larger text"}
    </button>
  );
}

function apply(on: boolean, set: (v: boolean) => void) {
  set(on);
  document.documentElement.style.fontSize = on ? "125%" : "";
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {}
}
