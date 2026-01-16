import { useStore } from '../stores/useStore';
import StatusBadge from './StatusBadge';
import { clsx } from 'clsx';
import { Folder, Clock } from 'lucide-react';

function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function truncatePath(path: string, maxLength = 30): string {
  if (path.length <= maxLength) return path;
  const parts = path.split('/');
  if (parts.length <= 2) return '...' + path.slice(-maxLength + 3);
  return '.../' + parts.slice(-2).join('/');
}

export default function InstanceList() {
  const { instances, selectedInstanceId, selectInstance, pendingRequests } = useStore();
  const instanceList = Array.from(instances.values());

  // Count pending requests per instance
  const pendingCountByInstance = new Map<string, number>();
  for (const req of pendingRequests.values()) {
    const count = pendingCountByInstance.get(req.instanceId) || 0;
    pendingCountByInstance.set(req.instanceId, count + 1);
  }

  if (instanceList.length === 0) {
    return (
      <div className="p-4 text-center">
        <p className="text-text-secondary text-sm">No instances connected</p>
        <p className="text-text-muted text-xs mt-2">
          Start a Claude Code session with the agent-manager MCP server configured
        </p>
      </div>
    );
  }

  return (
    <div className="p-2">
      <h2 className="px-2 py-1 text-xs font-medium text-text-muted uppercase tracking-wider">
        Instances ({instanceList.length})
      </h2>
      <div className="mt-1 space-y-1">
        {instanceList.map((instance) => {
          const pendingCount = pendingCountByInstance.get(instance.id) || 0;
          const isSelected = selectedInstanceId === instance.id;

          return (
            <button
              key={instance.id}
              onClick={() => selectInstance(instance.id)}
              className={clsx(
                'w-full text-left px-3 py-2 rounded-lg transition-colors',
                isSelected
                  ? 'bg-accent-blue/20 border border-accent-blue/50'
                  : 'hover:bg-bg-tertiary border border-transparent'
              )}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <StatusBadge status={instance.status} />
                  <span className="font-medium text-text-primary truncate">
                    {instance.projectName}
                  </span>
                </div>
                {pendingCount > 0 && (
                  <span className="flex-shrink-0 bg-accent-red text-white text-xs font-medium px-1.5 py-0.5 rounded-full">
                    {pendingCount}
                  </span>
                )}
              </div>
              <div className="mt-1 flex items-center gap-1 text-xs text-text-muted">
                <Folder size={12} />
                <span className="truncate">{truncatePath(instance.workingDirectory)}</span>
              </div>
              <div className="mt-0.5 flex items-center gap-1 text-xs text-text-muted">
                <Clock size={12} />
                <span>{formatTimeAgo(instance.lastActivity)}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
