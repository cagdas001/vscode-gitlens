'use strict';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { GitLog, GitUri } from '../../gitService';
import { Iterables } from '../../system';
import { Explorer } from '../explorer';
import { CommitNode } from './commitNode';
import { ShowAllNode } from './common';
import { ExplorerNode, PageableExplorerNode, ResourceType } from './explorerNode';

export class CommitsResultsNode extends ExplorerNode implements PageableExplorerNode {
    readonly supportsPaging: boolean = true;
    maxCount: number | undefined;

    private _cache: { label: string; log: GitLog | undefined } | undefined;

    constructor(
        public readonly repoPath: string,
        private readonly labelFn: (log: GitLog | undefined) => Promise<string>,
        private readonly logFn: (maxCount: number | undefined) => Promise<GitLog | undefined>,
        private readonly explorer: Explorer,
        private readonly contextValue: ResourceType = ResourceType.ResultsCommits
    ) {
        super(GitUri.fromRepoPath(repoPath));
    }

    async getChildren(): Promise<ExplorerNode[]> {
        const log = await this.getLog();
        if (log === undefined) return [];

        const children: (CommitNode | ShowAllNode)[] = [
            ...Iterables.map(log.commits.values(), c => new CommitNode(c, this.explorer))
        ];

        if (log.truncated) {
            children.push(new ShowAllNode('Results', this, this.explorer));
        }
        return children;
    }

    async getTreeItem(): Promise<TreeItem> {
        const log = await this.getLog();

        const item = new TreeItem(
            await this.getLabel(),
            log && log.count > 0 ? TreeItemCollapsibleState.Expanded : TreeItemCollapsibleState.None
        );
        item.contextValue = this.contextValue;
        return item;
    }

    refresh() {
        this._cache = undefined;
    }

    private async ensureCache() {
        if (this._cache === undefined) {
            const log = await this.logFn(this.maxCount);

            this._cache = {
                label: await this.labelFn(log),
                log: log
            };
        }

        return this._cache;
    }

    private async getLabel() {
        const cache = await this.ensureCache();
        return cache.label;
    }

    private async getLog() {
        const cache = await this.ensureCache();
        return cache.log;
    }
}
