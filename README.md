# vim-chrome-bookmarks-pack
Plugin manager for Vim. Depends on Vim's built-in package support and chrome bookmarks.
Vim plugin urls stored into chrome (chromium) bookmarks `Other bookmarks -> vim -> vim-pack -> vim-pack-start-*` and `Other bookmarks -> vim -> vim-pack -> vim-pack-opt-*`.
Update output with links to changelog.
This is first init version.

## Install
`yarn global add vim-chrome-bookmarks-pack`

## Usage
```
$ vim-chrome-bookmarks-pack -h
Usage: index.js <cmd> [args]

Commands:
  index.js list     list all plugins and theirs statuses
  index.js remove   remove missing plugins
  index.js install  install new plugins
  index.js update   update plugins
```

## TODO
~/.config/vim-chrome-bookmarks-pack.yml
