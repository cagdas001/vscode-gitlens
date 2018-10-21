'use strict';
import { CommitSearchBootstrap } from '../ipc';
import { App } from '../shared/app-base';
import { DOM } from './../shared/dom';
const bootstrap: CommitSearchBootstrap = (window as any).bootstrap;

interface ShowDiffPost {
    type: string;
    file: string;
    repoPath: string;
    lsha?: string;
    rsha?: string;
    showIndex?: number;
}

interface FileCommitInfo {
    sha: string;
    prevSha?: string;
    nextSha?: string;
    date: Date;
    file: string;
    status: string;
}
interface HtmlTreeNode {
    title: string;
    fullPath: string;
    details: FileCommitInfo[];
    children?: HtmlTreeNode[];
    [propName: string]: any;
}
/*
interface HtmlTree {
    [index: number]: HtmlTreeNode;
}
*/
interface TreeData {
    fullPath?: string;
    [propName: string]: any;
}

interface TreeDataArray {
    [index: string]: TreeData;
}

export class CommitSearches extends App<CommitSearchBootstrap> {
    protected innerHeight: any;
    protected searchText: HTMLInputElement | null = null;
    private showDiffPosts: ShowDiffPost[] = [];

    constructor() {
        super('CommitSearches', bootstrap);
    }

    /**
     * This function checks if the commit details section's (right side) height exceeds
     * the default (65% * innerHeight) value of the commit list table.
     *
     * If so, sets the commit list's height to that value so that
     * both tables will grow in sync. Otherwise sets the default value.
     *
     * @param logsContainer The Container Div Element for the entire section
     * @param detailsContainer The Container Div element for the commit details (right side)
     */
    protected adjustHeight(logsContainer: HTMLDivElement, detailsContainer: HTMLDivElement) {
        this.innerHeight = window.innerHeight;
        const logsContainerHeight = +logsContainer.style.maxHeight!.replace('px', '');

        if (detailsContainer.scrollHeight > logsContainerHeight) {
            logsContainer.style.maxHeight = `${detailsContainer.scrollHeight}px`;
        }
        else {
            logsContainer.style.maxHeight = `${(65 * this.innerHeight) / 100}px`;
        }
    }

    protected onInitialize() {
        /**
         * Here we're setting the max-height value of the commit logs table
         * to 65% of the content height
         * So if the height of the table exceeds this value, user will be able to scroll down
         */
        this.innerHeight = window.innerHeight;
        const commitLogList = DOM.getElementById<HTMLDivElement>('commit-logs-table-container');
        commitLogList.style.maxHeight = `${(65 * this.innerHeight) / 100}px`;

        const tablesContainer = DOM.getElementById<HTMLDivElement>('logs-container');

        const searchText = DOM.getElementById<HTMLInputElement>('searchText');
        this.searchText = searchText;

        const branches = DOM.getElementById<HTMLSelectElement>('branches');
        const selectedCommits = DOM.getElementById<HTMLDivElement>('selected-commits');
        const selectedFiles = DOM.getElementById<HTMLDivElement>('selected-files');
        if (branches && this.bootstrap.branches!.length) {
            this.bootstrap.branches.forEach(branch => {
                const option = document.createElement('option');
                option.value = branch;
                const index = branch.indexOf('/');
                option.innerHTML = index !== -1 ? branch : `(local) ${branch}`;
                if (this.bootstrap.branch === branch) {
                    option.selected = true;
                }
                branches.appendChild(option);
            });

            branches.parentElement!.classList.remove('hidden');
        }

        const since = DOM.getElementById<HTMLSelectElement>('since');
        const before = DOM.getElementById<HTMLInputElement>('before');
        before.hidden = true;
        const after = DOM.getElementById<HTMLInputElement>('after');
        after.hidden = true;
        since.onchange = function(this: HTMLElement, ev: Event) {
            const ele = this as HTMLSelectElement;
            const before = DOM.getElementById<HTMLInputElement>('before');
            const after = DOM.getElementById<HTMLInputElement>('after');
            if (ele!.selectedIndex === 1) {
                before.hidden = false;
                after.hidden = false;
            }
            else {
                before.hidden = true;
                after.hidden = true;
            }
            ev.stopPropagation();
        };
        window.addEventListener('message', event => {
            if (event.data.type === 'searchLabel') {
                const searchMessage = DOM.getElementById<HTMLSpanElement>('searchMessage');
                searchMessage.innerText = event.data.searchLabel;
                return;
            }
            if (event.data.type === 'showDiff') {
                return;
            }

            // delete a previous html tree
            while (selectedFiles.firstChild) {
                selectedFiles.removeChild(selectedFiles.firstChild);
            }

            // delete selected commits
            while (selectedCommits.firstChild) {
                selectedCommits.removeChild(selectedCommits.firstChild);
            }

            // init selected commits list
            if (!selectedCommits.hasChildNodes()) {
                const ul = document.createElement('ul');
                ul.id = 'selected-commits-list';
                selectedCommits.appendChild(ul);
            }
            const commitedList = document.getElementById('selected-commits-list');

            const selectedFileCommitMap = new Map<string, FileCommitInfo[]>();
            const list = DOM.getElementById<HTMLTableElement>('logs');
            while (list.rows.length !== 0) {
                list.deleteRow(0);
            }
            list.createTBody();
            const dataMsg = event.data.msg as any[];
            dataMsg.forEach((element, rId) => {
                const r1 = list.insertRow();
                const c1 = r1.insertCell();

                const isMergeCommits = element.hasOwnProperty('commit') && element.commit.parentShas.length > 1;
                c1.innerHTML = `<div class='commit-label commit-label--list'>${isMergeCommits ? `<span class="icon-merge">Ⓜ</span>` : ''}${
                    element.label
                }</div><div>${element.description}</div>`;

                if (!element.commit) {
                    r1.hidden = true;
                }
                else {
                    const detailsRow = list.insertRow();
                    detailsRow.className = 'details-row';
                    r1.id = `commit-${element.commit.sha}`;
                    const c1 = detailsRow.insertCell();
                    c1.innerHTML = `<span>${element.detail}</span>`;
                    c1.id = `details-${rId}`;
                    detailsRow.hidden = true;

                    // User selects a commit
                    r1.onclick = () => {
                        detailsRow.hidden = !detailsRow.hidden;

                        if (detailsRow.hidden) {
                            const selectCommitRow = document.getElementById(`selected-` + r1.id) as HTMLElement;
                            selectCommitRow.parentElement!.removeChild(selectCommitRow);

                            // update the list fo selected files
                            const files = element.commit._fileName.split(',') as string[];
                            for (const file of files) {
                                const trimmedFilePath = file!.trim();
                                if (selectedFileCommitMap.has(trimmedFilePath)) {
                                    // delete a commit from the list
                                    const items = selectedFileCommitMap.get(trimmedFilePath!);
                                    selectedFileCommitMap.set(
                                        trimmedFilePath,
                                        items!.filter(e => e.sha !== element.commit.sha)
                                    );
                                    if (selectedFileCommitMap.get(trimmedFilePath)!.length === 0) {
                                        selectedFileCommitMap.delete(trimmedFilePath);
                                    }
                                }
                            }
                        }
                        else {
                            let branches = '';
                            if (Array.isArray(element.commit.branches) && element.commit.branches.length > 0) {
                                branches = `<div>In ${
                                    element.commit.branches.length
                                } branches: ${element.commit.branches.join(', ')}</div>`;
                            }

                            let showMoreLink: HTMLAnchorElement | undefined;
                            // Git service returns only first line of message for label
                            // If label and full message lengths are not same, there are more lines
                            if (element.label.length < element.commit.message.length) {
                                // replace the last three dots with link
                                element.label = element.label
                                    .replace(/\u2026/g, '')
                                    .replace(/\u00a0/g, '');
                                showMoreLink = document.createElement('a');
                                showMoreLink.href = '#';
                                showMoreLink.innerHTML = '... >';
                                showMoreLink.id = `show-more-${element.commit.sha}`;
                                showMoreLink.title = 'Show More';
                                showMoreLink.setAttribute('action', 'more');
                                showMoreLink.setAttribute('fullmsg', element.commit.message);
                                showMoreLink.setAttribute('summary', element.label);
                                showMoreLink.addEventListener('click', this.showMoreLess);
                            }
                            // add a commit to the list of selected commits
                            const selectedCommitRow = document.createElement('li');
                            selectedCommitRow.id = `selected-` + r1.id;
                            selectedCommitRow.innerHTML = `<div class='commit-label'>${element.label}</div><div>${element.commit._shortSha}${element.detail}</div>${branches}`;
                            // add show more link
                            if (showMoreLink) {
                                const commitLabel = selectedCommitRow.getElementsByClassName('commit-label').item(0);
                                commitLabel.appendChild(showMoreLink);
                            }
                            commitedList!.appendChild(selectedCommitRow);

                            // get the list of commited files
                            const files = element.commit._fileName.split(',') as string[];
                            for (const file of files) {
                                const trimmedFilePath = file.trim();
                                const status = element.commit.fileStatuses.filter(
                                    (x: any) => (x.fileName as string) === trimmedFilePath
                                );
                                const fileCommitInfo = {
                                    sha: element.commit.sha,
                                    prevSha: element.commit._previousSha,
                                    nextSha: element.commit.nextSha,
                                    date: new Date(element.commit.date),
                                    file: trimmedFilePath,
                                    status: status[0].status
                                };
                                if (selectedFileCommitMap.has(trimmedFilePath)) {
                                    selectedFileCommitMap.get(trimmedFilePath)!.push(fileCommitInfo);
                                }
                                else {
                                    selectedFileCommitMap.set(trimmedFilePath, [fileCommitInfo]);
                                }
                            }
                        }

                        // delete a previous html tree
                        while (selectedFiles.firstChild) {
                            selectedFiles.removeChild(selectedFiles.firstChild);
                        }

                        // build tree data from file path strings
                        const treeData = CommitSearches.createTreeData(selectedFileCommitMap);
                        const treeArray = CommitSearches.toTreeData(treeData) as HtmlTreeNode[];
                        treeArray.sort(CommitSearches.sortTree);

                        // display tree
                        const treeUl = document.createElement('ul');
                        treeUl.id = 'selected-files-list';
                        treeUl.className = 'tree';
                        selectedFiles.appendChild(treeUl);
                        const rootLi = document.createElement('li');
                        rootLi.className = 'open';
                        const a = document.createElement('a');
                        a.setAttribute('href', '#');
                        a.innerText = `${element.commit.repoPath}`;
                        rootLi.appendChild(a);
                        const ul = document.createElement('ul');
                        rootLi.appendChild(ul);
                        treeUl.appendChild(rootLi);
                        this.showDiffPosts = [];
                        this.displayTreeData(element.commit.repoPath, treeArray, ul);
                        this._api.postMessage({
                            type: 'saveDiffs',
                            diffs: this.showDiffPosts
                        });

                        // All nodes are expanded
                        const treeHtml = document.querySelectorAll('ul.tree a:not(:last-child)');
                        for (const treeNode of treeHtml) {
                            treeNode.addEventListener('click', event => {
                                const parent = (event.target as HTMLElement)['parentElement'] as HTMLElement;
                                const classList = parent.classList;
                                if (classList.contains('open')) {
                                    classList.remove('open');
                                    const opensubs = parent!.querySelectorAll(':scope .open');
                                    for (const opensub of opensubs) {
                                        opensub.classList.remove('open');
                                    }
                                }
                                else {
                                    classList.add('open');
                                }
                            });
                        }

                        this.adjustHeight(commitLogList, tablesContainer);
                    };

                    const seperator = list.insertRow();
                    const spCell = seperator.insertCell();
                    spCell.innerHTML = '<div class="seperator"></div>';
                }
            });
        });

        this._api.postMessage({
            type: 'search'
        });
    }

    // Create a file tree from file path strings
    static createTreeData(selectedFileCommitMap: Map<string, FileCommitInfo[]>) {
        const tree: TreeDataArray = {};
        selectedFileCommitMap.forEach((value, key, map) => {
            let currentNode = tree;
            const paths = key.split('/');
            for (let i = 0; i < paths.length; i++) {
                const fullPath = paths.slice(0, i + 1).join('/');
                if (currentNode[paths[i]] === undefined) {
                    if (i === paths.length - 1) {
                        currentNode[paths[i]] = { fullPath: fullPath, details: value };
                    }
                    else {
                        currentNode[paths[i]] = { fullPath: fullPath };
                    }
                }
                currentNode = currentNode[paths[i]];
            }
        });

        return tree;
    }

    // Convert the nested dictionaries into lists of children.
    // Basic algorithm:
    // 1. Each dictionary becomes an array of children.
    // 2. Each element of the array has a title, fullPath, commit details and a list of children.
    // 3. We recurse for the list of children (if we have children).
    static toTreeData(tree: TreeDataArray): HtmlTreeNode[] {
        return Object.keys(tree).map(
            function(title: string) {
                //  const that  = this as CommitSearches;
                const o = { title: title } as any;

                if (Object.keys(tree[title]).length > 0) {
                    if (tree[title]['fullPath'] !== undefined) {
                        o['fullPath'] = tree[title]['fullPath'];
                        delete tree[title]['fullPath'];
                    }

                    if (tree[title]['details'] !== undefined) {
                        o['details'] = tree[title]['details'];
                        delete tree[title]['details'];
                    }
                    if (Object.keys(tree[title]).length > 0) {
                        const children = CommitSearches.toTreeData(tree[title]) as HtmlTreeNode[];
                        children.sort(CommitSearches.sortTree);
                        o['children'] = children;
                    }
                }
                return o;
            }
            // .bind(this)
        );
    }

    // Sort file nodes against folder nodes. Files will be at the end.
    static sortTree(a: HtmlTreeNode, b: HtmlTreeNode) {
        if ((a.children && b.children) || (!a.children && !b.children)) {
            return a.title.localeCompare(b.title);
        }
        return !a.children ? 1 : -1;
    }

    // Sort commits by date
    private sortCommit(a: FileCommitInfo, b: FileCommitInfo) {
        if (a.date < b.date) return -1;
        if (a.date > b.date) return 1;
        return 0;
    }

    private displayTreeData(repoPath: string, tree: HtmlTreeNode[], selectedFiles: HTMLUListElement) {
        for (const item of tree) {
            const li = document.createElement('li');
            li.className = 'open';
            const a = document.createElement('a');
            a.setAttribute('href', '#');
            a.className = 'showdiff';
            let params: ShowDiffPost | undefined;
            try {
                const fileURI = item.fullPath;
                params = {
                    type: 'showDiff',
                    file: fileURI,
                    repoPath: repoPath,
                    lsha: undefined,
                    rsha: undefined,
                    showIndex: this.showDiffPosts.length
                };
                // The logic of comparison is based on Intelij Idea
                if (item.details.length === 1) {
                    params.lsha = item.details[0].prevSha;
                    params.rsha = item.details[0].sha;
                }
                else {
                    item.details!.sort(this.sortCommit);
                    params.lsha = item.details![0].prevSha;
                    params.rsha = item.details![item.details!.length - 1].sha;
                }
                this.showDiffPosts.push(params);
            }
            catch (error) {
                // params = undefined;
            }
            if (item.details && item.details.length === 1) {
                a.onclick = () => {
                    if (params) {
                        this._api.postMessage(params);
                    }
                };
            }
            a.innerText = `${item.title}`;
            li.appendChild(a);
            selectedFiles.appendChild(li);
            // display files
            if (item.children) {
                const ul = document.createElement('ul');
                li.appendChild(ul);
                this.displayTreeData(repoPath, item.children, ul);
            }
        }
    }

    protected onBind() {
        const that = this;
        DOM.listenAll('.postme', 'click', function(this: HTMLButtonElement) {
            that.doSearch();
        });

        DOM.listenAll('#showMergeCommits', 'change', function(this: HTMLButtonElement) {
            that.doSearch();
        });
    }

    protected showMoreLess(evt: MouseEvent) {
        const element = evt.target as HTMLAnchorElement;
        const idStartIndex = 'show-more-'.length;
        const idEndIndex = element.id.length;
        const sha = element.id.substring(idStartIndex, idEndIndex);
        const selectedCommit = DOM.getElementById(`selected-commit-${sha}`);
        const commitLabel = selectedCommit.getElementsByClassName('commit-label').item(0);
        const action = element.getAttribute('action');
        if (action === 'more') {
            commitLabel.innerHTML = element.getAttribute('fullmsg')!;
            commitLabel.appendChild(element);
            element.innerHTML = '< ...';
            element.title = 'Show Less';
            element.setAttribute('action' , 'less');
        }
        else if (action === 'less') {
            commitLabel.innerHTML = element.getAttribute('summary')!;
            commitLabel.appendChild(element);
            element.innerHTML = '... >';
            element.title = 'Show More';
            element.setAttribute('action' , 'more');
        }

    }

    protected doSearch() {
        const searchText = DOM.getElementById<HTMLInputElement>('searchText')!.value;
        const author = DOM.getElementById<HTMLInputElement>('author')!.value;
        const before = DOM.getElementById<HTMLInputElement>('before')!.value;
        const after = DOM.getElementById<HTMLInputElement>('after')!.value;
        const showMergeCommits = DOM.getElementById<HTMLInputElement>('showMergeCommits')!.checked;
        this._api.postMessage({
            type: 'search',
            search: searchText,
            branch: this.getBranch(),
            author: author,
            since: this.getSince(),
            before: before,
            after: after,
            showMergeCommits: showMergeCommits
        });
    }

    protected getBranch(): string {
        const branches = DOM.getElementById<HTMLSelectElement>('branches');
        return branches!.options![branches!.selectedIndex].value || 'all';
    }

    protected getSince(): string {
        const since = DOM.getElementById<HTMLSelectElement>('since');
        return since!.options![since!.selectedIndex].value;
    }
}
