// Test-only Electron entry point for renderer tests with a controlled IPC boundary.
const {app,BrowserWindow}=require('electron');
app.whenReady().then(()=>new BrowserWindow({show:false,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}}).loadURL('about:blank'));
app.on('window-all-closed',()=>app.quit());
