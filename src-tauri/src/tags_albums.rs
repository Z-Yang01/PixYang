// 标签/相册只读查询内核：SQL 与 electron/database.js 的 getTags/getImageTags/
// getBatchImageTags/getAlbums 逐字镜像（image_count 只数可见图、封面取最新可见带缩略图、
// 批量查标签按 900 分块）。行字段名与 JS 返回的 DB 行一致（渲染端直接消费）。

use rusqlite::Connection;
use serde::Serialize;
use std::collections::HashMap;

const CHUNK_SIZE: usize = 900;

#[derive(Debug, Serialize)]
pub struct TagRow {
    pub id: i64,
    pub name: String,
    pub color: Option<String>,
    pub image_count: i64,
}

#[derive(Debug, Serialize)]
pub struct TagLite {
    pub id: i64,
    pub name: String,
    pub color: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct AlbumRow {
    pub id: i64,
    pub name: String,
    pub description: Option<String>,
    pub cover_image_id: Option<i64>,
    pub created_at: Option<String>,
    pub cover_path: Option<String>,
    pub image_count: i64,
}

pub fn get_tags(conn: &Connection) -> rusqlite::Result<Vec<TagRow>> {
    let mut stmt = conn.prepare(
        "SELECT t.id, t.name, t.color, COUNT(i.id) as image_count
         FROM tags t
         LEFT JOIN image_tags it ON t.id = it.tag_id
         LEFT JOIN images i ON i.id = it.image_id AND i.hidden = 0
         GROUP BY t.id
         ORDER BY t.name",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(TagRow {
            id: r.get(0)?,
            name: r.get(1)?,
            color: r.get(2)?,
            image_count: r.get(3)?,
        })
    })?;
    rows.collect()
}

pub fn get_image_tags(conn: &Connection, image_id: i64) -> rusqlite::Result<Vec<TagLite>> {
    let mut stmt = conn.prepare(
        "SELECT t.id, t.name, t.color FROM tags t
         JOIN image_tags it ON t.id = it.tag_id
         WHERE it.image_id = ?1",
    )?;
    let rows = stmt.query_map([image_id], |r| {
        Ok(TagLite {
            id: r.get(0)?,
            name: r.get(1)?,
            color: r.get(2)?,
        })
    })?;
    rows.collect()
}

pub fn get_batch_image_tags(
    conn: &Connection,
    image_ids: &[i64],
) -> rusqlite::Result<HashMap<i64, Vec<TagLite>>> {
    let mut result: HashMap<i64, Vec<TagLite>> = HashMap::new();
    for chunk in image_ids.chunks(CHUNK_SIZE) {
        let placeholders = vec!["?"; chunk.len()].join(",");
        let sql = format!(
            "SELECT it.image_id, t.id, t.name, t.color FROM tags t
             JOIN image_tags it ON t.id = it.tag_id
             WHERE it.image_id IN ({placeholders})"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(rusqlite::params_from_iter(chunk.iter()), |r| {
            Ok((
                r.get::<_, i64>(0)?,
                TagLite {
                    id: r.get(1)?,
                    name: r.get(2)?,
                    color: r.get(3)?,
                },
            ))
        })?;
        for row in rows {
            let (image_id, tag) = row?;
            result.entry(image_id).or_default().push(tag);
        }
    }
    Ok(result)
}

pub fn get_albums(conn: &Connection) -> rusqlite::Result<Vec<AlbumRow>> {
    let mut stmt = conn.prepare(
        "SELECT a.id, a.name, a.description, a.cover_image_id, a.created_at,
          (SELECT i.thumbnail_path
             FROM images i
             JOIN album_images ai ON ai.image_id = i.id
            WHERE ai.album_id = a.id AND i.hidden = 0 AND i.thumbnail_path != ''
            ORDER BY ai.image_id DESC LIMIT 1) AS cover_path,
          COUNT(vi.id) as image_count
        FROM albums a
        LEFT JOIN album_images ai ON ai.album_id = a.id
        LEFT JOIN images vi ON vi.id = ai.image_id AND vi.hidden = 0
        GROUP BY a.id
        ORDER BY a.created_at DESC",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(AlbumRow {
            id: r.get(0)?,
            name: r.get(1)?,
            description: r.get(2)?,
            cover_image_id: r.get(3)?,
            created_at: r.get(4)?,
            cover_path: r.get(5)?,
            image_count: r.get(6)?,
        })
    })?;
    rows.collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mem_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE images (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                hidden INTEGER DEFAULT 0,
                thumbnail_path TEXT DEFAULT ''
            );
            CREATE TABLE tags (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                color TEXT DEFAULT '#6366f1'
            );
            CREATE TABLE image_tags (
                image_id INTEGER NOT NULL,
                tag_id INTEGER NOT NULL,
                PRIMARY KEY (image_id, tag_id)
            );
            CREATE TABLE albums (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                description TEXT DEFAULT '',
                cover_image_id INTEGER,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE album_images (
                album_id INTEGER NOT NULL,
                image_id INTEGER NOT NULL,
                sort_order INTEGER DEFAULT 0,
                PRIMARY KEY (album_id, image_id)
            );",
        )
        .unwrap();
        conn
    }

    #[test]
    fn 标签计数只含可见图并按名排序() {
        let conn = mem_db();
        conn.execute_batch(
            "INSERT INTO images (id, hidden) VALUES (1, 0), (2, 1), (3, 0);
             INSERT INTO tags (id, name) VALUES (1, 'zeta'), (2, 'alpha');
             INSERT INTO image_tags VALUES (1, 1), (2, 1), (1, 2);",
        )
        .unwrap();
        let tags = get_tags(&conn).unwrap();
        assert_eq!(tags.len(), 2);
        assert_eq!(tags[0].name, "alpha");
        assert_eq!(tags[0].image_count, 1);
        assert_eq!(tags[1].name, "zeta");
        assert_eq!(tags[1].image_count, 1);
    }

    #[test]
    fn 单图标签查询() {
        let conn = mem_db();
        conn.execute_batch(
            "INSERT INTO images (id) VALUES (1);
             INSERT INTO tags (id, name, color) VALUES (5, 'travel', '#ff0000');
             INSERT INTO image_tags VALUES (1, 5);",
        )
        .unwrap();
        let tags = get_image_tags(&conn, 1).unwrap();
        assert_eq!(tags.len(), 1);
        assert_eq!(tags[0].id, 5);
        assert_eq!(tags[0].color.as_deref(), Some("#ff0000"));
        assert!(get_image_tags(&conn, 99).unwrap().is_empty());
    }

    #[test]
    fn 批量标签按图分组且跨块一致() {
        let conn = mem_db();
        let mut insert = String::from("INSERT INTO images (id) VALUES");
        for id in 1..=5 {
            insert.push_str(&format!(" ({id}),"));
        }
        insert.pop();
        conn.execute_batch(&insert).unwrap();
        conn.execute_batch(
            "INSERT INTO tags (id, name) VALUES (1, 't1');
             INSERT INTO image_tags VALUES (1, 1), (3, 1), (5, 1);",
        )
        .unwrap();
        let map = get_batch_image_tags(&conn, &[1, 2, 3, 5]).unwrap();
        assert_eq!(map.len(), 3);
        assert_eq!(map[&5][0].name, "t1");
        assert!(!map.contains_key(&2));
        let many: Vec<i64> = (1..=1000).collect();
        let big = get_batch_image_tags(&conn, &many).unwrap();
        assert_eq!(big.len(), 3);
    }

    #[test]
    fn 相册封面取最新可见带缩略图_计数只含可见() {
        let conn = mem_db();
        conn.execute_batch(
            "INSERT INTO images (id, hidden, thumbnail_path) VALUES
               (1, 0, '/t1.jpg'), (2, 1, '/t2.jpg'), (3, 0, '');
             INSERT INTO albums (id, name, created_at) VALUES (1, 'newer', '2026-09-20'), (2, 'older', '2026-09-01');
             INSERT INTO album_images VALUES (1, 1, 0), (1, 2, 0), (1, 3, 0), (2, 3, 0);",
        )
        .unwrap();
        let albums = get_albums(&conn).unwrap();
        assert_eq!(albums.len(), 2);
        assert_eq!(albums[0].name, "newer");
        assert_eq!(albums[0].cover_path.as_deref(), Some("/t1.jpg"));
        assert_eq!(albums[0].image_count, 2);
        assert_eq!(albums[1].cover_path, None);
        assert_eq!(albums[1].image_count, 1);
    }
}
