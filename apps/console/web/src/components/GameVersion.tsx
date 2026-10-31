import { useEffect, useState } from 'react';
import { formatRelative } from '../lib/format';

interface VersionInfo {
  version?: string;
  deployedAt?: string;
  source?: string;
}

/**
 * Shows a live game's deployed version + how long ago, read from its
 * `<game>/version.json` (CORS-open on the host). Renders nothing until it
 * loads and stays silent if the game is unreachable — purely informational.
 */
export function GameVersion({ liveUrl }: { liveUrl?: string }) {
  const [info, setInfo] = useState<VersionInfo | null>(null);

  useEffect(() => {
    if (!liveUrl) return;
    let cancelled = false;
    fetch(`${liveUrl.replace(/\/$/, '')}/version.json`)
      .then((r) =>
        r.ok ? (r.json() as Promise<VersionInfo>) : Promise.reject(new Error(String(r.status))),
      )
      .then((d) => {
        if (!cancelled) setInfo(d);
      })
      .catch(() => {
        /* old/unreachable game — show nothing */
      });
    return () => {
      cancelled = true;
    };
  }, [liveUrl]);

  if (!info) return null;
  const v = (info.version ?? '').slice(0, 7);
  const stampNote = info.source === 'r2-metadata' ? ' (from R2 metadata — no build stamp yet)' : '';

  return (
    <span
      title={
        info.deployedAt
          ? `Deployed ${new Date(info.deployedAt).toLocaleString()}${stampNote}`
          : undefined
      }
    >
      {v && (
        <>
          v <code className="font-[monospace]">{v}</code>
        </>
      )}
      {info.deployedAt && <> · deployed {formatRelative(info.deployedAt)}</>}
    </span>
  );
}
