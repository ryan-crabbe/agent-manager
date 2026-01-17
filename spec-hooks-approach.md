# Agent Manager - Hooks-Based Approach

## Overview

A lightweight dashboard to monitor all your running Claude Code instances without any context bloat. Uses Claude Code's built-in hooks system to send notifications to a central dashboard.

## User Experience

### Setup (One-time)

1. Start the dashboard:
   ```bash
   npx agent-manager
   # or
   agent-manager  # if installed globally
   ```

2. Add hooks to your Claude Code config (`~/.claude/settings.json`):
   ```json
   {
     "hooks": {
       "PreToolUse": "curl -s -X POST http://localhost:3456/hook -d '{\"event\":\"tool_start\",\"tool\":\"$TOOL_NAME\",\"cwd\":\"$CWD\"}'",
       "PostToolUse": "curl -s -X POST http://localhost:3456/hook -d '{\"event\":\"tool_end\",\"tool\":\"$TOOL_NAME\",\"cwd\":\"$CWD\"}'",
       "Notification": "curl -s -X POST http://localhost:3456/hook -d '{\"event\":\"notification\",\"message\":\"$MESSAGE\",\"cwd\":\"$CWD\"}'"
     }
   }
   ```

That's it. No MCP config needed.

### Daily Use

1. Open dashboard in browser: `http://localhost:3456`
2. Start Claude Code sessions in any terminals as normal
3. Dashboard automatically shows:
   - All active instances (detected by hook activity)
   - What each instance is currently doing
   - When an instance needs your attention
4. Click on an instance → switches to that terminal window
5. Respond in the terminal as normal

## What You See

```
┌─────────────────────────────────────────────────────────────────┐
│  Agent Manager                                    ● 3 instances │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 🟡 agent-manager                        needs attention │   │
│  │    /Users/ryan/coding/agent-manager                     │   │
│  │    Waiting for permission: Edit src/index.ts            │   │
│  │                                        [Focus Terminal] │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 🟢 website                                       working │   │
│  │    /Users/ryan/coding/website                           │   │
│  │    Running: Bash (npm test)                             │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 🟢 api-server                                      idle │   │
│  │    /Users/ryan/coding/api-server                        │   │
│  │    Last activity: 2 min ago                             │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Features

### Core (MVP)

- **Instance list**: See all active Claude instances at a glance
- **Status indicators**:
  - 🟢 Green = idle or working normally
  - 🟡 Yellow = waiting for input/permission
  - ⚫ Gray = no activity for 5+ minutes
- **Current activity**: What tool is running, what file is being edited
- **Focus terminal**: Click to switch to that terminal window (macOS/Linux)
- **Desktop notifications**: Optional alert when any instance needs attention

### What This Doesn't Do

- ❌ Respond to prompts from the dashboard (you respond in terminal)
- ❌ See full conversation history
- ❌ Add any context/tokens to Claude's context window

## Technical Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Dashboard                                │
│                    http://localhost:3456                         │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                    Web UI (React)                        │    │
│  │              Shows all instances + status                │    │
│  └─────────────────────────────────────────────────────────┘    │
│                            ▲                                     │
│                            │ WebSocket                           │
│                            │                                     │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │               Simple HTTP Server (Node)                  │    │
│  │         POST /hook - receives hook notifications         │    │
│  │         Tracks instances by working directory            │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                   ▲              ▲              ▲
                   │ curl         │ curl         │ curl
                   │              │              │
            ┌──────┴──────┐ ┌─────┴─────┐ ┌─────┴──────┐
            │   Claude    │ │  Claude   │ │   Claude   │
            │ (terminal1) │ │ (terminal2)│ │ (terminal3)│
            └─────────────┘ └───────────┘ └────────────┘

            Each Claude instance sends hooks via curl.
            No MCP. No context bloat. Just HTTP POSTs.
```

## Hook Events

| Event | When | Data |
|-------|------|------|
| `tool_start` | Before a tool runs | tool name, working dir |
| `tool_end` | After a tool completes | tool name, working dir, success/fail |
| `notification` | Claude shows a notification | message content |
| `session_start` | Claude Code starts | working dir, project name |
| `session_end` | Claude Code exits | working dir |

## Comparison

| | MCP Approach | Hooks Approach |
|---|---|---|
| Context overhead | ~500-1000 tokens | **0 tokens** |
| Respond from dashboard | Yes | No (respond in terminal) |
| Setup complexity | MCP config | Hooks config |
| Can block Claude | Yes | No |
| Real-time visibility | Yes | Yes |
| Works with any Claude | Needs MCP support | Just needs hooks |

## File Structure

```
agent-manager/
├── package.json
├── src/
│   ├── server.ts      # Simple Express server
│   ├── index.html     # Dashboard UI (single file, minimal)
│   └── cli.ts         # CLI entry point
└── README.md
```

## Install & Run

```bash
# Option 1: npx (no install)
npx agent-manager

# Option 2: Global install
npm install -g agent-manager
agent-manager

# Option 3: From source
git clone https://github.com/ryan-crabbe/agent-manager
cd agent-manager
npm start
```

## Summary

This is a **monitoring dashboard**, not a control panel. You see what all your Claude instances are doing, get notified when they need attention, and click to jump to the right terminal. Zero impact on Claude's context window.
