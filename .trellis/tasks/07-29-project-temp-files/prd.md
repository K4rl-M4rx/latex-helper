# 将临时文件存到项目根目录的 temp 文件夹

## 概述

公式编译管道（latex → dvisvgm）目前的临时工作目录建在系统临时目录
（`os.tmpdir()`）下。改为存到当前工作区项目根目录的 `temp/` 文件夹中，
方便用户查看编译产物、排查编译错误，并与 `latex-helper.auxPath`
默认值 `./temp` 的约定保持一致。

## 需求

### R1: 临时目录位置

- 编译工作目录从 `os.tmpdir()/latex-helper-XXXXXX` 改为
  `<工作区根目录>/temp/latex-helper-XXXXXX`
- `temp/` 不存在时自动创建（递归）
- 每次编译仍使用独立的随机子目录（`fs.mkdtempSync`），避免并发/残留互相污染

### R2: 清理行为不变

- 编译结束后（无论成功失败）仍删除本次的工作子目录，与现有 `finally` 清理一致
- `temp/` 文件夹本身保留

### R3: 回退策略

- 没有打开的工作区文件夹，或 `temp/` 创建失败时，回退到系统临时目录（现有行为）

## 非需求

- 不改变缓存目录（`globalStoragePath/cache`）的位置
- 不新增用户配置项（如后续需要可再加 `latex-helper.tempPath`）
- 不负责在用户项目中创建 `.gitignore`

## 验收标准

1. ✅ 触发公式编译时，临时 `.tex/.dvi/.svg` 文件出现在 `<项目根>/temp/latex-helper-XXXXXX/` 下
2. ✅ 编译完成后该子目录被删除，`temp/` 文件夹保留且无残留
3. ✅ 编译失败时子目录同样被清理
4. ✅ 无工作区文件夹时回退到系统临时目录，功能正常
