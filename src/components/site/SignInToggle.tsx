"use client";

import { useState, type ReactNode } from "react";

/** Guest start or email sign-in on the front door. `initial` opens on sign-in, as after leaving a guest account. */
export function SignInToggle({ guest, signIn, initial = false }: { guest: ReactNode; signIn: ReactNode; initial?: boolean }) {
  const [showSignIn, setShowSignIn] = useState(initial);
  return (
    <div>
      {showSignIn ? signIn : guest}
      <button className="tap mt-1 text-left text-sm text-chalk underline decoration-chalk-ghost underline-offset-4 hover:decoration-chalk" onClick={() => setShowSignIn((v) => !v)}>
        {showSignIn ? "Just want to play? Start as a guest" : "Played here before? Sign in to see your tables"}
      </button>
    </div>
  );
}
