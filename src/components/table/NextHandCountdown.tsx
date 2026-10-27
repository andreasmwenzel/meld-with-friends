"use client";

import { useLayoutEffect, useState, useSyncExternalStore } from "react";
import { createNextHandCountdown, type CountdownContext } from "./nextHandCountdown";

export function NextHandCountdown(props: CountdownContext) {
  const [countdown] = useState(createNextHandCountdown);
  const state = useSyncExternalStore(countdown.subscribe, countdown.getSnapshot, countdown.getSnapshot);
  // Update before browser timers can run with props from an earlier render.
  useLayoutEffect(() => { countdown.update(props); });
  useLayoutEffect(() => {
    const hidden = () => { if (document.hidden) countdown.cancel(); };
    document.addEventListener("visibilitychange", hidden);
    hidden();
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      countdown.cancel();
    };
  }, [countdown]);

  // Said once when it starts waiting or counting, not every second; mounted empty beforehand so readers hear the change.
  const said = !state.enabled ? "" : state.seconds === null ? "Countdown waiting for everyone to be ready." : "Countdown to the next hand started.";

  return (
    <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
      <span role="status" className="sr-only">{said}</span>
      {state.enabled ? <>
        <span aria-hidden className="text-sm tabular-nums text-ink-soft">
          {state.seconds === null ? "Countdown waiting for everyone to be ready." : `Next hand in ${state.seconds}s.`}
        </span>
        <button type="button" className="btn btn-ink btn-compact" onClick={countdown.cancel}>Pause</button>
      </> : <button type="button" className="btn btn-ink btn-compact" disabled={!props.allowed} onClick={() => { if (!document.hidden) countdown.enable(); }}>
        Start 5-second countdown
      </button>}
    </div>
  );
}
