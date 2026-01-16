import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';

let mainWindow: BrowserWindow | null = null;
let mcpServerProcess: ChildProcess | null = null;

const isDev = process.env.NODE_ENV !== 'production' || !app.isPackaged;

// Get the project root directory
function getProjectRoot(): string {
  if (isDev) {
    // In dev mode, we're running from electron-app/src/main
    return path.resolve(__dirname, '../../..');
  } else {
    // In production, we're running from electron-app/dist/main
    return path.resolve(__dirname, '../../..');
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'Agent Manager',
    backgroundColor: '#1a1a1a',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // Load the app
  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function startMcpServer(): void {
  const projectRoot = getProjectRoot();
  const mcpServerPath = path.join(projectRoot, 'mcp-server');
  const mcpServerEntry = path.join(mcpServerPath, 'src/index.ts');

  console.log(`[Main] Starting MCP server from: ${mcpServerPath}`);

  // Use npx tsx to run the server directly
  mcpServerProcess = spawn('npx', ['tsx', mcpServerEntry], {
    cwd: mcpServerPath,
    shell: true,
    stdio: 'pipe',
    env: { ...process.env, FORCE_COLOR: '1' },
  });

  mcpServerProcess.stdout?.on('data', (data) => {
    const output = data.toString().trim();
    if (output) console.log(`[MCP] ${output}`);
  });

  mcpServerProcess.stderr?.on('data', (data) => {
    const output = data.toString().trim();
    if (output) console.error(`[MCP] ${output}`);
  });

  mcpServerProcess.on('error', (err) => {
    console.error('[Main] Failed to start MCP server:', err.message);
  });

  mcpServerProcess.on('close', (code) => {
    console.log(`[Main] MCP server exited with code ${code}`);
    mcpServerProcess = null;
  });
}

function stopMcpServer(): void {
  if (mcpServerProcess) {
    console.log('[Main] Stopping MCP server...');
    // Kill the process tree on Windows, just the process on Unix
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', mcpServerProcess.pid!.toString(), '/f', '/t']);
    } else {
      mcpServerProcess.kill('SIGTERM');
    }
    mcpServerProcess = null;
  }
}

// IPC Handlers
ipcMain.handle('get-server-url', () => {
  return 'http://127.0.0.1:3456';
});

ipcMain.handle('get-ws-url', () => {
  return 'ws://127.0.0.1:3456/ws';
});

// App lifecycle
app.whenReady().then(() => {
  startMcpServer();

  // Give the server a moment to start
  setTimeout(createWindow, 1500);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  stopMcpServer();
});
