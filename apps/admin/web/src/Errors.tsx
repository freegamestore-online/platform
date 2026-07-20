import { useEffect, useState } from "react";
import { api, timeAgo, type ErrorRow } from "./api.ts";
import { ErrorBox, Loading } from "./Overview.tsx";

export function ErrorsPage() {
  const [rows, setRows] = useState<ErrorRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<ErrorRow[]>("/api/errors?limit=200").then(setRows).catch((e) => setError(e.message));
  }, []);

  if (error) return <ErrorBox message={error} />;
  if (!rows) return <Loading />;

  return (
    <div>
      <h1 className="text-xl font-bold mb-1" style={{ color: "var(--ink)" }}>Errors &amp; crashes</h1>
      <p className="text-sm mb-4" style={{ color: "var(--muted)" }}>Persisted from the create Pages Function and admin provisioning. Newest first.</p>
      {rows.length === 0 ? (
        <p className="text-sm font-medium" style={{ color: "#059669" }}>No errors logged — clean. 🎉</p>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((e, i) => (
            <div key={i} className="rounded-xl border p-4" style={{ borderColor: "var(--line)", background: "var(--panel)" }}>
              <div className="flex flex-wrap items-center gap-2 text-xs mb-1.5" style={{ color: "var(--muted)" }}>
                <span className="rounded px-1.5 py-0.5 border" style={{ borderColor: "var(--line)" }}>{e.source}</span>
                <span>{timeAgo(e.ts)}</span>
                {e.user_github && <span>@{e.user_github}</span>}
                {e.context && <span className="truncate max-w-xs">{e.context}</span>}
              </div>
              <div className="text-sm font-semibold" style={{ color: "#dc2626" }}>{e.message}</div>
              {e.stack && <pre className="text-xs mt-2 p-2 rounded overflow-auto max-h-36 whitespace-pre-wrap" style={{ background: "var(--accent-soft)", color: "var(--muted)" }}>{e.stack}</pre>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
