/******/ (() => { // webpackBootstrap
/******/ 	var __webpack_modules__ = ({

/***/ 155:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const core = __nccwpck_require__(671);

module.exports = { getCommitFiles, getReposList, createPr, getRepo, getBranchesRemote };

async function getCommitFiles(octokit, commitId, owner, repo) {
  const { data: { files } } = await octokit.repos.getCommit({
    owner,
    repo,
    ref: commitId
  });

  return files;
}

async function getBranchesRemote(octokit, owner, repo) {
  core.info('Getting list of all the branches for the repository');

  const allBranches = await octokit.paginate(
    octokit.repos.listBranches,
    {
      owner,
      repo
    },
    (response) => response.data
  );

  core.debug('DEBUG: Full response about branches');
  core.debug(JSON.stringify(allBranches, null, 2));

  const branchesList = allBranches.map((branch) => {
    return {
      name: branch.name,
    };
  });

  core.debug('DEBUG: List of all branches');
  core.debug(JSON.stringify(branchesList, null, 2));

  return branchesList;
}

async function getRepo(octokit, owner, repo) {
  core.info(`Getting details of manually selected ${repo} repository`);

  const { data } = await octokit.repos.get({
    owner,
    repo
  });

  const repoDetails = {
    name: data.name,
    url: data.html_url,
    id: data.node_id,
    defaultBranch: data.default_branch,
    private: data.private,
    fork: data.fork,
    archived: data.archived,
    topics: data.topics,
  };

  core.debug(`DEBUG: Repo ${repo} full response`);
  core.debug(JSON.stringify(data, null, 2));
  core.debug(`DEBUG: Repo ${repo} response that will be returned`);
  core.debug(JSON.stringify(repoDetails, null, 2));

  return repoDetails;
}

async function getReposList(octokit, owner) {
  let isUser;
  let response;

  core.startGroup(`Getting list of all repositories owned by ${owner}`);
  /*
  * Checking if action runs for organization or user as then to list repost there are different api calls
  */
  try {
    await octokit.orgs.get({
      org: owner,
    });

    isUser = false;
  } catch (error) {
    if (error.status === 404) {
      try {
        await octokit.users.getByUsername({
          username: owner,
        });
        isUser = true;
      } catch (error) {
        throw new Error(`Invalid user/org: ${  error}`);
      }
    } else {
      throw new Error(`Failed checking if workflow runs for org or user: ${  error}`);
    }
  }

  /*
  * Getting list of repos
  */
  if (isUser) {
    response = await octokit.paginate(octokit.repos.listForUser, {
      username: owner,
      per_page: 100
    });
  } else {
    response = await octokit.paginate(octokit.repos.listForOrg, {
      org: owner,
      per_page: 100
    });
  }

  const reposList = response.map((repo) => {
    return {
      name: repo.name,
      url: repo.html_url,
      id: repo.node_id,
      defaultBranch: repo.default_branch,
      private: repo.private,
      fork: repo.fork,
      archived: repo.archived,
      topics: repo.topics,
    };
  });

  core.debug(`DEBUG: list of repositories for ${owner}:`);
  core.debug(JSON.stringify(reposList, null, 2));
  core.endGroup();

  return reposList;
}

async function createPr(octokit, branchName, id, commitMessage, defaultBranch) {
  // Разделяем commitMessage на title и body
  const [title, ...bodyLines] = commitMessage.split('\n');
  const body = bodyLines.length > 0 ? bodyLines.join('\n') : undefined;

  const createPrMutation =
    `mutation createPr($branchName: String!, $id: ID!, $title: String!, $body: String, $defaultBranch: String!) {
      createPullRequest(input: {
        baseRefName: $defaultBranch,
        headRefName: $branchName,
        title: $title,
        body: $body,
        repositoryId: $id
      }){
        pullRequest {
          url
        }
      }
    }
    `;

  const newPrVariables = {
    branchName,
    id,
    title,
    body,
    defaultBranch
  };

  let retries = 5;
  let count = 0;

  while (retries-- > 0) {
    count++;
    try {
      core.info('Waiting 5sec before PR creation');
      await sleep(5000);
      core.info(`PR creation attempt ${count}`);
      const { createPullRequest: { pullRequest: { url: pullRequestUrl } } } = await octokit.graphql(createPrMutation, newPrVariables);
      retries = 0;
      return pullRequestUrl;
    } catch (error) {
      //if error is different than rate limit/timeout related we should throw error as it is very probable that
      //next PR will also fail anyway, we should let user know early in the process by failing the action
      if (error.message !== 'was submitted too quickly') {
        throw new Error(`Unable to create a PR: ${  error}`);
      }
    }
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}


/***/ }),

/***/ 527:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const core = __nccwpck_require__(671);
const { getAuthanticatedUrl } = __nccwpck_require__(430);
const REMOTE = 'auth';

module.exports = {createBranch, clone, push, areFilesChanged, getBranchesLocal, checkoutBranch};

async function checkoutBranch(branchName, git) {
  core.info(`Checking out branch ${branchName}.`);
  await git.fetch(REMOTE, branchName);
  await git.checkout(`${branchName}`);
}

async function createBranch(branchName, git) {
  core.info(`Creating branch ${branchName}.`);
  return await git
    .checkout(`-b${branchName}`);
}

async function clone(token, remote, dir, git) {
  core.info(`Cloning ${remote}`);
  const remoteWithToken = getAuthanticatedUrl(token, remote);
  await git.clone(remoteWithToken, dir, {'--depth': 1});
  await git.addRemote(REMOTE, remoteWithToken);
}

async function getBranchesLocal(git) {
  return await git.branchLocal();
}

async function push(branchName, message, committerUsername, committerEmail, git) {
  if (core.isDebug()) (__nccwpck_require__(723).enable)('simple-git');
  core.info('Pushing changes to remote');
  await git.addConfig('user.name', committerUsername);
  await git.addConfig('user.email', committerEmail);
  await git.commit(message);
  try {
    await git.push(['-u', REMOTE, branchName]);
  } catch (error) {
    core.info('Not able to push:', error);
    try {
      await git.pull([REMOTE, branchName]);
    } catch (error) {
      core.info('Not able to pull:', error);
      await git.merge(['-X', 'ours', branchName]);
      core.debug('DEBUG: Git status after merge');
      core.debug(JSON.stringify(await git.status(), null, 2));
      await git.add('./*');
      await git.commit(message);
      await git.push(['-u', REMOTE, branchName]);
    }
  }
}

async function areFilesChanged(git) {
  await git.add('./*');
  const status = await git.status();
  core.debug('DEBUG: List of differences spotted in the repository');
  core.debug(JSON.stringify(status, null, 2));

  return status.files.length > 0;
}
  


/***/ }),

/***/ 430:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const { copy, remove } = __nccwpck_require__(862);
const { readdir, stat } = (__nccwpck_require__(896).promises);
const path = __nccwpck_require__(928);
const core = __nccwpck_require__(671);
const { getCommitFiles, getBranchesRemote } = __nccwpck_require__(155);

module.exports = { copyChangedFiles, parseCommaList, getListOfReposToIgnore, getBranchName, getListOfFilesToReplicate, getAuthanticatedUrl, isInitialized, getBranchesList, filterOutMissingBranches, filterOutFiles, getFilteredFilesList, getFileName, removeFiles, getFiles };

/**
 * @param  {Object} octokit GitHub API client instance
 * @param  {Object} commitId Id of the commit to check for files changes
 * @param  {String} owner org or user name
 * @param  {String} repo repo name
 * @param  {String} patternsToIgnore comma-separated list of file paths or directories that should be ignored
 * @param  {String} patternsToInclude comma-separated list of file paths or directories that should be replicated
 * @param  {String} triggerEventName name of the event that triggered the workflow
 * 
 * @returns {Object<Array<String>>} list of filepaths of modified files
 */
async function getListOfFilesToReplicate(octokit, commitId, owner, repo, patternsToIgnore, patternsToInclude, triggerEventName) {
  let filesToCheckForReplication;
  let filesToCheckForRemoval;

  core.startGroup('Getting list of workflow files that need to be replicated in other repositories');

  if (triggerEventName === 'push') {
    const commitFiles = await getCommitFiles(octokit, commitId, owner, repo);
    core.debug(`DEBUG: list of files modified in commit ${commitId}. Full response from API:`);
    core.debug(JSON.stringify(commitFiles, null, 2));
    //filtering out files that show in commit as removed
    filesToCheckForReplication = getFiles(commitFiles, false);
    //remember files that show in commit as removed
    filesToCheckForRemoval = getFiles(commitFiles, true);
  }

  if (triggerEventName === 'workflow_dispatch') {
    const root = process.cwd();
    filesToCheckForReplication = (await getFilesListRecursively(root)).map(filepath => path.relative(root, filepath));
    filesToCheckForRemoval = [];
    core.debug(`DEBUG: list of files from the repo is ${filesToCheckForReplication}`);
  }
  
  const filesForRemoval = getFilteredFilesList(filesToCheckForRemoval, patternsToIgnore, patternsToInclude);
  const filesForReplication = getFilteredFilesList(filesToCheckForReplication, patternsToIgnore, patternsToInclude);

  if (!filesForReplication.length) {
    core.info('No changes were detected.');
  } else {
    core.info(`Files that need replication are: ${filesForReplication}.`);
  }

  core.endGroup();

  return { filesForReplication, filesForRemoval };
}

/**
 * Get a list of all files recursively in file path
 * 
 * @param {String} filepath 
 * 
 * @returns {Array<String>} list of filepaths in path directory
 */
async function getFilesListRecursively(filepath) {
  const paths = await readdir(filepath);

  const fullpaths = paths.map(async filename => {
    const fullpath = path.join(filepath, filename);
    const stats = await stat(fullpath);

    if (stats.isFile()) {
      return fullpath;
    } else if (stats.isDirectory()) {
      return (await getFilesListRecursively(fullpath)).flat();
    }
  });

  return (await Promise.all(fullpaths)).flat();
}

/**
 * Get a list of files to replicate
 * 
 * @param  {Array} filesToCheckForReplication list of all paths that are suppose to be replicated
 * @param  {String} filesToIgnore Comma-separated list of file paths or directories to ignore
 * @param  {String} patternsToInclude Comma-separated list of file paths or directories to include
 *
* @returns  {Array}
 */
function getFilteredFilesList(filesToCheckForReplication, filesToIgnore, patternsToInclude) {
  const filesWithoutIgnored = filterOutFiles(filesToCheckForReplication, filesToIgnore, true);
  return filterOutFiles(filesWithoutIgnored, patternsToInclude, false);
}

/**
 * Get list of files that should be replicated because they are supposed to be ignored, or because they should not be ignored
 * 
 * @param  {Array} filesToFilter list of all paths that are suppose to be replicated
 * @param  {String} patterns Comma-separated list of file paths or directories
 * @param  {Boolean} ignore true means files that matching patters should be filtered out, false means that only matching patterns should stay
 *
* @returns  {Array}
 */
function filterOutFiles(filesToFilter, patterns, ignore) {
  const filteredList = [];
  const includePatternsList = patterns ? parseCommaList(patterns) : [];

  for (const filename of filesToFilter) {
    const isMatching = !!includePatternsList.map(pattern => {
      return filename.includes(pattern);
    }).filter(Boolean).length;

    if (!ignore && isMatching) filteredList.push(filename);
    if (ignore && !isMatching) filteredList.push(filename);
  }

  return filteredList;
}

/**
 * Assemble a list of repositories that should be ignored.
 * 
 * @param  {String} repo The current repository.
 * @param  {Array} reposList All the repositories.
 * @param  {String} inputs.reposToIgnore A comma separated list of repositories to ignore.
 * @param  {String} inputs.topicsToInclude A comma separated list of topics to include.
 * @param  {Boolean} inputs.excludePrivate Exclude private repositories.
 * @param  {Boolean} inputs.excludeForked Exclude forked repositories.
 * 
 * @returns  {Array}
 */
function getListOfReposToIgnore(repo, reposList, inputs) {
  const {
    reposToIgnore,
    topicsToInclude,
    excludePrivate,
    excludeForked,
  } = inputs;

  core.startGroup('Getting list of repos to be ignored');

  //manually ignored repositories.
  const ignoredRepositories = reposToIgnore ? parseCommaList(reposToIgnore) : [];

  // Exclude archived repositories by default. The action will fail otherwise.
  const EXCLUDE_ARCHIVED = true;
  if (EXCLUDE_ARCHIVED === true) {
    ignoredRepositories.push(...archivedRepositories(reposList));
  }

  //by default repo where workflow runs should always be ignored.
  ignoredRepositories.push(repo);

  // if topics_to_ignore is set, get ignored repositories by topics.
  if (topicsToInclude.length) {
    ignoredRepositories.push(...ignoredByTopics(topicsToInclude, reposList));
  }

  // Exclude private repositories.
  if (excludePrivate === true) {
    ignoredRepositories.push(...privateRepositories(reposList));
  }

  // Exclude forked repositories
  if (excludeForked === true) {
    ignoredRepositories.push(...forkedRepositories(reposList));
  }

  if (!ignoredRepositories.length) {
    core.info('No repositories will be ignored.');
  } else {
    core.info(`Repositories that will be ignored: ${ignoredRepositories}.`);
  }

  core.endGroup();

  return ignoredRepositories;
}

/**
 * @param  {Array} filesList list of files that need to be copied
 * @param  {String} root root destination in the repo, always ./
 * @param  {String} destination in case files need to be copied to soom custom location in repo
 */
async function copyChangedFiles(filesList, root, destination) {
  core.info('Copying files');
  core.debug(`DEBUG: Copying files to root ${root} and destination ${destination} - if provided (${!!destination}). Where process.cwd() is ${process.cwd()}`);

  await Promise.all(filesList.map(async filePath => {
    return destination
      ? await copy(path.join(process.cwd(), filePath), path.join(root, destination, getFileName(filePath)))
      : await copy(path.join(process.cwd(), filePath), path.join(root, filePath));
  }));
}

/**
 * @param  {Array|String} toRemove comma-separated list of patterns that specify where and what should be removed or array of files to remove
 * @param  {String} root root of cloned repo
 * @param  {Object}options
 * {String} patternsToIgnore comma-separated list of file paths or directories that should be ignored
 * {String} destination in case files need to be removed from soom custom location in repo
 */
async function removeFiles(toRemove, root, { patternsToIgnore, destination }) {
  let filesForRemoval;

  const isListString = typeof toRemove === 'string';
  core.info('Removing files');
  if (!isListString) core.debug(`DEBUG: Removing to the following files: ${filesForRemoval}`);
  core.debug(`DEBUG: Removing files from root ${root} Where process.cwd() is ${process.cwd()}`);

  if (isListString) {
    const filesToCheckForRemoval = (await getFilesListRecursively(root)).map(filepath => path.relative(root, filepath));
    filesForRemoval = getFilteredFilesList(filesToCheckForRemoval, patternsToIgnore, toRemove);
  
    core.debug(`DEBUG: Provided patterns ${toRemove} relate to the following files: ${filesForRemoval}`);
  } else {
    filesForRemoval = toRemove;
  }

  await Promise.all(filesForRemoval.map(async filePath => {
    return await remove(destination ?
      path.join(root, destination, getFileName(filePath)) :
      path.join(root, filePath));
  }));
}

/**
 * @param  {String} filePath full filepath to the file
 * @returns  {String} filename with extension
 */
function getFileName(filePath) {
  return filePath.split('/').slice(-1)[0];
}

/**
 * @param  {String} list names of values that can be separated by comma
 * @returns  {Array<String>} input names not separated by string but as separate array items
 */
function parseCommaList(list) {
  return list.split(',').map(i => i.trim().replace(/['"]+/g, '')).filter(Boolean);
}

/**
 * Create a branch name. 
 * If commitId is not provided then it means action was not triggered by push and name must have some generated number and indicate manual run
 * 
 * @param  {String} commitId id of commit that should be added to branch name for better debugging of changes
 * @param  {String} branchName name of the branch that new branch will be cut from
* @returns  {String}
 */
function getBranchName(commitId, branchName) {
  return commitId ? `bot/update-global-workflow-${branchName}-${commitId}` : `bot/manual-update-global-workflow-${branchName}-${Math.random().toString(36).substring(7)}`;
}

/**
 * Get list of branches that this action should operate on
 * @param  {Object} octokit GitHub API client instance
 * @param  {String} owner org or user name
 * @param  {String} repo repo name
 * @param  {String} branchesString comma-separated list of branches
 * @param  {String} defaultBranch name of the repo default branch
 * @returns  {Array<Object, Object>} first index is object with branches that user wants to operate on and that are in remote, next index has all remote branches
 */
async function getBranchesList(octokit, owner, repo, branchesString, defaultBranch) {
  core.info('Getting list of branches the action should operate on');
  const branchesFromRemote = await getBranchesRemote(octokit, owner, repo);

  //we need to match if all branches that user wants this action to support are on the server and can actually be supported
  //branches not available an remote will not be included
  const filteredBranches = filterOutMissingBranches(branchesString, branchesFromRemote, defaultBranch);

  core.info(`This is a final list of branches action will operate on: ${JSON.stringify(filteredBranches, null, 2)}`);

  return [filteredBranches, branchesFromRemote];
}

/**
 * Get array of branches without the ones that do not exist in remote
 * @param  {String} branchesRequested User requested branches
 * @param  {Array<Object>} branchesExisting Existing branches
 * @param  {String} defaultBranch Name of repo default branch
 * @returns  {Array<Object>}
 */
function filterOutMissingBranches(branchesRequested, branchesExisting, defaultBranch) {
  const branchesArray = branchesRequested
    ? parseCommaList(branchesRequested)
    : [`^${defaultBranch}$`];

  core.info(`These were requested branches: ${branchesRequested}`);
  core.info(`This is default branch: ${defaultBranch}`);

  return branchesExisting.filter(branch => {
    // return branchesArray.includes(branch.name);
    return branchesArray.some(b => {
      const regex = new RegExp(b);
      return regex.test(branch.name);
    });
  });
}

/**
 * Creates a url with authentication token in it
 * 
 * @param  {String} token access token to GitHub
 * @param  {String} url repo URL
 * @returns  {String}
 */
function getAuthanticatedUrl(token, url) {
  const arr = url.split('//');
  return `https://${token}@${arr[arr.length - 1]}.git`;
};

/**
 * Checking if repo is initialized cause if it isn't we need to ignore it
 * 
 * @param  {Array<Object>} branches list of all local branches with detail info about them
 * @param  {String} defaultBranch name of default branch that is always set even if repo not initialized
 * @returns  {Boolean}
 */
function isInitialized(branches, defaultBranch) {
  core.info('Checking if repo initialized.');
  core.debug('DEBUG: list of local branches');
  core.debug(JSON.stringify(branches.branches, null, 2));

  return !!branches.branches[defaultBranch];
}

/**
 * Getting list of topics that should be included if topics_to_include is set.
 * Further on we will get a list of repositories that do not belong to any of the specified topics.
 * 
 * @param  {String} topicsToInclude Comma separated list of topics to include.
 * @param  {Array} reposList All the repositories.
 * @returns {Array} List of all repositories to exclude.
 */
function ignoredByTopics(topicsToInclude, reposList) {
  const includedTopics = topicsToInclude ? parseCommaList(topicsToInclude) : [];

  if (!includedTopics.length) return;

  return reposList.filter(repo => {
    return includedTopics.some(topic => repo.topics.includes(topic)) === false;
  }).map(reposList => reposList.name);
}

/**
 * Returns a list of archived repositories.
 * 
 * @param  {Array} reposList All the repositories.
 * @returns {Array}
 */
function archivedRepositories(reposList) {
  return reposList.filter(repo => {
    return repo.archived === true;
  }).map(reposList => reposList.name);
}

/**
 * Returns a list of private repositories.
 * 
 * @param  {Array} reposList All the repositories.
 * @returns {Array}
 */
function privateRepositories(reposList) {
  return reposList.filter(repo => {
    return repo.private === true;
  }).map(reposList => reposList.name);
}

/**
 * Returns a list of forked repositories.
 * 
 * @param  {Array} reposList All the repositories.
 * @returns {Array}
 */
function forkedRepositories(reposList) {
  return reposList.filter(repo => {
    return repo.fork === true;
  }).map(reposList => reposList.name);
}

/**
 * Returns a list of files that were removed or not
 * 
 * @param  {Array} filesList All the files objects.
 * @param  {Boolean} removed should return removed or not removed
 * @returns {Array}
 */
function getFiles(filesList, removed) {
  return filesList
    .filter(fileObj => removed ? fileObj.status === 'removed' : fileObj.status !== 'removed')
    .map(nonRemovedFile => nonRemovedFile.filename);
}

/***/ }),

/***/ 671:
/***/ ((module) => {

module.exports = eval("require")("@actions/core");


/***/ }),

/***/ 603:
/***/ ((module) => {

module.exports = eval("require")("@actions/github");


/***/ }),

/***/ 723:
/***/ ((module) => {

module.exports = eval("require")("debug");


/***/ }),

/***/ 862:
/***/ ((module) => {

module.exports = eval("require")("fs-extra");


/***/ }),

/***/ 51:
/***/ ((module) => {

module.exports = eval("require")("simple-git");


/***/ }),

/***/ 896:
/***/ ((module) => {

"use strict";
module.exports = require("fs");

/***/ }),

/***/ 928:
/***/ ((module) => {

"use strict";
module.exports = require("path");

/***/ })

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __nccwpck_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		var threw = true;
/******/ 		try {
/******/ 			__webpack_modules__[moduleId](module, module.exports, __nccwpck_require__);
/******/ 			threw = false;
/******/ 		} finally {
/******/ 			if(threw) delete __webpack_module_cache__[moduleId];
/******/ 		}
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
/******/ 	/* webpack/runtime/compat */
/******/ 	
/******/ 	if (typeof __nccwpck_require__ !== 'undefined') __nccwpck_require__.ab = __dirname + "/";
/******/ 	
/************************************************************************/
var __webpack_exports__ = {};
const core = __nccwpck_require__(671);
const { getOctokit } = __nccwpck_require__(603);
const simpleGit = __nccwpck_require__(51);
const path = __nccwpck_require__(928);
const { mkdir } = (__nccwpck_require__(896).promises);

const {
  createBranch,
  clone,
  push,
  areFilesChanged,
  getBranchesLocal,
  checkoutBranch,
} = __nccwpck_require__(527);

const {
  getReposList,
  getRepo,
  createPr,
} = __nccwpck_require__(155);

const {
  getListOfFilesToReplicate,
  copyChangedFiles,
  getListOfReposToIgnore,
  getBranchName,
  isInitialized,
  getBranchesList,
  removeFiles,
} = __nccwpck_require__(430);

const triggerEventName = process.env.GITHUB_EVENT_NAME;
const eventPayload = process.env.GITHUB_EVENT_PATH ? require(process.env.GITHUB_EVENT_PATH) : {};

function validateTrigger() {
  const allowed = new Set(['push', 'workflow_dispatch']);
  if (!allowed.has(triggerEventName)) {
    throw new Error('This action works only for push or workflow_dispatch events.');
  }
  core.info(`Workflow started on ${triggerEventName}.`);
}

function buildOctokit(token) {
  return getOctokit(token, {
    request: { retries: 3 },
    previews: ['mercy-preview'],
  });
}

async function resolveRepoList(octokit, owner, manualRepoName, isWorkflowDispatch) {
  if (isWorkflowDispatch && manualRepoName) {
    return [await getRepo(octokit, owner, manualRepoName)];
  }
  return getReposList(octokit, owner);
}

async function applyFileChanges({
  repo,
  repoName,
  repoId,
  defaultBranch,
  filesToReplicate,
  filesToRemove,
  patternsToRemove,
  patternsToIgnore,
  branchesString,
  destination,
  customBranchName,
  commitId,
  commitMessage,
  committerUsername,
  committerEmail,
  octokit,
}) {
  const branchesData = await getBranchesList(octokit, process.env.GITHUB_REPOSITORY.split('/')[0], repoName, branchesString, defaultBranch);
  const targetBranches = branchesData[0];
  const existingBranches = branchesData[1];

  if (!targetBranches.length) {
    core.info('No branches to operate on for this repository.');
    return;
  }

  for (const branch of targetBranches) {
    const branchName = branch.name;
    await checkoutBranch(branchName, repo.git);

    const newBranchName = customBranchName || getBranchName(commitId, branchName);
    const branchExists = existingBranches.some((b) => b.name === newBranchName);
    if (branchExists) {
      await checkoutBranch(newBranchName, repo.git);
    } else {
      await createBranch(newBranchName, repo.git);
    }

    if (filesToReplicate?.length) {
      await copyChangedFiles(filesToReplicate, repo.dir, destination);
    }

    if (filesToRemove?.length) {
      await removeFiles(filesToRemove, repo.dir, { destination });
    }

    if (patternsToRemove) {
      await removeFiles(patternsToRemove, repo.dir, { patternsToIgnore });
    }

    if (await areFilesChanged(repo.git)) {
      await push(newBranchName, commitMessage, committerUsername, committerEmail, repo.git);

      let prUrl;
      try {
        prUrl = await createPr(octokit, repoName, repoId, newBranchName, branchName, commitMessage);
      } catch (err) {
        if (branchExists) {
          core.info(`PR creation skipped as branch exists; just pushed changes to ${newBranchName}.`, err);
        } else {
          throw err;
        }
      }

      if (prUrl) {
        core.info(`PR created: ${prUrl}`);
      } else {
        core.info(`No PR created for ${repoName}; repository updated on ${newBranchName}.`);
      }
    } else {
      core.info('No changes detected, skipping push/pr creation.');
    }
  }
}

async function run() {
  try {
    validateTrigger();

    const gitHubKey = process.env.GITHUB_TOKEN || core.getInput('github_token', { required: true });
    const patternsToIgnore = core.getInput('patterns_to_ignore');
    const patternsToInclude = core.getInput('patterns_to_include');
    const patternsToRemove = core.getInput('patterns_to_remove');
    const committerUsername = core.getInput('committer_username');
    const committerEmail = core.getInput('committer_email');
    const commitMessage = core.getInput('commit_message');
    const branches = core.getInput('branches');
    const destination = core.getInput('destination');
    const customBranchName = core.getInput('bot_branch_name');
    const manualRepoName = core.getInput('repo_name');

    const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/');
    const isWorkflowDispatch = triggerEventName === 'workflow_dispatch';
    const commitId = triggerEventName === 'push' ? (eventPayload.commits?.[0]?.id ?? '') : '';

    if (patternsToRemove && patternsToInclude) {
      throw new Error('patterns_to_include and patterns_to_remove are mutually exclusive.');
    }

    if (patternsToRemove && destination) {
      core.warning('destination is ignored when patterns_to_remove is set.');
    }

    const octokit = buildOctokit(gitHubKey);

    let filesToReplicate = [];
    let filesToRemove = [];

    if (!patternsToRemove) {
      const result = await getListOfFilesToReplicate(
        octokit,
        commitId,
        owner,
        repo,
        patternsToIgnore,
        patternsToInclude,
        triggerEventName,
      );

      filesToReplicate = result.filesForReplication;
      filesToRemove = result.filesForRemoval;

      if (!filesToReplicate.length && !filesToRemove.length) {
        core.info('Skipping run: no files to replicate or remove.');
        return;
      }
    }

    const repos = await resolveRepoList(octokit, owner, manualRepoName, isWorkflowDispatch);

    const ignoredRepositories = getListOfReposToIgnore(repo, repos, {
      reposToIgnore: core.getInput('repos_to_ignore'),
      topicsToInclude: core.getInput('topics_to_include'),
      excludePrivate: core.getInput('exclude_private') === 'true',
      excludeForked: core.getInput('exclude_forked') === 'true',
    });

    for (const remoteRepo of repos) {
      if (ignoredRepositories.includes(remoteRepo.name)) {
        core.debug(`Ignoring repository ${remoteRepo.name}`);
        continue;
      }

      core.startGroup(`Processing repository ${remoteRepo.name}`);

      const cloneDir = path.join(process.cwd(), 'clones', `${remoteRepo.name}-${Date.now()}`);
      await mkdir(cloneDir, { recursive: true });

      const git = simpleGit({ baseDir: cloneDir });
      await clone(gitHubKey, remoteRepo.url, cloneDir, git);

      if (!isInitialized(await getBranchesLocal(git), remoteRepo.defaultBranch)) {
        core.info('Repository not initialized; skipped.');
        core.endGroup();
        continue;
      }

      await applyFileChanges({
        repo: { name: remoteRepo.name, id: remoteRepo.id, dir: cloneDir, git },
        repoName: remoteRepo.name,
        repoId: remoteRepo.id,
        defaultBranch: remoteRepo.defaultBranch,
        filesToReplicate,
        filesToRemove,
        patternsToRemove,
        patternsToIgnore,
        branchesString: branches,
        destination,
        customBranchName,
        commitId,
        commitMessage,
        committerUsername,
        committerEmail,
        octokit,
      });

      core.endGroup();
    }
  } catch (error) {
    core.setFailed(`Action failed: ${error.message || error}`);
  }
}

run();

module.exports = __webpack_exports__;
/******/ })()
;