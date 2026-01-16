import { create } from 'zustand';
import type { Instance, PendingRequest, WSEvent } from './types';

interface AppState {
  // State
  instances: Map<string, Instance>;
  pendingRequests: Map<string, PendingRequest>;
  selectedInstanceId: string | null;
  connected: boolean;
  error: string | null;

  // Actions
  setConnected: (connected: boolean) => void;
  setError: (error: string | null) => void;
  selectInstance: (id: string | null) => void;
  handleWSEvent: (event: WSEvent) => void;
  respondToRequest: (requestId: string, response: string) => Promise<void>;
}

const API_URL = 'http://127.0.0.1:3456';

export const useStore = create<AppState>((set, get) => ({
  instances: new Map(),
  pendingRequests: new Map(),
  selectedInstanceId: null,
  connected: false,
  error: null,

  setConnected: (connected) => set({ connected }),
  setError: (error) => set({ error }),
  selectInstance: (id) => set({ selectedInstanceId: id }),

  handleWSEvent: (event) => {
    switch (event.type) {
      case 'init': {
        const instances = new Map(event.instances.map((i) => [i.id, i]));
        const pendingRequests = new Map(event.pendingRequests.map((r) => [r.id, r]));
        set({ instances, pendingRequests });
        break;
      }

      case 'instance:connected': {
        set((state) => {
          const instances = new Map(state.instances);
          instances.set(event.instance.id, event.instance);
          return { instances };
        });
        break;
      }

      case 'instance:disconnected': {
        set((state) => {
          const instances = new Map(state.instances);
          instances.delete(event.instanceId);
          // Also remove pending requests for this instance
          const pendingRequests = new Map(state.pendingRequests);
          for (const [id, req] of pendingRequests) {
            if (req.instanceId === event.instanceId) {
              pendingRequests.delete(id);
            }
          }
          // Clear selection if this instance was selected
          const selectedInstanceId =
            state.selectedInstanceId === event.instanceId ? null : state.selectedInstanceId;
          return { instances, pendingRequests, selectedInstanceId };
        });
        break;
      }

      case 'instance:status': {
        set((state) => {
          const instances = new Map(state.instances);
          const instance = instances.get(event.instanceId);
          if (instance) {
            instances.set(event.instanceId, {
              ...instance,
              status: event.status,
              lastActivity: new Date().toISOString(),
            });
          }
          return { instances };
        });
        break;
      }

      case 'instance:request': {
        set((state) => {
          const pendingRequests = new Map(state.pendingRequests);
          pendingRequests.set(event.request.id, event.request);
          return { pendingRequests };
        });
        break;
      }

      case 'instance:request_resolved': {
        set((state) => {
          const pendingRequests = new Map(state.pendingRequests);
          pendingRequests.delete(event.requestId);
          return { pendingRequests };
        });
        break;
      }

      case 'instance:output': {
        set((state) => {
          const instances = new Map(state.instances);
          const instance = instances.get(event.instanceId);
          if (instance) {
            const outputBuffer = [...instance.outputBuffer, event.content].slice(-100);
            instances.set(event.instanceId, {
              ...instance,
              outputBuffer,
              lastActivity: new Date().toISOString(),
            });
          }
          return { instances };
        });
        break;
      }
    }
  },

  respondToRequest: async (requestId, response) => {
    try {
      const res = await fetch(`${API_URL}/api/respond/${requestId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to respond');
      }
    } catch (error) {
      console.error('Failed to respond to request:', error);
      throw error;
    }
  },
}));
