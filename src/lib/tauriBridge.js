// Tauri 后端探测与调用封装。Electron 运行时 window.__TAURI__ 不存在，
// isTauriAvailable() 为 false，api.js 维持原 IPC 路径；桥仅供逐步迁移的调用方使用。
// 依赖 tauri.conf.json 的 app.withGlobalTauri 注入的全局，不新增 npm 依赖。
import editSchema from '../../shared/editSchema.cjs';

const { upgradeEdits } = editSchema;

function tauriCore() {
  if (typeof window === 'undefined') return null;
  return window.__TAURI__?.core ?? null;
}

export function isTauriAvailable() {
  return typeof tauriCore()?.invoke === 'function';
}

export async function tauriInvoke(cmd, args = {}) {
  const core = tauriCore();
  if (!core || typeof core.invoke !== 'function') {
    throw new Error('[tauriBridge] Tauri 运行时不可用');
  }
  return core.invoke(cmd, args);
}

export const tauriApi = {
  uniqueFilename: (dir, name, taken = []) =>
    tauriInvoke('unique_filename', { args: { dir, name, taken } }),
  groupImportFiles: (files) => tauriInvoke('group_import_files', { files }),
  getSettings: () => tauriInvoke('get_settings'),
  getSetting: (key) => tauriInvoke('get_setting', { key }),
  setSetting: (key, value) => tauriInvoke('set_setting', { key, value }),
  getTags: () => tauriInvoke('get_tags'),
  getAlbums: () => tauriInvoke('get_albums'),
  getImageTags: (imageId) => tauriInvoke('get_image_tags', { imageId }),
  getBatchImageTags: (imageIds) => tauriInvoke('get_batch_image_tags', { imageIds }),
  getImages: (options) => tauriInvoke('get_images', { query: options ?? {} }),
  getImage: (id) => tauriInvoke('get_image', { id }),
  getImportDates: () => tauriInvoke('get_import_dates'),
  getStats: () => tauriInvoke('get_stats'),
  getAlbumImages: (albumId) => tauriInvoke('get_album_images', { albumId }),
  createTag: (name, color) => tauriInvoke('create_tag', { name, color }),
  deleteTag: (id) => tauriInvoke('delete_tag', { id }),
  addTagToImage: (imageId, tagId) => tauriInvoke('add_tag_to_image', { imageId, tagId }),
  removeTagFromImage: (imageId, tagId) => tauriInvoke('remove_tag_from_image', { imageId, tagId }),
  addTagToImages: (imageIds, tagId) => tauriInvoke('add_tag_to_images', { imageIds, tagId }),
  createAlbum: (name, description) => tauriInvoke('create_album', { name, description }),
  renameAlbum: (id, newName) => tauriInvoke('rename_album', { id, newName }),
  deleteAlbum: (id) => tauriInvoke('delete_album', { id }),
  addToAlbum: (albumId, imageIds) => tauriInvoke('add_to_album', { albumId, imageIds }),
  removeFromAlbum: (albumId, imageId) => tauriInvoke('remove_from_album', { albumId, imageId }),
  deleteImage: (id) => tauriInvoke('delete_image', { id }),
  batchDeleteImages: (ids) => tauriInvoke('batch_delete_images', { ids }),
  // presets：upgradeEdits 规整在桥接层（与 Electron 主进程同用 shared/editSchema.cjs）
  getPresets: async () => {
    const rows = await tauriInvoke('get_presets');
    return rows.map((r) => {
      let params = null;
      try {
        params = upgradeEdits(r.params);
      } catch {
        params = null;
      }
      return { id: r.id, name: r.name, params, createdAt: r.createdAt };
    });
  },
  createPreset: (name, params) =>
    tauriInvoke('create_preset', { name, params: upgradeEdits(params) }),
  deletePreset: (id) => tauriInvoke('delete_preset', { id }),
  getImagesRoot: () => tauriInvoke('get_images_root'),
  getDatabasePath: () => tauriInvoke('get_database_path'),
  getAllImageIds: (options) => tauriInvoke('get_all_image_ids', { query: options ?? {} }),
  fileExists: (filepath) => tauriInvoke('file_exists', { filepath }),
  makeThumbnailTiers: (filepath, thumbsDir, id) =>
    tauriInvoke('make_thumbnail_tiers', { filepath, thumbsDir, id }),
  extractNefPreview: (nefPath, outPath) => tauriInvoke('extract_nef_preview', { nefPath, outPath }),
  imageMeta: (filepath) => tauriInvoke('image_meta', { filepath }),
  renderEdit: (spec, inputPath, outputPath) =>
    tauriInvoke('render_edit', { spec, inputPath, outputPath }),
};
