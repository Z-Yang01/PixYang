const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('pixyang', {
  // 对话框
  selectDirectory: () => ipcRenderer.invoke('dialog:select-directory'),

  // 文件系统
  scanDirectory: (dirPath) => ipcRenderer.invoke('fs:scan-directory', dirPath),
  collectImportFiles: (paths) => ipcRenderer.invoke('fs:collect-import-files', paths),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  getExif: (filepath) => ipcRenderer.invoke('fs:get-exif', filepath),
  toFileUrl: (filepath) => ipcRenderer.invoke('fs:to-file-url', filepath),
  toFileUrls: (paths) => ipcRenderer.invoke('fs:to-file-urls', paths),
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
  editOpen: (id) => ipcRenderer.invoke('fs:edit-open', id),
  editRender: (id, ops) => ipcRenderer.invoke('fs:edit-render', id, ops),
  editSave: (id) => ipcRenderer.invoke('fs:edit-save', id),
  editCancel: (id) => ipcRenderer.invoke('fs:edit-cancel', id),  onRebuildProgress: (callback) => {
    const handler = (_event, progress) => callback(progress);
    ipcRenderer.on('rebuild-progress', handler);
    return () => ipcRenderer.removeListener('rebuild-progress', handler);
  },

  // 失效记录维护
  scanBrokenRecords: () => ipcRenderer.invoke('db:scan-broken-records'),
  deleteBrokenRecords: (ids) => ipcRenderer.invoke('db:delete-broken-records', ids),

  // 重复图片检测
  findDuplicates: () => ipcRenderer.invoke('db:find-duplicates'),

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
  addTagToImages: (imageIds, tagId) => ipcRenderer.invoke('db:add-tag-to-images', imageIds, tagId),
  updateImages: (imageIds, updates) => ipcRenderer.invoke('db:update-images', imageIds, updates),

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

  // 导入进度通知（EXIF 提取等主进程侧阶段性进度）
  onImportProgress: (callback) => {
    const handler = (_event, progress) => callback(progress || null);
    ipcRenderer.on('import-progress', handler);
    return () => ipcRenderer.removeListener('import-progress', handler);
  },

  // 方向回填完成通知
  onOrientationBackfill: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('orientation-backfill-done', handler);
    return () => ipcRenderer.removeListener('orientation-backfill-done', handler);
  },

  // 后台缩略图生成完成通知（携带本次生成的图片 id 列表）
  onThumbnailsReady: (callback) => {
    const handler = (_event, ids) => callback(ids);
    ipcRenderer.on('thumbnails-ready', handler);
    return () => ipcRenderer.removeListener('thumbnails-ready', handler);
  },
});
