import express, { Request, Response } from "express";
import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { v4 as uuidv4 } from "uuid";

// =============================================================================
// Types
// =============================================================================

interface Instance {
  id: string;
  workingDirectory: string;
  projectName: string;
  status: InstanceStatus;
  connectedAt: Date;
  lastActivity: Date;
  outputBuffer: string[];
}

type InstanceStatus = "idle" | "working" | "waiting_input" | "waiting_permission";
const VALID_STATUSES: InstanceStatus[] = ["idle", "working", "waiting_input", "waiting_permission"];

type RequestType = "permission" | "question" | "confirmation";
const VALID_REQUEST_TYPES: RequestType[] = ["permission", "question", "confirmation"];

interface PendingRequest {
  id: string;
  instanceId: string;
  prompt: string;
  options: string[];
  requestType: RequestType;
  createdAt: Date;
  timeoutId: NodeJS.Timeout;
  resolve: (response: string) => void;
  reject: (error: Error) => void;
}

type WSEvent =
  | { type: "instance:connected"; instance: Instance }
  | { type: "instance:disconnected"; instanceId: string }
  | { type: "instance:status"; instanceId: string; status: InstanceStatus }
  | { type: "instance:request"; request: Omit<PendingRequest, "resolve" | "reject" | "timeoutId"> }
  | { type: "instance:request_resolved"; requestId: string }
  | { type: "instance:output"; instanceId: string; content: string; contentType: string };

// =============================================================================
// Configuration
// =============================================================================

const PORT = parseInt(process.env.AGENT_MANAGER_PORT || "3456", 10);
const HOST = process.env.AGENT_MANAGER_HOST || "127.0.0.1";
const OUTPUT_BUFFER_SIZE = 100;
const REQUEST_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour
const STALE_INSTANCE_MS = 30 * 60 * 1000; // 30 minutes
const MAX_RESPONSE_LENGTH = 10000;
const MAX_BODY_SIZE = "1mb";

const ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  `http://localhost:${PORT}`,
  `http://127.0.0.1:${PORT}`,
];

// =============================================================================
// State
// =============================================================================

const instances = new Map<string, Instance>();
const pendingRequests = new Map<string, PendingRequest>();
const wsClients = new Set<WebSocket>();

// =============================================================================
// Validation Helpers
// =============================================================================

function validateString(value: unknown, fieldName: string, maxLength = 10000): string {
  if (typeof value !== "string") {
    throw new Error(`${fieldName} must be a string`);
  }
  if (value.length === 0) {
    throw new Error(`${fieldName} cannot be empty`);
  }
  if (value.length > maxLength) {
    throw new Error(`${fieldName} exceeds maximum length of ${maxLength}`);
  }
  return value;
}

function validateOptionalString(value: unknown, fieldName: string, maxLength = 10000): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return validateString(value, fieldName, maxLength);
}

function validateStatus(value: unknown): InstanceStatus {
  if (typeof value !== "string" || !VALID_STATUSES.includes(value as InstanceStatus)) {
    throw new Error(`Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}`);
  }
  return value as InstanceStatus;
}

function validateRequestType(value: unknown): RequestType {
  if (typeof value !== "string" || !VALID_REQUEST_TYPES.includes(value as RequestType)) {
    return "question"; // Default
  }
  return value as RequestType;
}

function validateStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function mcpError(message: string) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: message }) }],
  };
}

function mcpSuccess(data: Record<string, unknown> = {}) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ success: true, ...data }) }],
  };
}

// =============================================================================
// WebSocket Broadcasting
// =============================================================================

function broadcast(event: WSEvent): void {
  const message = JSON.stringify(event);
  for (const client of wsClients) {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(message);
      } catch (error) {
        console.error("[WS] Failed to send message, removing client");
        wsClients.delete(client);
      }
    }
  }
}

// =============================================================================
// Cleanup: Stale instances and timed-out requests
// =============================================================================

function cleanupStaleInstances(): void {
  const now = Date.now();
  for (const [id, instance] of instances) {
    if (now - instance.lastActivity.getTime() > STALE_INSTANCE_MS) {
      console.log(`[Cleanup] Removing stale instance: ${id}`);

      // Clean up pending requests for this instance
      for (const [requestId, request] of pendingRequests) {
        if (request.instanceId === id) {
          clearTimeout(request.timeoutId);
          request.reject(new Error("Instance timed out"));
          pendingRequests.delete(requestId);
        }
      }

      instances.delete(id);
      broadcast({ type: "instance:disconnected", instanceId: id });
    }
  }
}

// Run cleanup every minute
setInterval(cleanupStaleInstances, 60000);

// =============================================================================
// MCP Server Setup
// =============================================================================

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "agent-manager",
    version: "0.1.0",
  });

  // Tool: register_instance
  server.tool(
    "register_instance",
    "Register a Claude Code instance with the agent manager",
    {
      instance_id: {
        type: "string",
        description: "Unique identifier for this instance (optional, will be generated if not provided)",
      },
      working_directory: {
        type: "string",
        description: "The working directory of the Claude Code session",
      },
      project_name: {
        type: "string",
        description: "Name of the project being worked on",
      },
    },
    async (args) => {
      try {
        const workingDirectory = validateString(args.working_directory, "working_directory");
        const projectName = validateString(args.project_name, "project_name");
        const providedId = validateOptionalString(args.instance_id, "instance_id");

        const id = providedId || uuidv4();

        // Check for ID collision
        if (instances.has(id)) {
          return mcpError("Instance ID already registered. Use a different ID or call unregister_instance first.");
        }

        const instance: Instance = {
          id,
          workingDirectory,
          projectName,
          status: "idle",
          connectedAt: new Date(),
          lastActivity: new Date(),
          outputBuffer: [],
        };

        instances.set(id, instance);
        broadcast({ type: "instance:connected", instance });

        console.log(`[MCP] Instance registered: ${id} (${instance.projectName})`);

        return mcpSuccess({ instance_id: id });
      } catch (error) {
        return mcpError(error instanceof Error ? error.message : "Invalid arguments");
      }
    }
  );

  // Tool: unregister_instance
  server.tool(
    "unregister_instance",
    "Unregister a Claude Code instance when the session ends",
    {
      instance_id: {
        type: "string",
        description: "The instance ID to unregister",
      },
    },
    async (args) => {
      try {
        const id = validateString(args.instance_id, "instance_id");

        // Clean up any pending requests for this instance
        for (const [requestId, request] of pendingRequests) {
          if (request.instanceId === id) {
            clearTimeout(request.timeoutId);
            request.reject(new Error("Instance disconnected"));
            pendingRequests.delete(requestId);
          }
        }

        instances.delete(id);
        broadcast({ type: "instance:disconnected", instanceId: id });

        console.log(`[MCP] Instance unregistered: ${id}`);

        return mcpSuccess();
      } catch (error) {
        return mcpError(error instanceof Error ? error.message : "Invalid arguments");
      }
    }
  );

  // Tool: report_status
  server.tool(
    "report_status",
    "Report the current status of a Claude Code instance",
    {
      instance_id: {
        type: "string",
        description: "The instance ID",
      },
      status: {
        type: "string",
        description: "Current status: idle, working, waiting_input, or waiting_permission",
      },
    },
    async (args) => {
      try {
        const id = validateString(args.instance_id, "instance_id");
        const status = validateStatus(args.status);
        const instance = instances.get(id);

        if (!instance) {
          return mcpError("Instance not found");
        }

        instance.status = status;
        instance.lastActivity = new Date();
        broadcast({ type: "instance:status", instanceId: id, status });

        return mcpSuccess();
      } catch (error) {
        return mcpError(error instanceof Error ? error.message : "Invalid arguments");
      }
    }
  );

  // Tool: request_input
  server.tool(
    "request_input",
    "Request input from the user via the Agent Manager dashboard. This will block until the user responds.",
    {
      instance_id: {
        type: "string",
        description: "The instance ID making the request",
      },
      prompt: {
        type: "string",
        description: "The prompt/question to show the user",
      },
      options: {
        type: "array",
        items: { type: "string" },
        description: "Optional list of predefined options for the user to choose from",
      },
      request_type: {
        type: "string",
        description: "Type of request: permission, question, or confirmation",
      },
    },
    async (args) => {
      try {
        const instanceId = validateString(args.instance_id, "instance_id");
        const prompt = validateString(args.prompt, "prompt");
        const options = validateStringArray(args.options);
        const requestType = validateRequestType(args.request_type);

        const instance = instances.get(instanceId);

        if (!instance) {
          return mcpError("Instance not found");
        }

        const requestId = uuidv4();

        // Create a promise that will be resolved when the user responds
        const responsePromise = new Promise<string>((resolve, reject) => {
          // Set up timeout
          const timeoutId = setTimeout(() => {
            if (pendingRequests.has(requestId)) {
              pendingRequests.delete(requestId);
              reject(new Error("Request timed out waiting for user response"));
            }
          }, REQUEST_TIMEOUT_MS);

          const request: PendingRequest = {
            id: requestId,
            instanceId,
            prompt,
            options,
            requestType,
            createdAt: new Date(),
            timeoutId,
            resolve: (response: string) => {
              clearTimeout(timeoutId);
              resolve(response);
            },
            reject: (error: Error) => {
              clearTimeout(timeoutId);
              reject(error);
            },
          };

          pendingRequests.set(requestId, request);

          // Broadcast the new request (without internal fields)
          const { resolve: _, reject: __, timeoutId: ___, ...broadcastRequest } = request;
          broadcast({ type: "instance:request", request: broadcastRequest });

          console.log(`[MCP] Request created: ${requestId} from instance ${instanceId}`);
        });

        // Update instance status
        instance.status = "waiting_input";
        instance.lastActivity = new Date();
        broadcast({ type: "instance:status", instanceId, status: "waiting_input" });

        const response = await responsePromise;

        // Update instance status back to working
        instance.status = "working";
        instance.lastActivity = new Date();
        broadcast({ type: "instance:status", instanceId, status: "working" });

        return mcpSuccess({ response });
      } catch (error) {
        return mcpError(error instanceof Error ? error.message : "Unknown error");
      }
    }
  );

  // Tool: send_output
  server.tool(
    "send_output",
    "Send output to be displayed in the Agent Manager dashboard",
    {
      instance_id: {
        type: "string",
        description: "The instance ID",
      },
      content: {
        type: "string",
        description: "The content to display",
      },
      content_type: {
        type: "string",
        description: "Type of content: text, code, or error",
      },
    },
    async (args) => {
      try {
        const instanceId = validateString(args.instance_id, "instance_id");
        const content = validateString(args.content, "content", 50000);
        const contentType = validateOptionalString(args.content_type, "content_type") || "text";

        const instance = instances.get(instanceId);

        if (!instance) {
          return mcpError("Instance not found");
        }

        // Add to ring buffer
        instance.outputBuffer.push(content);
        if (instance.outputBuffer.length > OUTPUT_BUFFER_SIZE) {
          instance.outputBuffer.shift();
        }

        instance.lastActivity = new Date();
        broadcast({ type: "instance:output", instanceId, content, contentType });

        return mcpSuccess();
      } catch (error) {
        return mcpError(error instanceof Error ? error.message : "Invalid arguments");
      }
    }
  );

  return server;
}

// =============================================================================
// Express App & HTTP Server
// =============================================================================

const app = express();
app.use(express.json({ limit: MAX_BODY_SIZE }));

// CORS - restricted to allowed origins
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
  }
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

// Health check
app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", instances: instances.size, pendingRequests: pendingRequests.size });
});

// Get all instances
app.get("/api/instances", (_req: Request, res: Response) => {
  const instanceList = Array.from(instances.values());
  res.json(instanceList);
});

// Get all pending requests
app.get("/api/requests", (_req: Request, res: Response) => {
  const requestList = Array.from(pendingRequests.values()).map(
    ({ resolve, reject, timeoutId, ...rest }) => rest
  );
  res.json(requestList);
});

// Respond to a pending request
app.post("/api/respond/:requestId", (req: Request, res: Response) => {
  const { requestId } = req.params;
  const { response } = req.body;

  // Input validation
  if (typeof response !== "string") {
    res.status(400).json({ error: "Response must be a string" });
    return;
  }

  if (response.length > MAX_RESPONSE_LENGTH) {
    res.status(400).json({ error: `Response exceeds maximum length of ${MAX_RESPONSE_LENGTH}` });
    return;
  }

  const request = pendingRequests.get(requestId);
  if (!request) {
    res.status(404).json({ error: "Request not found" });
    return;
  }

  request.resolve(response);
  pendingRequests.delete(requestId);
  broadcast({ type: "instance:request_resolved", requestId });

  console.log(`[API] Request resolved: ${requestId}`);

  res.json({ success: true });
});

// Get instance output buffer
app.get("/api/instances/:instanceId/output", (req: Request, res: Response) => {
  const { instanceId } = req.params;
  const instance = instances.get(instanceId);

  if (!instance) {
    res.status(404).json({ error: "Instance not found" });
    return;
  }

  res.json({ output: instance.outputBuffer });
});

// =============================================================================
// MCP SSE Endpoint
// =============================================================================

const mcpServer = createMcpServer();
const transports = new Map<string, SSEServerTransport>();

app.get("/mcp", async (req: Request, res: Response) => {
  console.log("[MCP] New SSE connection");

  const sessionId = uuidv4();
  const transport = new SSEServerTransport(`/mcp/message?sessionId=${sessionId}`, res);
  transports.set(sessionId, transport);

  res.on("close", () => {
    console.log(`[MCP] SSE connection closed: ${sessionId}`);
    transports.delete(sessionId);
  });

  try {
    await mcpServer.connect(transport);
  } catch (error) {
    console.error("[MCP] Connection error:", error);
    transports.delete(sessionId);
  }
});

app.post("/mcp/message", async (req: Request, res: Response) => {
  const sessionId = req.query.sessionId as string;

  if (!sessionId) {
    res.status(400).json({ error: "Missing sessionId" });
    return;
  }

  const transport = transports.get(sessionId);
  if (!transport) {
    res.status(404).json({ error: "Session not found or expired" });
    return;
  }

  try {
    await transport.handlePostMessage(req, res);
  } catch (error) {
    console.error("[MCP] Message handling error:", error);
    res.status(500).json({ error: "Failed to process message" });
  }
});

// =============================================================================
// HTTP + WebSocket Server
// =============================================================================

const httpServer = createServer(app);

const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

wss.on("connection", (ws: WebSocket) => {
  console.log("[WS] Client connected");
  wsClients.add(ws);

  // Send current state to new client
  try {
    ws.send(
      JSON.stringify({
        type: "init",
        instances: Array.from(instances.values()),
        pendingRequests: Array.from(pendingRequests.values()).map(
          ({ resolve, reject, timeoutId, ...rest }) => rest
        ),
      })
    );
  } catch (error) {
    console.error("[WS] Failed to send init message:", error);
  }

  const cleanup = () => {
    wsClients.delete(ws);
  };

  ws.on("close", () => {
    console.log("[WS] Client disconnected");
    cleanup();
  });

  ws.on("error", (error) => {
    console.error("[WS] Client error:", error.message);
    cleanup();
  });
});

// =============================================================================
// Start Server
// =============================================================================

httpServer.listen(PORT, HOST, () => {
  console.log(`
+------------------------------------------------------------+
|           Agent Manager MCP Server Running                 |
+------------------------------------------------------------+
|  HTTP Server:  http://${HOST}:${PORT}                         |
|  MCP Endpoint: http://${HOST}:${PORT}/mcp                     |
|  WebSocket:    ws://${HOST}:${PORT}/ws                        |
|  Health Check: http://${HOST}:${PORT}/health                  |
+------------------------------------------------------------+

Add this to your Claude Code MCP config:
{
  "mcpServers": {
    "agent-manager": {
      "type": "sse",
      "url": "http://localhost:${PORT}/mcp"
    }
  }
}
`);
});
