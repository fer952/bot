// importamos la libreria sqlite3 en su version con promesas
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const fs = require('fs');

// funcion principal asincrona para configurar la base de datos
async function configurardatabase() {
    // abrimos o creamos el archivo de la base de datos local
    const db = await open({
        filename: './usae_bot.db',
        driver: sqlite3.Database
    });

    // eliminamos las tablas anteriores si es que ya existian para crearlas limpias
    await db.exec(`
        DROP TABLE IF EXISTS tramites;
        DROP TABLE IF EXISTS departamentos;
    `);

    // creamos la tabla de departamentos
    await db.exec(`
        CREATE TABLE departamentos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT NOT NULL,
            horario TEXT
        );
    `);

    // creamos la tabla de tramites vinculada a departamentos
    await db.exec(`
        CREATE TABLE tramites (
            id INTEGER PRIMARY KEY,
            departamento_id INTEGER,
            nombre TEXT NOT NULL,
            requisitos TEXT,
            link TEXT,
            formato TEXT,
            costo TEXT,
            FOREIGN KEY (departamento_id) REFERENCES departamentos(id)
        );
    `);

    // leemos el contenido del archivo json con los tramites
    const datocrudo = fs.readFileSync('./tramites.json');
    const datosdepartamentos = JSON.parse(datocrudo);

    // recorremos cada departamento del json para insertarlo en sqlite
    for (const depto of datosdepartamentos) {
        const resultado = await db.run(
            'INSERT INTO departamentos (nombre, horario) VALUES (?, ?)',
            [depto.departamento, depto.horario]
        );
        const deptoid = resultado.lastID;

        // recorremos cada tramite dentro del departamento e insertamos
        for (const t of depto.tramites) {
            await db.run(
                'INSERT INTO tramites (id, departamento_id, nombre, requisitos, link, formato, costo) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [t.id, deptoid, t.nombre, t.requisitos, t.link, t.formato, t.costo]
            );
        }
    }

    console.log('base de datos sqlite (usae_bot.db) creada e inicializada correctamente.');
    await db.close();
}

// ejecutamos la funcion de configuracion
configurardatabase();