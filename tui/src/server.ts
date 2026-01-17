// HTTP server to receive hooks from Claude Code instances

import { state, type HookEvent } from "./state";

const PORT = 3456;

export function startServer(): void {
  const server = Bun.serve({
    port: PORT,
    fetch(req) {
      const url = new URL(req.url);

      // Health check
      if (req.method === "GET" && url.pathname === "/health") {
        return Response.json({
          status: "ok",
          instances: state.instances.size
        });
      }

      // Hook endpoint
      if (req.method === "POST" && url.pathname === "/hook") {
        return handleHook(req);
      }

      return new Response("Not found", { status: 404 });
    },
  });

  console.log(`Hook server listening on http://localhost:${PORT}`);
}

async function handleHook(req: Request): Promise<Response> {
  try {
    const event = await req.json() as HookEvent;

    if (!event.cwd) {
      return Response.json({ error: "Missing cwd" }, { status: 400 });
    }

    state.handleHook(event);
    return Response.json({ success: true });
  } catch (error) {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
}
