import type { RulesConfig } from "@/engine";
import { RulesForm } from "@/components/rules/RulesForm";

export function PracticeRules({ rules, onStart }: { rules: RulesConfig; onStart: () => void }) {
  return (
    <section aria-labelledby="practice-rules" className="mx-auto w-full max-w-md px-6 py-6">
      <h1 id="practice-rules" className="display" style={{ fontSize: 28 }}>Your practice rules</h1>
      <div className="panel mt-3 p-4"><RulesForm value={rules} compact /></div>
      <button type="button" className="btn btn-brass mt-4" onClick={onStart}>Start practice</button>
    </section>
  );
}
