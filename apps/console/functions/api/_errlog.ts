/** Shared D1 persistence is bundled from the versioned error-log contract. */
export {
  type ErrLogRow,
  recordError,
} from '../../../../contracts/error-log/v1/contract';

/** fetch() with an abort timeout. On timeout it throws a labelled error so a
 *  hung upstream becomes a VISIBLE, logged failure instead of the whole Pages
 *  Function being killed mid-request (which reaches the browser as an opaque
 *  "Load failed"). Timeout is generous — it only trips a true hang, never a
 *  slow-but-working call. Pure instrumentation; the request semantics are
 *  otherwise unchanged. */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  ms: number,
  label: string,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new Error(`${label} timed out after ${ms}ms`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
