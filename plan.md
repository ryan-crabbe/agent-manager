# Agent Manager

A simple Electron app to manage multiple Claude Code CLI instances from a single dashboard.

## Problem

When running multiple Claude Code instances across different terminal windows, it's difficult to:
- Track which instances need input/permissions
- Switch between windows to respond
- See overall status at a glance

## Solution

A centralized dashboard that aggregates all Claude Code instances and surfaces pending requests in one place.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Electron App                         │
│  ┌───────────────────────────────────────────────────┐  │
│  │              React Frontend                       │  │
│  │  - Instance list (sidebar)                        │  │
│  │  - Pending requests queue                         │  │
│  │  - Live output viewer                             │  │
│  │  - Quick response input                           │  │
│  └───────────────────────────────────────────────────┘  │
│                         │                               │
│                    IPC Bridge                           │
│                         │                               │
│  ┌───────────────────────────────────────────────────┐  │
│  │              MCP Server (embedded)                │  │
│  │  - Runs on localhost:3456                         │  │
│  │  - Exposes tools for Claude instances to call     │  │
│  │  - Tracks connected instances                     │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
                          │
            ┌─────────────┼─────────────┐
            │             │             │
            ▼             ▼             ▼
     ┌──────────┐  ┌──────────┐  ┌──────────┐
     │ Claude 1 │  │ Claude 2 │  │ Claude 3 │
     │ (term 1) │  │ (term 2) │  │ (term 3) │
     └──────────┘  └──────────┘  └──────────┘
```

## MCP Server Design

The MCP server exposes these tools that Claude Code instances call:

### Tools

1. **register_instance**
   - Called when a Claude session starts
   - Params: `instance_id`, `working_directory`, `project_name`
   - Returns: confirmation

2. **report_status**
   - Called periodically or on state change
   - Params: `instance_id`, `status` (idle|working|waiting_input|waiting_permission)
   - Returns: confirmation

3. **request_input**
   - Called when Claude needs user feedback
   - Params: `instance_id`, `prompt`, `options[]`, `request_type` (permission|question|confirmation)
   - Returns: user's response (blocks until user responds in Electron app)

4. **send_output**
   - Called to stream output to the dashboard
   - Params: `instance_id`, `content`, `content_type` (text|code|error)
   - Returns: confirmation

5. **unregister_instance**
   - Called when session ends
   - Params: `instance_id`

## Electron App Features

### MVP (v0.1)

1. **Instance List**
   - Shows all connected Claude instances
   - Status indicator (green=idle, yellow=working, red=needs attention)
   - Working directory / project name

2. **Pending Requests Queue**
   - List of all instances waiting for input
   - Request type badge (permission, question, etc.)
   - Preview of what's being asked
   - Quick action buttons (approve/deny for permissions)

3. **Instance Detail View**
   - Click an instance to see recent output
   - Text input to send responses
   - Button to open terminal window (focus)

### Future (v0.2+)

- Keyboard shortcuts for quick responses
- Notification system (system tray alerts)
- Request templates / auto-approve rules
- Session history / logs
- Multi-select batch approve

## Tech Stack

- **Electron** - Desktop app framework
- **React** - Frontend UI
- **Tailwind CSS** - Styling
- **MCP SDK** - `@modelcontextprotocol/sdk` for server implementation
- **WebSocket** - Real-time communication between MCP server and frontend

## File Structure

```
agent-manager/
├── package.json
├── electron.vite.config.ts
├── src/
│   ├── main/              # Electron main process
│   │   ├── index.ts       # Main entry, window management
│   │   └── mcp-server.ts  # Embedded MCP server
│   ├── preload/
│   │   └── index.ts       # IPC bridge
│   └── renderer/          # React frontend
│       ├── index.html
│       ├── main.tsx
│       ├── App.tsx
│       ├── components/
│       │   ├── InstanceList.tsx
│       │   ├── PendingQueue.tsx
│       │   └── InstanceDetail.tsx
│       └── stores/
│           └── instances.ts  # State management
├── mcp-server/            # Standalone MCP server (for testing)
│   ├── package.json
│   └── index.ts
└── plan.md
```

## How Users Configure Claude Code

Users add the MCP server to their Claude Code config (`~/.claude/settings.json`):

```json
{
  "mcpServers": {
    "agent-manager": {
      "type": "http",
      "url": "http://localhost:3456/mcp"
    }
  }
}
```

Or per-project in `.mcp.json`:

```json
{
  "mcpServers": {
    "agent-manager": {
      "type": "http",
      "url": "http://localhost:3456/mcp"
    }
  }
}
```

## Epics, Tasks & Subtasks

---

### Epic 1: MCP Server Foundation

Build a standalone MCP server that Claude Code instances can connect to.

#### Task 1.1: Project Setup
- [ ] Initialize npm project with TypeScript
- [ ] Install dependencies (`@modelcontextprotocol/sdk`, `express`, `ws`)
- [ ] Configure tsconfig.json for Node.js
- [ ] Set up build scripts

#### Task 1.2: Basic HTTP Server
- [ ] Create Express server on port 3456
- [ ] Add health check endpoint (`GET /health`)
- [ ] Add CORS configuration for local development
- [ ] Test server starts and responds

#### Task 1.3: MCP Protocol Integration
- [ ] Initialize MCP server with SDK
- [ ] Configure SSE transport for HTTP
- [ ] Mount MCP handler at `/mcp` endpoint
- [ ] Verify MCP handshake works

#### Task 1.4: Instance Registry
- [ ] Create in-memory store for connected instances
- [ ] Implement `register_instance` tool
  - [ ] Generate unique ID if not provided
  - [ ] Store instance metadata (directory, project name, timestamp)
  - [ ] Return registration confirmation
- [ ] Implement `unregister_instance` tool
  - [ ] Remove instance from store
  - [ ] Clean up any pending requests

#### Task 1.5: Status Reporting
- [ ] Implement `report_status` tool
  - [ ] Validate status enum (idle|working|waiting_input|waiting_permission)
  - [ ] Update instance record
  - [ ] Emit status change event

#### Task 1.6: Request/Response System
- [ ] Create pending requests queue (Map of request_id -> Promise resolver)
- [ ] Implement `request_input` tool
  - [ ] Create pending request with unique ID
  - [ ] Store request details (prompt, options, type)
  - [ ] Return Promise that blocks until response received
  - [ ] Add timeout handling (optional)
- [ ] Create REST endpoint to submit responses (`POST /respond/:request_id`)
- [ ] Wire response endpoint to resolve pending Promise

#### Task 1.7: Output Streaming
- [ ] Implement `send_output` tool
  - [ ] Store recent output per instance (ring buffer, last 100 lines)
  - [ ] Emit output event for real-time subscribers

#### Task 1.8: WebSocket Events
- [ ] Add WebSocket server for real-time updates
- [ ] Emit events: `instance:connected`, `instance:disconnected`, `instance:status`, `instance:request`, `instance:output`
- [ ] Handle client subscriptions

#### Task 1.9: Testing
- [ ] Manual test with Claude Code instance
- [ ] Verify register/unregister flow
- [ ] Verify request_input blocks and resolves correctly
- [ ] Test multiple simultaneous instances

---

### Epic 2: Electron Application Shell

Set up the Electron app structure with embedded MCP server.

#### Task 2.1: Electron Project Setup
- [ ] Initialize with electron-vite template
- [ ] Configure for React + TypeScript
- [ ] Set up Tailwind CSS
- [ ] Verify dev mode works (`npm run dev`)

#### Task 2.2: Window Configuration
- [ ] Configure main window (1200x800, resizable)
- [ ] Set app title and icon
- [ ] Configure window to stay on top (optional toggle)
- [ ] Handle window close (minimize to tray vs quit)

#### Task 2.3: Embed MCP Server
- [ ] Import MCP server module into main process
- [ ] Start server on app ready
- [ ] Stop server on app quit
- [ ] Handle port conflicts gracefully

#### Task 2.4: IPC Bridge
- [ ] Define IPC channels:
  - [ ] `instances:list` - get all instances
  - [ ] `instances:subscribe` - subscribe to updates
  - [ ] `requests:list` - get pending requests
  - [ ] `requests:respond` - submit response
- [ ] Create preload script exposing safe API
- [ ] Type definitions for IPC API

#### Task 2.5: WebSocket Client in Renderer
- [ ] Connect to embedded WS server from renderer
- [ ] Handle reconnection on disconnect
- [ ] Parse and dispatch events to state store

---

### Epic 3: Frontend UI Components

Build the React frontend for the dashboard.

#### Task 3.1: State Management
- [ ] Set up Zustand store (or similar)
- [ ] Define state shape:
  ```ts
  {
    instances: Map<id, Instance>
    pendingRequests: Map<id, Request>
    selectedInstanceId: string | null
  }
  ```
- [ ] Actions: addInstance, removeInstance, updateStatus, addRequest, removeRequest, selectInstance

#### Task 3.2: Layout Structure
- [ ] Create main layout (sidebar + main content)
- [ ] Sidebar: instance list (fixed width ~250px)
- [ ] Main area: split between pending queue and detail view
- [ ] Responsive considerations (minimum width)

#### Task 3.3: Instance List Component
- [ ] List item showing:
  - [ ] Status indicator dot (color-coded)
  - [ ] Project name (bold)
  - [ ] Working directory (truncated path)
  - [ ] Time since last activity
- [ ] Click to select instance
- [ ] Visual highlight for selected
- [ ] Badge count for pending requests per instance

#### Task 3.4: Pending Requests Queue
- [ ] Card for each pending request showing:
  - [ ] Instance name/project
  - [ ] Request type badge (permission/question/confirmation)
  - [ ] Prompt text (first 2 lines, expandable)
  - [ ] Options as buttons (if provided)
  - [ ] Free-text input (for questions)
  - [ ] Timestamp
- [ ] Sort by oldest first (FIFO)
- [ ] Quick action: Approve/Deny buttons for permissions
- [ ] Submit handler calls IPC to respond

#### Task 3.5: Instance Detail View
- [ ] Header with instance info
- [ ] Output log (scrollable, auto-scroll to bottom)
  - [ ] Syntax highlighting for code blocks
  - [ ] Error styling (red)
- [ ] Input area at bottom
  - [ ] Text input for sending messages
  - [ ] Submit button
- [ ] Empty state when no instance selected

#### Task 3.6: Styling & Polish
- [ ] Dark theme (default)
- [ ] Consistent color palette
- [ ] Loading states
- [ ] Empty states
- [ ] Error states

---

### Epic 4: Integration & Testing

Connect all pieces and verify end-to-end functionality.

#### Task 4.1: End-to-End Flow
- [ ] Start Electron app
- [ ] Configure Claude Code to use MCP server
- [ ] Start Claude Code session
- [ ] Verify instance appears in dashboard
- [ ] Trigger permission request in Claude
- [ ] Respond via dashboard
- [ ] Verify Claude receives response

#### Task 4.2: Multi-Instance Testing
- [ ] Run 3+ Claude instances simultaneously
- [ ] Verify all appear in dashboard
- [ ] Respond to requests from different instances
- [ ] Verify no cross-talk or race conditions

#### Task 4.3: Error Handling
- [ ] Handle MCP server crash/restart
- [ ] Handle instance disconnect (network issue)
- [ ] Handle malformed requests
- [ ] User-friendly error messages

#### Task 4.4: Documentation
- [ ] README with setup instructions
- [ ] How to configure Claude Code
- [ ] Screenshots/demo GIF
- [ ] Troubleshooting guide

---

### Epic 5: Polish & Distribution (Future)

Nice-to-haves for v0.2+.

#### Task 5.1: System Tray
- [ ] Minimize to tray
- [ ] Tray icon with badge for pending count
- [ ] Right-click menu (Show, Quit)
- [ ] Click to restore window

#### Task 5.2: Notifications
- [ ] OS notification when new request arrives
- [ ] Configurable notification settings
- [ ] Sound option

#### Task 5.3: Keyboard Shortcuts
- [ ] Global shortcut to show/hide app
- [ ] Navigate requests with arrow keys
- [ ] Enter to approve, Escape to deny
- [ ] Number keys to select options

#### Task 5.4: Auto-Approve Rules
- [ ] Define rules (e.g., "auto-approve file reads")
- [ ] Rules editor UI
- [ ] Persist rules to config file

#### Task 5.5: Build & Distribution
- [ ] Configure electron-builder
- [ ] macOS DMG build
- [ ] Windows installer
- [ ] Linux AppImage
- [ ] Auto-update mechanism

---

## Task Summary

| Epic | Tasks | Priority |
|------|-------|----------|
| 1. MCP Server Foundation | 9 tasks | P0 - Must have |
| 2. Electron Shell | 5 tasks | P0 - Must have |
| 3. Frontend UI | 6 tasks | P0 - Must have |
| 4. Integration & Testing | 4 tasks | P0 - Must have |
| 5. Polish & Distribution | 5 tasks | P1 - Nice to have |

**Total MVP Tasks: 24**
**Total Future Tasks: 5**

## Open Questions

1. Should the MCP server be embedded or standalone?
   - Embedded: simpler deployment, single app
   - Standalone: can run without Electron, more flexible

2. How to handle instance discovery?
   - Option A: Claude instances register themselves (requires MCP config)
   - Option B: Scan for running Claude processes (hacky, limited)
   - **Recommendation: Option A**

3. Persistence - should we save session history?
   - Start with no persistence, add later if needed
