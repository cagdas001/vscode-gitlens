'use strict';
import Axios, { AxiosBasicCredentials } from 'axios';
import axiosRetry from 'axios-retry';
import { ChildProcess } from 'child_process';
import * as path from 'path';
import { commands, Disposable, Selection, window } from 'vscode';
import { AddLineCommentCommand } from './commands/addLineComments';
import { ElectronProcess, initComment, runApp, showComment } from './commands/commentAppHelper';
import { Commands, getCommandUri } from './commands/common';
import { Container } from './container';
import { GitUri } from './git/gitUri';
import { GitCommit } from './git/models/commit';
import { Logger } from './logger';

/**
 * Enum to for different comment types.
 */
export enum CommentType {
    File = 'file',
    Line = 'line',
    Commit = 'commit'
}

/**
 * Encapsulates comment/reply info.
 */
export class Comment {
    Commit?: GitCommit;
    Message?: string;
    Type?: CommentType;
    Id?: number;
    ParentId?: number;
    Line?: number;
    Path?: string;
    Sha?: string;
    Replies: Comment[] = [];
    Name?: string;
}

/**
 * The service that communicates with remote repository store.
 */
export class GitCommentService implements Disposable {
    /**
     * Base Url for V1 apis.
     */
    private readonly V1BaseURL = 'https://bitbucket.org/api/1.0/repositories';

    /**
     * Base Url for V2 apis.
     */
    private readonly V2BaseURL = 'https://api.bitbucket.org/2.0/repositories';

    private static username?: string;
    private static password?: string;

    public static lastFetchedComments: Comment[] | undefined;
    public static showCommentsCache: boolean = false;
    public static showCommentsCacheFile: boolean = false;

    public static commentViewerActive: boolean = false;
    public static commentViewerLine: number = -1;
    public static commentViewerCommit: GitCommit;
    public static commentViewerFilename: string;

    constructor() {
        commands.registerCommand('gitlens.commentCommitFile', this.commentToFile, this);
        commands.registerCommand('gitlens.showCommentCommitFile', this.showFileComment, this);
        commands.registerCommand('gitlens.showCommentCommitLine', this.showLineComment, this);
    }

    async commentToFile() {
        if (!AddLineCommentCommand.currentFileCommit || !window.activeTextEditor) return undefined;
        const gitUri = await GitUri.fromUri(window.activeTextEditor.document.uri);
        const filename: string = path.relative(
            AddLineCommentCommand.currentFileCommit.repoPath,
            gitUri.fsPath
        );
        const fileCommit = {
            sha: AddLineCommentCommand.currentFileCommit.rsha,
            repoPath: AddLineCommentCommand.currentFileCommit.repoPath,
            fileName: filename
        } as GitCommit;

        commands.executeCommand(Commands.AddLineComment,
            {
                fileName: fileCommit.fileName,
                commit: fileCommit
            }
        );
        return;
    }

    async showFileComment() {
        if (!AddLineCommentCommand.currentFileCommit || !window.activeTextEditor) return undefined;
        const gitUri = await GitUri.fromUri(window.activeTextEditor.document.uri);
        const filename: string = path.relative(
            AddLineCommentCommand.currentFileCommit.repoPath,
            gitUri.fsPath
        );

        AddLineCommentCommand.currentFileName = filename;

        const fileCommit = {
            sha: AddLineCommentCommand.currentFileCommit.rsha,
            repoPath: AddLineCommentCommand.currentFileCommit.repoPath,
            fileName: filename
        } as GitCommit;
        AddLineCommentCommand.currentFileGitCommit = fileCommit;

        await GitCommentService.getCredentials();
        let app: ChildProcess | undefined;
        let canceled = false;
        if (!GitCommentService.commentViewerActive) {
            app = runApp('bitbucket-comment-viewer-app');
            app.on('exit', function() {
                canceled = true;
                GitCommentService.commentViewerActive = false;
                if (!app) return;
                for (const process of ElectronProcess.currentProcess) {
                    if (process !== app) {
                        process.kill();
                    }
                }
            });
        }

        const allComments = await Container.commentService
        .loadComments(AddLineCommentCommand.currentFileGitCommit)
        .then(res => (res as Comment[])!);
        const comments = allComments.filter(
            c => c.Path === AddLineCommentCommand.currentFileName && (c.Type === CommentType.File)
        );

        if (canceled) return;

        GitCommentService.lastFetchedComments = comments;

        if (!GitCommentService.commentViewerActive && app) {
            GitCommentService.commentViewerActive = true;
            initComment(comments);
        }
        else {
            showComment(comments);
        }
        GitCommentService.commentViewerCommit = fileCommit;
        GitCommentService.commentViewerFilename = filename;
        GitCommentService.commentViewerLine = -1;
        return;
    }

    async refreshView() {
        if (GitCommentService.lastFetchedComments) {

            if (!GitCommentService.commentViewerActive) {
                const app = await runApp('bitbucket-comment-viewer-app');
                GitCommentService.commentViewerActive = true;
                app.on('exit', function() {
                    GitCommentService.commentViewerActive = false;
                    if (!app) return;
                    for (const process of ElectronProcess.currentProcess) {
                        if (process !== app) {
                            process.kill();
                        }
                    }
                });
                initComment(GitCommentService.lastFetchedComments);
            }
            else showComment(GitCommentService.lastFetchedComments);
        }
    }

    async showLineComment() {
        if (!AddLineCommentCommand.currentFileCommit || !window.activeTextEditor) return undefined;
        const gitUri = await GitUri.fromUri(window.activeTextEditor.document.uri);
        const filename: string = path.relative(
            AddLineCommentCommand.currentFileCommit.repoPath,
            gitUri.fsPath
        );

        AddLineCommentCommand.currentFileName = filename;

        const editor = window.activeTextEditor;
        const position = editor.selection.active;

        const lineState = Container.lineTracker.getState(position.line);
        const commit = lineState !== undefined ? lineState.commit : undefined;
        if (commit === undefined) return undefined;

        await GitCommentService.getCredentials();
        let app: ChildProcess | undefined;
        let canceled = false;
        if (!GitCommentService.commentViewerActive) {
            app = await runApp('bitbucket-comment-viewer-app');
            app.on('exit', function() {

                canceled = true;
                GitCommentService.commentViewerActive = false;
                if (!app) return;
                for (const process of ElectronProcess.currentProcess) {
                    if (process !== app) {
                        process.kill();
                    }
                }
            });
        }
        const allComments = await Container.commentService
        .loadComments(commit)
        .then(res => (res as Comment[])!);
        const comments = allComments.filter(c => c.Line! === position.line);
        GitCommentService.lastFetchedComments = comments;

        if (canceled) return;

        if (!GitCommentService.commentViewerActive && app) {
            GitCommentService.commentViewerActive = true;
            initComment(comments);
        }
        else showComment(comments);

        GitCommentService.commentViewerCommit = commit;
        GitCommentService.commentViewerFilename = filename;
        GitCommentService.commentViewerLine = position.line;

        return;
    }

    /**
     * Sets credentials that can be used for authenticating with remote git server.
     * @param username the username to be used for authentication
     * @param password the username to be used for authentication
     */
    static UseCredentials(username: string, password: string) {
        this.username = username;
        this.password = password;
    }

    /**
     * Resets auth credentials.
     */
    private static ClearCredentials() {
        this.username = undefined;
        this.password = undefined;
    }

    /**
     * Gets corresponding reomte path for given local file path.
     * @param localFilePath local file path
     */
    public async getRemoteRepoPath(localFilePath: string) {
        const repo = await Container.git.getRemotes(localFilePath);

        if (!repo || repo.length === 0) return;
        return repo[0].path;
    }

    /**
     * Gets corresponding reomte provider domain for given local file path.
     * @param localFilePath local file path
     */
    public async getRemoteRepoDomain(localFilePath: string) {
        const repo = await Container.git.getRemotes(localFilePath);

        if (!repo || repo.length === 0) return;
        return repo[0].domain;
    }

    /**
     * true if user logged in to bitbucket,
     * false otherwise
     */
    static isLoggedIn(): boolean {
        if (!GitCommentService.username || !GitCommentService.password) {
            return false;
        }
        else {
            return true;
        }
    }

    /**
     * Prompts user to enter remote repository credentials.
     */
    private static async getCredentials(): Promise<AxiosBasicCredentials> {
        if (!GitCommentService.username || !GitCommentService.password) {
            await Container.gitExplorer.bitbucketLogin();
        }
        return { username: GitCommentService.username, password: GitCommentService.password } as AxiosBasicCredentials;
    }

    /**
     * Loads all comments for the given commit (via API version 1).
     * @param commit commit
     */
    async loadComments(commit: GitCommit): Promise<void | Comment[] | undefined> {
        const isV2 = Container.config.advanced.useApiV2;
        let baseUrl = isV2 ? this.V2BaseURL : this.V1BaseURL;
        const domain = await this.getRemoteRepoDomain(commit.repoPath);
        if (!isV2 && domain && domain !== 'bitbucket.org') {
            baseUrl = baseUrl.replace('bitbucket.org', domain);
        }

        const path = await this.getRemoteRepoPath(commit.repoPath);
        if (!path) {
            return;
        }
        const auth = await GitCommentService.getCredentials();
        const sha = commit.sha;
        const commitStr = isV2 ? 'commit' : 'changesets';
        const url = `${baseUrl}/${path}/${commitStr}/${sha}/comments/`;
        const result: Comment[] = [];
        const commentsMap = new Map<Number, Comment>();

        let next: string | null | undefined = url;
        while (next) {
            const client = await Axios.create({
                auth: auth
            });
            await axiosRetry(client, { retries: 3 });
            Logger.log('GET ' + next);
            await client.get(next)
                .then(v => {
                    const items = (isV2 ? v!.data!.values! : v!.data!) as any[];
                    items!.forEach(c => {
                        if (!c!.deleted) {
                            const comment = { Commit: commit } as Comment;
                            if (isV2) {
                                if (c!.content && c!.content.raw) {
                                    comment.Message = c.content.raw;
                                }
                                if (c.id) {
                                    comment.Id = c.id;
                                }
                                if (c.user.display_name) {
                                    comment.Name = c.user.display_name;
                                }

                                // If comment is a file comment, there is no inline field.
                                // Therefore it enters the catch block with above usage.
                                // this prevents the rest of comments from being loaded
                                if (c.inline && c.inline.to && c.inline.to > 0) {
                                    comment.Line = c.inline.to - 1;
                                    comment.Type = CommentType.Line;
                                }
                                else {
                                    comment.Type = CommentType.File;
                                }

                                if (c.inline && c.inline.path) {
                                    comment.Path = c.inline.path;
                                }
                                if (c.commit && c.commit.hash) {
                                    comment.Sha = c.commit.hash;
                                }
                                if (c.parent && c.parent.id) {
                                    comment.ParentId = c.parent.id;
                                }
                            }
                            else {
                                if (c!.content) {
                                    comment.Message = c.content;
                                }
                                if (c.display_name) {
                                    comment.Name = c.display_name;
                                }
                                if (c.comment_id) {
                                    comment.Id = c.comment_id;
                                }

                                if (c.line_to && c.line_to > 0) {
                                    comment.Line = c.line_to - 1;
                                    comment.Type = CommentType.Line;
                                }
                                else {
                                    comment.Type = CommentType.File;
                                }

                                if (c.filename) {
                                    comment.Path = c.filename;
                                }
                                if (c.node) {
                                    comment.Sha = c.node;
                                }
                                if (c.parent_id) {
                                    comment.ParentId = c.parent_id;
                                }
                            }

                            // Note: There is a bug in BitBucker API. It doesnot add Line number when returing reply.
                            // so check the parent and normalize.
                            if (comment.ParentId!) {
                                const parent = commentsMap.get(comment.ParentId!);
                                if (parent!) {
                                    comment.Line = parent!.Line;
                                    comment.Type = parent!.Type;
                                    if (parent!.Replies) {
                                        parent!.Replies.push(comment);
                                    }
                                    else {
                                        parent!.Replies = [comment];
                                    }
                                }
                            }

                            commentsMap.set(isV2 ? c.id : c.comment_id, comment);

                            result.push(comment);
                        }
                    });
                    console.log(v);
                    if (v!.data!.next) {
                        next = v!.data!.next;
                    }
                    else {
                        next = null;
                    }
                    return result;
                })
                .catch(e => {
                    console.log(e);
                    if (e!.response!.status === 401 || e!.response!.status === 403) {
                        window.showErrorMessage('Incorrect Bit Bucket Service Credentials.');
                        GitCommentService.ClearCredentials();
                    }

                    Logger.log(e);
                    next = null;
                });
        }

        return result.filter(c => c.ParentId === undefined);
    }

    /**
     * Adds a comment on remote server (via API version 1).
     * @param commit commit id
     * @param comment comment to be added
     * @param fileName File Name to comment on.
     * @param line Line number for the comment.
     * @param parentId Parent id to be specified for replying to a comment.
     */
    async addComment(
        commit: GitCommit,
        comment: string,
        fileName: string,
        line?: number,
        parentId?: number
    ): Promise<void> {
        if (!comment) {
            return;
        }
        const isV2 = Container.config.advanced.useApiV2;
        let baseUrl = isV2 ? this.V2BaseURL : this.V1BaseURL;
        const domain = await this.getRemoteRepoDomain(commit.repoPath);
        if (!isV2 && domain && domain !== 'bitbucket.org') {
            baseUrl = baseUrl.replace('bitbucket.org', domain);
        }
        const path = await this.getRemoteRepoPath(commit.repoPath);
        if (!path) {
            return;
        }
        const auth = await GitCommentService.getCredentials();
        const sha = commit.sha;
        const commitStr = isV2 ? 'commit' : 'changesets';
        const url = `${baseUrl}/${path}/${commitStr}/${sha}/comments/`;
        const to = line! + 1;
        const data = isV2 ? {
            content: {
                raw: comment
            },
            inline: {
                path: fileName,
                to: to || undefined
            },
            parent: parentId ? { id: parentId } : undefined
        } : {
            content: comment,
            filename: fileName,
            line_to: parentId ? undefined : to || undefined,
            parent_id: parentId ? parentId : undefined
        };

        try {
            Logger.log('POST ' + url );
            Logger.log('POST DATA ' + JSON.stringify(data) );

            const response = await Axios.create({ auth: auth }).post(url, data);
            window.showInformationMessage('Comment/reply added successfully.');
            if (GitCommentService.lastFetchedComments) {
                const newComment: Comment = {
                    Id: isV2 ? response.data.id : response.data.comment_id,
                    Commit: commit,
                    Message: comment,
                    Line: line,
                    Path: fileName,
                    Sha: commit.sha,
                    ParentId: parentId ? parentId : undefined,
                    Replies: [],
                    Name: 'You'
                };
                if (line) {
                    newComment.Type = CommentType.Line;
                }
                else {
                    newComment.Type = CommentType.File;
                }
                if (newComment.ParentId) {
                    function checkReply(replies: Comment[]) {
                        return replies.map(comment => {
                            if (comment.Id === newComment.ParentId) {
                                newComment.Type = comment.Type;
                                newComment.Line = comment.Line;
                                if (comment.Replies) {
                                    comment.Replies.push(newComment);
                                }
                                else {
                                    comment.Replies = [newComment];
                                }
                            }
                            else if (comment.Replies) {
                                comment.Replies = checkReply(comment.Replies);
                            }
                            return comment;
                        });
                    }

                    GitCommentService.lastFetchedComments = checkReply(GitCommentService.lastFetchedComments);
                }
                else {
                    GitCommentService.lastFetchedComments.push(newComment);
                }
            }
            await this.refreshView();
        }
        catch (e) {
            Logger.error(e);
            if (e!.response!.status === 401 || e!.response!.status === 403) {
                window.showErrorMessage('Incorrect Bit Bucket Service Credentials. Could not add comment/reply.');
                GitCommentService.ClearCredentials();
            }
            else {
                console.log(e.response);

                window.showErrorMessage('Failed to add comment/reply. ');
            }
        }
    }

    /**
     * Edit comment on Git Remote server (via API version 1).
     * @param commit Commit to be used for editing
     * @param comment New value
     * @param commentId Comment to be edited.
     */
    async editComment(commit: GitCommit, comment: string, commentId: number): Promise<void> {
        if (!comment) {
            return;
        }
        const isV2 = Container.config.advanced.useApiV2;
        let baseUrl = isV2 ? this.V2BaseURL : this.V1BaseURL;
        const domain = await this.getRemoteRepoDomain(commit.repoPath);
        if (!isV2 && domain && domain !== 'bitbucket.org') {
            baseUrl = baseUrl.replace('bitbucket.org', domain);
        }
        const path = await this.getRemoteRepoPath(commit.repoPath);
        if (!path) {
            return;
        }
        const auth = await GitCommentService.getCredentials();
        const sha = commit.sha;
        const commitStr = isV2 ? 'commit' : 'changesets';
        const url = `${baseUrl}/${path}/${commitStr}/${sha}/comments/${commentId}`;
        const data = isV2 ? {
            content: {
                raw: comment
            }
        } : {
            content: comment,
            comment_id: commentId
        };
        try {
            Logger.log('POST ' + url );
            Logger.log('POST DATA ' + JSON.stringify(data));
            const v = await Axios.create({ auth: auth }).put(url, data);
            window.showInformationMessage('Comment/reply edited successfully.');
            if (GitCommentService.lastFetchedComments) {
                GitCommentService.lastFetchedComments = GitCommentService.lastFetchedComments.map(item => {
                    if (item.Id === commentId) {
                        item.Message = comment;
                    }
                    else {
                        function checkReply(replies: Comment[]) {
                            for (const reply of replies) {
                                if (reply.Id === commentId) {
                                    reply.Message = comment;
                                }
                                if (reply.Replies) {
                                    checkReply(reply.Replies);
                                }
                            }
                        }
                        if (item.Replies) {
                            checkReply(item.Replies);
                        }
                    }
                    return item;
                });
            }
            await this.refreshView();
        }
        catch (e) {
            Logger.error(e);
            if (e!.response!.status === 401 || e!.response!.status === 403) {
                window.showErrorMessage('Incorrect Bit Bucket Service Credentials. Could not edit comment/reply.');
                GitCommentService.ClearCredentials();
            }
            else {
                window.showErrorMessage('Failed to add comment/reply.');
            }
        }
    }

    /**
     * Deletes comment/reply on Git remote server (via API version 1).
     * @param commit commit to be used for deleting comment
     * @param commentId comment to be deleted.
     */
    async deleteComment(commit: GitCommit, commentId: number): Promise<void> {
        const isV2 = Container.config.advanced.useApiV2;
        let baseUrl = isV2 ? this.V2BaseURL : this.V1BaseURL;
        const domain = await this.getRemoteRepoDomain(commit.repoPath);
        if (!isV2 && domain && domain !== 'bitbucket.org') {
            baseUrl = baseUrl.replace('bitbucket.org', domain);
        }
        const auth = await GitCommentService.getCredentials();
        const sha = commit.sha;
        const path = await this.getRemoteRepoPath(commit.repoPath);
        const commitStr = isV2 ? 'commit' : 'changesets';
        const url = `${baseUrl}/${path}/${commitStr}/${sha}/comments/${commentId}`;

        try {
            Logger.log('DELETE ' + url );
            const v = await Axios.create({ auth: auth }).delete(url);
            window.showInformationMessage('Comment/reply deleted successfully.');
            if (GitCommentService.lastFetchedComments) {
                GitCommentService.lastFetchedComments = GitCommentService.lastFetchedComments.filter(comment => {
                    function checkReply(replies: Comment[]) {
                        return replies.filter(reply => {
                            if (reply.Replies) {
                                checkReply(reply.Replies);
                            }
                            return reply.Id !== commentId;
                        });
                    }

                    if (comment.Replies) {
                        comment.Replies = checkReply(comment.Replies);
                    }

                    return comment.Id !== commentId;
                });

            }
            await this.refreshView();
        }
        catch (e) {
            Logger.error(e);
            if (e!.response!.status === 401 || e!.response!.status === 403) {
                window.showErrorMessage('Incorrect Bit Bucket Service Credentials. Could not delete comment/reply.');
                GitCommentService.ClearCredentials();
            }
            else {
                window.showErrorMessage('Failed to delete comment/reply.');
            }
        }
    }

    private updateView() {
        const editor = window.activeTextEditor;
        if (editor) {
            const position = editor.selection.active;
            let newPosition = position.with(0, 0);
            if (position.line === 0) {
                newPosition = position.with(1, 0);
                GitCommentService.showCommentsCacheFile = true;
            }
            const newSelection = new Selection(newPosition, newPosition);
            editor.selection = newSelection;
            GitCommentService.showCommentsCache = true;
            setTimeout(() => {
                const originalSelection = new Selection(position, position);
                editor.selection = originalSelection;
                setTimeout(() => {
                    commands.executeCommand('editor.action.showHover');
                }, 500);
            }, 200);
        }
    }

    dispose() {}
}
