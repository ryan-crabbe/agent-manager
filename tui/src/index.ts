#!/usr/bin/env bun
// Agent Manager TUI - Monitor Claude Code instances

import { startServer } from "./server";
import { createUI, cleanup } from "./ui";
import { isInsideTmux } from "./tmux";

async function main() {
  console.clear();

  // Check if running inside tmux
  if (!isInsideTmux()) {
    console.log("╭─────────────────────────────────────────────────────────────╮");
    console.log("│  Tip: Run inside tmux for best experience                   │");
    console.log("│                                                             │");
    console.log("│  tmux new-session -s work                                   │");
    console.log("│  Then split panes: Ctrl+b %  or  Ctrl+b \"                   │");
    console.log("╰─────────────────────────────────────────────────────────────╯");
    console.log("");
  }

  // Start HTTP server for hooks
  startServer();

  // Small delay to let server message print first
  await new Promise(r => setTimeout(r, 100));

  console.log("");
  console.log("Configure Claude Code hooks in ~/.claude/settings.json:");
  console.log("");
  console.log(`{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "",
        "hooks": [
          "curl -s -X POST http://localhost:3456/hook -H 'Content-Type: application/json' -d '{\\"event\\":\\"tool_start\\",\\"tool\\":\\"'$CLAUDE_TOOL_NAME'\\",\\"cwd\\":\\"'$PWD'\\"}' > /dev/null"
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "",
        "hooks": [
          "curl -s -X POST http://localhost:3456/hook -H 'Content-Type: application/json' -d '{\\"event\\":\\"tool_end\\",\\"tool\\":\\"'$CLAUDE_TOOL_NAME'\\",\\"cwd\\":\\"'$PWD'\\"}' > /dev/null"
        ]
      }
    ]
  }
}`);
  console.log("");
  console.log("Starting TUI in 2 seconds... (Press Ctrl+C to cancel)");
  console.log("");

  await new Promise(r => setTimeout(r, 2000));

  // Setup cleanup handlers
  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });

  // Create and start TUI
  try {
    await createUI();
  } catch (error) {
    console.error("Failed to start TUI:", error);
    process.exit(1);
  }
}

main();
