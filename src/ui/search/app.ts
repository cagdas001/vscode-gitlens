'use strict';
import { CommitSearchBootstrap } from '../ipc';
import { App } from '../shared/app-base';
import { DOM } from './../shared/dom';
import { StatusIcon } from '../config';
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
    private selectedFileCommitMap = new Map<string, FileCommitInfo[]>();
    private repoPath: string = '';

    constructor() {
        super('CommitSearches', bootstrap);
    }

    protected isCustomEvent(event: Event): event is CustomEvent {
        return 'detail' in event;
    }

    protected onInitialize() {
        /**
         * Here we're setting the max-height value of the commit logs table
         * to 100% - 150px of the content height
         * So if the height of the table exceeds this value, user will be able to scroll down
         */
        this.innerHeight = window.innerHeight;
        const commitLogList = DOM.getElementById<HTMLDivElement>('commit-logs-table-container');
        commitLogList.style.maxHeight = `${(this.innerHeight - 150)}px`;

        const commitDetails = DOM.getElementById<HTMLDivElement>('commit-details-container');
        commitDetails.style.maxHeight = `${(this.innerHeight - 150)}px`;

        window.addEventListener('resize', event => {
            this.innerHeight = window.innerHeight;
            commitLogList.style.maxHeight = `${(this.innerHeight - 150)}px`;
            commitDetails.style.maxHeight = `${(this.innerHeight - 150)}px`;
        });

        const searchText = DOM.getElementById<HTMLInputElement>('searchText');
        this.searchText = searchText;

        const branches = DOM.getElementById<HTMLSelectElement>('branches');
        const selectedCommitsDOM = DOM.getElementById<HTMLDivElement>('selected-commits');
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
            while (selectedCommitsDOM.firstChild) {
                selectedCommitsDOM.removeChild(selectedCommitsDOM.firstChild);
            }

            // init selected commits list
            if (!selectedCommitsDOM.hasChildNodes()) {
                const ul = document.createElement('ul');
                ul.id = 'selected-commits-list';
                selectedCommitsDOM.appendChild(ul);
            }

            this.selectedFileCommitMap = new Map<string, FileCommitInfo[]>();
            const list = DOM.getElementById<HTMLTableElement>('jstree');
            const dataMsg = event.data.msg as any[];
            if (dataMsg[1].label === 'No results found') {
                list.innerHTML = 'No results found';
                return;
            }

            const commits: any[] = [];

            dataMsg
                .forEach((element) => {
                    if (element.hasOwnProperty('results')) {
                        this.repoPath = element.results.repoPath;
                    }
                    else if (element.hasOwnProperty('commit')) {
                        const { commit, label, commitFormattedDate } = element;
                        // const isMergeCommit = commit.parentShas.length > 1;
                        const title = `${label} • ${commit.author}, ${commitFormattedDate} (${commit._shortSha})`;

                        commits.push({
                            text: title,
                            state: {
                                opened: false,
                                selected: false
                            },
                            selectable: true,
                            data: element,
                            children: commit.fileStatuses.map((fileStatus: any) => ({
                                text: fileStatus.fileName,
                                isFile: true,
                                icon: `${this.bootstrap.rootPath}/images/dark/${StatusIcon[fileStatus.status]}`,
                                data: {
                                    fullPath: fileStatus.fileName,
                                    details: [
                                        {
                                            prevSha: commit._previousSha,
                                            sha: commit.sha
                                        }
                                    ]
                                }
                            }))
                        });
                    }
            });

            const commitsEvent = new CustomEvent('commits', {
                bubbles: true,
                detail: commits
            });
            window.dispatchEvent(commitsEvent);
        });

        window.addEventListener('treeNodeClick', (e: Event) => {
            if (!this.isCustomEvent(e)) throw new Error('not a custom event');

            const clickedNode = e.detail.node;
            if (!clickedNode.original.isFile) return;

            this.showDiff(clickedNode.data);

        });

        window.addEventListener('treeChange', (e: Event) => {
            if (!this.isCustomEvent(e)) throw new Error('not a custom event');

            const commitedList = document.getElementById('selected-commits-list');
            // init selected commits list
            if (commitedList) {
                commitedList.innerHTML = '';
            }

            // reset file commits
            this.selectedFileCommitMap = new Map<string, FileCommitInfo[]>();

            const selectedCommits = e.detail.selectedNodes;

            for(let selectedCommit of selectedCommits) {
                if (!selectedCommit.data) continue;

                const { commit, label, detail } = selectedCommit.data;

                let branches = '';
                if (Array.isArray(commit.branches) && commit.branches.length > 0) {
                    branches = `<div>In ${
                        commit.branches.length
                        } branches: ${commit.branches.join(', ')}</div>`;
                }

                let showMoreLink: HTMLAnchorElement | undefined;
                // Git service returns only first line of message for label
                // If label and full message lengths are not same, there are more lines
                let replacedLabel = label;
                if (label.length < commit.message.length) {
                    // replace the last three dots with link
                    replacedLabel = label
                        .replace(/\u2026/g, '')
                        .replace(/\u00a0/g, '');
                    showMoreLink = document.createElement('a');
                    showMoreLink.href = '#';
                    showMoreLink.innerHTML = '... >';
                    showMoreLink.id = `show-more-${commit.sha}`;
                    showMoreLink.title = 'Show More';
                    showMoreLink.setAttribute('action', 'more');
                    showMoreLink.setAttribute('fullmsg', commit.message);
                    showMoreLink.setAttribute('summary', replacedLabel);
                    showMoreLink.addEventListener('click', this.showMoreLess);
                }
                // add a commit to the list of selected commits
                const selectedCommitRow = document.createElement('li');
                selectedCommitRow.id = `selected-commit-${commit.sha}`;
                selectedCommitRow.innerHTML = `<div class='commit-label'>${replacedLabel}</div><div>${commit._shortSha}${detail}</div>${branches}`;
                // add show more link
                if (showMoreLink) {
                    const commitLabel = selectedCommitRow.getElementsByClassName('commit-label').item(0);
                    commitLabel.appendChild(showMoreLink);
                }
                commitedList!.appendChild(selectedCommitRow);

                // get the list of commited files
                const files = commit._fileName.split(',') as string[];
                for (const file of files) {
                    const trimmedFilePath = file.trim();
                    const status = commit.fileStatuses.filter(
                        (x: any) => (x.fileName as string) === trimmedFilePath
                    );
                    const fileCommitInfo = {
                        sha: commit.sha,
                        prevSha: commit._previousSha,
                        nextSha: commit.nextSha,
                        date: new Date(commit.date),
                        file: trimmedFilePath,
                        status: status[0].status
                    };
                    if (this.selectedFileCommitMap.has(trimmedFilePath)) {
                        this.selectedFileCommitMap.get(trimmedFilePath)!.push(fileCommitInfo);
                    }
                    else {
                        this.selectedFileCommitMap.set(trimmedFilePath, [fileCommitInfo]);
                    }
                }
            }

            // delete a previous html tree
            while (selectedFiles.firstChild) {
                selectedFiles.removeChild(selectedFiles.firstChild);
            }

            // build tree data from file path strings
            const treeData = CommitSearches.createTreeData(this.selectedFileCommitMap);
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
            a.innerText = `${this.repoPath}`;
            rootLi.appendChild(a);
            const ul = document.createElement('ul');
            rootLi.appendChild(ul);
            treeUl.appendChild(rootLi);
            this.showDiffPosts = [];
            this.displayTreeData(this.repoPath, treeArray, ul);
            this._api.postMessage({
                type: 'saveDiffs',
                diffs: this.showDiffPosts
            });

            // All nodes are expanded
            const treeHtml = document.querySelectorAll('ul.tree a:not(:last-child)');
            for (const treeNode of treeHtml) {
                treeNode.addEventListener('click', (event: Event) => {
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

    private showDiff(item: any) {
        let params: ShowDiffPost | undefined;
        const showDiffPosts = [];
        try {
            const fileURI = item.fullPath;
            params = {
                type: 'showDiff',
                file: fileURI,
                repoPath: this.repoPath,
                lsha: undefined,
                rsha: undefined,
                showIndex: showDiffPosts.length
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
            showDiffPosts.push(params);
        }
        catch (error) {
            // params = undefined;
        }

        if (item.details && item.details.length >= 1 && params) {
            this._api.postMessage(params);
        }
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
            if (item.details && item.details.length >= 1) {
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

        DOM.listenAll('#searchText', 'keydown', function(event: KeyboardEventInit) {
            if (event.key === 'Enter') {
                that.doSearch();
            }
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
        const searchHash = DOM.getElementById<HTMLInputElement>('searchHash')!.value;
        const author = DOM.getElementById<HTMLInputElement>('author')!.value;
        const before = DOM.getElementById<HTMLInputElement>('before')!.value;
        const after = DOM.getElementById<HTMLInputElement>('after')!.value;
        const showMergeCommits = DOM.getElementById<HTMLInputElement>('showMergeCommits')!.checked;
        this._api.postMessage({
            type: 'search',
            search: searchText,
            branch: this.getBranch(),
            author: author,
            sha: searchHash,
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
