// SQLite en JavaScript puro (sql.js) — funciona sin Node 22 y sin Python
const fs = require('fs');
const { abrirDatabase } = require('./db');

function asegurarEsquema(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS departamentos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT NOT NULL,
            horario TEXT
        );

        CREATE TABLE IF NOT EXISTS tramites (
            id INTEGER PRIMARY KEY,
            departamento_id INTEGER,
            nombre TEXT NOT NULL,
            requisitos TEXT,
            link TEXT,
            formato TEXT,
            costo TEXT,
            FOREIGN KEY (departamento_id) REFERENCES departamentos(id)
        );

        CREATE TABLE IF NOT EXISTS configuracion (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            whatsapp_token TEXT NOT NULL DEFAULT '',
            phone_number_id TEXT NOT NULL DEFAULT '',
            verify_token TEXT NOT NULL DEFAULT '',
            api_version TEXT NOT NULL DEFAULT 'v26.0',
            puerto INTEGER NOT NULL DEFAULT 3000,
            public_url TEXT NOT NULL DEFAULT '',
            actualizado_en TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );

        CREATE TABLE IF NOT EXISTS mensajes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            telefono TEXT NOT NULL,
            rol TEXT NOT NULL,
            texto TEXT NOT NULL,
            origen TEXT NOT NULL DEFAULT 'whatsapp',
            creado_en TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );

        CREATE INDEX IF NOT EXISTS idx_mensajes_telefono ON mensajes(telefono);
        CREATE INDEX IF NOT EXISTS idx_mensajes_creado ON mensajes(creado_en);
    `);

    try {
        db.exec(`ALTER TABLE configuracion ADD COLUMN public_url TEXT NOT NULL DEFAULT ''`);
    } catch (_) {
        // la columna ya existe
    }

    const existe = db.prepare('SELECT id FROM configuracion WHERE id = 1').get();
    if (!existe) {
        db.prepare(`
            INSERT INTO configuracion (id, whatsapp_token, phone_number_id, verify_token, api_version, puerto, public_url)
            VALUES (1, '', '', 'usae_verify_token', 'v26.0', 3000, '')
        `).run();
    }
}

function cargarTramites(db) {
    db.exec(`
        DELETE FROM tramites;
        DELETE FROM departamentos;
    `);

    const datocrudo = fs.readFileSync('./tramites.json');
    const datosdepartamentos = JSON.parse(datocrudo);

    const insertDepto = db.prepare(
        'INSERT INTO departamentos (nombre, horario) VALUES (?, ?)'
    );
    const insertTramite = db.prepare(
        'INSERT INTO tramites (id, departamento_id, nombre, requisitos, link, formato, costo) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );

    for (const depto of datosdepartamentos) {
        const resultado = insertDepto.run(depto.departamento, depto.horario);
        const deptoid = Number(resultado.lastInsertRowid);

        for (const t of depto.tramites) {
            insertTramite.run(
                t.id,
                deptoid,
                t.nombre,
                t.requisitos,
                t.link,
                t.formato,
                t.costo
            );
        }
    }
}

async function configurardatabase() {
    const db = await abrirDatabase();
    asegurarEsquema(db);
    cargarTramites(db);
    console.log('base de datos sqlite (usae_bot.db) creada e inicializada correctamente.');
    console.log('tablas listas: departamentos, tramites, configuracion, mensajes');
    db.close();
}

if (require.main === module) {
    configurardatabase().catch((error) => {
        console.error(error);
        process.exit(1);
    });
}

module.exports = { asegurarEsquema, cargarTramites, configurardatabase };
