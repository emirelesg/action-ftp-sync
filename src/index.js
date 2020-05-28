const chalk = require('chalk');
const path = require('path');
const fs = require('fs');
const FileHashMap = require('./FileHashMap');
const Ftp = require('./Ftp');
const { setFailed } = require('@actions/core');
const { localDir, remoteDir, hashesPath, localFilter } = require('./config');
const ftp = new Ftp();
const hash = new FileHashMap();

function lsLocal(dir) {
  return fs
    .readdirSync(dir)
    .map(file => path.join(dir, file))
    .filter(localFilter)
    .reduce(
      (a, file) => {
        if (fs.lstatSync(file).isDirectory()) {
          a.dirs.push(file);
        } else {
          a.files.push(file);
        }
        return a;
      },
      { dir, files: [], dirs: [] }
    );
}

function localToRemote(local) {
  const samePath = local.replace(localDir + '/', '');
  return path.join(remoteDir, samePath);
}

function remoteToLocal(remote) {
  const samePath = remote.replace(remoteDir + '/', '');
  return path.join(localDir, samePath);
}

async function sync(subdir) {
  console.log(chalk`Subdir: {bold ${subdir}}`);

  const localPath = path.join(localDir, subdir);
  const remotePath = path.join(remoteDir, subdir);
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
        .then(() => sync(dir.replace(localDir + '/', ''))),
    Promise.resolve()
  );
}

(async () => {
  // Authenticate with ftp server.
  await ftp.auth();

  // Load hashes from the ftp server.
  hash.hashes = await ftp.getJSON(hashesPath);

  // Make base dir in ftp server.
  if (remoteDir !== '.') await ftp.mkdirRecursive(remoteDir);

  // Sync local and remote dirs.
  await sync('');

  // Upload the updated hashes to the server.
  await ftp.putJSON(hash.cleanup(), hashesPath);
})()
  .catch(err => setFailed(err.message))
  .finally(() => ftp.quit());
