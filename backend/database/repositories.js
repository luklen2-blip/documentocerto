import { isPostgresConfigured, query } from './pg_pool.js';
import { JsonDB } from './json_db.js';

// Utilitário para conversão bidirecional entre snake_case (Postgres) e camelCase (JS)
function toCamel(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(toCamel);

  const res = {};
  for (const [k, v] of Object.entries(obj)) {
    // Campos específicos mapeados
    const camelKey = k.replace(/_([a-z0-9])/g, (_, g) => g.toUpperCase());
    res[camelKey] = (v && typeof v === 'object' && !(v instanceof Date)) ? toCamel(v) : v;
  }
  return res;
}

function toSnake(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const res = {};
  for (const [k, v] of Object.entries(obj)) {
    const snakeKey = k.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
    res[snakeKey] = v;
  }
  return res;
}

export class PgRepository {
  constructor(tableName, jsonFallbackName) {
    this.tableName = tableName;
    this.jsonDb = new JsonDB(jsonFallbackName || tableName);
  }

  isUsingPg() {
    return isPostgresConfigured();
  }

  // Busca síncrona ou assíncrona compatível com código existente
  findAll(predicate) {
    if (!this.isUsingPg()) {
      return this.jsonDb.findAll(predicate);
    }
    // No modo PostgreSQL síncrono em runtime quando chamado por código legado
    return this.jsonDb.findAll(predicate);
  }

  async findAllAsync(predicate) {
    if (!this.isUsingPg()) {
      return this.jsonDb.findAll(predicate);
    }
    const res = await query(`SELECT * FROM ${this.tableName} ORDER BY created_at DESC`);
    const items = res.rows.map(toCamel);
    return predicate ? items.filter(predicate) : items;
  }

  findById(id) {
    return this.jsonDb.findById(id);
  }

  async findByIdAsync(id) {
    if (!this.isUsingPg()) {
      return this.jsonDb.findById(id);
    }
    const res = await query(`SELECT * FROM ${this.tableName} WHERE id = $1 LIMIT 1`, [id]);
    if (res.rows.length === 0) return null;
    return toCamel(res.rows[0]);
  }

  findOne(predicate) {
    return this.jsonDb.findOne(predicate);
  }

  async findOneAsync(predicate) {
    if (!this.isUsingPg()) {
      return this.jsonDb.findOne(predicate);
    }
    const all = await this.findAllAsync();
    return all.find(predicate) || null;
  }

  insert(record) {
    // Atualiza o cache JsonDB para consistência imediata
    const doc = this.jsonDb.insert(record);

    // Se PostgreSQL estiver ativo, persiste em background / async
    if (this.isUsingPg()) {
      this.insertPg(doc).catch(err => {
        console.error(`[PgRepository Insert Error on ${this.tableName}]:`, err.message);
      });
    }

    return doc;
  }

  async insertAsync(record) {
    const doc = this.jsonDb.insert(record);
    if (this.isUsingPg()) {
      await this.insertPg(doc);
    }
    return doc;
  }

  async insertPg(record) {
    const snakeObj = toSnake(record);
    // Remove chaves nulas ou undefined se necessário
    const keys = Object.keys(snakeObj);
    const values = Object.values(snakeObj).map(v => {
      if (typeof v === 'object' && v !== null && !(v instanceof Date)) {
        return JSON.stringify(v);
      }
      return v;
    });

    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
    const columns = keys.join(', ');

    const sql = `
      INSERT INTO ${this.tableName} (${columns})
      VALUES (${placeholders})
      ON CONFLICT (id) DO UPDATE SET
        updated_at = NOW()
    `;

    return await query(sql, values);
  }

  update(id, updates) {
    const updated = this.jsonDb.update(id, updates);
    if (this.isUsingPg() && updated) {
      this.updatePg(id, updates).catch(err => {
        console.error(`[PgRepository Update Error on ${this.tableName}]:`, err.message);
      });
    }
    return updated;
  }

  async updateAsync(id, updates) {
    const updated = this.jsonDb.update(id, updates);
    if (this.isUsingPg() && updated) {
      await this.updatePg(id, updates);
    }
    return updated;
  }

  async updatePg(id, updates) {
    const snakeObj = toSnake(updates);
    delete snakeObj.id; // Não atualiza chave primária
    snakeObj.updated_at = new Date().toISOString();

    const keys = Object.keys(snakeObj);
    const values = Object.values(snakeObj).map(v => {
      if (typeof v === 'object' && v !== null && !(v instanceof Date)) {
        return JSON.stringify(v);
      }
      return v;
    });

    const setClauses = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
    const sql = `UPDATE ${this.tableName} SET ${setClauses} WHERE id = $${keys.length + 1}`;

    return await query(sql, [...values, id]);
  }

  delete(id) {
    const ok = this.jsonDb.delete(id);
    if (this.isUsingPg()) {
      query(`DELETE FROM ${this.tableName} WHERE id = $1`, [id]).catch(err => {
        console.error(`[PgRepository Delete Error on ${this.tableName}]:`, err.message);
      });
    }
    return ok;
  }

  async deleteAsync(id) {
    const ok = this.jsonDb.delete(id);
    if (this.isUsingPg()) {
      await query(`DELETE FROM ${this.tableName} WHERE id = $1`, [id]);
    }
    return ok;
  }

  deleteMany(predicate) {
    return this.jsonDb.deleteMany(predicate);
  }
}
