import { useEffect, useRef } from 'react';
import { useStore } from '../stores/useStore';
import StatusBadge from './StatusBadge';
import { Folder, Terminal } from 'lucide-react';

export default function InstanceDetail() {
  const { selectedInstanceId, instances } = useStore();
  const outputRef = useRef<HTMLDivElement>(null);

  const instance = selectedInstanceId ? instances.get(selectedInstanceId) : null;

  // Auto-scroll to bottom when output changes
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [instance?.outputBuffer]);

  if (!instance) {
    return (
      <div className="h-full flex items-center justify-center text-text-secondary">
        <div className="text-center">
          <Terminal size={48} className="mx-auto mb-4 opacity-50" />
          <p>Select an instance to view details</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Instance header */}
      <div className="px-4 py-3 bg-bg-secondary border-b border-bg-tertiary">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-text-primary">{instance.projectName}</h2>
            <StatusBadge status={instance.status} showLabel />
          </div>
        </div>
        <div className="mt-1 flex items-center gap-1 text-sm text-text-muted">
          <Folder size={14} />
          <span>{instance.workingDirectory}</span>
        </div>
      </div>

      {/* Output log */}
      <div
        ref={outputRef}
        className="flex-1 overflow-y-auto p-4 font-mono text-sm bg-bg-primary"
      >
        {instance.outputBuffer.length === 0 ? (
          <p className="text-text-muted">No output yet</p>
        ) : (
          <div className="space-y-1">
            {instance.outputBuffer.map((line, index) => (
              <div key={index} className="text-text-secondary whitespace-pre-wrap break-all">
                {line}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
