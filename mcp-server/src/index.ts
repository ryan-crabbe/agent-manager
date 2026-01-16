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
  status: "idle" | "working" | "waiting_input" | "waiting_permission";
  connectedAt: Date;
  lastActivity: Date;
  outputBuffer: string[];
}

interface PendingRequest {
  id: string;
  instanceId: string;
  prompt: string;
  options: string[];
  requestType: "permission" | "question" | "confirmation";
  createdAt: Date;
  resolve: (response: string) => void;
  reject: (error: Error) => void;
}

type WSEvent =
  | { type: "instance:connected"; instance: Instance }
  | { type: "instance:disconnected"; instanceId: string }
  | { type: "instance:status"; instanceId: string; status: Instance["status"] }
  | { type: "instance:request"; request: Omit<PendingRequest, "resolve" | "reject"> }
  | { type: "instance:request_resolved"; requestId: string }
  | { type: "instance:output"; instanceId: string; content: string; contentType: string };

// =============================================================================
// State
// =============================================================================

const instances = new Map<string, Instance>();
const pendingRequests = new Map<string, PendingRequest>();
const wsClients = new Set<WebSocket>();

const OUTPUT_BUFFER_SIZE = 100;
const PORT = 3456;

// =============================================================================
// WebSocket Broadcasting
// =============================================================================

function broadcast(event: WSEvent): void {
  const message = JSON.stringify(event);
  for (const client of wsClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

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
      const id = (args.instance_id as string) || uuidv4();
      const instance: Instance = {
        id,
        workingDirectory: args.working_directory as string,
        projectName: args.project_name as string,
        status: "idle",
        connectedAt: new Date(),
        lastActivity: new Date(),
        outputBuffer: [],
      };

      instances.set(id, instance);
      broadcast({ type: "instance:connected", instance });

      console.log(`[MCP] Instance registered: ${id} (${instance.projectName})`);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: true, instance_id: id }),
          },
        ],
      };
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
      const id = args.instance_id as string;

      // Clean up any pending requests for this instance
      for (const [requestId, request] of pendingRequests) {
        if (request.instanceId === id) {
          request.reject(new Error("Instance disconnected"));
          pendingRequests.delete(requestId);
        }
      }

      instances.delete(id);
      broadcast({ type: "instance:disconnected", instanceId: id });

      console.log(`[MCP] Instance unregistered: ${id}`);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: true }),
          },
        ],
      };
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
      const id = args.instance_id as string;
      const status = args.status as Instance["status"];
      const instance = instances.get(id);

      if (!instance) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ success: false, error: "Instance not found" }),
            },
          ],
        };
      }

      instance.status = status;
      instance.lastActivity = new Date();
      broadcast({ type: "instance:status", instanceId: id, status });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: true }),
          },
        ],
      };
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
      const instanceId = args.instance_id as string;
      const instance = instances.get(instanceId);

      if (!instance) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ success: false, error: "Instance not found" }),
            },
          ],
        };
      }

      const requestId = uuidv4();

      // Create a promise that will be resolved when the user responds
      const responsePromise = new Promise<string>((resolve, reject) => {
        const request: PendingRequest = {
          id: requestId,
          instanceId,
          prompt: args.prompt as string,
          options: (args.options as string[]) || [],
          requestType: (args.request_type as PendingRequest["requestType"]) || "question",
          createdAt: new Date(),
          resolve,
          reject,
        };

        pendingRequests.set(requestId, request);

        // Broadcast the new request (without resolve/reject functions)
        const { resolve: _, reject: __, ...broadcastRequest } = request;
        broadcast({ type: "instance:request", request: broadcastRequest });

        console.log(`[MCP] Request created: ${requestId} from instance ${instanceId}`);
      });

      // Update instance status
      instance.status = "waiting_input";
      instance.lastActivity = new Date();
      broadcast({ type: "instance:status", instanceId, status: "waiting_input" });

      try {
        const response = await responsePromise;

        // Update instance status back to working
        instance.status = "working";
        instance.lastActivity = new Date();
        broadcast({ type: "instance:status", instanceId, status: "working" });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ success: true, response }),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : "Unknown error",
              }),
            },
          ],
        };
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
      const instanceId = args.instance_id as string;
      const content = args.content as string;
      const contentType = (args.content_type as string) || "text";
      const instance = instances.get(instanceId);

      if (!instance) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ success: false, error: "Instance not found" }),
            },
          ],
        };
      }

      // Add to ring buffer
      instance.outputBuffer.push(content);
      if (instance.outputBuffer.length > OUTPUT_BUFFER_SIZE) {
        instance.outputBuffer.shift();
      }

      instance.lastActivity = new Date();
      broadcast({ type: "instance:output", instanceId, content, contentType });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: true }),
          },
        ],
      };
    }
  );

  return server;
}

// =============================================================================
// Express App & HTTP Server
// =============================================================================

const app = express();
app.use(express.json());

// CORS for local development
app.use((_req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
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
    ({ resolve, reject, ...rest }) => rest
  );
  res.json(requestList);
});

// Respond to a pending request
app.post("/api/respond/:requestId", (req: Request, res: Response) => {
  const { requestId } = req.params;
  const { response } = req.body;

  const request = pendingRequests.get(requestId);
  if (!request) {
    res.status(404).json({ error: "Request not found" });
    return;
  }

  request.resolve(response);
  pendingRequests.delete(requestId);
  broadcast({ type: "instance:request_resolved", requestId });

  console.log(`[API] Request resolved: ${requestId} with response: ${response}`);

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

  const transport = new SSEServerTransport("/mcp/message", res);
  const sessionId = uuidv4();
  transports.set(sessionId, transport);

  res.on("close", () => {
    console.log("[MCP] SSE connection closed");
    transports.delete(sessionId);
  });

  await mcpServer.connect(transport);
});

app.post("/mcp/message", async (req: Request, res: Response) => {
  // Find the transport that should handle this message
  // In practice, we need session management here
  const transport = Array.from(transports.values())[0];
  if (transport) {
    await transport.handlePostMessage(req, res);
  } else {
    res.status(400).json({ error: "No active MCP connection" });
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
  ws.send(
    JSON.stringify({
      type: "init",
      instances: Array.from(instances.values()),
      pendingRequests: Array.from(pendingRequests.values()).map(
        ({ resolve, reject, ...rest }) => rest
      ),
    })
  );

  ws.on("close", () => {
    console.log("[WS] Client disconnected");
    wsClients.delete(ws);
  });
});

// =============================================================================
// Start Server
// =============================================================================

httpServer.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║           Agent Manager MCP Server Running                 ║
╠════════════════════════════════════════════════════════════╣
║  HTTP Server:  http://localhost:${PORT}                       ║
║  MCP Endpoint: http://localhost:${PORT}/mcp                   ║
║  WebSocket:    ws://localhost:${PORT}/ws                      ║
║  Health Check: http://localhost:${PORT}/health                ║
╚════════════════════════════════════════════════════════════╝

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
