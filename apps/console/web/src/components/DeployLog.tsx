import { deployErrorInfo } from '../lib/deployError';
import type { DeployState } from '../types';

// FGS games deploy on Path B: admin provisions (repo from template + host route
// + registry), the agent pushes its game code, then GitHub Actions builds and
// syncs to R2. There is no CF Pages step — the old "GitHub repo / CF Pages"
// pipeline painted phantom ✗ rows for steps this flow never emits.
const DEPLOY_PIPELINE = [
  { key: 'provision', label: 'Provisioning', phases: ['provisioning'] },
  { key: 'push', label: 'Pushing code', phases: ['pushing'] },
  { key: 'build', label: 'Building & deploying', phases: ['building'] },
  { key: 'live', label: 'Live', phases: ['live'] },
];

const PHASE_ORDER = ['provisioning', 'pushing', 'building', 'live'];

export function DeployLog({ state, appId }: { state: DeployState; appId?: string | null }) {
  const isError = state.phase === 'error';
  // "error" is not itself a pipeline phase, so locate progress via the phase
  // that was active when the failure happened (captured by useAgent). On the
  // happy path this is just the current phase.
  const phaseIdx = PHASE_ORDER.indexOf(isError ? (state.failedPhase ?? '') : state.phase);
  // If any provisioning step reported an explicit failure, trust it — don't
  // also mark later same-phase steps (e.g. CF Pages) that were never reached.
  const hasExplicitFail = !!state.steps?.some((s) => s.status === 'fail');

  return (
    <div className="w-full p-6 text-[0.85rem]">
      <h3 className="font-bold mb-4 font-display">Deploying your game</h3>
      {state.hint && <p className="text-sm mb-4 text-muted max-w-[320px]">{state.hint}</p>}
      <div className="flex flex-col gap-1">
        {DEPLOY_PIPELINE.map((step) => {
          const provStep = state.steps?.find((s) => s.name === step.label);
          let status: 'done' | 'active' | 'skip' | 'fail' | 'pending' = 'pending';

          if (provStep) {
            status =
              provStep.status === 'ok' ? 'done' : provStep.status === 'skip' ? 'skip' : 'fail';
          } else if (state.phase === 'live') {
            status = 'done';
          } else if (isError) {
            const stepPhaseIdx = PHASE_ORDER.findIndex((p) => step.phases.includes(p));
            if (phaseIdx >= 0 && stepPhaseIdx < phaseIdx) status = 'done';
            else if (phaseIdx >= 0 && stepPhaseIdx === phaseIdx && !hasExplicitFail)
              status = 'fail';
          } else {
            const stepPhaseIdx = PHASE_ORDER.findIndex((p) => step.phases.includes(p));
            if (stepPhaseIdx < phaseIdx) status = 'done';
            else if (stepPhaseIdx === phaseIdx) status = 'active';
          }

          const icon = { done: '✓', skip: '⊘', fail: '✗', active: '', pending: '' }[status];
          const iconColor = {
            done: 'text-success',
            skip: 'text-warning',
            fail: 'text-danger',
            active: 'text-accent',
            pending: 'text-line',
          }[status];
          const rowTone =
            status === 'fail'
              ? 'text-danger bg-danger/6 font-normal'
              : status === 'active'
                ? 'text-ink bg-accent/8 font-semibold'
                : status === 'done'
                  ? 'text-ink bg-transparent font-normal'
                  : 'text-muted bg-transparent font-normal';

          return (
            <div
              key={step.key}
              className={`flex items-center gap-3 py-1.5 px-2 rounded-lg ${rowTone}`}
            >
              {status === 'active' ? (
                <span className="w-[18px] h-[18px] flex items-center justify-center">
                  <span className="block w-3 h-3 border-2 border-accent border-t-transparent rounded-full animate-spin [animation-duration:0.6s]" />
                </span>
              ) : (
                <span
                  className={`w-[18px] h-[18px] flex items-center justify-center font-bold ${
                    status === 'pending' ? 'text-[0.5rem]' : 'text-[0.75rem]'
                  } ${iconColor}`}
                >
                  {icon || '○'}
                </span>
              )}
              {step.label}
              {status === 'skip' && <span className="text-xs ml-1 text-muted">(exists)</span>}
            </div>
          );
        })}
      </div>

      {state.phase === 'live' && state.appUrl && (
        <div className="mt-4 p-3 rounded-xl flex items-center gap-2 bg-success/10 border border-success/25">
          <span className="text-[1.1rem]">&#127881;</span>
          <div>
            <div className="font-bold text-sm text-success">Your game is live!</div>
            <a href={state.appUrl} target="_blank" rel="noopener" className="text-xs text-success">
              {state.appUrl.replace('https://', '')}
            </a>
            <div className="text-xs mt-1 text-muted">
              It's already listed in the store. Keep chatting to make changes, then deploy again.
            </div>
          </div>
        </div>
      )}

      {state.phase === 'error' && (
        <div className="mt-4 p-3 rounded-xl bg-danger/8 border border-danger/25">
          <div className="font-bold text-sm mb-1 text-danger">Deploy failed</div>
          {/* Same helper as DeployErrorNotice, so an empty `error` gets the same
              actionable fallback here as it does in the chat column. */}
          <pre className="text-xs whitespace-pre-wrap text-muted">
            {deployErrorInfo(state, appId).message}
          </pre>
        </div>
      )}
    </div>
  );
}
