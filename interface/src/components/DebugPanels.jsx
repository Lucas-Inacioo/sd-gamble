import React from "react";

/**
 * Standard card used across the interface.
 * Component code contains structure and semantics only; visual rules live in
 * `src/styles/components.css`.
 */
export function Card({ children, compact = false, className = "" }) {
  const classes = ["card", compact && "card--compact", className]
    .filter(Boolean)
    .join(" ");

  return <section className={classes}>{children}</section>;
}

/**
 * Displays a small, accessible status summary.
 * The visual status is intentionally accompanied by text so color is not the
 * only source of meaning.
 */
export function StatusBox({ label, value }) {
  const normalized = String(value || "unknown").toLowerCase();
  const positiveValues = [
    "connected",
    "active",
    "running",
    "finished",
    "yes",
    "won",
    "cashed_out",
  ];
  const negativeValues = [
    "disconnected",
    "error",
    "connection error",
    "lost",
  ];

  const tone = positiveValues.includes(normalized)
    ? "good"
    : negativeValues.includes(normalized)
      ? "bad"
      : "neutral";

  return (
    <div className="status-box">
      <span className="status-box__label">{label}</span>
      <strong className={`status-box__value status-box__value--${tone}`}>
        {value || "unknown"}
      </strong>
    </div>
  );
}

/**
 * Reusable panel for WebSocket events, API logs and game-server logs.
 * The component is intentionally generic so every game presents technical
 * data in the same format.
 */
export function DebugPanel({ title, items = [], eventMode = false, onRefresh }) {
  return (
    <Card className="debug-panel">
      <div className="panel-heading-row">
        <h2 className="section-heading">{title}</h2>
        {onRefresh && (
          <button type="button" className="button button--primary" onClick={onRefresh}>
            Refresh
          </button>
        )}
      </div>

      {items.length === 0 && (
        <p className="debug-panel__empty">No records yet.</p>
      )}

      {items.map((item, index) => {
        const createdAt = item.time || item.createdAt;
        const label = item.name || item.event || "record";
        const payload = eventMode ? item.payload : item.details;
        const timestamp = createdAt
          ? new Date(createdAt).toLocaleTimeString()
          : null;

        return (
          <article key={item.id || `${label}-${index}`} className="debug-panel__item">
            <strong className="debug-panel__event-name">
              {timestamp && <span className="debug-panel__time">{timestamp} — </span>}
              {label}
            </strong>
            <pre className="json-view debug-panel__payload">
              {JSON.stringify(payload || item, null, 2)}
            </pre>
          </article>
        );
      })}
    </Card>
  );
}
