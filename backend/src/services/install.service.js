import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from '../config/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function splitSqlStatements(sql) {
  const statements = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i];
    const next = sql[i + 1];

    if (char === "'" && !inDoubleQuote) {
      if (inSingleQuote && next === "'") {
        current += char + next;
        i += 1;
        continue;
      }
      inSingleQuote = !inSingleQuote;
      current += char;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      if (inDoubleQuote && next === '"') {
        current += char + next;
        i += 1;
        continue;
      }
      inDoubleQuote = !inDoubleQuote;
      current += char;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote) {
      if (char === '-' && next === '-') {
        while (i < sql.length && sql[i] !== '\n') {
          i += 1;
        }
        continue;
      }

      if (char === '/' && next === '*') {
        i += 2;
        while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) {
          i += 1;
        }
        i += 1;
        continue;
      }

      if (char === ';') {
        const statement = current.trim();
        if (statement) {
          statements.push(statement);
        }
        current = '';
        continue;
      }
    }

    current += char;
  }

  const lastStatement = current.trim();
  if (lastStatement) {
    statements.push(lastStatement);
  }

  return statements;
}

async function install() {
  const schemaPath = path.resolve(__dirname, '../database/schema.sql');
  let connection;
  let destroyConnection = false;

  try {
    const sql = fs.readFileSync(schemaPath, 'utf-8');
    const queries = splitSqlStatements(sql);

    connection = await pool.getConnection();
    await connection.query('SET FOREIGN_KEY_CHECKS = 0');

    for (const query of queries) {
      await connection.query(query);
    }

    await connection.query('SET FOREIGN_KEY_CHECKS = 1');

    return {
      message: 'All tables are created',
      status: 200
    };
  } catch (error) {
    let message = error.message || 'Not all tables are created';

    if (connection) {
      try {
        await connection.query('SET FOREIGN_KEY_CHECKS = 1');
      } catch (resetError) {
        destroyConnection = true;
        message += `; failed to restore foreign-key checks: ${resetError.message}`;
      }
    }

    return { message, status: 500 };
  } finally {
    if (connection) {
      if (destroyConnection) {
        connection.destroy();
      } else {
        connection.release();
      }
    }
  }
}

export default { install };