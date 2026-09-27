/** Scheduler/API seam: reconciliation owns mutation policy, not HTTP transport. */
export interface ReconciliationService<Report> {
  reconcile(heal?: boolean): Promise<Report>;
}

export function createReconciliationService<Report>(
  reconcile: (heal?: boolean) => Promise<Report>,
): ReconciliationService<Report> {
  return { reconcile };
}
