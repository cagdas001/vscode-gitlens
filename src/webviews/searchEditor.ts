'use strict';
import * as path from 'path';
import { commands, Uri, WebviewPanel, window, workspace } from 'vscode';
import { configuration, Config } from '../configuration';
import { CommandContext, setCommandContext } from '../constants';
import { Container } from '../container';
import { GitStashCommit } from '../git/git';
import { Iterables } from '../system/iterable';
import { CommitSearchBootstrap, ShowDiffMessage } from '../ui/ipc';
import { WebviewEditor } from './webviewEditor';

export class SearchEditor extends WebviewEditor<CommitSearchBootstrap> {

    public static showDiffMessages: ShowDiffMessage[];
    public static showDiffIndex: number;

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

    public static updateNextPreviousState() {
        if (SearchEditor.showDiffIndex <= 0) {
            setCommandContext(CommandContext.ShowDiffPrevious, false);
        }
        else {
            setCommandContext(CommandContext.ShowDiffPrevious, true);
        }
        if (Array.isArray(SearchEditor.showDiffMessages) && SearchEditor.showDiffIndex >= SearchEditor.showDiffMessages.length - 1) {
            setCommandContext(CommandContext.ShowDiffNext, false);
        }
        else {
            setCommandContext(CommandContext.ShowDiffNext, true);
        }
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
        const stashes = await this.getStashList();
        const stashesWithFiles = [];
        if (Array.isArray(stashes) && stashes.length > 0) {
            for(let stash of stashes) {
                stashesWithFiles.push({
                    ...stash,
                    files: await this.getUntrackedFilesFromStash(stash)
                });
            }
        }

        return {
            config: configuration.get<Config>(),
            rootPath: Uri.file(Container.context.asAbsolutePath('.'))
                .with({ scheme: 'vscode-resource' })
                .toString(),
            branches,
            branch,
            stashes: stashesWithFiles
        } as CommitSearchBootstrap;
    }

    registerCommands() {
        return [
            commands.registerCommand('gitlens.showSearchPage', this.show, this),
            commands.registerCommand('gitlens.diffFileNext', this.showDiffFileNext, this),
            commands.registerCommand('gitlens.diffFilePrevious', this.showDiffFilePrevious, this)
        ];
    }

    private showDiffFileNext() {
        const message: ShowDiffMessage = SearchEditor.showDiffMessages[SearchEditor.showDiffIndex + 1];
        SearchEditor.showDiffIndex = SearchEditor.showDiffIndex + 1;
        SearchEditor.updateNextPreviousState();
        const fileUri =  Uri.file(path.resolve(message.repoPath, message.file)) ;
        commands.executeCommand('gitlens.diffWith', { repoPath: message.repoPath, lhs: {sha: message.lsha, uri: fileUri}, rhs: {sha: message.rsha, uri: fileUri} });
    }

    private showDiffFilePrevious() {
        const message: ShowDiffMessage = SearchEditor.showDiffMessages[SearchEditor.showDiffIndex - 1];
        SearchEditor.showDiffIndex = SearchEditor.showDiffIndex - 1;
        SearchEditor.updateNextPreviousState();
        const fileUri =  Uri.file(path.resolve(message.repoPath, message.file)) ;
        commands.executeCommand('gitlens.diffWith', { repoPath: message.repoPath, lhs: {sha: message.lsha, uri: fileUri}, rhs: {sha: message.rsha, uri: fileUri} });
    }

    private async getAllBranches(): Promise<string[]> {
        const repoPath = await Container.git.getActiveRepoPath(window.activeTextEditor);
        const branches = await Container.git.getBranches(repoPath);
        const names: string[] = [];
        Iterables.forEach(branches, b => {
            const branchName = b.remote ? `${b.getRemote()}/${b.getName()}` : b.getName();
            names.push(branchName);
        });
        return names;
    }

    private async getBranch(): Promise<string> {
        const repoPath = await Container.git.getActiveRepoPath(window.activeTextEditor);
        const branch = await Container.git.getBranch(repoPath);
        return branch!.getName();
    }

    private async getStashList(): Promise<GitStashCommit[]> {
        const repoPath = await Container.git.getActiveRepoPath(window.activeTextEditor);
        const stashList = await Container.git.getStashList(repoPath);
        return stashList ? Array.from(stashList.commits.values()) : [];
    }

    private async getUntrackedFilesFromStash(stashCommit: GitStashCommit): Promise<any[]> {
        const files = stashCommit.files;
        const repoPath = await Container.git.getActiveRepoPath(window.activeTextEditor);

        if (repoPath === undefined) return [];

        // Check for any untracked files -- since git doesn't return them via `git stash list` :(
        const log = await Container.git.getLog(repoPath, {
            maxCount: 1,
            ref: `${stashCommit.stashName}^3`
        });
        if (log !== undefined) {
            const commit = Iterables.first(log.commits.values());
            if (commit !== undefined && commit.files.length !== 0) {
                // Since these files are untracked -- make them look that way
                commit.files.forEach(s => (s.status = '?'));
                files.splice(files.length, 0, ...commit.files);
            }
        }

        const children = files.map(s => {
            const commit = stashCommit.toFileCommit(s);
            return {
                status: s,
                commit
            };
        });
        children.sort((a, b) => a.status.fileName!.localeCompare(b.status.fileName!));
        return children;
    }
}
