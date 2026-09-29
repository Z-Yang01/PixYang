// 统一 window.pixyang 访问层：集中守卫，组件不再散布 if (!window.pixyang) 判断。
// 生产运行时（Tauri）路由规则：tauriBridge/tauriBridgeMedia 存在同名包装且 Tauri 可用 → Rust 命令；
// 否则透传 window.pixyang（单测注入面/无桥降级，缺失时返回 undefined 按空数据处理）。
import { isTauriAvailable, tauriApi } from './tauriBridge';
import * as tauriMedia from './tauriBridgeMedia';

const px = () => (typeof window !== 'undefined' ? window.pixyang : undefined);

// 每个方法透传 IPC；bridge 不存在时返回 undefined（调用方按空数据处理）
const passthrough =
  (name) =>
  (...args) => {
    const bridge = px();
    if (!bridge || typeof bridge[name] !== 'function') return undefined;
    return bridge[name](...args);
  };

const api = {
  isBridgeAvailable: () => !!px() || isTauriAvailable(),
};
for (const name of [
  'selectDirectory',
  'scanDirectory',
  'collectImportFiles',
  'getPathForFile',
  'getExif',
  'analyzeImage',
  'toFileUrl',
  'toFileUrls',
  'fileExists',
  'getImagesRoot',
  'setImagesRoot',
  'openPath',
  'importImages',
  'syncCameraFolder',
  'getImages',
  'getImage',
  'getAlbumImages',
  'getAllImageIds',
  'updateImage',
  'renameImage',
  'deleteImage',
  'batchDeleteImages',
  'deleteImageToTrash',
  'batchDeleteImagesToTrash',
  'restoreImageFromTrash',
  'getImportDates',
  'rebuildThumbnails',
  'editOpen',
  'getEdits',
  'saveEdits',
  'undoLastEdit',
  'getEditHistory',
  'editBake',
  'editExport',
  'editCancel',
  'getPresets',
  'createPreset',
  'deletePreset',
  'onRebuildProgress',
  'onImportProgress',
  'scanBrokenRecords',
  'deleteBrokenRecords',
  'findDuplicates',
  'getDatabasePath',
  'backupDatabase',
  'getTags',
  'createTag',
  'deleteTag',
  'addTagToImage',
  'removeTagFromImage',
  'getImageTags',
  'getBatchImageTags',
  'addTagToImages',
  'updateImages',
  'getAlbums',
  'createAlbum',
  'renameAlbum',
  'deleteAlbum',
  'addToAlbum',
  'removeFromAlbum',
  'selectExportDirectory',
  'exportAlbumImages',
  'exportImages',
  'getStats',
  'getSettings',
  'getSetting',
  'setSetting',
  'onThumbnailsReady',
  'onEditPreviewReady',
]) {
  api[name] = (...args) => {
    const impl = tauriMedia[name] ?? tauriApi[name];
    if (impl && isTauriAvailable()) return impl(...args);
    return passthrough(name)(...args);
  };
}

export default api;
