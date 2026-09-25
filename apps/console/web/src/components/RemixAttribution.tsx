import type { GameRepo } from '../hooks/useAuth';

type ForkedFrom = GameRepo['forkedFrom'];

const VALID_ID = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const VALID_GITHUB_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;

function isSnapshot(value: ForkedFrom): value is Exclude<ForkedFrom, string | undefined> {
  return (
    !!value &&
    typeof value !== 'string' &&
    VALID_ID.test(value.id) &&
    typeof value.name === 'string' &&
    value.name.trim().length > 0 &&
    VALID_GITHUB_LOGIN.test(value.creatorGithub)
  );
}

/**
 * A deliberately small, presentation-only credit for Studio game cards.
 * `sourceAvailable` comes from the registry API, not the frozen snapshot: this
 * lets a removed source retain readable credit without leaving a dead game link.
 */
export function RemixAttribution({
  attribution,
  sourceAvailable = false,
}: {
  attribution?: ForkedFrom;
  sourceAvailable?: boolean;
}) {
  if (typeof attribution === 'string') {
    return VALID_ID.test(attribution) ? (
      <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
        Remixed from {attribution}
      </p>
    ) : null;
  }
  if (!isSnapshot(attribution)) return null;

  const sourceName = attribution.name.trim();
  const source = sourceAvailable ? (
    <a
      href={`https://${attribution.id}.freegamestore.online`}
      target="_blank"
      rel="noopener noreferrer"
      className="hover:underline"
      style={{ color: 'var(--accent)' }}
    >
      {sourceName}
    </a>
  ) : (
    <span>{sourceName}</span>
  );

  return (
    <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
      Remixed from {source} by{' '}
      <a
        href={`https://github.com/${attribution.creatorGithub}`}
        target="_blank"
        rel="noopener noreferrer"
        className="hover:underline"
        style={{ color: 'var(--accent)' }}
      >
        @{attribution.creatorGithub}
      </a>
    </p>
  );
}
