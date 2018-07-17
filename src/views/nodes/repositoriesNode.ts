'use strict';
import { Disposable, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { Container } from '../../container';
import { GitUri } from '../../gitService';
import { GitExplorer } from '../gitExplorer';
import { MessageNode } from './common';
import { ExplorerNode, ResourceType, SubscribeableExplorerNode, unknownGitUri } from './explorerNode';
import { RepositoryNode } from './repositoryNode';

export class RepositoriesNode extends SubscribeableExplorerNode<GitExplorer> {
    private _children: (RepositoryNode | MessageNode)[] | undefined;

    constructor(explorer: GitExplorer) {
        super(unknownGitUri, explorer);
    }

    dispose() {
        super.dispose();

        if (this._children !== undefined) {
            for (const child of this._children) {
                if (child instanceof RepositoryNode) {
                    child.dispose();
                }
            }
            this._children = undefined;
        }
    }

    async getChildren(): Promise<ExplorerNode[]> {
        if (this._children === undefined) {
            const repositories = [...(await Container.git.getRepositories())];
            if (repositories.length === 0) return [new MessageNode('No repositories found')];

            const children = [];
            for (const repo of repositories.sort((a, b) => a.index - b.index)) {
                if (repo.closed) continue;

                children.push(new RepositoryNode(GitUri.fromRepoPath(repo.path), repo, this.explorer));
            }

            this._children = children;
        }

        return this._children;
    }

    getTreeItem(): TreeItem {
        const item = new TreeItem(`Repositories`, TreeItemCollapsibleState.Expanded);
        item.contextValue = ResourceType.Repositories;

        this.ensureSubscription();

        return item;
    }

    async refresh() {
        if (this._children === undefined) return;

        const repositories = [...(await Container.git.getRepositories())];
        if (repositories.length === 0 && (this._children === undefined || this._children.length === 0)) return;

        if (repositories.length === 0) {
            this._children = [new MessageNode('No repositories found')];
            return;
        }

        const children = [];
        for (const repo of repositories.sort((a, b) => a.index - b.index)) {
            const normalizedPath = repo.normalizedPath;
            const child = (this._children as RepositoryNode[]).find(c => c.repo.normalizedPath === normalizedPath);
            if (child !== undefined) {
                children.push(child);
                child.refresh();
            }
            else {
                children.push(new RepositoryNode(GitUri.fromRepoPath(repo.path), repo, this.explorer));
            }
        }

        for (const child of this._children as RepositoryNode[]) {
            if (children.includes(child)) continue;

            child.dispose();
        }

        this._children = children;
        this.ensureSubscription();
    }

    protected async subscribe() {
        return Disposable.from(Container.git.onDidChangeRepositories(this.onRepositoriesChanged, this));
    }

    private onRepositoriesChanged() {
        this.explorer.refreshNode(this);
    }
}
