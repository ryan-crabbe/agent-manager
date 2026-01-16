export type InstanceStatus = 'idle' | 'working' | 'waiting_input' | 'waiting_permission';
export type RequestType = 'permission' | 'question' | 'confirmation';

export interface Instance {
  id: string;
  workingDirectory: string;
  projectName: string;
  status: InstanceStatus;
  connectedAt: string;
  lastActivity: string;
  outputBuffer: string[];
}

export interface PendingRequest {
  id: string;
  instanceId: string;
  prompt: string;
  options: string[];
  requestType: RequestType;
  createdAt: string;
}

export type WSEvent =
  | { type: 'init'; instances: Instance[]; pendingRequests: PendingRequest[] }
  | { type: 'instance:connected'; instance: Instance }
  | { type: 'instance:disconnected'; instanceId: string }
  | { type: 'instance:status'; instanceId: string; status: InstanceStatus }
  | { type: 'instance:request'; request: PendingRequest }
  | { type: 'instance:request_resolved'; requestId: string }
  | { type: 'instance:output'; instanceId: string; content: string; contentType: string };
