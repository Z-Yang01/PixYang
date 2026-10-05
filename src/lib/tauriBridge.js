// Tauri 后端探测与调用封装。window.__TAURI__ 不存在（纯浏览器/单测）时
// isTauriAvailable() 为 false，api.js 回落 window.pixyang 注入面。
// 依赖 tauri.conf.json 的 app.withGlobalTauri 注入的全局，不新增 npm 依赖。
import editSchema from '../../shared/editSchema.cjs';
import renderSpecModule from '../../shared/renderSpec.cjs';

const { upgradeEdits } = editSchema;
const { editParamsToRenderSpec, buildProxySpec } = renderSpecModule;

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

function requirePluginGlobal(plugin, method) {
  if (!plugin || typeof plugin[method] !== 'function') {
    throw new Error('[tauriBridge] Tauri 运行时不可用');
  }
  return plugin;
}

export const tauriApi = {
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
  deleteImageToTrash: (id) => tauriInvoke('delete_image_to_trash', { id }),
  batchDeleteImagesToTrash: (ids) => tauriInvoke('batch_delete_images_to_trash', { ids }),
  restoreImageFromTrash: (id) => tauriInvoke('restore_image_from_trash', { id }),
  // presets：upgradeEdits 规整在桥接层（前端与桥同用 shared/editSchema.cjs）
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
  // 与 Rust set_images_root(dir_path) 对齐；sync_camera_folder 无用户参数（相机根取自 settings）
  setImagesRoot: (dirPath) => tauriInvoke('set_images_root', { dirPath }),
  syncCameraFolder: () => tauriInvoke('sync_camera_folder', {}),
  getDatabasePath: () => tauriInvoke('get_database_path'),
  getAllImageIds: (options) => tauriInvoke('get_all_image_ids', { query: options ?? {} }),
  fileExists: (filepath) => tauriInvoke('file_exists', { filepath }),
  selectDirectory: async () => {
    const dialog = requirePluginGlobal(tauriDialog(), 'open');
    return dialog.open({ directory: true, title: '选择要导入的图片文件夹' });
  },
  selectExportDirectory: async () => {
    const dialog = requirePluginGlobal(tauriDialog(), 'open');
    return dialog.open({ directory: true, title: '选择导出的目标文件夹' });
  },
  openPath: (path) => tauriInvoke('open_path', { path }),
  backupDatabase: () => tauriInvoke('backup_database'),
  importImages: (files, dateOverride) =>
    tauriInvoke('import_images', { files, dateOverride: dateOverride ?? null }),
  renameImage: (id, newFilename) => tauriInvoke('rename_image', { id, newFilename }),
  // options 缺省/null = 原样复制（Rust BatchExportOptions::from_json 的 None 回退）；转换模式传 { mode:'convert', ... }
  exportImages: (ids, destDir, options) =>
    tauriInvoke('export_images', options == null ? { ids, destDir } : { ids, destDir, options }),
  // R99 相册导出与批量导出同口径：options 缺省/null = 原样复制（invoke 不带 options 键）
  exportAlbumImages: (albumId, destDir, options) =>
    tauriInvoke(
      'export_album_images',
      options == null ? { albumId, destDir } : { albumId, destDir, options }
    ),
  getExif: (filepath) => tauriInvoke('get_exif', { filepath }),
  analyzeImage: (id) => tauriInvoke('analyze_image', { id }),
  scanDirectory: (dirPath) => tauriInvoke('scan_directory', { dir: dirPath }),
  collectImportFiles: (paths) => tauriInvoke('collect_import_files', { paths }),
  updateImage: (id, updates) => tauriInvoke('update_image', { id, updates }),
  updateImages: (imageIds, updates) => tauriInvoke('update_images', { imageIds, updates }),
  rebuildThumbnails: () => tauriInvoke('rebuild_thumbnails_with_events', { all: true }),
  scanBrokenRecords: () => tauriInvoke('scan_broken_records', {}),
  deleteBrokenRecords: (ids) => tauriInvoke('delete_broken_records', { ids }),
  findDuplicates: () => tauriInvoke('find_duplicates', {}),
  getEdits: async (id) => {
    const row = await tauriInvoke('get_edits', { id });
    if (!row) return null;
    let params = row.params;
    try {
      params = upgradeEdits(row.params);
    } catch (e) {
      console.error('[tauriBridge] 编辑参数规整失败:', e.message);
    }
    return { version: row.version, updatedAt: row.updatedAt, params };
  },
  saveEdits: (id, params, command) =>
    tauriInvoke('save_edit_params', { id, params: upgradeEdits(params), command }).then(
      (result) => {
        // 保存成功后异步刷新编辑预览缩略图（不阻塞保存；失败仅告警）
        if (result && !result.error) {
          renderEditPreviewAfterSave(id, params).catch((e) =>
            console.error('[tauriBridge] 编辑预览渲染失败:', e.message)
          );
        }
        return result;
      }
    ),
  getEditHistory: (id) => tauriInvoke('get_edit_history', { id }),
  // 持久化历史撤销：Rust 侧原子组合（读回退目标 → save_edit_params 链写回，全程持写锁），
  // 成功后桥内补 edit_render_preview 链刷新缩略图（同 saveEdits 成功路径）。空历史返回 {error}
  undoLastEdit: async (id) => {
    const result = await tauriInvoke('undo_last_edit', { id });
    if (result?.error) return result;
    const params = await tauriInvoke('get_edits', { id }).then((r) => r?.params ?? null);
    if (params) {
      renderEditPreviewAfterSave(id, params).catch((e) =>
        console.error('[tauriBridge] 撤销预览渲染失败:', e.message)
      );
    }
    return result;
  },
  // 前端语义接缝（桥内闭环，无后端命令）：编辑底图是按 id 复用的 sidecar 校验缓存，
  // 后端无会话注册表，此通道只供查看器统一收口退出/卸载路径
  editCancel: (id) => Promise.resolve({ ok: true }),
  // 编辑器三通道：spec 桥内构建（sourceHash 仅作 renderSpec 必填占位，Tauri 执行器不消费）；
  // bake/export 的输出格式、maxEdge、命名循环由 Rust 命令内部自理
  editOpen: (id) => tauriInvoke('edit_open', { id }),
  editBake: async (id, edits) => {
    const session = await tauriInvoke('edit_open', { id });
    if (session?.error) return session;
    const spec = editParamsToRenderSpec(edits, { sourceHash: session.basePath });
    return tauriInvoke('edit_bake', { id, edits, spec, inputPath: session.basePath });
  },
  editExport: async (id, edits, destDir, output) => {
    const session = await tauriInvoke('edit_open', { id });
    if (session?.error) return session;
    const spec = editParamsToRenderSpec(edits, { sourceHash: session.basePath });
    return tauriInvoke('edit_export', {
      id,
      edits,
      spec,
      inputPath: session.basePath,
      destDir,
      output: output ?? null,
    });
  },
};

// 保存参数后的网格缩略图预览：400 长边代理 spec（crop/蒙版坐标由 buildProxySpec 等比缩放），
// 渲染/写库/发 edit-preview-ready 事件在 edit_render_preview 内闭环
async function renderEditPreviewAfterSave(id, params) {
  const session = await tauriInvoke('edit_open', { id });
  if (session?.error) return;
  const spec = editParamsToRenderSpec(params, { sourceHash: session.basePath });
  const { spec: proxySpec } = buildProxySpec(spec, session.width, session.height, 400);
  await tauriInvoke('edit_render_preview', { id, spec: proxySpec, inputPath: session.basePath });
}
