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

function tauriDialog() {
  if (typeof window === 'undefined') return null;
  return window.__TAURI__?.dialog ?? null;
}

function tauriOpener() {
  if (typeof window === 'undefined') return null;
  return window.__TAURI__?.opener ?? null;
}

function requirePluginGlobal(plugin, method) {
  if (!plugin || typeof plugin[method] !== 'function') {
    throw new Error('[tauriBridge] Tauri 运行时不可用');
  }
  return plugin;
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
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      params: (() => {
        try {
          return upgradeEdits(r.params);
        } catch {
          return null;
        }
      })(),
      createdAt: r.createdAt,
    }));
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
  selectDirectory: async () => {
    const dialog = requirePluginGlobal(tauriDialog(), 'open');
    return dialog.open({ directory: true, title: '选择要导入的图片文件夹' });
  },
  selectExportDirectory: async () => {
    const dialog = requirePluginGlobal(tauriDialog(), 'open');
    return dialog.open({ directory: true, title: '选择导出的目标文件夹' });
  },
  openPath: async (path) => {
    const opener = requirePluginGlobal(tauriOpener(), 'openPath');
    return opener.openPath(path);
  },
  backupDatabase: () => tauriInvoke('backup_database'),
  renderEdit: (spec, inputPath, outputPath) =>
    tauriInvoke('render_edit', { spec, inputPath, outputPath }),
  importImages: (files) => tauriInvoke('import_images', { files }),
  renameImage: (id, newFilename) => tauriInvoke('rename_image', { id, newFilename }),
  getExif: (filepath) => tauriInvoke('get_exif', { filepath }),
  scanDirectory: (dirPath) => tauriInvoke('scan_directory', { dir: dirPath }),
  collectImportFiles: (paths) => tauriInvoke('collect_import_files', { paths }),
  updateImage: (id, updates) => tauriInvoke('update_image', { id, updates }),
  updateImages: (imageIds, updates) => tauriInvoke('update_images', { imageIds, updates }),
  rebuildThumbnails: () => tauriInvoke('rebuild_thumbnails', { all: false }),
  scanBrokenRecords: () => tauriInvoke('scan_broken_records', {}),
  deleteBrokenRecords: (ids) => tauriInvoke('delete_broken_records', { ids }),
  findDuplicates: () => tauriInvoke('find_duplicates', {}),
  getEdits: (id) => tauriInvoke('get_edits', { id }),
  saveEdits: (id, params, command) => tauriInvoke('save_edit_params', { id, params, command }),
  getEditHistory: (id) => tauriInvoke('get_edit_history', { id }),
  editCancel: (id) => Promise.resolve({ ok: true }),
};
