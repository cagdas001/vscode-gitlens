'use strict';
import { CancellationTokenSource,  InputBoxOptions, window } from 'vscode';
import { GitCommentService } from '../gitCommentService';
import { Logger } from '../logger';
import { ActiveEditorCachedCommand, Commands } from './common';

/**
 * Command to prompt user for Bitbucket service credentials.
 */
export class BitBucketServiceAuthCommand extends ActiveEditorCachedCommand {
    constructor() {
        super(Commands.BitBuckerServiceAuth);
    }

    /**
     * Executes command to prompts user to enter bit bucket server crenitals.
     */
    async execute() {

        const progressCancellation: CancellationTokenSource | undefined = undefined;

        try {
            const username = await window.showInputBox({
                prompt: `Please enter your bit bucket service username`,
                placeHolder: `Bitbucket Service Username`
            } as InputBoxOptions);

            const password = await window.showInputBox({
                prompt: `Please enter your bit bucket service  password`,
                placeHolder: `Bitbucket Service Password`,
                password: true
            } as InputBoxOptions);

            GitCommentService.UseCredentials(username!, password!);

            return undefined;
        }
        catch (ex) {
            Logger.error(ex, 'BitBuckerServiceAuth');

            return window.showErrorMessage(`Unable to find comment. See output channel for more details`);
        }
        finally {
            if (progressCancellation !== undefined) {
                (progressCancellation as CancellationTokenSource)!.cancel();
            }
        }
    }
}
