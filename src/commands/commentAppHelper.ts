import { spawn } from 'child_process';
import * as ipc from 'node-ipc';
import * as path from 'path';

// This holds the text that user enters in the editor
export let dataPayload: string;
// holds the max allowed window number, if it's 1, you will not be allowed to run second window
export let maxWindowAllowed = 1;
// holds the count of running apps
export let runningAppCount = 0;
export let exceedsMaxWindowWarningMessage = `It's not allowed to run more than ${maxWindowAllowed} window(s)`;

/**
 * Sets the runningAppCount value to the given num
 * @param num The new value to be assigned
 */
export function setRunningAppCount(num: number) {
    runningAppCount = num;
}

/**
 * Clear the payload on exit
 */
export function clearPayload() {
    dataPayload = '';
}

/**
 * This function spawns the given electron app.
 * The folder name of the electron app must be same with the 'appName'
 * The folder must be located at the root level of out directory.
 *
 * Some environment variables are deleted for the app to run with VSCode
 * See: TODO: add stackoverflow link
 * @param appName The name of the folder containing the app
 * @returns Spawned process
 */
export function runApp(appName: string) {
    const spawnEnvironment = JSON.parse(JSON.stringify(process.env));
    delete spawnEnvironment.ATOM_SHELL_INTERNAL_RUN_AS_NODE;
    delete spawnEnvironment.ELECTRON_RUN_AS_NODE;
    spawnEnvironment.ELECTRON_NO_ATTACH_CONSOLE = true;

    const electronExecutable = process.platform === 'win32' ? 'electron.cmd' : 'electron';
    const electronPath = path.join(__dirname, '/../node_modules', '.bin', electronExecutable);

    const appPath = path.join(__dirname, appName);

    // increasing the runningAppCount by 1
    runningAppCount += 1;
    return spawn(electronPath, [appPath], { stdio: ['ipc', 'pipe', 'pipe'], env: spawnEnvironment });
}

/**
 * This function sets up required connection & configuration
 * for the VSCode and external Electron app to communicate each other.
 *
 * If initText is empty, the markdown editor comes out empty. (this is the case for new comment)
 * If it's not, the markdown editor comes out with the initText. (the case of editing a comment)
 * It's an empty string default.
 *
 * Updates the dataPayload upon getting 'save.comment' message from the electron app
 *
 * @param initText: The editor initilizes with this text.
 */
export function getComment(initText: string = '') {
    // setting up the IPC for communication
    ipc.config.id = 'vscode';
    ipc.config.retry = 1000;
    ipc.connectToNet('bitbucketCommentApp', function() {
        ipc.of.bitbucketCommentApp.on('connect', function() {
            ipc.log('connected...');
            ipc.of.bitbucketCommentApp.emit('app.message', {
                id: ipc.config.id,
                command: 'connected'
            });
        });
        ipc.of.bitbucketCommentApp.on('app.message', function(data: any) {
            if (data.command === 'save.comment') {
                dataPayload = data.payload;
            }
            else if (data.command === 'ui.ready' && initText) {
                // ui is ready, init the markdown editor with initText
                ipc.of.bitbucketCommentApp.emit('app.message', {
                    id: ipc.config.id,
                    command: 'init.editor',
                    payload: initText
                });
            }
            else if (data.command === 'close') {
                ipc.disconnect('bitbucketCommentApp');
            }
        });
    });
}
