import type { DeployState } from "../types";

// FGS games deploy on Path B: admin provisions (repo from template + host route
// + registry), the agent pushes its game code, then GitHub Actions builds and
// syncs to R2. There is no CF Pages step — the old "GitHub repo / CF Pages"
// pipeline painted phantom ✗ rows for steps this flow never emits.
const DEPLOY_PIPELINE = [
  { key: "provision", label: "Provisioning", phases: ["provisioning"] },
  { key: "push", label: "Pushing code", phases: ["pushing"] },
  { key: "build", label: "Building & deploying", phases: ["building"] },
  { key: "live", label: "Live", phases: ["live"] },
];

const PHASE_ORDER = ["provisioning", "pushing", "building", "live"];

export function DeployLog({ state }: { state: DeployState }) {
  const isError = state.phase === "error";
  // "error" is not itself a pipeline phase, so locate progress via the phase
  // that was active when the failure happened (captured by useAgent). On the
  // happy path this is just the current phase.
  const phaseIdx = PHASE_ORDER.indexOf(isError ? (state.failedPhase ?? "") : state.phase);
  // If any provisioning step reported an explicit failure, trust it — don't
  // also mark later same-phase steps (e.g. CF Pages) that were never reached.
  const hasExplicitFail = !!state.steps?.some((s) => s.status === "fail");

  return (
    <div className="w-full p-6" style={{ fontSize: "0.85rem" }}>
      <h3 className="font-bold mb-4" style={{ fontFamily: "Fraunces, serif" }}>Deploying your game</h3>
      {state.hint && (
        <p className="text-sm mb-4" style={{ color: "var(--muted)", maxWidth: 320 }}>
          {state.hint}
        </p>
      )}
      <div className="flex flex-col gap-1">
        {DEPLOY_PIPELINE.map((step) => {
          const provStep = state.steps?.find((s) => s.name === step.label);
          let status: "done" | "active" | "skip" | "fail" | "pending" = "pending";

          if (provStep) {
            status = provStep.status === "ok" ? "done" : provStep.status === "skip" ? "skip" : "fail";
          } else if (state.phase === "live") {
            status = "done";
          } else if (isError) {
            const stepPhaseIdx = PHASE_ORDER.findIndex((p) => step.phases.includes(p));
            if (phaseIdx >= 0 && stepPhaseIdx < phaseIdx) status = "done";
            else if (phaseIdx >= 0 && stepPhaseIdx === phaseIdx && !hasExplicitFail) status = "fail";
          } else {
            const stepPhaseIdx = PHASE_ORDER.findIndex((p) => step.phases.includes(p));
            if (stepPhaseIdx < phaseIdx) status = "done";
            else if (stepPhaseIdx === phaseIdx) status = "active";
          }

          const icon = { done: "✓", skip: "⊘", fail: "✗", active: "", pending: "" }[status];
          const iconColor = { done: "#22c55e", skip: "#fbbf24", fail: "#ef4444", active: "var(--accent)", pending: "var(--border)" }[status];

          return (
            <div key={step.key} className="flex items-center gap-3 py-1.5 px-2 rounded-lg" style={{
              color: status === "fail" ? "#ef4444" : ["done", "active"].includes(status) ? "var(--ink)" : "var(--muted)",
              background: status === "active" ? "color-mix(in srgb, var(--accent) 8%, transparent)" : status === "fail" ? "color-mix(in srgb, #ef4444 6%, transparent)" : "transparent",
              fontWeight: status === "active" ? 600 : 400,
            }}>
              {status === "active" ? (
                <span style={{ width: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span style={{ width: 12, height: 12, border: "2px solid var(--accent)", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.6s linear infinite", display: "block" }} />
                </span>
              ) : (
                <span style={{ width: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center", fontSize: status === "pending" ? "0.5rem" : "0.75rem", color: iconColor, fontWeight: 700 }}>
                  {icon || "○"}
                </span>
              )}
              {step.label}
              {status === "skip" && <span className="text-xs ml-1" style={{ color: "var(--muted)" }}>(exists)</span>}
            </div>
          );
        })}
      </div>

      {state.phase === "live" && state.appUrl && (
        <div className="mt-4 p-3 rounded-xl flex items-center gap-2" style={{ background: "color-mix(in srgb, #22c55e 10%, var(--surface))", border: "1px solid color-mix(in srgb, #22c55e 25%, var(--border))" }}>
          <span style={{ fontSize: "1.1rem" }}>&#127881;</span>
          <div>
            <div className="font-bold text-sm" style={{ color: "#22c55e" }}>Your game is live!</div>
            <a href={state.appUrl} target="_blank" rel="noopener" className="text-xs" style={{ color: "#22c55e" }}>{state.appUrl.replace("https://", "")}</a>
            <div className="text-xs mt-1" style={{ color: "var(--muted)" }}>It's already listed in the store. Keep chatting to make changes, then deploy again.</div>
          </div>
        </div>
      )}

      {state.phase === "error" && (
        <div className="mt-4 p-3 rounded-xl" style={{ background: "color-mix(in srgb, #ef4444 8%, var(--surface))", border: "1px solid color-mix(in srgb, #ef4444 25%, var(--border))" }}>
          <div className="font-bold text-sm mb-1" style={{ color: "#ef4444" }}>Deploy failed</div>
          <pre className="text-xs whitespace-pre-wrap" style={{ color: "var(--muted)" }}>{state.error}</pre>
        </div>
      )}
    </div>
  );
}
