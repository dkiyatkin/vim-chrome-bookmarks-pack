#!/usr/bin/env node

const fs = require('fs')
const p = require('path')
const { exec, execSync } = require('child_process')

const fse = require('fs-extra')
const Promise = require('bluebird')
const glob = require('glob')
const untildify = require('untildify')
const _ = require('lodash')
const chalk = require('chalk')
const prompts = require('prompts')

const globAsync = Promise.promisify(glob)
const readFileAsync = Promise.promisify(fs.readFile)
const execAsync = Promise.promisify(exec, { multiArgs: true })

const chromeBookmarksPath = untildify('~/.config/chromium/Default/Bookmarks')
const vimPackPath = untildify('~/.local/share/nvim/site/pack/chrome-bookmarks')

function _getChromeBookmarksAsync (chromeBookmarksPath) {
  return readFileAsync(chromeBookmarksPath, 'utf8').then(function (content) {
    return JSON.parse(content)
  })
}

function _getPluginName (title) {
  let name = title.trim().replace(/^\[.*?\]/g, '')
  name = name.trim().replace(/\s.*/g, '')
  name = name.replace(/:$/g, '')
  name = name.replace(/^.*\//g, '')
  name = name.replace(/^(neo|n)*vim(-|\.|_)/g, '').replace(/(-|\.|_)(neo|n)*vim$/g, '')
  return name.toLowerCase()
}

function _getPluginFolder (name) {
  if (name.startsWith('vim-pack-start')) return 'start'
  if (name.startsWith('vim-pack-opt')) return 'opt'
  throw new Error('Bad folder name ' + name)
}

function _getVimPackItems (chromeBookmarks) {
  const chromeUrls = []
  chromeBookmarks.roots.other.children.forEach(function (vimFolder) {
    if (!(vimFolder.type === 'folder' && vimFolder.name === 'vim')) return
    return vimFolder.children.forEach(function (vimPackFolder) {
      if (!(vimPackFolder.type === 'folder' && vimPackFolder.name === 'vim-pack')) return
      return vimPackFolder.children.forEach(function (vimPackSubFolder) {
        if (vimPackSubFolder.type !== 'folder') return
        const folder = _getPluginFolder(vimPackSubFolder.name)
        vimPackSubFolder.children.forEach(function (vimPackItem) {
          chromeUrls.push({
            url: vimPackItem.url,
            name: folder + '/' + _getPluginName(vimPackItem.name),
          })
        })
      })
    })
  })
  return chromeUrls
}

function _getVimPackListAsync (vimPackPath) {
  return globAsync('{start,opt}/*', { cwd: vimPackPath }).then(function (plugins) {
    return plugins
  })
}

function _getBookmarksObjListAsync (chromeBookmarksPath) {
  return _getChromeBookmarksAsync(chromeBookmarksPath).then(function (chromeBookmarks) {
    return _getVimPackItems(chromeBookmarks)
  })
}

function _getBookmarksList (bookmarksObjList) {
  return bookmarksObjList.map(function (pluginObj) {
    return pluginObj.name
  })
}

function _getListsAsync () {
  return Promise.all([
    _getBookmarksObjListAsync(chromeBookmarksPath),
    _getVimPackListAsync(vimPackPath)
  ])
}

function _getAllOptPluginNamesFsAsync () {
  return globAsync('*', { cwd: p.join(vimPackPath, 'opt') })
}

function _getVimAllOptPackaddAsync () {
  return _getAllOptPluginNamesFsAsync().then(function (optPluginNames) {
    return optPluginNames.map(function (pluginName) {
      return `packadd ${pluginName}`
    }).join(' | ')
  })
}

function _syncVim () {
  return _getVimAllOptPackaddAsync().then(function (packadds) {
    const cmd = `nvim -u NONE --cmd "packloadall" --cmd "${packadds}" --cmd "silent! helptags ALL" -c UpdateRemotePlugins -c "q"`
    console.log('loading: ' + cmd)
    execSync(cmd)
  })
}

function _gitCloneAsync (url, absPath) {
  return execAsync(`git clone --depth=1 ${url} ${absPath}`).then(function ([stdout, stderr]) {
    console.log(url)
    console.log(stdout, stderr)
  }).catch(function (err) {
    console.error(`exec error: ${err}`)
  })
}

function _gitPullAsync (absPath) {
  return execAsync('git pull', { cwd: absPath }).then(function ([stdout, stderr]) {
    console.log(absPath)
    if (stdout.trim() === 'Already up to date.') return console.log(stdout, stderr)
    let githubUrl
    stderr.split('\n').forEach(function (line) {
      line = line.trim()
      if (line.startsWith('From https://github.com/')) {
        githubUrl = line.replace(/^From /g, '')
      }
    })
    if (!githubUrl) return console.log(stdout, stderr)
    const compare = stdout.split('\n')[0].replace(/^Updating /g, '').replace(/\.\./g, '...')
    console.log(githubUrl + '/compare/' + compare + '\n')
  }).catch(function (err) {
    console.error(`exec error: ${err}`)
  })
}

function list (argv) {
  _getListsAsync().then(function ([bookmarksObjList, vimPackList]) {
    const bookmarksList = _getBookmarksList(bookmarksObjList)
    let instPlugins = _.difference(bookmarksList, vimPackList)
    instPlugins = instPlugins.map(function (plugin) { return plugin + ' ' + chalk.red('(install)') })
    const remPlugins = _.difference(vimPackList, bookmarksList)
    remPlugins.forEach(function (plugin) {
      const index = vimPackList.indexOf(plugin)
      vimPackList[index] = vimPackList[index] + ' ' + chalk.red('(remove)')
    })
    vimPackList.concat(instPlugins).sort().forEach(function (plugin) {
      console.log(plugin)
    })
  })
}

function remove (argv) {
  _getListsAsync().then(function ([bookmarksObjList, vimPackList]) {
    const bookmarksList = _getBookmarksList(bookmarksObjList)
    const remPlugins = _.difference(vimPackList, bookmarksList)
    if (!remPlugins.length) return console.log('Nothing to remove')
    const remPluginAbsPaths = remPlugins.map(function (plugin) {
      const absPath = p.join(vimPackPath, plugin)
      console.log(absPath)
      return absPath
    })
    prompts({
      type: 'confirm',
      name: 'value',
      message: 'Can you confirm remove?',
    }).then(function (response) {
      if (!response.value) return
      remPluginAbsPaths.forEach(function (absPath) {
        fse.removeSync(absPath)
      })
      _syncVim()
    })
  })
}

function install (argv) {
  _getListsAsync().then(function ([bookmarksObjList, vimPackList]) {
    const bookmarksList = _getBookmarksList(bookmarksObjList)
    const instPlugins = _.difference(bookmarksList, vimPackList)
    if (!instPlugins.length) return console.log('Nothing to install')
    const instPluginObjs = []
    instPlugins.forEach(function (plugin) {
      const pluginObj = _.find(bookmarksObjList, function (pluginObj) {
        return (pluginObj.name === plugin)
      })
      const absPath = p.join(vimPackPath, plugin)
      console.log(absPath + ' (' + pluginObj.url + ')')
      instPluginObjs.push({ ...pluginObj, absPath })
    })
    prompts({
      type: 'confirm',
      name: 'value',
      message: 'Can you confirm install?',
    }).then(function (response) {
      if (!response.value) return
      const promises = []
      instPluginObjs.forEach(function (pluginObj) {
        promises.push(_gitCloneAsync(pluginObj.url, pluginObj.absPath))
      })
      Promise.all(promises).then(function () {
        _syncVim()
      })
    })
  })
}

function update (argv) {
  _getVimPackListAsync(vimPackPath).then(function (vimPackList) {
    if (!vimPackList.length) return console.log('Nothing to update')
    const pluginAbsPaths = vimPackList.map(function (plugin) {
      const absPath = p.join(vimPackPath, plugin)
      console.log(absPath)
      return absPath
    })
    prompts({
      type: 'confirm',
      name: 'value',
      message: 'Can you confirm update?',
    }).then(function (response) {
      if (!response.value) return
      const promises = []
      pluginAbsPaths.forEach(function (absPath) {
        promises.push(_gitPullAsync(absPath))
      })
      Promise.all(promises).then(function () {
        _syncVim()
      })
    })
  })
}

require('yargs') /* eslint-disable-line no-unused-expressions */
  .alias('-h', '--help')
  .alias('-v', '--version')
  .usage('Usage: $0 <cmd> [args]')
  .command('list', 'list all plugins and theirs statuses', list)
  .command('remove', 'remove missing plugins', remove)
  .command('install', 'install new plugins', install)
  .command('update', 'update plugins', update)
  .help()
  .argv
