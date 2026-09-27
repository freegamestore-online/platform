/**
 * The control-flow policy for a chat turn.
 *
 * The Durable Object supplies each round (provider call, persistence and infra
 * execution) and remains the only owner of mutable session state. Keeping this
 * small policy object dependency-injected makes the multi-round contract
 * independently testable.
 */
export interface TurnRoundOutcome {
  /** No server-side tool calls means the provider completed the turn. */
  hasInfraRequests: boolean;
  /** Deploys that succeeded end a turn; failed deploys return to the provider. */
  successfulDeploy: boolean;
}

export type RunTurnRound = (resumeMessage: string | null, infraRound: number) => Promise<TurnRoundOutcome>;

export interface TurnOrchestratorDeps {
  maxInfraRounds?: number;
}

export class TurnOrchestrator {
  private readonly maxInfraRounds: number;

  constructor({ maxInfraRounds = 6 }: TurnOrchestratorDeps = {}) {
    this.maxInfraRounds = maxInfraRounds;
  }

  /** Execute provider/infra rounds, injecting the stateful round implementation. */
  async run(initialMessage: string | null, runRound: RunTurnRound): Promise<void> {
    let resumeMessage = initialMessage;
    for (let infraRound = 0; ; infraRound++) {
      const outcome = await runRound(resumeMessage, infraRound);
      if (!outcome.hasInfraRequests || outcome.successfulDeploy || infraRound + 1 >= this.maxInfraRounds) return;
      // Subsequent provider calls continue from the persisted transcript.
      resumeMessage = null;
    }
  }
}
