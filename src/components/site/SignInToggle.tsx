"use client";

import { useState, type ReactNode } from "react";

export function SignInToggle({ guest, signIn }: { guest: ReactNode; signIn: ReactNode }) {
  const [showSignIn, setShowSignIn] = useState(false);
  return (
    <div>
      {showSignIn ? signIn : guest}
      <button className="tap mt-1 text-left text-sm text-chalk underline decoration-chalk-ghost underline-offset-4 hover:decoration-chalk" onClick={() => setShowSignIn((v) => !v)}>
        {showSignIn ? "Just want to play? Start as a guest" : "Played here before? Sign in to see your tables"}
      </button>
    </div>
  );
}
