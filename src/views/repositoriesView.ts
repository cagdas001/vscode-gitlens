'use strict';
import {
    commands,
    ConfigurationChangeEvent,
    Event,
    EventEmitter,
    ViewColumn,
    window,
    workspace
} from 'vscode';
import { configuration, RepositoriesViewConfig, ViewFilesLayout, ViewsConfig } from '../configuration';
import { CommandContext, setCommandContext, WorkspaceState } from '../constants';
import { Container } from '../container';
import { GitCommentService } from '../gitCommentService';
import { RepositoriesNode } from './nodes';
import { ViewBase } from './viewBase';
import Axios, { AxiosBasicCredentials } from 'axios';

export class RepositoriesView extends ViewBase<RepositoriesNode> {
    constructor() {
        super('gitlens.views.repositories');
    }

    private _onDidChangeAutoRefresh = new EventEmitter<void>();
    public get onDidChangeAutoRefresh(): Event<void> {
        return this._onDidChangeAutoRefresh.event;
    }

    getRoot() {
        return new RepositoriesNode(this);
    }

    protected get location(): string {
        return this.config.location;
    }

    protected registerCommands() {
        void Container.viewCommands;

        commands.registerCommand(this.getQualifiedCommand('refresh'), () => this.refresh(true), this);
        commands.registerCommand(
            this.getQualifiedCommand('setFilesLayoutToAuto'),
            () => this.setFilesLayout(ViewFilesLayout.Auto),
            this
        );
        commands.registerCommand(
            this.getQualifiedCommand('setFilesLayoutToList'),
            () => this.setFilesLayout(ViewFilesLayout.List),
            this
        );
        commands.registerCommand(
            this.getQualifiedCommand('setFilesLayoutToTree'),
            () => this.setFilesLayout(ViewFilesLayout.Tree),
            this
        );

        commands.registerCommand(
            this.getQualifiedCommand('setAutoRefreshToOn'),
            () => this.setAutoRefresh(Container.config.views.repositories.autoRefresh, true),
            this
        );
        commands.registerCommand(
            this.getQualifiedCommand('setAutoRefreshToOff'),
            () => this.setAutoRefresh(Container.config.views.repositories.autoRefresh, false),
            this
        );
        commands.registerCommand(
            'gitlens.bitbucket.login',
            () => this.bitbucketLogin(),
            this
        );
        commands.registerCommand(
            'gitlens.bitbucket.logout',
            () => this.bitbucketLogout(),
            this
        );
    }

    protected onConfigurationChanged(e: ConfigurationChangeEvent) {
        if (
            !configuration.changed(e, configuration.name('views')('repositories').value) &&
            !configuration.changed(e, configuration.name('views').value) &&
            !configuration.changed(e, configuration.name('defaultGravatarsStyle').value)
        ) {
            return;
        }

        if (configuration.changed(e, configuration.name('views')('repositories')('autoRefresh').value)) {
            void this.setAutoRefresh(Container.config.views.repositories.autoRefresh);
        }

        if (configuration.changed(e, configuration.name('views')('repositories')('location').value)) {
            this.initialize(this.config.location);
        }

        if (!configuration.initializing(e) && this._root !== undefined) {
            void this.refresh(true);
        }
    }

    get autoRefresh() {
        return (
            this.config.autoRefresh &&
            Container.context.workspaceState.get<boolean>(WorkspaceState.ViewsRepositoriesAutoRefresh, true)
        );
    }

    get config(): ViewsConfig & RepositoriesViewConfig {
        return { ...Container.config.views, ...Container.config.views.repositories };
    }

    private async setAutoRefresh(enabled: boolean, workspaceEnabled?: boolean) {
        if (enabled) {
            if (workspaceEnabled === undefined) {
                workspaceEnabled = Container.context.workspaceState.get<boolean>(
                    WorkspaceState.ViewsRepositoriesAutoRefresh,
                    true
                );
            }
            else {
                await Container.context.workspaceState.update(
                    WorkspaceState.ViewsRepositoriesAutoRefresh,
                    workspaceEnabled
                );
            }
        }

        setCommandContext(CommandContext.ViewsRepositoriesAutoRefresh, enabled && workspaceEnabled);

        this._onDidChangeAutoRefresh.fire();
    }

    private setFilesLayout(layout: ViewFilesLayout) {
        return configuration.updateEffective(
            configuration.name('views')('repositories')('files')('layout').value,
            layout
        );
    }

    public bitbucketLogin(): Promise<any> {
        const panel = window.createWebviewPanel(
            'bitbucketLogin',
            'Bitbucket Login',
            ViewColumn.One,
            {
                enableScripts: true,
                enableCommandUris: true
            }
        );
        panel.webview.html = this.getWebviewContent();
        const promise = new Promise((resolve, reject) => {
            panel.webview.onDidReceiveMessage(async message => {
                console.log(message);
                const data: any = JSON.parse(message.text);
                const auth = await this.isAuthenticated(data.username!, data.password!);
                if (auth) {
                    GitCommentService.UseCredentials(data.username!, data.password!);
                    window.showInformationMessage('Login successful');
                    panel.webview.postMessage({
                        command: 'success'
                    });
                    resolve();
                    panel.dispose();
                }
                else {
                    GitCommentService.ClearCredentials();
                    window.showErrorMessage('Login failed. Check your credentials');
                }
            });
        });
        return promise;
    }
    public bitbucketLogout(): Promise<any> {
        const promise = new Promise((resolve, reject) => {
            GitCommentService.ClearCredentials();
            window.showInformationMessage('Logged out successfully.');
        });
        return promise;
    }
    private getWebviewContent() {
        return `<!DOCTYPE html>
        <html>
        <head>
            <script type="text/javascript">
                const vscode = acquireVsCodeApi();
                function get_action(form) {
                    var data = {
                        username: document.getElementsByName('username')[0].value,
                        password: document.getElementsByName('password')[0].value
                    }
                    vscode.postMessage({
                        command: 'login',
                        text: JSON.stringify(data)
                    });
                }
                window.addEventListener('message', event => {
                    const message = event.data; // The json data that the extension sent
                    switch (message.command) {
                        case 'success':
                            document.getElementById("loginform").style.display = "none";
                            document.getElementById("info").textContent = "Success Login.";
                            break;
                    }
                });
            </script>
        </head>
        <body>
        <h2>Bitbucket Login</h2>
        <form id="loginform" onsubmit="get_action(this);">
          Email:<br>
          <input type="text" name="username" value="">
          <br>
          Password:<br>
          <input type="password" name="password" value="">
          <br><br>
          <input type="hidden" value="password" name="grant_type" />
          <input type="submit" value="Submit">
        </form>
        <span id="info"> <p>Please login with your Bitbucket account.</p> </span>
        </body>
        </html>
        `;
    }

    /** Tests given credentials against an API endpoint to make sure of authentication
     * user endpoint returns the user currently logged in, so its a good way to know if we re logged in
    */
    async isAuthenticated(username: string, password: string): Promise<boolean> {
        let baseUrl = workspace.getConfiguration().get('gitlens.advanced.v2APIBaseURL') as string;
        baseUrl = baseUrl.replace('/repositories', '');
        const endpoint = `${baseUrl}/user`;

        const credentials = { username: username, password: password } as AxiosBasicCredentials;
        const client = await Axios.create({
            auth: credentials
        });
        let authenticated = false;
        await client.get(endpoint)
        .then(function() {
            authenticated = true;
        })
        .catch(function() {
            authenticated = false;
        });
        return authenticated;
    }
}
