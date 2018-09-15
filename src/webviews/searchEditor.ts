'use strict';
import { commands, WebviewPanel, window, workspace } from 'vscode';
import { configuration, IConfig } from '../configuration';
import { Container } from '../container';
import { GitBranch } from '../git/git';
import { Iterables } from '../system/iterable';
import { CommitSearchBootstrap } from '../ui/ipc';
import { WebviewEditor } from './webviewEditor';

export class SearchEditor extends WebviewEditor<CommitSearchBootstrap> {
    constructor() {
        super();
    }

    get filename(): string {
        return 'search.html';
    }

    get id(): string {
        return 'gitlens.search';
    }

    get title(): string {
        return 'GitLens Commit Search';
    }

    async updateGitLogs(message: any) {
        const panel = this._panel as WebviewPanel;

        await panel!.webview.postMessage(message).then(
            s => {
                console.log(s);
            },
            r => {
                console.log('rejected');
                console.log(r);
            }
        );
    }

    async hookToWebviewPanel(listener: (e: any) => any) {
        const panel = this._panel as WebviewPanel;
        await panel!.webview.onDidReceiveMessage(listener);
    }

    async getBootstrap() {
        const branches = await this.getAllBranches();
        const branch = await this.getBranch();
        return {
            config: configuration.get<IConfig>(),
            branches: branches,
            branch: branch
        } as CommitSearchBootstrap;
    }

    registerCommands() {
        return [commands.registerCommand('gitlens.showSearchPage', this.show, this)];
    }

    private async getAllBranches(): Promise<string[]> {
        const repoPath = await Container.git.getActiveRepoPath(window.activeTextEditor);
        const branches = await Container.git.getBranches(repoPath);
        const names: string[] = [];
        Iterables.forEach(branches, b => names.push(b.getName()));
        return names;
    }

    private async getBranch(): Promise<string> {
        const repoPath = await Container.git.getActiveRepoPath(window.activeTextEditor);
        const branch = await Container.git.getBranch(repoPath);
        return branch!.getName();
    }
}
