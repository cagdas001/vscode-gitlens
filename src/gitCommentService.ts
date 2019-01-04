'use strict';
import Axios, { AxiosBasicCredentials } from 'axios';
import axiosRetry from 'axios-retry';
import * as path from 'path';
import { commands, Disposable, Selection, window, workspace } from 'vscode';
import { AddLineCommentCommand, lineCommentTypes } from './commands/addLineComments';
import { initComment, runApp, showComment } from './commands/commentAppHelper';
import { Commands, getCommandUri } from './commands/common';
import { CommandContext, setCommandContext } from './constants';
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
 * To: zero-based line number of the comment (in the new revision)
 * From: zero-based line number of the comment (in the previous revision)
 * From is reqired to show/add (or other actions) on deleted lines in the new revision)
 * Details:
 * https://developer.atlassian.com/bitbucket/api/2/reference/resource/repositories/%7Busername%7D/%7Brepo_slug%7D/commit/%7Bnode%7D/comments#get
 */
export class CommentLine {
    To?: number;
    From?: number;
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
    LineItem?: CommentLine;
    Path?: string;
    Sha?: string;
    Replies: Comment[] = [];
    Name?: string;
}

/**
 * Stores comment list against commit hash
 * for the CacheTimeout (5 minutes default)
 * You may adjust CacheTimeout for your need in minutes format.
 *
 * Since this class stores Comment objects, it's very flexible and can be used
 * in any part that needs comments.
 */
export class CommentCacheItem {
    Comments: Comment[];
    FetchedTime: number;
    constructor(comments: Comment[]) {
        this.Comments = comments;
        this.FetchedTime = Date.now();
    }
}

export class CommentCache {
    static CacheTimeout = 5; // minutes
    CachedItems: Map<string, CommentCacheItem>;
    constructor() {
        this.CachedItems = new Map<string, CommentCacheItem>();
    }
}

/**
 * The service that communicates with remote repository store.
 */
export class GitCommentService implements Disposable {
    /**
     * Get Base Url for V1 apis from settings.
     */
    private readonly V1BaseURL = workspace.getConfiguration().get('gitlens.advanced.v1APIBaseURL') as string;

    /**
     * Get Base Url for V2 apis from settings.
     */
    private readonly V2BaseURL = workspace.getConfiguration().get('gitlens.advanced.v2APIBaseURL') as string;

    private static username?: string;
    private static password?: string;

    public static lastFetchedComments: Comment[] | undefined;
    public static showCommentsCache: boolean = false;
    public static showCommentsCacheFile: boolean = false;

    public static commentViewerActive: boolean = false;
    public static commentViewerLine: number = -1;
    public static commentViewerCommit: GitCommit;
    public static commentViewerFilename: string;
    public static lineCommentType: lineCommentTypes;

    public commentCache: CommentCache;

    constructor() {
        commands.registerCommand('gitlens.commentCommitFile', this.commentToFile, this);
        commands.registerCommand('gitlens.showCommentCommitFile', this.showFileComment, this);
        commands.registerCommand('gitlens.showCommentCommitLine', this.showLineComment, this);
        this.commentCache = new CommentCache();
    }

    async commentToFile() {
        if (!AddLineCommentCommand.currentFileCommit || !window.activeTextEditor) return undefined;
        const gitUri = await GitUri.fromUri(window.activeTextEditor.document.uri);
        const filename: string = path.relative(AddLineCommentCommand.currentFileCommit.repoPath, gitUri.fsPath);
        const fileCommit = {
            sha: AddLineCommentCommand.currentFileCommit.rsha,
            repoPath: AddLineCommentCommand.currentFileCommit.repoPath,
            fileName: this.normalizeToForwardSlashes(filename)
        } as GitCommit;

        await GitCommentService.getCredentials();

        commands.executeCommand(Commands.AddLineComment, {
            fileName: fileCommit.fileName,
            commit: fileCommit
        });
        return;
    }

    async showFileComment() {
        if (!AddLineCommentCommand.currentFileCommit || !window.activeTextEditor) return undefined;
        const gitUri = await GitUri.fromUri(window.activeTextEditor.document.uri);
        let filename: string = path.relative(AddLineCommentCommand.currentFileCommit.repoPath, gitUri.fsPath);
        filename = this.normalizeToForwardSlashes(filename);

        AddLineCommentCommand.currentFileName = filename;

        const fileCommit = {
            sha: AddLineCommentCommand.currentFileCommit.rsha,
            repoPath: AddLineCommentCommand.currentFileCommit.repoPath,
            fileName: filename
        } as GitCommit;
        AddLineCommentCommand.currentFileGitCommit = fileCommit;

        await GitCommentService.getCredentials();
        let app;
        let canceled = false;
        if (!GitCommentService.commentViewerActive) {
            app = runApp('bitbucket-comment-viewer-app');
            app.on('exit', function() {
                canceled = true;
                GitCommentService.commentViewerActive = false;
            });
        }

        const allComments = await Container.commentService
            .loadComments(AddLineCommentCommand.currentFileGitCommit)
            .then(res => (res as Comment[])!);
        const comments = allComments.filter(
            c => c.Path === AddLineCommentCommand.currentFileName && c.Type === CommentType.File
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
                });
                initComment(GitCommentService.lastFetchedComments);
            }
            else showComment(GitCommentService.lastFetchedComments);
        }
    }

    async showLineComment() {
        if (!window.activeTextEditor) return undefined;
        let repoPath: string | undefined;
        if (!AddLineCommentCommand.currentFileCommit) {
            repoPath = await Container.git.getActiveRepoPath(window.activeTextEditor);
        }
        else {
            repoPath = AddLineCommentCommand.currentFileCommit.repoPath;
        }
        if (!repoPath) return undefined;
        const gitUri = await GitUri.fromUri(window.activeTextEditor.document.uri);
        let filename: string = path.relative(repoPath, gitUri.fsPath);
        filename = this.normalizeToForwardSlashes(filename);

        AddLineCommentCommand.currentFileName = filename;

        const editor = window.activeTextEditor;
        const position = editor.selection.active;

        // the commit we're reviewing in the diff view,
        // or recent commit of file, if it's not diff view
        let fileCommit: GitCommit | undefined;
        // previous or new revision of file in diff view
        // left side: previous, right side: new
        let revisionCommitSha: string;

        const isLeftSideActive =
            editor.document.uri.fsPath ===
                (AddLineCommentCommand.leftDocumentUri && AddLineCommentCommand.leftDocumentUri.fsPath);
        const isRightSideActive = editor.document.uri.fsPath ===
                (AddLineCommentCommand.rightDocumentUri && AddLineCommentCommand.rightDocumentUri.fsPath);

        const isDiffView = isLeftSideActive || isRightSideActive;

        if (isDiffView && AddLineCommentCommand.currentFileCommit) {
            if (isLeftSideActive) {
                // previous revision
                revisionCommitSha = AddLineCommentCommand.currentFileCommit.lsha;
            }
            else {
                // new revision
                revisionCommitSha = AddLineCommentCommand.currentFileCommit.rsha;
            }

            fileCommit = {
                sha: AddLineCommentCommand.currentFileCommit.rsha,
                repoPath: repoPath,
                fileName: AddLineCommentCommand.currentFileName
            } as GitCommit;
        }
        else {
            // user is not in the diff view
            const recentCommitSha = await Container.git.getRecentShaForFile(repoPath, filename);
            revisionCommitSha = recentCommitSha!;
            fileCommit = {
                sha: recentCommitSha,
                repoPath: repoPath,
                fileName: filename
            } as GitCommit;
        }

        const lineState = Container.lineTracker.getState(position.line);
        const commit = lineState !== undefined ? lineState.commit : undefined;
        if (commit === undefined) {
            window.showWarningMessage('You need to wait a few seconds for blame to annotate the file.');
            return undefined;
        }

        const blameSrcLine = commit.lines.find(b => b.line === position.line)!.originalLine;
        const blameCommitSha = commit.sha;

        const blameForRevision = await Container.git.getBlameForFileRevision(gitUri, revisionCommitSha);
        const targetLine = blameForRevision!.lines.find(
            l => l.sha === blameCommitSha && l.originalLine === blameSrcLine
        );
        const targetLineNum = targetLine!.line;

        await GitCommentService.getCredentials();
        let app;
        let canceled = false;
        if (!GitCommentService.commentViewerActive) {
            app = await runApp('bitbucket-comment-viewer-app');
            app.on('exit', function() {
                canceled = true;
                GitCommentService.commentViewerActive = false;
            });
        }
        const allComments = await Container.commentService.loadComments(fileCommit).then(res => (res as Comment[])!);
        let comments: Comment[];
        if (commit.sha === revisionCommitSha && !isLeftSideActive) {
            // added/changed in this revision
            comments = allComments.filter(c => c.LineItem!.To === targetLineNum && c.Path === filename);
            GitCommentService.lineCommentType = lineCommentTypes.To;
        }
        else {
            comments = allComments.filter(c => c.LineItem!.From === targetLineNum && c.Path === filename);
            GitCommentService.lineCommentType = lineCommentTypes.From;
        }

        GitCommentService.lastFetchedComments = comments;

        if (canceled) return;

        if (!GitCommentService.commentViewerActive && app) {
            GitCommentService.commentViewerActive = true;
            initComment(comments);
        }
        else showComment(comments);

        GitCommentService.commentViewerCommit = fileCommit;
        GitCommentService.commentViewerFilename = filename;
        GitCommentService.commentViewerLine = targetLineNum;

        return;
    }

    /**
     * Sets credentials that can be used for authenticating with remote git server.
     * @param username the username to be used for authentication
     * @param password the username to be used for authentication
     */
    static UseCredentials(username: string, password: string) {
        setCommandContext(CommandContext.BitbucketLoggedIn, true);
        this.username = username;
        this.password = password;
    }

    /**
     * Resets auth credentials.
     */
    static ClearCredentials() {
        setCommandContext(CommandContext.BitbucketLoggedIn, false);
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
     * Replaces backward slashes (\\) with forward slashes (/)
     * @param pathToReplace
     */
    normalizeToForwardSlashes(pathToReplace: string): string {
        return pathToReplace.replace(/\\/g, '/');
    }

    /**
     * Loads all comments for the given commit (via API version 1).
     * @param commit commit
     */
    async loadComments(commit: GitCommit): Promise<void | Comment[] | undefined> {
        const isV2 = Container.config.advanced.useApiV2;
        const baseUrl = isV2 ? this.V2BaseURL : this.V1BaseURL;

        const repoPath = await this.getRemoteRepoPath(commit.repoPath);
        if (!repoPath) {
            return;
        }
        const auth = await GitCommentService.getCredentials();
        const sha = commit.sha;
        const commitStr = isV2 ? 'commit' : 'changesets';
        const url = `${baseUrl}/${repoPath}/${commitStr}/${sha}/comments/`;
        const requestParams = {
            pagelen: 100
        };
        const axiosConfig = {
            params: requestParams
        };
        const result: Comment[] = [];
        const commentsMap = new Map<Number, Comment>();

        let next: string | null | undefined = url;
        while (next) {
            const client = await Axios.create({
                auth: auth
            });
            await axiosRetry(client, { retries: 3 });
            await client
                .get(next, axiosConfig)
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
                                if (c.inline) {
                                    comment.Line = c.inline.to > 0 ? c.inline.to - 1 : undefined;
                                    // Line.To = comment is the new revision of file
                                    // Line.From = comment is at the previous revision of file
                                    comment.LineItem = new CommentLine();
                                    comment.LineItem.To = c.inline.to > 0 ? c.inline.to - 1 : undefined;
                                    comment.LineItem.From = c.inline.from > 0 ? c.inline.from - 1 : undefined;
                                    comment.Type = CommentType.Line;
                                }
                                else {
                                    comment.Type = CommentType.File;
                                }

                                if (c.inline && c.inline.path) {
                                    comment.Path = this.normalizeToForwardSlashes(c.inline.path);
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
                                    comment.Path = this.normalizeToForwardSlashes(c.filename);
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
        if (result) {
            const cacheItem = new CommentCacheItem(result);
            this.commentCache.CachedItems.set(sha, cacheItem);
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
        commentTo?: lineCommentTypes,
        parentId?: number
    ): Promise<void> {
        if (!comment) {
            return;
        }
        const isV2 = Container.config.advanced.useApiV2;
        const baseUrl = isV2 ? this.V2BaseURL : this.V1BaseURL;
        const path = await this.getRemoteRepoPath(commit.repoPath);
        if (!path) {
            return;
        }
        fileName = this.normalizeToForwardSlashes(fileName);
        const auth = await GitCommentService.getCredentials();
        const sha = commit.sha;
        const commitStr = isV2 ? 'commit' : 'changesets';
        const url = `${baseUrl}/${path}/${commitStr}/${sha}/comments/`;
        const targetLine = line! + 1;
        const inlineFieldData = commentTo === lineCommentTypes.To ? {
            path: fileName,
            to: targetLine || undefined
        } : {
            path: fileName,
            from: targetLine || undefined
        };
        const data = isV2
            ? {
                  content: {
                      raw: comment
                  },
                  inline: inlineFieldData,
                  parent: parentId ? { id: parentId } : undefined
              }
            : {
                  content: comment,
                  filename: fileName,
                  line_to: parentId ? undefined : targetLine || undefined,
                  parent_id: parentId ? parentId : undefined
              };

        try {
            Logger.log('POST ' + url);
            Logger.log('POST DATA ' + JSON.stringify(data));

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
            if (e!.response!.status === 401) {
                window.showErrorMessage('Incorrect Bit Bucket Service Credentials. Could not add comment/reply.');
                GitCommentService.ClearCredentials();
            }
            else if (e!.response!.status === 403) {
                window.showErrorMessage(
                    'You are not allowed to do this action. Make sure you have permission for this repository.'
                );
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
        const baseUrl = isV2 ? this.V2BaseURL : this.V1BaseURL;
        const path = await this.getRemoteRepoPath(commit.repoPath);
        if (!path) {
            return;
        }
        const auth = await GitCommentService.getCredentials();
        const sha = commit.sha;
        const commitStr = isV2 ? 'commit' : 'changesets';
        const url = `${baseUrl}/${path}/${commitStr}/${sha}/comments/${commentId}`;
        const data = isV2
            ? {
                  content: {
                      raw: comment
                  }
              }
            : {
                  content: comment,
                  comment_id: commentId
              };
        try {
            Logger.log('POST ' + url);
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
            if (e!.response!.status === 401) {
                window.showErrorMessage('Incorrect Bit Bucket Service Credentials. Could not edit comment/reply.');
                GitCommentService.ClearCredentials();
            }
            else if (e!.response!.status === 403) {
                window.showErrorMessage(
                    'You are not allowed to do this action. Make sure you have permission to do this.'
                );
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
        const baseUrl = isV2 ? this.V2BaseURL : this.V1BaseURL;

        const auth = await GitCommentService.getCredentials();
        const sha = commit.sha;
        const path = await this.getRemoteRepoPath(commit.repoPath);
        const commitStr = isV2 ? 'commit' : 'changesets';
        const url = `${baseUrl}/${path}/${commitStr}/${sha}/comments/${commentId}`;

        try {
            Logger.log('DELETE ' + url);
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
            if (e!.response!.status === 401) {
                window.showErrorMessage('Incorrect Bit Bucket Service Credentials. Could not delete comment/reply.');
                GitCommentService.ClearCredentials();
            }
            else if (e!.response!.status === 403) {
                window.showErrorMessage(
                    'You are not allowed to do this action. Make sure you have permission to do this.'
                );
            }
            else {
                window.showErrorMessage('Failed to delete comment/reply.');
            }
        }
    }

    async retrieveParticipants(str: string) {
        const url = 'https://bitbucket.org/xhr/user-mention';
        const requestParams = {
            term: str
        };
        const axiosConfig = {
            params: requestParams
        };
        const client = await Axios.create();

        const { data } = await client.get(url, axiosConfig);
        return data;
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
