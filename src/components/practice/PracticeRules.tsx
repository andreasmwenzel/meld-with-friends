import type { RulesConfig } from "@/engine";
import { describeRules } from "@/components/rules/rules";

export function PracticeRules({ rules, onStart }: { rules: RulesConfig; onStart: () => void }) {
  return (
    <section aria-labelledby="practice-rules" className="mx-auto w-full max-w-md px-6 py-6">
      <h1 id="practice-rules" className="display" style={{ fontSize: 28 }}>Your practice rules</h1>
      <ul className="mt-3 flex flex-col gap-2 text-sm text-chalk-faint">
        {describeRules(rules).map((line) => <li key={line}>{line}</li>)}
      </ul>
      <button type="button" className="btn btn-brass mt-4" onClick={onStart}>Start practice</button>
    </section>
  );
}
