import type { CallerCredentials } from '../caller';
import type { dataService } from '../data';
import type { Env } from '../env';
import type { LifecycleErrorCode } from '../publish';

/** Result of a game lifecycle operation (update or delete). When error is
 *  present, code indicates the error type for HTTP status mapping. */
export type GameLifecycleResult = { ok?: boolean; error?: string; code?: LifecycleErrorCode };

export interface RouteParams {
  request: Request;
  env: Env;
  url: URL;
  caller: CallerCredentials;
  match: RegExpMatchArray | null;
  data: ReturnType<typeof dataService>;
}

export interface Route {
  method: string | string[];
  pattern: string | RegExp;
  auth: 'admin' | 'login' | 'internal' | 'ci' | 'public';
  handler: (params: RouteParams) => Promise<Response>;
}
