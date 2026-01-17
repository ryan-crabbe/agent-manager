# Agent Manager - OpenTUI Spec

## Overview

A terminal-native dashboard to monitor all running Claude Code instances. Built with OpenTUI, runs in your terminal alongside your Claude sessions.

## What It Looks Like

```
┌─ Agent Manager ─────────────────────────────────────────── 3 instances ─┐
│                                                                         │
│  ┌─ agent-manager ──────────────────────────────────────────────────┐  │
│  │  ● WAITING    Waiting for permission: Edit src/index.ts          │  │
│  │  /Users/ryan/coding/agent-manager                                │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌─ website ────────────────────────────────────────────────────────┐  │
│  │  ● WORKING    Bash: npm test                                     │  │
│  │  /Users/ryan/coding/website                                      │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌─ api-server ─────────────────────────────────────────────────────┐  │
│  │  ○ IDLE       Last activity: 2 min ago                           │  │
│  │  /Users/ryan/coding/api-server                                   │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│  ↑/↓ navigate   Enter focus terminal   r refresh   q quit              │
└─────────────────────────────────────────────────────────────────────────┘
```

## Workflow

```bash
# In a tmux pane or separate terminal tab:
npx agent-manager

# In other terminals, run Claude as normal:
claude
```

The TUI shows all instances. When one needs attention (yellow/red), press Enter to focus that terminal.

## Architecture

```
┌──────────────────────────────────────────────┐
│            OpenTUI App (TUI)                 │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │  BoxRenderable (root)                  │  │
│  │  ├─ TextRenderable (header)            │  │
│  │  ├─ SelectRenderable (instance list)   │  │
│  │  │   └─ InstanceCard[] (custom)        │  │
│  │  └─ TextRenderable (footer/help)       │  │
│  └────────────────────────────────────────┘  │
│                    ▲                         │
│                    │ updates                 │
│  ┌─────────────────┴──────────────────────┐  │
│  │  HTTP Server (receives hooks)          │  │
│  │  POST /hook → update state → rerender  │  │
│  └────────────────────────────────────────┘  │
└──────────────────────────────────────────────┘
         ▲              ▲              ▲
      curl           curl           curl  (hooks)
         │              │              │
    Claude 1       Claude 2       Claude 3
```

## Code Structure

```
agent-manager/
├── package.json
├── src/
│   ├── index.ts           # Entry point
│   ├── server.ts          # HTTP server for hooks
│   ├── state.ts           # Instance state management
│   ├── ui/
│   │   ├── app.ts         # Root layout
│   │   ├── header.ts      # Title bar
│   │   ├── instance-list.ts  # SelectRenderable list
│   │   ├── instance-card.ts  # Individual instance box
│   │   └── footer.ts      # Help text
│   └── utils/
│       └── terminal-focus.ts  # Focus terminal window
└── README.md
```

## Core Components

### 1. App Layout (`ui/app.ts`)

```typescript
import { createCliRenderer, BoxRenderable } from "@opentui/core"
import { createHeader } from "./header"
import { createInstanceList } from "./instance-list"
import { createFooter } from "./footer"

export async function createApp() {
  const renderer = await createCliRenderer()

  const root = new BoxRenderable(renderer, {
    id: "root",
    flexDirection: "column",
    border: { style: "rounded" },
  })

  root.add(createHeader(renderer))
  root.add(createInstanceList(renderer))
  root.add(createFooter(renderer))

  renderer.root.add(root)
  return renderer
}
```

### 2. Instance List (`ui/instance-list.ts`)

```typescript
import { BoxRenderable, TextRenderable } from "@opentui/core"
import { state } from "../state"

export function createInstanceList(renderer) {
  const container = new BoxRenderable(renderer, {
    id: "instance-list",
    flexDirection: "column",
    flexGrow: 1,
    padding: { left: 1, right: 1 },
  })

  // Re-render when state changes
  state.subscribe(() => {
    container.clear()

    for (const instance of state.instances.values()) {
      container.add(createInstanceCard(renderer, instance))
    }

    renderer.requestRender()
  })

  return container
}
```

### 3. Instance Card (`ui/instance-card.ts`)

```typescript
import { BoxRenderable, TextRenderable } from "@opentui/core"

const STATUS_COLORS = {
  idle: "#22c55e",      // green
  working: "#3b82f6",   // blue
  waiting_input: "#eab308",     // yellow
  waiting_permission: "#ef4444", // red
}

export function createInstanceCard(renderer, instance) {
  const card = new BoxRenderable(renderer, {
    id: `instance-${instance.id}`,
    flexDirection: "column",
    border: { style: "rounded" },
    marginBottom: 1,
  })

  // Header row: status + activity
  const header = new BoxRenderable(renderer, {
    flexDirection: "row",
  })

  header.add(new TextRenderable(renderer, {
    content: `● ${instance.status.toUpperCase()}`,
    color: STATUS_COLORS[instance.status],
  }))

  header.add(new TextRenderable(renderer, {
    content: `   ${instance.activity || ""}`,
    color: "#a0a0a0",
    flexGrow: 1,
  }))

  // Path row
  const path = new TextRenderable(renderer, {
    content: instance.workingDirectory,
    color: "#666666",
  })

  card.add(header)
  card.add(path)

  return card
}
```

### 4. Keyboard Handling

```typescript
import { exec } from "child_process"

renderer.on("keypress", (key) => {
  switch (key.name) {
    case "up":
    case "k":
      state.selectPrevious()
      break
    case "down":
    case "j":
      state.selectNext()
      break
    case "return":
      focusTerminal(state.selectedInstance)
      break
    case "q":
      process.exit(0)
  }
})

function focusTerminal(instance) {
  // macOS: use AppleScript to focus terminal with matching directory
  if (process.platform === "darwin") {
    exec(`osascript -e 'tell app "Terminal" to activate'`)
  }
}
```

### 5. HTTP Server for Hooks (`server.ts`)

```typescript
import { createServer } from "http"
import { state } from "./state"

export function startServer(port = 3456) {
  const server = createServer((req, res) => {
    if (req.method === "POST" && req.url === "/hook") {
      let body = ""
      req.on("data", chunk => body += chunk)
      req.on("end", () => {
        const event = JSON.parse(body)
        state.handleHook(event)
        res.writeHead(200)
        res.end("ok")
      })
    } else {
      res.writeHead(404)
      res.end()
    }
  })

  server.listen(port)
  return server
}
```

## State Management (`state.ts`)

```typescript
type Instance = {
  id: string
  projectName: string
  workingDirectory: string
  status: "idle" | "working" | "waiting_input" | "waiting_permission"
  activity: string
  lastSeen: Date
}

class State {
  instances = new Map<string, Instance>()
  selectedIndex = 0
  listeners = new Set<() => void>()

  handleHook(event: HookEvent) {
    const id = event.cwd // Use working directory as instance ID

    let instance = this.instances.get(id)
    if (!instance) {
      instance = {
        id,
        projectName: id.split("/").pop(),
        workingDirectory: id,
        status: "idle",
        activity: "",
        lastSeen: new Date(),
      }
      this.instances.set(id, instance)
    }

    // Update based on event type
    switch (event.event) {
      case "tool_start":
        instance.status = "working"
        instance.activity = `${event.tool}`
        break
      case "tool_end":
        instance.status = "idle"
        instance.activity = ""
        break
      case "notification":
        if (event.message.includes("permission")) {
          instance.status = "waiting_permission"
        }
        instance.activity = event.message
        break
    }

    instance.lastSeen = new Date()
    this.notify()
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn)
  }

  notify() {
    for (const fn of this.listeners) fn()
  }
}

export const state = new State()
```

## Entry Point (`index.ts`)

```typescript
import { createApp } from "./ui/app"
import { startServer } from "./server"

async function main() {
  // Start HTTP server for hooks
  startServer(3456)

  // Create and run TUI
  const app = await createApp()

  console.clear()
  console.log("Agent Manager running. Configure hooks in ~/.claude/settings.json")
  console.log("Press q to quit.\n")
}

main()
```

## Claude Code Hooks Config

Add to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "",
        "hooks": ["curl -s -X POST http://localhost:3456/hook -H 'Content-Type: application/json' -d '{\"event\":\"tool_start\",\"tool\":\"$CLAUDE_TOOL_NAME\",\"cwd\":\"'\"$PWD\"'\"}'"]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "",
        "hooks": ["curl -s -X POST http://localhost:3456/hook -H 'Content-Type: application/json' -d '{\"event\":\"tool_end\",\"tool\":\"$CLAUDE_TOOL_NAME\",\"cwd\":\"'\"$PWD\"'\"}'"]
      }
    ]
  }
}
```

## Summary

| Aspect | Details |
|--------|---------|
| **Runtime** | Bun |
| **UI Framework** | OpenTUI |
| **Context overhead** | 0 tokens |
| **Lines of code** | ~300 |
| **Install** | `npx agent-manager` |
| **Respond to prompts** | In terminal (not in TUI) |
