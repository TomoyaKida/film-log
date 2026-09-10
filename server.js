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
  fs.mkdirSync(dataDir, { recursive: true });
}

// データベース接続
const dbPath = path.join(dataDir, 'film_log.db');
const db = new sqlite3.Database(dbPath);

// テーブル初期化＆初期データ挿入
db.serialize(() => {
  // 1. cameras テーブル
  db.run(`CREATE TABLE IF NOT EXISTS cameras (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL
  )`);

  // 2. lenses テーブル
  db.run(`CREATE TABLE IF NOT EXISTS lenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL
  )`);

  // 3. films テーブル
  db.run(`CREATE TABLE IF NOT EXISTS films (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patrone_id TEXT NOT NULL UNIQUE,
    film_name TEXT NOT NULL,
    iso INTEGER NOT NULL,
    camera_id INTEGER,
    lens_id INTEGER,
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (camera_id) REFERENCES cameras(id),
    FOREIGN KEY (lens_id) REFERENCES lenses(id)
  )`);

  // 4. shots テーブル
  db.run(`CREATE TABLE IF NOT EXISTS shots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    film_id INTEGER NOT NULL,
    frame_number INTEGER NOT NULL,
    shot_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    note TEXT,
    FOREIGN KEY (film_id) REFERENCES films(id)
  )`);

  // マスター初期データ（カメラ・レンズが空の場合にサンプルを自動登録）
  db.get("SELECT COUNT(*) AS count FROM cameras", (err, row) => {
    if (row && row.count === 0) {
      const stmt = db.prepare("INSERT INTO cameras (name) VALUES (?)");
      ['Leica M3', 'Nikon FM2', 'Canon AE-1'].forEach(c => stmt.run(c));
      stmt.finalize();
    }
  });

  db.get("SELECT COUNT(*) AS count FROM lenses", (err, row) => {
    if (row && row.count === 0) {
      const stmt = db.prepare("INSERT INTO lenses (name) VALUES (?)");
      ['Summicron 50mm f/2', 'Nikkor 50mm f/1.4', 'FD 50mm f/1.8'].forEach(l => stmt.run(l));
      stmt.finalize();
    }
  });
});

// QRコードスキャン後の新規装填画面（カメラ・レンズ選択肢をDBから取得して表示）
app.get('/scan/:patroneId', (req, res) => {
  const patroneId = req.params.patroneId;

  db.all("SELECT * FROM cameras", [], (err, cameras) => {
    db.all("SELECT * FROM lenses", [], (err, lenses) => {
      const cameraOptions = (cameras || []).map(c => `<option value="${c.id}">${c.name}</option>`).join('');
      const lensOptions = (lenses || []).map(l => `<option value="${l.id}">${l.name}</option>`).join('');

      res.send(`
        <!DOCTYPE html>
        <html lang="ja">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>新規フィルム装填</title>
          <style>
            body { font-family: sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; }
            .form-group { margin-bottom: 15px; }
            label { display: block; margin-bottom: 5px; font-weight: bold; }
            input, select { width: 100%; padding: 8px; box-sizing: border-box; }
            button { width: 100%; padding: 12px; background: #28a745; color: white; border: none; font-size: 16px; cursor: pointer; border-radius: 4px; }
          </style>
        </head>
        <body>
          <h2>📷 新規フィルム装填 [${patroneId}]</h2>
          <form action="/films" method="POST">
            <input type="hidden" name="patrone_id" value="${patroneId}">
            <div class="form-group">
              <label>フィルム銘柄:</label>
              <input type="text" name="film_name" placeholder="例: Kodak Portra 400" required>
            </div>
            <div class="form-group">
              <label>ISO感度:</label>
              <input type="number" name="iso" placeholder="例: 400" required>
            </div>
            <div class="form-group">
              <label>使用カメラ:</label>
              <select name="camera_id" required>
                <option value="">選択してください</option>
                ${cameraOptions}
              </select>
            </div>
            <div class="form-group">
              <label>使用レンズ:</label>
              <select name="lens_id" required>
                <option value="">選択してください</option>
                ${lensOptions}
              </select>
            </div>
            <button type="submit">使用開始</button>
          </form>
        </body>
        </html>
      `);
    });
  });
});

// フィルム使用開始処理（DB保存）
app.post('/films', (req, res) => {
  const { patrone_id, film_name, iso, camera_id, lens_id } = req.body;
  const sql = `INSERT INTO films (patrone_id, film_name, iso, camera_id, lens_id) VALUES (?, ?, ?, ?, ?)`;
  
  db.run(sql, [patrone_id, film_name, iso, camera_id, lens_id], function(err) {
    if (err) {
      return res.status(500).send("データベース書き込みエラー: " + err.message);
    }
    res.send(`
      <!DOCTYPE html>
      <html lang="ja">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>装填完了</title>
        <style>body { font-family: sans-serif; padding: 20px; text-align: center; }</style>
      </head>
      <body>
        <h2>✅ フィルム装填が完了しました！</h2>
        <p>パトローネID: <strong>${patrone_id}</strong></p>
        <p>銘柄: <strong>${film_name} (ISO ${iso})</strong></p>
        <p>データベース(ID: ${this.lastID})へ正常に保存されました。</p>
        <a href="/scan/${patrone_id}">戻る</a>
      </body>
      </html>
    `);
  });
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});