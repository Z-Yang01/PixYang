// 统一 window.pixyang 访问层：集中守卫，组件不再散布 if (!window.pixyang) 判断
const px = () => (typeof window !== 'undefined' ? window.pixyang : undefined);

// 每个方法透传 IPC；bridge 不存在时返回 undefined（调用方按空数据处理）
const passthrough = (name) => (...args) => {
  const bridge = px();
  if (!bridge || typeof bridge[name] !== 'function') return undefined;
  return bridge[name](...args);
};

const api = {
  isBridgeAvailable: () => !!px(),
};
for (const name of [
  'selectDirectory',
  'scanDirectory',
  'collectImportFiles',
  'getPathForFile',
  'getExif',
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
  'getAllImageIds',
  'updateImage',
  'renameImage',
  'deleteImage',
  'batchDeleteImages',
  'getImportDates',
  'rebuildThumbnails',
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
  'onOrientationBackfill',
  'onThumbnailsReady',
]) {
  api[name] = passthrough(name);
}

export const isBridgeAvailable = () => !!px();
export default api;
