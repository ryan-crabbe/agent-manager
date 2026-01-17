// TUI components using OpenTUI

import {
  createCliRenderer,
  BoxRenderable,
  TextRenderable,
  type CliRenderer,
} from "@opentui/core";
import { state, type Instance, type InstanceStatus } from "./state";
import { focusInstance, isInsideTmux } from "./tmux";

const STATUS_COLORS: Record<InstanceStatus, string> = {
  idle: "#22c55e",           // green
  working: "#3b82f6",        // blue
  waiting_input: "#eab308",  // yellow
  waiting_permission: "#ef4444", // red
};

const STATUS_ICONS: Record<InstanceStatus, string> = {
  idle: "○",
  working: "●",
  waiting_input: "◉",
  waiting_permission: "◉",
};

let renderer: CliRenderer;
let instanceListContainer: BoxRenderable;

export async function createUI(): Promise<CliRenderer> {
  renderer = await createCliRenderer();

  // Root container
  const root = new BoxRenderable(renderer, {
    id: "root",
    flexDirection: "column",
    width: "100%",
    height: "100%",
  });

  // Header
  const header = createHeader();
  root.add(header);

  // Instance list container
  instanceListContainer = new BoxRenderable(renderer, {
    id: "instance-list",
    flexDirection: "column",
    flexGrow: 1,
    padding: { top: 1, bottom: 1, left: 2, right: 2 },
  });
  root.add(instanceListContainer);

  // Footer
  const footer = createFooter();
  root.add(footer);

  renderer.root.add(root);

  // Subscribe to state changes
  state.subscribe(() => renderInstanceList());

  // Initial render
  renderInstanceList();

  // Setup keyboard handling
  setupKeyboard();

  return renderer;
}

function createHeader(): BoxRenderable {
  const header = new BoxRenderable(renderer, {
    id: "header",
    flexDirection: "row",
    padding: { left: 2, right: 2, top: 1, bottom: 1 },
    borderBottom: { style: "single", color: "#404040" },
  });

  const title = new TextRenderable(renderer, {
    id: "title",
    content: "Agent Manager",
    bold: true,
    color: "#ffffff",
  });

  const spacer = new BoxRenderable(renderer, {
    id: "spacer",
    flexGrow: 1,
  });

  const instanceCount = new TextRenderable(renderer, {
    id: "instance-count",
    content: "",
    color: "#666666",
  });

  header.add(title);
  header.add(spacer);
  header.add(instanceCount);

  // Update instance count on state change
  state.subscribe(() => {
    const count = state.instances.size;
    instanceCount.content = count > 0 ? `${count} instance${count === 1 ? "" : "s"}` : "No instances";
    renderer.requestRender();
  });

  return header;
}

function createFooter(): BoxRenderable {
  const footer = new BoxRenderable(renderer, {
    id: "footer",
    flexDirection: "row",
    padding: { left: 2, right: 2, top: 1, bottom: 1 },
    borderTop: { style: "single", color: "#404040" },
  });

  const tmuxHint = isInsideTmux() ? "  Enter focus" : "";
  const help = new TextRenderable(renderer, {
    id: "help",
    content: `j/k navigate${tmuxHint}  q quit`,
    color: "#666666",
  });

  footer.add(help);
  return footer;
}

function renderInstanceList(): void {
  // Clear existing children
  instanceListContainer.children.forEach(child => {
    instanceListContainer.remove(child);
  });

  const instances = state.instanceList;

  if (instances.length === 0) {
    const empty = new TextRenderable(renderer, {
      id: "empty",
      content: "No Claude instances detected.\n\nStart Claude with hooks configured to see instances here.",
      color: "#666666",
    });
    instanceListContainer.add(empty);
  } else {
    instances.forEach((instance, index) => {
      const card = createInstanceCard(instance, index === state.selectedIndex);
      instanceListContainer.add(card);
    });
  }

  renderer.requestRender();
}

function createInstanceCard(instance: Instance, isSelected: boolean): BoxRenderable {
  const card = new BoxRenderable(renderer, {
    id: `instance-${instance.id}`,
    flexDirection: "column",
    marginBottom: 1,
    padding: { left: 1, right: 1 },
    border: isSelected
      ? { style: "single", color: "#3b82f6" }
      : { style: "single", color: "#404040" },
    backgroundColor: isSelected ? "#1e3a5f" : undefined,
  });

  // Row 1: Status icon + project name + status label
  const row1 = new BoxRenderable(renderer, {
    id: `row1-${instance.id}`,
    flexDirection: "row",
  });

  const statusIcon = new TextRenderable(renderer, {
    id: `status-icon-${instance.id}`,
    content: STATUS_ICONS[instance.status] + " ",
    color: STATUS_COLORS[instance.status],
  });

  const projectName = new TextRenderable(renderer, {
    id: `project-${instance.id}`,
    content: instance.projectName,
    bold: true,
    color: "#ffffff",
  });

  const spacer = new BoxRenderable(renderer, {
    id: `spacer-${instance.id}`,
    flexGrow: 1,
  });

  const statusLabel = new TextRenderable(renderer, {
    id: `status-${instance.id}`,
    content: instance.status.toUpperCase().replace("_", " "),
    color: STATUS_COLORS[instance.status],
  });

  row1.add(statusIcon);
  row1.add(projectName);
  row1.add(spacer);
  row1.add(statusLabel);

  // Row 2: Activity or path
  const row2Text = instance.activity || instance.workingDirectory;
  const row2 = new TextRenderable(renderer, {
    id: `row2-${instance.id}`,
    content: truncate(row2Text, 60),
    color: "#888888",
  });

  card.add(row1);
  card.add(row2);

  return card;
}

function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return "..." + str.slice(-(maxLength - 3));
}

function setupKeyboard(): void {
  process.stdin.setRawMode?.(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");

  process.stdin.on("data", (key: string) => {
    // Ctrl+C or q to quit
    if (key === "\u0003" || key === "q") {
      process.exit(0);
    }

    // j or down arrow
    if (key === "j" || key === "\u001b[B") {
      state.selectNext();
    }

    // k or up arrow
    if (key === "k" || key === "\u001b[A") {
      state.selectPrevious();
    }

    // Enter to focus
    if (key === "\r" || key === "\n") {
      const instance = state.selectedInstance;
      if (instance && isInsideTmux()) {
        focusInstance(instance);
      }
    }
  });
}

export function cleanup(): void {
  process.stdin.setRawMode?.(false);
  renderer?.destroy();
}
