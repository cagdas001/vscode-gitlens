import { ChildProcess, spawn } from 'child_process';
import * as ipc from 'node-ipc';
import * as path from 'path';
import { commands } from 'vscode';
import { GitCommit } from '../git/git';
import { Comment, GitCommentService } from '../gitCommentService';
import { operationTypes, commentApp } from './addLineComments';
import { Commands } from './common';

// This holds the text that user enters in the editor
export let dataPayload: string;
// holds the max allowed window number, if it's 1, you will not be allowed to run second window
export let maxWindowAllowed = 1;
// holds the count of running apps
export let runningAppCount = 0;
export let exceedsMaxWindowWarningMessage = `It's not allowed to run more than ${maxWindowAllowed} window(s)`;
let currentProcess: ChildProcess;

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

    // if (currentProcess) {
    //     currentProcess.kill();
    // }

    const spawnEnvironment = JSON.parse(JSON.stringify(process.env));
    delete spawnEnvironment.ATOM_SHELL_INTERNAL_RUN_AS_NODE;
    delete spawnEnvironment.ELECTRON_RUN_AS_NODE;
    spawnEnvironment.ELECTRON_NO_ATTACH_CONSOLE = true;

    const electronExecutable = process.platform === 'win32' ? 'electron.cmd' : 'electron';
    const electronPath = path.join(__dirname, '/../node_modules', '.bin', electronExecutable);

    const appPath = path.join(__dirname, appName);

    const app = spawn(electronPath, [appPath], { stdio: ['ipc', 'pipe', 'pipe'], env: spawnEnvironment });

    app.stdout.on('data', data => {
    });

    app.stderr.on('data', data => {
    });

    app.on('close', code => {
    });

    currentProcess = app;
    return app;
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

const ipcForCommentViewer = new ipc.IPC();
/**
 * Initialize comment to show on the electron app
 * @param comments: Comments to show.
 */
export function initComment(comments: Comment[]) {
    // setting up the IPC for communication

    ipcForCommentViewer.config.id = 'vscode-comment-viewer';
    ipcForCommentViewer.config.retry = 1000;
    ipcForCommentViewer.connectTo('bitbucketCommentViewerApp', function() {
        ipcForCommentViewer.of.bitbucketCommentViewerApp.on('connect', function() {
            ipcForCommentViewer.log('connected...');
            ipcForCommentViewer.of.bitbucketCommentViewerApp.emit('app.message', {
                id: ipcForCommentViewer.config.id,
                command: 'connected'
            });
        });
        ipcForCommentViewer.of.bitbucketCommentViewerApp.on('app.message', function(data: any) {
            if (data.command === 'reply.comment') {
                const comment = data.payload;

                commands.executeCommand(Commands.AddLineComment, {
                    line: +comment.Line,
                    fileName: comment.Path,
                    id: +comment.Id,
                    commit: comment.Commit as GitCommit,
                    message: comment.Message,
                    type: operationTypes.Reply
                });
            }
            else if (data.command === 'edit.comment') {
                const comment = data.payload;
                commands.executeCommand(Commands.AddLineComment, {
                    line: +comment.Line,
                    fileName: comment.Path,
                    id: +comment.Id,
                    commit: comment.Commit as GitCommit,
                    message: comment.Message,
                    type: operationTypes.Edit
                });
            }
            else if (data.command === 'delete.comment') {
                const comment = data.payload;
                commands.executeCommand(Commands.AddLineComment, {
                    line: +comment.Line,
                    fileName: comment.Path,
                    id: +comment.Id,
                    commit: comment.Commit as GitCommit,
                    message: comment.Message,
                    type: operationTypes.Delete
                });
            }
            else if (data.command === 'add.comment') {
                commands.executeCommand(Commands.AddLineComment,
                    {
                        fileName: GitCommentService.commentViewerFilename,
                        commit: GitCommentService.commentViewerCommit,
                        line: GitCommentService.commentViewerLine !== -1 ? GitCommentService.commentViewerLine : undefined
                    }
                );
            }
            else if (data.command === 'ui.ready' && comments) {
                // ui is ready, init the markdown editor with initText
                ipcForCommentViewer.of.bitbucketCommentViewerApp.emit('app.message', {
                    id: ipcForCommentViewer.config.id,
                    command: 'init.editor',
                    payload: comments
                });
            }
            else if (data.command === 'close') {
                ipcForCommentViewer.disconnect('bitbucketCommentViewerApp');
                if (commentApp && commentApp.isRunning()) {
                    commentApp.close();
                }
            }
        });
    });
}

/**
 * Show comment on running comment viewer app
 * @param comments: Comments to show.
 */
export function showComment(comments: Comment[]) {
    ipcForCommentViewer.of.bitbucketCommentViewerApp.emit('app.message', {
        id: ipcForCommentViewer.config.id,
        command: 'init.editor',
        payload: comments
    });
}
