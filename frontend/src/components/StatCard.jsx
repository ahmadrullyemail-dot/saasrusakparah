import { STATUS_LABELS } from '../config.js';

export function StatCard({ label, value, tone }) {
  return <article className={`stat-card tone-${tone}`}><span className={`stat-marker ${tone}`} /><span className="stat-label">{label}</span><strong>{value}</strong></article>;
}

export function StatusBadge({ status }) {
  return <span className={`status-badge ${status}`}>{STATUS_LABELS[status] || status}</span>;
}
