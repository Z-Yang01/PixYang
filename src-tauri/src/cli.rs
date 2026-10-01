// 外部 agent CLI 通道：`pixyang cli <子命令> ... --out <file>`。
// 直连 SQLite/渲染内核（不进 GUI 进程、不触发单实例、无窗口）；WAL 多进程并发由
// busy_timeout 保障，与运行中实例同时写时最多等 5s 后中文报错。
// 输出：结果 JSON 写 stdout（dev/debug 可见）；release 的 windows_subsystem=windows 无
// 控制台，外部 agent 必须传 --out <file> 作为唯一可靠回传。

use crate::commands;
use crate::db::Db;
use crate::edit_session;
use serde_json::{json, Value};
use std::io::Write;
use std::path::{Path, PathBuf};

const USAGE: &str = "用法: pixyang cli <子命令> [--out <文件>]
子命令:
  analyze <id>                          图像统计（直方图/均值/分位/裁切占比）
  get-edits <id>                        读当前编辑参数
  save-edits <id> <params.json> [label] 写编辑参数（label 非空自动入历史）
  undo <id>                             撤销上一次编辑保存";

fn err(msg: &str) -> Value {
    json!({ "error": msg })
}

fn parse_id(s: &str) -> Result<i64, Value> {
    s.parse::<i64>()
        .map_err(|_| err(&format!("无效的图片 id: {s}")))
}

/// 执行单个子命令。拆出供单测注入内存库。
fn dispatch(db: &Db, args: &[String]) -> Value {
    let Some(cmd) = args.first() else {
        return err(USAGE);
    };
    let rest = &args[1..];
    let parse_id_at = |i: usize| -> Result<i64, Value> {
        rest.get(i)
            .map(|s| parse_id(s))
            .unwrap_or_else(|| Err(err("缺少图片 id 参数")))
    };
    match cmd.as_str() {
        "analyze" => match parse_id_at(0) {
            Ok(id) => commands::analyze_image_kernel(db, id)
                .unwrap_or_else(|e| err(&crate::err_cn::text(&e))),
            Err(e) => e,
        },
        "get-edits" => match parse_id_at(0) {
            Ok(id) => edit_session::get_edits(&db.write_lock(), id)
                .unwrap_or_else(|e| err(&crate::err_cn::text(&e))),
            Err(e) => e,
        },
        "save-edits" => {
            let id = match parse_id_at(0) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let Some(path) = rest.get(1) else {
                return err("缺少参数文件路径: save-edits <id> <params.json> [label]");
            };
            let text = match std::fs::read_to_string(path) {
                Ok(t) => t,
                Err(e) => return err(&format!("读取参数文件失败: {e}")),
            };
            let params: Value = match serde_json::from_str(&text) {
                Ok(v) => v,
                Err(e) => return err(&format!("参数 JSON 解析失败: {e}")),
            };
            let label = rest.get(2).cloned().unwrap_or_default();
            let command = if label.is_empty() {
                None
            } else {
                Some(json!({ "label": label }))
            };
            match edit_session::save_edit_params(&db.write_lock(), id, &params, command.as_ref()) {
                Ok(v) => v,
                Err(e) => err(&crate::err_cn::text(&e)),
            }
        }
        "undo" => match parse_id_at(0) {
            Ok(id) => edit_session::undo_last_edit_conn(&db.write_lock(), id)
                .unwrap_or_else(|e| err(&crate::err_cn::text(&e))),
            Err(e) => e,
        },
        other => err(&format!("未知子命令: {other}\n{USAGE}")),
    }
}

/// CLI 入口：返回进程退出码。结果写 stdout（有控制台时）与 --out 文件（必须）。
pub fn run(args: &[String]) -> i32 {
    let mut out_path: Option<PathBuf> = None;
    let mut rest: Vec<String> = Vec::new();
    let mut i = 0;
    while i < args.len() {
        if args[i] == "--out" {
            match args.get(i + 1) {
                Some(p) => {
                    out_path = Some(PathBuf::from(p));
                    i += 2;
                }
                None => {
                    eprintln!("[cli] --out 缺少文件路径");
                    return 2;
                }
            }
        } else {
            rest.push(args[i].clone());
            i += 1;
        }
    }
    if rest.first().map(String::as_str) == Some("help") || rest.is_empty() {
        println!("{USAGE}");
        return 0;
    }
    let Some(out) = out_path else {
        eprintln!("[cli] 缺少 --out <文件>（release 版无控制台，文件是唯一可靠回传）\n{USAGE}");
        return 2;
    };
    let db_path = crate::db::resolve_data_dir().join("pixyang.db");
    let db = match Db::open(&db_path) {
        Ok(d) => d,
        Err(e) => {
            let v = err(&format!("打开数据库失败: {e}"));
            return write_out(&out, &v);
        }
    };
    let result = dispatch(&db, &rest);
    write_out(&out, &result)
}

fn write_out(out: &Path, result: &Value) -> i32 {
    let text = serde_json::to_string_pretty(result).unwrap_or_else(|_| "{}".into());
    let ok = result.get("error").is_none();
    match std::fs::write(out, &text).and_then(|_| std::io::stdout().write_all(text.as_bytes())) {
        Ok(()) => {
            println!();
            if ok {
                0
            } else {
                1
            }
        }
        Err(e) => {
            eprintln!("[cli] 写出失败: {e}");
            2
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cli_db(tag: &str) -> (Db, PathBuf, i64) {
        let dir = std::env::temp_dir().join(format!("pixyang_cli_{}_{}", std::process::id(), tag));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        // 生产同路径 Db::open（完整 schema 自举），避免测试手抄 DDL 与真库形状漂移
        let db = Db::open(&dir.join("pixyang.db")).unwrap();
        let src = dir.join("a.png");
        image::DynamicImage::from(image::RgbaImage::from_fn(8, 8, |_, _| {
            image::Rgba([90, 90, 90, 255])
        }))
        .save(&src)
        .unwrap();
        db.write_lock()
            .execute(
                "INSERT INTO images (filename, filepath, import_date, format) VALUES ('a.png', ?1, '2026-09-29', 'png')",
                rusqlite::params![src.to_string_lossy()],
            )
            .unwrap();
        let id = db
            .write_lock()
            .query_row("SELECT id FROM images WHERE filename = 'a.png'", [], |r| {
                r.get(0)
            })
            .unwrap();
        (db, dir, id)
    }

    #[test]
    fn 未知子命令与缺参返回中文错误() {
        let (db, _dir, id) = cli_db("err");
        let out = dispatch(&db, &["nope".to_string()]);
        assert!(out["error"].as_str().unwrap().contains("未知子命令"));
        let out = dispatch(&db, &["analyze".to_string()]);
        assert!(out["error"].as_str().unwrap().contains("缺少图片 id"));
        let out = dispatch(&db, &["analyze".to_string(), "abc".to_string()]);
        assert!(out["error"].as_str().unwrap().contains("无效的图片 id"));
        let out = dispatch(&db, &[format!("analyze {id}")]);
        assert!(!out["error"].is_null());
        let _ = std::fs::remove_dir_all(&_dir);
    }

    #[test]
    fn analyze_get_edits_save_edits_undo_全链() {
        let (db, dir, id) = cli_db("main");
        let out = dispatch(&db, &["analyze".to_string(), id.to_string()]);
        assert_eq!(out["width"], 8);
        assert_eq!(out["mean"]["l"], 0.352941);

        let out = dispatch(&db, &["get-edits".to_string(), id.to_string()]);
        assert!(out.is_null(), "get_edits 应为 Null: {out}");

        let params_file = dir.join("p.json");
        std::fs::write(&params_file, r#"{"basic":{"exposure":0.5}}"#).unwrap();
        let out = dispatch(
            &db,
            &[
                "save-edits".to_string(),
                id.to_string(),
                params_file.to_string_lossy().to_string(),
                "CLI 调整".to_string(),
            ],
        );
        assert_eq!(out["version"], 1);
        let out = dispatch(&db, &["get-edits".to_string(), id.to_string()]);
        assert_eq!(out["params"]["basic"]["exposure"], 0.5);

        let out = dispatch(&db, &["undo".to_string(), id.to_string()]);
        assert_eq!(out["version"], 2);
        let out = dispatch(&db, &["get-edits".to_string(), id.to_string()]);
        assert_eq!(out["params"]["basic"]["exposure"], 0);
        // 再撤销：最新步（撤销步）before 缺失 → 向前取最近 after（0.5）→ 恢复
        let out = dispatch(&db, &["undo".to_string(), id.to_string()]);
        assert_eq!(out["version"], 3);
        let out = dispatch(&db, &["get-edits".to_string(), id.to_string()]);
        assert_eq!(out["params"]["basic"]["exposure"], 0.5);
        // 第三次：最新步 before = {exposure:0.5} → 回默认参数
        let out = dispatch(&db, &["undo".to_string(), id.to_string()]);
        assert_eq!(out["version"], 4);
        let out = dispatch(&db, &["get-edits".to_string(), id.to_string()]);
        assert_eq!(out["params"]["basic"]["exposure"], 0);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
