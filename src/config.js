require('dotenv').config();
const { getInput } = require('@actions/core');
const path = require('path');
const fs = require('fs');
const minimatch = require('minimatch');

const ftpCredentials = {
  host: getInput('host') || process.env.FTP_HOST,
  port: getInput('port') || process.env.FTP_PORT,
  username: getInput('username') || process.env.FTP_USERNAME,
  password: getInput('password') || process.env.FTP_PASSWORD
};

const dryRun = process.env.DRY_RUN === 'true';

const projectDir = path.normalize(process.env.PROJECT_DIR || '');

const localDir = path.join(
  projectDir,
  path.normalize(getInput('localDir') || process.env.LOCAL_DIR)
);

const remoteDir = path.normalize(
  getInput('remoteDir') || process.env.REMOTE_DIR
);

const hashesPath = path.join(remoteDir, '.hashes');

let localIgnore = [];
let remoteIgnore = [hashesPath];
const ftpignorePath = path.join(projectDir, '.ftpignore.json');
if (fs.existsSync(ftpignorePath)) {
  const obj = JSON.parse(fs.readFileSync(ftpignorePath, 'utf8'));
  if (obj['local']) {
    localIgnore = [
      ...localIgnore,
      ...obj['local'].map(p => path.join(projectDir, p))
    ];
  }
  if (obj['remote']) {
    remoteIgnore = [
      ...remoteIgnore,
      ...obj['remote'].map(p => path.normalize(p))
    ];
  }
}

const remoteFilter = p => !remoteIgnore.some(i => minimatch(p, i));
const localFilter = p =>
  !localIgnore.some(i => minimatch(p, i) && !fs.lstatSync(p).isSymbolicLink());

module.exports = {
  ftpCredentials,
  localFilter,
  remoteFilter,
  projectDir,
  localDir,
  remoteDir,
  hashesPath,
  dryRun
};
