import { clsx } from 'clsx';
import type { InstanceStatus } from '../stores/types';

interface StatusBadgeProps {
  status: InstanceStatus;
  showLabel?: boolean;
}

const statusConfig: Record<InstanceStatus, { color: string; label: string }> = {
  idle: { color: 'bg-accent-green', label: 'Idle' },
  working: { color: 'bg-accent-blue', label: 'Working' },
  waiting_input: { color: 'bg-accent-yellow', label: 'Waiting' },
  waiting_permission: { color: 'bg-accent-red', label: 'Permission' },
};

export default function StatusBadge({ status, showLabel = false }: StatusBadgeProps) {
  const config = statusConfig[status];

  return (
    <div className="flex items-center gap-1.5">
      <div className={clsx('w-2 h-2 rounded-full', config.color)} />
      {showLabel && <span className="text-xs text-text-secondary">{config.label}</span>}
    </div>
  );
}
