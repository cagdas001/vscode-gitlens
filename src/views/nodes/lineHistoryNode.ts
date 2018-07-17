'use strict';
import { Disposable, Range, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { GlyphChars } from '../../constants';
import { Container } from '../../container';
import {
    GitUri,
    Repository,
    RepositoryChange,
    RepositoryChangeEvent,
    RepositoryFileSystemChangeEvent
} from '../../gitService';
import { Logger } from '../../logger';
import { Iterables, Strings } from '../../system';
import { LineHistoryExplorer } from '../lineHistoryExplorer';
import { CommitFileNode, CommitFileNodeDisplayAs } from './commitFileNode';
import { MessageNode } from './common';
import { ExplorerNode, ResourceType, SubscribeableExplorerNode } from './explorerNode';

export class LineHistoryNode extends SubscribeableExplorerNode<LineHistoryExplorer> {
    constructor(
        uri: GitUri,
        public readonly range: Range,
        explorer: LineHistoryExplorer
    ) {
        super(uri, explorer);
    }

    async getChildren(): Promise<ExplorerNode[]> {
        const children: ExplorerNode[] = [];

        const displayAs =
            CommitFileNodeDisplayAs.CommitLabel |
            (this.explorer.config.avatars ? CommitFileNodeDisplayAs.Gravatar : CommitFileNodeDisplayAs.StatusIcon);

        const log = await Container.git.getLogForFile(this.uri.repoPath, this.uri.fsPath, {
            ref: this.uri.sha,
            range: this.range
        });
        if (log !== undefined) {
            children.push(
                ...Iterables.map(
                    log.commits.values(),
                    // TODO: Include range when opening diff
                    c => new CommitFileNode(c.fileStatuses[0], c, this.explorer, displayAs)
                )
            );
        }

        if (children.length === 0) return [new MessageNode('No line history')];
        return children;
    }

    getTreeItem(): TreeItem {
        const lines = this.range.isSingleLine
            ? ` (Ln ${this.range.start.line + 1})${Strings.pad(GlyphChars.Dot, 2, 2)}`
            : ` (Ln ${this.range.start.line + 1}-${this.range.end.line + 1})${Strings.pad(GlyphChars.Dot, 2, 2)}`;
        const item = new TreeItem(`${this.uri.getFormattedPath(lines)}`, TreeItemCollapsibleState.Expanded);
        item.contextValue = ResourceType.FileHistory;
        item.tooltip = `History of ${this.uri.getFilename()}${lines}\n${this.uri.getDirectory()}/`;

        item.iconPath = {
            dark: Container.context.asAbsolutePath('images/dark/icon-history.svg'),
            light: Container.context.asAbsolutePath('images/light/icon-history.svg')
        };

        this.ensureSubscription();

        return item;
    }

    protected async subscribe() {
        const repo = await Container.git.getRepository(this.uri);
        if (repo === undefined) return undefined;

        const subscription = Disposable.from(
            repo.onDidChange(this.onRepoChanged, this),
            repo.onDidChangeFileSystem(this.onRepoFileSystemChanged, this),
            { dispose: () => repo.stopWatchingFileSystem() }
        );

        repo.startWatchingFileSystem();

        return subscription;
    }

    private onRepoChanged(e: RepositoryChangeEvent) {
        if (!e.changed(RepositoryChange.Repository)) return;

        Logger.log(`LineHistoryNode.onRepoChanged(${e.changes.join()}); triggering node refresh`);

        this.explorer.refreshNode(this);
    }

    private onRepoFileSystemChanged(e: RepositoryFileSystemChangeEvent) {
        if (!e.uris.some(uri => uri.toString() === this.uri.toString())) return;

        Logger.log(`LineHistoryNode.onRepoFileSystemChanged; triggering node refresh`);

        this.explorer.refreshNode(this);
    }
}
