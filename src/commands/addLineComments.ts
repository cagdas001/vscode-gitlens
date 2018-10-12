'use strict';
import { CancellationTokenSource, InputBoxOptions, TextEditor, Uri, window } from 'vscode';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import { Comment, CommentType } from '../gitCommentService';
import { GitCommit, GitUri } from '../gitService';
import { Logger } from '../logger';
import { CommandQuickPickItem, CommentsQuickPick } from '../quickpicks';
import { Strings } from '../system';
import { ShowDiffMessage } from '../ui/ipc';
import * as commentAppHelper from './commentAppHelper';
import { ActiveEditorCachedCommand, Commands, getCommandUri, getRepoPathOrActiveOrPrompt } from './common';

/**
 *Encapsulates infomation to perform comments management command.
 */
export interface AddLineCommentsCommandArgs {
    commit?: GitCommit;
    line?: number;
    fileName?: string;
    id?: number;
    message?: string;
    editCommand?: CommandQuickPickItem;
    replyCommand?: CommandQuickPickItem;
    type?: operationTypes;
    isFileComment?: boolean;
}

/**
 * Different Comment management commands.
 */
enum operationTypes {
    Create,
    Delete,
    Edit,
    Reply
}

/**
 * Command to add/edit/delete/reply an inline or file comment.
 */
export class AddLineCommentCommand extends ActiveEditorCachedCommand {
    /**
     * Gets markdown for command with given argumants.
     * @param args to be serialized.
     */
    static getMarkdownCommandArgs(args: AddLineCommentsCommandArgs): string {
        return super.getMarkdownCommandArgsCore<AddLineCommentsCommandArgs>(Commands.AddLineComment, args);
    }

    static currentFileCommit: ShowDiffMessage;
    static currentFileGitCommit: GitCommit;
    static currentFileName: string;
    static showFileCommitComment: boolean = false;

    constructor() {
        super(Commands.AddLineComment);
    }

    /**
     * Prepends offset to a message to give illusion of hirarchy on rendering to UI.
     * @param level Number of times to prepend offset.
     */
    static commentStartRender(level: number): string {
        let message = ``;
        while (level > 0) {
            message += `${GlyphChars.SpaceThin}${Strings.pad(GlyphChars.Dash, 2, 3)}${GlyphChars.Space}`;
            level = level - 1;
        }
        return message;
    }

    /**
     * Gets command quick pick corresponding to given command.
     * @param uri
     * @param fileName
     * @param commit
     */
    private getAddFileCommentCommand(uri: Uri, fileName: string, commit: GitCommit): CommandQuickPickItem {
        const cmdArg = {
            fileName: fileName,
            commit: commit
        } as AddLineCommentsCommandArgs;

        return new CommandQuickPickItem(
            {
                label: `${Strings.pad(GlyphChars.Pencil, 2, 3)} Add Comment`,
                description: `${Strings.pad(GlyphChars.Dash, 2, 3)} Add comment`
            },
            Commands.AddLineComment,
            [uri, cmdArg]
        );
    }

    /**
     * Returns a flattened array for hirarchy of comments/replies.
     * @param level
     * @param ele
     * @param uri
     */
    static flattenCommands(level: number, ele: Comment, uri?: Uri): CommandQuickPickItem[] {
        let commands: CommandQuickPickItem[] = [];
        try {
            const message = this.commentStartRender(level) + ele.Message;

            const cmdArg = {
                fileName: ele.Path,
                commit: ele.Commit,
                id: ele.Id,
                message: ele.Message
            } as AddLineCommentsCommandArgs;

            const cmd = new CommandQuickPickItem(
                {
                    label: message
                },
                Commands.AddLineComment,
                [uri, cmdArg]
            );

            commands.push(cmd);

            if (ele.Replies !== undefined) {
                ele.Replies!.forEach(reply => {
                    commands = [...commands, ...this.flattenCommands(level + 1, reply, uri)];
                });
            }

            return commands;
        }
        catch (e) {
            console.log(e);
            return commands;
        }
    }

    async execute(editor?: TextEditor, uri?: Uri, args: AddLineCommentsCommandArgs = {}) {
        const BITBUCKET_COMMENT_APP_NAME = 'bitbucket-comment-app';
        uri = getCommandUri(uri, editor);

        const gitUri = uri && (await GitUri.fromUri(uri));

        const repoPath = await getRepoPathOrActiveOrPrompt(
            gitUri,
            editor,
            `Search for commits in which repository${GlyphChars.Ellipsis}`
            // args.goBackCommand
        );
        if (!repoPath) return undefined;

        if (args.isFileComment) {
            const allComments = await Container.commentService.loadComments(args.commit!);
            const fileComments = (allComments as Comment[])!.filter(
                c => c.Path === args.fileName && c.Type === CommentType.File
            );
            let fileCommands: CommandQuickPickItem[] = [];
            fileComments.forEach(element => {
                if (element.ParentId === undefined) {
                    fileCommands = [...fileCommands, ...AddLineCommentCommand.flattenCommands(0, element, uri)];
                }
            });
            const pick = await CommentsQuickPick.showFileComments(fileCommands, {
                addCommand: this.getAddFileCommentCommand(uri!, args.fileName!, args.commit!)
            });
            if (pick === undefined) return undefined;

            if (pick instanceof CommandQuickPickItem) return pick.execute();
        }
        const searchLabel: string | undefined = undefined;
        let progressCancellation: CancellationTokenSource | undefined = undefined;

        const comment: string | undefined = args.message;
        try {
            if (args.id) {
                if (!args.type) {
                    // show edit/reply comment
                    progressCancellation = CommentsQuickPick.showProgress(searchLabel!);
                    const pick = await CommentsQuickPick.show(comment!, {
                        deleteCommand: new CommandQuickPickItem(
                            {
                                label: `${Strings.pad(GlyphChars.Asterisk, 2, 3)} Delete Comment`,
                                description: `${Strings.pad(GlyphChars.Dash, 2, 3)} delete comment`
                            },
                            Commands.AddLineComment,
                            [uri, { ...args, type: operationTypes.Delete }]
                        ),
                        editCommand: new CommandQuickPickItem(
                            {
                                label: `${Strings.pad(GlyphChars.Pencil, 2, 3)} Edit Comment`,
                                description: `${Strings.pad(GlyphChars.Dash, 2, 3)} edit comment`
                            },
                            Commands.AddLineComment,
                            [uri, { ...args, type: operationTypes.Edit }]
                        ),
                        replyCommand: new CommandQuickPickItem(
                            {
                                label: `${Strings.pad(GlyphChars.Pencil, 2, 3)} Reply To Comment`,
                                description: `${Strings.pad(GlyphChars.Dash, 2, 3)} reply to comment`
                            },
                            Commands.AddLineComment,
                            [uri, { ...args, type: operationTypes.Reply }]
                        )
                    });

                    progressCancellation.cancel();

                    if (pick === undefined) return undefined;

                    if (pick instanceof CommandQuickPickItem) return pick.execute();
                }
                if (args.type === operationTypes.Edit) {
                    // edit comment.

                    // checking if it's allowed to spawn a new app
                    if (commentAppHelper.runningAppCount >= commentAppHelper.maxWindowAllowed) {
                        window.showWarningMessage(commentAppHelper.exceedsMaxWindowWarningMessage);
                        return undefined;
                    }

                    // spawn the external electron app
                    // that contains the customized UI for multiline comment
                    // currently a simple Markdown editor
                    const app = commentAppHelper.runApp(BITBUCKET_COMMENT_APP_NAME);
                    app.on('exit', function() {
                        const commentText = commentAppHelper.dataPayload;
                        if (commentText) {
                            // call service to edit the comment
                            Container.commentService.editComment(args.commit!, commentText!, args.id!);
                        }
                        // decreasing the runningAppCount by 1
                        const decreasedCount = commentAppHelper.runningAppCount - 1;
                        commentAppHelper.setRunningAppCount(decreasedCount);
                    });
                    // get comment from external app
                    commentAppHelper.getComment(args.message);
                }

                if (args.type === operationTypes.Reply) {
                    // reply comment

                    // checking if it's allowed to spawn a new app
                    if (commentAppHelper.runningAppCount >= commentAppHelper.maxWindowAllowed) {
                        window.showWarningMessage(commentAppHelper.exceedsMaxWindowWarningMessage);
                        return undefined;
                    }

                    // spawn the external electron app
                    // that contains the customized UI for multiline comment
                    // currently a simple Markdown editor
                    const app = commentAppHelper.runApp(BITBUCKET_COMMENT_APP_NAME);
                    app.on('exit', function() {
                        const commentText = commentAppHelper.dataPayload;
                        if (commentText) {
                            // call service to add the comment
                            Container.commentService.addComment(
                                args.commit!,
                                commentText as string,
                                args.fileName as string,
                                args.line,
                                args.id
                            );
                        }
                        // decreasing the runningAppCount by 1
                        const decreasedCount = commentAppHelper.runningAppCount - 1;
                        commentAppHelper.setRunningAppCount(decreasedCount);
                    });
                    // get comment from external app
                    commentAppHelper.getComment();
                }
                if (args.type === operationTypes.Delete) {
                    // delete comment.
                    const pick = await window.showQuickPick(['Yes', 'No'], {
                        placeHolder: 'Are you sure you want to delete this comment (Yes/No)?',
                        ignoreFocusOut: true
                    });
                    if (pick! === 'Yes') Container.commentService.deleteComment(args.commit!, args.id);
                }
            }
            else {
                // new comment.

                // checking if it's allowed to spawn a new app
                if (commentAppHelper.runningAppCount >= commentAppHelper.maxWindowAllowed) {
                    window.showWarningMessage(commentAppHelper.exceedsMaxWindowWarningMessage);
                    return undefined;
                }

                // spawn the external electron app
                // that contains the customized UI for multiline comment
                // currently a simple Markdown editor
                const app = commentAppHelper.runApp(BITBUCKET_COMMENT_APP_NAME);
                app.on('exit', function() {
                    const commentText = commentAppHelper.dataPayload;
                    if (commentText) {
                        // call service to add the comment
                        Container.commentService.addComment(
                            args.commit!,
                            commentText as string,
                            args.fileName as string,
                            args.line
                        );
                    }
                    // decreasing the runningAppCount by 1
                    const decreasedCount = commentAppHelper.runningAppCount - 1;
                    commentAppHelper.setRunningAppCount(decreasedCount);
                });
                // get comment from external app
                commentAppHelper.getComment();
            }

            return undefined;
        }
        catch (ex) {
            Logger.error(ex, 'AddLineCommentCommand');

            return window.showErrorMessage(`Unable to find comment. See output channel for more details`);
        }
        finally {
            if (progressCancellation !== undefined) {
                (progressCancellation as CancellationTokenSource)!.cancel();
            }
        }
    }
}
