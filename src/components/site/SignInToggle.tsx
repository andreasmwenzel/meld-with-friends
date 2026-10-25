"use client";

import { useState, type ReactNode } from "react";

export function SignInToggle({ guest, signIn }: { guest: ReactNode; signIn: ReactNode }) {
  const [showSignIn, setShowSignIn] = useState(false);
  return (
    <div>
      {showSignIn ? signIn : guest}
      <button className="tap mt-1 text-left text-sm text-chalk-faint hover:text-chalk" onClick={() => setShowSignIn((v) => !v)}>
        {showSignIn ? "Just want to play? Start as a guest" : "Already have an account? Sign in"}
      </button>
    </div>
  );
}
