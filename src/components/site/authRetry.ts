/** Only Supabase's per-address resend cooldown includes this explicit duration. */
export function authRetrySeconds(message: string): number | null {
  const match = /\bfor security purposes,\s*you can only request this after\s+(\d+)\s+seconds?\b/i.exec(message);
  if (!match) return null;
  const seconds = Number(match[1]);
  return Number.isSafeInteger(seconds) && seconds > 0 ? seconds : null;
}

/** Read the clock on every tick so a throttled background tab can catch up. */
export function startAuthRetry(seconds: number, onTick: (remaining: number) => void) {
  const deadline = Date.now() + seconds * 1000;
  let previous = seconds;
  const timer = setInterval(() => {
    const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    if (remaining === 0) clearInterval(timer);
    if (remaining !== previous) {
      previous = remaining;
      onTick(remaining);
    }
  }, 250);
  return () => clearInterval(timer);
}
