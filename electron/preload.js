const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pixyang', {
  // 对话框
  selectDirectory: () => ipcRenderer.invoke('dialog:select-directory'),

  // 文件系统
  scanDirectory: (dirPath) => ipcRenderer.invoke('fs:scan-directory', dirPath),
  getImageData: (filepath, maxWidth) => ipcRenderer.invoke('fs:get-image-data', filepath, maxWidth),
  toFileUrl: (filepath) => ipcRenderer.invoke('fs:to-file-url', filepath),
  fileExists: (filepath) => ipcRenderer.invoke('fs:file-exists', filepath),
  getImagesRoot: () => ipcRenderer.invoke('fs:get-images-root'),
  setImagesRoot: (dirPath) => ipcRenderer.invoke('fs:set-images-root', dirPath),
  openPath: (dirPath) => ipcRenderer.invoke('shell:open-path', dirPath),

  // 数据库 - 图片
  importImages: (imageFiles, dateOverride) => ipcRenderer.invoke('db:import-images', imageFiles, dateOverride),
  syncCameraFolder: () => ipcRenderer.invoke('db:sync-camera-folder'),
  getImages: (options) => ipcRenderer.invoke('db:get-images', options),
  getImage: (id) => ipcRenderer.invoke('db:get-image', id),
  getAllImageIds: (options) => ipcRenderer.invoke('db:get-all-image-ids', options),
  updateImage: (id, updates) => ipcRenderer.invoke('db:update-image', id, updates),
  renameImage: (id, newFilename) => ipcRenderer.invoke('db:rename-image', id, newFilename),
  deleteImage: (id) => ipcRenderer.invoke('db:delete-image', id),
  batchDeleteImages: (ids) => ipcRenderer.invoke('db:batch-delete-images', ids),
  getImportDates: () => ipcRenderer.invoke('db:get-import-dates'),

  // 重建缩略图
  rebuildThumbnails: () => ipcRenderer.invoke('db:rebuild-thumbnails'),

  // 数据库备份
  getDatabasePath: () => ipcRenderer.invoke('fs:get-database-path'),
  backupDatabase: () => ipcRenderer.invoke('fs:backup-database'),

  // 标签
  getTags: () => ipcRenderer.invoke('db:get-tags'),
  createTag: (name, color) => ipcRenderer.invoke('db:create-tag', name, color),
  deleteTag: (id) => ipcRenderer.invoke('db:delete-tag', id),
  addTagToImage: (imageId, tagId) => ipcRenderer.invoke('db:add-tag-to-image', imageId, tagId),
  removeTagFromImage: (imageId, tagId) => ipcRenderer.invoke('db:remove-tag-from-image', imageId, tagId),
  getImageTags: (imageId) => ipcRenderer.invoke('db:get-image-tags', imageId),
  getBatchImageTags: (imageIds) => ipcRenderer.invoke('db:get-batch-image-tags', imageIds),

  // 相册
  getAlbums: () => ipcRenderer.invoke('db:get-albums'),
  createAlbum: (name, description) => ipcRenderer.invoke('db:create-album', name, description),
  renameAlbum: (id, newName) => ipcRenderer.invoke('db:rename-album', id, newName),
  deleteAlbum: (id) => ipcRenderer.invoke('db:delete-album', id),
  addToAlbum: (albumId, imageIds) => ipcRenderer.invoke('db:add-to-album', albumId, imageIds),
  removeFromAlbum: (albumId, imageId) => ipcRenderer.invoke('db:remove-from-album', albumId, imageId),
  selectExportDirectory: () => ipcRenderer.invoke('dialog:select-export-directory'),
  exportAlbumImages: (albumId, destDir) => ipcRenderer.invoke('fs:export-album-images', albumId, destDir),
  exportImages: (ids, destDir) => ipcRenderer.invoke('fs:export-images', ids, destDir),

  // 统计
  getStats: () => ipcRenderer.invoke('db:get-stats'),

  // 设置
  getSettings: () => ipcRenderer.invoke('settings:get-all'),
  getSetting: (key) => ipcRenderer.invoke('settings:get', key),
  setSetting: (key, value) => ipcRenderer.invoke('settings:set', key, value),

  // 方向回填完成通知
  onOrientationBackfill: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('orientation-backfill-done', handler);
    return () => ipcRenderer.removeListener('orientation-backfill-done', handler);
  },

  // 后台缩略图生成完成通知
  onThumbnailsReady: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('thumbnails-ready', handler);
    return () => ipcRenderer.removeListener('thumbnails-ready', handler);
  },
});
