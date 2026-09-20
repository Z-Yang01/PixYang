// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { isTauriAvailable, tauriInvoke, tauriApi } from '@/lib/tauriBridge';
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

  it('uniqueFilename 包装命令参数形状（单参数 args 包裹）', async () => {
    const invoke = vi.fn().mockResolvedValue('a_1.jpg');
    window.__TAURI__ = { core: { invoke } };
    await expect(tauriApi.uniqueFilename('E:/pics', 'a.jpg', ['e:/pics/a.jpg'])).resolves.toBe(
      'a_1.jpg'
    );
    expect(invoke).toHaveBeenCalledWith('unique_filename', {
      args: { dir: 'E:/pics', name: 'a.jpg', taken: ['e:/pics/a.jpg'] },
    });
  });

  it('groupImportFiles 包装透传文件列表', async () => {
    const invoke = vi.fn().mockResolvedValue([]);
    window.__TAURI__ = { core: { invoke } };
    const files = [{ filename: 'a.jpg', filepath: 'E:/c/a.jpg' }];
    await tauriApi.groupImportFiles(files);
    expect(invoke).toHaveBeenCalledWith('group_import_files', { files });
  });

  it('api 设置通道在 Tauri 可用时走 Rust 命令', async () => {
    const invoke = vi.fn().mockResolvedValue('dark');
    window.__TAURI__ = { core: { invoke } };
    window.pixyang = { getSetting: vi.fn() };
    await expect(api.getSetting('theme')).resolves.toBe('dark');
    expect(invoke).toHaveBeenCalledWith('get_setting', { key: 'theme' });
    expect(window.pixyang.getSetting).not.toHaveBeenCalled();
  });

  it('api 设置通道在 Electron 运行时仍走 pixyang 桥', async () => {
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
    window.pixyang = { exportImages: vi.fn().mockResolvedValue({ done: 2 }) };
    await api.exportImages([1, 2], 'E:/dest');
    expect(window.pixyang.exportImages).toHaveBeenCalledWith([1, 2], 'E:/dest');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('接缝 R24：对话框/外壳通道在 Tauri 可用时走插件与 Rust 命令', async () => {
    const invoke = vi.fn().mockResolvedValue({ success: true, path: 'E:/backup.db' });
    const dialogOpen = vi.fn().mockResolvedValue('E:/picked');
    const openerOpenPath = vi.fn().mockResolvedValue('');
    window.__TAURI__ = {
      core: { invoke },
      dialog: { open: dialogOpen },
      opener: { openPath: openerOpenPath },
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
    await expect(api.openPath('E:/picked/sub')).resolves.toBe('');
    expect(openerOpenPath).toHaveBeenCalledWith('E:/picked/sub');
    await expect(api.backupDatabase()).resolves.toEqual({ success: true, path: 'E:/backup.db' });
    expect(invoke).toHaveBeenCalledWith('backup_database', {});
  });

  it('接缝 R24：对话框/外壳通道在 Electron 运行时仍走 pixyang 桥', async () => {
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

  it('接缝 5 阶段 1：缩略图/NEF/meta 命令参数形状', async () => {
    const invoke = vi.fn().mockResolvedValue({ width: 100, height: 60 });
    window.__TAURI__ = { core: { invoke } };
    await tauriApi.makeThumbnailTiers('E:/p/a.jpg', 'E:/thumbs', 9);
    expect(invoke).toHaveBeenCalledWith('make_thumbnail_tiers', {
      filepath: 'E:/p/a.jpg',
      thumbsDir: 'E:/thumbs',
      id: 9,
    });
    await tauriApi.extractNefPreview('E:/p/a.nef', 'E:/thumbs/a.jpg');
    expect(invoke).toHaveBeenCalledWith('extract_nef_preview', {
      nefPath: 'E:/p/a.nef',
      outPath: 'E:/thumbs/a.jpg',
    });
    await tauriApi.imageMeta('E:/p/a.jpg');
    expect(invoke).toHaveBeenCalledWith('image_meta', { filepath: 'E:/p/a.jpg' });
  });

  it('接缝 4c：导入/改名通道走 Rust 命令', async () => {
    const invoke = vi.fn().mockResolvedValue([]);
    window.__TAURI__ = { core: { invoke } };
    await api.importImages([{ filename: 'a.jpg', filepath: 'E:/src/a.jpg' }]);
    expect(invoke).toHaveBeenCalledWith('import_images', {
      files: [{ filename: 'a.jpg', filepath: 'E:/src/a.jpg' }],
    });
    await api.renameImage(5, 'new.jpg');
    expect(invoke).toHaveBeenCalledWith('rename_image', { id: 5, newFilename: 'new.jpg' });
  });
});
