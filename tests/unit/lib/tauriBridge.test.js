// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { isTauriAvailable, tauriInvoke, tauriApi } from '@/lib/tauriBridge';
import api from '@/lib/api';

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
    window.pixyang = { deleteImage: vi.fn().mockResolvedValue(true) };
    await api.deleteImage(42);
    expect(window.pixyang.deleteImage).toHaveBeenCalledWith(42);
    expect(invoke).not.toHaveBeenCalled();
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
});
