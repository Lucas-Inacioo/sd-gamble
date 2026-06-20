import React from "react";

const styles = {
  card: {
    background: "#161b22",
    border: "1px solid #30363d",
    borderRadius: 14,
    padding: 20,
    marginBottom: 20,
    boxShadow: "0 10px 28px rgba(0,0,0,0.22)",
  },
  statusBox: {
    background: "#0d1117",
    border: "1px solid #30363d",
    borderRadius: 10,
    padding: 12,
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  label: { color: "#8b949e", fontSize: 13 },
  headingRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 10,
  },
  heading: { margin: 0, fontSize: 20 },
  button: {
    border: 0,
    borderRadius: 8,
    padding: "9px 12px",
    background: "#238636",
    color: "#fff",
    cursor: "pointer",
    fontWeight: 700,
  },
  muted: { color: "#8b949e" },
  item: {
    borderTop: "1px solid #30363d",
    marginTop: 12,
    paddingTop: 12,
    overflowWrap: "anywhere",
  },
  pre: {
    background: "#0d1117",
    borderRadius: 8,
    border: "1px solid #30363d",
    padding: 9,
    margin: "8px 0 0",
    overflowX: "auto",
    fontSize: 12,
  },
};

export function StatusBox({ label, value }) {
  const normalized = String(value || "unknown").toLowerCase();
  const good = ["connected", "active", "running", "finished", "yes", "no", "won", "cashed_out"].includes(normalized);
  const bad = ["disconnected", "error", "connection error", "lost"].includes(normalized);

  return (
    <div style={styles.statusBox}>
      <span style={styles.label}>{label}</span>
      <strong style={{ color: good ? "#3fb950" : bad ? "#f85149" : "#d29922" }}>
        {value}
      </strong>
    </div>
  );
}

export function DebugPanel({ title, items, eventMode = false, onRefresh }) {
  return (
    <section style={styles.card}>
      <div style={styles.headingRow}>
        <h2 style={styles.heading}>{title}</h2>
        {onRefresh && <button style={styles.button} onClick={onRefresh}>Refresh</button>}
      </div>
      {items.length === 0 && <p style={styles.muted}>No records yet.</p>}
      {items.map((item, index) => {
        const createdAt = item.time || item.createdAt;
        const label = item.name || item.event || "record";
        const payload = eventMode ? item.payload : item.details;
        return (
          <div key={item.id || `${label}-${index}`} style={styles.item}>
            <strong>{createdAt ? new Date(createdAt).toLocaleTimeString() : ""} {createdAt ? "— " : ""}{label}</strong>
            <pre style={styles.pre}>{JSON.stringify(payload || item, null, 2)}</pre>
          </div>
        );
      })}
    </section>
  );
}

export function Card({ children, style }) {
  return <section style={{ ...styles.card, ...style }}>{children}</section>;
}

export const sharedStyles = styles;
