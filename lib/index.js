const core = require('@actions/core');
const { getOctokit } = require('@actions/github');
const simpleGit = require('simple-git');
const path = require('path');
const { mkdir } = require('fs').promises;

const {
  createBranch,
  clone,
  push,
  areFilesChanged,
  getBranchesLocal,
  checkoutBranch,
} = require('./git');

const {
  getReposList,
  getRepo,
  createPr,
} = require('./api-calls');

const {
  getListOfFilesToReplicate,
  copyChangedFiles,
  getListOfReposToIgnore,
  getBranchName,
  isInitialized,
  getBranchesList,
  removeFiles,
} = require('./utils');

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
  owner,
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
        prUrl = await createPr(octokit, owner, repoName, newBranchName, branchName, commitMessage);
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
        owner,
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
