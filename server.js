const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// データ保存用ディレクトリの自動作成
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir);
}

// SQLite DB初期化
const db = new sqlite3.Database(path.join(dataDir, 'database.sqlite'));

db.serialize(() => {
  // 1. lenses テーブル（レンズマスター）
  db.run(`CREATE TABLE IF NOT EXISTS lenses (
    lens_id INTEGER PRIMARY KEY AUTOINCREMENT,
    lens_name TEXT NOT NULL,
    mount_type TEXT,
    created_at DATETIME DEFAULT (DATETIME('now', 'localtime'))
  )`);

  // 2. containers テーブル（コンテナマスター）
  db.run(`CREATE TABLE IF NOT EXISTS containers (
    container_id TEXT PRIMARY KEY,
    label_name TEXT,
    container_type TEXT,
    created_at DATETIME DEFAULT (DATETIME('now', 'localtime'))
  )`);

  // 3. cameras テーブル（カメラマスター）
  db.run(`CREATE TABLE IF NOT EXISTS cameras (
    camera_id INTEGER PRIMARY KEY AUTOINCREMENT,
    camera_name TEXT NOT NULL,
    format TEXT,
    created_at DATETIME DEFAULT (DATETIME('now', 'localtime'))
  )`);

  // 4. film_logs テーブル（撮影・現像履歴ログ）
  db.run(`CREATE TABLE IF NOT EXISTS film_logs (
    log_id INTEGER PRIMARY KEY AUTOINCREMENT,
    container_id TEXT NOT NULL,
    camera_id INTEGER NOT NULL,
    lens_id INTEGER,
    film_brand TEXT NOT NULL,
    iso_speed INTEGER,
    status TEXT NOT NULL,
    started_at DATETIME,
    ended_at DATETIME,
    sent_to_lab_at DATETIME,
    returned_from_lab_at DATETIME,
    time_logger_id TEXT,
    time_log_file_path TEXT,
    frame_count INTEGER,
    notes TEXT,
    created_at DATETIME DEFAULT (DATETIME('now', 'localtime')),
    FOREIGN KEY(container_id) REFERENCES containers(container_id),
    FOREIGN KEY(camera_id) REFERENCES cameras(camera_id),
    FOREIGN KEY(lens_id) REFERENCES lenses(lens_id)
  )`);
});

// QRコード読み込み時のメイン処理 (/scan/:container_id)
app.get('/scan/:container_id', (req, res) => {
  const containerId = req.params.container_id;

  const query = `
    SELECT * FROM film_logs 
    WHERE container_id = ? 
    ORDER BY log_id DESC LIMIT 1
  `;

  db.get(query, [containerId], (err, log) => {
    if (err) return res.status(500).send('DB Error');

    // パターンA: 過去ログが無い、または最新が現像完了('completed')の場合 ➔ 新規装填画面
    if (!log || log.status === 'completed') {
      db.all('SELECT * FROM cameras', [], (err, cameras) => {
        db.all('SELECT * FROM lenses', [], (err, lenses) => {
          let cameraOptions = cameras ? cameras.map(c => `<option value="${c.camera_id}">${c.camera_name}</option>`).join('') : '';
          let lensOptions = lenses ? lenses.map(l => `<option value="${l.lens_id}">${l.lens_name}</option>`).join('') : '';

          res.send(`
            <!DOCTYPE html>
            <html>
            <head><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>新規フィルム装填</title></head>
            <body style="font-family:sans-serif; padding:20px;">
              <h2>📷 新規フィルム装填 [${containerId}]</h2>
              <form action="/action/start" method="POST">
                <input type="hidden" name="container_id" value="${containerId}">
                <p><label>フィルム銘柄:<br><input type="text" name="film_brand" placeholder="例: Kodak Portra 400" required style="width:100%; padding:8px; box-sizing:border-box;"></label></p>
                <p><label>ISO感度:<br><input type="number" name="iso_speed" placeholder="例: 400" style="width:100%; padding:8px; box-sizing:border-box;"></label></p>
                <p><label>使用カメラ:<br><select name="camera_id" style="width:100%; padding:8px; box-sizing:border-box;">${cameraOptions}</select></label></p>
                <p><label>使用レンズ:<br><select name="lens_id" style="width:100%; padding:8px; box-sizing:border-box;">${lensOptions}</select></label></p>
                <button type="submit" style="width:100%; padding:12px; background:#28a745; color:white; border:none; border-radius:5px; font-size:16px;">使用開始</button>
              </form>
            </body>
            </html>
          `);
        });
      });
    } 
    // パターンB: 未完了のステータスが存在する場合 ➔ ステータス更新画面
    else {
      db.get('SELECT camera_name FROM cameras WHERE camera_id = ?', [log.camera_id], (err, camera) => {
        const cameraName = camera ? camera.camera_name : '未選択';
        let actionBtn = '';

        if (log.status === 'using') {
          actionBtn = `<form action="/action/update" method="POST">
            <input type="hidden" name="log_id" value="${log.log_id}">
            <input type="hidden" name="next_status" value="finished">
            <button style="width:100%; padding:12px; background:#dc3545; color:white; border:none; border-radius:5px; font-size:16px;">使用終了（撮り切り）</button>
          </form>`;
        } else if (log.status === 'finished') {
          actionBtn = `<form action="/action/update" method="POST">
            <input type="hidden" name="log_id" value="${log.log_id}">
            <input type="hidden" name="next_status" value="developing">
            <button style="width:100%; padding:12px; background:#ffc107; color:black; border:none; border-radius:5px; font-size:16px;">現像出し</button>
          </form>`;
        } else if (log.status === 'developing') {
          actionBtn = `<form action="/action/update" method="POST">
            <input type="hidden" name="log_id" value="${log.log_id}">
            <input type="hidden" name="next_status" value="completed">
            <button style="width:100%; padding:12px; background:#0d6efd; color:white; border:none; border-radius:5px; font-size:16px;">現像完了</button>
          </form>`;
        }

        res.send(`
          <!DOCTYPE html>
          <html>
          <head><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>ステータス更新</title></head>
          <body style="font-family:sans-serif; padding:20px;">
            <h2>🎞️ 進行中のフィルム [${containerId}]</h2>
            <p><strong>銘柄:</strong> ${log.film_brand} (ISO ${log.iso_speed || '未設定'})</p>
            <p><strong>カメラ:</strong> ${cameraName}</p>
            <p><strong>現在のステータス:</strong> ${log.status}</p>
            <hr>
            ${actionBtn}
          </body>
          </html>
        `);
      });
    }
  });
});

// 新規使用開始 POST API
app.post('/action/start', (req, res) => {
  const { container_id, camera_id, lens_id, film_brand, iso_speed } = req.body;
  const now = new Date().toISOString();

  db.run(
    `INSERT INTO film_logs (container_id, camera_id, lens_id, film_brand, iso_speed, status, started_at) VALUES (?, ?, ?, ?, ?, 'using', ?)`,
    [container_id, camera_id, lens_id, film_brand, iso_speed, now],
    (err) => {
      if (err) return res.status(500).send('DB Error');
      res.redirect(`/scan/${container_id}`);
    }
  );
});

// ステータス更新 POST API
app.post('/action/update', (req, res) => {
  const { log_id, next_status } = req.body;
  const now = new Date().toISOString();

  let fieldToUpdate = '';
  if (next_status === 'finished') fieldToUpdate = 'ended_at';
  if (next_status === 'developing') fieldToUpdate = 'sent_to_lab_at';
  if (next_status === 'completed') fieldToUpdate = 'returned_from_lab_at';

  db.run(
    `UPDATE film_logs SET status = ?, ${fieldToUpdate} = ? WHERE log_id = ?`,
    [next_status, now, log_id],
    (err) => {
      if (err) return res.status(500).send('DB Error');
      
      db.get('SELECT container_id FROM film_logs WHERE log_id = ?', [log_id], (err, row) => {
        res.redirect(`/scan/${row.container_id}`);
      });
    }
  );
});

// ポート3000でサーバー起動
app.listen(3000, () => {
  console.log('Film Log App is running on port 3000');
});