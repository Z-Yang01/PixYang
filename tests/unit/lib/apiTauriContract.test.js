// @vitest-environment happy-dom
// api.js → tauriBridge → invoke 生产路径全通道契约锁定：
// 每个 api 方法在 Tauri 运行时的命令名/参数序列化形状，以及无桥时对 window.pixyang 的回落。
// R37 由该表抓到 syncCameraFolder/setImagesRoot 有接缝无包装的实机 TypeError。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import api from '@/lib/api';
import editSchema from '../../../shared/editSchema.cjs';

const { upgradeEdits } = editSchema;

const editSessionImpl = (cmd) =>
  cmd === 'edit_open' ? { basePath: 'E:/b.jpg', width: 800, height: 600 } : { ok: true };

// kind: invoke 直委托（默认）| chainEdit 编辑器 bake/export | dialog 插件 | event 事件监听
//       | url 资源转换 | local 桥内闭环不调后端 | pixyang 仅透传注入面
const ROUTES = [
  { method: 'getSettings', args: [], cmd: 'get_settings', invokeArgs: {} },
  { method: 'getSetting', args: ['theme'], cmd: 'get_setting', invokeArgs: { key: 'theme' } },
  {
    method: 'setSetting',
    args: ['theme', 'dark'],
    cmd: 'set_setting',
    invokeArgs: { key: 'theme', value: 'dark' },
  },
  { method: 'getTags', args: [], cmd: 'get_tags', invokeArgs: {} },
  { method: 'getAlbums', args: [], cmd: 'get_albums', invokeArgs: {} },
  { method: 'getImageTags', args: [7], cmd: 'get_image_tags', invokeArgs: { imageId: 7 } },
  {
    method: 'getBatchImageTags',
    args: [[1, 2]],
    cmd: 'get_batch_image_tags',
    invokeArgs: { imageIds: [1, 2] },
  },
  {
    method: 'getImages',
    args: [{ page: 1 }],
    cmd: 'get_images',
    invokeArgs: { query: { page: 1 } },
  },
  { method: 'getImage', args: [5], cmd: 'get_image', invokeArgs: { id: 5 } },
  { method: 'getImportDates', args: [], cmd: 'get_import_dates', invokeArgs: {} },
  { method: 'getStats', args: [], cmd: 'get_stats', invokeArgs: {} },
  { method: 'getAlbumImages', args: [4], cmd: 'get_album_images', invokeArgs: { albumId: 4 } },
  {
    method: 'createTag',
    args: ['风景', '#fff'],
    cmd: 'create_tag',
    invokeArgs: { name: '风景', color: '#fff' },
  },
  { method: 'deleteTag', args: [2], cmd: 'delete_tag', invokeArgs: { id: 2 } },
  {
    method: 'addTagToImage',
    args: [1, 2],
    cmd: 'add_tag_to_image',
    invokeArgs: { imageId: 1, tagId: 2 },
  },
  {
    method: 'removeTagFromImage',
    args: [1, 2],
    cmd: 'remove_tag_from_image',
    invokeArgs: { imageId: 1, tagId: 2 },
  },
  {
    method: 'addTagToImages',
    args: [[1, 2], 3],
    cmd: 'add_tag_to_images',
    invokeArgs: { imageIds: [1, 2], tagId: 3 },
  },
  {
    method: 'createAlbum',
    args: ['A', 'd'],
    cmd: 'create_album',
    invokeArgs: { name: 'A', description: 'd' },
  },
  {
    method: 'renameAlbum',
    args: [1, 'B'],
    cmd: 'rename_album',
    invokeArgs: { id: 1, newName: 'B' },
  },
  { method: 'deleteAlbum', args: [1], cmd: 'delete_album', invokeArgs: { id: 1 } },
  {
    method: 'addToAlbum',
    args: [1, [2, 3]],
    cmd: 'add_to_album',
    invokeArgs: { albumId: 1, imageIds: [2, 3] },
  },
  {
    method: 'removeFromAlbum',
    args: [1, 2],
    cmd: 'remove_from_album',
    invokeArgs: { albumId: 1, imageId: 2 },
  },
  { method: 'deleteImage', args: [9], cmd: 'delete_image', invokeArgs: { id: 9 } },
  {
    method: 'batchDeleteImages',
    args: [[1, 2]],
    cmd: 'batch_delete_images',
    invokeArgs: { ids: [1, 2] },
  },
  { method: 'deleteImageToTrash', args: [9], cmd: 'delete_image_to_trash', invokeArgs: { id: 9 } },
  {
    method: 'batchDeleteImagesToTrash',
    args: [[1, 2]],
    cmd: 'batch_delete_images_to_trash',
    invokeArgs: { ids: [1, 2] },
  },
  {
    method: 'restoreImageFromTrash',
    args: [9],
    cmd: 'restore_image_from_trash',
    invokeArgs: { id: 9 },
  },
  {
    method: 'getPresets',
    args: [],
    cmd: 'get_presets',
    invokeArgs: {},
    invokeImpl: (cmd) => (cmd === 'get_presets' ? [] : {}),
  },
  {
    method: 'createPreset',
    args: ['p', { exposure: 2 }],
    cmd: 'create_preset',
    invokeArgs: { name: 'p', params: upgradeEdits({ exposure: 2 }) },
  },
  { method: 'deletePreset', args: [4], cmd: 'delete_preset', invokeArgs: { id: 4 } },
  { method: 'getImagesRoot', args: [], cmd: 'get_images_root', invokeArgs: {} },
  { method: 'getDatabasePath', args: [], cmd: 'get_database_path', invokeArgs: {} },
  {
    method: 'getAllImageIds',
    args: [{ tagId: 1 }],
    cmd: 'get_all_image_ids',
    invokeArgs: { query: { tagId: 1 } },
  },
  {
    method: 'fileExists',
    args: ['E:/a.jpg'],
    cmd: 'file_exists',
    invokeArgs: { filepath: 'E:/a.jpg' },
  },
  {
    method: 'importImages',
    args: [[{ filename: 'a.jpg' }], '2026-01-01'],
    cmd: 'import_images',
    invokeArgs: { files: [{ filename: 'a.jpg' }], dateOverride: '2026-01-01' },
  },
  {
    method: 'renameImage',
    args: [2, 'n.jpg'],
    cmd: 'rename_image',
    invokeArgs: { id: 2, newFilename: 'n.jpg' },
  },
  { method: 'getExif', args: ['E:/a.jpg'], cmd: 'get_exif', invokeArgs: { filepath: 'E:/a.jpg' } },
  { method: 'analyzeImage', args: [5], cmd: 'analyze_image', invokeArgs: { id: 5 } },
  {
    method: 'scanDirectory',
    args: ['E:/dir'],
    cmd: 'scan_directory',
    invokeArgs: { dir: 'E:/dir' },
  },
  {
    method: 'collectImportFiles',
    args: [['E:/a.jpg']],
    cmd: 'collect_import_files',
    invokeArgs: { paths: ['E:/a.jpg'] },
  },
  {
    method: 'updateImage',
    args: [1, { rating: 4 }],
    cmd: 'update_image',
    invokeArgs: { id: 1, updates: { rating: 4 } },
  },
  {
    method: 'updateImages',
    args: [[1, 2], { favorite: 1 }],
    cmd: 'update_images',
    invokeArgs: { imageIds: [1, 2], updates: { favorite: 1 } },
  },
  {
    method: 'rebuildThumbnails',
    args: [],
    cmd: 'rebuild_thumbnails_with_events',
    invokeArgs: { all: true },
  },
  { method: 'scanBrokenRecords', args: [], cmd: 'scan_broken_records', invokeArgs: {} },
  {
    method: 'deleteBrokenRecords',
    args: [[3]],
    cmd: 'delete_broken_records',
    invokeArgs: { ids: [3] },
  },
  { method: 'findDuplicates', args: [], cmd: 'find_duplicates', invokeArgs: {} },
  { method: 'getEdits', args: [1], cmd: 'get_edits', invokeArgs: { id: 1 } },
  {
    method: 'saveEdits',
    args: [1, { exposure: 0.5 }, { label: 'x' }],
    cmd: 'save_edit_params',
    invokeArgs: { id: 1, params: upgradeEdits({ exposure: 0.5 }), command: { label: 'x' } },
    invokeImpl: (cmd) =>
      cmd === 'edit_open' ? { basePath: 'E:/b.jpg', width: 800, height: 600 } : { ok: true },
  },
  { method: 'getEditHistory', args: [1], cmd: 'get_edit_history', invokeArgs: { id: 1 } },
  {
    method: 'undoLastEdit',
    args: [3],
    cmd: 'undo_last_edit',
    invokeArgs: { id: 3 },
    invokeImpl: (cmd) =>
      cmd === 'get_edits'
        ? { version: 2, params: { basic: { exposure: 0 } } }
        : { version: 2, label: '撤销「保存编辑参数」' },
  },
  { method: 'editOpen', args: [5], cmd: 'edit_open', invokeArgs: { id: 5 } },
  { method: 'editCancel', args: [5], kind: 'local', result: { ok: true } },
  {
    method: 'editBake',
    args: [5, { exposure: 0.5 }],
    kind: 'chainEdit',
    chainCmd: 'edit_bake',
    invokeImpl: editSessionImpl,
  },
  {
    method: 'editExport',
    args: [5, { exposure: 0.5 }, 'E:/dest'],
    kind: 'chainEdit',
    chainCmd: 'edit_export',
    invokeImpl: editSessionImpl,
  },
  { method: 'syncCameraFolder', args: [], cmd: 'sync_camera_folder', invokeArgs: {} },
  {
    method: 'setImagesRoot',
    args: ['E:/new'],
    cmd: 'set_images_root',
    invokeArgs: { dirPath: 'E:/new' },
  },
  { method: 'openPath', args: ['E:/x'], cmd: 'open_path', invokeArgs: { path: 'E:/x' } },
  { method: 'backupDatabase', args: [], cmd: 'backup_database', invokeArgs: {} },
  {
    method: 'exportImages',
    args: [[1, 2], 'E:/d'],
    cmd: 'export_images',
    invokeArgs: { ids: [1, 2], destDir: 'E:/d' },
  },
  {
    method: 'exportAlbumImages',
    args: [3, 'E:/d'],
    cmd: 'export_album_images',
    invokeArgs: { albumId: 3, destDir: 'E:/d' },
  },
  { method: 'selectDirectory', args: [], kind: 'dialog' },
  { method: 'selectExportDirectory', args: [], kind: 'dialog' },
  { method: 'toFileUrl', args: ['E:/a.jpg'], kind: 'url' },
  { method: 'toFileUrls', args: [['E:/a.jpg', 'E:/b.jpg', 'E:/a.jpg']], kind: 'url' },
  { method: 'onRebuildProgress', args: [() => {}], kind: 'event', evt: 'rebuild-progress' },
  { method: 'onImportProgress', args: [() => {}], kind: 'event', evt: 'import-progress' },
  { method: 'onThumbnailsReady', args: [() => {}], kind: 'event', evt: 'thumbnails-ready' },
  { method: 'onEditPreviewReady', args: [() => {}], kind: 'event', evt: 'edit-preview-ready' },
  { method: 'getPathForFile', args: ['f'], kind: 'pixyang' },
];

function makeTauri(over = {}) {
  const invoke = vi
    .fn()
    .mockImplementation((cmd) =>
      Promise.resolve(over.invokeImpl ? over.invokeImpl(cmd) : { ok: true })
    );
  const listen = vi.fn().mockResolvedValue(() => {});
  const convertFileSrc = vi.fn((p) => `asset:///${p}`);
  const dialogOpen = vi.fn().mockResolvedValue('E:/picked');
  window.__TAURI__ = {
    core: { invoke, convertFileSrc },
    event: { listen },
    dialog: { open: dialogOpen },
  };
  return { invoke, listen, convertFileSrc, dialogOpen };
}

afterEach(() => {
  delete window.__TAURI__;
  delete window.pixyang;
});

describe('api → tauriBridge 生产路径契约', () => {
  it('api 方法集与契约表一一对应（新增通道必须登记路由）', () => {
    const routed = new Set(ROUTES.map((r) => r.method));
    const methods = Object.keys(api).filter((k) => k !== 'isBridgeAvailable');
    expect(routed).toEqual(new Set(methods));
  });

  it.each(ROUTES)('$method：Tauri 运行时路由与参数形状', async (r) => {
    const t = makeTauri(r);
    const res = await api[r.method](...r.args);
    switch (r.kind ?? 'invoke') {
      case 'invoke':
        expect(t.invoke).toHaveBeenCalledWith(r.cmd, r.invokeArgs);
        break;
      case 'chainEdit':
        expect(t.invoke).toHaveBeenCalledWith('edit_open', { id: r.args[0] });
        expect(t.invoke).toHaveBeenCalledWith(
          r.chainCmd,
          expect.objectContaining({ id: r.args[0], edits: r.args[1], inputPath: 'E:/b.jpg' })
        );
        break;
      case 'dialog':
        expect(t.dialogOpen).toHaveBeenCalledWith(expect.objectContaining({ directory: true }));
        break;
      case 'event': {
        expect(t.listen).toHaveBeenCalledWith(r.evt, expect.any(Function));
        const cb = vi.fn();
        api[r.method](cb);
        const handler = t.listen.mock.calls[t.listen.mock.calls.length - 1][1];
        handler({ payload: { p: 1 } });
        expect(cb).toHaveBeenCalledWith({ p: 1 });
        break;
      }
      case 'url':
        if (r.method === 'toFileUrl') {
          expect(res).toBe('asset:///E:/a.jpg');
          expect(t.convertFileSrc).toHaveBeenCalledWith('E:/a.jpg');
        } else {
          expect(res).toEqual({
            'E:/a.jpg': 'asset:///E:/a.jpg',
            'E:/b.jpg': 'asset:///E:/b.jpg',
          });
        }
        break;
      case 'local':
        expect(res).toEqual(r.result);
        expect(t.invoke).not.toHaveBeenCalled();
        break;
      case 'pixyang':
        expect(t.invoke).not.toHaveBeenCalled();
        break;
    }
  });

  it('无 __TAURI__ 时全通道回落 window.pixyang 注入面', async () => {
    const bridge = {};
    for (const r of ROUTES) bridge[r.method] = vi.fn().mockResolvedValue('PX');
    window.pixyang = bridge;
    for (const r of ROUTES) {
      if (r.kind === 'event' || (r.kind ?? 'invoke') === 'url') continue; // 事件/URL 为桥专属实现
      await expect(api[r.method](...r.args)).resolves.toBe('PX');
      expect(bridge[r.method]).toHaveBeenCalled();
    }
  });

  it('既无桥也无注入面：不抛错，返回 undefined（调用方按空数据处理）', async () => {
    expect(api.getImages()).toBeUndefined();
    expect(api.getTags()).toBeUndefined();
    expect(api.isBridgeAvailable()).toBe(false);
  });
});

// 桥接三层对拍锁：tauriBridge.js invoke 字面量 ↔ src-tauri/src/lib.rs generate_handler! 注册表
// ↔ 本文件契约表 cmd。R37 契约表是手写的，Rust 侧改名/删命令时上面的测试仍绿而生产 invoke
// 会以「命令不存在」断裂——这里把两侧事实源钉在同一张表上。
// 路径从 cwd 解析（happy-dom 下 import.meta.url 非 file scheme，不能走 themes.test.js 的 URL 法）。
const readRepo = (rel) => readFileSync(resolve(process.cwd(), rel), 'utf8');
const rustSource = readRepo('src-tauri/src/lib.rs');
const bridgeSource = readRepo('src/lib/tauriBridge.js');
const mediaSource = readRepo('src/lib/tauriBridgeMedia.js');
const progressSource = readRepo('src-tauri/src/progress.rs');
const rustEvents = new Set(
  [...progressSource.matchAll(/^pub const [A-Z_]+: &str = "([a-z-]+)";/gm)].map((m) => m[1])
);

const handlerBlock = rustSource.match(/generate_handler!\[([\s\S]*?)\]\)/)?.[1] ?? '';
const rustCommands = new Set(
  [...handlerBlock.matchAll(/(?:commands|interact|camera)::([a-z_]+)/g)].map((m) => m[1])
);
const bridgeCommands = new Set(
  [...bridgeSource.matchAll(/tauriInvoke\(\s*'([a-z_]+)'/g)].map((m) => m[1])
);

describe('Rust 注册表 ↔ 桥接层命令对拍', () => {
  it('两侧清单非空（正则失配时对拍会空转，先哨兵拦截）', () => {
    expect(rustCommands.size).toBeGreaterThan(50);
    expect(bridgeCommands.size).toBeGreaterThan(50);
  });

  it('桥内每个 invoke 字面量都在 Rust 注册（Rust 改名/删命令 → 桥侧孤儿暴露）', () => {
    const orphans = [...bridgeCommands].filter((c) => !rustCommands.has(c));
    expect(orphans).toEqual([]);
  });

  it('Rust 注册的每个命令都有桥包装（注册即消费，无死命令）', () => {
    const unbound = [...rustCommands].filter((c) => !bridgeCommands.has(c));
    expect(unbound).toEqual([]);
  });

  it('契约表 invoke/chain 命令全部在 Rust 注册', () => {
    const tableCmds = ROUTES.flatMap((r) =>
      r.kind === 'chainEdit' ? [r.chainCmd] : r.kind ? [] : [r.cmd]
    );
    expect([...new Set(tableCmds)].filter((c) => !rustCommands.has(c))).toEqual([]);
  });

  it('桥监听的事件与契约表一致，且每个事件在 Rust 侧有生产者（progress.rs 常量）', () => {
    const listened = [...mediaSource.matchAll(/listen\('([a-z-]+)'/g)].map((m) => m[1]);
    expect(new Set(listened)).toEqual(
      new Set(ROUTES.filter((r) => r.kind === 'event').map((r) => r.evt))
    );
    expect(rustEvents).toEqual(new Set(listened));
  });
});
