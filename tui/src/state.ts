// State management for Claude instances

export type InstanceStatus = "idle" | "working" | "waiting_input" | "waiting_permission";

export interface Instance {
  id: string;
  projectName: string;
  workingDirectory: string;
  status: InstanceStatus;
  activity: string;
  lastSeen: Date;
  tmuxPane?: string;
}

export interface HookEvent {
  event: "tool_start" | "tool_end" | "notification" | "session_start" | "session_end";
  tool?: string;
  message?: string;
  cwd: string;
  tmux_pane?: string;
}

type Listener = () => void;

class State {
  instances = new Map<string, Instance>();
  selectedIndex = 0;
  private listeners = new Set<Listener>();

  get instanceList(): Instance[] {
    return Array.from(this.instances.values()).sort((a, b) => {
      // Sort by status priority (waiting first), then by name
      const statusPriority: Record<InstanceStatus, number> = {
        waiting_permission: 0,
        waiting_input: 1,
        working: 2,
        idle: 3,
      };
      const priorityDiff = statusPriority[a.status] - statusPriority[b.status];
      if (priorityDiff !== 0) return priorityDiff;
      return a.projectName.localeCompare(b.projectName);
    });
  }

  get selectedInstance(): Instance | undefined {
    return this.instanceList[this.selectedIndex];
  }

  handleHook(event: HookEvent): void {
    const id = event.cwd;

    let instance = this.instances.get(id);
    if (!instance) {
      instance = {
        id,
        projectName: id.split("/").pop() || id,
        workingDirectory: id,
        status: "idle",
        activity: "",
        lastSeen: new Date(),
        tmuxPane: event.tmux_pane,
      };
      this.instances.set(id, instance);
    }

    // Update tmux pane if provided
    if (event.tmux_pane) {
      instance.tmuxPane = event.tmux_pane;
    }

    // Update based on event type
    switch (event.event) {
      case "tool_start":
        instance.status = "working";
        instance.activity = event.tool || "";
        break;

      case "tool_end":
        instance.status = "idle";
        instance.activity = "";
        break;

      case "notification":
        const msg = event.message?.toLowerCase() || "";
        if (msg.includes("permission") || msg.includes("allow")) {
          instance.status = "waiting_permission";
        } else if (msg.includes("input") || msg.includes("question")) {
          instance.status = "waiting_input";
        }
        instance.activity = event.message || "";
        break;

      case "session_start":
        instance.status = "idle";
        instance.activity = "Session started";
        break;

      case "session_end":
        this.instances.delete(id);
        break;
    }

    instance.lastSeen = new Date();
    this.notify();
  }

  selectNext(): void {
    if (this.instanceList.length > 0) {
      this.selectedIndex = (this.selectedIndex + 1) % this.instanceList.length;
      this.notify();
    }
  }

  selectPrevious(): void {
    if (this.instanceList.length > 0) {
      this.selectedIndex = (this.selectedIndex - 1 + this.instanceList.length) % this.instanceList.length;
      this.notify();
    }
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    for (const fn of this.listeners) {
      fn();
    }
  }

  // Clean up stale instances (no activity for 10 minutes)
  cleanupStale(): void {
    const now = Date.now();
    const staleThreshold = 10 * 60 * 1000; // 10 minutes

    for (const [id, instance] of this.instances) {
      if (now - instance.lastSeen.getTime() > staleThreshold) {
        this.instances.delete(id);
      }
    }
    this.notify();
  }
}

export const state = new State();

// Run cleanup every minute
setInterval(() => state.cleanupStale(), 60000);
