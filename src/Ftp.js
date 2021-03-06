const jsftp = require('jsftp');
const path = require('path');
const chalk = require('chalk');
const { dryRun, ftpCredentials, remoteFilter } = require('./config');

class Ftp {
  constructor() {
    this.ftp = new jsftp(ftpCredentials);
    if (dryRun) console.log(chalk`{red *DRY RUN* }`);
  }
  auth() {
    return new Promise((resolve, reject) => {
      this.ftp.auth(ftpCredentials.username, ftpCredentials.password, err => {
        if (err) {
          reject(err);
        } else {
          resolve(true);
        }
      });
    });
  }
  raw(command, args) {
    return new Promise((resolve, reject) => {
      this.ftp.raw(command, args, (err, res) => {
        if (err) {
          reject(err);
        } else {
          resolve(res);
        }
      });
    });
  }
  ls(dir) {
    return new Promise((resolve, reject) => {
      this.ftp.ls(dir, (err, res) => {
        if (err) {
          reject(err);
        } else {
          resolve({
            dir,
            files: res
              .filter(t => t.type === 0)
              .map(t => path.join(dir, t.name))
              .filter(remoteFilter),
            dirs: res
              .filter(t => t.type === 1)
              .map(t => path.join(dir, t.name))
              .filter(remoteFilter)
          });
        }
      });
    });
  }
  putBuffer(buf, file) {
    if (dryRun) return true;
    return new Promise((resolve, reject) => {
      this.ftp.put(buf, file, err => {
        if (err) {
          reject(err);
        } else {
          resolve(true);
        }
      });
    });
  }
  getBuffer(file) {
    return new Promise((resolve, reject) => {
      let data = '';
      this.ftp.get(file, (err, socket) => {
        if (err) {
          reject(err);
        } else {
          socket.on('data', d => {
            data += d.toString();
          });
          socket.on('close', err => {
            if (err) {
              reject(err);
            } else {
              resolve(data);
            }
          });
          socket.resume();
        }
      });
    });
  }
  putJSON(obj, file) {
    console.log(chalk`{magenta Uploading ${file}}`);
    if (dryRun) return true;
    const data = `${JSON.stringify(obj || {}, null, 2)}\n`;
    const buf = Buffer.from(data);
    return this.putBuffer(buf, file);
  }
  getJSON(file) {
    console.log(chalk`{magenta Downloading ${file}}`);
    return this.getBuffer(file)
      .then(buf => JSON.parse(buf.toString()))
      .catch(err => {
        if (err.code !== 550) throw err;
        return {};
      });
  }
  quit() {
    return this.raw('quit');
  }
  rm(file) {
    console.log(chalk`{red Removing ${file}}`);
    if (dryRun) return true;
    return this.raw('dele', file);
  }
  rmdir(dir) {
    console.log(chalk`{yellow Removing ${dir}}`);
    if (dryRun) return true;
    return this.raw('rmd', dir);
  }
  mkdir(dir) {
    console.log(chalk`{green Making ${dir}}`);
    if (dryRun) return true;
    return this.raw('mkd', dir).then(() => dir);
  }
  async rmdirRecursive(dir) {
    const { files, dirs } = await this.ls(dir);
    await files.reduce(
      (lastPromise, file) =>
        lastPromise.then(() => {
          return this.rm(file);
        }),
      Promise.resolve()
    );
    await dirs.reduce(
      (lastPromise, dir) =>
        lastPromise.then(() => {
          return this.rmdirRecursive(dir);
        }),
      Promise.resolve()
    );
    return this.rmdir(dir);
  }
  mkdirRecursive(dir) {
    return dir.split(path.sep).reduce(
      (lastPromise, subdir) =>
        lastPromise
          .then(currentDir => this.ls(currentDir))
          .then(({ dir, dirs }) => {
            const completePath = path.join(dir, subdir);
            if (dirs.indexOf(completePath) === -1) {
              return this.mkdir(completePath);
            }
            return completePath;
          }),
      Promise.resolve('.')
    );
  }
}

module.exports = Ftp;
