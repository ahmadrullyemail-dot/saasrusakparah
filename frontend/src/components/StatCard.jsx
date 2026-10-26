import { STATUS_LABELS } from '../config.js';
import { Icon } from './Icon.jsx';

export function StatCard({ label, value, tone, icon, onClick }) {
  return (
    <button className={`stat-card tone-${tone}`} type="button" onClick={onClick}>
      <span className={`stat-icon tone-${tone}`}><Icon name={icon} size={18} /></span>
      <span className="stat-label">{label}</span>
      <strong>{value}</strong>
      <span className="stat-card-action">Lihat detail <Icon name="arrowRight" size={15} /></span>
    </button>
  );
}

export function StatusBadge({ status }) {
  const icon = status === 'active' ? 'checkCircle' : status === 'inactive' ? 'x' : status === 'offered' ? 'file' : 'clock';
  return <span className={`status-badge ${status}`}><Icon name={icon} size={13} />{STATUS_LABELS[status] || status}</span>;
}
