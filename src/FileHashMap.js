const fs = require('fs');
const md5 = require('md5');

class FileHashMap {
  constructor() {
    this.hashes = {};
    this.md5 = (() => {
      let cache = {};
      return function (file) {
        if (cache[file]) return cache[file];
        cache[file] = md5(fs.readFileSync(file));
        return cache[file];
      };
    })();
  }
  isSame(file) {
    return this.hashes[file] && this.hashes[file] === this.md5(file);
  }
  add(file) {
    this.hashes[file] = this.md5(file);
  }
  remove(file) {
    if (this.hashes[file]) delete this.hashes[file];
  }
}

module.exports = FileHashMap;
