import { ChildProcess, spawn } from 'child_process';
import { EventEmitter } from 'events';
import * as ipc from 'node-ipc';
import * as path from 'path';
import { workspace } from 'vscode';
import { ElectronProcess } from './commentAppHelper';

// holds the max allowed window number, if it's 1, you will not be allowed to run second window
export const maxWindowAllowed = 1;
// message will be shown to user if running a new one exceeds maxWindowAllowed
export const exceedsMaxWindowWarningMessage = `It's not allowed to run more than ${maxWindowAllowed} window(s)`;
/**
 * Map of the running apps
 * Key: string = connectionString
 * Value: ExternalApp = instance of this class
 */
export const runningInstances: Map<string, ExternalApp> = new Map<string, ExternalApp>();
export class ExternalApp {
    protected eventEmitter: EventEmitter;
    // arguments will be passed to hostCmd
    // ex. arguments that electron executable takes, the path of the app folder
    protected args: string[] = [];
    // the command will be executed.
    // ex. electron executable's path
    protected hostCmd: string;
    // specifies whether the spawned app will be exited or not (for quick response)
    // If false, app quits directly when user closed and it needs to be re-opened again
    // If true, the app just minimizes/hides itself when user closed.
    protected keepOpen: boolean = false;
    // spawned process
    protected childProcess: ChildProcess | undefined;
    // If the app is an electron app and needs to be integrated with VSCode, use this.
    protected useElectronSpecificConf: boolean = true;
    // this is an unique identifier for each instance/process. it's needed for node-ipc connection.
    // an unique value with timestamp will be assigned on constructor
    // and this value will passed as command line argument to external app
    // (so it can set up connection with this value)
    protected connectionString: string;
    // a more readable name for the app
    protected connectionStringPrefix: string;
    protected running: boolean = false;

    constructor(
        hostCmd: string,
        arg: string,
        eventEmitter: EventEmitter,
        connectionStringPrefix: string = 'bitBucketCommentApp'
    ) {
        this.args.push(arg);
        this.hostCmd = hostCmd;
        this.connectionStringPrefix = connectionStringPrefix;
        const timestamp = Date.now();
        this.connectionString = `${this.connectionStringPrefix}_${timestamp}`;
        this.args.push(this.connectionString);
        this.eventEmitter = eventEmitter;
        this.keepOpen = workspace.getConfiguration().get('gitlens.externalApp.keepOpen') as boolean;
    }

    /**
     * This function spawns a process with given hostCmd and arguments.
     * Assigns the spawned process to this.childProcess,
     * also adds it to the runningInstancesMap.
     *
     * In case of you're spawning an electron app,
     * Some environment variables need deleted for the app to run with VSCode
     * You can easily do this by setting this.useElectronSpecificConf to true.
     */
    public run() {
        const spawnEnvironment = JSON.parse(JSON.stringify(process.env));
        if (this.useElectronSpecificConf) {
            delete spawnEnvironment.ATOM_SHELL_INTERNAL_RUN_AS_NODE;
            delete spawnEnvironment.ELECTRON_RUN_AS_NODE;
            spawnEnvironment.ELECTRON_NO_ATTACH_CONSOLE = true;
        }

        this.childProcess = spawn(this.hostCmd, this.args, { stdio: ['ipc', 'pipe'], env: spawnEnvironment });
        runningInstances.set(this.connectionString, this);
        this.running = true;
        ElectronProcess.currentProcess.push(this.childProcess);

        this.childProcess.on('exit', this.onExit.bind(this));
    }

    /**
     * This function sets up required connection & configuration
     * for the VSCode and external app to communicate each other.
     */
    public setUpConnection() {
        const self = this;
        const connectionString = this.connectionString;
        // setting up the IPC for communication
        ipc.config.id = 'vscode';
        ipc.config.retry = 1000;
        ipc.config.stopRetrying = false;
        ipc.connectTo(connectionString, function() {
            ipc.of[connectionString].on('connect', function() {
                ipc.log(`connected to ${connectionString}`);
                self.sendMessage('connected');
            });
            ipc.of[connectionString].on('app.message', function(data: any) {
                const message = JSON.stringify(data);
                self.eventEmitter.emit('vscode.app.message', message);
            });
        });
    }

    /**
     * onExit event for the childProcess.
     */
    public onExit() {
        ipc.config.stopRetrying = true;
        this.running = false;
        runningInstances.delete(this.connectionString);
        if (this.childProcess) {
            const index = ElectronProcess.currentProcess.indexOf(this.childProcess);
            if (index > -1) {
                ElectronProcess.currentProcess.splice(index, 1);
            }
        }
    }

    public quitApp() {
        this.sendMessage('exit');
    }

    /**
     * A helper function to send message to the app.
     * @param command Command name
     * @param payload The payload will be delivered in addition to command.
     */
    public sendMessage(command: string = '', payload: string = '') {
        ipc.of[this.connectionString].emit('app.message', {
            id: ipc.config.id,
            command: command,
            payload: payload
        });
    }

    // getter & setters
    public getConnectionString() {
        return this.connectionString;
    }

    public getKeepOpen() {
        return this.keepOpen;
    }

    public setKeepOpen(keepOpen: boolean) {
        this.keepOpen = keepOpen;
    }

    public getChildProcess() {
        return this.childProcess;
    }

    public setUseElectronSpecificConf(useElectronSpecificConf: boolean) {
        this.useElectronSpecificConf = useElectronSpecificConf;
    }

    public isRunning() {
        return this.running;
    }
}

/**
 * Maximum spawnable window/process number is limited to maxWindowAllowed.
 * This function checks if it's possible to spawn a new app.
 */
export function isAllowedToRun() {
    if (runningInstances.size >= maxWindowAllowed) {
        return false;
    }
    return true;
}

/**
 * Helper function to get electron path.
 */
export function getElectronPath() {
    const electronExecutable = process.platform === 'win32' ? 'electron.cmd' : 'electron';
    const electronPath = path.join(__dirname, '/../node_modules', '.bin', electronExecutable);
    return electronPath;
}
