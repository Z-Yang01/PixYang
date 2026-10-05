// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { isTauriAvailable, tauriInvoke } from '@/lib/tauriBridge';
import api from '@/lib/api';
import editSchema from '../../../shared/editSchema.cjs';

const { upgradeEdits } = editSchema;

afterEach(() => {
  delete window.__TAURI__;
  delete window.pixyang;
});

describe('tauriBridge', () => {
  it('无 __TAURI__ 全局时不可用，调用显式报错', async () => {
    expect(isTauriAvailable()).toBe(false);
    await expect(tauriInvoke('ping')).rejects.toThrow('[tauriBridge] Tauri 运行时不可用');
  });

  it('__TAURI__ 缺 core 或 invoke 时同样判不可用', () => {
    window.__TAURI__ = {};
    expect(isTauriAvailable()).toBe(false);
    window.__TAURI__ = { core: {} };
    expect(isTauriAvailable()).toBe(false);
  });

  it('可用时透传命令名与参数、返回值原样', async () => {
    const invoke = vi.fn().mockResolvedValue({ ok: 1 });
    window.__TAURI__ = { core: { invoke } };
    expect(isTauriAvailable()).toBe(true);
    await expect(tauriInvoke('ping', { a: 1 })).resolves.toEqual({ ok: 1 });
    expect(invoke).toHaveBeenCalledWith('ping', { a: 1 });
  });

  it('后端错误原样传播', async () => {
    const invoke = vi.fn().mockRejectedValue(new Error('backend boom'));
    window.__TAURI__ = { core: { invoke } };
    await expect(tauriInvoke('ping')).rejects.toThrow('backend boom');
  });

  it('api 设置通道在 Tauri 可用时走 Rust 命令', async () => {
    const invoke = vi.fn().mockResolvedValue('dark');
    window.__TAURI__ = { core: { invoke } };
    window.pixyang = { getSetting: vi.fn() };
    await expect(api.getSetting('theme')).resolves.toBe('dark');
    expect(invoke).toHaveBeenCalledWith('get_setting', { key: 'theme' });
    expect(window.pixyang.getSetting).not.toHaveBeenCalled();
  });

  it('api 设置通道无 Tauri 桥时仍走 pixyang 透传', async () => {
    window.pixyang = {
      getSetting: vi.fn().mockResolvedValue('dark'),
      setSetting: vi.fn().mockResolvedValue(undefined),
    };
    await expect(api.getSetting('theme')).resolves.toBe('dark');
    expect(window.pixyang.getSetting).toHaveBeenCalledWith('theme');
    await api.setSetting('theme', 'light');
    expect(window.pixyang.setSetting).toHaveBeenCalledWith('theme', 'light');
  });

  it('api 未接缝通道不受 Tauri 接缝影响', async () => {
    const invoke = vi.fn();
    window.__TAURI__ = { core: { invoke } };
    window.pixyang = { getPathForFile: vi.fn().mockResolvedValue('E:/drop/a.jpg') };
    await api.getPathForFile('E:/drop/a.jpg');
    expect(window.pixyang.getPathForFile).toHaveBeenCalledWith('E:/drop/a.jpg');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('接缝 R25：导出通道走 Rust 命令', async () => {
    const invoke = vi.fn().mockResolvedValue({ total: 2, copied: 2, nefCopied: 1, failed: [] });
    window.__TAURI__ = { core: { invoke } };
    await api.exportImages([1, 2], 'E:/dest');
    expect(invoke).toHaveBeenCalledWith('export_images', { ids: [1, 2], destDir: 'E:/dest' });
    await api.exportAlbumImages(7, 'E:/dest');
    expect(invoke).toHaveBeenCalledWith('export_album_images', { albumId: 7, destDir: 'E:/dest' });
  });

  it('接缝 13a：exportImages 转换选项第三参透传，null/undefined 省略 options 键', async () => {
    const invoke = vi.fn().mockResolvedValue({ total: 1, copied: 1, nefCopied: 0, failed: [] });
    window.__TAURI__ = { core: { invoke } };
    const opts = { mode: 'convert', format: 'webp', quality: 80, maxEdge: 1920 };
    await api.exportImages([3], 'E:/d', opts);
    expect(invoke).toHaveBeenCalledWith('export_images', {
      ids: [3],
      destDir: 'E:/d',
      options: opts,
    });
    await api.exportImages([3], 'E:/d', null);
    expect(invoke).toHaveBeenLastCalledWith('export_images', { ids: [3], destDir: 'E:/d' });
    await api.exportImages([3], 'E:/d', undefined);
    expect(invoke).toHaveBeenLastCalledWith('export_images', { ids: [3], destDir: 'E:/d' });
  });

  it('接缝 R99：exportAlbumImages 转换选项第三参透传，null/undefined 省略 options 键', async () => {
    const invoke = vi.fn().mockResolvedValue({ total: 1, copied: 1, nefCopied: 0, failed: [] });
    window.__TAURI__ = { core: { invoke } };
    const opts = { mode: 'convert', format: 'png', quality: 95, maxEdge: 2560 };
    await api.exportAlbumImages(7, 'E:/d', opts);
    expect(invoke).toHaveBeenCalledWith('export_album_images', {
      albumId: 7,
      destDir: 'E:/d',
      options: opts,
    });
    // 原样复制（null/缺省）必须省略 options 键：与 export_images 同口径
    await api.exportAlbumImages(7, 'E:/d', null);
    expect(invoke).toHaveBeenLastCalledWith('export_album_images', { albumId: 7, destDir: 'E:/d' });
    await api.exportAlbumImages(7, 'E:/d');
    expect(invoke).toHaveBeenLastCalledWith('export_album_images', { albumId: 7, destDir: 'E:/d' });
  });

  it('接缝 R26：编辑器三通道桥接（open 直传；bake/export 桥内建 spec）', async () => {
    const session = { basePath: 'E:/t/edit-5-base.jpg', width: 100, height: 80 };
    const invoke = vi.fn().mockResolvedValue(session);
    window.__TAURI__ = { core: { invoke } };
    await api.editOpen(5);
    expect(invoke).toHaveBeenLastCalledWith('edit_open', { id: 5 });
    const edits = { exposure: 0.5 };
    await api.editBake(5, edits);
    expect(invoke).toHaveBeenLastCalledWith(
      'edit_bake',
      expect.objectContaining({
        id: 5,
        edits,
        inputPath: session.basePath,
        spec: expect.any(Object),
      })
    );
    await api.editExport(5, edits, 'E:/dest', { format: 'png', quality: 88 });
    expect(invoke).toHaveBeenLastCalledWith(
      'edit_export',
      expect.objectContaining({
        id: 5,
        edits,
        inputPath: session.basePath,
        destDir: 'E:/dest',
        output: { format: 'png', quality: 88 },
      })
    );
  });

  it('接缝 R24：对话框/外壳通道在 Tauri 可用时走插件与 Rust 命令', async () => {
    const invoke = vi.fn().mockResolvedValue({ success: true, path: 'E:/backup.db' });
    const dialogOpen = vi.fn().mockResolvedValue('E:/picked');
    window.__TAURI__ = {
      core: { invoke },
      dialog: { open: dialogOpen },
    };
    await expect(api.selectDirectory()).resolves.toBe('E:/picked');
    expect(dialogOpen).toHaveBeenCalledWith({
      directory: true,
      title: '选择要导入的图片文件夹',
    });
    await expect(api.selectExportDirectory()).resolves.toBe('E:/picked');
    expect(dialogOpen).toHaveBeenLastCalledWith({
      directory: true,
      title: '选择导出的目标文件夹',
    });
    await expect(api.openPath('E:/picked/sub')).resolves.toEqual({
      success: true,
      path: 'E:/backup.db',
    });
    expect(invoke).toHaveBeenCalledWith('open_path', { path: 'E:/picked/sub' });
    await expect(api.backupDatabase()).resolves.toEqual({ success: true, path: 'E:/backup.db' });
    expect(invoke).toHaveBeenCalledWith('backup_database', {});
  });

  it('接缝 R24：对话框/外壳通道无 Tauri 桥时仍走 pixyang 透传', async () => {
    window.pixyang = {
      selectDirectory: vi.fn().mockResolvedValue('E:/elect'),
      openPath: vi.fn().mockResolvedValue(''),
    };
    await expect(api.selectDirectory()).resolves.toBe('E:/elect');
    expect(window.pixyang.selectDirectory).toHaveBeenCalled();
    await api.openPath('E:/elect');
    expect(window.pixyang.openPath).toHaveBeenCalledWith('E:/elect');
  });

  it('接缝 2：标签/相册只读通道走 Rust 命令', async () => {
    const invoke = vi.fn().mockResolvedValue([]);
    window.__TAURI__ = { core: { invoke } };
    await api.getTags();
    expect(invoke).toHaveBeenCalledWith('get_tags', {});
    await api.getAlbums();
    expect(invoke).toHaveBeenCalledWith('get_albums', {});
    await api.getImageTags(7);
    expect(invoke).toHaveBeenCalledWith('get_image_tags', { imageId: 7 });
    await api.getBatchImageTags([1, 2, 3]);
    expect(invoke).toHaveBeenCalledWith('get_batch_image_tags', { imageIds: [1, 2, 3] });
  });

  it('接缝 3：图片列表查询通道走 Rust 命令', async () => {
    const invoke = vi.fn().mockResolvedValue({ images: [], total: 0 });
    window.__TAURI__ = { core: { invoke } };
    await api.getImages({ tagId: 9, sortBy: 'import_date' });
    expect(invoke).toHaveBeenCalledWith('get_images', {
      query: { tagId: 9, sortBy: 'import_date' },
    });
    await api.getImages();
    expect(invoke).toHaveBeenCalledWith('get_images', { query: {} });
    await api.getImage(5);
    expect(invoke).toHaveBeenCalledWith('get_image', { id: 5 });
    await api.getImportDates();
    expect(invoke).toHaveBeenCalledWith('get_import_dates', {});
    await api.getStats();
    expect(invoke).toHaveBeenCalledWith('get_stats', {});
  });

  it('接缝 4b：删除通道走 Rust 命令', async () => {
    const invoke = vi.fn().mockResolvedValue(null);
    window.__TAURI__ = { core: { invoke } };
    await api.deleteImage(7);
    expect(invoke).toHaveBeenCalledWith('delete_image', { id: 7 });
    await api.batchDeleteImages([1, 2]);
    expect(invoke).toHaveBeenCalledWith('batch_delete_images', { ids: [1, 2] });
  });

  it('接缝 4c：presets 通道走 Rust 命令且桥接层做 upgradeEdits 规整', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValue([{ id: 1, name: 'p', params: { exposure: 1 }, createdAt: '2026-09-20' }]);
    window.__TAURI__ = { core: { invoke } };
    const list = await api.getPresets();
    expect(invoke).toHaveBeenCalledWith('get_presets', {});
    expect(list[0].params).toEqual(upgradeEdits({ exposure: 1 }));
    await api.createPreset('p', { exposure: 2 });
    expect(invoke).toHaveBeenCalledWith('create_preset', {
      name: 'p',
      params: upgradeEdits({ exposure: 2 }),
    });
    await api.deletePreset(1);
    expect(invoke).toHaveBeenCalledWith('delete_preset', { id: 1 });
  });

  it('接缝 P0-2：缩略图重建走带进度事件的全量命令', async () => {
    const invoke = vi.fn().mockResolvedValue({ rebuilt: 3, failed: 0, total: 3 });
    window.__TAURI__ = { core: { invoke } };
    await expect(api.rebuildThumbnails()).resolves.toEqual({ rebuilt: 3, failed: 0, total: 3 });
    expect(invoke).toHaveBeenCalledWith('rebuild_thumbnails_with_events', { all: true });
  });

  it('接缝 P1-10：getEdits 返回 params 经 upgradeEdits 规整，无记录为 null', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({
        version: 3,
        updatedAt: '2026-09-21 10:00',
        params: { exposure: 0.5 },
      })
      .mockResolvedValueOnce(null);
    window.__TAURI__ = { core: { invoke } };
    const row = await api.getEdits(5);
    expect(invoke).toHaveBeenNthCalledWith(1, 'get_edits', { id: 5 });
    expect(row).toEqual({
      version: 3,
      updatedAt: '2026-09-21 10:00',
      params: upgradeEdits({ exposure: 0.5 }),
    });
    await expect(api.getEdits(6)).resolves.toBeNull();
    expect(invoke).toHaveBeenNthCalledWith(2, 'get_edits', { id: 6 });
  });

  it('接缝 14：托管路径与跨页全选通道走 Rust 命令', async () => {
    const invoke = vi.fn().mockResolvedValue(null);
    window.__TAURI__ = { core: { invoke } };
    await api.getImagesRoot();
    expect(invoke).toHaveBeenCalledWith('get_images_root', {});
    await api.getDatabasePath();
    expect(invoke).toHaveBeenCalledWith('get_database_path', {});
    await api.getAllImageIds({ tagId: 3 });
    expect(invoke).toHaveBeenCalledWith('get_all_image_ids', { query: { tagId: 3 } });
    await api.fileExists('E:/managed/a.jpg');
    expect(invoke).toHaveBeenCalledWith('file_exists', { filepath: 'E:/managed/a.jpg' });
  });

  it('接缝 4c：导入/改名通道走 Rust 命令', async () => {
    const invoke = vi.fn().mockResolvedValue([]);
    window.__TAURI__ = { core: { invoke } };
    await api.importImages([{ filename: 'a.jpg', filepath: 'E:/src/a.jpg' }], '2026-09-20');
    expect(invoke).toHaveBeenCalledWith('import_images', {
      files: [{ filename: 'a.jpg', filepath: 'E:/src/a.jpg' }],
      dateOverride: '2026-09-20',
    });
    await api.importImages([{ filename: 'a.jpg', filepath: 'E:/src/a.jpg' }]);
    expect(invoke).toHaveBeenLastCalledWith('import_images', {
      files: [{ filename: 'a.jpg', filepath: 'E:/src/a.jpg' }],
      dateOverride: null,
    });
    await api.renameImage(5, 'new.jpg');
    expect(invoke).toHaveBeenCalledWith('rename_image', { id: 5, newFilename: 'new.jpg' });
  });

  it('接缝 R27：保存参数后调度编辑预览渲染（不阻塞保存返回）', async () => {
    const session = { basePath: 'E:/t/edit-5-base.jpg', width: 800, height: 600 };
    const invoke = vi.fn().mockImplementation((cmd) => {
      if (cmd === 'save_edit_params') return Promise.resolve({ version: 2, params: {} });
      if (cmd === 'edit_open') return Promise.resolve(session);
      return Promise.resolve({ path: session.basePath });
    });
    window.__TAURI__ = { core: { invoke } };
    const edits = { exposure: 0.5 };
    const result = await api.saveEdits(5, edits, { label: '保存编辑参数' });
    expect(result).toEqual({ version: 2, params: {} });
    expect(invoke).toHaveBeenNthCalledWith(1, 'save_edit_params', {
      id: 5,
      params: upgradeEdits(edits),
      command: { label: '保存编辑参数' },
    });
    await vi.waitFor(() => {
      expect(invoke).toHaveBeenLastCalledWith(
        'edit_render_preview',
        expect.objectContaining({ id: 5, inputPath: session.basePath, spec: expect.any(Object) })
      );
    });
  });

  it('接缝 R27：onEditPreviewReady 事件走 Tauri listen', () => {
    const listen = vi.fn().mockResolvedValue(() => {});
    window.__TAURI__ = { core: { invoke: vi.fn() }, event: { listen } };
    api.onEditPreviewReady(() => {});
    expect(listen).toHaveBeenCalledWith('edit-preview-ready', expect.any(Function));
  });
});
