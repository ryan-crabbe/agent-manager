import { useState } from 'react';
import { useStore } from '../stores/useStore';
import { clsx } from 'clsx';
import { Check, X, MessageSquare, Shield, HelpCircle } from 'lucide-react';
import type { RequestType } from '../stores/types';

const requestTypeConfig: Record<RequestType, { icon: typeof Shield; color: string; label: string }> = {
  permission: { icon: Shield, color: 'text-accent-red bg-accent-red/20', label: 'Permission' },
  question: { icon: HelpCircle, color: 'text-accent-blue bg-accent-blue/20', label: 'Question' },
  confirmation: { icon: MessageSquare, color: 'text-accent-yellow bg-accent-yellow/20', label: 'Confirm' },
};

interface RequestCardProps {
  requestId: string;
  instanceId: string;
  prompt: string;
  options: string[];
  requestType: RequestType;
}

function RequestCard({ requestId, instanceId, prompt, options, requestType }: RequestCardProps) {
  const { instances, respondToRequest, selectInstance } = useStore();
  const [customResponse, setCustomResponse] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const instance = instances.get(instanceId);
  const config = requestTypeConfig[requestType];
  const Icon = config.icon;

  const handleRespond = async (response: string) => {
    setIsSubmitting(true);
    try {
      await respondToRequest(requestId, response);
    } catch (error) {
      console.error('Failed to respond:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmitCustom = (e: React.FormEvent) => {
    e.preventDefault();
    if (customResponse.trim()) {
      handleRespond(customResponse.trim());
    }
  };

  return (
    <div className="bg-bg-secondary rounded-lg p-3 border border-bg-tertiary">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className={clsx('p-1 rounded', config.color)}>
            <Icon size={14} />
          </div>
          <button
            onClick={() => selectInstance(instanceId)}
            className="text-sm font-medium text-accent-blue hover:underline truncate"
          >
            {instance?.projectName || instanceId}
          </button>
          <span className={clsx('text-xs px-1.5 py-0.5 rounded', config.color)}>
            {config.label}
          </span>
        </div>
      </div>

      <p className="mt-2 text-sm text-text-primary whitespace-pre-wrap line-clamp-3">
        {prompt}
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        {/* Quick options */}
        {options.length > 0 ? (
          options.map((option) => (
            <button
              key={option}
              onClick={() => handleRespond(option)}
              disabled={isSubmitting}
              className="px-3 py-1.5 text-sm bg-bg-tertiary hover:bg-bg-primary rounded transition-colors disabled:opacity-50"
            >
              {option}
            </button>
          ))
        ) : requestType === 'permission' ? (
          <>
            <button
              onClick={() => handleRespond('yes')}
              disabled={isSubmitting}
              className="flex items-center gap-1 px-3 py-1.5 text-sm bg-accent-green/20 text-accent-green hover:bg-accent-green/30 rounded transition-colors disabled:opacity-50"
            >
              <Check size={14} />
              Approve
            </button>
            <button
              onClick={() => handleRespond('no')}
              disabled={isSubmitting}
              className="flex items-center gap-1 px-3 py-1.5 text-sm bg-accent-red/20 text-accent-red hover:bg-accent-red/30 rounded transition-colors disabled:opacity-50"
            >
              <X size={14} />
              Deny
            </button>
          </>
        ) : requestType === 'confirmation' ? (
          <>
            <button
              onClick={() => handleRespond('yes')}
              disabled={isSubmitting}
              className="flex items-center gap-1 px-3 py-1.5 text-sm bg-accent-green/20 text-accent-green hover:bg-accent-green/30 rounded transition-colors disabled:opacity-50"
            >
              <Check size={14} />
              Yes
            </button>
            <button
              onClick={() => handleRespond('no')}
              disabled={isSubmitting}
              className="flex items-center gap-1 px-3 py-1.5 text-sm bg-bg-tertiary hover:bg-bg-primary rounded transition-colors disabled:opacity-50"
            >
              <X size={14} />
              No
            </button>
          </>
        ) : null}

        {/* Custom response input for questions */}
        {requestType === 'question' && options.length === 0 && (
          <form onSubmit={handleSubmitCustom} className="flex-1 flex gap-2">
            <input
              type="text"
              value={customResponse}
              onChange={(e) => setCustomResponse(e.target.value)}
              placeholder="Type your response..."
              className="flex-1 px-3 py-1.5 text-sm bg-bg-tertiary rounded border border-bg-primary focus:border-accent-blue focus:outline-none"
            />
            <button
              type="submit"
              disabled={isSubmitting || !customResponse.trim()}
              className="px-3 py-1.5 text-sm bg-accent-blue text-white rounded hover:bg-accent-blue/80 transition-colors disabled:opacity-50"
            >
              Send
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default function PendingQueue() {
  const { pendingRequests } = useStore();
  const requestList = Array.from(pendingRequests.values()).sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  if (requestList.length === 0) {
    return (
      <div className="p-4">
        <h2 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-2">
          Pending Requests
        </h2>
        <p className="text-sm text-text-secondary">No pending requests</p>
      </div>
    );
  }

  return (
    <div className="p-4 max-h-64 overflow-y-auto">
      <h2 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-2">
        Pending Requests ({requestList.length})
      </h2>
      <div className="space-y-2">
        {requestList.map((request) => (
          <RequestCard
            key={request.id}
            requestId={request.id}
            instanceId={request.instanceId}
            prompt={request.prompt}
            options={request.options}
            requestType={request.requestType}
          />
        ))}
      </div>
    </div>
  );
}
