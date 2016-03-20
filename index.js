"use strict";

const path = require("path");
const fs = require("fs");
const execSync = require("child_process").execSync;
const assign = require("object-assign");
const which = require("which");
const mkdirp = require("mkdirp");
const template = require("string-template");
const Spinner = require("cli-spinner").Spinner;
const colors = require("colors");
const archiver = require("archiver");

const defaults = {
  diffFilter: "ACDMRTUXB",
  format: "zip",
  prefix: "{dirname}",
  output: "{dirname}-{datetime}.{format}",
  verbose: false,
  dryRun: false
};

const supportFormats = [
  "zip",
  "tar"
];

const spinnerStringID = 18;


module.exports = gitDiffArchive;


function gitDiffArchive(commit, oldCommit, options) {
  return new Promise((resolve, reject) => {
    const commit1 = commit;
    const commit2 = typeof oldCommit === "string" ? oldCommit : null;
    const params = assign({}, defaults, typeof oldCommit === "object" ? oldCommit : (options || {}));

    if (!gitCommandExists()) {
      return reject("git command not exist");
    } else {
      params.basePath = gitBasePath();
    }

    if (!isSupportFormat(params.format)) {
      return reject("specified format type is not supported");
    }

    let diff = "";

    if (commit1 !== undefined) {
    if (commit2 == null) {
      diff = commit1;
      } else {
        diff = `${commit1} ${commit2}`;
      }
    }

    const cmd = `git diff --name-only --diff-filter=${params.diffFilter} ${diff}`;
    const lines = getExecLines(cmd).map(file => path.join(params.basePath, file));
    const files = filterFiles(lines, true);
    const exclude = filterFiles(lines, false);
    params.output = createPath(params.output, params.format);
    params.prefix = createPath(params.prefix, params.format);

    const spinner = new Spinner("processing... %s");
    spinner.setSpinnerString(spinnerStringID);

    if (files.length === 0) {
      return reject("diff file does not exist");
    }

    if (!params.verbose) {
      spinner.start();
    }

    createArchive(files, params)
      .then((archive) => {
        if (!params.verbose) {
          spinner.stop(true);
        }

        if (params.dryRun || params.verbose) {
          console.log("");
          console.log(colors.blue.bold(`[${params.dryRun ? "DRY RUN" : "DONE"}]`));
          console.log(`${colors.blue.bold("  command:")} ${cmd}`);
          console.log(`${colors.blue.bold("  prefix :")} ${params.prefix}`);
          if (!params.verbose) {
            console.log(`${colors.blue.bold("  files  :")}`);
            files.forEach(file => console.log(`    ${file}`));
          }
          console.log(`${colors.blue.bold("  exclude:")}`);
          exclude.forEach(file => console.log(`    ${file}`));
          console.log("");
        }
        resolve({
          bytes: archive.pointer(),
          output: params.output,
          prefix: params.prefix,
          cmd,
          files,
          exclude
        });
      })
      .catch((err) => {
        spinner.stop(true);
        reject(err);
      });
  });
}

function isSupportFormat(format) {
  return supportFormats.indexOf(format) > -1;
}

function gitCommandExists() {
  try {
    which.sync("git");
    return true;
  } catch (e) {
    return false;
  }
}

function gitBasePath() {
  return execSync("git rev-parse --show-cdup", {encoding: "utf8"}).trim();
}

function getExecLines(cmd) {
  const result = execSync(cmd, {encoding: "utf8"}).trim().replace(/\r\n?/g, "\n");
  return result.split("\n");
}

function filterFiles(files, exist) {
  return files.filter((file) => {
    try {
      const isFile = fs.statSync(file).isFile();
      return exist ? isFile : !isFile;
    } catch (e) {
      return !exist;
    }
  });
}

function createArchive(files, params) {
  return new Promise((resolve, reject) => {
    if (params.dryRun) {
      return resolve({pointer: () => 0});
    }

    const dir = path.dirname(params.output);
    mkdirp.sync(dir);

    const stream = fs.createWriteStream(params.output);
    const archive = archiver(params.format);
    let count = 0;

    stream.on("close", () => {
      resolve(archive);
    });

    archive.on("entry", (entry) => {
      if (params.verbose) {
        count++;
        console.log(`${colors.blue.bold(`Entry (${count}/${files.length}):`)} ${entry.name}`);
      }
    });

    archive.on("error", (err) => {
      reject(err);
    });

    archive.pipe(stream);

    files.forEach((file) => {
      archive.append(fs.createReadStream(file), {
        name: file,
        prefix: params.prefix
      });
    });

    archive.finalize();
  });
}

function createPath(src, format) {
  const d = new Date();
  const date = getDate(d);
  const time = getTime(d);
  const datetime = [date, time].join("");
  const cwd = path.join(process.cwd(), gitBasePath()).replace(/\/$/, "");
  const dirname = cwd.split(path.sep).pop();
  const random = Math.random().toString(36).slice(-8);

  return template(src, {
    date,
    time,
    datetime,
    dirname,
    random,
    format
  });
}

function getDate(date) {
  return [
    "" + date.getFullYear(),
    ("0" + (date.getMonth() + 1)).slice(-2),
    ("0" + date.getDate()).slice(-2)
  ].join("");
}

function getTime(date) {
  return [
    ("0" + date.getHours()).slice(-2),
    ("0" + date.getMinutes()).slice(-2),
    ("0" + date.getSeconds()).slice(-2)
  ].join("");
}
