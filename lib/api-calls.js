const core = require('@actions/core');

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

async function createPr(octokit, owner, repo, headBranch, baseBranch, commitMessage) {
  const [title, ...bodyLines] = commitMessage.split('\n');
  const body = bodyLines.length > 0 ? bodyLines.join('\n') : undefined;

  let retries = 5;
  let attempt = 0;

  while (retries-- > 0) {
    attempt++;
    try {
      core.info('Waiting 5sec before PR creation');
      await new Promise(resolve => setTimeout(resolve, 5000));
      core.info(`PR creation attempt ${attempt}`);

      const { data } = await octokit.pulls.create({
        owner,
        repo,
        head: headBranch,
        base: baseBranch,
        title,
        body,
      });

      return data.html_url;
    } catch (error) {
      const message = error.message || '';
      const isRetryable = message.includes('was submitted too quickly') || message.includes('rate limit');
      if (!isRetryable || retries <= 0) {
        throw new Error(`Unable to create a PR: ${error}`);
      }
      core.info(`PR creation error: ${message}. Will retry...`);
    }
  }
}

