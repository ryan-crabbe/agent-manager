import { useEffect, useRef } from 'react';
import { useStore } from './stores/useStore';
import type { WSEvent } from './stores/types';
import InstanceList from './components/InstanceList';
import PendingQueue from './components/PendingQueue';
import InstanceDetail from './components/InstanceDetail';
import { Wifi, WifiOff } from 'lucide-react';

const WS_URL = 'ws://127.0.0.1:3456/ws';

export default function App() {
  const { connected, setConnected, setError, handleWSEvent, error } = useStore();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    function connect() {
      console.log('[WS] Connecting...');
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[WS] Connected');
        setConnected(true);
        setError(null);
      };

      ws.onmessage = (event) => {
        try {
          const data: WSEvent = JSON.parse(event.data);
          handleWSEvent(data);
        } catch (err) {
          console.error('[WS] Failed to parse message:', err);
        }
      };

      ws.onclose = () => {
        console.log('[WS] Disconnected');
        setConnected(false);
        wsRef.current = null;

        // Reconnect after 2 seconds
        reconnectTimeoutRef.current = window.setTimeout(connect, 2000);
      };

      ws.onerror = (err) => {
        console.error('[WS] Error:', err);
        setError('Connection error. Is the MCP server running?');
      };
    }

    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [setConnected, setError, handleWSEvent]);

  return (
    <div className="h-full flex flex-col bg-bg-primary">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2 bg-bg-secondary border-b border-bg-tertiary">
        <h1 className="text-lg font-semibold text-text-primary">Agent Manager</h1>
        <div className="flex items-center gap-2">
          {connected ? (
            <div className="flex items-center gap-1.5 text-accent-green text-sm">
              <Wifi size={16} />
              <span>Connected</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-accent-red text-sm">
              <WifiOff size={16} />
              <span>Disconnected</span>
            </div>
          )}
        </div>
      </header>

      {/* Error banner */}
      {error && (
        <div className="px-4 py-2 bg-accent-red/20 text-accent-red text-sm">
          {error}
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar - Instance List */}
        <aside className="w-64 border-r border-bg-tertiary flex-shrink-0 overflow-y-auto">
          <InstanceList />
        </aside>

        {/* Main area */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {/* Pending requests queue */}
          <div className="border-b border-bg-tertiary">
            <PendingQueue />
          </div>

          {/* Instance detail */}
          <div className="flex-1 overflow-hidden">
            <InstanceDetail />
          </div>
        </main>
      </div>
    </div>
  );
}
