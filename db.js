const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const DB_PATH = path.join(__dirname, 'usae_bot.db');

function crearApi(rawDb) {
    let persistTimer = null;

    function persistir() {
        const data = rawDb.export();
        fs.writeFileSync(DB_PATH, Buffer.from(data));
    }

    function persistirPronto() {
        if (persistTimer) clearTimeout(persistTimer);
        persistTimer = setTimeout(() => {
            persistTimer = null;
            persistir();
        }, 50);
    }

    function prepare(sql) {
        return {
            run(...params) {
                rawDb.run(sql, params);
                const row = rawDb.exec('SELECT last_insert_rowid() AS id');
                const lastInsertRowid = row?.[0]?.values?.[0]?.[0] ?? 0;
                persistirPronto();
                return { lastInsertRowid };
            },
            get(...params) {
                const stmt = rawDb.prepare(sql);
                try {
                    stmt.bind(params);
                    if (!stmt.step()) return undefined;
                    return stmt.getAsObject();
                } finally {
                    stmt.free();
                }
            },
            all(...params) {
                const stmt = rawDb.prepare(sql);
                const filas = [];
                try {
                    stmt.bind(params);
                    while (stmt.step()) {
                        filas.push(stmt.getAsObject());
                    }
                } finally {
                    stmt.free();
                }
                return filas;
            }
        };
    }

    return {
        prepare,
        exec(sql) {
            rawDb.exec(sql);
            persistirPronto();
        },
        close() {
            if (persistTimer) {
                clearTimeout(persistTimer);
                persistTimer = null;
            }
            persistir();
            rawDb.close();
        }
    };
}

async function abrirDatabase() {
    const SQL = await initSqlJs();
    let rawDb;

    if (fs.existsSync(DB_PATH)) {
        const archivo = fs.readFileSync(DB_PATH);
        rawDb = new SQL.Database(archivo);
    } else {
        rawDb = new SQL.Database();
    }

    return crearApi(rawDb);
}

module.exports = { abrirDatabase, DB_PATH };
