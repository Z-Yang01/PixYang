const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pixyang', {
  // Dialog
  selectDirectory: () => ipcRenderer.invoke('dialog:select-directory'),

  // File system
  scanDirectory: (dirPath) => ipcRenderer.invoke('fs:scan-directory', dirPath),
  getThumbnail: (filepath) => ipcRenderer.invoke('fs:get-thumbnail', filepath),
  getImageData: (filepath, maxWidth) => ipcRenderer.invoke('fs:get-image-data', filepath, maxWidth),
  fileExists: (filepath) => ipcRenderer.invoke('fs:file-exists', filepath),

  // Database - Images
  importImages: (imageFiles) => ipcRenderer.invoke('db:import-images', imageFiles),
  getImages: (options) => ipcRenderer.invoke('db:get-images', options),
  getImage: (id) => ipcRenderer.invoke('db:get-image', id),
  updateImage: (id, updates) => ipcRenderer.invoke('db:update-image', id, updates),
  deleteImage: (id) => ipcRenderer.invoke('db:delete-image', id),
  getDirectories: () => ipcRenderer.invoke('db:get-directories'),

  // Tags
  getTags: () => ipcRenderer.invoke('db:get-tags'),
  createTag: (name, color) => ipcRenderer.invoke('db:create-tag', name, color),
  deleteTag: (id) => ipcRenderer.invoke('db:delete-tag', id),
  addTagToImage: (imageId, tagId) => ipcRenderer.invoke('db:add-tag-to-image', imageId, tagId),
  removeTagFromImage: (imageId, tagId) => ipcRenderer.invoke('db:remove-tag-from-image', imageId, tagId),
  getImageTags: (imageId) => ipcRenderer.invoke('db:get-image-tags', imageId),

  // Albums
  getAlbums: () => ipcRenderer.invoke('db:get-albums'),
  createAlbum: (name, description) => ipcRenderer.invoke('db:create-album', name, description),
  deleteAlbum: (id) => ipcRenderer.invoke('db:delete-album', id),
  addToAlbum: (albumId, imageIds) => ipcRenderer.invoke('db:add-to-album', albumId, imageIds),
  removeFromAlbum: (albumId, imageId) => ipcRenderer.invoke('db:remove-from-album', albumId, imageId),

  // Stats
  getStats: () => ipcRenderer.invoke('db:get-stats'),
});
