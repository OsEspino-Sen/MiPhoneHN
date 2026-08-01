// Módulo de configuración e inicialización de Supabase para Mi Phone HN (Cliente)
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Faltan variables VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY en el .env");
}

export const supabase = createClient(supabaseUrl, supabaseKey);

// ==========================================
// COMPATIBILITY LAYER FOR SUPABASE (CLIENTE)
// ==========================================

export const db = {}; // Dummy db ref

export function collection(dummyDb, name) {
  return { type: 'collection', name };
}

export function doc(dummyDb, name, id) {
  return { type: 'doc', name, id };
}

export function query(ref, ...clauses) {
  return { type: 'query', ref, clauses };
}

export function where(field, op, value) {
  return { type: 'where', field, op, value };
}

export function orderBy(field, dir) {
  return { type: 'orderBy', field, dir };
}

class MockDocSnap {
  constructor(id, data, name) {
    this.id = id;
    this._data = data;
    this.name = name;
  }
  exists() {
    return this._data !== null && this._data !== undefined;
  }
  data() {
    return this._data;
  }
}

class MockQuerySnap {
  constructor(docs) {
    this.docs = docs;
    this.empty = docs.length === 0;
  }
}

// Conversión de CamelCase a SnakeCase para Postgres
const camelToSnake = {
  oldPrice: 'old_price',
  batteryHealth: 'battery_health',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  fechaCreacion: 'fecha_creacion',
  lastLogin: 'last_login'
};

const snakeToCamel = {
  old_price: 'oldPrice',
  battery_health: 'batteryHealth',
  created_at: 'createdAt',
  updated_at: 'updatedAt',
  fecha_creacion: 'fechaCreacion',
  last_login: 'lastLogin'
};

function mapKeys(obj, mapper) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(item => mapKeys(item, mapper));
  const res = {};
  for (const k in obj) {
    const newK = mapper[k] || k;
    res[newK] = mapKeys(obj[k], mapper);
  }
  return res;
}

export async function getDoc(docRef) {
  const table = docRef.name;
  
  if (table === 'configuracion') {
    const { data, error } = await supabase.from('configuracion').select('data').eq('key', docRef.id).maybeSingle();
    if (error || !data) return new MockDocSnap(docRef.id, null, table);
    return new MockDocSnap(docRef.id, mapKeys(data.data, snakeToCamel), table);
  }
  
  let q = supabase.from(table).select('*');
  q = q.eq('id', docRef.id);
  
  const { data, error } = await q.maybeSingle();
  if (error || !data) return new MockDocSnap(docRef.id, null, table);
  
  return new MockDocSnap(data.id || docRef.id, mapKeys(data, snakeToCamel), table);
}

export async function getDocs(queryOrRef) {
  let ref = queryOrRef;
  let clauses = [];
  if (queryOrRef.type === 'query') {
    ref = queryOrRef.ref;
    clauses = queryOrRef.clauses;
  }
  
  const table = ref.name;
  let q = supabase.from(table).select('*');
  
  for (const clause of clauses) {
    if (clause.type === 'where') {
      const field = camelToSnake[clause.field] || clause.field;
      if (clause.op === '==') {
        q = q.eq(field, clause.value);
      }
    } else if (clause.type === 'orderBy') {
      const field = camelToSnake[clause.field] || clause.field;
      q = q.order(field, { ascending: clause.dir !== 'desc' });
    }
  }
  
  const { data, error } = await q;
  if (error || !data) return new MockQuerySnap([]);
  
  const docs = data.map(row => {
    let docData = mapKeys(row, snakeToCamel);
    if (table === 'configuracion') {
      docData = mapKeys(row.data, snakeToCamel);
    }
    return new MockDocSnap(row.id || row.key, docData, table);
  });
  
  return new MockQuerySnap(docs);
}

export function onSnapshot(queryOrRef, onNext, onError) {
  let ref = queryOrRef;
  if (queryOrRef.type === 'query') {
    ref = queryOrRef.ref;
  }
  const table = ref.name;
  let active = true;
  
  const runFetch = async () => {
    if (!active) return;
    try {
      const snap = await getDocs(queryOrRef);
      if (active) onNext(snap);
    } catch (err) {
      if (active && onError) onError(err);
    }
  };
  
  runFetch();
  
  const channel = supabase
    .channel(`${table}_changes`)
    .on('postgres_changes', { event: '*', schema: 'public', table }, () => {
      runFetch();
    })
    .subscribe();
    
  return () => {
    active = false;
    supabase.removeChannel(channel);
  };
}
