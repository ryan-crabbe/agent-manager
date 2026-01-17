// tmux integration for focusing panes

import { execSync, spawnSync } from "child_process";
import type { Instance } from "./state";

export function isInsideTmux(): boolean {
  return !!process.env.TMUX;
}

export function focusInstance(instance: Instance): boolean {
  if (!isInsideTmux()) {
    return false;
  }

  try {
    // If we have a specific pane ID, use it directly
    if (instance.tmuxPane) {
      execSync(`tmux select-pane -t "${instance.tmuxPane}"`, { stdio: "ignore" });
      return true;
    }

    // Otherwise, try to find a pane by working directory
    const result = spawnSync("tmux", [
      "list-panes", "-a", "-F", "#{pane_id}:#{pane_current_path}"
    ], { encoding: "utf-8" });

    if (result.status !== 0) return false;

    const lines = result.stdout.trim().split("\n");
    for (const line of lines) {
      const [paneId, panePath] = line.split(":");
      if (panePath === instance.workingDirectory) {
        execSync(`tmux select-pane -t "${paneId}"`, { stdio: "ignore" });
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}

export function getCurrentPane(): string | undefined {
  if (!isInsideTmux()) return undefined;

  try {
    const result = spawnSync("tmux", ["display-message", "-p", "#{pane_id}"], {
      encoding: "utf-8",
    });
    return result.stdout.trim();
  } catch {
    return undefined;
  }
}
