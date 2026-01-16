import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';

let mainWindow: BrowserWindow | null = null;
let mcpServerProcess: ChildProcess | null = null;

const isDev = process.env.NODE_ENV !== 'production' || !app.isPackaged;

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
  const mcpServerPath = path.join(__dirname, '../../mcp-server');

  console.log('[Main] Starting MCP server...');

  mcpServerProcess = spawn('npm', ['run', 'dev'], {
    cwd: mcpServerPath,
    shell: true,
    stdio: 'pipe',
  });

  mcpServerProcess.stdout?.on('data', (data) => {
    console.log(`[MCP Server] ${data}`);
  });

  mcpServerProcess.stderr?.on('data', (data) => {
    console.error(`[MCP Server Error] ${data}`);
  });

  mcpServerProcess.on('close', (code) => {
    console.log(`[MCP Server] Process exited with code ${code}`);
  });
}

function stopMcpServer(): void {
  if (mcpServerProcess) {
    console.log('[Main] Stopping MCP server...');
    mcpServerProcess.kill();
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
