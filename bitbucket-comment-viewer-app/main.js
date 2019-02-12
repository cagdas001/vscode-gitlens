// ipcMain and ipcRenderer for Communication between electron main/renderer processes
// node-ipc for communication between electron and vscode extension host (they're independent processes)
// electron's ipc modules are not helpful to send (or receive) data to external apps
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const ipc = require('node-ipc');

// if you have any issue regarding GPU, enable this
// this will prevent some hardware issues
// to draw/render window content on linux
/*if (process.platform === 'linux') {
    app.disableHardwareAcceleration();
}*/

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let mainWindow,
    uiReady = false;

function createWindow() {
    // Create the browser window.
    mainWindow = new BrowserWindow({
        maximizable: false,
        resizeable: false,
        frame: false,
        toolbar: false,
        skipTaskbar: true,
        width: 750,
        height: 480
    });

    mainWindow.loadFile('index.html');

    // Open the DevTools.
    // mainWindow.webContents.openDevTools();

    // Emitted when the window is closed.
    mainWindow.on('closed', function() {
        mainWindow = null;
    });

    mainWindow.webContents.on('new-window', function(e, url) {
        e.preventDefault();
        shell.openExternal(url);
    });

    // node-ipc configurations
    ipc.config.id = 'bitbucketCommentViewerApp';
    ipc.config.retry = 1500;
    ipc.config.maxConnections = 1;
    let connectionSocket;
    // it's taking a bit time for the app to be ready
    // we have to wait for the app to be ready for some operations (like init.editor)
    ipcMain.once('ui.ready', function() {
        uiReady = true;
    });

    ipc.serve(function() {
        function sendUIReady() {
            ipc.server.emit(connectionSocket, 'app.message', {
                id: ipc.config.id,
                command: 'ui.ready'
            });
        }
        ipc.server.on('app.message', function(data, socket) {
            connectionSocket = socket;

            if (data.command === 'connected') {
                // the ui became ready before the client connected
                // send the ready message
                if (uiReady) {
                    sendUIReady();
                } else {
                    // client connected but ui is still not ready
                    // add a listener
                    ipcMain.once('ui.ready', sendUIReady);
                }
            }

            // Init the Markdown editor with the given payload (when editing)
            if (data.command === 'init.editor') {
                mainWindow.webContents.send('init.editor', data.payload);
                mainWindow.show();
                mainWindow.focus();
            }
        });
        /**
         * Send a close message to VSCode
         * And quits the app
         */
        function close() {
            if (connectionSocket) {
                ipc.server.emit(connectionSocket, 'app.message', {
                    id: ipc.config.id,
                    command: 'close'
                });
            }
            app.quit();
        }

        ipcMain.on('reply.comment', function(event, arg) {
            // send comment to the VSCode app
            ipc.server.emit(connectionSocket, 'app.message', {
                id: ipc.config.id,
                command: 'reply.comment',
                payload: arg
            });
            // close(null, null);
        });
        ipcMain.on('edit.comment', function(event, arg) {
            // send comment to the VSCode app
            ipc.server.emit(connectionSocket, 'app.message', {
                id: ipc.config.id,
                command: 'edit.comment',
                payload: arg
            });
            // close(null, null);
        });
        ipcMain.on('delete.comment', function(event, arg) {
            // send comment to the VSCode app
            ipc.server.emit(connectionSocket, 'app.message', {
                id: ipc.config.id,
                command: 'delete.comment',
                payload: arg
            });
            // close(null, null);
        });
        ipcMain.on('add.comment', function(event, arg) {
            // send comment to the VSCode app
            ipc.server.emit(connectionSocket, 'app.message', {
                id: ipc.config.id,
                command: 'add.comment'
            });
            // close(null, null);
        });
        ipcMain.on('close', close);
    });
    ipc.server.start();
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', createWindow);

// Quit when all windows are closed.
app.on('window-all-closed', function() {
    // On OS X it is common for applications and their menu bar
    // to stay active until the user quits explicitly with Cmd + Q
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', function() {
    // On OS X it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (mainWindow === null) {
        createWindow();
    }
});
