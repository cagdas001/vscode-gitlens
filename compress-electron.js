/**
 * This file provides a temporary solution/script for macOS
 * https://gitlab.com/aggregated-git-diff/aggregated-git-diff-bug-bash/issues/84
 * https://gitlab.com/aggregated-git-diff/aggregated-git-diff-bug-bash/issues/85
 */

'use strict';
const path = require('path');
const fs = require('fs');
const exec = require('child_process').exec;

var deleteFolderRecursive = function(path) {
    if (fs.existsSync(path)) {
        fs.readdirSync(path).forEach(function(file, index) {
            var curPath = path + '/' + file;
            if (fs.lstatSync(curPath).isDirectory()) {
                // recurse
                deleteFolderRecursive(curPath);
            } else {
                // delete file
                fs.unlinkSync(curPath);
            }
        });
        fs.rmdirSync(path);
    }
};

if (process.platform === 'darwin') {
    const electron_name = 'Electron.app';
    const dist_path = path.join(__dirname, 'node_modules', 'electron', 'dist');
    const electron_path = path.join(dist_path, electron_name);
    const tar_path = path.join(dist_path, 'compressed-electron.tar.gz');
    exec(`tar -C ${dist_path} -zcf ${tar_path} ${electron_name}`, () => {
        console.log('Electron.app compressed.');
        deleteFolderRecursive(electron_path);
        console.log('Electron.app deleted.');
    });
}
