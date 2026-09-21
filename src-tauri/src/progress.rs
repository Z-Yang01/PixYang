use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

pub const REBUILD_PROGRESS: &str = "rebuild-progress";
pub const IMPORT_PROGRESS: &str = "import-progress";
pub const THUMBNAILS_READY: &str = "thumbnails-ready";
pub const EDIT_PREVIEW_READY: &str = "edit-preview-ready";

pub fn emit_progress(app: &AppHandle, event: &str, payload: Value) {
    if let Err(e) = app.emit(event, payload) {
        eprintln!("[进度] 事件发送失败: {event} {e}");
    }
}

pub fn rebuild_payload(done: i64, total: i64, failed: i64) -> Value {
    json!({ "done": done, "total": total, "failed": failed })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 进度事件名常量与preload通道对齐() {
        assert_eq!(REBUILD_PROGRESS, "rebuild-progress");
        assert_eq!(IMPORT_PROGRESS, "import-progress");
        assert_eq!(THUMBNAILS_READY, "thumbnails-ready");
        assert_eq!(EDIT_PREVIEW_READY, "edit-preview-ready");
    }

    #[test]
    fn 重建进度载荷含已完成总数与失败数() {
        let payload = rebuild_payload(3, 10, 1);
        assert_eq!(payload["done"], 3);
        assert_eq!(payload["total"], 10);
        assert_eq!(payload["failed"], 1);
    }
}
