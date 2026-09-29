// 图片列表查询内核：SQL 与 electron/database.js 的 getImages/getImportDates/getStats/
// getImageById 逐语义镜像。行值按列名取（migrateSchema 追加列会让旧库列序与建表序不一致，
// 禁止按索引取 i.*）。排序白名单/taken_at 回退/次级 id 稳定序/LIMIT 夹取全部保留。

use rusqlite::Connection;
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageQuery {
    #[serde(default)]
    pub tag_id: Option<i64>,
    #[serde(default)]
    pub album_id: Option<i64>,
    #[serde(default)]
    pub date_from: String,
    #[serde(default)]
    pub date_to: String,
    #[serde(default)]
    pub import_date: String,
    #[serde(default)]
    pub favorite: Option<bool>,
    /// 评分下限（1-5；0 与 None 同义=不过滤，与前端 filterMinRating 默认值同口径）。
    /// 不夹取上界：6+ 合法反序列化、恒空集（超出 1-5 星域的显式查询语义）
    #[serde(default)]
    pub min_rating: Option<u32>,
    #[serde(default)]
    pub search: String,
    #[serde(default)]
    pub sort_by: Option<String>,
    #[serde(default)]
    pub sort_order: Option<String>,
    #[serde(default)]
    pub limit: Option<f64>,
    #[serde(default)]
    pub offset: Option<f64>,
}

#[derive(Debug, Serialize)]
pub struct ImageRow {
    pub id: i64,
    pub filename: String,
    pub filepath: String,
    pub original_path: Option<String>,
    pub raw_path: Option<String>,
    pub original_raw_path: Option<String>,
    pub hidden: Option<i64>,
    pub orientation: Option<i64>,
    pub rotation: Option<i64>,
    pub flip_h: Option<i64>,
    pub flip_v: Option<i64>,
    pub import_date: String,
    pub taken_at: Option<String>,
    pub size: Option<i64>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub format: Option<String>,
    pub thumbnail: Option<String>,
    pub thumbnail_path: Option<String>,
    pub thumbnail_small_path: Option<String>,
    pub rating: Option<i64>,
    pub favorite: Option<i64>,
    pub notes: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

pub(crate) fn row_from(row: &rusqlite::Row) -> rusqlite::Result<ImageRow> {
    Ok(ImageRow {
        id: row.get("id")?,
        filename: row.get("filename")?,
        filepath: row.get("filepath")?,
        original_path: row.get("original_path")?,
        raw_path: row.get("raw_path")?,
        original_raw_path: row.get("original_raw_path")?,
        hidden: row.get("hidden")?,
        orientation: row.get("orientation")?,
        rotation: row.get("rotation")?,
        flip_h: row.get("flip_h")?,
        flip_v: row.get("flip_v")?,
        import_date: row.get("import_date")?,
        taken_at: row.get("taken_at")?,
        size: row.get("size")?,
        width: row.get("width")?,
        height: row.get("height")?,
        format: row.get("format")?,
        thumbnail: row.get("thumbnail")?,
        thumbnail_path: row.get("thumbnail_path")?,
        thumbnail_small_path: row.get("thumbnail_small_path")?,
        rating: row.get("rating")?,
        favorite: row.get("favorite")?,
        notes: row.get("notes")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

/// 搜索词转 LIKE 模式：% _ 与转义符本身需反斜杠转义（配合 ESCAPE '\'），否则「%」命中全库
pub fn like_pattern(term: &str) -> String {
    let mut out = String::from("%");
    for c in term.chars() {
        if c == '\\' || c == '%' || c == '_' {
            out.push('\\');
        }
        out.push(c);
    }
    out.push('%');
    out
}

/// getImages/getAllVisibleIds 共用的筛选构造（join/conditions/params 顺序即 SQL 拼接顺序）
fn build_filters(
    q: &ImageQuery,
    joins: &mut Vec<&'static str>,
    conditions: &mut Vec<String>,
    params: &mut Vec<Box<dyn rusqlite::ToSql>>,
) {
    if let Some(tag_id) = q.tag_id.filter(|v| *v != 0) {
        joins.push("JOIN image_tags it ON i.id = it.image_id");
        conditions.push("it.tag_id = ?".into());
        params.push(Box::new(tag_id));
    }
    if let Some(album_id) = q.album_id.filter(|v| *v != 0) {
        joins.push("JOIN album_images ai ON i.id = ai.image_id");
        conditions.push("ai.album_id = ?".into());
        params.push(Box::new(album_id));
    }
    if !q.import_date.is_empty() {
        conditions.push("i.import_date = ?".into());
        params.push(Box::new(q.import_date.clone()));
    } else {
        if !q.date_from.is_empty() {
            conditions.push("i.import_date >= ?".into());
            params.push(Box::new(q.date_from.clone()));
        }
        if !q.date_to.is_empty() {
            conditions.push("i.import_date <= ?".into());
            params.push(Box::new(q.date_to.clone()));
        }
    }
    if q.favorite.unwrap_or(false) {
        conditions.push("i.favorite = 1".into());
    }
    if let Some(min_rating) = q.min_rating.filter(|v| *v > 0) {
        // rating 列默认 0（未评分）；NULL ≥ N 恒假，与前端剪枝 (rating||0) < min 同口径
        conditions.push("i.rating >= ?".into());
        params.push(Box::new(min_rating));
    }
    if !q.search.is_empty() {
        // 对 JS 镜像的已记录分歧（R71，README:67 承诺口径优先）：镜像仅搜
        // filename/notes/标签名，这里额外纳入 original_path（导入来源原始路径）。
        // 前端轻量剪枝 matchesListFilters 的 haystack 已同步并入该列。
        conditions.push(
            "(i.filename LIKE ? ESCAPE '\\' OR i.notes LIKE ? ESCAPE '\\' OR i.original_path LIKE ? ESCAPE '\\' OR i.id IN (SELECT it.image_id FROM image_tags it JOIN tags t ON t.id = it.tag_id WHERE t.name LIKE ? ESCAPE '\\'))".into(),
        );
        let pat = like_pattern(&q.search);
        params.push(Box::new(pat.clone()));
        params.push(Box::new(pat.clone()));
        params.push(Box::new(pat.clone()));
        params.push(Box::new(pat));
    }
}

pub fn get_images(conn: &Connection, q: &ImageQuery) -> rusqlite::Result<(Vec<ImageRow>, i64)> {
    let safe_limit = match q.limit {
        Some(n) if n.is_finite() => (n.floor().clamp(1.0, 2000.0)) as i64,
        _ => 200,
    };
    let safe_offset = match q.offset {
        Some(n) if n.is_finite() => (n.floor().max(0.0)) as i64,
        _ => 0,
    };

    let mut joins: Vec<&str> = Vec::new();
    let mut conditions: Vec<String> = vec!["i.hidden = 0".into()];
    let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
    build_filters(q, &mut joins, &mut conditions, &mut params);

    let base = format!(
        "SELECT DISTINCT i.* FROM images i {} WHERE {}",
        joins.join(" "),
        conditions.join(" AND ")
    );
    let count_sql = base.replacen(
        "SELECT DISTINCT i.*",
        "SELECT COUNT(DISTINCT i.id) as total",
        1,
    );
    let total: i64 = conn
        .query_row(
            &count_sql,
            rusqlite::params_from_iter(params.iter().map(|p| p.as_ref())),
            |r| r.get(0),
        )
        // 行数据照常返回，计数失败不能静默成 0：分页与总数错乱时无从排查
        .inspect_err(|e| eprintln!("[查询] 计数失败: {e}"))
        .unwrap_or(0);

    let allowed_sorts = ["import_date", "created_at", "filename", "size", "rating"];
    let requested = q.sort_by.as_deref().unwrap_or("import_date");
    let safe_sort = if allowed_sorts.contains(&requested) {
        requested
    } else {
        "import_date"
    };
    let safe_order = if q.sort_order.as_deref() == Some("ASC") {
        "ASC"
    } else {
        "DESC"
    };
    let order_clause = if safe_sort == "import_date" {
        format!(
            " ORDER BY CASE WHEN i.taken_at != '' THEN i.taken_at ELSE i.import_date END {safe_order}, i.id {safe_order}"
        )
    } else {
        format!(" ORDER BY i.{safe_sort} {safe_order}, i.id {safe_order}")
    };

    let sql = format!("{base}{order_clause} LIMIT ? OFFSET ?");
    params.push(Box::new(safe_limit));
    params.push(Box::new(safe_offset));
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map(
            rusqlite::params_from_iter(params.iter().map(|p| p.as_ref())),
            row_from,
        )?
        .collect::<rusqlite::Result<Vec<ImageRow>>>()?;
    Ok((rows, total))
}

pub fn get_image_by_id(conn: &Connection, id: i64) -> rusqlite::Result<Option<ImageRow>> {
    let mut stmt = conn.prepare("SELECT * FROM images WHERE id = ?1")?;
    let mut rows = stmt.query_map([id], row_from)?;
    match rows.next() {
        Some(row) => Ok(Some(row?)),
        None => Ok(None),
    }
}

#[derive(Debug, Serialize)]
pub struct ImportDateRow {
    pub date: String,
    pub count: i64,
}

pub fn get_import_dates(conn: &Connection) -> rusqlite::Result<Vec<ImportDateRow>> {
    let mut stmt = conn.prepare(
        "SELECT import_date AS date, COUNT(*) as count
         FROM images
         WHERE hidden = 0 AND import_date != ''
         GROUP BY import_date
         ORDER BY import_date DESC",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(ImportDateRow {
            date: r.get(0)?,
            count: r.get(1)?,
        })
    })?;
    rows.collect()
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatsRow {
    pub total_images: i64,
    pub total_tags: i64,
    pub total_albums: i64,
    pub favorites: i64,
}

/// 侧边栏徽标的全局统计，不接收任何筛选（与 tag/album/date/favorite 既有口径一致：
/// 筛选只改变网格视图，徽标恒为全库数）；get_images 的 total 计数经 build_filters
/// 自动获得 min_rating 同口径
pub fn get_stats(conn: &Connection) -> rusqlite::Result<StatsRow> {
    let count = |sql: &str| -> rusqlite::Result<i64> { conn.query_row(sql, [], |r| r.get(0)) };
    Ok(StatsRow {
        total_images: count("SELECT COUNT(*) FROM images WHERE hidden = 0")?,
        total_tags: count("SELECT COUNT(*) FROM tags")?,
        total_albums: count("SELECT COUNT(*) FROM albums")?,
        favorites: count("SELECT COUNT(*) FROM images WHERE favorite = 1 AND hidden = 0")?,
    })
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub(crate) fn mem_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE images (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                filename TEXT NOT NULL,
                filepath TEXT NOT NULL UNIQUE,
                original_path TEXT DEFAULT '',
                raw_path TEXT DEFAULT '',
                original_raw_path TEXT DEFAULT '',
                hidden INTEGER DEFAULT 0,
                orientation INTEGER DEFAULT 1,
                rotation INTEGER DEFAULT 0,
                flip_h INTEGER DEFAULT 0,
                flip_v INTEGER DEFAULT 0,
                import_date TEXT NOT NULL DEFAULT '',
                taken_at TEXT DEFAULT '',
                size INTEGER DEFAULT 0,
                width INTEGER DEFAULT 0,
                height INTEGER DEFAULT 0,
                format TEXT DEFAULT '',
                thumbnail TEXT DEFAULT '',
                thumbnail_path TEXT DEFAULT '',
                thumbnail_small_path TEXT DEFAULT '',
                rating INTEGER DEFAULT 0,
                favorite INTEGER DEFAULT 0,
                notes TEXT DEFAULT '',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE tags (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, color TEXT DEFAULT '#6366f1');
            CREATE TABLE image_tags (image_id INTEGER NOT NULL, tag_id INTEGER NOT NULL, PRIMARY KEY (image_id, tag_id));
            CREATE TABLE albums (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT DEFAULT '', cover_image_id INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
            CREATE TABLE album_images (album_id INTEGER NOT NULL, image_id INTEGER NOT NULL, sort_order INTEGER DEFAULT 0, PRIMARY KEY (album_id, image_id));
            CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE presets (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, params_json TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
            CREATE TABLE edits (image_id INTEGER NOT NULL);
            CREATE TABLE edit_history (image_id INTEGER NOT NULL);",
        )
        .unwrap();
        conn
    }

    fn q() -> ImageQuery {
        serde_json::from_str("{}").unwrap()
    }

    fn seed_basic(conn: &Connection) {
        conn.execute_batch(
            "INSERT INTO images (id, filename, filepath, import_date, taken_at, favorite, hidden) VALUES
               (1, 'a.jpg', '/a.jpg', '2026-01-05', '2026-01-02 10:00', 0, 0),
               (2, 'b.jpg', '/b.jpg', '2026-01-05', '', 1, 0),
               (3, 'c.jpg', '/c.jpg', '2026-02-01', '', 0, 1);
             INSERT INTO tags (id, name) VALUES (9, 'trip');
             INSERT INTO image_tags VALUES (1, 9), (2, 9);",
        )
        .unwrap();
    }

    #[test]
    fn like_pattern_转义通配符与转义符() {
        assert_eq!(like_pattern("100%"), "%100\\%%");
        assert_eq!(like_pattern("a_b\\c"), "%a\\_b\\\\c%");
        assert_eq!(like_pattern("x"), "%x%");
    }

    #[test]
    fn 基础列表_隐藏排除_total与行结构() {
        let conn = mem_db();
        seed_basic(&conn);
        let (rows, total) = get_images(&conn, &q()).unwrap();
        assert_eq!(total, 2);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].filename, "b.jpg");
        assert_eq!(rows[0].import_date, "2026-01-05");
        assert_eq!(rows[0].taken_at.as_deref(), Some(""));
        assert!(rows.iter().all(|r| r.id != 3));
    }

    #[test]
    fn 日期排序_taken_at优先回退import_date_次级id稳定() {
        let conn = mem_db();
        seed_basic(&conn);
        let (rows, _) = get_images(&conn, &q()).unwrap();
        // 图1 taken_at=2026-01-02；图2 回退 import_date=2026-01-05 → DESC 时图2 在前
        assert_eq!(rows[0].id, 2);
        assert_eq!(rows[1].id, 1);
        let asc = ImageQuery {
            sort_order: Some("ASC".into()),
            ..serde_json::from_str("{}").unwrap()
        };
        let (rows, _) = get_images(&conn, &asc).unwrap();
        assert_eq!(rows[0].id, 1);
    }

    #[test]
    fn 标签过滤_distinct去重多标签图() {
        let conn = mem_db();
        seed_basic(&conn);
        conn.execute_batch(
            "INSERT INTO tags (id, name) VALUES (8, 'dup'); INSERT INTO image_tags VALUES (1, 8);",
        )
        .unwrap();
        let query: ImageQuery = serde_json::from_str(r#"{"tagId": 9}"#).unwrap();
        let (rows, total) = get_images(&conn, &query).unwrap();
        assert_eq!(total, 2);
        assert_eq!(rows.len(), 2);
        // 图1 同时有标签 9 与 8，本过滤只按 9 JOIN → 不因去重语义产生重复
        assert_eq!(rows.iter().filter(|r| r.id == 1).count(), 1);
    }

    #[test]
    fn import_date精确覆盖范围区间() {
        let conn = mem_db();
        seed_basic(&conn);
        let exact: ImageQuery = serde_json::from_str(r#"{"importDate": "2026-01-05"}"#).unwrap();
        let (_, total) = get_images(&conn, &exact).unwrap();
        assert_eq!(total, 2);
        let range: ImageQuery =
            serde_json::from_str(r#"{"dateFrom": "2026-01-01", "dateTo": "2026-01-31"}"#).unwrap();
        let (rows, _) = get_images(&conn, &range).unwrap();
        assert_eq!(rows.len(), 2);
        let range2: ImageQuery =
            serde_json::from_str(r#"{"dateFrom": "2026-02-01", "dateTo": "2026-02-28"}"#).unwrap();
        let (rows, _) = get_images(&conn, &range2).unwrap();
        assert_eq!(rows.len(), 0);
    }

    #[test]
    fn favorite与search通配符转义() {
        let conn = mem_db();
        seed_basic(&conn);
        conn.execute_batch("INSERT INTO images (filename, filepath, import_date) VALUES ('100%.jpg', '/p100.jpg', '2026-03-01')")
            .unwrap();
        let fav: ImageQuery = serde_json::from_str(r#"{"favorite": true}"#).unwrap();
        let (rows, _) = get_images(&conn, &fav).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, 2);
        let search: ImageQuery = serde_json::from_str(r#"{"search": "100%"}"#).unwrap();
        let (rows, _) = get_images(&conn, &search).unwrap();
        // 「100%」转义后只命中字面 100%，不得通配全库
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].filename, "100%.jpg");
        let search_tag: ImageQuery = serde_json::from_str(r#"{"search": "trip"}"#).unwrap();
        let (_, total) = get_images(&conn, &search_tag).unwrap();
        assert_eq!(total, 2);
    }

    #[test]
    fn 搜索命中原始路径_通配符仍转义() {
        let conn = mem_db();
        seed_basic(&conn);
        conn.execute_batch(
            "INSERT INTO images (filename, filepath, original_path, import_date) VALUES
               ('dsc.jpg', '/m/dsc.jpg', 'E:/Cam/100NIKON/DSC_0007.JPG', '2026-03-01')",
        )
        .unwrap();
        // original_path 参与检索（README 承诺口径，R71 起与前端剪枝 haystack 同步）
        let by_orig: ImageQuery = serde_json::from_str(r#"{"search": "100nikon"}"#).unwrap();
        let (rows, _) = get_images(&conn, &by_orig).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].filename, "dsc.jpg");
        // 同一 LIKE 条件下通配符转义不回退：「%」只命中字面 %，不得通配全库
        let wildcard: ImageQuery = serde_json::from_str(r#"{"search": "%"}"#).unwrap();
        let (_, total) = get_images(&conn, &wildcard).unwrap();
        assert_eq!(total, 0);
        // 跨页全选共用 build_filters：original_path 命中同样生效
        let ids = get_all_visible_ids(&conn, &by_orig).unwrap();
        assert_eq!(ids.len(), 1);
    }

    #[test]
    fn limit夹取与offset分页() {
        let conn = mem_db();
        seed_basic(&conn);
        let zero: ImageQuery = serde_json::from_str(r#"{"limit": 0}"#).unwrap();
        let (rows, _) = get_images(&conn, &zero).unwrap();
        assert_eq!(rows.len(), 1);
        let page: ImageQuery = serde_json::from_str(r#"{"limit": 1, "offset": 1}"#).unwrap();
        let (rows, _) = get_images(&conn, &page).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, 1);
        let big: ImageQuery = serde_json::from_str(r#"{"limit": 99999}"#).unwrap();
        let (rows, _) = get_images(&conn, &big).unwrap();
        assert_eq!(rows.len(), 2);
    }

    #[test]
    fn 排序白名单外回落import_date() {
        let conn = mem_db();
        seed_basic(&conn);
        let evil: ImageQuery =
            serde_json::from_str(r#"{"sortBy": "id; DROP TABLE images"}"#).unwrap();
        let (rows, _) = get_images(&conn, &evil).unwrap();
        assert_eq!(rows.len(), 2);
        conn.query_row("SELECT COUNT(*) FROM images", [], |r| {
            let c: i64 = r.get(0)?;
            assert_eq!(c, 3);
            Ok(())
        })
        .unwrap();
    }

    #[test]
    fn 单图查询与导入日期统计() {
        let conn = mem_db();
        seed_basic(&conn);
        let row = get_image_by_id(&conn, 1).unwrap().unwrap();
        assert_eq!(row.filename, "a.jpg");
        assert!(get_image_by_id(&conn, 999).unwrap().is_none());
        let dates = get_import_dates(&conn).unwrap();
        assert_eq!(dates.len(), 1);
        assert_eq!(dates[0].date, "2026-01-05");
        assert_eq!(dates[0].count, 2);
        let stats = get_stats(&conn).unwrap();
        assert_eq!(stats.total_images, 2);
        assert_eq!(stats.total_tags, 1);
        assert_eq!(stats.total_albums, 0);
        assert_eq!(stats.favorites, 1);
    }

    /// 评分种子：rating 0/1/3/5 各一张（对拍向量表的期望值以它为基准，
    /// 与 tests/unit/lib/gallery.test.js「minRating 查询对拍向量」同表锁定）
    fn seed_rated(conn: &Connection) {
        conn.execute_batch(
            "INSERT INTO images (id, filename, filepath, import_date, rating, hidden) VALUES
               (1, 'r0.jpg', '/r0.jpg', '2026-04-01', 0, 0),
               (2, 'r1.jpg', '/r1.jpg', '2026-04-01', 1, 0),
               (3, 'r3.jpg', '/r3.jpg', '2026-04-01', 3, 0),
               (4, 'r5.jpg', '/r5.jpg', '2026-04-01', 5, 0);",
        )
        .unwrap();
    }

    /// 对拍向量：JSON 向量（前端 buildImageQuery 产出的 camelCase 键）→ 评分种子 [0,1,3,5]
    /// 中留存行数。JS 侧同表断言 matchesListFilters 剪枝数；本表断言真实 SQL 行数。
    const MIN_RATING_VECTORS: [(&str, i64); 6] = [
        ("{}", 4),
        (r#"{"minRating":0}"#, 4),
        (r#"{"minRating":1}"#, 3),
        (r#"{"minRating":3}"#, 2),
        (r#"{"minRating":5}"#, 1),
        (r#"{"minRating":6}"#, 0),
    ];

    #[test]
    fn 评分筛选_边界None_0_1_5_6_对拍向量() {
        let conn = mem_db();
        seed_rated(&conn);
        for (json, expect) in MIN_RATING_VECTORS {
            let query: ImageQuery = serde_json::from_str(json).unwrap();
            let (rows, total) = get_images(&conn, &query).unwrap();
            assert_eq!(total, expect, "向量 {json} total 不符");
            assert_eq!(rows.len(), expect as usize, "向量 {json} 行数不符");
            // 跨页全选共用 build_filters：同向量 id 集与 total 一致
            let ids = get_all_visible_ids(&conn, &query).unwrap();
            assert_eq!(ids.len() as i64, expect, "向量 {json} 全选 id 数不符");
        }
        // None/0 均不过滤：minRating=0 与「全部」同口径
        let zero: ImageQuery = serde_json::from_str(r#"{"minRating":0}"#).unwrap();
        let (rows, _) = get_images(&conn, &zero).unwrap();
        assert_eq!(rows.len(), 4);
    }

    #[test]
    fn 评分分支_SQL条件与参数序_变异金丝雀() {
        // 直接锁 build_filters 产物：变异（删分支）时本条先红，向量表随后红
        let query: ImageQuery = serde_json::from_str(r#"{"minRating":3,"favorite":true}"#).unwrap();
        let mut joins: Vec<&str> = Vec::new();
        let mut conditions: Vec<String> = Vec::new();
        let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        build_filters(&query, &mut joins, &mut conditions, &mut params);
        assert!(
            conditions.iter().any(|c| c == "i.rating >= ?"),
            "min_rating 分支缺失：conditions={conditions:?}"
        );
        assert_eq!(params.len(), 1);
        // 0 与 None 不产生条件（不过滤语义）
        for json in [r#"{"minRating":0}"#, "{}"] {
            let q2: ImageQuery = serde_json::from_str(json).unwrap();
            let mut conditions: Vec<String> = Vec::new();
            let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
            let mut joins: Vec<&str> = Vec::new();
            build_filters(&q2, &mut joins, &mut conditions, &mut params);
            assert!(
                !conditions.iter().any(|c| c.contains("rating")),
                "{json} 不应产生 rating 条件"
            );
            assert!(params.is_empty());
        }
    }

    #[test]
    fn 评分与标签相册组合筛选() {
        let conn = mem_db();
        seed_rated(&conn);
        // 标签 9 → 图2(r1)、图4(r5)；相册 3 → 图1(r0)、图2(r1)
        conn.execute_batch(
            "INSERT INTO tags (id, name) VALUES (9, 'trip');
             INSERT INTO image_tags VALUES (2, 9), (4, 9);
             INSERT INTO albums (id, name) VALUES (3, 'album');
             INSERT INTO album_images VALUES (3, 1, 0), (3, 2, 1);",
        )
        .unwrap();
        let combo_tag: ImageQuery = serde_json::from_str(r#"{"minRating":1,"tagId":9}"#).unwrap();
        let (rows, total) = get_images(&conn, &combo_tag).unwrap();
        assert_eq!(total, 2);
        assert!(rows.iter().all(|r| r.rating >= Some(1)));
        // rating ∧ tag 收窄：r5 的图4 单独留存
        let combo_tag5: ImageQuery = serde_json::from_str(r#"{"minRating":3,"tagId":9}"#).unwrap();
        let (rows, total) = get_images(&conn, &combo_tag5).unwrap();
        assert_eq!(total, 1);
        assert_eq!(rows[0].id, 4);
        // rating ∧ album：图1(r0) 被评分条件剔除，图2(r1) 留存
        let combo_album: ImageQuery =
            serde_json::from_str(r#"{"minRating":1,"albumId":3}"#).unwrap();
        let (rows, total) = get_images(&conn, &combo_album).unwrap();
        assert_eq!(total, 1);
        assert_eq!(rows[0].id, 2);
        // 三条件交集：minRating≥1 ∧ tag9 ∧ album3 → 图2
        let combo_all: ImageQuery =
            serde_json::from_str(r#"{"minRating":1,"tagId":9,"albumId":3}"#).unwrap();
        let ids = get_all_visible_ids(&conn, &combo_all).unwrap();
        assert_eq!(ids, vec![2]);
        // 隐藏行不因评分条件复活（hidden 基础条件仍在）
        conn.execute("UPDATE images SET rating = 5, hidden = 1 WHERE id = 1", [])
            .unwrap();
        let (_, total) = get_images(&conn, &combo_album).unwrap();
        assert_eq!(total, 1);
    }
}

/// 跨页全选：全部可见 id（同筛选器，无排序无分页）——镜像 getAllVisibleIds
pub fn get_all_visible_ids(conn: &Connection, q: &ImageQuery) -> rusqlite::Result<Vec<i64>> {
    let mut joins: Vec<&str> = Vec::new();
    let mut conditions: Vec<String> = vec!["i.hidden = 0".into()];
    let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
    build_filters(q, &mut joins, &mut conditions, &mut params);
    let sql = format!(
        "SELECT DISTINCT i.id FROM images i {} WHERE {}",
        joins.join(" "),
        conditions.join(" AND ")
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(
        rusqlite::params_from_iter(params.iter().map(|p| p.as_ref())),
        |r| r.get(0),
    )?;
    rows.collect()
}
