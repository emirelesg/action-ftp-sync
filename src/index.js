require('dotenv').config();
const chalk = require('chalk');
const path = require('path');
const fs = require('fs');
const FileHashMap = require('./FileHashMap');
const Ftp = require('./Ftp');
const core = require('@actions/core');

const ftp = new Ftp(
  {
    host: core.getInput('host') || process.env.FTP_HOST,
    port: core.getInput('port') || process.env.FTP_PORT,
    user: core.getInput('username') || process.env.FTP_USERNAME,
    pass: core.getInput('password') || process.env.FTP_PASSWORD
  },
  process.env.DRY_RUN || false,
  core.getInput('ignore') || process.env.FTP_IGNORE
);
const localBaseDir = path.normalize(core.getInput('localDir') || process.env.LOCAL_DIR);
const remoteBaseDir = path.normalize(core.getInput('remoteDir') || process.env.REMOTE_DIR);
const hash = new FileHashMap();

function lsLocal(dir) {
  return fs.readdirSync(dir).reduce(
    (a, file) => {
      const fullPath = path.join(dir, file);
      if (ftp.filter(localToRemote(fullPath))) {
        if (fs.lstatSync(fullPath).isDirectory()) {
          a.dirs.push(fullPath);
        } else {
          a.files.push(fullPath);
        }
      }
      return a;
    },
    { dir, files: [], dirs: [] }
  );
}

function localToRemote(local) {
  const samePath = local.replace(localBaseDir + '/', '');
  return path.join(remoteBaseDir, samePath);
}

function remoteToLocal(remote) {
  const samePath = remote.replace(remoteBaseDir + '/', '');
  return path.join(localBaseDir, samePath);
}

async function sync(subdir) {
  console.log(chalk`Subdir: {bold ${subdir}}`);

  const localPath = path.join(localBaseDir, subdir);
  const remotePath = path.join(remoteBaseDir, subdir);
  const local = lsLocal(localPath);
  const remote = await ftp.ls(remotePath);

  // Upload local files to remote.
  await local.files.reduce(
    (lastPromise, file) =>
      lastPromise.then(() => {
        const fileRemote = localToRemote(file);
        if (hash.isSame(file)) {
          console.log(chalk`{grey Skipping ${file} -> ${fileRemote}}`);
          return true;
        }
        hash.add(file);
        if (remote.files.indexOf(fileRemote) === -1) {
          console.log(chalk`{green Uploading ${file} -> ${fileRemote}}`);
        } else {
          console.log(chalk`{blue Uploading ${file} -> ${fileRemote}}`);
        }
        return ftp.putBuffer(fs.readFileSync(file), fileRemote);
      }),
    Promise.resolve()
  );

  // Remove remote files that are not found in local.
  await remote.files.reduce(
    (lastPromise, file) =>
      lastPromise.then(() => {
        if (local.files.indexOf(remoteToLocal(file)) === -1) {
          hash.remove(remoteToLocal(file));
          return ftp.rm(file);
        }
      }),
    Promise.resolve()
  );

  // Remove remote dirs that are not found in local.
  await remote.dirs.reduce(
    (lastPromise, dir) =>
      lastPromise.then(() => {
        if (local.dirs.indexOf(remoteToLocal(dir)) === -1) {
          return ftp.rmdirRecursive(dir);
        }
      }),
    Promise.resolve()
  );

  // Iterate through all dirs and sync them
  await local.dirs.reduce(
    (lastPromise, dir) =>
      lastPromise
        // Make local subdir in remote if it does not exist.
        .then(() => {
          if (remote.dirs.indexOf(localToRemote(dir)) === -1) {
            return ftp.mkdir(localToRemote(dir));
          }
        })
        // Sync local subdir.
        .then(() => sync(dir.replace(localBaseDir + '/', ''))),
    Promise.resolve()
  );
}

(async () => {
  // Load hashes from the ftp server.
  hash.hashes = await ftp.getJSON(path.join(remoteBaseDir, '.hashes'));

  // Make base dir in ftp server.
  if (remoteBaseDir !== '.') await ftp.mkdirRecursive(remoteBaseDir);

  // Sync local and remote dirs.
  await sync('');

  // Upload the updated hashes to the server.
  await ftp.putJSON(hash.hashes, path.join(remoteBaseDir, '.hashes'));
})()
  .catch(err => core.setFailed(err.message))
  .finally(() => ftp.quit());
