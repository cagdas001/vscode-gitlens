'use strict';
import { CancellationTokenSource, QuickPickOptions, window } from 'vscode';
import { KeyNoopCommand } from '../keyboard';
import {
    CommandQuickPickItem,
    getQuickPickIgnoreFocusOut,
    QuickPickItem,
    showQuickPickProgress
} from './commonQuickPicks';

import { Container } from '../container';

/**
 * Comments quick pick class to supports interactions with end user to
 * perform add/edit/delete a file or an inline comment.
 */
export class CommentsQuickPick {
    /**
     * Shows progress bar.
     * @param message message to be displayed which progress is active.
     */
    static showProgress(message: string) {
        return showQuickPickProgress(message, {
            left: KeyNoopCommand,
            ',': KeyNoopCommand,
            '.': KeyNoopCommand
        });
    }

    /**
     * Shows UI Controls to interact with user to add/edit/delete a comment.
     * @param placeHolder
     * @param progressCancellation
     * @param options
     */
    static async show(
        placeHolder: string,
        options: {
            deleteCommand?: CommandQuickPickItem;
            editCommand?: CommandQuickPickItem;
            replyCommand?: CommandQuickPickItem;
        } = {}
    ): Promise<CommandQuickPickItem | undefined> {
        const items: CommandQuickPickItem[] = [];

        if (options.deleteCommand !== undefined) {
            items.splice(0, 0, options.deleteCommand);
        }
        if (options.editCommand !== undefined) {
            items.splice(0, 0, options.editCommand);
        }
        if (options.replyCommand !== undefined) {
            items.splice(0, 0, options.replyCommand);
        }

        const scope = await Container.keyboard.beginScope({ left: options.editCommand });

        const pick = await window.showQuickPick(items, {
            placeHolder: placeHolder,
            ignoreFocusOut: getQuickPickIgnoreFocusOut(),
            onDidSelectItem: (item: QuickPickItem) => {
                void scope.setKeyCommand('right', item);
                if (typeof item.onDidSelect === 'function') {
                    item.onDidSelect();
                }
            }
        } as QuickPickOptions);

        return pick;
    }

    /**
     * UI to list/add/edit/delete file level comments/replies.
     * @param items File level comments to be listed.
     * @param options Options for rendering quick pick items
     */
    static async showFileComments(
        items: CommandQuickPickItem[],
        options: {
            addCommand?: CommandQuickPickItem;
            cancelCommand?: CommandQuickPickItem;
        } = {}
    ): Promise<CommandQuickPickItem | undefined> {

        const placeHolder = items.length === 0 ? 'No comments found' : 'Select/add comments';

        if (options.addCommand !== undefined) {
            items.splice(0, 0, options.addCommand);
        }

        const scope = await Container.keyboard.beginScope({ left: options.addCommand });

        const pick = await window.showQuickPick(items, {
            placeHolder: placeHolder,
            ignoreFocusOut: getQuickPickIgnoreFocusOut(),
            onDidSelectItem: (item: QuickPickItem) => {
                void scope.setKeyCommand('right', item);
                if (typeof item.onDidSelect === 'function') {
                    item.onDidSelect();
                }
            }
        } as QuickPickOptions);

        return pick;
    }
}
