'use strict';
import { Command, TreeItem } from 'vscode';
import { GitUri } from '../../gitService';

export enum ResourceType {
    Branch = 'gitlens:branch',
    BranchWithTracking = 'gitlens:branch:tracking',
    Branches = 'gitlens:branches',
    BranchesWithRemotes = 'gitlens:branches:remotes',
    CurrentBranch = 'gitlens:branch:current',
    CurrentBranchWithTracking = 'gitlens:branch:current:tracking',
    RemoteBranch = 'gitlens:branch:remote',
    Commit = 'gitlens:commit',
    CommitOnCurrentBranch = 'gitlens:commit:current',
    CommitFile = 'gitlens:file:commit',
    Commits = 'gitlens:commits',
    ComparisonResults = 'gitlens:results:comparison',
    FileHistory = 'gitlens:history-file',
    Folder = 'gitlens:folder',
    History = 'gitlens:history',
    Message = 'gitlens:message',
    Pager = 'gitlens:pager',
    Remote = 'gitlens:remote',
    Remotes = 'gitlens:remotes',
    Repositories = 'gitlens:repositories',
    Repository = 'gitlens:repository',
    Results = 'gitlens:results',
    ResultsCommits = 'gitlens:results:commits',
    ResultsFiles = 'gitlens:results:files',
    SearchResults = 'gitlens:results:search',
    Stash = 'gitlens:stash',
    StashFile = 'gitlens:file:stash',
    Stashes = 'gitlens:stashes',
    StatusFile = 'gitlens:file:status',
    StatusFiles = 'gitlens:status:files',
    StatusFileCommits = 'gitlens:status:file-commits',
    StatusUpstream = 'gitlens:status:upstream',
    Tag = 'gitlens:tag',
    Tags = 'gitlens:tags'
}

export interface NamedRef {
    label?: string;
    ref: string;
}

export const unknownGitUri = new GitUri();

export abstract class ExplorerNode {
    constructor(
        public readonly uri: GitUri
    ) {}

    abstract getChildren(): ExplorerNode[] | Promise<ExplorerNode[]>;
    abstract getTreeItem(): TreeItem | Promise<TreeItem>;

    getCommand(): Command | undefined {
        return undefined;
    }

    refresh(): void | Promise<void> {}
}

export abstract class ExplorerRefNode extends ExplorerNode {
    abstract get ref(): string;

    get repoPath(): string {
        return this.uri.repoPath!;
    }
}

export interface PageableExplorerNode {
    readonly supportsPaging: boolean;
    maxCount: number | undefined;
}

export function isPageable(
    node: ExplorerNode
): node is ExplorerNode & { supportsPaging: boolean; maxCount: number | undefined } {
    return !!(node as any).supportsPaging;
}
