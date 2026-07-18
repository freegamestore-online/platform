export interface DeployState {
  phase: string;
  steps?: { name: string; status: string }[];
  appUrl?: string;
  deployUrl?: string;
  error?: string;
  /** When phase === "error", the pipeline phase that was in progress when it
   *  failed. The server's error event carries no step info, so useAgent
   *  captures the prior phase to let DeployLog highlight the failed step. */
  failedPhase?: string;
  /** Non-error informational note for a non-terminal phase — e.g. "still
   *  building, reload to confirm" after the client stops polling. Shown as
   *  status, never in the error channel. */
  hint?: string;
}
