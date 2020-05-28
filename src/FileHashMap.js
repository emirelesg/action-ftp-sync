const fs = require('fs');
const md5 = require('md5');
const path = require('path');
const chalk = require('chalk');
const { projectDir } = require('./config');

class FileHashMap {
  constructor() {
    this.hashes = {};
    this.checked = [];
    this.md5 = (() => {
      let cache = {};
      return function (file) {
        if (cache[file]) return cache[file];
        cache[file] = md5(fs.readFileSync(file));
        return cache[file];
      };
    })();
  }
  relativeToProject(file) {
    return path.relative(projectDir, file);
  }
  isSame(file) {
    let mapped = this.relativeToProject(file);
    if (this.checked.indexOf(mapped) === -1) this.checked.push(mapped);
    return this.hashes[mapped] && this.hashes[mapped] === this.md5(file);
  }
  add(file) {
    let mapped = this.relativeToProject(file);
    this.hashes[mapped] = this.md5(file);
  }
  remove(file) {
    let mapped = this.relativeToProject(file);
    if (this.hashes[mapped]) delete this.hashes[mapped];
  }
  cleanup() {
    return Object.entries(this.hashes).reduce((obj, [file, hash]) => {
      if (this.checked.indexOf(file) !== -1) {
        return { ...obj, [file]: hash };
      }
      console.log(chalk`Removing hash for non-existent file: {bold ${file}}`);
      return obj;
    }, {});
  }
}

module.exports = FileHashMap;
